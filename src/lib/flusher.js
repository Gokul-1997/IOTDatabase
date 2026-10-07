/*
 * Moves journal records into the database — exactly once.
 *
 * Each pass takes up to `batchSize` records and writes, in ONE transaction:
 *   - their telemetry rows into telemetry_raw;
 *   - readings that arrived too late or out of order into telemetry_late;
 *   - the hourly production they add, summed per (machine, shift, hour), into
 *     production_hourly;
 *   - the journal position reached, into ingest_checkpoint.
 * Then it tells the journal it may free that space.
 *
 * A crash after the commit but before the journal hears about it replays the
 * batch on restart, and the locked checkpoint makes the replay skip it — so rows are
 * not written twice and hourly totals are not added twice. A database outage
 * just stops the passes; the journal keeps everything and the writer retries
 * with a growing pause (0.5 s up to 15 s). Every transaction rechecks that
 * checkpoint, including when COMMIT succeeded but its response was lost.
 *
 * A batch the database refuses for its *data* (SQLSTATE class 22/23) is
 * written record by record so one bad value cannot hold up every machine
 * (2026-09-15: one machine's 42279658848 in an INTEGER column stopped all
 * telemetry). The record that fails is logged and skipped; the checkpoint
 * moves past it.
 */
import { sumSlices } from './hourly.js';

export function isDataError(err) {
  return !!err && typeof err.code === 'string' && (err.code.startsWith('22') || err.code.startsWith('23'));
}

export function createFlusher({ pool, journal, collectorId, telemetryInsert, log = () => {}, batchSize = 1000 }) {
  let checkpoint = 0;
  let stopped = false;
  let loop = null;
  let wakeUp = null;                      // ends a back-off pause early (stop)
  const pauseFor = ms => new Promise(r => { const t = setTimeout(r, ms); wakeUp = () => { clearTimeout(t); r(); }; });
  const stats = {
    rows_written: 0, late_written: 0, hourly_upserts: 0, batches: 0, retries: 0,
    bad_records: 0, last_batch_ms: 0, max_batch_ms: 0, last_commit_at: null, db_ok: true
  };

  async function writeRecords(client, records) {
    const written = { rows_written: 0, late_written: 0, hourly_upserts: 0 };
    const rows = records.filter(r => r.r).map(r => r.r);
    if (rows.length) {
      const { text, values } = telemetryInsert(rows);
      await client.query(text, values);
      written.rows_written = rows.length;
    }

    const late = records.filter(r => r.l).map(r => r.l);
    if (late.length) {
      await client.query(
        `INSERT INTO telemetry_late (machine_id, company_id, device_time, received_at, reason, payload)
         SELECT * FROM unnest($1::int[], $2::int[], $3::bigint[], $4::timestamptz[], $5::text[], $6::jsonb[])`,
        [late.map(l => l.machine_id), late.map(l => l.company_id ?? null), late.map(l => l.device_time ?? null),
         late.map(l => l.received_at), late.map(l => l.reason), late.map(l => JSON.stringify(l.payload ?? null))]
      );
      written.late_written = late.length;
    }

    const hourly = sumSlices(records.flatMap(r => r.h || []));
    if (hourly.length) {
      await client.query(
        `INSERT INTO production_hourly
           (company_id, machine_id, shift_id, hour_start, run_seconds, idle_seconds, manual_seconds, produced_qty, energy_kwh)
         SELECT c, m, s, to_timestamp(h), run, idle, man, qty, kwh
           FROM unnest($1::int[], $2::int[], $3::int[], $4::bigint[], $5::int[], $6::int[], $7::int[], $8::int[], $9::float8[])
             AS u(c, m, s, h, run, idle, man, qty, kwh)
         ON CONFLICT (machine_id, shift_id, hour_start) DO UPDATE SET
           run_seconds    = production_hourly.run_seconds    + EXCLUDED.run_seconds,
           idle_seconds   = production_hourly.idle_seconds   + EXCLUDED.idle_seconds,
           manual_seconds = production_hourly.manual_seconds + EXCLUDED.manual_seconds,
           produced_qty   = production_hourly.produced_qty   + EXCLUDED.produced_qty,
           energy_kwh     = production_hourly.energy_kwh     + EXCLUDED.energy_kwh`,
        [hourly.map(h => h.company_id ?? null), hourly.map(h => h.machine_id), hourly.map(h => h.shift_id),
         hourly.map(h => h.hour_start), hourly.map(h => Math.round(h.run)), hourly.map(h => Math.round(h.idle)),
         hourly.map(h => Math.round(h.manual)), hourly.map(h => Math.round(h.produced)), hourly.map(h => h.energy || 0)]
      );
      written.hourly_upserts = hourly.length;
    }
    return written;
  }

  async function commitCheckpoint(client, seq) {
    await client.query(
      `INSERT INTO ingest_checkpoint (collector_id, last_seq, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (collector_id) DO UPDATE SET last_seq = GREATEST(ingest_checkpoint.last_seq, EXCLUDED.last_seq), updated_at = now()`,
      [collectorId, seq]
    );
  }

  /** One transaction: the records and the checkpoint, or nothing. */
  async function applyTx(records, { skipData = false } = {}) {
    const client = await pool.connect();
    let releaseError;
    try {
      await client.query('BEGIN');
      // Seed before locking: concurrent first writes serialize on this key too.
      await client.query(
        `INSERT INTO ingest_checkpoint (collector_id, last_seq) VALUES ($1, 0)
         ON CONFLICT (collector_id) DO NOTHING`, [collectorId]
      );
      const { rows } = await client.query(
        'SELECT last_seq FROM ingest_checkpoint WHERE collector_id = $1 FOR UPDATE', [collectorId]
      );
      const durable = Number(rows[0]?.last_seq);
      if (!Number.isSafeInteger(durable) || durable < 0) throw new Error('Invalid ingest checkpoint');
      const fresh = records.filter(record => record.s > durable);
      const written = !skipData && fresh.length ? await writeRecords(client, fresh) : null;
      const nextCheckpoint = Math.max(durable, records.at(-1).s);
      if (fresh.length) await commitCheckpoint(client, nextCheckpoint);
      await client.query('COMMIT');
      if (written) for (const [key, value] of Object.entries(written)) stats[key] += value;
      return nextCheckpoint;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { releaseError = err; }
      // Do not return a connection with an uncertain transaction state to the pool.
      if (!isDataError(err)) releaseError = err;
      throw err;
    } finally {
      client.release(releaseError);
    }
  }

  async function applyOneByOne(records) {
    for (const rec of records) {
      try {
        checkpoint = Math.max(checkpoint, await applyTx([rec]));
      } catch (err) {
        if (!isDataError(err)) throw err;
        stats.bad_records++;
        log('error', 'dropped a reading the database refused', {
          machine_id: rec.r?.machine_id ?? rec.l?.machine_id, device_time: rec.r?.device_time, error: err.message, seq: rec.s
        });
        checkpoint = Math.max(checkpoint, await applyTx([rec], { skipData: true }));
      }
    }
  }

  /** One pass. Resolves to the number of records handled (0 = nothing waiting). */
  async function pass() {
    const { records, position } = journal.read(batchSize);
    if (!records.length) return 0;
    const fresh = records.filter(r => r.s > checkpoint);
    if (fresh.length) {
      const t0 = Date.now();
      try {
        checkpoint = Math.max(checkpoint, await applyTx(fresh));
      } catch (err) {
        if (!isDataError(err)) throw err;
        log('warn', 'batch refused for its data; writing record by record', { error: err.message, records: fresh.length });
        await applyOneByOne(fresh);
      }
      checkpoint = Math.max(checkpoint, fresh.at(-1).s);
      const ms = Date.now() - t0;
      stats.batches++; stats.last_batch_ms = ms; stats.max_batch_ms = Math.max(stats.max_batch_ms, ms);
      stats.last_commit_at = new Date().toISOString();
    }
    journal.ack(position, records.length);
    return records.length;
  }

  async function run() {
    let pause = 0;
    while (!stopped) {
      try {
        const n = await pass();
        if (!stats.db_ok) log('info', 'database writes resumed', { pending: journal.stats().pending });
        stats.db_ok = true; pause = 0;
        if (n === 0) await journal.waitForData(250);
      } catch (err) {
        stats.retries++;
        if (stats.db_ok) log('error', 'database write failed; readings stay in the journal and will be retried', { error: err.message, code: err.code });
        stats.db_ok = false;
        pause = Math.min(pause ? pause * 2 : 500, 15_000);
        await pauseFor(pause);
      }
    }
  }

  return {
    /** Read the checkpoint (the database must be reachable), then start writing. */
    async start() {
      const { rows } = await pool.query('SELECT last_seq FROM ingest_checkpoint WHERE collector_id = $1', [collectorId]);
      checkpoint = rows[0] ? Number(rows[0].last_seq) : 0;
      loop = run();
      return checkpoint;
    },

    /** Stop after the current pass. */
    async stop() { stopped = true; wakeUp?.(); journal.wakeAll?.(); await loop; },

    /** Write whatever is waiting, for at most `ms`. Resolves to true when nothing is left. */
    async drain(ms = 5000) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        try { if (await pass() === 0) return true; }
        catch (err) { log('warn', 'drain: database write failed', { error: err.message }); return false; }
      }
      return journal.stats().pending === 0;
    },

    stats() { return { ...stats, checkpoint }; },
    /** for tests */
    pass
  };
}
