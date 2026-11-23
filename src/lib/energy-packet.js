import { canonicalPayload } from './condition-signals.js';
import { meterReading } from './power-signals.js';

// CNC snapshots keep their existing contract. Only a recognized electrical
// observation accompanied by transport metadata can use the independent lane.
const ENERGY = new Set(['powerdata', 'power_data', 'energy', 'energyformatted', 'energy_formatted',
  'energydata', 'energy_data', 'energy_unit', 'power_unit',
  'voltage', 'volts', 'current', 'amps', 'amperes', 'power', 'kw',
  'active_power', 'reactive_power', 'apparent_power', 'power_factor',
  'frequency', 'demand', 'operating_data', 'thd']);
// Machine labels describe a reading; the authenticated MQTT topic remains
// the only source of machine/company identity.
const METADATA = new Set(['time', 'timestamp', 'machine', 'machine_ip', 'connection']);
export function isEnergyPacket(payload) {
  const p = canonicalPayload(payload);
  return !!p && typeof p === 'object' && !Array.isArray(p) &&
    Object.keys(p).every(key => ENERGY.has(key) || METADATA.has(key)) && meterReading(p) !== null;
}

function timestampSeconds(value) {
  // Require an explicit timezone. A local timestamp would otherwise depend
  // on the collector host's timezone, and Date.parse accepts invalid dates
  // such as February 30 by rolling them into the following month.
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, fraction = '', zone, sign, zoneHour, zoneMinute] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, mo, d, h, mi, s] = parts;
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  date.setUTCHours(h, mi, s, Number(fraction.slice(0, 3).padEnd(3, '0')));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== mo || date.getUTCDate() !== d ||
      date.getUTCHours() !== h || date.getUTCMinutes() !== mi || date.getUTCSeconds() !== s) return NaN;
  if (zone !== 'Z' && (Number(zoneHour) > 23 || Number(zoneMinute) > 59)) return NaN;
  const offset = zone === 'Z' ? 0 : (Number(zoneHour) * 60 + Number(zoneMinute)) * (sign === '+' ? 1 : -1);
  // Journal timestamps and meter conflict keys retain their existing
  // whole-second resolution; milliseconds must not become a second clock.
  return Math.floor(date.getTime() / 1000 - offset * 60);
}

export function observationTime(payload, receivedAtMs) {
  // Timestamp-free energy packets are observed on receipt. An explicitly
  // supplied but malformed device timestamp must never silently be corrected.
  const p = canonicalPayload(payload);
  if (!isEnergyPacket(p)) return Number(p?.time);
  const hasTime = Object.hasOwn(p, 'time');
  if (Object.hasOwn(p, 'timestamp')) {
    const timestamp = timestampSeconds(p.timestamp);
    return hasTime && Number(p.time) !== timestamp ? NaN : timestamp;
  }
  return hasTime ? Number(p.time) : Math.floor(receivedAtMs / 1000);
}
