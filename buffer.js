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
  ['received_at',            () => new Date()],
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
/** One multi-row INSERT for `rows`, columns in COLUMNS order. */
async function insertRows(rows) {
  const COLS = COLUMNS.length;
  const values = [];
  const placeholders = rows.map((r, i) => {
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

/*
 * SQLSTATE class 22 (data exception: out of range, invalid text) and 23
 * (integrity: not-null, check) mean a *row* is bad and will be rejected
 * however often it is retried. Anything else — a dropped connection, a
 * timeout — is worth retrying the whole batch for.
 */
export function isDataError(err) {
  return !!err && typeof err.code === 'string' && (err.code.startsWith('22') || err.code.startsWith('23'));
}

/*
 * The database refused the batch because of the data in it. Requeueing it
 * — what this used to do — retries the same poisoned rows forever, and every
 * new row joins that batch, so nothing is written again for any machine.
 * Row by row instead: the good rows are written, the bad ones are logged with
 * enough to find the sender, and dropped.
 */
async function insertEachRow(rows, cause) {
  log('warn', 'batch rejected by the database; inserting row by row to isolate the bad row', {
    error: cause.message, batchSize: rows.length
  });
  for (let i = 0; i < rows.length; i++) {
    try {
      await insertRows([rows[i]]);
    } catch (err) {
      if (!isDataError(err)) {
        err.unwritten = rows.slice(i);
        throw err;
      }
      droppedTotal++;
      const r = rows[i];
      log('error', 'dropped a telemetry row the database rejected', {
        machine_id: r.machine_id, device_time: r.device_time, error: err.message,
        values: { status: r.status, parts_count: r.parts_count, run_time: r.run_time,
                  program_number: r.program_number, spindle_speed: r.spindle_speed,
                  sequence_number: r.sequence_number }
      });
    }
  }
}

/* Exported so tests can flush deterministically instead of waiting on the
   one-second timer. Production still drives it from the loop below. */
export async function flushBuffer() {
  if (flushing || buffer.length === 0) return;
  flushing = true;

  let batch;

  try {
    while (buffer.length > 0) {
      batch = buffer.splice(0, MAX_BATCH_SIZE);

      try {
        await insertRows(batch);
      } catch (err) {
        // connection trouble: fall through to the requeue below, as before
        if (!isDataError(err)) throw err;
        try {
          await insertEachRow(batch, err);
        } catch (inner) {
          // the connection failed part-way: requeue only what was not written
          if (inner.unwritten) batch = inner.unwritten;
          throw inner;
        }
      }
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
