/*
 * One bad value must never stop telemetry for the whole plant.
 *
 * Production, 2026-09-15: one machine sent 42279658848 for an INTEGER column.
 * Postgres rejected the multi-row INSERT, the buffer requeued the batch at the
 * head, every new row joined that same batch, and nothing was written for any
 * machine — the log showed batchSize climbing 5, 10, 18, 21, 27, 31.
 */

import { jest } from '@jest/globals';
import { rowValues, TELEMETRY_COLUMNS, isDataError } from '../buffer.js';

const col = name => TELEMETRY_COLUMNS.indexOf(name);
const row = over => ({ company_id: 4, machine_id: 5, machine_status: 'RUN', device_time: 1, ...over });
let warn, error;
beforeEach(() => {
  warn  = jest.spyOn(console, 'warn').mockImplementation(() => {});
  error = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });

describe('integer columns never receive a value that does not fit', () => {
  test('the value from production is stored as NULL, wherever it lands', () => {
    for (const c of ['spindle_speed', 'sequence_number', 'parts_count', 'run_time', 'program_number']) {
      expect(rowValues(row({ [c]: 42279658848 }))[col(c)]).toBeNull();
    }
  });

  test('the neighbouring values in the row are untouched', () => {
    const v = rowValues(row({ sequence_number: 42279658848, spindle_speed: 2000, parts_count: 33 }));
    expect(v[col('spindle_speed')]).toBe(2000);
    expect(v[col('parts_count')]).toBe(33);
    expect(v[col('machine_id')]).toBe(5);
  });

  test('the edges of each range are kept', () => {
    expect(rowValues(row({ parts_count: 2147483647 }))[col('parts_count')]).toBe(2147483647);
    expect(rowValues(row({ parts_count: 2147483648 }))[col('parts_count')]).toBeNull();
    expect(rowValues(row({ status: 32767 }))[col('status')]).toBe(32767);
    expect(rowValues(row({ status: 40000 }))[col('status')]).toBeNull();   // smallint
  });

  test('bigint counters keep large values an integer column could not', () => {
    expect(rowValues(row({ total_cutting_time: 42279658848 }))[col('total_cutting_time')]).toBe(42279658848);
  });

  test('numeric strings are read, fractions truncated, junk is NULL', () => {
    const v = rowValues(row({ status: '4', run_time: 12.7, program_number: 'O1083' }));
    expect(v[col('status')]).toBe(4);
    expect(v[col('run_time')]).toBe(12);
    expect(v[col('program_number')]).toBeNull();
  });

  test('says which machine and column, once, so the sender can be fixed', () => {
    rowValues(row({ machine_id: 77, sequence_number: 42279658848 }));
    rowValues(row({ machine_id: 77, sequence_number: 42279658848 }));
    const lines = warn.mock.calls.map(c => c[0]).filter(l => l.includes('"machine_id":77'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"column":"sequence_number"');
  });
});

/* What happens to a batch the database refuses — row-by-row isolation,
   retry after a dropped connection — is now the writer's job, tested in
   journal-flusher.test.js. */

test('isDataError: classes 22 and 23 are row problems; everything else is retried', () => {
  expect(isDataError({ code: '22003' })).toBe(true);
  expect(isDataError({ code: '23502' })).toBe(true);
  expect(isDataError({ code: '08006' })).toBe(false);
  expect(isDataError({ code: '42501' })).toBe(false);
  expect(isDataError(new Error('no code'))).toBe(false);
  expect(isDataError(null)).toBe(false);
});
