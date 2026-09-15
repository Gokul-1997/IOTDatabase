import { pool } from './db.js';

/* ============================
   CONFIG
============================ */
const FLUSH_INTERVAL  = 1000;     // ms between flush cycles
const MAX_BUFFER_SIZE = 50_000;   // raise ceiling — 50 machines × 1 msg/sec × ~15 min
const MAX_BATCH_SIZE  = 1000;
const WARN_THRESHOLD  = 0.7;      // log when ≥70% full

let buffer   = [];
let flushing = false;
let droppedTotal = 0;
let lastOverflowLog = 0;

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

const COLUMNS = [
  ['company_id',             r => r.company_id ?? null],
  ['plant_id',               r => r.plant_id ?? null],
  ['machine_id',             r => r.machine_id ?? null],
  ['machine_status',         r => RUN_STATES.has(String(r.machine_status || '').toUpperCase()) ? 'RUNNING' : 'IDLE'],
  ['alarm',                  r => r.alarm === true],
  ['status',                 r => r.status ?? null],
  ['parts_count',            r => r.parts_count ?? null],
  ['spindle_load',           r => r.spindle_load ?? null],
  ['feed_rate',              r => r.feed_rate ?? null],
  ['cutting_speed',          r => r.cutting_speed ?? null],
  ['total_run_time',         r => r.total_run_time ?? null],
  ['total_cutting_time',     r => r.total_cutting_time ?? null],
  ['run_time',               r => r.run_time ?? null],
  ['program_number',         r => r.program_number ?? null],
  ['device_time',            r => r.device_time ?? null],
  ['mode',                   r => r.mode ?? null],
  ['energy',                 r => r.energy ?? null],
  ['received_at',            () => new Date()],
  ['voltage',                r => r.voltage ?? null],
  ['current',                r => r.current ?? null],
  ['power',                  r => r.power ?? null],

  // machine condition (migration 021)
  ['spindle_speed',          r => r.spindle_speed ?? null],
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
  ['sequence_number',        r => r.sequence_number ?? null],
  // JSONB: serialised here so the driver does not have to guess the type
  ['fan_status',             r => r.fan_status ? JSON.stringify(r.fan_status) : null],
  ['extra_axes',             r => r.extra_axes ? JSON.stringify(r.extra_axes) : null]
];

export const TELEMETRY_COLUMNS = COLUMNS.map(([name]) => name);

/** Values for one row, in COLUMNS order. Exported for tests. */
export function rowValues(row) {
  return COLUMNS.map(([, read]) => read(row));
}

/* ============================
   ADD TO BUFFER
============================ */
export function addToBuffer(row) {
  // plant_id may be NULL for machines created by COMPANY_ADMIN (company-wide scope)
  if (!row || !row.machine_id) {
    log('warn', 'invalid buffer row', { row });
    return;
  }

  if (buffer.length >= MAX_BUFFER_SIZE) {
    // Drop the OLDEST single row (FIFO). Logging is rate-limited.
    buffer.shift();
    droppedTotal++;
    const now = Date.now();
    if (now - lastOverflowLog > 5000) {
      log('error', 'buffer overflow — dropping oldest rows',
        { bufferSize: buffer.length, droppedTotal });
      lastOverflowLog = now;
    }
  } else if (buffer.length >= MAX_BUFFER_SIZE * WARN_THRESHOLD) {
    const now = Date.now();
    if (now - lastOverflowLog > 5000) {
      log('warn', 'buffer above watermark',
        { bufferSize: buffer.length, cap: MAX_BUFFER_SIZE });
      lastOverflowLog = now;
    }
  }

  buffer.push(row);
}

export function getBufferStats() {
  return { size: buffer.length, droppedTotal, flushing };
}

/* ============================
   FLUSH
============================ */
/* Exported so tests can flush deterministically instead of waiting on the
   one-second timer. Production still drives it from the loop below. */
export async function flushBuffer() {
  if (flushing || buffer.length === 0) return;
  flushing = true;

  let batch;

  try {
    while (buffer.length > 0) {
      batch = buffer.splice(0, MAX_BATCH_SIZE);

      const COLS = COLUMNS.length;
      const values = [];
      const placeholders = batch.map((r, i) => {
        const base = i * COLS;
        values.push(...rowValues(r));
        const cells = [];
        for (let c = 1; c <= COLS; c++) cells.push(`$${base + c}`);
        return `(${cells.join(',')})`;
      });

      await pool.query(
        `INSERT INTO telemetry_raw (${TELEMETRY_COLUMNS.join(', ')})
         VALUES ${placeholders.join(',')}`,
        values
      );
    }
  } catch (err) {
    log('error', 'telemetry flush error', {
      error: err.message,
      bufferSize: buffer.length,
      batchSize: batch?.length ?? 0
    });

    // Requeue failed batch at the HEAD so ordering is preserved,
    // but only if we have room — otherwise we must drop to keep ingesting.
    if (batch) {
      const headroom = MAX_BUFFER_SIZE - buffer.length;
      if (headroom >= batch.length) {
        buffer = [...batch, ...buffer];
      } else {
        const keep = batch.slice(-headroom);
        droppedTotal += batch.length - keep.length;
        buffer = [...keep, ...buffer];
        log('error', 'dropped rows on requeue', {
          dropped: batch.length - keep.length, droppedTotal
        });
      }
    }
  } finally {
    flushing = false;
  }
}

/* ============================
   LOOP
============================ */
async function startFlushLoop() {
  try { await flushBuffer(); }
  catch (err) { log('error', 'flush loop error', { error: err.message }); }
  finally { setTimeout(startFlushLoop, FLUSH_INTERVAL); }
}

/* Importing this module starts a timer that never stops, which is correct
   in the service and wrong in a test runner — Jest cannot exit while it is
   pending, so the suite hangs rather than failing. Tests drive flushBuffer
   directly instead. */
if (process.env.NODE_ENV !== 'test') {
  startFlushLoop();

  // Periodic stats
  setInterval(() => {
    const s = getBufferStats();
    if (s.size > 0 || s.droppedTotal > 0) {
      log('info', 'buffer stats', s);
    }
  }, 30_000);
}
