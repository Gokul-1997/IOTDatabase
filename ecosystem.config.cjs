module.exports = {
  apps: [
    {
      name: 'mqtt-ingest',
      script: 'app.js',

      // ── Runtime ───────────────────────────────────────────
      // ES Module app — must use fork mode (cluster not supported with "type":"module")
      instances:    1,
      exec_mode:    'fork',

      // ── Memory guard ──────────────────────────────────────
      // Readings wait in the on-disk journal, not in memory; ~100 MB RSS at
      // 100 msg/s. Restart if RSS exceeds 400 MB — prevents OOM kill.
      max_memory_restart: '400M',

      // ── Restart strategy ──────────────────────────────────
      // Exponential backoff prevents rapid crash loops when
      // MQTT broker / DB / Redis is temporarily unavailable.
      max_restarts:              10,
      restart_delay:           5000,  // 5s minimum between restarts
      exp_backoff_restart_delay: 200, // doubles each retry: 5s, 10s, 20s …

      // ── Shutdown ──────────────────────────────────────────
      kill_timeout:    8000,  // 8 s: stop intake, sync the journal, write what is waiting
      listen_timeout: 10000,

      // ── Logs ──────────────────────────────────────────────
      // Only errors and structured JSON warnings go here.
      // Hot-path info logs are intentionally suppressed in mqtt.js.
      out_file:   './logs/mqtt-out.log',
      error_file: './logs/mqtt-error.log',
      merge_logs: false,
      time:       true,

      // ── Environment ───────────────────────────────────────
      env_production: {
        NODE_ENV: 'production',
        TZ: 'Asia/Kolkata',   // match backend — all date ops run in IST
      }
    }
  ]
};
