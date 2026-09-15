/*
 * One bad value must never stop telemetry for the whole plant.
 *
 * Production, 2026-09-15: one machine sent 42279658848 for an INTEGER column.
 * Postgres rejected the multi-row INSERT, the buffer requeued the batch at the
 * head, every new row joined that same batch, and nothing was written for any
 * machine — the log showed batchSize climbing 5, 10, 18, 21, 27, 31.
 */

import { jest } from '@jest/globals';

const query = jest.fn();
jest.unstable_mockModule('../db.js', () => ({ pool: { query } }));

const { addToBuffer, flushBuffer, getBufferStats, rowValues, TELEMETRY_COLUMNS, isDataError } =
  await import('../buffer.js');

const col = name => TELEMETRY_COLUMNS.indexOf(name);
const row = over => ({ company_id: 4, machine_id: 5, machine_status: 'RUN', device_time: 1, ...over });
const ok = async () => ({ rows: [], rowCount: 1 });
const dataError = (code = '22003') => Object.assign(new Error('value "42279658848" is out of range for type integer'), { code });
const rowsInCall = call => call[1].length / TELEMETRY_COLUMNS.length;

let warn, error;
beforeEach(async () => {
  warn  = jest.spyOn(console, 'warn').mockImplementation(() => {});
  error = jest.spyOn(console, 'error').mockImplementation(() => {});
  // drain anything a previous test left queued
  query.mockReset();
  query.mockImplementation(ok);
  await flushBuffer();
  query.mockClear();
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

describe('a batch the database rejects for bad data', () => {
  test('is retried row by row: good rows are written, only the bad one is dropped', async () => {
    const droppedBefore = getBufferStats().droppedTotal;
    query.mockImplementation(async (sql, params) => {
      // any statement containing the poisoned row fails, as Postgres would
      if (params.includes('POISON')) throw dataError('22001');
      return ok();
    });

    addToBuffer(row({ machine_id: 1, mode: 'AUTO' }));
    addToBuffer(row({ machine_id: 2, mode: 'POISON' }));
    addToBuffer(row({ machine_id: 3, mode: 'AUTO' }));
    await flushBuffer();

    const written = query.mock.calls.filter(c => !c[1].includes('POISON'));
    expect(written.map(c => c[1][col('machine_id')])).toEqual([1, 3]);
    expect(written.every(c => rowsInCall(c) === 1)).toBe(true);
    expect(getBufferStats().size).toBe(0);                          // not requeued
    expect(getBufferStats().droppedTotal).toBe(droppedBefore + 1);
    expect(error.mock.calls.some(c => c[0].includes('"machine_id":2'))).toBe(true);
  });

  test('the next flush is not blocked by it', async () => {
    query.mockImplementationOnce(async () => { throw dataError(); })   // whole batch
         .mockImplementationOnce(async () => { throw dataError(); })   // the single bad row
         .mockImplementation(ok);
    addToBuffer(row({ machine_id: 9 }));
    await flushBuffer();

    addToBuffer(row({ machine_id: 10 }));
    await flushBuffer();
    const last = query.mock.calls.at(-1);
    expect(rowsInCall(last)).toBe(1);
    expect(last[1][col('machine_id')]).toBe(10);
    expect(getBufferStats().size).toBe(0);
  });
});

describe('connection trouble still keeps the data', () => {
  test('a dropped connection requeues the whole batch, with no row-by-row attempts', async () => {
    query.mockImplementation(async () => { throw Object.assign(new Error('Connection terminated'), { code: '08006' }); });
    addToBuffer(row({ machine_id: 1 }));
    addToBuffer(row({ machine_id: 2 }));
    await flushBuffer();

    expect(query).toHaveBeenCalledTimes(1);
    expect(getBufferStats().size).toBe(2);
  });

  test('a connection lost part-way through the row-by-row pass requeues only the unwritten rows', async () => {
    query.mockImplementationOnce(async () => { throw dataError(); })            // batch of 3 rejected
         .mockImplementationOnce(ok)                                             // row 1 written
         .mockImplementationOnce(async () => { throw Object.assign(new Error('reset'), { code: '08006' }); });
    addToBuffer(row({ machine_id: 1 }));
    addToBuffer(row({ machine_id: 2 }));
    addToBuffer(row({ machine_id: 3 }));
    await flushBuffer();

    expect(getBufferStats().size).toBe(2);   // rows 2 and 3, not row 1 again
  });
});

test('isDataError: classes 22 and 23 are row problems; everything else is retried', () => {
  expect(isDataError({ code: '22003' })).toBe(true);
  expect(isDataError({ code: '23502' })).toBe(true);
  expect(isDataError({ code: '08006' })).toBe(false);
  expect(isDataError({ code: '42501' })).toBe(false);
  expect(isDataError(new Error('no code'))).toBe(false);
  expect(isDataError(null)).toBe(false);
});
