import { controllerDowntimeValue } from '../src/lib/controller-downtime.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
import { telemetryInsert, TELEMETRY_COLUMNS } from '../buffer.js';

const time = 1795445087;
const sample = {
  machine_ip: '192.168.200.44', connection: true, machine_status: 'ALARM',
  status: 4, mode: 'JOG', parts_count: 1, downtime: 4, time,
  stat_alarm: 1, stat_emergency: 0,
  pmc_alarm: { exist: 1, count: 1, alarms: [{ number: 1071, type: 15, axis: 0, message: 'AIR PRESSURE NOT OK' }] },
  cnc_battery_warning: { status: 'NOT_DETERMINED_OTHER_ALARM_STATE', warning: null, raw_alarm_value: 1 },
  acc_battery: { X: { status: 'NO_LOW_BIT_REPORTED', low: false, raw: 0, ABP: false, INP: false, EXP: false } }
};
function fixture() {
  const records = [];
  const p = createMessageProcessor({
    journal: { append: record => { records.push(record); return records.length; }, syncThrough: async () => {} },
    lookupMachine: async key => ({ id: Number(key), company_id: 4, controller_type: 'FANUC' }),
    hydrate: async () => null, redis: { isReady: false },
    shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] }
  });
  return { p, records, send: (payload, machine = 19, received = payload.time) => p.handleMessage(String(machine), payload, received * 1000 + 500) };
}

test.each([4, 0, -2, 1.5, '4', '0', ' 4 ', '1e2'])('preserves raw numeric controller downtime %j without assigning semantics', value => {
  expect(controllerDowntimeValue({ downtime: value })).toBe(Number(value));
});
test.each([null, undefined, '', ' ', true, false, [], {}, '4 minutes', '4oops', 'NaN', Infinity, '1e999'])('unknown or malformed controller downtime %j stays null', value => {
  expect(controllerDowntimeValue({ downtime: value })).toBeNull();
});

test('VMC19 preserves raw value 4 and the explicit EX1071 alarm as independent observations', async () => {
  const f = fixture();
  await f.send(sample);
  const record = f.records[0];
  expect(record.r).toMatchObject({ machine_id: 19, controller_downtime_value: 4, alarm: true, machine_status: 'IDLE' });
  expect(record.state).toMatchObject({ controller_downtime_value: 4, controller_downtime_observed_at: time });
  expect(record.a.opens).toHaveLength(1);
  expect(record.a.opens[0]).toMatchObject({ alarm_code: 'EX1071', alarm_message: 'AIR PRESSURE NOT OK' });
  expect(record.state.battery_alarm_codes).toEqual([]);
  const insert = telemetryInsert([record.r]);
  expect(insert.values[TELEMETRY_COLUMNS.indexOf('controller_downtime_value')]).toBe(4);
  expect(insert.text).not.toContain('downtime_events');
});

test('zero on another machine remains a raw zero and never inherits VMC19 signal or alarm', async () => {
  const f = fixture();
  await f.send(sample);
  await f.send({ time, machine_status: 'RUN', downtime: 0 }, 20);
  expect(f.records[1].r).toMatchObject({ machine_id: 20, controller_downtime_value: 0, alarm: false });
  expect(f.p.state(20)).toMatchObject({ controller_downtime_value: 0, controller_downtime_observed_at: time, alarm_codes: [] });
  expect(f.p.state(19).controller_downtime_value).toBe(4);
});

test('zero and then absent CNC fields clear an older value without closing an independently active alarm', async () => {
  const f = fixture();
  await f.send(sample);
  await f.send({ ...sample, time: time + 1, downtime: 0 });
  expect(f.p.state(19)).toMatchObject({ controller_downtime_value: 0, controller_downtime_observed_at: time + 1, alarm_codes: ['EX1071'] });
  const { downtime: ignored, ...without } = sample;
  await f.send({ ...without, time: time + 2 });
  expect(f.records.at(-1).r.controller_downtime_value).toBeNull();
  expect(f.p.state(19)).toMatchObject({ controller_downtime_value: null, controller_downtime_observed_at: null, alarm_codes: ['EX1071'] });
});

test('independent energy cannot refresh a CNC downtime observation', async () => {
  const f = fixture();
  await f.send(sample);
  await f.send({ time: time + 10, energy: 100 });
  expect(f.p.state(19)).toMatchObject({ controller_downtime_value: 4, controller_downtime_observed_at: time, received_at: time });
  expect(f.records[1].r).toBeUndefined();
});

test('replaying the old sample retains its raw value in late audit without inventing current state', async () => {
  const f = fixture();
  await f.send(sample, 19, time + 400);
  expect(f.records[0].l).toMatchObject({ reason: 'stale', payload: { downtime: 4, time } });
  expect(f.records[0].r).toBeUndefined();
  expect(f.records[0].a).toBeUndefined();
  expect(f.p.state(19)).toBeUndefined();
});
