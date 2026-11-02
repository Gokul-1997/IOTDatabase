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

const ENERGY_UNITS = Object.freeze({ wh: 1 / 1000, kwh: 1, mwh: 1000 });
const POWER_UNITS = Object.freeze({ w: 1 / 1000, kw: 1, mw: 1000 });
const QUANTITY = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s*([a-z]+)?$/i;
const unitKey = text => {
  const unit = text.trim();
  // A lower-case m is milli, not mega. Reinterpreting mW as MW would create
  // a billionfold error. Milli-units are outside the telemetry contract.
  return unit.startsWith('m') ? null : unit.toLowerCase();
};

/**
 * Parse a complete electrical quantity without guessing its dimension. A bare
 * number uses the contract's canonical unit; an optional unit argument is
 * explicit metadata (or a fixed-unit key) and must agree with any suffix.
 * Energy is cumulative/nonnegative; active power retains its measured sign.
 */
function parseQuantity(value, unit, units, canonical, unsigned) {
  let number, suffix;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string') {
    const match = QUANTITY.exec(value.trim());
    if (!match) return null;
    number = Number(match[1].replace(',', '.'));
    suffix = match[2] === undefined ? undefined : unitKey(match[2]);
    if (match[2] !== undefined && suffix == null) return null;
  } else return null;
  if (!Number.isFinite(number) || (unsigned && number < 0)) return null;

  let explicit;
  if (unit !== undefined) {
    if (typeof unit !== 'string') return null;
    explicit = unitKey(unit);
    if (!Object.hasOwn(units, explicit)) return null;
  }
  if (suffix && (!Object.hasOwn(units, suffix) || (explicit && suffix !== explicit))) return null;
  const scale = units[suffix || explicit || canonical];
  // Divide by the exact 1000 factor instead of multiplying by its rounded
  // binary reciprocal (for example, -955 W should normalize to -0.955 kW).
  const normalized = scale < 1 ? number / (1 / scale) : number * scale;
  if (!Number.isFinite(normalized) || (number !== 0 && normalized === 0)) return null;
  return normalized === 0 ? 0 : normalized;
}

/** Canonical cumulative energy in kWh; old parseEnergy(value) callers remain valid. */
export function parseEnergy(value, unit) {
  return parseQuantity(value, unit, ENERGY_UNITS, 'kwh', true);
}

/** Canonical instantaneous active power in kW, including valid negative readings. */
export function parsePower(value, unit) {
  return parseQuantity(value, unit, POWER_UNITS, 'kw', false);
}
