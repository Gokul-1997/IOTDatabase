import { createHash } from 'node:crypto';

// PostgreSQL VARCHAR(n) limits characters, rather than UTF-16 code units.
const TYPE_LIMIT = 50;
const CODE_LIMIT = 50;
const SEVERITY_LIMIT = 20;
const characters = value => Array.from(value);
const prefix = (value, limit) => characters(value).slice(0, limit).join('');
function keyWithin(value, limit) {
  if (characters(value).length <= limit) return value;
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${prefix(value, limit - digest.length - 1)}~${digest}`;
}

/** One contract for the persisted open-alarm key and every alarm writer. */
export function alarmFields(alarm) {
  const type = String(alarm?.alarm_type || 'UNSPECIFIED');
  const code = alarm?.alarm_code != null ? String(alarm.alarm_code) : null;
  const alarmCode = code === null ? null : keyWithin(code, CODE_LIMIT);
  let alarmType = prefix(type, TYPE_LIMIT);
  if (code === null && characters(type).length > TYPE_LIMIT) {
    // A plain prefix would merge distinct code-less controller descriptions.
    alarmType = keyWithin(type, TYPE_LIMIT);
  }
  const details = [];
  if (alarmType !== type) details.push(`Alarm type: ${type}`);
  if (alarmCode !== code) details.push(`Alarm code: ${code}`);
  if (alarm?.alarm_message) details.push(String(alarm.alarm_message));
  return {
    alarmType,
    alarmCode,
    severity: prefix(String(alarm?.alarm_severity || 'NORMAL').toUpperCase(), SEVERITY_LIMIT),
    message: details.length ? details.join('\n') : null
  };
}

export function alarmKey(alarm) {
  const { alarmCode, alarmType } = alarmFields(alarm);
  return alarmCode ?? alarmType;
}
