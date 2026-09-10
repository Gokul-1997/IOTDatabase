/**
 * Record alarm periods in machine_alarms.
 *
 * telemetry_raw already carries an `alarm` flag on every message, but a
 * flag on a million rows cannot answer the questions the alarm report
 * asks: how many alarms happened, how long each lasted, which shift it
 * fell in. Those need a row per alarm *period* — opened when a machine
 * starts alarming, closed when it stops.
 *
 * Called fire-and-forget from the message handler. Ingestion must never
 * slow down or fail because alarm bookkeeping had a bad moment: telemetry
 * is the product, this is a derived record that can be rebuilt.
 */

import { pool } from '../../db.js';

/* Without a code from the controller, the alarm is identified by its type.
   The unique index in migration 017 is on COALESCE(alarm_code, alarm_type),
   so this matches what the database considers "the same alarm". */
const UNKNOWN_TYPE = 'UNSPECIFIED';

/**
 * A machine has just started alarming.
 *
 * ON CONFLICT DO NOTHING against the partial unique index is what keeps
 * this idempotent: telemetry arrives every second while the alarm is
 * active, the broker replays messages after a restart, and pm2 runs
 * several instances — so this is called many times for one real alarm.
 * Without it a machine alarming for an hour produces thousands of rows and
 * every count on the report is meaningless.
 */
export async function openAlarm({ companyId, machineId, shiftId, payload, at }) {
  const alarmType = String(payload.alarm_type || payload.alarm_name || UNKNOWN_TYPE).slice(0, 100);
  const alarmCode = payload.alarm_code != null ? String(payload.alarm_code).slice(0, 50) : null;
  const severity  = String(payload.alarm_severity || 'NORMAL').toUpperCase().slice(0, 20);

  await pool.query(
    `INSERT INTO machine_alarms
       (company_id, machine_id, shift_id, alarm_type, alarm_code, severity,
        message, started_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT DO NOTHING`,
    [companyId, machineId, shiftId, alarmType, alarmCode, severity,
     payload.alarm_message || null, at]
  );
}

/**
 * The machine has stopped alarming: close whatever is open for it.
 *
 * Closes every open row for the machine rather than matching on code. The
 * telemetry we receive says "this machine is no longer in an alarm state",
 * not "alarm SV0401 cleared" — so leaving other rows open would strand
 * them as permanently-open alarms that inflate the open count forever.
 */
export async function closeAlarms({ machineId, at }) {
  await pool.query(
    `UPDATE machine_alarms
        SET ended_at = $2
      WHERE machine_id = $1
        AND ended_at IS NULL`,
    [machineId, at]
  );
}

/**
 * Decide what changed and record it.
 *
 * Only transitions are written. Calling this on every message would be one
 * write per second per machine to say nothing has changed.
 *
 * @param {object|null} prev  the previous live payload, or null after a restart
 */
export async function trackAlarm({ prev, isAlarm, companyId, machineId, shiftId, payload, deviceTime }) {
  const was = prev?.alarm === true;
  if (was === isAlarm) return;

  const at = new Date(deviceTime * 1000);
  if (isAlarm) await openAlarm({ companyId, machineId, shiftId, payload, at });
  else         await closeAlarms({ machineId, at });
}
