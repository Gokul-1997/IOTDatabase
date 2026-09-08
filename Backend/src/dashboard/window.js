/*
 * Shared time-window resolution for the Phase 2 analytics dashboards.
 *
 * Extracted from factory.service.js when the Maintenance dashboard needed
 * exactly the same behaviour: every analytics screen takes the same
 * date + shift + machine filter trio and must resolve them identically, or
 * two screens filtered the same way would disagree with each other.
 */

const db = require('../db');

/**
 * Turn a date (+ optional shift) into a concrete [from, to) window.
 *
 * Times are built in +05:30 because the plants are in India and the server
 * may not be — see the TZ note in ecosystem.config.js.
 */
async function resolveWindow(companyId, { date, shift_id }) {
  const day = date || new Date().toISOString().slice(0, 10);

  if (!shift_id) {
    return {
      from: `${day}T00:00:00+05:30`,
      to:   `${day}T23:59:59.999+05:30`,
      day,
      shift: null
    };
  }

  const { rows, rowCount } = await db.query(
    `SELECT id, shift_code, start_time, end_time
     FROM shifts WHERE id = $1 AND company_id = $2`,
    [shift_id, companyId]
  );
  if (rowCount === 0) throw new Error('Shift not found or access denied');

  const shift = rows[0];
  const overnight = String(shift.start_time) > String(shift.end_time);

  // an overnight shift dated the 5th runs 05→06
  const endDay = overnight
    ? new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
    : day;

  return {
    from: `${day}T${shift.start_time}+05:30`,
    to:   `${endDay}T${shift.end_time}+05:30`,
    day,
    shift
  };
}

/** WHERE fragment + params shared by the hourly rollup queries. */
function scope(companyId, win, machineId, startIdx = 1) {
  const params = [companyId, win.from, win.to];
  let sql = `company_id = $${startIdx} AND hour_start >= $${startIdx + 1} AND hour_start < $${startIdx + 2}`;
  if (machineId) {
    params.push(machineId);
    sql += ` AND machine_id = $${startIdx + 3}`;
  }
  return { sql, params };
}

module.exports = { resolveWindow, scope };
