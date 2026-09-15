import dotenv from 'dotenv';

dotenv.config(); // load env FIRST

import { startMQTT } from './mqtt.js';
import { startHealthServer } from './health.js';
import { pool } from './db.js';
import { TELEMETRY_COLUMNS } from './buffer.js';
import { missingTelemetryColumns } from './src/lib/schema-check.js';
import './runtime-flush.js';

/* ===============================
   START SERVICES
================================ */

async function startServer() {
  try {

    /* Before subscribing: if a migration this build depends on is not
       applied, every insert would fail and the buffer would eventually drop
       messages the broker has already acknowledged. Not subscribing leaves
       them queued on the broker (persistent session) until this is fixed. */
    const missing = await missingTelemetryColumns(pool, TELEMETRY_COLUMNS);
    if (missing.length) {
      console.error('❌ telemetry_raw is missing columns this build writes — apply the pending ' +
        'migration (Backend: npm run migrate), then restart. Missing:', missing.join(', '));
      process.exit(1);
    }

    startHealthServer();
    await startMQTT();

    console.log('🚀 Server-1 MQTT ingestion started');

  } catch (err) {

    console.error('❌ Failed to start MQTT ingestion:', err);
    process.exit(1);

  }
}

startServer();

/* ===============================
   SAFE SHUTDOWN
================================ */

process.on('SIGINT', () => {
  console.log('🛑 Server shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Server terminated...');
  process.exit(0);
});