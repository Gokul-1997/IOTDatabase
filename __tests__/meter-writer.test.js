/*
 * Sparse energy-meter readings: every observation reaches storage, and
 * switched off cleanly — never in telemetry's way — when the table is not
 * there yet or the ingestion user may not write it.
 */

import { jest } from '@jest/globals';
import { createMeterWriter, METER_INSERT_SQL } from '../src/lib/meter-writer.js';
import { METER_FIELDS } from '../src/lib/power-signals.js';

const reading = Object.fromEntries(METER_FIELDS.map(([c], i) => [c, i + 0.5]));
const err = code => Object.assign(new Error('nope'), { code });

function setup(queryImpl = async () => ({ rowCount: 1 })) {
  const pool = { query: jest.fn(queryImpl) };
  const log = jest.fn();
  const record = createMeterWriter({ pool, log });
  return { pool, log, record };
}

test('writes every column, binding exactly the parameters it references', async () => {
  const { pool, record } = setup();
  await record({ machineId: 15, companyId: 4, at: 1791027611, reading });
  const [sql, params] = pool.query.mock.calls[0];
  const highest = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
  expect(params.length).toBe(highest);
  expect(params.length).toBe(5 + METER_FIELDS.length);
  expect(params.slice(0, 3)).toEqual([15, 4, 1791027611]);
  expect(params[3 + METER_FIELDS.findIndex(([c]) => c === 'kwh_total')]).toBe(reading.kwh_total);
  expect(params.at(-1)).toBe(false);
  expect(sql).toMatch(/to_timestamp\(\$3\)/);
  expect(sql).toMatch(/ON CONFLICT \(machine_id, read_at\) DO UPDATE SET/);
  expect(sql).toContain('WHERE energy_meter_readings.company_id IS NOT DISTINCT FROM EXCLUDED.company_id');
  expect(sql).toContain('standalone = energy_meter_readings.standalone OR EXCLUDED.standalone');
  for (const [column] of METER_FIELDS) {
    expect(sql).toContain(`COALESCE(EXCLUDED.${column}, energy_meter_readings.${column})`);
  }
});

test('the INSERT names every meter column once, in the table\'s order', () => {
  const cols = METER_INSERT_SQL.slice(METER_INSERT_SQL.indexOf('(') + 1, METER_INSERT_SQL.indexOf(')'))
    .split(',').map(s => s.trim());
  expect(cols).toEqual(['machine_id', 'company_id', 'read_at', ...METER_FIELDS.map(([c]) => c), 'standalone_fields', 'standalone']);
});

test('every sparse observation is written, including independent fields in the same second', async () => {
  const { pool, record } = setup();
  await record({ machineId: 15, companyId: 4, at: 1000, reading: { kw_total: 2 } });
  await record({ machineId: 15, companyId: 4, at: 1000, reading: { i_avg: 0 } });
  await record({ machineId: 15, companyId: 4, at: 1001, reading: { kwh_total: 3104 } });
  expect(pool.query.mock.calls.map(c => c[1][2])).toEqual([1000, 1000, 1001]);
  const index = field => 3 + METER_FIELDS.findIndex(([column]) => column === field);
  expect(pool.query.mock.calls[0][1][index('kw_total')]).toBe(2);
  expect(pool.query.mock.calls[0][1][index('i_avg')]).toBeNull();
  expect(pool.query.mock.calls[1][1][index('i_avg')]).toBe(0);
  expect(pool.query.mock.calls[1][1][index('kw_total')]).toBeNull();
  expect(pool.query.mock.calls[2][1][index('kwh_total')]).toBe(3104);
});

test('each machine has its own clock', async () => {
  const { pool, record } = setup();
  await record({ machineId: 15, companyId: 4, at: 1000, reading });
  await record({ machineId: 16, companyId: 4, at: 1001, reading });
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test('a device clock set back by more than an hour starts over instead of going quiet', async () => {
  const { pool, record } = setup();
  await record({ machineId: 15, companyId: 4, at: 100_000, reading });
  await record({ machineId: 15, companyId: 4, at: 100_000 - 7200, reading });
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test('no reading, no write', async () => {
  const { pool, record } = setup();
  await record({ machineId: 15, companyId: 4, at: 1000, reading: null });
  await record({ machineId: 15, companyId: 4, at: NaN, reading });
  expect(pool.query).not.toHaveBeenCalled();
});

test.each([
  ['42P01', /run the Backend migrations/],
  ['42501', /run the Backend sparse-energy migration/]
])('%s switches meter writes off with one line saying how to fix it', async (code, fix) => {
  const { pool, log, record } = setup(async () => { throw err(code); });
  await record({ machineId: 15, companyId: 4, at: 1000, reading });
  await record({ machineId: 15, companyId: 4, at: 2000, reading });
  await record({ machineId: 16, companyId: 4, at: 2000, reading });
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][1]).toMatch(fix);
  expect(log.mock.calls[0][1]).toMatch(/Telemetry, energy totals and alarms are unaffected/);
});

test('any other failure is thrown for the caller to log, and the next reading still tries', async () => {
  let fail = true;
  const { pool, record } = setup(async () => { if (fail) throw err('08006'); return { rowCount: 1 }; });
  await expect(record({ machineId: 15, companyId: 4, at: 1000, reading })).rejects.toThrow('nope');
  fail = false;
  await record({ machineId: 15, companyId: 4, at: 1000, reading });
  expect(pool.query).toHaveBeenCalledTimes(2);
});
