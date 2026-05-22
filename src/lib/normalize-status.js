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
  if (val == null) return null;
  const str = String(val).trim().replace(',', '.');
  const n   = parseFloat(str.replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? null : n;
}
