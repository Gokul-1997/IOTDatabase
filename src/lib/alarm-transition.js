/** Pure, immutable alarm operations carried with the accepted journal record. */
export function alarmKey(alarm) {
  return alarm?.alarm_code != null ? String(alarm.alarm_code).slice(0, 50) :
    String(alarm?.alarm_type || 'UNSPECIFIED').slice(0, 100);
}
export function alarmTransition({ prev, alarms = [], isAlarm, companyId, machineId, shiftId, deviceTime }) {
  const known = Array.isArray(prev?.alarm_codes);
  const before = new Set(known ? prev.alarm_codes : []);
  const after = new Set(alarms.map(alarmKey));
  const opens = isAlarm ? alarms.filter(a => !before.has(alarmKey(a))) : [];
  const closes = known ? [...before].filter(key => !after.has(key)) : [];
  const reconcile = !known;
  if (!opens.length && !closes.length && !reconcile && prev?.alarm === isAlarm) return null;
  return { companyId, machineId, shiftId, at: deviceTime, opens, closes,
    ...(reconcile ? { keep: [...after] } : {}) };
}
export async function writeAlarmTransition(client, transition) {
  const { companyId, machineId, shiftId, at, opens = [], closes = [], keep } = transition;
  if (keep !== undefined || closes.length) {
    await client.query(`UPDATE machine_alarms SET ended_at = to_timestamp($3)
      WHERE company_id = $1 AND machine_id = $2 AND ended_at IS NULL AND started_at <= to_timestamp($3)
        AND ${keep !== undefined ? 'NOT (COALESCE(alarm_code, alarm_type) = ANY($4::text[]))' : 'COALESCE(alarm_code, alarm_type) = ANY($4::text[])'}`,
    [companyId, machineId, at, keep !== undefined ? keep : closes]);
  }
  for (const alarm of opens) {
    await client.query(`INSERT INTO machine_alarms
      (company_id, machine_id, shift_id, alarm_type, alarm_code, severity, message, started_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),NOW()) ON CONFLICT DO NOTHING`,
    [companyId, machineId, shiftId, String(alarm.alarm_type || 'UNSPECIFIED').slice(0, 100),
      alarm.alarm_code != null ? String(alarm.alarm_code).slice(0, 50) : null,
      String(alarm.alarm_severity || 'NORMAL').toUpperCase().slice(0, 20),
      alarm.alarm_message ? String(alarm.alarm_message).slice(0, 500) : null, at]);
  }
}
