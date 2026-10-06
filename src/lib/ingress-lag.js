/*
 * How late readings reach the collector: the moment a reading arrived
 * against its own timestamp (payload.time, the gateway's clock).
 *
 * A few seconds is normal. A gateway that falls behind shows here long
 * before its readings pass the 5-minute limit and are set aside in
 * telemetry_late, so this is the number to alert on
 * (/metrics pms_ingress_lag_max_seconds).
 *
 * In the log: one line a minute naming every machine that was over the
 * threshold and its worst lag, not a line per reading. On 6–7 Oct 2026 the
 * Fanuc gateway ran 11–15 s behind all day, and a line per reading (three a
 * second) buried everything else in the log.
 */

const FORGET_MS = 10 * 60_000;   // a machine not heard from for 10 min drops off /metrics

export function createLagTracker({ warnMs = 10_000, everyMs = 60_000, limitMs = 5 * 60_000, log, now = Date.now } = {}) {
  const latest = new Map();   // machine id → { ms, at }
  let late = new Map();       // machine id → { readings, worstMs } since the last summary
  let windowStart = now();

  function summarize(t) {
    if (late.size) {
      const machines = {};
      let readings = 0;
      let worst = 0;
      for (const [id, m] of late) {
        machines[id] = m.worstMs;
        readings += m.readings;
        worst = Math.max(worst, m.worstMs);
      }
      log('warn', 'readings arriving late', {
        machines, late_readings: readings, worst_ms: worst,
        threshold_ms: warnMs, limit_ms: limitMs, window_s: Math.round((t - windowStart) / 1000)
      });
    }
    late = new Map();
    windowStart = t;
  }

  return {
    observe(machineId, lagMs) {
      const t = now();
      latest.set(machineId, { ms: lagMs, at: t });
      if (lagMs > warnMs) {
        const m = late.get(machineId) || { readings: 0, worstMs: 0 };
        m.readings++;
        m.worstMs = Math.max(m.worstMs, Math.round(lagMs));
        late.set(machineId, m);
      }
      if (t - windowStart >= everyMs) summarize(t);
    },

    /* The latest lag of every machine heard from in the last 10 minutes.
       Negative means the gateway's clock is ahead of this server's. */
    snapshot() {
      const t = now();
      const machines = {};
      let worst = null;
      for (const [id, v] of latest) {
        if (t - v.at > FORGET_MS) { latest.delete(id); continue; }
        machines[id] = Math.round(v.ms);
        if (!worst || v.ms > worst.lag_ms) worst = { machine_id: id, lag_ms: Math.round(v.ms) };
      }
      return { worst, machines };
    }
  };
}

/* The /metrics lines, in seconds. */
export function lagMetricLines({ worst, machines }) {
  const sec = ms => (ms / 1000).toFixed(1);
  return [
    ...(worst ? [`pms_ingress_lag_max_seconds ${sec(worst.lag_ms)}`] : []),
    ...Object.entries(machines).map(([id, ms]) => `pms_ingress_lag_seconds{machine_id="${id}"} ${sec(ms)}`)
  ];
}
