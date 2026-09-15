/*
 * Machine condition signals and alarms — reading what the FOCAS collector sends.
 *
 * Built against two real payloads from the embedded team:
 *
 *   192.168.200.2  3-axis, running. `encoder_temperatures: {}`, every fan
 *                  null, a corrupt `position` block.
 *   192.168.200.3  4-axis (X Y Z A), alarming. `Encoder_temperature` with a
 *                  capital E and no "s", servo temperatures
 *                  {"X":0,"Y":0,"Z":45,"A":0}, and three PMC alarms shaped
 *                  {number, type, axis, message}.
 *
 * What those two show, and what everything below is built around:
 *
 *   - Collectors in the field disagree on key spelling and case, so
 *     top-level keys are matched case-insensitively.
 *   - A per-axis map can be absent, empty or partial, and a machine can have
 *     more than three axes. Each axis is independently nullable; A/B/C are
 *     kept, not dropped.
 *   - A temperature of 0 °C is the controller saying "no sensor". Load,
 *     pulse and resistance keep their zeros.
 *   - A machine can carry several alarms at once, each with its own code.
 */

/** Parse to a finite number, or null. Never NaN — NaN in a gauge is worse
 *  than an empty gauge, because it looks like a reading. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * A temperature, where 0 or below means no reading.
 *
 * A servo motor, encoder or spindle motor at 0 °C does not exist on a
 * working machine in this plant. Fanuc diagnosis 308/309 reads 0 when the
 * motor's pulse coder has no temperature sensor — the 192.168.200.3 sample
 * reports {"X":0,"Y":0,"Z":45,"A":0} on a machine alarming mid-shift. Stored
 * as 0 it would show three servos at 0 °C; stored as null it shows "--".
 *
 * Deliberately not applied to load, pulse diagnostic or insulation
 * resistance: 0 % load on an idle axis is real, and 0 resistance is a dead
 * short that must never be hidden.
 */
export function temperature(v) {
  const n = num(v);
  return n === null || n <= 0 ? null : n;
}

/**
 * The payload with its top-level keys lower-cased.
 *
 * Two collectors already disagree: one sends `encoder_temperatures`, the
 * other `Encoder_temperature`. Matching keys exactly silently drops whichever
 * spelling the parser does not expect. Nested keys are left as sent — axis
 * letters are matched case-insensitively where they are read, and fan names
 * are stored as the controller names them.
 *
 * When the same key arrives twice in different case, the exactly lower-case
 * one wins whatever the order, so the result never depends on key order.
 */
export function canonicalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const out = {};
  for (const [rawKey, value] of Object.entries(payload)) {
    const key = String(rawKey).trim().toLowerCase();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(out, key) && rawKey !== key) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Split a per-axis map into the three columns plus whatever is left.
 *
 * Axis keys are matched case-insensitively and trimmed, because controllers
 * disagree ("X", "x", "X "). `read` decides what a value means — plain
 * numbers by default, `temperature` for the maps where 0 means no sensor.
 */
export function splitAxes(map, read = num) {
  const out = { x: null, y: null, z: null, extra: null };
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;

  for (const [rawKey, rawValue] of Object.entries(map)) {
    const key = String(rawKey).trim().toUpperCase();
    if (!key) continue;
    const value = read(rawValue);

    if (key === 'X' || key === 'Y' || key === 'Z') {
      out[key.toLowerCase()] = value;
      continue;
    }
    // A, B, C on wider machines — kept, so a 4- or 5-axis machine loses nothing
    if (value !== null) {
      if (!out.extra) out.extra = {};
      out.extra[key] = value;
    }
  }
  return out;
}

/**
 * Fan states, or null when the controller reports none.
 *
 * Null rather than an object of nulls, so the column stays empty until a
 * controller actually has fans to report. Numbers and words ("OK", "NG") are
 * both kept as sent — coercing "OK" to a number would turn it into null.
 */
export function fanStatus(fans) {
  if (!fans || typeof fans !== 'object' || Array.isArray(fans)) return null;

  const out = {};
  for (const [key, value] of Object.entries(fans)) {
    if (value === null || value === undefined) continue;
    out[String(key).slice(0, 64)] = typeof value === 'number' ? value : String(value).slice(0, 32);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Is the machine in an alarm state?
 *
 * Twelve million stored messages answered "no", because the collector only
 * checked for the literal string "ALARM" while the first controller sent
 * "STOP" and carried the alarm in the FOCAS status flags. Any of these means
 * alarming: `stat_alarm`, `stat_emergency`, a PMC alarm, or the string.
 */
export function isAlarming(payload) {
  const p = canonicalPayload(payload);
  if (!p || typeof p !== 'object') return false;

  if (num(p.stat_alarm))     return true;
  if (num(p.stat_emergency)) return true;

  const pmc = p.pmc_alarm;
  if (pmc && typeof pmc === 'object') {
    if (num(pmc.exist)) return true;
    if (num(pmc.count)) return true;
    if (Array.isArray(pmc.alarms) && pmc.alarms.length > 0) return true;
  }

  return String(p.machine_status || '').toUpperCase() === 'ALARM';
}

/* Fanuc alarm types as returned by FOCAS cnc_rdalmmsg2 on 0i/30i controls,
   mapped to the prefix the controller shows on screen: type 15 with number
   1046 is displayed as EX1046. */
const FOCAS_ALARM_TYPES = {
  0: 'SW', 1: 'PW', 2: 'IO', 3: 'PS', 4: 'OT', 5: 'OH', 6: 'SV', 7: 'SR',
  8: 'MC', 9: 'SP', 10: 'DS', 11: 'IE', 12: 'BG', 13: 'SN', 15: 'EX', 19: 'PC'
};

/* Servo, spindle and overheat alarms stop the machine for a hardware reason,
   which is what Preventive Maintenance counts as critical. Every other type
   stays at the normal default unless the collector sends a severity. */
const CRITICAL_ALARM_TYPES = new Set(['SV', 'SP', 'OH']);

const EMPTY_ALARM = Object.freeze({
  alarm_code: null, alarm_type: null, alarm_message: null, alarm_severity: null
});

/**
 * One entry of `pmc_alarm.alarms`, in any of the shapes seen so far:
 *
 *   { "number": 1046, "type": 15, "axis": 0, "message": "M06 TIMEOUT ALARM" }   FOCAS, as sent
 *   { "code": "SV0401", "message": "...", "severity": "CRITICAL" }             explicit
 *   "EX1002"                                                                     a bare code
 *
 * Returns null for an entry with nothing to identify it by, rather than
 * inventing "[object Object]" as a code.
 */
function parseAlarmEntry(entry) {
  if (entry === null || entry === undefined) return null;
  if (typeof entry !== 'object') {
    const code = String(entry).trim();
    return code ? { ...EMPTY_ALARM, alarm_code: code } : null;
  }
  if (Array.isArray(entry)) return null;

  const t = entry.type === null || entry.type === undefined ? '' : String(entry.type).trim();
  let prefix = null;
  let typeName = null;
  if (/^\d+$/.test(t))              prefix = FOCAS_ALARM_TYPES[Number(t)] ?? null;
  else if (/^[A-Za-z]{2}$/.test(t)) prefix = t.toUpperCase();
  else if (t)                       typeName = t;

  const message = [entry.message, entry.text, entry.msg]
    .find(m => typeof m === 'string' && m.trim())?.trim() ?? null;
  const axis = num(entry.axis);

  let code = null;
  if (typeof entry.code === 'string' && entry.code.trim()) {
    code = entry.code.trim();
  } else {
    const n = num(entry.number ?? entry.code ?? entry.alarm_no);
    if (n !== null) {
      const digits = String(Math.trunc(Math.abs(n)));
      code = prefix ? prefix + digits.padStart(4, '0') : digits;
    }
  }

  const name = entry.name ? String(entry.name) : null;
  if (code === null && !message && !typeName && !name) return null;

  const severity = typeof entry.severity === 'string' && entry.severity.trim()
    ? entry.severity.trim()
    : (prefix && CRITICAL_ALARM_TYPES.has(prefix) ? 'CRITICAL' : null);

  return {
    alarm_code:     code,
    // the alarm's name on the report: the controller's own message
    alarm_type:     name || typeName || message || (prefix ? `${prefix} alarm` : null),
    alarm_message:  message && axis > 0 ? `${message} (axis ${axis})` : message,
    alarm_severity: severity
  };
}

/**
 * Every alarm active on the machine right now.
 *
 * The 192.168.200.3 sample carries three at once (EX1046, EX1037, EX1027);
 * reporting only the first would undercount the Alarm Report by two thirds.
 *
 * Explicit top-level fields (`alarm_code`, `alarm_type`, …) come first when
 * present; PMC entries follow; duplicates of the same code are dropped. A
 * machine that is alarming with nothing to name it still yields one entry,
 * because an alarm with no name is still an alarm. An emergency stop makes
 * the first entry CRITICAL whatever else the payload says.
 *
 * @param {object} payload
 * @param {{alarming?: boolean}} [opts]  override the alarming decision, when
 *        the caller has already made it
 */
export function activeAlarms(payload, { alarming } = {}) {
  const p = canonicalPayload(payload);
  if (!p || typeof p !== 'object') return [];
  if (!(alarming ?? isAlarming(p))) return [];

  const out = [];
  const seen = new Set();
  const add = alarm => {
    const key = alarm.alarm_code ?? alarm.alarm_type;
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(alarm);
  };

  const top = {
    alarm_code:     p.alarm_code != null && String(p.alarm_code).trim() ? String(p.alarm_code).trim() : null,
    alarm_type:     p.alarm_type || p.alarm_name || null,
    alarm_message:  p.alarm_message || null,
    alarm_severity: p.alarm_severity ? String(p.alarm_severity) : null
  };
  if (top.alarm_code || top.alarm_type || top.alarm_message) add(top);

  const list = Array.isArray(p.pmc_alarm?.alarms) ? p.pmc_alarm.alarms : [];
  for (const entry of list) {
    const alarm = parseAlarmEntry(entry);
    if (alarm) add(alarm);
  }

  if (!out.length) out.push({ ...top });

  if (num(p.stat_emergency)) {
    out[0] = { ...out[0], alarm_type: out[0].alarm_type ?? 'EMERGENCY STOP', alarm_severity: 'CRITICAL' };
  }
  return out;
}

/** The first active alarm — for callers that record a single alarm. */
export function alarmIdentity(payload) {
  const [first] = activeAlarms(payload, { alarming: true });
  return first ?? { ...EMPTY_ALARM };
}

/**
 * Everything Screen 2 needs, flattened into the telemetry_raw columns.
 *
 * Every field is independently nullable, so a controller that supplies one
 * axis, or none, stores exactly what it supplied.
 */
export function conditionSignals(payload) {
  const c = canonicalPayload(payload);
  const p = c && typeof c === 'object' ? c : {};

  const load  = splitAxes(p.servo_axis_load_percent ?? p.servo_load);
  const stemp = splitAxes(p.servo_motor_temperature ?? p.servo_temperature, temperature);
  // both spellings seen in the field: encoder_temperatures, Encoder_temperature
  const etemp = splitAxes(p.encoder_temperature ?? p.encoder_temperatures, temperature);
  const sir   = splitAxes(p.servo_motor_insulation_resistance ?? p.servo_insulation_resistance);
  const pulse = splitAxes(p.servo_pulse_diagnostic);

  /* Axes beyond X/Y/Z are merged into one object keyed by axis, so a 4-axis
     machine's A lands in one place rather than in five maps. */
  let extra = null;
  const mergeExtra = (split, label) => {
    if (!split.extra) return;
    if (!extra) extra = {};
    for (const [axis, value] of Object.entries(split.extra)) {
      (extra[axis] ||= {})[label] = value;
    }
  };
  mergeExtra(load,  'servo_load');
  mergeExtra(stemp, 'servo_temp');
  mergeExtra(etemp, 'encoder_temp');
  mergeExtra(sir,   'servo_insulation_res');
  mergeExtra(pulse, 'servo_pulse');

  const seq = num(p.current_sequence_number ?? p.sequence_number);

  return {
    spindle_speed:          num(p.spindle_speed),
    spindle_motor_temp:     temperature(p.spindle_motor_temperature ?? p.spindle_temperature),
    spindle_insulation_res: num(p.spindle_insulation_resistance),

    servo_load_x: load.x, servo_load_y: load.y, servo_load_z: load.z,
    servo_temp_x: stemp.x, servo_temp_y: stemp.y, servo_temp_z: stemp.z,
    encoder_temp_x: etemp.x, encoder_temp_y: etemp.y, encoder_temp_z: etemp.z,
    servo_insulation_res_x: sir.x, servo_insulation_res_y: sir.y, servo_insulation_res_z: sir.z,
    servo_pulse_x: pulse.x, servo_pulse_y: pulse.y, servo_pulse_z: pulse.z,

    cnc_battery_voltage: num(p.cnc_battery),
    apc_battery_voltage: num(p.apc_battery),

    sequence_number: seq === null ? null : Math.trunc(seq),

    fan_status: fanStatus(p.fans),
    extra_axes: extra
  };
}

/**
 * The controller's own identity. Constant per machine, so the caller writes
 * it to `machines` rather than to every telemetry row. Null when the payload
 * carries none of it, so a device sending only process data triggers no write.
 */
export function controllerIdentity(payload) {
  const c = canonicalPayload(payload);
  const p = c && typeof c === 'object' ? c : {};
  const axes = num(p.controlled_axes);

  const out = {
    controller_ip:    p.machine_ip ? String(p.machine_ip).slice(0, 45) : null,
    cnc_series:       p.series     ? String(p.series).slice(0, 32)     : null,
    cnc_version:      p.version    ? String(p.version).slice(0, 32)    : null,
    cnc_type:         p.cnc_type != null     ? String(p.cnc_type).slice(0, 16)     : null,
    cnc_machine_type: p.machine_type != null ? String(p.machine_type).slice(0, 16) : null,
    controlled_axes:  axes === null ? null : Math.trunc(axes)
  };
  return Object.values(out).some(v => v !== null) ? out : null;
}

/**
 * Did the collector say it could not reach the controller?
 *
 * A collector that loses the controller keeps publishing with whatever it
 * last held. Stored as live readings, a dead network link would count as an
 * idle machine. The caller drops these, so the machine goes OFFLINE through
 * the normal freshness window. Only an explicit "not connected" counts.
 */
export function isDisconnected(payload) {
  const p = canonicalPayload(payload);
  const conn = p && typeof p === 'object' ? p.connection : undefined;
  return conn === false || conn === 0 || conn === 'false' || conn === '0';
}

/**
 * The collector's per-call FOCAS return codes, or null. Kept per machine
 * because it is the only way to tell "no sensor on this axis" from "the read
 * for this axis failed". Capped at 8 KB, since it is written to a machine row.
 */
export function focasResult(payload) {
  const p = canonicalPayload(payload);
  const r = p && typeof p === 'object' ? p.focas_result : null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  return JSON.stringify(r).length <= 8192 ? r : null;
}
