import { fanucBatterySignals, fanucBatteryAlarms, isFanucBatteryCode } from '../src/lib/fanuc-battery.js';
import { alarmTransition, writeAlarmTransition } from '../src/lib/alarm-transition.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
import { telemetryInsert } from '../buffer.js';

const parse = payload => fanucBatterySignals(payload, 'FANUC');
const acc = value => parse({ acc_battery: { X: value } }).acc_battery_status.X;

describe('FANUC battery diagnostics preserve evidence and unknown states', () => {
  test.each(['SIEMENS', 'MITSUBISHI', '', null, undefined])('trusted controller %s cannot accept FANUC diagnostics', controller => {
    expect(fanucBatterySignals({ controller_type: 'FANUC', acc_battery: { X: { raw: 8 } },
      cnc_battery_warning: { warning: true } }, controller)).toEqual({ acc_battery_status: null, cnc_battery_warning: null });
  });

  test('the embedded sample is clear without claiming physical battery health', () => {
    const value = acc({ status: 'NO_LOW_BIT_REPORTED', low: false, raw: 0, ABP: false, INP: false, EXP: false,
      source: 'FOCAS diagnostic 3019; verify bit mapping for this CNC' });
    expect(value).toEqual({ low: false, raw: 0, ABP: false, INP: false, EXP: false,
      status: 'NO_LOW_BIT_REPORTED', source: 'FOCAS diagnostic 3019; verify bit mapping for this CNC' });
    expect(fanucBatteryAlarms({ acc_battery_status: { X: value } }).alarms).toEqual([]);
  });

  test.each([['ABP', 8], ['INP', 16], ['EXP', 32]])('raw diagnostic bit %s maps independently', (name, raw) => {
    expect(acc({ raw })).toMatchObject({ low: true, [name]: true });
    const alarms = fanucBatteryAlarms(parse({ acc_battery: { A: { raw } } }));
    expect(alarms.codes).toEqual([`FANUC_ACC_A_${name}`]);
    expect(alarms.alarms[0].alarm_severity).toBe('NORMAL');
  });

  test('all three simultaneous bit warnings remain separate', () => {
    const alarms = fanucBatteryAlarms(parse({ acc_battery: { B: { raw: 56 } } }));
    expect(alarms.codes).toEqual(['FANUC_ACC_B_ABP', 'FANUC_ACC_B_INP', 'FANUC_ACC_B_EXP']);
  });

  test.each([{ low: false, ABP: true }, { low: false, ABP: false, raw: 8 }, { low: true, raw: 0 }])(
    'positive evidence overrides contradictory clear flags %j', value => expect(acc(value).low).toBe(true));

  test('explicit aggregate clear is evidence of clear bits, and aggregate-only low has a generic warning', () => {
    expect(acc({ low: false })).toMatchObject({ low: false, ABP: false, INP: false, EXP: false, raw: null });
    expect(fanucBatteryAlarms(parse({ acc_battery: { X: { low: true } } })).codes).toEqual(['FANUC_ACC_X_LOW']);
  });

  test.each([{}, { status: 'OK' }, { raw: -1 }, { raw: true }, { raw: '8junk' },
    { raw: 2147483648 }, { raw: Infinity }, { low: 'false' }, { ABP: [] }])('unreported/invalid evidence %j stays unknown', value => {
    expect(acc(value)).toMatchObject({ low: null, ABP: null, INP: null, EXP: null, raw: null });
  });

  test('CNC general alarm mask never implies a battery warning or a clear', () => {
    expect(parse({ cnc_battery_warning: { raw_alarm_value: 1 } }).cnc_battery_warning.warning).toBeNull();
    expect(parse({ cnc_battery_warning: { raw_alarm_value: 0 } }).cnc_battery_warning.warning).toBeNull();
    expect(parse({ cnc_battery_warning: { warning: false, raw_alarm_value: 1 } }).cnc_battery_warning.warning).toBe(false);
    expect(parse({ cnc_battery_warning: { warning: true, raw_alarm_value: 0 } }).cnc_battery_warning.warning).toBe(true);
  });

  test.each([true, false, 1, 0, '1', '0'])('strict Boolean evidence %j is accepted', warning => {
    expect(parse({ cnc_battery_warning: { warning } }).cnc_battery_warning.warning).toBe(Boolean(Number(warning)));
  });

  test('axis names, map size and text metadata are bounded without accepting prototype keys', () => {
    const payload = JSON.parse('{"acc_battery":{"__proto__":{"raw":8}," X ":{"raw":8},"a":{"raw":16},"B":{"raw":32},"TOO_LONG_AXIS":{"raw":8}}}');
    payload.acc_battery.X2 = { low: false, status: 's'.repeat(90), source: '\0' + 'x'.repeat(200) };
    const out = parse(payload).acc_battery_status;
    expect(Object.keys(out)).toEqual(['X', 'A', 'B', 'X2']);
    expect(out.X2.status).toHaveLength(64);
    expect(out.X2.source).toHaveLength(160);
    expect(out.X2.source).not.toContain('\0');
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`A${i}`, { raw: 8 }]));
    expect(Object.keys(parse({ acc_battery: many }).acc_battery_status)).toHaveLength(16);
    expect({}.raw).toBeUndefined();
  });

  test('bounded metadata remains valid Unicode for JSONB storage', () => {
    const value = acc({ raw: 8, source: '\uD800' + 'a'.repeat(159) + '🙂tail', status: 'é'.repeat(63) + '🙂tail' });
    expect(value.source).toBe('a'.repeat(159) + '🙂');
    expect(value.status).toBe('é'.repeat(63) + '🙂');
    expect(Array.from(value.source)).toHaveLength(160);
    expect(JSON.stringify(value)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  test('diagnostics do not mutate payload objects', () => {
    const payload = { acc_battery: { X: { low: false, raw: 8 } } };
    const original = JSON.stringify(payload);
    parse(payload);
    expect(JSON.stringify(payload)).toBe(original);
  });

  test('missing diagnostics retain unresolved codes, explicit clear resolves only its own axis', () => {
    const codes = ['FANUC_ACC_X_ABP', 'FANUC_ACC_A_INP', 'FANUC_CNC_BATTERY'];
    expect(fanucBatteryAlarms(parse({}), codes).codes).toEqual(codes);
    const result = fanucBatteryAlarms(parse({ acc_battery: { X: { raw: 0 } },
      cnc_battery_warning: { raw_alarm_value: 0 } }), codes);
    expect(result.codes).toEqual(['FANUC_ACC_A_INP', 'FANUC_CNC_BATTERY']);
    expect(result.cleared).toEqual(expect.arrayContaining(['FANUC_ACC_X_ABP', 'FANUC_ACC_X_INP', 'FANUC_ACC_X_EXP', 'FANUC_ACC_X_LOW']));
    expect(result.cleared).not.toContain('FANUC_CNC_BATTERY');
  });

  test('a later specific warning replaces a generic low warning without duplicating it', () => {
    const result = fanucBatteryAlarms(parse({ acc_battery: { X: { ABP: true } } }), ['FANUC_ACC_X_LOW']);
    expect(result.codes).toEqual(['FANUC_ACC_X_ABP']);
    expect(result.cleared).toContain('FANUC_ACC_X_LOW');
  });

  test('only bounded canonical battery alarm keys can be retained', () => {
    expect(fanucBatteryAlarms(parse({}), ['EX1046', 'FANUC_CNC_BATTERY', 'FANUC_ACC_X_ABP',
      'FANUC_ACC_X_NOT_REAL', 'FANUC_ACC_TOO_LONG_AXIS_ABP']).codes).toEqual(['FANUC_CNC_BATTERY', 'FANUC_ACC_X_ABP']);
    expect(isFanucBatteryCode('FANUC_ACC_A1_EXP')).toBe(true);
  });
});

function fixture({ controller = 'FANUC', previous = null, initialStates } = {}) {
  const records = [];
  const journal = { append: record => { records.push(record); return records.length; }, syncThrough: async () => {},
    latestStates: () => initialStates || new Map() };
  const processor = createMessageProcessor({ journal, redis: { isReady: false },
    lookupMachine: async () => ({ id: 7, company_id: 4, plant_id: 3, controller_type: controller }),
    hydrate: async () => previous,
    shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] } });
  const start = 1793127205;
  const send = (offset, extra = {}) => processor.handleMessage('device', {
    time: start + offset, machine_status: 'CUTTING', mode: 'EDIT', parts_count: 100 + offset, ...extra
  }, (start + offset) * 1000);
  return { records, processor, send };
}

describe('battery warning transitions follow telemetry admission without changing process state', () => {
  test('accepted warning writes telemetry JSON and the legacy flat projection, with no breakdown or critical notification', async () => {
    const { records, processor, send } = fixture();
    await send(0, { acc_battery: { X: { raw: 8 }, A: { raw: 32 } }, cnc_battery_warning: { warning: true } });
    const { r, a, state } = records[0];
    expect(r.machine_status).toBe('RUNNING');
    expect(r.alarm).toBe(false);
    expect(state.alarm).toBe(false);
    expect(r.apc_battery_status).toEqual({ X: true, A: true });
    expect(r.acc_battery_status.X.ABP).toBe(true);
    expect(a.opens.map(row => row.alarm_code)).toEqual(['FANUC_ACC_X_ABP', 'FANUC_ACC_A_EXP', 'FANUC_CNC_BATTERY']);
    expect(a.opens.every(row => row.alarm_severity === 'NORMAL')).toBe(true);
    expect(processor.state(7).battery_alarm_codes).toEqual(a.opens.map(row => row.alarm_code));
    const calls = [];
    await writeAlarmTransition({ query: async (sql, values) => {
      calls.push([sql, values]); return { rows: sql.startsWith('INSERT INTO machine_alarms') ? [{ id: 1 }] : [] };
    } }, a);
    expect(calls.filter(([sql]) => sql.startsWith('INSERT INTO machine_alarms'))).toHaveLength(3);
    expect(calls.some(([sql]) => sql.includes('alarm_notification_events') || sql.includes('pg_notify'))).toBe(false);
    const insert = telemetryInsert([r]);
    expect(insert.text).toContain('acc_battery_status');
    expect(insert.values).toContain(JSON.stringify(r.acc_battery_status));
    expect(insert.values).toContain(JSON.stringify(r.cnc_battery_warning));
  });

  test('unchanged and unknown warning snapshots cause no repeated alarm database transitions', async () => {
    const { records, send } = fixture();
    const warning = { acc_battery: { X: { raw: 8 } }, cnc_battery_warning: { warning: true } };
    await send(0, warning); await send(1, warning); await send(2);
    expect(records[1].a).toBeUndefined();
    expect(records[2].a).toBeUndefined();
    expect(records[2].state.battery_alarm_codes).toEqual(['FANUC_ACC_X_ABP', 'FANUC_CNC_BATTERY']);
    expect(records[2].state.acc_battery_status).toBeNull();
    expect(records[2].state.cnc_battery_warning).toBeNull();
    expect(records[2].r.acc_battery_status).toBeNull();
  });

  test('only confirmed clear closes warning periods, while absent axis warnings remain unresolved', async () => {
    const { records, send } = fixture();
    await send(0, { acc_battery: { X: { raw: 8 }, A: { raw: 16 } }, cnc_battery_warning: { warning: true } });
    await send(1, { acc_battery: { X: { raw: 0 } }, cnc_battery_warning: { warning: false } });
    expect(records[1].a.closes).toEqual(['FANUC_ACC_X_ABP', 'FANUC_CNC_BATTERY']);
    expect(records[1].state.alarm_codes).toEqual(['FANUC_ACC_A_INP']);
    await send(2, { acc_battery: { A: { raw: 0 } } });
    expect(records[2].a.closes).toEqual(['FANUC_ACC_A_INP']);
    expect(records[2].state.alarm_codes).toEqual([]);
    await send(3, { acc_battery: { A: { raw: 0 } } });
    expect(records[3].a).toBeUndefined();
  });

  test.each(['SIEMENS', null])('payload FANUC claim cannot create new diagnostics or warnings on %s machines', async controller => {
    const { records, send } = fixture({ controller });
    await send(0, { controller_type: 'FANUC', acc_battery: { X: { raw: 8 } },
      cnc_battery_warning: { warning: true } });
    expect(records[0].r.acc_battery_status).toBeNull();
    expect(records[0].r.cnc_battery_warning).toBeNull();
    expect(records[0].a.opens).toEqual([]);
  });

  test('a collector restart hydrates unresolved warning codes without presenting old diagnostics as fresh', async () => {
    const { records, send } = fixture({ previous: { received_at: null,
      battery_alarm_codes: ['FANUC_ACC_B_EXP', 'FANUC_CNC_BATTERY'] } });
    await send(0);
    expect(records[0].a.keep).toEqual(['FANUC_ACC_B_EXP', 'FANUC_CNC_BATTERY']);
    expect(records[0].r.acc_battery_status).toBeNull();
    expect(records[0].r.cnc_battery_warning).toBeNull();
    expect(records[0].h).toEqual([]);
    await send(1, { acc_battery: { B: { raw: 0 } } });
    expect(records[1].a.closes).toEqual(['FANUC_ACC_B_EXP']);
    expect(records[1].state.battery_alarm_codes).toEqual(['FANUC_CNC_BATTERY']);
  });

  test('PMC process alarm transitions remain independent of a retained battery warning', async () => {
    const { records, send } = fixture();
    await send(0, { stat_alarm: 1, alarm_code: 'EX1046', alarm_type: 'Door open',
      alarm_severity: 'CRITICAL', acc_battery: { X: { raw: 8 } } });
    expect(records[0].r.alarm).toBe(true);
    await send(1);
    expect(records[1].a.closes).toEqual(['EX1046']);
    expect(records[1].state.alarm).toBe(false);
    expect(records[1].state.alarm_codes).toEqual(['FANUC_ACC_X_ABP']);
  });

  test('journal restart preserves warning state and rejected/out-of-order packets cannot clear it', async () => {
    const first = fixture();
    await first.send(1, { acc_battery: { X: { raw: 8 } } });
    const second = fixture({ initialStates: new Map([[7, first.processor.state(7)]]) });
    await second.send(0, { acc_battery: { X: { raw: 0 } } });
    expect(second.records[0].l.reason).toBe('out_of_order');
    expect(second.processor.state(7).battery_alarm_codes).toEqual(['FANUC_ACC_X_ABP']);
    await second.send(2);
    expect(second.records[1].a).toBeUndefined();
    expect(second.records[1].state.battery_alarm_codes).toEqual(['FANUC_ACC_X_ABP']);
  });
});

test('cold alarm reconciliation preserves unknown battery rows but can close explicitly clear diagnostic codes', async () => {
  const change = alarmTransition({ prev: null, isAlarm: false, companyId: 4, machineId: 7,
    deviceTime: 1793127205, preserveUnknownBattery: true, batteryClears: ['FANUC_ACC_X_ABP', 'EX1046'] });
  expect(change.batteryClears).toEqual(['FANUC_ACC_X_ABP']);
  const calls = [];
  await writeAlarmTransition({ query: async (sql, values) => { calls.push([sql, values]); return { rows: [] }; } }, change);
  const [sql, values] = calls[0];
  expect(sql).toContain("= 'FANUC_CNC_BATTERY'");
  expect(sql).toContain('ANY($6::text[])');
  expect(values[5]).toEqual(['FANUC_ACC_X_ABP']);
  expect(values.slice(0, 2)).toEqual([4, 7]);
});

test('known baseline cannot accidentally close an unobserved battery warning', () => {
  const change = alarmTransition({ prev: { alarm: true, alarm_codes: ['FANUC_ACC_X_ABP', 'EX1046'] },
    isAlarm: false, companyId: 4, machineId: 7, deviceTime: 1793127205,
    preserveUnknownBattery: true, batteryClears: [] });
  expect(change.closes).toEqual(['EX1046']);
});
