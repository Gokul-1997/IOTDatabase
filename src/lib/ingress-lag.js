/*
 * How late readings reach the collector: the moment a reading arrived
 * against its own timestamp (payload.time, the gateway's clock).
 *
 * A few seconds is normal. A gateway that falls behind shows here long
 * before its readings pass the 5-minute limit and are set aside in
 * telemetry_late, so this is the number to alert on
 * (/metrics pms_ingress_lag_max_seconds).
 *
 * In the log, a line naming every late machine and its worst lag when the
 * lateness starts, when another machine falls behind, when it gets worse
 * (past 60 s, 120 s, 240 s — error from 120 s), as a reminder every 15
 * minutes while it lasts, and once for each machine that supplies a new
 * reading under the threshold. Silence does not establish recovery.
 * Not a line per reading (three a second on 6 Oct 2026), and not
 * the same line every minute: the Fanuc gateway ran a steady 15 s behind for
 * days, and a minute-by-minute repeat of that read like a fault.
 */

const FORGET_MS = 10 * 60_000;   // a machine not heard from for 10 min drops off /metrics
// steps towards the 5-minute limit; a lag that crosses one is logged at once
const STEPS_MS = [60_000, 120_000, 240_000];

export function createLagTracker({ warnMs = 10_000, everyMs = 60_000, remindMs = 15 * 60_000, limitMs = 5 * 60_000, log, now = Date.now } = {}) {
  const latest = new Map();   // machine id → { ms, at }
  let late = new Map();       // machine id → { readings, worstMs } since the last summary
  let windowStart = now();
  const shown = new Map();    // unresolved reported machines → last reported severity step
  const recovered = new Set(); // reported machines with a subsequent on-time reading
  let lastShownAt = -Infinity;
  const stepOf = ms => STEPS_MS.filter(s => ms > s).length;

  function forget(t) {
    for (const [id, v] of latest) {
      if (t - v.at <= FORGET_MS) continue;
      latest.delete(id);
      shown.delete(id);
      recovered.delete(id);
    }
  }

  function summarize(t) {
    forget(t);
    if (late.size) {
      const machines = {};
      let readings = 0;
      let worst = 0;
      for (const [id, m] of late) {
        machines[id] = m.worstMs;
        readings += m.readings;
        worst = Math.max(worst, m.worstMs);
      }
      const step = stepOf(worst);
      const newlyLate = [...late.keys()].some(id => !shown.has(id));
      // Compare the group's severity with machines actually seen late in this
      // window. A silent severe machine must not mask an active group's rise,
      // and sequential arrivals at a window boundary must not repeat it.
      let previousStep = 0;
      for (const id of late.keys()) previousStep = Math.max(previousStep, shown.get(id) ?? 0);
      const escalated = step > previousStep;
      if (newlyLate || escalated || t - lastShownAt >= remindMs) {
        log(step >= 2 ? 'error' : 'warn', 'readings arriving late', {
          machines, late_readings: readings, worst_ms: worst,
          threshold_ms: warnMs, limit_ms: limitMs, window_s: Math.round((t - windowStart) / 1000)
        });
        for (const [id, m] of late) {
          if (latest.has(id)) shown.set(id, stepOf(m.worstMs));
        }
        lastShownAt = t;
      }
    }
    if (recovered.size) {
      log('info', 'readings on time again', { machines: [...recovered], threshold_ms: warnMs });
      for (const id of recovered) shown.delete(id);
      recovered.clear();
      if (!shown.size) lastShownAt = t;
    }
    late = new Map();
    windowStart = t;
  }

  return {
    observe(machineId, lagMs) {
      const t = now();
      latest.set(machineId, { ms: lagMs, at: t });
      if (shown.has(machineId)) {
        if (lagMs > warnMs) recovered.delete(machineId);
        else recovered.add(machineId);
      }
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
      forget(t);
      const machines = {};
      let worst = null;
      for (const [id, v] of latest) {
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
