// Disposable Unix-socket-only PostgreSQL cluster. Never loads .env or contacts configured services.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';
import { createJournal } from '../src/lib/journal.js';
import { createFlusher } from '../src/lib/flusher.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
import { telemetryInsert, TELEMETRY_COLUMNS } from '../buffer.js';
import { METER_FIELDS } from '../src/lib/power-signals.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cnc-pg-ingest-'));
const binary = name => ['/opt/homebrew/bin', '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/bin']
  .map(dir => path.join(dir, name)).find(file => fs.existsSync(file));
assert.ok(binary('initdb') && binary('postgres'), 'Local PostgreSQL binaries required');
let server, pool, journal;
try {
  const data = path.join(directory, 'data');
  const initialization = spawnSync(binary('initdb'), ['-D', data, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
  assert.equal(initialization.status, 0, initialization.stderr);
  server = spawn(binary('postgres'), ['-D', data, '-k', directory, '-p', '5432', '-c', 'listen_addresses='], { stdio: 'ignore' });
  pool = new pg.Pool({ host: directory, port: 5432, user: os.userInfo().username, database: 'postgres', max: 4 });
  const until = Date.now() + 10_000;
  while (true) {
    try { await pool.query('SELECT 1'); break; }
    catch (error) { if (Date.now() > until) throw error; await new Promise(r => setTimeout(r, 50)); }
  }
  const json = new Set(['fan_status', 'extra_axes', 'apc_battery_status']);
  const text = new Set(['machine_status', 'mode']);
  await pool.query(`CREATE TABLE telemetry_raw (${TELEMETRY_COLUMNS.map(column =>
    `${column} ${column === 'received_at' ? 'timestamptz' : column === 'alarm' ? 'boolean' : json.has(column) ? 'jsonb' : text.has(column) ? 'text' : 'double precision'}`).join(',')});
    CREATE TABLE machines(id int PRIMARY KEY,company_id int NOT NULL, UNIQUE(company_id,id));
    INSERT INTO machines VALUES(7,4);
    CREATE TABLE telemetry_late(machine_id int, company_id int, device_time bigint, received_at timestamptz, reason text, payload jsonb);
    CREATE TABLE production_hourly(company_id int, machine_id int, shift_id int, hour_start timestamptz,
      run_seconds int, idle_seconds int, manual_seconds int, produced_qty int, energy_kwh double precision,
      PRIMARY KEY(machine_id, shift_id, hour_start));
    CREATE TABLE ingest_checkpoint(collector_id text PRIMARY KEY, last_seq bigint NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE machine_alarms(id bigserial PRIMARY KEY, company_id int, machine_id int, shift_id int,
      alarm_type text, alarm_code text, severity text, message text, started_at timestamptz, created_at timestamptz, ended_at timestamptz);
    CREATE UNIQUE INDEX alarm_open ON machine_alarms(machine_id, COALESCE(alarm_code, alarm_type)) WHERE ended_at IS NULL;
    CREATE TABLE energy_meter_readings(machine_id int, company_id int, read_at timestamptz,
      ${METER_FIELDS.map(([column]) => `${column} double precision`).join(',')}, PRIMARY KEY(machine_id,read_at));`);
  const migration = fs.readFileSync(new URL('../../Backend/src/migrations/043_ingest_gaps.sql', import.meta.url), 'utf8');
  await pool.query('CREATE ROLE machine_api_user NOLOGIN');
  await pool.query(migration); await pool.query(migration); // additive/idempotent
  const rights = (await pool.query(`SELECT has_table_privilege('machine_api_user','ingest_gaps','SELECT') AS can_read,
    has_table_privilege('machine_api_user','ingest_gaps','INSERT') AS can_insert,
    has_table_privilege('machine_api_user','ingest_gaps','UPDATE') AS can_update,
    has_table_privilege('machine_api_user','ingest_gaps','DELETE') AS can_delete`)).rows[0];
  assert.deepEqual(rights, { can_read: true, can_insert: true, can_update: false, can_delete: false });
  journal = createJournal({ dir: path.join(directory, 'journal') }); journal.open();
  const shifts = { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] };
  const machine = { id: 7, company_id: 4 };
  const processor = createMessageProcessor({ journal, shifts, lookupMachine: async () => machine,
    hydrate: async () => null, redis: { isReady: false } });
  const now = Date.now(), time = Math.floor(now / 1000);
  await processor.handleMessage('device', { time: time - 2, machine_status: 'RUN', parts_count: 100 }, now);
  let down = true, loseCommitReply = true;
  const unreliablePool = { connect: async () => {
    if (down) throw new Error('simulated outage');
    const client = await pool.connect();
    return { release: error => client.release(error), query: async (sql, values) => {
      const result = await client.query(sql, values);
      if (sql === 'COMMIT' && loseCommitReply) { loseCommitReply = false; throw new Error('lost COMMIT response'); }
      return result;
    } };
  } };
  const flusher = createFlusher({ pool: unreliablePool, journal, collectorId: 'isolated-test', telemetryInsert });
  await assert.rejects(flusher.pass(), /outage/);
  await processor.handleMessage('device', { time: time - 1, machine_status: 'STOP', parts_count: 101,
    stat_alarm: 1, pmc_alarm: { alarms: [{ code: 'SV0401', type: 'SV', severity: 'CRITICAL' }] },
    powerdata: { total_kw: 12, total_active_energy_kwh: 120 } }, now);
  await processor.handleMessage('device', { time, machine_status: 'RUN', parts_count: 102 }, now);
  down = false;
  await assert.rejects(flusher.pass(), /lost COMMIT response/);
  await flusher.pass();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM telemetry_raw')).rows[0].n, 3);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM energy_meter_readings')).rows[0].n, 1);
  const alarm = (await pool.query('SELECT * FROM machine_alarms')).rows;
  assert.equal(alarm.length, 1); assert.equal(alarm[0].alarm_code, 'SV0401'); assert.ok(alarm[0].ended_at);
  assert.equal((await pool.query('SELECT sum(produced_qty)::int AS n FROM production_hourly')).rows[0].n, 2);
  assert.equal(journal.stats().pending, 0);
  // Reconnect across a day: preserve provenance; no inferred shift allocation.
  await processor.handleMessage('device', { time: time + 86400, machine_status: 'RUN', parts_count: 110 }, now + 86400_000);
  await flusher.pass();
  const gap = (await pool.query('SELECT * FROM ingest_gaps')).rows[0];
  assert.equal(gap.unallocated_parts, 8); assert.equal(Number(gap.gap_seconds), 86400);
  assert.equal((await pool.query('SELECT sum(produced_qty)::int AS n FROM production_hourly')).rows[0].n, 2);
  await assert.rejects(pool.query(`INSERT INTO ingest_gaps SELECT collector_id || '-foreign',journal_seq,99,machine_id,
    last_observed_at,resumed_at,gap_seconds,known_state_seconds,unallocated_parts,unallocated_energy_kwh,reason,received_at FROM ingest_gaps`),
  error => error.code === '23503');
  console.log('PASS disposable PostgreSQL: raw + hourly + alarm open/close + meter commit exactly once through Redis outage, DB outage and lost COMMIT reply; 043 gap provenance, tenant integrity and collector grants.');
} finally {
  journal?.close();
  await pool?.end();
  if (server) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
