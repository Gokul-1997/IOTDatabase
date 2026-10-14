import crypto from 'node:crypto';
import { canonicalPayload } from './condition-signals.js';

export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const MAX_FUTURE_MS = 60_000;
const MIN_DEVICE_TIME = 946_684_800; // 2000-01-01, seconds (milliseconds are rejected)

export function validDeviceTime(value, receivedAtMs, maxFutureMs = MAX_FUTURE_MS) {
  return Number.isSafeInteger(value) && value >= MIN_DEVICE_TIME &&
    value * 1000 <= receivedAtMs + maxFutureMs;
}

/** Stable fingerprint includes every signal, so two observations in one second remain distinct. */
export function fingerprint(payload) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
}

export function parseTelemetry(packet, receivedAtMs, maxBytes = MAX_PAYLOAD_BYTES) {
  const match = /^machines\/([^/+#\s]{1,256})\/telemetry$/.exec(String(packet.topic));
  if (!match || !packet.payload || packet.payload.length > maxBytes) return null;
  let payload;
  try { payload = canonicalPayload(JSON.parse(packet.payload.toString())); } catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !validDeviceTime(Number(payload.time), receivedAtMs)) return null;
  // Deeply nested attacker-controlled JSON must not overflow fingerprint recursion.
  const pending = [[payload, 0]];
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (depth > 12) return null;
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  return { apiKey: match[1], payload };
}

/** MQTT.js calls this before QoS1 PUBACK, for both MQTT3.1.1 and MQTT5. */
export function installAdmission(client, { process, count = () => {}, log = () => {}, now = Date.now, maxBytes = MAX_PAYLOAD_BYTES }) {
  let active = 0;
  client.handleMessage = (packet, callback) => {
    if (active) { count('admission_failed'); client.stream.destroy(); return; }
    const receivedAtMs = now();
    const parsed = parseTelemetry(packet, receivedAtMs, maxBytes);
    if (!parsed) { count('invalid'); callback(); return; } // poison packets must not replay forever
    active++;
    Promise.resolve().then(() => process(parsed.apiKey, parsed.payload, receivedAtMs))
      .then(() => { active--; callback(); })
      .catch(error => {
        active--;
        count('admission_failed');
        log('error', 'reading was not acknowledged; broker will replay after reconnect', { error: error.message });
        // Do not invoke a successful callback: MQTT.js would send PUBACK.
        // Closing the transport retains an unacknowledged QoS1 publication in the persistent session.
        client.stream.destroy();
      });
  };
  return { stats: () => ({ active }) };
}
