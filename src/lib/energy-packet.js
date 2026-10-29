import { canonicalPayload } from './condition-signals.js';
import { meterReading } from './power-signals.js';

// CNC snapshots keep their existing contract. Only a recognized electrical
// observation accompanied by transport metadata can use the independent lane.
const ENERGY = new Set(['powerdata', 'power_data', 'energy', 'energyformatted', 'energy_formatted',
  'energydata', 'energy_data', 'voltage', 'volts', 'current', 'amps', 'amperes', 'power', 'kw']);
const METADATA = new Set(['time', 'machine_ip', 'connection']);
export function isEnergyPacket(payload) {
  const p = canonicalPayload(payload);
  return !!p && typeof p === 'object' && !Array.isArray(p) &&
    Object.keys(p).every(key => ENERGY.has(key) || METADATA.has(key)) && meterReading(p) !== null;
}

export function observationTime(payload, receivedAtMs) {
  // Timestamp-free energy packets are observed on receipt. An explicitly
  // supplied but malformed device timestamp must never silently be corrected.
  return !Object.hasOwn(payload, 'time') && isEnergyPacket(payload)
    ? Math.floor(receivedAtMs / 1000) : Number(payload.time);
}
