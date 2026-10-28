/** Pure, immutable alarm operations carried with the accepted journal record. */
import { alarmFields, alarmKey, alarmSeverityClass } from './alarm-text.js';
import { isFanucBatteryCode } from './fanuc-battery.js';
export { alarmKey } from './alarm-text.js';

export function alarmTransition({ prev, alarms = [], isAlarm, companyId, machineId, shiftId, deviceTime, receivedAt,
  preserveUnknownBattery = false, batteryClears = [] }) {
  const known = Array.isArray(prev?.alarm_codes);
  const before = new Set(known ? prev.alarm_codes : []);
  const active = isAlarm ? alarms : [];
  const after = new Set(active.map(alarmKey));
  const opens = active.filter(a => !before.has(alarmKey(a)));
  // Old journal/Redis baselines have codes but no severity map. Reconcile
  // those once against the database instead of assuming a new critical alarm.
  const updates = active.filter(a => before.has(alarmKey(a)) &&
    prev?.alarm_severities?.[alarmKey(a)] !== alarmFields(a).severity);
  const clearBattery = new Set(batteryClears.filter(isFanucBatteryCode));
  const closes = known ? [...before].filter(key => !after.has(key) &&
    (!preserveUnknownBattery || !isFanucBatteryCode(key) || clearBattery.has(key))) : [];
  const reconcile = !known;
  if (!opens.length && !updates.length && !closes.length && !reconcile && prev?.alarm === isAlarm) return null;
  return { companyId, machineId, shiftId, at: deviceTime, opens, closes,
    ...(updates.length ? { updates } : {}), ...(receivedAt ? { receivedAt } : {}),
    ...(reconcile && preserveUnknownBattery ? { preserveUnknownBattery: true, batteryClears: [...clearBattery] } : {}),
    ...(reconcile ? { keep: [...after] } : {}) };
}

const classSql = column => `CASE
  WHEN UPPER(BTRIM(${column})) IN ('CRITICAL','FATAL','EMERGENCY') THEN 'critical'
  WHEN UPPER(BTRIM(${column})) IN ('INFO','INFORMATION','INFORMATIONAL','LOW','MESSAGE') THEN 'info'
  ELSE 'noncritical' END`;

async function appendEvent(client, { id, companyId, machineId, at, receivedAt, fields }) {
  // Only critical notifications are enabled in this phase. Keep severity
  // snapshots for escalation detection without producing normal/info work.
  if (alarmSeverityClass(fields.severity) !== 'critical') return false;
  const result = await client.query(`INSERT INTO alarm_notification_events
    (alarm_id, company_id, machine_id, severity_class, occurred_at, received_at, alarm_type, alarm_code, severity, message)
    VALUES ($1,$2,$3,$4,to_timestamp($5),$6::timestamptz,$7,$8,$9,$10)
    ON CONFLICT (alarm_id, severity_class, occurred_at) DO NOTHING RETURNING id`,
  [id, companyId, machineId, alarmSeverityClass(fields.severity), at, receivedAt,
    fields.alarmType, fields.alarmCode, fields.severity, fields.message]);
  return result.rows.length > 0;
}

async function updatePriority(client, { companyId, machineId, at, receivedAt, fields }) {
  // Row locking makes a priority change and its durable event indivisible.
  // Device time orders observations; real arrival time breaks ties for two
  // different controller snapshots carrying the same one-second device time.
  const result = await client.query(`WITH target AS (
      SELECT id, severity, ${classSql('severity')} AS previous_class
      FROM machine_alarms
      WHERE company_id = $1 AND machine_id = $2 AND ended_at IS NULL
        AND started_at <= to_timestamp($3) AND COALESCE(alarm_code, alarm_type) = $4
        AND (severity_observed_at IS NULL OR severity_observed_at < to_timestamp($3)
          OR (severity_observed_at = to_timestamp($3) AND
            COALESCE(severity_received_at, severity_observed_at) < $5::timestamptz))
      FOR UPDATE
    ) UPDATE machine_alarms a SET severity = $6,
        alarm_type = $7, message = $8, severity_observed_at = to_timestamp($3), severity_received_at = $5::timestamptz,
        notification_priority_changed_at = CASE WHEN target.previous_class <> $9
          THEN to_timestamp($3) ELSE a.notification_priority_changed_at END
      FROM target WHERE a.id = target.id
      RETURNING a.id, target.previous_class`,
  [companyId, machineId, at, fields.alarmCode ?? fields.alarmType, receivedAt,
    fields.severity, fields.alarmType, fields.message, alarmSeverityClass(fields.severity)]);
  const changed = result.rows[0];
  if (!changed || changed.previous_class === alarmSeverityClass(fields.severity)) return false;
  return appendEvent(client, { id: changed.id, companyId, machineId, at, receivedAt, fields });
}

export async function writeAlarmTransition(client, transition) {
  const { companyId, machineId, shiftId, at, opens = [], updates = [], closes = [], keep } = transition;
  // Old accepted journal records have no network-arrival timestamp. Their
  // device time is the conservative fallback; never make replay look fresh.
  const receivedAt = transition.receivedAt || new Date(at * 1000).toISOString();
  if (keep !== undefined || closes.length) {
    await client.query(`UPDATE machine_alarms SET ended_at = to_timestamp($3), ended_received_at = $5::timestamptz
      WHERE company_id = $1 AND machine_id = $2 AND ended_at IS NULL AND started_at <= to_timestamp($3)
        AND COALESCE(severity_observed_at, started_at) <= to_timestamp($3)
        AND (severity_observed_at IS DISTINCT FROM to_timestamp($3)
          OR COALESCE(severity_received_at, severity_observed_at) <= $5::timestamptz)
        AND ${keep !== undefined ? 'NOT (COALESCE(alarm_code, alarm_type) = ANY($4::text[]))' : 'COALESCE(alarm_code, alarm_type) = ANY($4::text[])'}
        ${keep !== undefined && transition.preserveUnknownBattery ? `AND (
          NOT (COALESCE(alarm_code, alarm_type) = 'FANUC_CNC_BATTERY'
            OR COALESCE(alarm_code, alarm_type) ~ '^FANUC_ACC_[A-Z][A-Z0-9_]{0,7}_(ABP|INP|EXP|LOW)$')
          OR COALESCE(alarm_code, alarm_type) = ANY($6::text[]))` : ''}`,
    [companyId, machineId, at, keep !== undefined ? keep : closes, receivedAt,
      ...(keep !== undefined && transition.preserveUnknownBattery ? [transition.batteryClears || []] : [])]);
  }
  // A cold collector cannot prove that an existing alarm stayed active
  // while its accepted baseline was unavailable. Keep reporting history,
  // but start notification qualification at this confirmed observation.
  // Journal replay must never move a newer continuity boundary backwards.
  if (keep?.length) {
    await client.query(`UPDATE machine_alarms
      SET notification_continuity_started_at = GREATEST(notification_continuity_started_at, to_timestamp($3))
      WHERE company_id = $1 AND machine_id = $2 AND ended_at IS NULL AND started_at <= to_timestamp($3)
        AND COALESCE(alarm_code, alarm_type) = ANY($4::text[])`,
    [companyId, machineId, at, keep]);
  }
  let notify = false;
  for (const alarm of opens) {
    const fields = alarmFields(alarm);
    const result = await client.query(`INSERT INTO machine_alarms
      (company_id, machine_id, shift_id, alarm_type, alarm_code, severity, message, started_at, created_at,
        notification_priority_changed_at, severity_observed_at, severity_received_at)
      SELECT $1,$2,$3,$4::varchar(50),$5::varchar(50),$6,$7,to_timestamp($8),NOW(),to_timestamp($8),to_timestamp($8),$9::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM machine_alarms prior
        WHERE prior.company_id = $1 AND prior.machine_id = $2 AND COALESCE(prior.alarm_code, prior.alarm_type) = COALESCE($5::varchar(50),$4::varchar(50))
          AND (prior.started_at > to_timestamp($8) OR prior.ended_at > to_timestamp($8)
            OR (prior.started_at = to_timestamp($8)
              AND COALESCE(prior.severity_received_at, prior.created_at, prior.started_at) >= $9::timestamptz)
            OR (prior.ended_at = to_timestamp($8)
              AND COALESCE(prior.ended_received_at, prior.ended_at) >= $9::timestamptz)))
      ON CONFLICT DO NOTHING RETURNING id`,
    [companyId, machineId, shiftId, fields.alarmType, fields.alarmCode, fields.severity, fields.message, at, receivedAt]);
    if (result.rows[0]) {
      notify = await appendEvent(client, { id: result.rows[0].id, companyId, machineId, at, receivedAt, fields }) || notify;
    } else {
      notify = await updatePriority(client, { companyId, machineId, at, receivedAt, fields }) || notify;
    }
  }
  for (const alarm of updates) {
    notify = await updatePriority(client, { companyId, machineId, at, receivedAt, fields: alarmFields(alarm) }) || notify;
  }
  // PostgreSQL releases NOTIFY only on COMMIT. The event remains the source
  // of truth if the API listener is disconnected or the notify is coalesced.
  if (notify) await client.query("SELECT pg_notify('cnc_alarm_events', '')");
}
