import { alarmFields, alarmKey, alarmSeverityClass } from '../src/lib/alarm-text.js';
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
    expect(calls.findLast(([sql]) => sql.startsWith('UPDATE machine_alarms SET ended_at'))[1][3]).toEqual([inserts[0][1][3]]);
    const reopen = alarmTransition({ ...base, deviceTime: base.deviceTime + 2,
      prev: { alarm: true, alarm_codes: [alarmKey(second)] }, isAlarm: true, alarms: [first, second] });
    expect(reopen.opens).toEqual([first]);
    await writeAlarmTransition(client, reopen);
    expect(calls.findLast(([sql]) => sql.startsWith('INSERT INTO machine_alarms'))[1][3]).toBe(initial.keep[0]);
  });

  test('unchanged long alarms write no transition on each reading', () => {
    expect(alarmTransition({ ...base, prev: { alarm: true, alarm_codes: [alarmKey(first)],
      alarm_severities: { [alarmKey(first)]: 'NORMAL' } },
      isAlarm: true, alarms: [first] })).toBeNull();
  });

  test('unknown baselines reset only kept open alarm notification continuity without rewriting history', async () => {
    const calls = [];
    const client = { query: async (sql, values) => { calls.push([sql, values]); return { rows: [], rowCount: 1 }; } };
    await writeAlarmTransition(client, alarmTransition({ ...base, prev: null, isAlarm: true, alarms: [first] }));
    const updates = calls.filter(([sql]) => sql.includes('notification_continuity_started_at'));
    expect(updates).toHaveLength(1);
    const [sql, values] = updates[0];
    expect(sql).toContain('GREATEST(notification_continuity_started_at, to_timestamp($3))');
    expect(sql).toContain('company_id = $1 AND machine_id = $2 AND ended_at IS NULL AND started_at <= to_timestamp($3)');
    expect(sql).toContain('COALESCE(alarm_code, alarm_type) = ANY($4::text[])');
    expect(sql).not.toMatch(/SET\s+started_at/);
    expect(values).toEqual([base.companyId, base.machineId, base.deviceTime, [alarmKey(first)]]);
  });

  test('known baseline changes and an empty reconciliation do not reset notification continuity', async () => {
    const calls = [];
    const client = { query: async (sql, values) => { calls.push([sql, values]); return { rows: [], rowCount: 1 }; } };
    await writeAlarmTransition(client, alarmTransition({ ...base,
      prev: { alarm: true, alarm_codes: [alarmKey(first)] }, isAlarm: true, alarms: [first, second] }));
    await writeAlarmTransition(client, alarmTransition({ ...base, prev: null, isAlarm: false, alarms: [] }));
    expect(calls.some(([sql]) => sql.includes('notification_continuity_started_at'))).toBe(false);
  });
});

describe('notification priority transitions', () => {
  const base = { companyId: 4, machineId: 7, shiftId: 1, deviceTime: 1791967249,
    receivedAt: '2026-10-14T08:40:50.100Z' };
  const normal = { alarm_code: 'EX1000', alarm_type: 'Door open', alarm_severity: 'NORMAL' };
  const critical = { ...normal, alarm_severity: ' critical ' };
  const prev = { alarm: true, alarm_codes: ['EX1000'], alarm_severities: { EX1000: 'NORMAL' } };

  test.each([
    ['CRITICAL', 'critical'], [' fatal ', 'critical'], ['EMERGENCY', 'critical'],
    ['INFO', 'info'], ['INFORMATION', 'info'], ['INFORMATIONAL', 'info'], ['LOW', 'info'], ['MESSAGE', 'info'],
    ['HIGH', 'noncritical'], ['NORMAL', 'noncritical'], ['MEDIUM', 'noncritical'], ['', 'noncritical'],
    ['unknown-controller-value', 'noncritical']
  ])('%s follows the shared %s classification', (severity, expected) => {
    expect(alarmSeverityClass(severity)).toBe(expected);
  });

  test('same-code critical escalation retains the occurrence and carries true receipt time', () => {
    const change = alarmTransition({ ...base, prev, isAlarm: true, alarms: [critical] });
    expect(change.opens).toEqual([]);
    expect(change.closes).toEqual([]);
    expect(change.updates).toEqual([critical]);
    expect(change.receivedAt).toBe(base.receivedAt);
    expect(alarmFields(critical).severity).toBe('CRITICAL');
    expect(alarmTransition({ ...base, prev: { ...prev, alarm_severities: { EX1000: 'CRITICAL' } },
      isAlarm: true, alarms: [critical] })).toBeNull();
  });

  test('pre-upgrade baselines reconcile severity once without inventing a new occurrence', () => {
    const change = alarmTransition({ ...base, prev: { alarm: true, alarm_codes: ['EX1000'] }, isAlarm: true, alarms: [critical] });
    expect(change.opens).toEqual([]);
    expect(change.updates).toEqual([critical]);
  });

  test('a new short critical occurrence creates a durable event before its later clear', async () => {
    const calls = [];
    const client = { query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: sql.startsWith('INSERT INTO machine_alarms') ? [{ id: '42' }]
        : sql.startsWith('INSERT INTO alarm_notification_events') ? [{ id: '81' }] : [] };
    } };
    await writeAlarmTransition(client, alarmTransition({ ...base, prev: { alarm: false, alarm_codes: [] }, isAlarm: true, alarms: [critical] }));
    await writeAlarmTransition(client, alarmTransition({ ...base, deviceTime: base.deviceTime + 3,
      prev: { ...prev, alarm_severities: { EX1000: 'CRITICAL' } }, isAlarm: false, alarms: [] }));
    const events = calls.filter(([sql]) => sql.startsWith('INSERT INTO alarm_notification_events'));
    expect(events).toHaveLength(1);
    expect(events[0][1]).toEqual(['42', 4, 7, 'critical', base.deviceTime, base.receivedAt,
      'Door open', 'EX1000', 'CRITICAL', null]);
    expect(calls.some(([sql]) => sql.includes("pg_notify('cnc_alarm_events'"))).toBe(true);
    expect(calls.at(-1)[0]).toContain('SET ended_at');
  });

  test('cold discovery of unchanged historical critical severity does not append an alert event', async () => {
    const calls = [];
    const client = { query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: sql.startsWith('WITH target') ? [{ id: '42', previous_class: 'critical' }] : [] };
    } };
    await writeAlarmTransition(client, alarmTransition({ ...base, prev: null, isAlarm: true, alarms: [critical] }));
    expect(calls.some(([sql]) => sql.startsWith('INSERT INTO alarm_notification_events'))).toBe(false);
    expect(calls.some(([sql]) => sql.includes('pg_notify'))).toBe(false);
  });

  test('a same-occurrence class change persists a snapshot and monotonic update guard', async () => {
    const calls = [];
    const client = { query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: sql.startsWith('WITH target') ? [{ id: '42', previous_class: 'noncritical' }]
        : sql.startsWith('INSERT INTO alarm_notification_events') ? [{ id: '81' }] : [] };
    } };
    await writeAlarmTransition(client, alarmTransition({ ...base, prev, isAlarm: true, alarms: [critical] }));
    expect(calls[0][0]).toContain('severity_observed_at < to_timestamp($3)');
    expect(calls[0][0]).toContain('severity_received_at');
    expect(calls[0][1]).toContain(base.receivedAt);
    expect(calls[1][1][0]).toBe('42');
    expect(calls[1][1][3]).toBe('critical');
  });
});
