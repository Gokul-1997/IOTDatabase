/*
 * Write a machine's full energy-meter reading to energy_meter_readings.
 *
 * At most one row per machine every 15 seconds: the meter's values move
 * slowly, and its own demand and maximum registers keep the peaks between
 * rows. Every message would be ~17,000 rows a day a machine for no gain.
 *
 * It is a record alongside telemetry, never in its way. If the table is not
 * there yet (migration 029 not run, SQLSTATE 42P01) or the ingestion user
 * may not write it (42501), meter writes are switched off for the life of
 * the process and the fix is logged once. Telemetry, energy totals and
 * alarms are unaffected either way.
 */

import { METER_FIELDS } from './power-signals.js';

const COLUMNS = ['machine_id', 'company_id', 'read_at', ...METER_FIELDS.map(([c]) => c)];
const VALUES  = COLUMNS.map((c, i) => (c === 'read_at' ? `to_timestamp($${i + 1})` : `$${i + 1}`));
const INSERT  = `INSERT INTO energy_meter_readings (${COLUMNS.join(', ')})
                 VALUES (${VALUES.join(', ')})
                 ON CONFLICT (machine_id, read_at) DO NOTHING`;

const FIX = {
  '42P01': 'the energy_meter_readings table does not exist — run the Backend migrations (029_energy_meter_readings.sql).',
  '42501': 'the ingestion database user may not write energy_meter_readings — ' +
           'GRANT SELECT, INSERT ON energy_meter_readings TO <ingestion db user>;'
};

export const METER_INTERVAL_SEC = 15;

export function createMeterWriter({ pool, log, intervalSec = METER_INTERVAL_SEC }) {
  const lastAt = new Map();      // machine id → device time of the last row written
  let disabled = false;

  return async function recordMeterReading({ machineId, companyId, at, reading }) {
    if (disabled || !reading || !machineId || !Number.isFinite(at)) return;

    const last = lastAt.get(machineId);
    /* Measured in the device's own seconds, not the server's. A clock set
       back by more than an hour starts over rather than going quiet. */
    if (last !== undefined && at < last + intervalSec && at > last - 3600) return;
    lastAt.set(machineId, at);

    const params = [machineId, companyId ?? null, at, ...METER_FIELDS.map(([c]) => reading[c] ?? null)];
    try {
      await pool.query(INSERT, params);
    } catch (err) {
      const fix = err && FIX[err.code];
      if (fix) {
        disabled = true;
        log('error', 'energy meter readings switched off — ' + fix +
          ' Telemetry, energy totals and alarms are unaffected.', { error: err.message });
        return;
      }
      throw err;
    }
  };
}

export { INSERT as METER_INSERT_SQL };
