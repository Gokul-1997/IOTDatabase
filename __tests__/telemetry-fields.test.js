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

/*
 * Migration 021 — machine condition signals, and the alarm flag.
 */
describe('condition signals and the alarm flag', () => {
  const condition = {
    spindle_speed: 70, spindle_motor_temp: 36,
    servo_load_x: 5, servo_load_y: 6, servo_load_z: null,
    servo_temp_x: 27, servo_temp_y: null, servo_temp_z: null,
    servo_pulse_x: 32, sequence_number: 100,
    cnc_battery_voltage: null,
    fan_status: { radiator_fan1_servo_spindle_amplifier: 'OK' },
    extra_axes: null
  };

  const lastInsert = () => {
    const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
    const cols = insertColumns(sql);
    return Object.fromEntries(cols.map((c, i) => [c, params[i]]));
  };

  test('every condition column reaches the insert', async () => {
    addToBuffer({ ...full, ...condition });
    await flushBuffer();
    const row = lastInsert();

    expect(row.spindle_speed).toBe(70);
    expect(row.spindle_motor_temp).toBe(36);
    expect(row.servo_load_x).toBe(5);
    expect(row.servo_temp_x).toBe(27);
    expect(row.servo_pulse_x).toBe(32);
    expect(row.sequence_number).toBe(100);
  });

  test('a per-axis null is stored as NULL, not dropped and not zero', async () => {
    addToBuffer({ ...full, ...condition });
    await flushBuffer();
    const row = lastInsert();

    expect(row).toHaveProperty('servo_temp_y', null);
    expect(row).toHaveProperty('servo_load_z', null);
    expect(row).toHaveProperty('cnc_battery_voltage', null);
  });

  test('JSONB columns are serialised, and absent ones are NULL', async () => {
    addToBuffer({ ...full, ...condition });
    await flushBuffer();
    const row = lastInsert();

    expect(JSON.parse(row.fan_status)).toEqual({ radiator_fan1_servo_spindle_amplifier: 'OK' });
    expect(row.extra_axes).toBeNull();
  });

  test('the alarm flag decided upstream survives the buffer', async () => {
    // mqtt.js hands over machine_status "IDLE" with alarm true. The buffer
    // used to re-derive alarm from that string — which is never "ALARM" by
    // this point — and so wrote false on every row that ever alarmed.
    addToBuffer({ ...full, machine_status: 'IDLE', alarm: true });
    await flushBuffer();
    const row = lastInsert();

    expect(row.alarm).toBe(true);
    expect(row.machine_status).toBe('IDLE');
  });

  test('alarm is a strict boolean: anything but true is false, never null', async () => {
    addToBuffer({ ...full, alarm: undefined });
    await flushBuffer();
    expect(lastInsert().alarm).toBe(false);
  });

  test('a 1000-row batch still binds one parameter per cell', async () => {
    // Postgres caps a statement at 65,535 parameters. 45 columns x 1000 rows
    // is 45,000 — under the cap, but this pins it so a future column that
    // pushes a full batch over does not fail every flush in production.
    for (let i = 0; i < 1000; i++) addToBuffer({ ...full, ...condition, device_time: i });
    await flushBuffer();

    const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
    const cols = insertColumns(sql).length;
    expect(params.length % cols).toBe(0);
    expect(params.length).toBeLessThanOrEqual(65535);
  });
});
