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

const RUN_STATES = new Set(['RUN', 'RUNNING', 'CUTTING']);
function normalizeMachineState(status) {
  if (!status) return { machine_status: 'IDLE', alarm: false };
  const s = String(status).toUpperCase();
  if (RUN_STATES.has(s)) return { machine_status: 'RUNNING', alarm: false };
  if (s === 'ALARM')     return { machine_status: 'IDLE',    alarm: true  };
  return { machine_status: 'IDLE', alarm: false };
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
async function flushBuffer() {
  if (flushing || buffer.length === 0) return;
  flushing = true;

  let batch;

  try {
    while (buffer.length > 0) {
      batch = buffer.splice(0, MAX_BATCH_SIZE);

      const COLS = 18; // company_id + plant_id + 16 existing
      const values = [];
      const placeholders = batch.map((r, i) => {
        const base = i * COLS;
        const normalized = normalizeMachineState(r.machine_status);
        values.push(
          r.company_id ?? null,
          r.plant_id ?? null,
          r.machine_id ?? null,
          normalized.machine_status,
          normalized.alarm,
          r.status ?? null,
          r.parts_count ?? null,
          r.spindle_load ?? null,
          r.feed_rate ?? null,
          r.cutting_speed ?? null,
          r.total_run_time ?? null,
          r.total_cutting_time ?? null,
          r.run_time ?? null,
          r.program_number ?? null,
          r.device_time ?? null,
          r.mode ?? null,
          r.energy ?? null,
          new Date()
        );
        const cells = [];
        for (let c = 1; c <= COLS; c++) cells.push(`$${base + c}`);
        return `(${cells.join(',')})`;
      });

      await pool.query(`
        INSERT INTO telemetry_raw (
          company_id, plant_id, machine_id, machine_status, alarm, status,
          parts_count, spindle_load, feed_rate, cutting_speed,
          total_run_time, total_cutting_time, run_time, program_number,
          device_time, mode, energy, received_at
        )
        VALUES ${placeholders.join(',')}
      `, values);
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

startFlushLoop();

// Periodic stats
setInterval(() => {
  const s = getBufferStats();
  if (s.size > 0 || s.droppedTotal > 0) {
    log('info', 'buffer stats', s);
  }
}, 30_000);
