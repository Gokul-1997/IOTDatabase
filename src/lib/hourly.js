/*
 * The time between two readings of a machine, split into the rows of
 * production_hourly it belongs to.
 *
 * The interval [from, to) is credited to the state the machine was in at
 * `from` (the earlier reading), as before: running → run seconds, anything
 * else → idle seconds, and MANUAL/SETUP mode also → manual seconds.
 *
 * Three corrections to the previous version (mqtt.js updateHourlyProduction):
 *   - It split intervals at UTC hour boundaries, which fall at hh:30 in IST,
 *     while the rows are IST hours. An interval crossing 10:00 IST was
 *     credited wholly to 09:00. It is now split at IST hours, and at shift
 *     starts and ends, so each part lands in its own hour and shift.
 *   - It added the parts produced to EVERY slice, so an interval that crossed
 *     a boundary counted its parts twice. Parts are now counted once, in the
 *     slice that holds the later reading — when they were seen.
 *   - The shift of each slice is read at its midpoint, so a slice starting
 *     exactly on 14:00 belongs to the shift that starts at 14:00, not to the
 *     one that ends then.
 * Energy is spread over the slices by duration, as before.
 */
import { IST_OFFSET_SEC, shiftAt, shiftBoundariesBetween } from './shifts.js';

const RUN_STATES    = new Set(['RUN', 'RUNNING', 'CUTTING']);
const MANUAL_STATES = new Set(['MANUAL', 'SETUP']);

/** Start of the IST clock hour containing `epochSec`, as epoch seconds. */
export function istHourStart(epochSec) {
  return Math.floor((epochSec + IST_OFFSET_SEC) / 3600) * 3600 - IST_OFFSET_SEC;
}

/**
 * @param {object} p
 * @param {number} p.companyId
 * @param {number} p.machineId
 * @param {string} p.prevStatus   machine_status at `from`
 * @param {string} p.prevMode     mode at `from`
 * @param {number} p.from         epoch s of the earlier reading
 * @param {number} p.to           epoch s of this reading
 * @param {number} p.produced     parts counted at `to`
 * @param {number|null} p.energy  kWh used over the interval, or null
 * @param {Array} p.shifts        the company's shifts (shifts.js format)
 * @returns {Array<{company_id, machine_id, shift_id, hour_start, run, idle, manual, produced, energy}>}
 *   Slices outside every shift are left out: production_hourly rows are per shift.
 */
export function hourlySlices({ companyId, machineId, prevStatus, prevMode, from, to, produced = 0, energy = null, shifts }) {
  if (!from || !to || !(to > from)) return [];

  const cuts = new Set([from, to]);
  for (let h = istHourStart(from) + 3600; h < to; h += 3600) if (h > from) cuts.add(h);
  for (const b of shiftBoundariesBetween(shifts, from, to)) cuts.add(b);
  const points = [...cuts].sort((a, b) => a - b);

  const running = RUN_STATES.has(String(prevStatus || '').toUpperCase());
  const manual  = MANUAL_STATES.has(String(prevMode || '').toUpperCase());
  const total   = to - from;

  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const sec = b - a;
    if (sec <= 0) continue;
    const shiftId = shiftAt(shifts, a + sec / 2);
    if (!shiftId) continue;
    const last = i === points.length - 2;
    out.push({
      company_id: companyId,
      machine_id: machineId,
      shift_id:   shiftId,
      hour_start: istHourStart(a),
      run:        running ? sec : 0,
      idle:       running ? 0 : sec,
      manual:     manual ? sec : 0,
      produced:   last ? (produced || 0) : 0,
      energy:     energy != null ? Number((energy * sec / total).toFixed(4)) : 0
    });
  }
  return out;
}

/**
 * Many slices summed by row (machine, shift, hour), so a batch is one upsert
 * per row rather than one per reading.
 */
export function sumSlices(slices) {
  const m = new Map();
  for (const s of slices) {
    const k = `${s.machine_id}|${s.shift_id}|${s.hour_start}`;
    const t = m.get(k);
    if (!t) { m.set(k, { ...s }); continue; }
    t.run += s.run; t.idle += s.idle; t.manual += s.manual; t.produced += s.produced;
    t.energy = Number((t.energy + s.energy).toFixed(4));
  }
  return [...m.values()];
}
