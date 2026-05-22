import { redis } from './redis.js';
import { pool } from './db.js';

const RUN_STATES        = new Set(['RUN', 'RUNNING', 'CUTTING']);
const STALE_TIMEOUT_SEC = 15;
const FLUSH_INTERVAL    = 5000;
const SCAN_COUNT        = 500;

let flushing = false;

function log(level, msg, meta = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error')     console.error(line);
  else if (level === 'warn') console.warn(line);
  else                       console.log(line);
}

/* ===============================
   NON-BLOCKING KEY SCAN
================================ */
async function getLiveKeys() {
  const keys = [];
  // node-redis v5 scanIterator yields arrays of keys per batch; v4 yields strings.
  // Handle both by flattening.
  for await (const chunk of redis.scanIterator({
    MATCH: 'machine:*:live',
    COUNT: SCAN_COUNT
  })) {
    if (Array.isArray(chunk)) keys.push(...chunk);
    else                      keys.push(chunk);
  }
  return keys;
}

/* ===============================
   RUNTIME FLUSH
================================ */
async function flushRuntime() {
  if (flushing) return;
  flushing = true;

  try {
    const keys = await getLiveKeys();
    if (keys.length === 0) return;

    // Batch MGET instead of N round-trips
    const rawValues = await redis.mGet(keys);
    const now = Math.floor(Date.now() / 1000);
    const inserts = [];
    const redisUpdates = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const raw = rawValues[i];
      if (!raw) continue;

      let live;
      try { live = JSON.parse(raw); } catch { continue; }

      const telemetryAt = Number(live.received_at || 0);
      if (!telemetryAt) continue;

      if (now - telemetryAt > STALE_TIMEOUT_SEC) continue;

      const lastFlushAt = Number(live.last_runtime_flush_at || telemetryAt);
      const diff = now - lastFlushAt;
      if (diff <= 0) continue;

      let run = 0, idle = 0;
      if (RUN_STATES.has(String(live.machine_status).toUpperCase())) run = diff;
      else idle = diff;

      const hourStart = Math.floor(now / 3600) * 3600;

      inserts.push({
        company_id: live.company_id ?? null,
        machine_id: live.machine_id,
        shift_id:   live.shift_id || null,
        hour_start: hourStart,
        run,
        idle
      });

      live.last_runtime_flush_at = now;
      redisUpdates.push([key, JSON.stringify(live)]);
    }

    // Pipeline Redis updates
    if (redisUpdates.length > 0) {
      const pipeline = redis.multi();
      for (const [k, v] of redisUpdates) pipeline.setEx(k, 300, v);
      await pipeline.exec();
    }

    // Batch DB insert (skip rows missing shift_id — constraint would fail)
    const valid = inserts.filter(r => r.shift_id != null);
    if (valid.length > 0) {
      const values = [];
      const placeholders = valid.map((r, i) => {
        const base = i * 6;
        values.push(r.company_id, r.machine_id, r.shift_id, r.hour_start, r.run, r.idle);
        return `($${base+1},$${base+2},$${base+3},to_timestamp($${base+4}),$${base+5},$${base+6})`;
      });

      await pool.query(`
        INSERT INTO production_hourly
          (company_id, machine_id, shift_id, hour_start, run_seconds, idle_seconds)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (machine_id, shift_id, hour_start)
        DO UPDATE SET
          run_seconds  = production_hourly.run_seconds  + EXCLUDED.run_seconds,
          idle_seconds = production_hourly.idle_seconds + EXCLUDED.idle_seconds
      `, values);
    }
  } catch (err) {
    log('error', 'runtime flush error', { error: err.message });
  } finally {
    flushing = false;
  }
}

async function startRuntimeLoop() {
  try { await flushRuntime(); }
  catch (err) { log('error', 'runtime loop error', { error: err.message }); }
  finally { setTimeout(startRuntimeLoop, FLUSH_INTERVAL); }
}

startRuntimeLoop();
