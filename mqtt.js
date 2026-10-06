import mqtt from 'mqtt';
import { pool } from './db.js';
import { redis } from './redis.js';
import { setMqttConnected, markMessage, markError, count } from './health.js';
import { hourlySlices } from './src/lib/hourly.js';
import { recordMessage, startMqttLogger } from './mqtt-logger.js';
import { partsDelta } from './src/lib/parts-delta.js';
import { energyStep } from './src/lib/energy-step.js';
import { powerSignals, meterReading } from './src/lib/power-signals.js';
import { createMeterWriter } from './src/lib/meter-writer.js';
import { trackAlarm, alarmKey } from './src/lib/alarm-log.js';
import { createIdentityWriter } from './src/lib/controller-identity.js';
import {
  conditionSignals, isAlarming, controllerIdentity, isDisconnected, focasResult,
  canonicalPayload, activeAlarms
} from './src/lib/condition-signals.js';

const machineCache   = new Map();
const negativeCache  = new Map(); // api_keys that don't exist → avoid DB hammering
const messageIdCache = new Map();

const RUN_STATES    = new Set(['RUN', 'RUNNING', 'CUTTING']);

/* Set by app.js before startMQTT(): the journal every accepted reading is
   written to, and the in-memory shift calendar. */
let journal = null;
let shifts  = null;
export function initIngest(deps) { journal = deps.journal; shifts = deps.shifts; }

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
   NUMERIC COERCION

   Devices send numbers as numbers, as strings, and occasionally as strings
   with a unit attached. Anything that is not a finite number becomes null
   rather than NaN — NaN reaches Postgres as the string "NaN" and fails the
   whole batch insert, which would drop telemetry for every machine in it,
   not just the one that sent junk.
================================ */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function int(v) {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/* ===============================
   MACHINE STATUS NORMALIZATION
================================ */
/*
 * Running/idle comes from the status string, as it always has — twelve
 * million stored rows are keyed to that behaviour and it is correct.
 *
 * The alarm flag does not. Controllers send "STOP" while alarming and
 * carry the alarm in the FOCAS status flags, so checking the string alone
 * has recorded zero alarms out of twelve million messages. The full
 * payload decides it now; the string remains one of the signals.
 */
function normalizeMachineState(status, payload) {
  const s = String(status || '').toUpperCase();
  const alarm = payload ? isAlarming(payload) : s === 'ALARM';
  const running = RUN_STATES.has(s);
  return { machine_status: running ? 'RUNNING' : 'IDLE', alarm };
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
   LATE AND OUT-OF-ORDER READINGS

   Kept, not dropped. A reading more than five minutes behind the server
   clock, or older than one already processed for the machine, cannot go
   into the live state or the hourly totals without corrupting them — the
   live state would step back in time and the interval would be counted
   twice. It used to be discarded without a trace, so a gateway publishing
   late looked exactly like a plant switched off. It now goes to
   telemetry_late with the reason, through the same journal, and is counted
   on /metrics.
================================ */
const lateWarned = new Map();   // machine_id -> last warning, ms

function keepLate(machine, payload, deviceTime, receivedAt, reason, latencyMs) {
  const seq = journal.append({ l: {
    machine_id: machine.id, company_id: machine.company_id, device_time: deviceTime,
    received_at: receivedAt, reason, payload
  } });
  count(seq ? `late_${reason}` : 'journal_refused');
  const now = Date.now();
  if (now - (lateWarned.get(machine.id) || 0) > 60_000) {
    lateWarned.set(machine.id, now);
    log('warn', 'reading kept in telemetry_late, not in live data', {
      machine_id: machine.id, reason, device_time: deviceTime, latency_ms: latencyMs
    });
  }
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

   Accepted = written to the journal. From there the writer puts the
   telemetry row and the hourly production it adds into the database in one
   transaction. Live state (Redis) is updated here, as before.
================================ */
async function handleMessage(apiKey, payload, receivedAtMs) {
  const machine = await lookupMachine(apiKey);
  if (!machine) { count('unknown_machine'); return; }   // negative-cached; not logged per message

  const deviceTime = Number(payload.time);
  if (!deviceTime) { count('invalid'); return; }

  const dedupKey = getDedupKey(apiKey, payload);
  if (isDuplicate(dedupKey)) { count('duplicate'); return; }

  recordMessage(machine.machine_serial_no, payload);

  /* The collector could not reach the controller, and says so. Its other
     values are whatever it last held, so storing them would record a dead
     network link as an idle machine. Counted, then dropped, so the machine
     goes OFFLINE through the freshness window. */
  if (isDisconnected(payload)) { count('disconnected'); return; }

  const receivedAt = new Date(receivedAtMs).toISOString();
  const ingressLatencyMs = receivedAtMs - deviceTime * 1000;

  // During the startup replay window (first 10 min after a restart) messages
  // up to 24 h old are taken as live data, so what the broker queued while
  // the service was down lands normally. Otherwise > 5 min late is too late
  // for live data and the hourly totals — it is kept in telemetry_late.
  const isStartupReplay = (Date.now() - SERVICE_START_MS) < STARTUP_REPLAY_WINDOW_MS;
  const MAX_STALE_MS    = isStartupReplay ? STARTUP_MAX_STALE_MS : 5 * 60 * 1000;
  if (ingressLatencyMs > MAX_STALE_MS) {
    keepLate(machine, payload, deviceTime, receivedAt, 'stale', ingressLatencyMs);
    return;
  }

  if (ingressLatencyMs > 10_000) {
    log('warn', 'high ingress latency', { machine_id: machine.id, latency_ms: ingressLatencyMs });
  }

  const normalized = normalizeMachineState(payload.machine_status, payload);
  const mode       = payload.mode || null;
  // the energy meter: PowerData block or the contract's flat keys
  const meter      = powerSignals(payload);
  const energy     = meter.energy;

  const lastKey = `machine:${machine.id}:last_time`;
  const liveKey = `machine:${machine.id}:live`;

  /* Redis holds the live state the deltas are worked out from. If it cannot
     be reached the reading is still stored; only the live screen, the hourly
     totals and alarm tracking wait for it to come back. */
  let redisOk = true;
  let prev = null;
  try {
    const [lastTime, prevRaw] = await Promise.all([redis.get(lastKey), redis.get(liveKey)]);
    if (lastTime && deviceTime <= Number(lastTime)) {
      keepLate(machine, payload, deviceTime, receivedAt, 'out_of_order', ingressLatencyMs);
      return;
    }
    prev = prevRaw ? JSON.parse(prevRaw) : null;
  } catch (err) {
    redisOk = false;
    count('redis_degraded');
  }

  // null outside every shift: the reading is still stored and shown live;
  // only production_hourly, which is per shift, has nothing to add
  const shiftId = shifts.shiftFor(machine.company_id, deviceTime);

  const partsCount = Number(payload.parts_count ?? 0);

  // When Redis has expired (machine offline > 5 min or server restarted), fall back
  // to the last telemetry_raw row so parts produced during the gap are not lost.
  let prevPartsCount  = prev?.parts_count ?? null;
  let prevReceivedAt  = prev?.received_at ?? null; // epoch seconds from Redis
  let gapSeconds      = 0;

  if (redisOk && prevPartsCount == null) {
    try {
      const { rows: fallback } = await pool.query(
        `SELECT parts_count, EXTRACT(EPOCH FROM received_at)::bigint AS received_epoch
         FROM telemetry_raw
         WHERE machine_id = $1 AND received_at < to_timestamp($2)
           AND received_at > to_timestamp($2) - interval '7 days'
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

  /* Compared with the last real meter reading, kept in the live state, so a
     dropped read (0) or a misread cannot book the whole meter total as one
     step — see src/lib/energy-step.js. */
  const energyLast = prev?.energy_meter != null
    ? { meter: prev.energy_meter, at: prev.energy_meter_at }
    : null;
  const { delta: energyDelta, last: energyNow } = energyStep(energyLast, energy, deviceTime);

  /* Every alarm active now — a machine can carry several — computed once and
     kept in the live state, so the next message can tell which codes are new
     and which cleared. Recorded fire-and-forget: only state transitions are
     written, so a machine alarming for an hour costs two queries. */
  const alarmsNow  = normalized.alarm ? activeAlarms(payload, { alarming: true }) : [];
  const alarmCodes = alarmsNow.map(alarmKey);

  if (redisOk) {
    trackAlarm({
      prev,
      alarms:    alarmsNow,
      isAlarm:   normalized.alarm,
      companyId: machine.company_id,
      machineId: machine.id,
      shiftId,
      payload,
      deviceTime
    }).catch(err => log('error', 'alarm tracking failed',
      { machine_id: machine.id, error: err.message }));
  }

  /* The time since the machine's previous reading, credited to the state it
     was in then — written with the telemetry row, in the same transaction. */
  const slices = (redisOk && prev && prev.received_at)
    ? hourlySlices({
        companyId:  machine.company_id,
        machineId:  machine.id,
        prevStatus: prev.machine_status,
        prevMode:   prev.mode,
        from:       Number(prev.received_at),
        to:         deviceTime,
        produced:   producedDelta,
        energy:     energyDelta,
        shifts:     shifts.shiftsOf(machine.company_id)
      })
    : [];

  if (redisOk) {
    const livePayload = {
      machine_id:     machine.id,
      plant_id:       machine.plant_id,
      company_id:     machine.company_id,
      shift_id:       shiftId,
      machine_status: normalized.machine_status,
      alarm:          normalized.alarm,
      alarm_codes:    alarmCodes,
      mode,
      spindle_load:   payload.spindle_load ?? 0,
      feed_rate:      payload.feed_rate    ?? 0,
      parts_count:    partsCount,
      cutting_speed:  payload.cutting_speed ?? 0,
      energy,
      energy_meter:    energyNow?.meter ?? null,
      energy_meter_at: energyNow?.at ?? null,
      received_at:    deviceTime
    };
    try {
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
    } catch (err) {
      count('redis_degraded');
    }
  }

  /*
   * Everything telemetry_raw can hold.
   *
   * Four of these — program_number, total_run_time, total_cutting_time and
   * run_time — are columns that already existed and were already in the
   * INSERT, but were never passed here, so the buffer wrote NULL for them on
   * every one of the ~450,000 rows a day.
   *
   * Names are accepted in more than one spelling where controllers differ.
   * A field the devices do not send yet costs nothing: it arrives as null
   * today and lands the moment the firmware starts including it.
   */
  const row = {
    plant_id:       machine.plant_id,
    company_id:     machine.company_id,
    machine_id:     machine.id,
    machine_status: normalized.machine_status,
    alarm:          normalized.alarm,
    parts_count:    partsCount,
    spindle_load:   num(payload.spindle_load),
    feed_rate:      num(payload.feed_rate),
    cutting_speed:  num(payload.cutting_speed ?? payload.surface_speed),
    mode,
    energy,
    status:         payload.status ?? null,
    device_time:    payload.time,
    received_at:    receivedAt,

    // running program on the controller — lets the app warn before a
    // transfer overwrites the program an operator is mid-way through
    program_number: int(payload.program_number ?? payload.program_no ?? payload.o_number),

    // controller lifetime counters, in seconds
    total_run_time:     int(payload.total_run_time     ?? payload.powered_on_time),
    total_cutting_time: int(payload.total_cutting_time ?? payload.cutting_time),
    run_time:           int(payload.run_time),

    // electrical, for the energy dashboard
    voltage: meter.voltage,
    current: meter.current,
    power:   meter.power,

    /* Machine condition — Screen 2's gauges. Each axis is independently
       nullable, because on some controllers only one servo reports a
       temperature and a missing sensor must not read as 0 °C. */
    ...conditionSignals(payload)
  };

  count(journal.append({ r: row, h: slices }) ? 'accepted' : 'journal_refused');

  /* The controller's own identity describes the machine, not the moment,
     so it is written to `machines` rather than to 450,000 rows a day.
     Fire-and-forget and rate-limited: telemetry ingestion is the product
     and must never wait on bookkeeping. */
  const identity = controllerIdentity(payload);
  const focas    = focasResult(payload);
  if (identity || focas) {
    recordControllerIdentity(machine.id, identity, focas).catch(err =>
      log('error', 'controller identity write failed',
        { machine_id: machine.id, error: err.message }));
  }

  /* The energy meter's whole reading — phases, power factor, frequency,
     demand, import/export — beside the four values telemetry_raw keeps.
     Fire-and-forget and at most every 15 s per machine, for the same reason. */
  const reading = meterReading(payload);
  if (reading) {
    recordMeterReading({ machineId: machine.id, companyId: machine.company_id, at: deviceTime, reading })
      .catch(err => log('error', 'energy meter reading write failed',
        { machine_id: machine.id, error: err.message }));
  }
}

/* Identity writes: rate-limited per machine, and switched off with one clear
   log line if the ingestion user may not UPDATE machines. */
const recordControllerIdentity = createIdentityWriter({ pool, log });

/* Meter readings: one row per machine every 15 s at most, switched off with
   one clear log line until migration 029 has run and the user may write. */
const recordMeterReading = createMeterWriter({ pool, log });

/* ===============================
   START MQTT SERVICE
================================ */
let client = null;

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

  client = mqtt.connect(process.env.MQTT_URL, {
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
    const receivedAtMs = Date.now();   // when it arrived, before any waiting
    const parts  = topic.split('/');
    const apiKey = parts[1];
    if (!apiKey) return;

    /* Keys lower-cased before anything reads them — including the `time`
       check below. Collectors in the field already disagree on case
       (encoder_temperatures vs Encoder_temperature), and a key read with
       the wrong case is silently dropped. */
    const payload = canonicalPayload(safeParse(message));
    if (!payload || !payload.time) { count('invalid'); return; }

    markMessage();

    // serialize per machine; handler still runs concurrently across machines
    runSerial(apiKey, () => handleMessage(apiKey, payload, receivedAtMs))
      .catch(err => { markError(); log('error', 'handler error',
        { api_key: apiKey, error: err.message }); });
  });
}

/**
 * Stop taking messages and let the ones already being handled finish, so
 * everything acknowledged is in the journal before the service exits. The
 * broker keeps what arrives meanwhile (persistent session) for the next start.
 */
export async function stopMQTT(timeoutMs = 3000) {
  if (client) {
    await new Promise(resolve => client.end(false, {}, resolve));
    setMqttConnected(false);
  }
  const pending = Promise.allSettled([...MACHINE_LOCKS.values()]);
  await Promise.race([pending, new Promise(r => setTimeout(r, timeoutMs))]);
}
