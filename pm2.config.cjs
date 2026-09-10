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
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
