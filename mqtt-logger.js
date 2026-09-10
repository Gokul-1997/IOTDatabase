import fs from 'fs';
import path from 'path';

const LOG_DIR        = process.env.MQTT_LOG_DIR || path.join(process.cwd(), 'logs', 'mqtt');
const FLUSH_INTERVAL = 15 * 60 * 1000;   // 15 minutes
const RETENTION_DAYS = 7;

fs.mkdirSync(LOG_DIR, { recursive: true });

// machineSerial → latest raw payload seen (in memory)
const latest = new Map();

export function recordMessage(machineSerial, payload) {
  if (!machineSerial) return;
  latest.set(machineSerial, { capturedAt: new Date(), payload });
}

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function timeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function safeName(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '_'); }

function flush() {
  if (latest.size === 0) return;

  for (const [serial, { capturedAt, payload }] of latest.entries()) {
    const file = path.join(LOG_DIR, `${safeName(serial)}-${dateStr(capturedAt)}.log`);
    const line = `[${timeStr(capturedAt)}] ${JSON.stringify(payload)}\n`;
    fs.appendFile(file, line, (err) => {
      if (err) console.error('[mqtt-logger] write failed', file, err.message);
    });
  }
  latest.clear();
}

function cleanup() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      const full = path.join(LOG_DIR, f);
      fs.stat(full, (e, st) => {
        if (e || !st) return;
        if (st.mtimeMs < cutoff) fs.unlink(full, () => {});
      });
    }
  });
}

export function startMqttLogger() {
  setInterval(flush, FLUSH_INTERVAL);
  setInterval(cleanup, 24 * 60 * 60 * 1000); // daily cleanup
  console.log(`[mqtt-logger] writing to ${LOG_DIR} every 15 min, ${RETENTION_DAYS}-day retention`);
}
