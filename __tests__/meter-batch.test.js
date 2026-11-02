import { meterInsertBatches, METER_BATCH_INSERT_SQL, METER_BATCH_MAX_ROWS, METER_INSERT_SQL } from '../src/lib/meter-writer.js';
import { METER_FIELDS } from '../src/lib/power-signals.js';

const meter = (reading, extra = {}) => ({ machineId: 7, companyId: 4, at: 1793127205, reading, ...extra });
const unpack = batch => batch.values[0].map((_, row) => Object.fromEntries([
  ['machineId', batch.values[0][row]], ['companyId', batch.values[1][row]], ['at', batch.values[2][row]],
  ['reading', Object.fromEntries(METER_FIELDS.map(([column], index) => [column, batch.values[index + 3][row]]))],
  ['standaloneFields', JSON.parse(batch.values.at(-2)[row])], ['standalone', batch.values.at(-1)[row]]
]));

test('three same-second observations become one sparse row with zero and field-level standalone precedence', () => {
  const batches = [...meterInsertBatches([
    meter({ kw_total: -1, i_avg: 2, kwh_total: 3104 }),
    meter({ kw_total: 0 }, { standalone: true }),
    meter({ kw_total: 8, i_avg: 3, frequency_hz: 50 })
  ])];
  expect(batches).toHaveLength(1);
  expect(unpack(batches[0])).toEqual([expect.objectContaining({
    reading: expect.objectContaining({ kw_total: 0, i_avg: 3, kwh_total: 3104, frequency_hz: 50, v1n: null }),
    standaloneFields: ['kw_total'], standalone: true
  })]);
});

test('a later standalone observation may replace an earlier standalone value', () => {
  const [batch] = [...meterInsertBatches([
    meter({ kw_total: 1 }, { standalone: true }), meter({ kw_total: 2 }, { standalone: true })
  ])];
  expect(unpack(batch)[0].reading.kw_total).toBe(2);
});

test('same-key tenant changes stay in separate statements, including a return to the first tenant', () => {
  const batches = [...meterInsertBatches([4, 5, 4, null].map((companyId, index) =>
    meter({ kwh_total: index }, { companyId })))];
  expect(batches.map(batch => unpack(batch).map(row => row.companyId))).toEqual([[4], [5], [4], [null]]);
  for (const batch of batches) expect(batch.text).toContain(
    'WHERE energy_meter_readings.company_id IS NOT DISTINCT FROM EXCLUDED.company_id');
});

test('bind count remains constant for 2,501 full observations and each batch is bounded', () => {
  const fields = Object.fromEntries(METER_FIELDS.map(([column], index) => [column, index]));
  const batches = [...meterInsertBatches(Array.from({ length: 2501 }, (_, index) =>
    meter(fields, { at: 1793127205 + index, standalone: index % 2 === 0 })))];
  expect(batches.map(batch => batch.rowCount)).toEqual([METER_BATCH_MAX_ROWS, METER_BATCH_MAX_ROWS, 501]);
  for (const batch of batches) {
    expect(batch.text).toBe(METER_BATCH_INSERT_SQL);
    expect(batch.values).toHaveLength(5 + METER_FIELDS.length);
    expect(batch.values.every(column => column.length === batch.rowCount)).toBe(true);
    const highest = Math.max(...[...batch.text.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
    expect(highest).toBe(batch.values.length);
    expect(batch.values.length).toBeLessThan(100);
  }
});

test('empty observations do not generate a query and invalid bounds fail before writing', () => {
  expect([...meterInsertBatches([])]).toEqual([]);
  for (const bound of [0, -1, 1.5, 1001, Infinity]) expect(() => [...meterInsertBatches([], bound)]).toThrow(RangeError);
});

test('batch and legacy writers use the identical guarded database merge', () => {
  const conflict = sql => sql.slice(sql.indexOf('ON CONFLICT'));
  expect(conflict(METER_BATCH_INSERT_SQL)).toBe(conflict(METER_INSERT_SQL));
});

test('every batch has at most one row per conflict key even when a key repeats across the row limit', () => {
  const observations = [meter({ kw_total: 1 }), meter({ i_avg: 2 }, { machineId: 8 }),
    meter({ kw_total: 3 }, { machineId: 9 }), meter({ kw_total: 4 }), meter({ frequency_hz: 50 })];
  const batches = [...meterInsertBatches(observations, 2)];
  expect(batches.map(batch => batch.rowCount)).toEqual([2, 2]);
  expect(unpack(batches[1])[1].reading).toMatchObject({ kw_total: 4, frequency_hz: 50 });
  for (const batch of batches) {
    const keys = unpack(batch).map(row => `${row.machineId}|${row.at}`);
    expect(new Set(keys).size).toBe(keys.length);
  }
});
