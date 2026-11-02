// Uses a transaction-local temporary table only. Never reads .env or application
// connection settings. Pass an explicit loopback test URL to run this directly.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { METER_FIELDS } from '../src/lib/power-signals.js';
import { METER_INSERT_SQL, meterInsertBatches } from '../src/lib/meter-writer.js';

export async function verifyMeterBatches(client) {
  const types = METER_FIELDS.map(([column]) => column === 'aux_interrupts' ? 'integer' :
    /^(?:kwh_|kvarh_|kvah_|run_hours$)/.test(column) ? 'double precision' : 'real');
  await client.query('BEGIN');
  try {
    await client.query(`CREATE TEMP TABLE energy_meter_readings (
      machine_id integer NOT NULL, company_id integer, read_at timestamptz NOT NULL,
      ${METER_FIELDS.map(([column], index) => `${column} ${types[index]}`).join(',')},
      standalone_fields text[] NOT NULL DEFAULT '{}', standalone boolean NOT NULL DEFAULT false,
      PRIMARY KEY(machine_id,read_at)) ON COMMIT DROP`);
    // Resolve the actual writer's unqualified table name only to our temporary
    // table. The public schema cannot be written by this verification.
    await client.query('SET LOCAL search_path=pg_temp');
    const epoch = 1793127205;
    const observation = (reading, extra = {}) => ({ machineId: 7, companyId: 4,
      at: epoch, reading, standalone: false, ...extra });
    const seed = [observation({ kw_total: -1.25, kwh_total: 3104 }, { standalone: true }),
      observation({ i_avg: 2 }, { machineId: 8, companyId: 6 })];
    const observations = [
      observation({ kw_total: 999, frequency_hz: 50 }),
      observation({ i_avg: 0 }, { standalone: true }),
      observation({ kw_total: 0 }, { standalone: true }),
      observation({ kw_total: 99, i_avg: 99 }),
      // A conflicting tenant must not replace an existing tenant's values.
      observation({ i_avg: 999 }, { machineId: 8, companyId: 5 }),
      observation({ i_avg: 3 }, { machineId: 8, companyId: 6 }),
      observation({ i_avg: 888 }, { machineId: 8, companyId: 5 }),
    ];
    let random = 62913;
    const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
    for (let index = 0; index < 400; index++) {
      const column = METER_FIELDS[next() % METER_FIELDS.length][0];
      observations.push(observation({ [column]: next() % 1000 }, {
        machineId: 20 + next() % 6, companyId: next() % 3 === 0 ? 5 : 4,
        at: epoch + next() % 17, standalone: next() % 3 === 0 }));
    }
    // Boundaries must not change semantics when more than 1,000 keys arrive.
    for (let index = 0; index < 1001; index++) observations.push(observation(
      Object.fromEntries(METER_FIELDS.map(([column], columnIndex) => [column,
        column === 'aux_interrupts' ? index : index + columnIndex / 10])),
      { at: epoch + 100 + index, standalone: index % 2 === 0 }));

    const insertOne = row => client.query(METER_INSERT_SQL, [row.machineId, row.companyId,
      row.at, ...METER_FIELDS.map(([column]) => row.reading[column] ?? null),
      row.standalone ? METER_FIELDS.filter(([column]) => row.reading[column] != null).map(([column]) => column) : [],
      row.standalone === true]);
    const snapshot = async () => (await client.query(`SELECT machine_id,company_id,read_at,
      ${METER_FIELDS.map(([column]) => column).join(',')},
      ARRAY(SELECT unnest(standalone_fields) ORDER BY 1) AS standalone_fields,standalone
      FROM pg_temp.energy_meter_readings ORDER BY machine_id,read_at`)).rows;
    for (const row of seed) await insertOne(row);
    const legacyStart = performance.now();
    for (const row of observations) await insertOne(row);
    const legacyMs = performance.now() - legacyStart;
    const expected = await snapshot();
    await client.query('TRUNCATE pg_temp.energy_meter_readings');
    for (const row of seed) await insertOne(row);
    const batches = [...meterInsertBatches(observations)];
    const batchStart = performance.now();
    for (const batch of batches) await client.query(batch.text, batch.values);
    const batchMs = performance.now() - batchStart;
    const actual = await snapshot();
    assert.deepEqual(actual, expected, 'Batched rows must equal sequential guarded UPSERTs');
    const existing = actual.find(row => row.machine_id === 7 && row.read_at.getTime() === epoch * 1000);
    assert.equal(existing.kw_total, 0);
    assert.equal(existing.i_avg, 0);
    assert.equal(existing.frequency_hz, 50);
    assert.equal(actual.find(row => row.machine_id === 8).company_id, 6);
    return { observations: observations.length, finalRows: actual.length,
      sequentialQueries: observations.length, batchQueries: batches.length,
      maxBatchRows: Math.max(...batches.map(batch => batch.rowCount)),
      bindParameters: batches[0].values.length,
      sequentialMs: Math.round(legacyMs * 100) / 100, batchMs: Math.round(batchMs * 100) / 100 };
  } finally {
    await client.query('ROLLBACK');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.METER_BATCH_TEST_URL;
  assert.ok(connectionString, 'Set METER_BATCH_TEST_URL to an explicit disposable loopback PostgreSQL URL');
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only loopback test databases are allowed');
  assert.equal(url.search, '', 'Connection URL overrides are not allowed');
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, application_name: 'collector-meter-batch-verification' });
  try {
    await client.connect();
    console.log(JSON.stringify({ result: 'PASS', ...(await verifyMeterBatches(client)) }));
  } finally { await client.end(); }
}
