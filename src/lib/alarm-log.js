/**
 * Record alarm periods in machine_alarms — one row per alarm.
 *
 * telemetry_raw already carries an `alarm` flag on every message, but a flag
 * cannot answer what the alarm report asks: how many alarms happened, which
 * ones, how long each lasted, which shift they fell in. Those need a row per
 * alarm, opened when it appears and closed when it clears.
 *
 * A machine can carry several alarms at once — the 192.168.200.3 sample has
 * EX1046, EX1037 and EX1027 active together — and they do not clear together.
 * So each alarm is tracked by its own key: new codes open rows, codes that
 * disappear close theirs, and the machine leaving alarm closes everything.
 *
 * Called fire-and-forget from the message handler. Ingestion must never slow
 * down or fail because alarm bookkeeping had a bad moment.
 */

import { pool } from '../../db.js';
import { alarmIdentity, activeAlarms } from './condition-signals.js';

/* Without a code from the controller, the alarm is identified by its type.
   The unique index in migration 017 is on COALESCE(alarm_code, alarm_type),
   so this matches what the database considers "the same alarm". */
const UNKNOWN_TYPE = 'UNSPECIFIED';

/**
 * The value the open-alarm unique index keys on, after the same truncation
 * openAlarm applies — so a key computed here always matches the stored row.
 */
export function alarmKey(alarm) {
  if (alarm?.alarm_code != null) return String(alarm.alarm_code).slice(0, 50);
  return String(alarm?.alarm_type || UNKNOWN_TYPE).slice(0, 100);
}

/**
 * Open one alarm.
 *
 * ON CONFLICT DO NOTHING against the partial unique index keeps this
 * idempotent: the broker replays after a restart and pm2 runs several
 * instances, so it genuinely fires more than once for one real alarm.
 *
 * `alarm` is one entry from activeAlarms; without it the payload's first
 * alarm is used, as callers did before per-alarm tracking.
 */
export async function openAlarm({ companyId, machineId, shiftId, payload, alarm, at }) {
  const id = alarm || alarmIdentity(payload);
  const alarmType = String(id.alarm_type || UNKNOWN_TYPE).slice(0, 100);
  const alarmCode = id.alarm_code != null ? String(id.alarm_code).slice(0, 50) : null;
  const severity  = String(id.alarm_severity || 'NORMAL').toUpperCase().slice(0, 20);

  await pool.query(
    `INSERT INTO machine_alarms
       (company_id, machine_id, shift_id, alarm_type, alarm_code, severity,
        message, started_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT DO NOTHING`,
    [companyId, machineId, shiftId, alarmType, alarmCode, severity,
     id.alarm_message ? String(id.alarm_message).slice(0, 500) : null, at]
  );
}

/**
 * The machine has stopped alarming: close everything open for it.
 *
 * Every open row, not a list of codes — "no longer in alarm" covers all of
 * them, and leaving one open would strand it as permanently active.
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

/** Close specific alarms that cleared while others on the machine are still active. */
export async function closeAlarmKeys({ machineId, keys, at }) {
  if (!keys || !keys.length) return;
  await pool.query(
    `UPDATE machine_alarms
        SET ended_at = $2
      WHERE machine_id = $1
        AND ended_at IS NULL
        AND COALESCE(alarm_code, alarm_type) = ANY($3::text[])`,
    [machineId, at, keys]
  );
}

async function track({ prev, isAlarm, companyId, machineId, shiftId, payload, deviceTime, alarms }) {
  const was = prev?.alarm === true;
  const at = new Date(deviceTime * 1000);

  if (!isAlarm) {
    if (was) await closeAlarms({ machineId, at });
    return;
  }

  const now = alarms ?? activeAlarms(payload, { alarming: true });

  if (was) {
    /* Live state written before per-alarm tracking carries no codes. The
       set is treated as unchanged rather than guessed at: at worst a change
       waits for the next transition, whereas a guess could close a real
       alarm that is still active. */
    if (!Array.isArray(prev.alarm_codes)) return;

    const before = new Set(prev.alarm_codes);
    const after = new Set(now.map(alarmKey));
    for (const alarm of now) {
      if (!before.has(alarmKey(alarm))) {
        await openAlarm({ companyId, machineId, shiftId, alarm, at });
      }
    }
    await closeAlarmKeys({ machineId, keys: [...before].filter(k => !after.has(k)), at });
    return;
  }

  for (const alarm of now) await openAlarm({ companyId, machineId, shiftId, alarm, at });
}

/*
 * Per machine, writes run one after another.
 *
 * The caller does not await this, so without a chain an alarm that appears
 * and clears in consecutive messages could run its close before its open had
 * committed — leaving a cleared alarm open forever. Messages for one machine
 * are already serialised upstream; this keeps their alarm writes in the same
 * order.
 */
const chains = new Map();

export function trackAlarm(args) {
  const key = args.machineId;
  const next = (chains.get(key) || Promise.resolve())
    .catch(() => {})
    .then(() => track(args));
  chains.set(key, next);
  const cleanup = () => { if (chains.get(key) === next) chains.delete(key); };
  next.then(cleanup, cleanup);
  return next;
}
