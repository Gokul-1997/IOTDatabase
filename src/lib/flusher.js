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
 * telemetry). The record that fails is preserved in the private, fsynced
 * quarantine before the checkpoint moves past it. Infrastructure failures
 * keep the original records pending instead of classifying them as bad data.
 */
import { sumSlices } from './hourly.js';
import { writeAlarmTransition } from './alarm-transition.js';
import { alarmFields } from './alarm-text.js';
import { METER_FIELDS } from './power-signals.js';
import { METER_INSERT_SQL } from './meter-writer.js';

export function isDataError(err) {
  return !!err && typeof err.code === 'string' && (err.code.startsWith('22') || err.code.startsWith('23'));
}

// A malformed checkpoint or transaction is an infrastructure/schema problem,
// not evidence that a machine's reading should be skipped.
function canQuarantine(err) {
  return isDataError(err) && !['ingest_checkpoint', 'transaction'].includes(err.ingestStage);
}

async function atStage(stage, operation) {
  try { return await operation(); }
  catch (err) {
    if (err && typeof err === 'object') err.ingestStage = stage;
    throw err;
  }
}

function diagnostics(err, records, collectorId) {
  const meta = { code: err.code, stage: err.ingestStage };
  // PostgreSQL detail/where/query can contain payload values; never copy them.
  for (const field of ['table', 'column', 'constraint']) {
    if (typeof err[field] === 'string' && /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(err[field])) meta[field] = err[field];
  }
  if (err.code === '22001') {
    const limit = /(?:character varying|varchar)\((\d+)\)/i.exec(err.message || '')?.[1];
    meta.error = 'database text value exceeds column length' + (limit ? ` (${limit} characters)` : '');
    const lengths = {};
    const count = (field, value) => {
      if (value == null) return;
      // varchar limits count characters, not UTF-8 bytes or UTF-16 code units.
      let length = 0;
      for (const _char of String(value)) length++;
      lengths[field] = Math.max(lengths[field] || 0, length);
    };
    for (const record of records) {
      if (err.ingestStage === 'telemetry_raw' && record.r) {
        count('machine_status', ['RUN', 'RUNNING', 'CUTTING'].includes(String(record.r.machine_status || '').toUpperCase()) ? 'RUNNING' : 'IDLE');
        count('mode', record.r.mode);
      } else if (err.ingestStage === 'telemetry_late' && record.l) {
        count('reason', record.l.reason);
      } else if (err.ingestStage === 'ingest_gaps' && record.gap) {
        count('collector_id', collectorId);
        count('reason', record.gap.reason);
      } else if (err.ingestStage === 'machine_alarms' && record.a) {
        for (const alarm of record.a.opens || []) {
          const fields = alarmFields(alarm);
          count('alarm_type', fields.alarmType);
          count('alarm_code', fields.alarmCode);
          count('severity', fields.severity);
          count('message', fields.message);
        }
      } else if (err.ingestStage === 'ingest_checkpoint') count('collector_id', collectorId);
    }
    if (Object.keys(lengths).length) meta.text_lengths = lengths;
  } else {
    meta.error = isDataError(err) ? 'database rejected a value or constraint' : err.message;
  }
  return meta;
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
      await atStage('telemetry_raw', async () => {
        const { text, values } = telemetryInsert(rows);
        await client.query(text, values);
      });
      written.rows_written = rows.length;
    }

    const late = records.filter(r => r.l).map(r => r.l);
    if (late.length) {
      await atStage('telemetry_late', () => client.query(
        `INSERT INTO telemetry_late (machine_id, company_id, device_time, received_at, reason, payload)
         SELECT * FROM unnest($1::int[], $2::int[], $3::bigint[], $4::timestamptz[], $5::text[], $6::jsonb[])`,
        [late.map(l => l.machine_id), late.map(l => l.company_id ?? null), late.map(l => l.device_time ?? null),
         late.map(l => l.received_at), late.map(l => l.reason), late.map(l => JSON.stringify(l.payload ?? null))]
      ));
      written.late_written = late.length;
    }

    const hourly = sumSlices(records.flatMap(r => r.h || []));
    if (hourly.length) {
      await atStage('production_hourly', () => client.query(
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
      ));
      written.hourly_upserts = hourly.length;
    }
    // Order matters: an alarm may open and close within this batch.
    for (const record of records) {
      if (record.gap) {
        const gap = record.gap;
        await atStage('ingest_gaps', () => client.query(`INSERT INTO ingest_gaps
          (collector_id,journal_seq,company_id,machine_id,last_observed_at,resumed_at,gap_seconds,
           known_state_seconds,unallocated_parts,unallocated_energy_kwh,reason,received_at)
          VALUES($1,$2,$3,$4,to_timestamp($5),to_timestamp($6),$7,$8,$9,$10,$11,$12)
          ON CONFLICT(collector_id,journal_seq) DO NOTHING`,
        [collectorId, record.s, gap.company_id, gap.machine_id, gap.from, gap.to, gap.to - gap.from,
          gap.known_state_seconds ?? 60, gap.unallocated_parts, gap.unallocated_energy, gap.reason,
          gap.received_at || record.r?.received_at]));
      }
      if (record.a) await atStage('machine_alarms', () => writeAlarmTransition(client, record.a));
      if (record.m) {
        const { machineId, companyId, at, reading, standalone } = record.m;
        await atStage('energy_meter_readings', () => client.query(METER_INSERT_SQL,
        [machineId, companyId, at, ...METER_FIELDS.map(([c]) => reading[c] ?? null),
          standalone ? METER_FIELDS.filter(([c]) => reading[c] != null).map(([c]) => c) : [], standalone === true]));
      }
    }
    return written;
  }

  async function commitCheckpoint(client, seq) {
    await atStage('ingest_checkpoint', () => client.query(
      `INSERT INTO ingest_checkpoint (collector_id, last_seq, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (collector_id) DO UPDATE SET last_seq = GREATEST(ingest_checkpoint.last_seq, EXCLUDED.last_seq), updated_at = now()`,
      [collectorId, seq]
    ));
  }

  /** One transaction: the records and the checkpoint, or nothing. */
  async function applyTx(records, { skipData = false } = {}) {
    const client = await pool.connect();
    let releaseError;
    try {
      await atStage('transaction', () => client.query('BEGIN'));
      // Seed before locking: concurrent first writes serialize on this key too.
      await atStage('ingest_checkpoint', () => client.query(
        `INSERT INTO ingest_checkpoint (collector_id, last_seq) VALUES ($1, 0)
         ON CONFLICT (collector_id) DO NOTHING`, [collectorId]
      ));
      const { rows } = await atStage('ingest_checkpoint', () => client.query(
        'SELECT last_seq FROM ingest_checkpoint WHERE collector_id = $1 FOR UPDATE', [collectorId]
      ));
      const durable = Number(rows[0]?.last_seq);
      if (!Number.isSafeInteger(durable) || durable < 0) throw new Error('Invalid ingest checkpoint');
      const fresh = records.filter(record => record.s > durable);
      const written = !skipData && fresh.length ? await writeRecords(client, fresh) : null;
      const nextCheckpoint = Math.max(durable, records.at(-1).s);
      if (fresh.length) await commitCheckpoint(client, nextCheckpoint);
      await atStage('transaction', () => client.query('COMMIT'));
      if (written) for (const [key, value] of Object.entries(written)) stats[key] += value;
      return nextCheckpoint;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { releaseError = err; }
      // Do not return a connection with an uncertain transaction state to the pool.
      if (!canQuarantine(err)) releaseError = err;
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
        if (!canQuarantine(err)) throw err;
        stats.bad_records++;
        const meta = diagnostics(err, [rec], collectorId);
        journal.quarantine?.(rec, { reason: 'database_rejected', ...meta });
        log('error', 'quarantined a reading the database refused', {
          machine_id: rec.r?.machine_id ?? rec.l?.machine_id, device_time: rec.r?.device_time ?? rec.l?.device_time,
          seq: rec.s, ...meta
        });
        checkpoint = Math.max(checkpoint, await applyTx([rec], { skipData: true }));
      }
    }
  }

  /** One pass. Resolves to the number of records handled (0 = nothing waiting). */
  async function pass() {
    const { records, position, advanced } = journal.read(batchSize);
    if (!records.length) {
      if (advanced) journal.ack(position, 0);
      return 0;
    }
    // Never let DB state move beyond journal durability, even if fsync fails.
    await journal.syncThrough?.(records.at(-1).s);
    const fresh = records.filter(r => r.s > checkpoint);
    if (fresh.length) {
      const t0 = Date.now();
      try {
        checkpoint = Math.max(checkpoint, await applyTx(fresh));
      } catch (err) {
        if (!canQuarantine(err)) throw err;
        log('warn', 'batch refused for its data; writing record by record', { ...diagnostics(err, fresh, collectorId), records: fresh.length });
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
        if (stats.db_ok) log('error', 'database write failed; readings stay in the journal and will be retried', diagnostics(err, [], collectorId));
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
        catch (err) { log('warn', 'drain: database write failed', diagnostics(err, [], collectorId)); return false; }
      }
      return journal.stats().pending === 0;
    },

    stats() { return { ...stats, checkpoint }; },
    /** for tests */
    pass
  };
}
