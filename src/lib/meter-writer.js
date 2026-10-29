/*
 * Write the supplied energy-meter fields to energy_meter_readings.
 * Sparse messages are observations too: never wait for a complete block or
 * sample away a changed register. Messages in the same device second merge
 * into one row without clearing fields they did not supply.
 *
 * It is a record alongside telemetry, never in its way. If the table is not
 * there yet (migration 029 not run, SQLSTATE 42P01) or the ingestion user
 * may not write it (42501), meter writes are switched off for the life of
 * the process and the fix is logged once. Telemetry, energy totals and
 * alarms are unaffected either way.
 */

import { METER_FIELDS } from './power-signals.js';

const COLUMNS = ['machine_id', 'company_id', 'read_at', ...METER_FIELDS.map(([c]) => c), 'standalone_fields', 'standalone'];
const VALUES  = COLUMNS.map((c, i) => (c === 'read_at' ? `to_timestamp($${i + 1})` : `$${i + 1}`));
const MERGE = METER_FIELDS.map(([c]) => `${c} = CASE WHEN '${c}' = ANY(energy_meter_readings.standalone_fields) AND NOT '${c}' = ANY(EXCLUDED.standalone_fields) THEN energy_meter_readings.${c} ELSE COALESCE(EXCLUDED.${c}, energy_meter_readings.${c}) END`);
const INSERT  = `INSERT INTO energy_meter_readings (${COLUMNS.join(', ')})
                 VALUES (${VALUES.join(', ')})
                 ON CONFLICT (machine_id, read_at) DO UPDATE SET ${MERGE.join(', ')},
                   standalone_fields = ARRAY(SELECT DISTINCT unnest(energy_meter_readings.standalone_fields || EXCLUDED.standalone_fields)),
                   standalone = energy_meter_readings.standalone OR EXCLUDED.standalone
                 WHERE energy_meter_readings.company_id IS NOT DISTINCT FROM EXCLUDED.company_id`;

const FIX = {
  '42P01': 'the energy_meter_readings table does not exist — run the Backend migrations (029_energy_meter_readings.sql).',
  '42501': 'the ingestion database user may not write energy_meter_readings — ' +
           'run the Backend sparse-energy migration to grant SELECT, INSERT and measurement-column UPDATE on energy_meter_readings.'
};

// Retained for imports from earlier collectors; sparse observations are not sampled.
export const METER_INTERVAL_SEC = 0;

export function createMeterWriter({ pool, log }) {
  let disabled = false;

  return async function recordMeterReading({ machineId, companyId, at, reading }) {
    if (disabled || !reading || !machineId || !Number.isFinite(at)) return;

    const params = [machineId, companyId ?? null, at, ...METER_FIELDS.map(([c]) => reading[c] ?? null), [], false];
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
