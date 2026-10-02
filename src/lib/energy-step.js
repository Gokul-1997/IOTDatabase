/*
 * Pure energy-meter step logic for MQTT telemetry.
 * Extracted so it can be unit-tested without a broker / DB / Redis.
 *
 * Devices send the meter's running total in kWh; what a machine used between
 * two readings is the difference. That only holds when both readings are real:
 *   - A reading of 0 (or none) is a dropped read, not a meter at zero. The
 *     last real reading stays the baseline, so the climb across the gap is
 *     still counted. VMC - 13 - M sends 0 in about 60 % of its messages, and
 *     counting the climb back from 0 booked the whole meter total — about
 *     107 million — into one hour, several times a day.
 *   - A step bigger than any machine could draw since the last real reading
 *     is a misread (one message carried 5.4 × 10^15). Nothing is counted, and
 *     the new reading becomes the baseline so the next one is compared with it.
 *   - A reading lower than the last means the meter was reset or replaced:
 *     nothing is counted and counting restarts from the new reading.
 */

// Far beyond what any machine tool draws; a step implying more is a misread.
const MAX_KW = 2000;

// Measure the limit over at least five minutes, so two messages a moment
// apart can never turn a real step away.
const MIN_WINDOW_SEC = 300;

/**
 * @param {{meter:number, at:number}|null} last - the last real reading and when it was taken (epoch s)
 * @param {number|null} reading                 - this message's meter reading (kWh)
 * @param {number} now                          - this message's time (epoch s)
 * @returns {{ delta: number|null, last: {meter:number, at:number}|null }}
 *   delta — kWh used since the last real reading; null when there is nothing to compare;
 *   last  — the reading the next message is compared with.
 */
export function energyStep(last, reading, now) {
  const base = last && Number.isFinite(Number(last.meter)) && Number(last.meter) > 0
    ? { meter: Number(last.meter), at: Number(last.at) || now }
    : null;
  const curr = reading == null ? NaN : Number(reading);

  if (!Number.isFinite(curr) || curr <= 0) return { delta: null, last: base };

  const here = { meter: curr, at: now };
  if (!base) return { delta: null, last: here };

  const step = curr - base.meter;
  if (step < 0) return { delta: 0, last: here };

  const windowSec = Math.max(now - base.at, MIN_WINDOW_SEC);
  if (step > MAX_KW * windowSec / 3600) return { delta: 0, last: here };

  return { delta: step, last: here };
}
