import { alarmFields, alarmKey } from '../src/lib/alarm-text.js';
import { alarmKey as transitionKey, alarmTransition, writeAlarmTransition } from '../src/lib/alarm-transition.js';

describe('alarm text matches the persisted VARCHAR limits', () => {
  test('preserves existing short labels, codes and messages', () => {
    const alarm = { alarm_code: 'EX1046', alarm_type: 'Door open', alarm_severity: 'critical', alarm_message: 'Close door' };
    expect(alarmFields(alarm)).toEqual({ alarmType: 'Door open', alarmCode: 'EX1046', severity: 'CRITICAL', message: 'Close door' });
    expect(alarmKey(alarm)).toBe('EX1046');
    expect(alarmKey({ alarm_type: 'Door open' })).toBe('Door open');
    expect(alarmKey(null)).toBe('UNSPECIFIED');
  });

  test('accepts exactly 50 Unicode code points without slicing a character', () => {
    const type = '🚨'.repeat(50);
    expect(alarmFields({ alarm_type: type }).alarmType).toBe(type);
    expect(alarmKey({ alarm_type: type })).toBe(type);
  });

  test('two long code-less labels with the same prefix remain distinct and stable', () => {
    const common = 'Hydraulic controller pressure safety circuit: '.repeat(2);
    const first = { alarm_type: `${common}pump one` };
    const second = { alarm_type: `${common}pump two` };
    expect(Array.from(alarmKey(first))).toHaveLength(50);
    expect(Array.from(alarmKey(second))).toHaveLength(50);
    expect(alarmKey(first)).not.toBe(alarmKey(second));
    expect(alarmKey({ ...first })).toBe(alarmKey(first));
    expect(alarmFields(first).message).toBe(`Alarm type: ${first.alarm_type}`);
    expect(transitionKey(first)).toBe(alarmKey(first));
  });

  test('long coded types retain the readable label and complete original message', () => {
    const type = '🚨'.repeat(51);
    const message = 'Full controller diagnostic: '.repeat(100);
    const fields = alarmFields({ alarm_code: 'SV0401', alarm_type: type, alarm_message: message });
    expect(fields.alarmType).toBe('🚨'.repeat(50));
    expect(fields.alarmCode).toBe('SV0401');
    expect(fields.message).toBe(`Alarm type: ${type}\n${message}`);
  });

  test('long codes and severities stay within their own Unicode character limits', () => {
    const code = '🔧'.repeat(51);
    const fields = alarmFields({ alarm_code: code, alarm_type: 'Controller alarm', alarm_severity: 'ä'.repeat(21) });
    expect(Array.from(fields.alarmCode)).toHaveLength(50);
    expect(fields.alarmCode).toMatch(/~[a-f0-9]{16}$/);
    expect(Array.from(fields.severity)).toHaveLength(20);
    expect(fields.message).toBe(`Alarm code: ${code}`);
    expect(alarmKey({ alarm_code: code })).toBe(fields.alarmCode);
  });

  test('distinct overlong codes with the same prefix cannot merge their alarm periods', () => {
    const first = { alarm_code: 'C'.repeat(60) + 'one', alarm_type: 'Controller alarm' };
    const second = { alarm_code: 'C'.repeat(60) + 'two', alarm_type: 'Controller alarm' };
    expect(alarmKey(first)).not.toBe(alarmKey(second));
    expect(alarmKey(first)).toBe(alarmFields(first).alarmCode);
    expect(alarmFields(first).message).toContain(first.alarm_code);
    const change = alarmTransition({ prev: { alarm: true, alarm_codes: [alarmKey(first), alarmKey(second)] },
      isAlarm: true, alarms: [second], companyId: 4, machineId: 7, deviceTime: 1791967249 });
    expect(change.opens).toEqual([]);
    expect(change.closes).toEqual([alarmKey(first)]);
  });
});

describe('journal alarm lifecycle uses the stored key', () => {
  const base = { companyId: 4, machineId: 7, shiftId: 1, deviceTime: 1791967249 };
  const first = { alarm_type: `${'Pneumatic emergency interlock: '.repeat(3)}one` };
  const second = { alarm_type: `${'Pneumatic emergency interlock: '.repeat(3)}two` };

  test('insert fields, closes and reconciliation agree for long types', async () => {
    const calls = [];
    const client = { query: async (sql, values) => { calls.push([sql, values]); return { rows: [], rowCount: 1 }; } };
    const initial = alarmTransition({ ...base, prev: null, isAlarm: true, alarms: [first, second] });
    expect(initial.keep).toEqual([alarmKey(first), alarmKey(second)]);
    await writeAlarmTransition(client, initial);
    const inserts = calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(inserts.map(([, values]) => values[3])).toEqual(initial.keep);
    expect(inserts.map(([, values]) => values[6])).toEqual([
      `Alarm type: ${first.alarm_type}`, `Alarm type: ${second.alarm_type}`
    ]);
    const changed = alarmTransition({ ...base, deviceTime: base.deviceTime + 1,
      prev: { alarm: true, alarm_codes: initial.keep }, isAlarm: true, alarms: [second] });
    expect(changed.opens).toEqual([]);
    expect(changed.closes).toEqual([alarmKey(first)]);
    await writeAlarmTransition(client, changed);
    expect(calls.at(-1)[1][3]).toEqual([inserts[0][1][3]]);
    const reopen = alarmTransition({ ...base, deviceTime: base.deviceTime + 2,
      prev: { alarm: true, alarm_codes: [alarmKey(second)] }, isAlarm: true, alarms: [first, second] });
    expect(reopen.opens).toEqual([first]);
    await writeAlarmTransition(client, reopen);
    expect(calls.at(-1)[1][3]).toBe(initial.keep[0]);
  });

  test('unchanged long alarms write no transition on each reading', () => {
    expect(alarmTransition({ ...base, prev: { alarm: true, alarm_codes: [alarmKey(first)] },
      isAlarm: true, alarms: [first] })).toBeNull();
  });
});
