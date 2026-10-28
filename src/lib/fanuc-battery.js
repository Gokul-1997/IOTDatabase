/** FANUC diagnostics supplied by the embedded collector. Never trust payload brand names. */
import { canonicalPayload } from './condition-signals.js';

const AXIS = /^[A-Z][A-Z0-9_]{0,7}$/;
const BATTERY_CODE = /^FANUC_ACC_([A-Z][A-Z0-9_]{0,7})_(ABP|INP|EXP|LOW)$/;
const CNC_CODE = 'FANUC_CNC_BATTERY';
const BITS = { ABP: 3, INP: 4, EXP: 5 };
const MEANINGS = {
  ABP: 'A/B phase detector battery voltage is low',
  INP: 'Built-in serial pulse coder battery voltage is low',
  EXP: 'External serial detector battery voltage is low',
  LOW: 'Absolute encoder battery warning is active'
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const flag = value => value === true || value === 1 || value === '1' ? true
  : value === false || value === 0 || value === '0' ? false : null;
const integer = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
};
const text = (value, limit) => typeof value === 'string'
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\uD800-\uDFFF]/gu, '').trim()).slice(0, limit).join('') || null : null;
const metadata = value => {
  const status = text(value.status, 64), source = text(value.source, 160);
  return { ...(status ? { status } : {}), ...(source ? { source } : {}) };
};
const combine = (...values) => values.includes(true) ? true : values.includes(false) ? false : null;

/** A missing/invalid diagnostic stays unknown; positive evidence wins contradictory clear flags. */
function axisStatus(value) {
  if (!object(value)) return null;
  const raw = integer(value.raw);
  const lowFlag = flag(value.low);
  const bits = {};
  for (const [name, bit] of Object.entries(BITS)) {
    bits[name] = combine(flag(value[name]), raw === null ? null : (raw & (1 << bit)) !== 0);
  }
  const low = bits.ABP === true || bits.INP === true || bits.EXP === true ? true
    : lowFlag !== null ? lowFlag : Object.values(bits).every(state => state === false) ? false : null;
  // An explicitly clear aggregate is evidence that no detector battery bit is active.
  if (low === false) for (const name of Object.keys(bits)) if (bits[name] === null) bits[name] = false;
  return { low, raw, ...bits, ...metadata(value) };
}

export function fanucBatterySignals(payload, controllerType) {
  if (String(controllerType || '').trim().toUpperCase() !== 'FANUC') {
    return { acc_battery_status: null, cnc_battery_warning: null };
  }
  const p = canonicalPayload(payload) || {};
  let acc = null;
  if (object(p.acc_battery)) {
    const entries = [];
    for (const [key, value] of Object.entries(p.acc_battery)) {
      const axis = key.trim().toUpperCase();
      if (!AXIS.test(axis) || entries.some(([name]) => name === axis)) continue;
      const state = axisStatus(value);
      if (!state) continue;
      entries.push([axis, state]);
      if (entries.length === 16) break;
    }
    if (entries.length) acc = Object.fromEntries(entries);
  }
  const warning = object(p.cnc_battery_warning) ? {
    // cnc_statinfo's general alarm mask is metadata, not a battery diagnostic.
    warning: flag(p.cnc_battery_warning.warning),
    raw_alarm_value: integer(p.cnc_battery_warning.raw_alarm_value),
    ...metadata(p.cnc_battery_warning)
  } : null;
  return { acc_battery_status: acc, cnc_battery_warning: warning };
}

export function isFanucBatteryCode(code) {
  return typeof code === 'string' && (code === CNC_CODE || BATTERY_CODE.test(code));
}

function alarmFor(code) {
  if (code === CNC_CODE) return { alarm_code: code, alarm_type: 'CNC BATTERY', alarm_severity: 'NORMAL',
    alarm_message: 'CNC battery warning is active. Arrange a battery inspection.' };
  const [, axis, bit] = BATTERY_CODE.exec(code);
  return { alarm_code: code, alarm_type: 'ABSOLUTE ENCODER BATTERY', alarm_severity: 'NORMAL',
    alarm_message: `Axis ${axis}: ${MEANINGS[bit]}. Arrange a battery inspection.` };
}

/** Retain previous warnings until their own diagnostic explicitly clears them. */
export function fanucBatteryAlarms(signals, previousCodes = []) {
  const observed = new Map();
  for (const [axis, value] of Object.entries(signals.acc_battery_status || {})) {
    for (const name of Object.keys(BITS)) observed.set(`FANUC_ACC_${axis}_${name}`, value[name]);
    const specific = Object.keys(BITS).some(name => value[name] === true);
    observed.set(`FANUC_ACC_${axis}_LOW`, specific ? false : value.low);
  }
  observed.set(CNC_CODE, signals.cnc_battery_warning?.warning ?? null);
  const codes = new Set((Array.isArray(previousCodes) ? previousCodes : []).filter(isFanucBatteryCode).slice(0, 65));
  for (const [code, state] of observed) {
    if (state === false) codes.delete(code);
    if (state === true && codes.size < 65) codes.add(code);
  }
  return { codes: [...codes], alarms: [...codes].map(alarmFor),
    cleared: [...observed].filter(([, state]) => state === false).map(([code]) => code) };
}
