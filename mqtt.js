import fs from 'node:fs';
import mqtt from 'mqtt';
import { pool } from './db.js';
import { redis } from './redis.js';
import { setMqttConnected, markMessage, markError, count } from './health.js';
import { recordMessage, startMqttLogger } from './mqtt-logger.js';
import { createIdentityWriter } from './src/lib/controller-identity.js';
import { createLagTracker } from './src/lib/ingress-lag.js';
import { createMessageProcessor } from './src/lib/message-processor.js';
import { installAdmission } from './src/lib/admission.js';

const machineCache = new Map();
const negativeCache = new Map();
const NEGATIVE_TTL_MS = 30_000;
const MAX_NEGATIVE_KEYS = 1000;
let journal, shifts, client, processor, intake, refreshTimer;
function log(level, msg, meta = {}) {
  const out = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(out);
}
export const ingressLag = createLagTracker({ log });
export function initIngest(deps) { journal = deps.journal; shifts = deps.shifts; }

async function preloadMachines() {
  const { rows } = await pool.query(`SELECT id, plant_id, company_id, api_key, machine_serial_no
    FROM machines WHERE is_active = true AND company_id IS NOT NULL`);
  const previous = machineCache.size;
  machineCache.clear();
  for (const row of rows) machineCache.set(row.api_key, row);
  const now = Date.now();
  for (const [key, at] of negativeCache) {
    if (machineCache.has(key) || now - at >= NEGATIVE_TTL_MS) negativeCache.delete(key);
  }
  if (previous !== machineCache.size) log('info', 'machines preloaded', { count: machineCache.size });
}
async function lookupMachine(apiKey) {
  if (machineCache.has(apiKey)) return machineCache.get(apiKey);
  const miss = negativeCache.get(apiKey);
  if (miss && Date.now() - miss < NEGATIVE_TTL_MS) return null;
  // A database failure is transient, not an unknown machine: leave QoS1 unacknowledged.
  const { rows } = await pool.query(`SELECT id, plant_id, company_id, machine_serial_no
    FROM machines WHERE api_key = $1 AND is_active = true AND company_id IS NOT NULL LIMIT 1`, [apiKey]);
  if (!rows.length) {
    negativeCache.set(apiKey, Date.now());
    while (negativeCache.size > MAX_NEGATIVE_KEYS) negativeCache.delete(negativeCache.keys().next().value);
    return null;
  }
  machineCache.set(apiKey, rows[0]);
  negativeCache.delete(apiKey);
  return rows[0];
}
async function hydrate(machine) {
  // Only the initial baseline after a restart/new machine reads the database.
  // Redis is a presentation cache, so an outage cannot erase production deltas.
  const { rows } = await pool.query(`SELECT t.parts_count, t.machine_status, t.mode, t.alarm,
    COALESCE(t.device_time, EXTRACT(EPOCH FROM t.received_at)::bigint) AS received_at,
    e.energy AS energy_meter, e.device_time AS energy_meter_at
    FROM (SELECT parts_count, machine_status, mode, alarm, device_time, received_at FROM telemetry_raw
      WHERE company_id = $1 AND machine_id = $2 AND received_at > now() - interval '7 days'
      ORDER BY received_at DESC LIMIT 1) t
    LEFT JOIN LATERAL (SELECT energy, device_time FROM telemetry_raw
      WHERE company_id = $1 AND machine_id = $2 AND received_at > now() - interval '7 days' AND energy > 0
      ORDER BY received_at DESC LIMIT 1) e ON true`, [machine.company_id, machine.id]);
  return rows[0] ? { ...rows[0], received_at: Number(rows[0].received_at),
    energy_meter_at: rows[0].energy_meter_at == null ? null : Number(rows[0].energy_meter_at) } : null;
}
const recordControllerIdentity = createIdentityWriter({ pool, log });
export async function startMQTT() {
  await preloadMachines();
  processor = createMessageProcessor({ journal, shifts, lookupMachine, hydrate, redis,
    recordControllerIdentity, recordMessage, count, log, ingressLag });
  startMqttLogger();
  refreshTimer = setInterval(() => preloadMachines().catch(error =>
    log('error', 'machine refresh failed', { error: error.message })), 30_000);
  refreshTimer.unref();
  const clientId = process.env.MQTT_CLIENT_ID || `pms-ingest-${process.env.NODE_APP_INSTANCE || '0'}`;
  const url = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
  const secure = url.startsWith('mqtts://');
  if (process.env.NODE_ENV === 'production' && !secure && process.env.MQTT_ALLOW_INSECURE !== 'true') {
    throw new Error('Production MQTT requires mqtts://; MQTT_ALLOW_INSECURE=true is only for a trusted local broker');
  }
  client = mqtt.connect(url, {
    clientId, clean: false, reconnectPeriod: 2000, connectTimeout: 10_000,
    keepalive: 30, resubscribe: true, queueQoSZero: false,
    ...(secure && { rejectUnauthorized: true }),
    ...(process.env.MQTT_CA_FILE && { ca: fs.readFileSync(process.env.MQTT_CA_FILE) }),
    ...(process.env.MQTT_USER && { username: process.env.MQTT_USER }),
    ...(process.env.MQTT_PASS && { password: process.env.MQTT_PASS })
  });
  intake = installAdmission(client, { count, log, process: async (...args) => {
    markMessage(); await processor.handleMessage(...args);
  } });
  client.on('connect', connack => {
    setMqttConnected(true);
    log('info', 'mqtt connected', { clientId, sessionPresent: connack.sessionPresent });
    client.subscribe('machines/+/telemetry', { qos: 1 }, error => {
      if (error) { setMqttConnected(false); log('error', 'mqtt subscribe failed', { error: error.message }); }
    });
    preloadMachines().catch(error => log('error', 'post-connect refresh failed', { error: error.message }));
  });
  client.on('reconnect', () => log('warn', 'mqtt reconnecting'));
  client.on('offline', () => setMqttConnected(false));
  client.on('close', () => setMqttConnected(false));
  client.on('error', error => { markError(); log('error', 'mqtt error', { error: error.message }); });
}
export async function stopMQTT(timeoutMs = 3000) {
  clearInterval(refreshTimer);
  if (!client) return;
  const deadline = Date.now() + timeoutMs;
  // The broker retains unacknowledged work if admission has not finished by the deadline.
  while (intake.stats().active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => client.end(true, {}, resolve));
  setMqttConnected(false);
}
