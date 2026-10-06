import http from 'http';
import { pool } from './db.js';
import { redis } from './redis.js';
import { lagMetricLines } from './src/lib/ingress-lag.js';

/* ===============================
   /health    → liveness + readiness
   /metrics   → plain-text key=value (Prometheus-compatible)
================================ */

let mqttConnected = false;
let lastMessageAt = 0;
let messagesTotal = 0;
let errorsTotal   = 0;

/* What happened to every message: accepted, or why not. Nothing is dropped
   without being counted here. */
const outcomes = {
  accepted: 0, late_stale: 0, late_out_of_order: 0, duplicate: 0, unknown_machine: 0,
  invalid: 0, disconnected: 0, journal_refused: 0, redis_degraded: 0
};
let sources = { journal: null, flusher: null, lag: null };

export function setMqttConnected(state) { mqttConnected = !!state; }
export function markMessage()           { messagesTotal++; lastMessageAt = Date.now(); }
export function markError()             { errorsTotal++; }
export function count(outcome)          { outcomes[outcome] = (outcomes[outcome] || 0) + 1; }
export function setSources(next)        { sources = { ...sources, ...next }; }

/* A ping that cannot answer within 2 s counts as down. Without the limit,
   /health and /metrics hung for as long as Redis was unreachable (its client
   holds commands while it reconnects), so monitoring saw no answer at all
   instead of "redis: false". */
const PING_LIMIT_MS = 2000;
function within(ms, promise) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, ms, false); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function pingDb() {
  try {
    return await within(PING_LIMIT_MS, pool.query('SELECT 1 AS ok').then(r => r.rows[0].ok === 1));
  } catch { return false; }
}

async function pingRedis() {
  try {
    return await within(PING_LIMIT_MS, redis.ping().then(r => r === 'PONG'));
  } catch { return false; }
}

async function buildHealth() {
  const [db, rd] = await Promise.all([pingDb(), pingRedis()]);
  const msSinceMessage = lastMessageAt ? Date.now() - lastMessageAt : null;
  const journal = sources.journal?.stats() ?? null;
  const writer  = sources.flusher?.stats() ?? null;
  const lag     = sources.lag?.snapshot() ?? null;

  // healthy = connected to all three, and the writer is keeping up
  const healthy = db && rd && mqttConnected && (writer ? writer.db_ok : true);

  return {
    status: healthy ? 'ok' : 'degraded',
    uptime_sec: Math.floor(process.uptime()),
    mqtt: { connected: mqttConnected, last_message_ms_ago: msSinceMessage },
    db:    { connected: db, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } },
    redis: { connected: rd },
    journal,
    writer,
    ingress_lag: lag,
    outcomes,
    counters: { messages_total: messagesTotal, errors_total: errorsTotal }
  };
}

function metricsText(h) {
  const lines = [
    `pms_up ${h.status === 'ok' ? 1 : 0}`,
    `pms_uptime_seconds ${h.uptime_sec}`,
    `pms_mqtt_connected ${h.mqtt.connected ? 1 : 0}`,
    `pms_mqtt_last_message_ms_ago ${h.mqtt.last_message_ms_ago ?? -1}`,
    `pms_db_connected ${h.db.connected ? 1 : 0}`,
    `pms_db_pool_total ${h.db.pool.total}`,
    `pms_db_pool_idle ${h.db.pool.idle}`,
    `pms_db_pool_waiting ${h.db.pool.waiting}`,
    `pms_redis_connected ${h.redis.connected ? 1 : 0}`,
    `pms_messages_total ${h.counters.messages_total}`,
    `pms_errors_total ${h.counters.errors_total}`,
    ...Object.entries(h.outcomes).map(([k, v]) => `pms_messages_${k}_total ${v}`),
  ];
  if (h.journal) lines.push(
    `pms_journal_pending ${h.journal.pending}`,
    `pms_journal_bytes ${h.journal.bytes}`,
    `pms_journal_segments ${h.journal.segments}`,
    `pms_journal_refused_total ${h.journal.refused}`);
  if (h.writer) lines.push(
    `pms_writer_db_ok ${h.writer.db_ok ? 1 : 0}`,
    `pms_writer_rows_total ${h.writer.rows_written}`,
    `pms_writer_late_rows_total ${h.writer.late_written}`,
    `pms_writer_hourly_upserts_total ${h.writer.hourly_upserts}`,
    `pms_writer_bad_records_total ${h.writer.bad_records}`,
    `pms_writer_retries_total ${h.writer.retries}`,
    `pms_writer_last_batch_ms ${h.writer.last_batch_ms}`,
    `pms_writer_max_batch_ms ${h.writer.max_batch_ms}`);
  if (h.ingress_lag) lines.push(...lagMetricLines(h.ingress_lag));
  return lines.join('\n') + '\n';
}

export function startHealthServer(port = Number(process.env.HEALTH_PORT || 9100)) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/health') {
        const h = await buildHealth();
        res.writeHead(h.status === 'ok' ? 200 : 503,
          { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(h));
        return;
      }
      if (req.url === '/metrics') {
        const h = await buildHealth();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(metricsText(h));
        return;
      }
      res.writeHead(404); res.end('not found');
    } catch (err) {
      res.writeHead(500); res.end(err.message);
    }
  });

  server.listen(port, () => {
    console.log(JSON.stringify({
      t: new Date().toISOString(), level: 'info',
      msg: 'health server listening', port
    }));
  });

  return server;
}
