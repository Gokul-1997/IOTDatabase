/*
 * Pure status normalisation. Machines send a variety of strings; we collapse
 * them into the binary state the rest of the system reasons about.
 */

const RUN_STATES = new Set(['RUN', 'RUNNING', 'CUTTING']);

export function normalizeMachineState(status) {
  if (!status) return { machine_status: 'IDLE', alarm: false };
  const s = String(status).toUpperCase();
  if (RUN_STATES.has(s)) return { machine_status: 'RUNNING', alarm: false };
  if (s === 'ALARM')     return { machine_status: 'IDLE',    alarm: true  };
  return { machine_status: 'IDLE', alarm: false };
}

export function parseEnergy(val) {
  if (typeof val === 'number') return Number.isFinite(val) && val >= 0 ? val : null;
  if (typeof val !== 'string') return null;
  // Read the whole value, including its sign and exponent. Stripping text
  // could turn "error123" or "-12 kWh" into a real positive meter reading.
  // The two deployed payload forms (a number and a number with kWh) and
  // decimal-comma collectors are accepted without guessing other units.
  const str = val.trim();
  if (!/^[+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?(?:\s*kwh)?$/i.test(str)) return null;
  const n = Number(str.replace(/\s*kwh$/i, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
