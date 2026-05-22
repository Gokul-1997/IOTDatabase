import http from 'http';
import { pool } from './db.js';
import { redis } from './redis.js';
import { getBufferStats } from './buffer.js';

/* ===============================
   /health    → liveness + readiness
   /metrics   → plain-text key=value (Prometheus-compatible)
================================ */

let mqttConnected = false;
let lastMessageAt = 0;
let messagesTotal = 0;
let errorsTotal   = 0;

export function setMqttConnected(state) { mqttConnected = !!state; }
export function markMessage()           { messagesTotal++; lastMessageAt = Date.now(); }
export function markError()             { errorsTotal++; }

async function pingDb() {
  try {
    const r = await pool.query('SELECT 1 AS ok');
    return r.rows[0].ok === 1;
  } catch { return false; }
}

async function pingRedis() {
  try {
    const r = await redis.ping();
    return r === 'PONG';
  } catch { return false; }
}

async function buildHealth() {
  const [db, rd] = await Promise.all([pingDb(), pingRedis()]);
  const buf = getBufferStats();
  const msSinceMessage = lastMessageAt ? Date.now() - lastMessageAt : null;

  const healthy = db && rd && mqttConnected;

  return {
    status: healthy ? 'ok' : 'degraded',
    uptime_sec: Math.floor(process.uptime()),
    mqtt: { connected: mqttConnected, last_message_ms_ago: msSinceMessage },
    db:    { connected: db, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } },
    redis: { connected: rd },
    buffer: buf,
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
    `pms_buffer_size ${h.buffer.size}`,
    `pms_buffer_dropped_total ${h.buffer.droppedTotal}`,
    `pms_messages_total ${h.counters.messages_total}`,
    `pms_errors_total ${h.counters.errors_total}`,
  ];
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
