import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { parseTelemetry } from '../src/lib/admission.js';
import { isEnergyPacket, observationTime } from '../src/lib/energy-packet.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
import { powerSignals } from '../src/lib/power-signals.js';

const timestamp = '2026-11-18T17:31:21.351Z';
const time = Math.floor(Date.parse(timestamp) / 1000);
const quantity = (value, unit) => ({ parameter: 'Meter reading', value, unit });
const nested = (at = time, total = 681.4) => ({
  machine: 'VMC9',
  timestamp: at === time ? timestamp : new Date(at * 1000 + 351).toISOString(),
  energy: { total_active: quantity(total, 'kWh') },
  active_power: { total: quantity(-0.199, 'kW') },
  voltage: { average_LL: quantity(414.78, 'V') },
  current: { average: quantity(0.632, 'A') },
  operating_data: { run_hour: quantity(null, 'Hour') },
  THD: { voltage: { V1N: quantity(null, '%') } }
});
const packet = payload => ({ topic: 'machines/authenticated-device/telemetry',
  payload: Buffer.from(JSON.stringify(payload)) });

function fixture(previous = null) {
  const records = [], publish = jest.fn(), lookupMachine = jest.fn(async () => ({ id: 7, company_id: 4 }));
  const processor = createMessageProcessor({
    journal: { append: record => { records.push(record); return records.length; }, syncThrough: async () => {} },
    lookupMachine, hydrate: async () => previous,
    shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] },
    redis: { isReady: true, multi: () => { publish(); throw new Error('Unexpected CNC publication'); } }
  });
  return { records, publish, lookupMachine, processor,
    send: (payload, receivedAt = time) => processor.handleMessage('authenticated-device', payload, receivedAt * 1000) };
}

test('the nested meter contract is admitted with its explicit ISO event time and topic identity', async () => {
  const payload = nested();
  const parsed = parseTelemetry(packet(payload), (time + 1) * 1000);
  expect(parsed).toMatchObject({ apiKey: 'authenticated-device' });
  expect(isEnergyPacket(parsed.payload)).toBe(true);
  expect(observationTime(parsed.payload, (time + 1) * 1000)).toBe(time);
  const f = fixture();
  await f.send(parsed.payload, time + 1);
  expect(f.lookupMachine).toHaveBeenCalledWith('authenticated-device');
  expect(f.records[0].m).toMatchObject({ machineId: 7, companyId: 4, at: time, standalone: true,
    reading: { kwh_total: 681.4, kw_total: -0.199, v_ll_avg: 414.78, i_avg: 0.632, run_hours: null } });
  expect(f.records[0].r).toBeUndefined();
  expect(f.records[0].a).toBeUndefined();
  expect(f.records[0].h).toEqual([]);
  expect(f.processor.state(7).received_at).toBeUndefined();
  expect(f.publish).not.toHaveBeenCalled();
});

test('the exact VMC9 sample journals all 50 measured channels and preserves its 11 unknown channels', async () => {
  const payload = JSON.parse(readFileSync(new URL('./fixtures/nested-energy.json', import.meta.url), 'utf8'));
  const parsed = parseTelemetry(packet(payload), Date.parse(payload.timestamp) + 1000);
  expect(parsed).not.toBeNull();
  expect(isEnergyPacket(parsed.payload)).toBe(true);
  expect(powerSignals(parsed.payload)).toEqual({ energy: 681.4, voltage: 414.78, current: 0.632, power: -0.199 });
  const f = fixture();
  await f.send(parsed.payload, time + 1);
  expect(f.records).toHaveLength(1);
  expect(f.records[0].m).toMatchObject({ machineId: 7, companyId: 4, at: time, standalone: true });
  expect(f.records[0].m.reading).toEqual({
    v1n: 239.97, v2n: 239.03, v3n: 239.42, v_ln_avg: 239.47,
    v12: 414.97, v23: 413.66, v31: 415.72, v_ll_avg: 414.78,
    i1: 0.504, i2: 0.828, i3: 0.564, i_avg: 0.632,
    kw1: 0.026, kw2: -0.114, kw3: -0.111, kw_total: -0.199,
    kvar1: 0.118, kvar2: 0.162, kvar3: -0.076, kvar_total: 0.205,
    kva1: 0.121, kva2: 0.198, kva3: 0.135, kva_total: 0.454,
    pf1: -0.213, pf2: -0.574, pf3: 0.825, pf_avg: -0.697, frequency_hz: 49.941,
    kw_demand_max: 0.103, kw_demand_min: -0.94,
    kvar_demand_max: 1.159, kvar_demand_min: -0.11, kva_demand_max: 4.791,
    v1n_max: 267.69, v2n_max: 266.6, v3n_max: 268.13,
    v12_max: 462.25, v23_max: 462.58, v31_max: 465.01,
    i1_max: 20.536, i2_max: 20.69, i3_max: 21.692,
    kwh_import: 249.1, kwh_export: 430.2, kwh_total: 681.4,
    kvarh_import: 313.5, kvarh_export: 115, kvarh_total: 431.2, kvah_total: 858.7,
    run_hours: null, aux_interrupts: null,
    thd_v1n: null, thd_v2n: null, thd_v3n: null, thd_v12: null, thd_v23: null, thd_v31: null,
    thd_i1: null, thd_i2: null, thd_i3: null
  });
  expect(f.records[0].r).toBeUndefined();
  expect(f.records[0].a).toBeUndefined();
  expect(f.records[0].h).toEqual([]);
  expect(f.processor.state(7).received_at).toBeUndefined();
  expect(f.publish).not.toHaveBeenCalled();
});

test.each([null, '', 1795023081, 'not-a-date', '2026-11-18T17:31:21',
  '2026-02-30T17:31:21.351Z', '2026-13-18T17:31:21Z', '2026-11-18T24:31:21Z',
  '2026-11-18T17:31:60Z', '2026-11-18T17:31:21+24:00', '2026-11-18T17:31:21+05:60',
  '1999-12-31T23:59:59Z', new Date((time + 61) * 1000).toISOString()
])('an invalid or future explicit timestamp cannot fall back to receipt: %j', value => {
  expect(parseTelemetry(packet({ ...nested(), timestamp: value }), time * 1000)).toBeNull();
});

test('ISO timezone offsets resolve to UTC seconds and conflicting timestamp sources are rejected', () => {
  const payload = { ...nested(), timestamp: '2026-11-18T23:01:21.351+05:30' };
  expect(observationTime(payload, time * 1000)).toBe(time);
  expect(parseTelemetry(packet({ ...payload, time }), time * 1000)).not.toBeNull();
  expect(parseTelemetry(packet({ ...payload, time: time + 1 }), time * 1000)).toBeNull();
  expect(parseTelemetry(packet({ ...payload, time: null }), time * 1000)).toBeNull();
  expect(parseTelemetry(packet({ ...payload, timestamp: null, time }), time * 1000)).toBeNull();
});

test('timestamp-free nested packets use receipt while unknown fields and CNC snapshots retain their admission contract', () => {
  const { timestamp: _timestamp, ...payload } = nested();
  expect(observationTime(payload, time * 1000 + 999)).toBe(time);
  expect(parseTelemetry(packet(payload), time * 1000)).not.toBeNull();
  expect(parseTelemetry(packet({ ...payload, arbitrary: 1 }), time * 1000)).toBeNull();
  expect(parseTelemetry(packet({ ...nested(), machine_status: 'RUN' }), time * 1000)).toBeNull();
  expect(parseTelemetry(packet({ ...nested(), time, machine_status: 'RUN' }), time * 1000)).not.toBeNull();
});

test('meter updates preserve CNC runtime, parts, alarms and liveness and repeated packets count energy once', async () => {
  const previous = { received_at: time - 2, machine_status: 'RUNNING', parts_count: 100,
    alarm: true, alarm_codes: ['EX1'], fingerprint: 'cnc-fingerprint' };
  const f = fixture(previous);
  await f.send(nested());
  await f.send(nested(time + 10, 682.4), time + 10);
  await f.send(nested(time + 10, 682.4), time + 11);
  expect(f.records).toHaveLength(2);
  expect(f.processor.state(7)).toMatchObject(previous);
  const slices = f.records.flatMap(record => record.h);
  expect(slices.reduce((sum, row) => sum + row.energy, 0)).toBeCloseTo(1);
  expect(slices.every(row => row.run === 0 && row.idle === 0 && row.manual === 0 && row.produced === 0)).toBe(true);
  expect(f.publish).not.toHaveBeenCalled();
});

test('stale replay retains the original electrical event time without advancing live state', async () => {
  const f = fixture();
  await f.send(nested(), time + 400);
  expect(f.records[0]).toMatchObject({ l: { device_time: time, reason: 'stale' },
    m: { at: time, standalone: true, reading: { kwh_total: 681.4 } } });
  expect(f.records[0].state).toBeUndefined();
  expect(f.records[0].r).toBeUndefined();
  expect(f.processor.state(7)).toBeUndefined();
  expect(f.publish).not.toHaveBeenCalled();
});

test('out-of-order nested observations are repairable without rewinding the meter baseline', async () => {
  const f = fixture();
  await f.send(nested());
  await f.send(nested(time + 10, 682.4), time + 10);
  const before = f.processor.state(7);
  await f.send(nested(time + 5, 681.9), time + 15);
  expect(f.records[2]).toMatchObject({ l: { reason: 'out_of_order', device_time: time + 5 },
    m: { at: time + 5, standalone: true, reading: { kwh_total: 681.9 } } });
  expect(f.records[2].state).toBeUndefined();
  expect(f.processor.state(7)).toEqual(before);
  expect(f.publish).not.toHaveBeenCalled();
});
