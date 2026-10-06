import dotenv from 'dotenv';

dotenv.config(); // load env FIRST

import path from 'path';
import { startMQTT, stopMQTT, initIngest } from './mqtt.js';
import { startHealthServer, setSources } from './health.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { TELEMETRY_COLUMNS, telemetryInsert } from './buffer.js';
import { missingTelemetryColumns, missingTables } from './src/lib/schema-check.js';
import { createJournal } from './src/lib/journal.js';
import { createFlusher } from './src/lib/flusher.js';
import { createShiftCache } from './src/lib/shifts.js';

/*
 * Ingestion service.
 *
 *   MQTT → handler (mqtt.js) → journal on disk → writer → Postgres
 *                      └→ Redis live state + Socket.IO fan-out
 *
 * runtime-flush.js is gone: every five seconds it added the time since the
 * last reading to production_hourly, and the per-reading path added the same
 * seconds again — run and idle time in every report were 1.7–2.4× what the
 * telemetry showed (measured on 5 Oct 2026).
 */

function log(level, msg, meta = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
}

const collectorId = process.env.COLLECTOR_ID || process.env.MQTT_CLIENT_ID || `pms-ingest-${process.env.NODE_APP_INSTANCE || '0'}`;
const journal = createJournal({
  dir: process.env.JOURNAL_DIR || path.join(process.cwd(), 'data', 'journal'),
  fsyncMs: Number(process.env.JOURNAL_FSYNC_MS || 100),
  maxBytes: Number(process.env.JOURNAL_MAX_MB || 2048) * 1024 * 1024,
  log
});
const shifts  = createShiftCache({ pool, log });
const flusher = createFlusher({ pool, journal, collectorId, telemetryInsert, log });

async function startServer() {
  try {
    /* Before subscribing: if a migration this build depends on is not
       applied, every write would fail. Not subscribing leaves the messages
       queued on the broker (persistent session) until it is fixed. */
    const missing = await missingTelemetryColumns(pool, TELEMETRY_COLUMNS);
    const missingT = await missingTables(pool, ['ingest_checkpoint', 'telemetry_late']);
    if (missing.length || missingT.length) {
      log('error', 'the database is missing what this build writes — apply the pending migrations (Backend: npm run migrate), then restart',
        { missing_columns: missing, missing_tables: missingT });
      process.exit(1);
    }

    const { recovered } = journal.open();
    await shifts.start();
    const checkpoint = await flusher.start();
    log('info', 'writer started', { collector_id: collectorId, checkpoint, waiting_from_last_run: recovered });

    initIngest({ journal, shifts });
    setSources({ journal, flusher });
    startHealthServer();
    await startMQTT();

    log('info', 'MQTT ingestion started');

    // readings kept in telemetry_late are for audit and back-filling: 30 days
    setInterval(() => {
      pool.query(`DELETE FROM telemetry_late WHERE received_at < now() - interval '30 days'`)
        .catch(err => log('warn', 'telemetry_late clean-up failed', { error: err.message }));
    }, 3_600_000).unref();
  } catch (err) {
    log('error', 'failed to start MQTT ingestion', { error: err.message });
    process.exit(1);
  }
}

startServer();

/* ===============================
   SAFE SHUTDOWN

   Stop taking messages, let the ones in hand reach the journal, sync it,
   and write as much as the database will take in the time pm2 allows
   (kill_timeout). Whatever is left stays in the journal for the next start.
================================ */
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutting down', { signal });
  const hardStop = setTimeout(() => { journal.sync(); process.exit(0); }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 7000));
  try {
    await stopMQTT();
    journal.sync();
    await flusher.stop();
    const empty = await flusher.drain(4000);
    log('info', empty ? 'all readings written' : 'readings left in the journal for the next start', journal.stats());
    shifts.stop();
    journal.close();
    await Promise.allSettled([pool.end(), redis.quit()]);
  } catch (err) {
    log('error', 'shutdown error', { error: err.message });
    journal.sync();
  }
  clearTimeout(hardStop);
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
