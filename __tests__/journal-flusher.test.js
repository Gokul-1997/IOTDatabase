/*
 * The journal and the writer: an accepted reading reaches the database once —
 * through restarts, crashes mid-write, database outages and bad values.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createJournal } from '../src/lib/journal.js';
import { createFlusher } from '../src/lib/flusher.js';
import { telemetryInsert } from '../buffer.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
const quiet = () => {};

/*
 * A database that remembers what was committed. Statements inside a
 * transaction are staged and applied on COMMIT, dropped on ROLLBACK, so a
 * failure part-way through a batch leaves nothing behind — as Postgres does.
 */
function fakeDb() {
  const db = { telemetry: [], late: [], alarms: [], meters: [], gaps: [], hourly: new Map(), checkpoint: new Map(), down: false, poison: null, queries: 0, loseCommitReply: false };
  db.pool = {
    async query(sql, params) {
      if (db.down) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      if (/FROM ingest_checkpoint/.test(sql)) {
        const v = db.checkpoint.get(params[0]);
        return { rows: v == null ? [] : [{ last_seq: String(v) }] };
      }
      return { rows: [] };
    },
    async connect() {
      if (db.down) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      let staged = [];
      return {
        async query(sql, params) {
          db.queries++;
          if (db.down) throw Object.assign(new Error('Connection terminated'), { code: '57P01' });
          if (sql === 'BEGIN') { staged = []; return {}; }
          if (sql === 'ROLLBACK') { staged = []; return {}; }
          if (sql === 'COMMIT') {
            for (const f of staged) f(); staged = [];
            if (db.loseCommitReply) {
              db.loseCommitReply = false;
              throw Object.assign(new Error('COMMIT response lost'), { code: 'ECONNRESET' });
            }
            return {};
          }
          if (/SELECT last_seq FROM ingest_checkpoint/.test(sql)) {
            return { rows: [{ last_seq: String(db.checkpoint.get(params[0]) || 0) }] };
          }
          if (sql.startsWith('INSERT INTO telemetry_raw')) {
            if (db.poison != null && params.includes(db.poison)) throw Object.assign(new Error('value out of range'), { code: '22003' });
            const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim());
            const rows = [];
            for (let i = 0; i < params.length; i += cols.length) rows.push(Object.fromEntries(cols.map((c, k) => [c, params[i + k]])));
            staged.push(() => db.telemetry.push(...rows));
            return {};
          }
          if (sql.includes('INSERT INTO telemetry_late')) {
            const [m, , dt, , reason] = params;
            staged.push(() => m.forEach((id, i) => db.late.push({ machine_id: id, device_time: dt[i], reason: reason[i] })));
            return {};
          }
          if (sql.includes('INSERT INTO production_hourly')) {
            const [, m, sft, h, run, idle, , qty] = params;
            staged.push(() => m.forEach((id, i) => {
              const k = `${id}|${sft[i]}|${h[i]}`;
              const t = db.hourly.get(k) || { run: 0, idle: 0, qty: 0 };
              db.hourly.set(k, { run: t.run + run[i], idle: t.idle + idle[i], qty: t.qty + qty[i] });
            }));
            return {};
          }
          if (sql.includes('INSERT INTO ingest_gaps')) { staged.push(() => db.gaps.push(params)); return {}; }
          if (sql.includes('machine_alarms')) {
            staged.push(() => db.alarms.push({ sql, params })); return {};
          }
          if (sql.includes('INSERT INTO energy_meter_readings')) {
            staged.push(() => db.meters.push(params)); return {};
          }
          if (sql.includes('INSERT INTO ingest_checkpoint')) {
            if (sql.includes('DO NOTHING')) return {};
            const [id, seq] = params;
            staged.push(() => db.checkpoint.set(id, Math.max(db.checkpoint.get(id) || 0, seq)));
            return {};
          }
          throw new Error('unexpected SQL: ' + sql.slice(0, 40));
        },
        release() {}
      };
    }
  };
  return db;
}

const reading = (machine, t, extra = {}) => ({
  r: { company_id: 4, machine_id: machine, machine_status: 'RUNNING', parts_count: t, device_time: t,
       received_at: new Date(t * 1000).toISOString(), ...extra },
  h: [{ company_id: 4, machine_id: machine, shift_id: 1, hour_start: 1000, run: 1, idle: 0, manual: 0, produced: 0, energy: 0 }]
});

function setup(dir = tmp(), db = fakeDb()) {
  const journal = createJournal({ dir, fsyncMs: 5, log: quiet });
  journal.open();
  const flusher = createFlusher({ pool: db.pool, journal, collectorId: 'c1', telemetryInsert, log: quiet, batchSize: 50 });
  return { dir, db, journal, flusher };
}

async function drainPasses(flusher) { while (await flusher.pass()) { /* until empty */ } }

describe('journal', () => {
  test('sequence numbers only grow, across a restart', () => {
    const dir = tmp();
    const a = createJournal({ dir, log: quiet }); a.open();
    const s1 = a.append({ x: 1 }), s2 = a.append({ x: 2 });
    a.close();
    const b = createJournal({ dir, log: quiet }); const { recovered, lastSeq } = b.open();
    expect(s2).toBeGreaterThan(s1);
    expect(recovered).toBe(2);
    expect(lastSeq).toBe(s2);
    expect(b.append({ x: 3 })).toBeGreaterThan(s2);
  });

  test('a record cut off by a crash mid-write is dropped; the ones before it are kept', () => {
    const dir = tmp();
    const a = createJournal({ dir, log: quiet }); a.open();
    a.append({ x: 1 }); a.append({ x: 2 }); a.close();
    const seg = fs.readdirSync(dir).find(f => f.endsWith('.ndjson'));
    fs.appendFileSync(path.join(dir, seg), '{"x":3,"s":99');          // no newline: torn
    const b = createJournal({ dir, log: quiet }); b.open();
    expect(b.read(10).records.map(r => r.x)).toEqual([1, 2]);
  });

  test('segments are deleted once the database has them; the active one stays', () => {
    const dir = tmp();
    const j = createJournal({ dir, segmentMaxRecords: 2, log: quiet }); j.open();
    for (let i = 0; i < 5; i++) j.append({ i });
    expect(j.stats().segments).toBeGreaterThan(2);
    const { records, position } = j.read(100);
    expect(records).toHaveLength(5);
    j.ack(position, records.length);
    expect(j.stats().segments).toBe(1);
    expect(j.stats().pending).toBe(0);
  });

  test('a full journal refuses instead of growing without limit, and says so in its stats', () => {
    const j = createJournal({ dir: tmp(), maxBytes: 200, log: quiet }); j.open();
    let refused = 0;
    for (let i = 0; i < 20; i++) if (!j.append({ pad: 'x'.repeat(40) })) refused++;
    expect(refused).toBeGreaterThan(0);
    expect(j.stats().refused).toBe(refused);
  });
});

describe('writer', () => {
  test('a lost COMMIT reply is retried without duplicating telemetry or hourly totals', async () => {
    const { db, journal, flusher } = setup();
    journal.append(reading(7, 1));
    db.loseCommitReply = true;
    await expect(flusher.pass()).rejects.toThrow('COMMIT response lost');
    expect(db.telemetry).toHaveLength(1);
    expect(journal.stats().pending).toBe(1);
    journal.append(reading(7, 2));
    await drainPasses(flusher);
    expect(db.telemetry.map(r => r.device_time)).toEqual([1, 2]);
    expect(db.hourly.get('7|1|1000').run).toBe(2);
    expect(journal.stats().pending).toBe(0);
    journal.close();
  });

  test('a failed batch does not count rolled-back writes in writer metrics', async () => {
    const { db, journal, flusher } = setup();
    journal.append(reading(1, 1));
    journal.append(reading(2, 2, { mode: 'POISON' }));
    db.poison = 'POISON';
    await drainPasses(flusher);
    expect(flusher.stats().rows_written).toBe(1);
    expect(flusher.stats().hourly_upserts).toBe(1);
    journal.close();
  });
  test('everything appended is written once, rows and hourly totals in the same transaction', async () => {
    const { db, journal, flusher } = setup();
    await flusher.start(); await flusher.stop();
    for (let t = 1; t <= 120; t++) journal.append(reading(7, t));
    await drainPasses(flusher);
    expect(db.telemetry).toHaveLength(120);
    expect(db.hourly.get('7|1|1000')).toEqual({ run: 120, idle: 0, qty: 0 });
    expect(journal.stats().pending).toBe(0);
  });

  test('received_at is the time the reading arrived, not the time it was written', async () => {
    const { db, journal, flusher } = setup();
    await flusher.start(); await flusher.stop();
    journal.append(reading(7, 1_700_000_000));
    await drainPasses(flusher);
    expect(new Date(db.telemetry[0].received_at).toISOString()).toBe(new Date(1_700_000_000_000).toISOString());
  });

  test('a database outage loses nothing: the writer waits, then writes everything', async () => {
    const { db, journal, flusher } = setup();
    await flusher.start(); await flusher.stop();
    db.down = true;
    for (let t = 1; t <= 30; t++) journal.append(reading(7, t));
    await expect(flusher.pass()).rejects.toThrow();
    expect(db.telemetry).toHaveLength(0);
    db.down = false;
    await drainPasses(flusher);
    expect(db.telemetry).toHaveLength(30);
    expect(db.hourly.get('7|1|1000').run).toBe(30);
  });

  test('a restart replays what was not written — and only that (no double hourly totals)', async () => {
    const dir = tmp(); const db = fakeDb();
    const first = setup(dir, db);
    await first.flusher.start(); await first.flusher.stop();
    for (let t = 1; t <= 10; t++) first.journal.append(reading(7, t));
    await first.flusher.pass();                      // all 10 committed …
    first.journal.close();                           // … and the process dies before more
    // a crash between COMMIT and the journal hearing about it: the segment is
    // still on disk, but the database checkpoint already covers it
    const again = setup(dir, db);
    for (let t = 11; t <= 15; t++) again.journal.append(reading(7, t));
    await again.flusher.start(); await again.flusher.stop();
    await drainPasses(again.flusher);
    expect(db.telemetry.map(r => r.device_time)).toEqual([...Array(15)].map((_, i) => i + 1));
    expect(db.hourly.get('7|1|1000').run).toBe(15);
  });

  test('one bad value does not hold up the plant: the batch is written record by record and only it is skipped', async () => {
    const { db, journal, flusher } = setup();
    await flusher.start(); await flusher.stop();
    journal.append(reading(1, 1));
    journal.append(reading(2, 2, { mode: 'POISON' }));
    journal.append(reading(3, 3));
    db.poison = 'POISON';
    await drainPasses(flusher);
    expect(db.telemetry.map(r => r.machine_id)).toEqual([1, 3]);
    expect(flusher.stats().bad_records).toBe(1);
    expect(journal.stats().pending).toBe(0);         // not retried forever
    expect(db.checkpoint.get('c1')).toBeGreaterThan(0);
  });

  test('late and out-of-order readings go to telemetry_late, not to live data', async () => {
    const { db, journal, flusher } = setup();
    await flusher.start(); await flusher.stop();
    journal.append({ l: { machine_id: 7, company_id: 4, device_time: 5, received_at: new Date().toISOString(), reason: 'stale', payload: { time: 5 } } });
    await drainPasses(flusher);
    expect(db.late).toEqual([{ machine_id: 7, device_time: 5, reason: 'stale' }]);
    expect(db.telemetry).toHaveLength(0);
  });

  test('drain writes what is waiting, for a normal stop', async () => {
    const { db, journal, flusher } = setup();
    await flusher.start(); await flusher.stop();
    for (let t = 1; t <= 200; t++) journal.append(reading(7, t));
    expect(await flusher.drain(2000)).toBe(true);
    expect(db.telemetry).toHaveLength(200);
  });
});


test('alarm/meter operations survive DB outage and lost COMMIT reply exactly with their reading', async () => {
  const { db, journal, flusher } = setup();
  const base = reading(7, 1);
  base.a = { machineId: 7, companyId: 4, shiftId: 1, at: 1,
    opens: [{ alarm_code: 'SV0401', alarm_type: 'SV', alarm_severity: 'CRITICAL' }], closes: [] };
  base.m = { machineId: 7, companyId: 4, at: 1, reading: { kw_total: 12 } };
  journal.append(base);
  db.down = true;
  await expect(flusher.pass()).rejects.toThrow();
  expect(db.alarms).toHaveLength(0); expect(db.meters).toHaveLength(0);
  db.down = false; db.loseCommitReply = true;
  await expect(flusher.pass()).rejects.toThrow('COMMIT response lost');
  expect(db.alarms).toHaveLength(1); expect(db.meters).toHaveLength(1);
  await drainPasses(flusher);
  expect(db.telemetry).toHaveLength(1); expect(db.alarms).toHaveLength(1); expect(db.meters).toHaveLength(1);
  journal.close();
});


test('unallocatable gap provenance commits once and never adds unverified hourly parts', async () => {
  const { db, journal, flusher } = setup();
  const record = reading(7, 100);
  record.h = [];
  record.gap = { company_id: 4, machine_id: 7, from: 1, to: 100,
    unallocated_parts: 8, unallocated_energy: 1.5, reason: 'observations_missing' };
  journal.append(record); db.loseCommitReply = true;
  await expect(flusher.pass()).rejects.toThrow('COMMIT response lost');
  await drainPasses(flusher);
  expect(db.gaps).toHaveLength(1); expect(db.gaps[0][7]).toBe(8);
  expect(db.hourly.size).toBe(0); journal.close();
});
