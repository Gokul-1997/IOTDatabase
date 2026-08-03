/*
 * Pure parts-count delta logic for MQTT telemetry.
 * Extracted so it can be unit-tested without a broker / DB / Redis.
 *
 * Real-world quirks this handles:
 *   - Counter reset on power cycle (parts_count goes from N → 0)
 *   - Stale-counter recovery (machine reboots showing old value, e.g. parts=28)
 *     until it actually starts producing → must NOT count those as new parts
 *   - Connection drop → counter went up while we weren't looking → trust delta
 *   - Reconnect spike — machine reconnects with accumulated absolute counter
 *     while Redis held a lower previous value (e.g. prev=7, curr=150 → delta=143)
 *   - Long server downtime — prev comes from DB fallback after Redis expiry;
 *     delta can legitimately exceed MAX_PARTS_DELTA in this case
 */

// No machine can physically produce more than this many parts between two 2-second
// telemetry messages. Tune lower if your fastest cycle time is longer than ~6 seconds.
const MAX_PARTS_DELTA = 20;

// When the gap between messages is this long, the delta could legitimately be large
// (server was down, machine kept producing). Use a much higher ceiling.
const GAP_RECOVERY_THRESHOLD_SEC = 300;  // 5 min — same as Redis TTL
const MAX_PARTS_DELTA_GAP        = 5000; // effectively unlimited for gap recovery

/**
 * @param {number} prevCount   - last known parts_count (from Redis or DB fallback)
 * @param {number} currCount   - current parts_count from MQTT payload
 * @param {number} [gapSeconds] - seconds since prevCount was recorded (0 = same session)
 */
export function partsDelta(prevCount, currCount, gapSeconds = 0) {
  if (prevCount == null) return 0;          // first message of a session
  const prev = Number(prevCount);
  const curr = Number(currCount);
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return 0;

  const isGapRecovery = gapSeconds >= GAP_RECOVERY_THRESHOLD_SEC;
  const maxDelta      = isGapRecovery ? MAX_PARTS_DELTA_GAP : MAX_PARTS_DELTA;

  let delta = curr - prev;

  if (delta < 0) {
    // Counter went backwards: reset.
    // Trust the new value only if it's small (indicates a real reset to 0..2).
    return curr <= 2 ? curr : 0;
  }

  if (delta >= 5 && prev <= 2 && !isGapRecovery) {
    // Stale-counter recovery — machine just reported a high number after sitting
    // at near-zero. Treat as carryover, not real production.
    // Skip this check for gap recovery — the machine genuinely produced those parts.
    return 0;
  }

  if (delta > maxDelta) {
    // Reconnect spike in normal operation — counter jumped by more than physically
    // possible between two consecutive messages. Drop it.
    // In gap recovery mode, maxDelta is very high so only true spikes are dropped.
    return 0;
  }

  return delta;
}
