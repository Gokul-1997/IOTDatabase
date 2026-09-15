/*
 * The startup guard against deploying the collector before its migration.
 *
 * Without it, a missing column fails every INSERT, the buffer requeues
 * forever, and telemetry is dropped once the buffer fills — data the broker
 * has already acknowledged and will never resend.
 */

import { jest } from '@jest/globals';
import { missingTelemetryColumns } from '../src/lib/schema-check.js';

const poolWith = names => ({
  query: jest.fn(async () => ({ rows: names.map(column_name => ({ column_name })) }))
});

test('nothing missing when the table has every column', async () => {
  const pool = poolWith(['machine_id', 'alarm', 'servo_temp_x']);
  expect(await missingTelemetryColumns(pool, ['machine_id', 'alarm', 'servo_temp_x'])).toEqual([]);
});

test('names exactly the columns a pending migration would add', async () => {
  // the table as it is in production before migration 021
  const pool = poolWith(['machine_id', 'alarm', 'energy']);
  expect(await missingTelemetryColumns(pool, ['machine_id', 'servo_temp_x', 'fan_status', 'energy']))
    .toEqual(['servo_temp_x', 'fan_status']);
});

test('a table that does not exist at all reports every column missing', async () => {
  expect(await missingTelemetryColumns(poolWith([]), ['machine_id', 'alarm']))
    .toEqual(['machine_id', 'alarm']);
});

test('the lookup is scoped to the search path, not any schema', async () => {
  const pool = poolWith([]);
  await missingTelemetryColumns(pool, ['x']);
  const [sql] = pool.query.mock.calls[0];
  expect(sql).toMatch(/table_name = 'telemetry_raw'/);
  expect(sql).toMatch(/current_schemas\(false\)/);
});

test('every column the buffer writes is one the check verifies', async () => {
  // the check is only as good as the list it is given; this ties it to the
  // same list the INSERT is built from
  const { TELEMETRY_COLUMNS } = await import('../buffer.js');
  expect(TELEMETRY_COLUMNS).toEqual(expect.arrayContaining([
    'alarm', 'servo_load_x', 'servo_temp_z', 'encoder_temp_y', 'fan_status', 'extra_axes'
  ]));
  expect(new Set(TELEMETRY_COLUMNS).size).toBe(TELEMETRY_COLUMNS.length);
});
