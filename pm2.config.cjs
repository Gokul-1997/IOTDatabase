/*
 * PM2 ecosystem for the MQTT ingest worker.
 * Single instance (fork mode) — MQTT subscription must NOT be sharded across
 * cluster workers; each worker would re-process every message.
 *
 * Use:
 *   pm2 start pm2.config.cjs --env production
 *   pm2 reload mqtt-ingest --update-env
 */

module.exports = {
  apps: [
    {
      name:        'mqtt-ingest',
      script:      'app.js',
      instances:   1,
      exec_mode:   'fork',
      max_memory_restart: '500M',
      // time to stop intake, sync the journal and write what is waiting
      // (app.js gives itself SHUTDOWN_TIMEOUT_MS = 7000)
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
