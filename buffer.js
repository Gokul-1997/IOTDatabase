/*
 * How a reading becomes a telemetry_raw row.
 *
 * The in-memory buffer that used to live here is gone: accepted readings go
 * to the journal (src/lib/journal.js) and the writer (src/lib/flusher.js)
 * moves them into the database. This file keeps the column mapping both use.
 */
export { isDataError } from './src/lib/flusher.js';

function log(level, msg, meta = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error')     console.error(line);
  else if (level === 'warn') console.warn(line);
  else                       console.log(line);
}

/*
 * Column order for the telemetry_raw INSERT, and how each value is read
 * from a buffered row.
 *
 * This list is the single source of truth: the placeholder count, the
 * column list and the values array are all derived from it, so adding a
 * column is one line and cannot leave the three out of step. The previous
 * hand-maintained `COLS = 21` had to be updated in three places at once.
 *
 * machine_status and alarm are taken from the row as mqtt.js decided them.
 * This file used to re-derive both from the status string — but by the time
 * a row reaches the buffer that string is already "RUNNING" or "IDLE", never
 * "ALARM", so the alarm flag was recomputed to false on every row. Together
 * with the collector only checking the string, that is why twelve million
 * stored messages contain no alarm at all.
 */
const RUN_STATES = new Set(['RUN', 'RUNNING', 'CUTTING']);

/*
 * Integer columns reject a value outside their range, and Postgres rejects
 * the whole multi-row INSERT with it — every machine's rows, not just the one
 * that sent the bad value. On 2026-09-15 a single machine sent 42279658848 for
 * an INTEGER column and no telemetry was written for any machine.
 *
 * A value that does not fit is stored as NULL and logged with the machine and
 * column, so the device can be fixed without the plant losing data meanwhile.
 */
const INT2 = [-32768, 32767];
const INT4 = [-2147483648, 2147483647];
const INT8 = [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];

const rangeWarned = new Map();   // `${machine}:${column}` -> last warning, ms

function ranged(column, [min, max], read) {
  return row => {
    const v = read(row);
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    const t = Number.isFinite(n) ? Math.trunc(n) : NaN;
    if (Number.isFinite(t) && t >= min && t <= max) return t;

    // at most once per machine and column every ten minutes
    const key = `${row?.machine_id}:${column}`;
    const now = Date.now();
    if (!rangeWarned.has(key) || now - rangeWarned.get(key) > 600_000) {
      rangeWarned.set(key, now);
      log('warn', 'telemetry value out of range for its column — stored as NULL', {
        machine_id: row?.machine_id, column, value: String(v).slice(0, 40), range: [min, max]
      });
    }
    return null;
  };
}

const COLUMNS = [
  ['company_id',             r => r.company_id ?? null],
  ['plant_id',               r => r.plant_id ?? null],
  ['machine_id',             r => r.machine_id ?? null],
  ['machine_status',         r => RUN_STATES.has(String(r.machine_status || '').toUpperCase()) ? 'RUNNING' : 'IDLE'],
  ['alarm',                  r => r.alarm === true],
  ['status',                 ranged('status', INT2, r => r.status)],
  ['parts_count',            ranged('parts_count', INT4, r => r.parts_count)],
  ['spindle_load',           r => r.spindle_load ?? null],
  ['feed_rate',              r => r.feed_rate ?? null],
  ['cutting_speed',          r => r.cutting_speed ?? null],
  ['total_run_time',         ranged('total_run_time', INT8, r => r.total_run_time)],
  ['total_cutting_time',     ranged('total_cutting_time', INT8, r => r.total_cutting_time)],
  ['run_time',               ranged('run_time', INT4, r => r.run_time)],
  ['program_number',         ranged('program_number', INT4, r => r.program_number)],
  ['device_time',            r => r.device_time ?? null],
  ['mode',                   r => r.mode ?? null],
  ['energy',                 r => r.energy ?? null],
  // when the collector received the reading — not when it reached the
  // database, which during an outage can be minutes later
  ['received_at',            r => r.received_at ? new Date(r.received_at) : new Date()],
  ['voltage',                r => r.voltage ?? null],
  ['current',                r => r.current ?? null],
  ['power',                  r => r.power ?? null],

  // machine condition (migration 021)
  ['spindle_speed',          ranged('spindle_speed', INT4, r => r.spindle_speed)],
  ['spindle_motor_temp',     r => r.spindle_motor_temp ?? null],
  ['spindle_insulation_res', r => r.spindle_insulation_res ?? null],
  ['servo_load_x',           r => r.servo_load_x ?? null],
  ['servo_load_y',           r => r.servo_load_y ?? null],
  ['servo_load_z',           r => r.servo_load_z ?? null],
  ['servo_temp_x',           r => r.servo_temp_x ?? null],
  ['servo_temp_y',           r => r.servo_temp_y ?? null],
  ['servo_temp_z',           r => r.servo_temp_z ?? null],
  ['encoder_temp_x',         r => r.encoder_temp_x ?? null],
  ['encoder_temp_y',         r => r.encoder_temp_y ?? null],
  ['encoder_temp_z',         r => r.encoder_temp_z ?? null],
  ['servo_insulation_res_x', r => r.servo_insulation_res_x ?? null],
  ['servo_insulation_res_y', r => r.servo_insulation_res_y ?? null],
  ['servo_insulation_res_z', r => r.servo_insulation_res_z ?? null],
  ['servo_pulse_x',          r => r.servo_pulse_x ?? null],
  ['servo_pulse_y',          r => r.servo_pulse_y ?? null],
  ['servo_pulse_z',          r => r.servo_pulse_z ?? null],
  ['cnc_battery_voltage',    r => r.cnc_battery_voltage ?? null],
  ['apc_battery_voltage',    r => r.apc_battery_voltage ?? null],
  ['sequence_number',        ranged('sequence_number', INT4, r => r.sequence_number)],
  // JSONB: serialised here so the driver does not have to guess the type
  ['fan_status',             r => r.fan_status ? JSON.stringify(r.fan_status) : null],
  ['extra_axes',             r => r.extra_axes ? JSON.stringify(r.extra_axes) : null],
  // per-axis battery alarm flags (migration 032)
  ['apc_battery_status',     r => r.apc_battery_status ? JSON.stringify(r.apc_battery_status) : null]
];

export const TELEMETRY_COLUMNS = COLUMNS.map(([name]) => name);

/** Values for one row, in COLUMNS order. Exported for tests. */
export function rowValues(row) {
  return COLUMNS.map(([, read]) => read(row));
}

/** One multi-row INSERT for `rows`, columns in COLUMNS order. */
export function telemetryInsert(rows) {
  const C = COLUMNS.length;
  const values = [];
  const placeholders = rows.map((r, i) => {
    values.push(...rowValues(r));
    const cells = [];
    for (let c = 1; c <= C; c++) cells.push(`$${i * C + c}`);
    return `(${cells.join(',')})`;
  });
  return {
    text: `INSERT INTO telemetry_raw (${TELEMETRY_COLUMNS.join(', ')}) VALUES ${placeholders.join(',')}`,
    values
  };
}
