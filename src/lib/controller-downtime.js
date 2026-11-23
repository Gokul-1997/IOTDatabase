import { canonicalPayload } from './condition-signals.js';

// The PLC meaning/unit is not yet configured. Preserve the reported number
// without interpreting it as a duration, reason ID, alarm or machine state.
export function controllerDowntimeValue(payload) {
  const value = canonicalPayload(payload)?.downtime;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}
