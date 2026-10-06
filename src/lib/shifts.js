/*
 * Which shift a moment belongs to, worked out in memory.
 *
 * This used to be one SQL query per message (cached per minute). When the
 * database was unreachable the query failed, the shift came back null, and
 * mqtt.js dropped the whole message — live status included — so a database
 * blip turned into lost telemetry. The company's shifts change a few times a
 * year; they are now loaded every minute and matched here, with no query on
 * the hot path.
 *
 * The rule is the one the SQL used: the time of day in Asia/Kolkata, inclusive
 * of both ends (BETWEEN), with a shift whose start is after its end running
 * across midnight. Where two shifts share a boundary second, the one with the
 * lower id wins (the SQL had no ORDER BY, so it was arbitrary).
 */

export const IST_OFFSET_SEC = 19_800;   // UTC+05:30, no daylight saving
const DAY = 86_400;

/** "06:00:00" (or "06:00") → seconds after midnight. */
export function timeToSec(t) {
  const [h = 0, m = 0, s = 0] = String(t).split(':').map(Number);
  return h * 3600 + m * 60 + Math.floor(s);
}

/** Seconds after midnight in Asia/Kolkata for an epoch-seconds instant (fractions kept). */
export function istSecondOfDay(epochSec) {
  return ((epochSec + IST_OFFSET_SEC) % DAY + DAY) % DAY;
}

/**
 * The shift covering `epochSec`, or null.
 * @param {Array<{id:number,start:number,end:number}>} shifts start/end in seconds after midnight, sorted by id
 */
export function shiftAt(shifts, epochSec) {
  const t = istSecondOfDay(epochSec);
  for (const s of shifts) {
    const inside = s.start <= s.end
      ? t >= s.start && t <= s.end
      : t >= s.start || t <= s.end;           // across midnight
    if (inside) return s.id;
  }
  return null;
}

/** Boundaries (epoch s) of every shift start/end strictly inside (from, to). */
export function shiftBoundariesBetween(shifts, from, to) {
  const out = [];
  if (!shifts.length || to <= from) return out;
  // midnight (IST) of the day `from` falls on
  const dayStart = from - istSecondOfDay(from);
  for (let d = dayStart; d < to; d += DAY) {
    for (const s of shifts) {
      for (const sec of [s.start, s.end]) {
        const b = d + sec;
        if (b > from && b < to) out.push(b);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Every active shift of every company, reloaded every `refreshMs`. Until the
 * first load succeeds, shiftFor() answers null (telemetry is still stored;
 * only the hourly production split waits for a shift).
 */
export function createShiftCache({ pool, log = () => {}, refreshMs = 60_000 }) {
  let byCompany = new Map();
  let loaded = false;
  let timer = null;

  async function load() {
    const { rows } = await pool.query(
      `SELECT id, company_id, start_time, end_time
         FROM shifts
        WHERE is_active = TRUE AND company_id IS NOT NULL
        ORDER BY id`
    );
    const next = new Map();
    for (const r of rows) {
      const list = next.get(r.company_id) || [];
      list.push({ id: r.id, start: timeToSec(r.start_time), end: timeToSec(r.end_time) });
      next.set(r.company_id, list);
    }
    byCompany = next;
    loaded = true;
  }

  return {
    async start() {
      await load();
      timer = setInterval(() => load().catch(err =>
        log('warn', 'shift reload failed; keeping the last known shifts', { error: err.message })), refreshMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); },
    get loaded() { return loaded; },
    shiftsOf(companyId) { return byCompany.get(companyId) || []; },
    shiftFor(companyId, epochSec) { return shiftAt(byCompany.get(companyId) || [], epochSec); },
    /** for tests */
    _set(map) { byCompany = map; loaded = true; }
  };
}
