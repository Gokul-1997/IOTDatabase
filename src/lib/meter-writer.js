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
const CONFLICT = `ON CONFLICT (machine_id, read_at) DO UPDATE SET ${MERGE.join(', ')},
                   standalone_fields = ARRAY(SELECT DISTINCT unnest(energy_meter_readings.standalone_fields || EXCLUDED.standalone_fields)),
                   standalone = energy_meter_readings.standalone OR EXCLUDED.standalone
                 WHERE energy_meter_readings.company_id IS NOT DISTINCT FROM EXCLUDED.company_id`;
const INSERT  = `INSERT INTO energy_meter_readings (${COLUMNS.join(', ')})
                 VALUES (${VALUES.join(', ')})
                 ${CONFLICT}`;

// One typed array per column keeps the bind count constant, including for
// full 1,000-row journal batches (the scalar form needs over 58,000 binds).
const FIELD_TYPES = METER_FIELDS.map(([column]) => column === 'aux_interrupts' ? 'int' :
  /^(?:kwh_|kvarh_|kvah_|run_hours$)/.test(column) ? 'float8' : 'real');
const BATCH_TYPES = ['int', 'int', 'float8', ...FIELD_TYPES, 'jsonb', 'boolean'];
const BATCH_SELECT = COLUMNS.map(column => column === 'read_at' ? 'to_timestamp(u.read_at)' :
  column === 'standalone_fields' ? 'ARRAY(SELECT jsonb_array_elements_text(u.standalone_fields))' : `u.${column}`);
const BATCH_INSERT = `INSERT INTO energy_meter_readings (${COLUMNS.join(', ')})
  SELECT ${BATCH_SELECT.join(', ')}
  FROM unnest(${BATCH_TYPES.map((type, index) => `$${index + 1}::${type}[]`).join(', ')}) AS u(${COLUMNS.join(', ')})
  ${CONFLICT}`;

export const METER_BATCH_MAX_ROWS = 1000;

/**
 * Fold observations in journal order before a multi-row UPSERT: PostgreSQL
 * refuses to update the same conflict key twice within one statement.
 * Standalone precedence applies per supplied field, exactly as the SQL merge.
 * A tenant change on a conflict key starts another statement; this preserves
 * the DB guard even if the existing row belongs to the second tenant.
 * Statements must execute sequentially in the checkpoint transaction.
 */
export function* meterInsertBatches(observations, maxRows = METER_BATCH_MAX_ROWS) {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > METER_BATCH_MAX_ROWS) {
    throw new RangeError(`Meter batches require 1..${METER_BATCH_MAX_ROWS} rows`);
  }
  let rows = new Map();
  const statement = () => {
    const list = [...rows.values()];
    const values = COLUMNS.map((column, index) => list.map(row => index === 0 ? row.machineId :
      index === 1 ? row.companyId : index === 2 ? row.at :
      column === 'standalone_fields' ? JSON.stringify([...row.standaloneFields]) :
      column === 'standalone' ? row.standalone : row.reading[column] ?? null));
    return { text: BATCH_INSERT, values, rowCount: list.length };
  };
  for (const observation of observations) {
    const companyId = observation.companyId ?? null;
    // Device timestamps admitted to the durable journal are integer seconds.
    const key = `${observation.machineId}|${observation.at}`;
    let row = rows.get(key);
    if ((row && String(row.companyId) !== String(companyId)) || (!row && rows.size >= maxRows)) {
      yield statement();
      rows = new Map(); row = undefined;
    }
    if (!row) {
      row = { machineId: observation.machineId, companyId, at: observation.at,
        reading: {}, standaloneFields: new Set(), standalone: false };
      rows.set(key, row);
    }
    const standalone = observation.standalone === true;
    for (const [column] of METER_FIELDS) {
      const value = observation.reading[column];
      if (value == null) continue;
      if (!row.standaloneFields.has(column) || standalone) row.reading[column] = value;
      if (standalone) row.standaloneFields.add(column);
    }
    row.standalone ||= standalone;
  }
  if (rows.size) yield statement();
}

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

export { INSERT as METER_INSERT_SQL, BATCH_INSERT as METER_BATCH_INSERT_SQL };
