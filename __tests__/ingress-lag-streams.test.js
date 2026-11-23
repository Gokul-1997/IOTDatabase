import { jest } from '@jest/globals';
import { createLagTracker } from '../src/lib/ingress-lag.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';

const start = Date.parse('2026-11-23T14:40:00.500Z');
function processor(ingressLag) {
  let sequence = 0;
  return createMessageProcessor({
    journal: { append: () => ++sequence, syncThrough: async () => {} },
    lookupMachine: async () => ({ id: 84, company_id: 4 }), hydrate: async () => null,
    redis: { isReady: false },
    shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] },
    ingressLag
  });
}
const cnc = (receivedAt, lag = 17500) => ({
  machine_status: 'RUN', time: Math.floor((receivedAt - lag) / 1000), parts_count: 10
});
const energy = (receivedAt, lag = 500) => ({
  machine: 'VMC9', timestamp: new Date(receivedAt - lag).toISOString(),
  active_power: { total: { parameter: 'Total kW', value: -0.199, unit: 'kW' } }
});

test('the processor identifies standalone meter packets independently of CNC snapshots containing power data', async () => {
  const observe = jest.fn();
  const p = processor({ observe });
  await p.handleMessage('device', { ...cnc(start), PowerData: { Total_kW: 2 } }, start);
  await p.handleMessage('device', energy(start), start);
  expect(observe.mock.calls).toEqual([[84, 17500, 'cnc'], [84, 500, 'energy']]);
});

test('separate real packet streams never let fresh energy clear a persistent CNC delay', async () => {
  let now = start;
  const logs = [];
  const lag = createLagTracker({ now: () => now, log: (level, msg, meta) => logs.push({ level, msg, ...meta }) });
  const p = processor(lag);
  for (let i = 0; i <= 36; i++) {
    now = start + i * 5000;
    await p.handleMessage('device', cnc(now), now);
    await p.handleMessage('device', energy(now), now);
  }
  expect(logs.filter(line => line.msg === 'readings arriving late')).toEqual([
    expect.objectContaining({ source: 'cnc', machines: { 84: 17500 } })
  ]);
  expect(logs.filter(line => line.msg === 'readings on time again')).toEqual([]);
  expect(lag.snapshot().machines[84]).toBe(17500);
});

test('a fresh CNC packet cannot clear delayed standalone energy packets', async () => {
  let now = start;
  const logs = [];
  const lag = createLagTracker({ now: () => now, log: (level, msg, meta) => logs.push({ level, msg, ...meta }) });
  const p = processor(lag);
  for (let i = 0; i <= 24; i++) {
    now = start + i * 5000;
    await p.handleMessage('device', energy(now, 17500), now);
    await p.handleMessage('device', cnc(now, 500), now);
  }
  expect(logs.filter(line => line.msg === 'readings arriving late')).toEqual([
    expect.objectContaining({ source: 'energy', machines: { 84: 17500 } })
  ]);
  expect(logs.filter(line => line.msg === 'readings on time again')).toEqual([]);
  expect(lag.snapshot().machines[84]).toBe(17500);
});
