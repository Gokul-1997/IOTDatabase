import { createMessageProcessor } from '../src/lib/message-processor.js';
import { shiftAt } from '../src/lib/shifts.js';
import { sumSlices } from '../src/lib/hourly.js';

const start = Date.parse('2026-10-27T07:59:50+05:30') / 1000;
const shifts = [{ id: 1, start: 0, end: 28800 }, { id: 2, start: 28800, end: 86399 }];

function fixture() {
  const records = [];
  const processor = createMessageProcessor({
    journal: { append: record => { records.push(record); return records.length; }, syncThrough: async () => {} },
    lookupMachine: async () => ({ id: 7, company_id: 4 }), hydrate: async () => null,
    shifts: { shiftFor: (_company, at) => shiftAt(shifts, at), shiftsOf: () => shifts }
  });
  const send = (offset, energy, parts = 100) => processor.handleMessage('device', {
    time: start + offset, machine_status: 'RUN', mode: 'AUTO', parts_count: parts, energy
  }, (start + offset) * 1000);
  return { records, processor, send };
}

const hourly = records => sumSlices(records.flatMap(record => record.h));
const total = (records, key) => hourly(records).reduce((sum, row) => sum + row[key], 0);

test.each([0, null, undefined, 'meter unavailable'])('dropped meter value %j allocates a short recovery over its real meter interval', async missing => {
  const { records, send } = fixture();
  await send(0, 100);
  await send(12, missing, 101);
  await send(24, 101, 102);
  const rows = hourly(records);
  expect(rows.find(row => row.shift_id === 1).energy).toBeCloseTo(10 / 24);
  expect(rows.find(row => row.shift_id === 2).energy).toBeCloseTo(14 / 24);
  expect(total(records, 'energy')).toBeCloseTo(1);
  expect(total(records, 'run')).toBe(24);
  expect(total(records, 'produced')).toBe(2);
  expect(records.every(record => !record.gap)).toBe(true);
});

test('continuous machine observations with a long missing-meter interval preserve unallocated energy once', async () => {
  const { records, processor, send } = fixture();
  await send(0, 100);
  await send(30, 0, 101);
  await send(60, null, 102);
  await send(90, 101, 103);
  await send(90, 101, 103); // broker replay
  expect(records).toHaveLength(4);
  expect(total(records, 'run')).toBe(90);
  expect(total(records, 'produced')).toBe(3);
  expect(total(records, 'energy')).toBe(0);
  expect(records.filter(record => record.gap)).toHaveLength(1);
  expect(records[3].gap).toMatchObject({ from: start, to: start + 90,
    known_state_seconds: 0, unallocated_parts: 0, unallocated_energy: 1 });
  expect(processor.state(7).unallocated_energy).toBe(1);
  await send(102, 101.2, 104);
  expect(total(records, 'energy')).toBeCloseTo(0.2);
  expect(processor.state(7).unallocated_energy).toBe(1);
});

test('a telemetry outage retains one combined gap and never duplicates runtime or energy allocation', async () => {
  const { records, send } = fixture();
  await send(0, 100);
  await send(90, 101, 101);
  await send(90, 101, 101);
  expect(records).toHaveLength(2);
  expect(records[1].gap).toMatchObject({ from: start, to: start + 90,
    known_state_seconds: 60, unallocated_parts: 1, unallocated_energy: 1 });
  expect(total(records, 'run')).toBe(60);
  expect(total(records, 'produced')).toBe(0);
  expect(total(records, 'energy')).toBe(0);
});

test('a distinct same-second meter increase counts once without inventing runtime', async () => {
  const { records, send } = fixture();
  await send(0, 100);
  await send(0, 101);
  await send(0, 101);
  expect(records).toHaveLength(2);
  expect(total(records, 'energy')).toBe(1);
  expect(total(records, 'run')).toBe(0);
  expect(total(records, 'idle')).toBe(0);
  await send(12, 102, 101);
  expect(total(records, 'energy')).toBe(2);
  expect(total(records, 'run')).toBe(12);
  expect(total(records, 'produced')).toBe(1);
});

test.each(['-101 kWh', 'error101', '1.2.3', '1e999', true, []])('invalid meter %j never corrupts the counter baseline or consumption', async invalid => {
  const { records, processor, send } = fixture();
  await send(0, 100);
  await send(12, invalid);
  expect(records[1].r.energy).toBeNull();
  expect(processor.state(7).energy_meter).toBe(100);
  await send(24, 101);
  expect(total(records, 'energy')).toBeCloseTo(1);
});

test('small legitimate meter steps survive hourly slicing and batch summation', async () => {
  const { records, send } = fixture();
  await send(0, 100);
  for (let i = 1; i <= 12; i++) await send(i, 100 + i * 0.00001);
  expect(total(records, 'energy')).toBeCloseTo(0.00012, 10);
  expect(total(records, 'run')).toBe(12);
});
