import mqtt from 'mqtt';
import { pool } from './db.js';
import { redis } from './redis.js';
import { addToBuffer } from './buffer.js';
import { setMqttConnected, markMessage, markError } from './health.js';
import { recordMessage, startMqttLogger } from './mqtt-logger.js';
import { partsDelta } from './src/lib/parts-delta.js';
import { trackAlarm } from './src/lib/alarm-log.js';

const machineCache   = new Map();
const negativeCache  = new Map(); // api_keys that don't exist → avoid DB hammering
const shiftCache     = new Map();
const messageIdCache = new Map();

const RUN_STATES    = new Set(['RUN', 'RUNNING', 'CUTTING']);
const MANUAL_STATES = new Set(['MANUAL', 'SETUP']);

// Track service start time so broker-replayed messages arriving right after
// a restart are not dropped by the stale-message filter.
// For the first STARTUP_REPLAY_WINDOW_MS, allow messages up to 24h old.
const SERVICE_START_MS         = Date.now();
const STARTUP_REPLAY_WINDOW_MS = 10 * 60 * 1000;   // 10 min after start
const STARTUP_MAX_STALE_MS     = 24 * 60 * 60 * 1000; // accept up to 24h old during replay

const NEGATIVE_TTL_MS     = 30_000;     // 30s — re-check unknown machines
const CACHE_REFRESH_MS    = 30_000;     // 30s — reload machine list
const MACHINE_LOCKS       = new Map();  // per-machine serialization

/* ===============================
   STRUCTURED LOGGING
================================ */
function log(level, msg, meta = {}) {
  const line = { t: new Date().toISOString(), level, msg, ...meta };
  const out  = JSON.stringify(line);
  if (level === 'error')      console.error(out);
  else if (level === 'warn')  console.warn(out);
  else                        console.log(out);
}

/* ===============================
   ENERGY PARSER
================================ */
function parseEnergy(val) {
  if (val == null) return null;
  const str = String(val).trim().replace(',', '.');
  const n   = parseFloat(str.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

/* ===============================
   MACHINE STATUS NORMALIZATION
================================ */
function normalizeMachineState(status) {
  if (!status) return { machine_status: 'IDLE', alarm: false };
  const s = String(status).toUpperCase();
  if (RUN_STATES.has(s))  return { machine_status: 'RUNNING', alarm: false };
  if (s === 'ALARM')      return { machine_status: 'IDLE',    alarm: true  };
  return { machine_status: 'IDLE', alarm: false };
}

/* ===============================
   DEDUPLICATION
================================ */
function getDedupKey(apiKey, payload) {
  return `${apiKey}:${payload.time}:${payload.parts_count}`;
}

function isDuplicate(dedupKey) {
  if (messageIdCache.has(dedupKey)) return true;
  messageIdCache.set(dedupKey, Date.now());
  if (messageIdCache.size > 10000) {
    const keys = Array.from(messageIdCache.keys());
    keys.slice(0, 2000).forEach(k => messageIdCache.delete(k));
  }
  return false;
}

/* ===============================
   PRELOAD + REFRESH MACHINES
================================ */
async function preloadMachines() {
  const { rows } = await pool.query(`
    SELECT id, plant_id, company_id, api_key, machine_serial_no
    FROM machines
    WHERE is_active = true
  `);

  const nextCache = new Map();
  for (const row of rows) {
    nextCache.set(row.api_key, {
      id:                row.id,
      plant_id:          row.plant_id,
      company_id:        row.company_id,
      machine_serial_no: row.machine_serial_no
    });
  }

  const prevCount = machineCache.size;

  // swap atomically
  machineCache.clear();
  for (const [k, v] of nextCache) machineCache.set(k, v);

  // any api_key now active → drop negative cache entry
  for (const apiKey of negativeCache.keys()) {
    if (machineCache.has(apiKey)) negativeCache.delete(apiKey);
  }

  // only log when the machine count changes — avoids 2,880 lines/day from 30s refresh
  if (nextCache.size !== prevCount) {
    log('info', 'machines preloaded', { count: machineCache.size });
  }
}

/* Cache-miss DB lookup (1 query, cached negatively for 30s) */
async function lookupMachine(apiKey) {
  const hit = machineCache.get(apiKey);
  if (hit) return hit;

  const neg = negativeCache.get(apiKey);
  if (neg && Date.now() - neg < NEGATIVE_TTL_MS) return null;

  try {
    const { rows } = await pool.query(
      `SELECT id, plant_id, company_id, machine_serial_no
       FROM machines
       WHERE api_key = $1 AND is_active = true
       LIMIT 1`,
      [apiKey]
    );
    if (rows.length === 0) {
      negativeCache.set(apiKey, Date.now());
      return null;
    }
    const machine = {
      id:                rows[0].id,
      plant_id:          rows[0].plant_id,
      company_id:        rows[0].company_id,
      machine_serial_no: rows[0].machine_serial_no
    };
    machineCache.set(apiKey, machine);
    negativeCache.delete(apiKey);
    log('info', 'machine cache miss resolved from DB', { api_key: apiKey, machine_id: machine.id });
    return machine;
  } catch (err) {
    log('error', 'machine lookup failed', { api_key: apiKey, error: err.message });
    return null;
  }
}

/* ===============================
   SAFE JSON PARSE
================================ */
function safeParse(message) {
  try { return JSON.parse(message.toString()); } catch { return null; }
}

/* ===============================
   SHIFT CACHE
================================ */
async function getShiftId(companyId, deviceTime) {
  const timeBucket = Math.floor(deviceTime / 60);
  const cacheKey   = `${companyId}:${timeBucket}`;

  const cached = shiftCache.get(cacheKey);
  if (cached && cached.timestamp > Date.now() - 300_000) return cached.shiftId;

  if (shiftCache.size > 1000) {
    const now = Date.now();
    for (const [key, val] of shiftCache) {
      if (val.timestamp < now - 600_000) shiftCache.delete(key);
    }
  }

  const { rows } = await pool.query(`
    SELECT id
    FROM shifts
    WHERE company_id = $1
      AND is_active = true
      AND (
        (start_time <= end_time AND
         (to_timestamp($2) AT TIME ZONE 'Asia/Kolkata')::time BETWEEN start_time AND end_time)
        OR
        (start_time > end_time AND (
           (to_timestamp($2) AT TIME ZONE 'Asia/Kolkata')::time >= start_time
           OR
           (to_timestamp($2) AT TIME ZONE 'Asia/Kolkata')::time <= end_time
        ))
      )
    LIMIT 1
  `, [companyId, deviceTime]);

  const shiftId = rows?.[0]?.id || null;
  shiftCache.set(cacheKey, { shiftId, timestamp: Date.now() });
  return shiftId;
}

/* ===============================
   HOURLY PRODUCTION  (OFF hot path)
   Fire-and-forget from message handler
================================ */
async function updateHourlyProduction(task) {
  const {
    machineId, companyId, prevStatus, prevMode,
    producedDelta, fromTime, toTime, energyDelta
  } = task;

  if (!fromTime || !toTime || toTime <= fromTime) return;

  const totalDuration = toTime - fromTime;
  let start = fromTime;

  while (start < toTime) {
    const hourStart = Math.floor(start / 3600) * 3600;
    const nextHour  = hourStart + 3600;
    const end       = Math.min(toTime, nextHour);
    const diffSec   = end - start;

    let run = 0, idle = 0, manual = 0;
    const statusUpper = String(prevStatus || '').toUpperCase();
    const modeUpper   = String(prevMode   || '').toUpperCase();

    if (RUN_STATES.has(statusUpper)) run = diffSec; else idle = diffSec;
    if (MANUAL_STATES.has(modeUpper)) manual = diffSec;

    const fraction     = totalDuration > 0 ? diffSec / totalDuration : 1;
    const energyBucket = energyDelta != null
      ? Number((energyDelta * fraction).toFixed(4))
      : 0;

    const shiftId = await getShiftId(companyId, start);
    if (!shiftId) { start = end; continue; }

    await pool.query(`
      INSERT INTO production_hourly
        (company_id, machine_id, shift_id, hour_start, run_seconds, idle_seconds, manual_seconds, produced_qty, energy_kwh)
      VALUES ($1,$2,$3,
        (date_trunc('hour', to_timestamp($4) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'),
        $5,$6,$7,$8,$9)
      ON CONFLICT (machine_id, shift_id, hour_start)
      DO UPDATE SET
        run_seconds    = production_hourly.run_seconds    + EXCLUDED.run_seconds,
        idle_seconds   = production_hourly.idle_seconds   + EXCLUDED.idle_seconds,
        manual_seconds = production_hourly.manual_seconds + EXCLUDED.manual_seconds,
        produced_qty   = production_hourly.produced_qty   + EXCLUDED.produced_qty,
        energy_kwh     = production_hourly.energy_kwh     + EXCLUDED.energy_kwh
    `, [companyId, machineId, shiftId, start, run, idle, manual, producedDelta, energyBucket]);

    start = end;
  }
}

/* Simple queue so hourly writes don't pile up in parallel per machine */
const hourlyQueues = new Map();
function enqueueHourly(task) {
  const key  = task.machineId;
  const prev = hourlyQueues.get(key) || Promise.resolve();
  const next = prev
    .then(() => updateHourlyProduction(task))
    .catch(err => log('error', 'hourly update failed',
      { machine_id: key, error: err.message }))
    .finally(() => {
      if (hourlyQueues.get(key) === next) hourlyQueues.delete(key);
    });
  hourlyQueues.set(key, next);
}

/* ===============================
   PER-MACHINE SERIALIZATION
   Prevents read-modify-write races on the `live` key
================================ */
function runSerial(machineId, fn) {
  const prev = MACHINE_LOCKS.get(machineId) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (MACHINE_LOCKS.get(machineId) === next) MACHINE_LOCKS.delete(machineId);
  });
  MACHINE_LOCKS.set(machineId, next);
  return next;
}

/* ===============================
   CORE MESSAGE HANDLER
================================ */
async function handleMessage(apiKey, payload) {
  const machine = await lookupMachine(apiKey);
  if (!machine) {
    // negative-cached; do not log per-message to avoid spam
    return;
  }

  const deviceTime = Number(payload.time);
  if (!deviceTime) return;

  const dedupKey = getDedupKey(apiKey, payload);
  if (isDuplicate(dedupKey)) return;

  recordMessage(machine.machine_serial_no, payload);

  const ingressLatencyMs = Date.now() - deviceTime * 1000;

  // During the startup replay window (first 10 min after service restart),
  // allow messages up to 24h old so the broker can replay all QoS-1 messages
  // that were queued while the service was down. Outside that window, reject
  // anything older than 5 minutes — those are genuinely stale.
  const isStartupReplay = (Date.now() - SERVICE_START_MS) < STARTUP_REPLAY_WINDOW_MS;
  const MAX_STALE_MS    = isStartupReplay ? STARTUP_MAX_STALE_MS : 5 * 60 * 1000;
  if (ingressLatencyMs > MAX_STALE_MS) {
    log('warn', 'dropping stale message',
      { machine_id: machine.id, latency_ms: ingressLatencyMs, device_time: deviceTime,
        startup_replay: isStartupReplay });
    return;
  }

  if (ingressLatencyMs > 10_000) {
    log('warn', 'high ingress latency',
      { machine_id: machine.id, latency_ms: ingressLatencyMs });
  }

  const normalized = normalizeMachineState(payload.machine_status);
  const mode       = payload.mode || null;
  const energy     = parseEnergy(payload.Energy ?? payload.energy);

  const lastKey = `machine:${machine.id}:last_time`;
  const liveKey = `machine:${machine.id}:live`;

  const lastTime = await redis.get(lastKey);
  if (lastTime && deviceTime <= Number(lastTime)) return;

  const shiftId = await getShiftId(machine.company_id, deviceTime);
  if (!shiftId) return;

  const prevRaw = await redis.get(liveKey);
  const prev    = prevRaw ? JSON.parse(prevRaw) : null;

  const partsCount = Number(payload.parts_count ?? 0);

  // When Redis has expired (machine offline > 5 min or server restarted), fall back
  // to the last telemetry_raw row so parts produced during the gap are not lost.
  let prevPartsCount  = prev?.parts_count ?? null;
  let prevReceivedAt  = prev?.received_at ?? null; // epoch seconds from Redis
  let gapSeconds      = 0;

  if (prevPartsCount == null) {
    try {
      const { rows: fallback } = await pool.query(
        `SELECT parts_count, EXTRACT(EPOCH FROM received_at)::bigint AS received_epoch
         FROM telemetry_raw
         WHERE machine_id = $1 AND received_at < to_timestamp($2)
         ORDER BY received_at DESC LIMIT 1`,
        [machine.id, deviceTime]
      );
      if (fallback[0]) {
        prevPartsCount = fallback[0].parts_count;
        prevReceivedAt = Number(fallback[0].received_epoch);
      }
    } catch (err) {
      log('warn', 'fallback parts lookup failed', { machine_id: machine.id, error: err.message });
    }
  }

  // Compute gap so partsDelta can relax MAX_PARTS_DELTA for long-downtime recovery
  if (prevReceivedAt) {
    gapSeconds = Math.max(0, deviceTime - prevReceivedAt);
  }

  const producedDelta = prevPartsCount != null
    ? partsDelta(prevPartsCount, partsCount, gapSeconds)
    : 0;

  let energyDelta = null;
  if (energy !== null && prev?.energy != null) {
    energyDelta = Math.max(0, energy - prev.energy);
  }

  const energyBaseKey = `machine:${machine.id}:energy_start:${shiftId}`;
  const energyBase    = await redis.get(energyBaseKey);
  if (energyBase === null && energy !== null) {
    await redis.set(energyBaseKey, String(energy));
  }

  /* Record alarm periods. Fire-and-forget for the same reason the hourly
     rollup is: telemetry ingestion is the product, and a derived record
     must never be able to slow it down or drop a message. Only state
     transitions are written, so a machine alarming for an hour costs two
     queries rather than one per second. */
  trackAlarm({
    prev,
    isAlarm:   normalized.alarm,
    companyId: machine.company_id,
    machineId: machine.id,
    shiftId,
    payload,
    deviceTime
  }).catch(err => log('error', 'alarm tracking failed',
    { machine_id: machine.id, error: err.message }));

  // 🔥 Offload hourly production — DO NOT block ingestion
  if (prev && prev.received_at) {
    enqueueHourly({
      machineId:     machine.id,
      plantId:       machine.plant_id,
      companyId:     machine.company_id,
      prevStatus:    prev.machine_status,
      prevMode:      prev.mode,
      producedDelta,
      fromTime:      prev.received_at,
      toTime:        deviceTime,
      energyDelta
    });
  }

  const livePayload = {
    machine_id:     machine.id,
    plant_id:       machine.plant_id,
    company_id:     machine.company_id,
    shift_id:       shiftId,
    machine_status: normalized.machine_status,
    alarm:          normalized.alarm,
    mode,
    spindle_load:   payload.spindle_load ?? 0,
    feed_rate:      payload.feed_rate    ?? 0,
    parts_count:    partsCount,
    cutting_speed:  payload.cutting_speed ?? 0,
    energy,
    received_at:    deviceTime,
    last_runtime_flush_at: deviceTime
  };

  await redis.multi()
    .setEx(lastKey, 300, String(deviceTime))
    .setEx(liveKey, 300, JSON.stringify(livePayload))
    .publish('machine_updates', JSON.stringify({
      machine_id:     machine.id,
      plant_id:       machine.plant_id,
      company_id:     machine.company_id,
      machine_status: normalized.machine_status,
      alarm:          normalized.alarm,
      mode,
      spindle_load:   payload.spindle_load ?? 0,
      feed_rate:      payload.feed_rate    ?? 0,
      parts_count:    partsCount,
      cutting_speed:  payload.cutting_speed ?? 0,
      energy,
      received_at:    Math.floor(Date.now() / 1000)  // server ingestion time (not device clock)
    }))
    .exec();

  addToBuffer({
    plant_id:       machine.plant_id,
    company_id:     machine.company_id,
    machine_id:     machine.id,
    machine_status: normalized.machine_status,
    alarm:          normalized.alarm,
    parts_count:    partsCount,
    spindle_load:   payload.spindle_load   ?? null,
    feed_rate:      payload.feed_rate      ?? null,
    cutting_speed:  payload.cutting_speed  ?? null,
    mode,
    energy,
    status:         payload.status         ?? null,
    device_time:    payload.time
  });
}

/* ===============================
   START MQTT SERVICE
================================ */
export async function startMQTT() {
  await preloadMachines();
  startMqttLogger();

  // periodic cache refresh (picks up machines created after startup)
  setInterval(() => {
    preloadMachines().catch(err =>
      log('error', 'cache refresh failed', { error: err.message })
    );
  }, CACHE_REFRESH_MS);

  // Stable clientId + persistent session → broker replays missed QoS 1 msgs
  const clientId =
    process.env.MQTT_CLIENT_ID ||
    `pms-ingest-${process.env.NODE_APP_INSTANCE || '0'}`;

  const client = mqtt.connect(process.env.MQTT_URL, {
    clientId,
    clean:             false,
    reconnectPeriod:   2000,
    connectTimeout:    10_000,
    keepalive:         30,
    resubscribe:       true,
    queueQoSZero:      false,
    ...(process.env.MQTT_USER && { username: process.env.MQTT_USER }),
    ...(process.env.MQTT_PASS && { password: process.env.MQTT_PASS }),
  });

  client.on('connect', (connack) => {
    setMqttConnected(true);
    log('info', 'mqtt connected', { clientId, sessionPresent: connack.sessionPresent });

    client.subscribe('machines/+/telemetry', { qos: 1 }, (err, granted) => {
      if (err) log('error', 'mqtt subscribe failed', { error: err.message });
      else     log('info', 'mqtt subscribed', { granted });
    });

    // Refresh cache on every (re)connect — critical for fresh data after flap
    preloadMachines().catch(err =>
      log('error', 'post-connect refresh failed', { error: err.message })
    );
  });

  client.on('reconnect', () => log('warn', 'mqtt reconnecting'));
  client.on('offline',   () => { setMqttConnected(false); log('warn', 'mqtt offline'); });
  client.on('close',     () => { setMqttConnected(false); log('warn', 'mqtt closed'); });
  client.on('error',     (err) => { markError(); log('error', 'mqtt error', { error: err.message }); });

  client.on('message', (topic, message) => {
    const parts  = topic.split('/');
    const apiKey = parts[1];
    if (!apiKey) return;

    const payload = safeParse(message);
    if (!payload || !payload.time) return;

    markMessage();

    // serialize per machine; handler still runs concurrently across machines
    runSerial(apiKey, () => handleMessage(apiKey, payload))
      .catch(err => { markError(); log('error', 'handler error',
        { api_key: apiKey, error: err.message }); });
  });
}
