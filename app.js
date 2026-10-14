import dotenv from 'dotenv';
import { mqttConfig } from './src/lib/mqtt-config.js';

dotenv.config();

// ESM static imports execute before the importing module. Load the runtime
// dynamically so invalid configuration cannot open Redis, journal or timers.
try {
  const config = mqttConfig();
  const { startServer } = await import('./server.js');
  await startServer(config);
} catch (error) {
  console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error',
    msg: 'failed to start MQTT ingestion', error: error.message }));
  process.exit(1);
}
