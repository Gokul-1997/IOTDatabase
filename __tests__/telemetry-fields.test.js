/*
 * The collector must persist every column telemetry_raw has.
 *
 * Four columns — program_number, total_run_time, total_cutting_time and
 * run_time — existed in the table and in the INSERT, but were never passed
 * from the message handler, so buffer.js wrote NULL for them on every one
 * of roughly 450,000 rows a day. A device sending them had them silently
 * discarded, which made "the device does not send it" and "we throw it
 * away" impossible to tell apart by looking at the database.
 *
 * These tests pin the mapping so that cannot happen again quietly: a
 * column added to the INSERT without being passed from the handler now
 * fails here rather than filling with nulls in production.
 */

import { jest } from '@jest/globals';

const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
jest.unstable_mockModule('../db.js', () => ({ pool: { query } }));

const { addToBuffer, flushBuffer } = await import("../buffer.js");

/** The columns the INSERT names, in order. */
function insertColumns(sql) {
  const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')'));
  return cols.split(',').map(s => s.trim()).filter(Boolean);
}

const full = {
  plant_id: 1, company_id: 4, machine_id: 5,
  machine_status: 'RUN', alarm: false, status: 3,
  parts_count: 100, spindle_load: 42.5, feed_rate: 1200, cutting_speed: 180,
  total_run_time: 99999, total_cutting_time: 88888, run_time: 3600,
  program_number: 1234, device_time: 1789025229, mode: 'AUTO',
  energy: 12.34, voltage: 415.2, current: 18.6, power: 7.7
};

beforeEach(() => query.mockClear());

test('every value handed to the buffer reaches the insert', async () => {
  addToBuffer({ ...full });
  await flushBuffer();

  expect(query).toHaveBeenCalled();
  const [sql, params] = query.mock.calls[0];
  const cols = insertColumns(sql);

  // one parameter per column, no silent truncation
  expect(params.length).toBe(cols.length);

  const byName = Object.fromEntries(cols.map((c, i) => [c, params[i]]));

  // the four that were being dropped
  expect(byName.program_number).toBe(1234);
  expect(byName.total_run_time).toBe(99999);
  expect(byName.total_cutting_time).toBe(88888);
  expect(byName.run_time).toBe(3600);

  // the three added for the energy dashboard
  expect(byName.voltage).toBe(415.2);
  expect(byName.current).toBe(18.6);
  expect(byName.power).toBe(7.7);

  // and the ones that always worked
  expect(byName.parts_count).toBe(100);
  expect(byName.energy).toBe(12.34);
  expect(byName.mode).toBe('AUTO');
});

test('a field the device does not send is stored as NULL, never as undefined', async () => {
  // undefined reaches node-postgres as a missing parameter and fails the
  // whole batch — which would drop telemetry for every machine in it
  addToBuffer({ company_id: 4, machine_id: 5, machine_status: 'RUN', device_time: 1 });
  await flushBuffer();

  const [, params] = query.mock.calls[0];
  expect(params.every(p => p !== undefined)).toBe(true);
});

test('the insert names exactly as many columns as the batch supplies', async () => {
  addToBuffer({ ...full });
  await flushBuffer();

  const [sql, params] = query.mock.calls[0];
  // a column added to the INSERT without a matching value would shift every
  // later column by one and write data into the wrong fields
  expect(insertColumns(sql).length).toBe(params.length);
});
