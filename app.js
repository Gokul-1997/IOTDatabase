import dotenv from 'dotenv';

dotenv.config(); // load env FIRST

import { startMQTT } from './mqtt.js';
import { startHealthServer } from './health.js';
import './runtime-flush.js';

/* ===============================
   START SERVICES
================================ */

async function startServer() {
  try {

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