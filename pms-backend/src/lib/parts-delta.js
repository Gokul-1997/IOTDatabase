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
 */

// No machine can physically produce more than this many parts between two 2-second
// telemetry messages. Tune lower if your fastest cycle time is longer than ~6 seconds.
const MAX_PARTS_DELTA = 20;

export function partsDelta(prevCount, currCount) {
  if (prevCount == null) return 0;          // first message of a session
  const prev = Number(prevCount);
  const curr = Number(currCount);
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return 0;

  let delta = curr - prev;

  if (delta < 0) {
    // Counter went backwards: reset.
    // Trust the new value only if it's small (indicates a real reset to 0..2).
    return curr <= 2 ? curr : 0;
  }

  if (delta >= 5 && prev <= 2) {
    // Stale-counter recovery — machine just reported a high number after sitting
    // at near-zero. Treat as carryover, not real production.
    return 0;
  }

  if (delta > MAX_PARTS_DELTA) {
    // Reconnect spike — counter jumped by more than physically possible.
    // Machine likely reconnected with an accumulated absolute counter
    // while Redis had a stale lower value (e.g. prev=7, curr=150).
    return 0;
  }

  return delta;
}
