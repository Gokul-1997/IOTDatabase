/*
 * Electrical readings from a machine's energy meter.
 *
 * The embedded team's collector sends the meter as one block, first seen
 * from VMC - 1 - F (192.168.200.2) on 3 Oct 2026:
 *
 *   "PowerData": { "Average_Voltage_LN": 240.59, "Average_Voltage_LL": 416.73,
 *                  "Average_Current": 1.244, "Total_kW": -0.73,
 *                  "Total_Active_Energy_kWh": 110.8, … },
 *   "Energy": 110.8          (a number now; it used to arrive as "110.8 kWh")
 *
 * telemetry_raw keeps one value of each, which is what the Energy screen
 * shows and what the agreement asks for (kWh, volts, amps), plus kW for the
 * overload check:
 *
 *   energy   the meter's running total in kWh: `Energy`, or the block's
 *            Total_Active_Energy_kWh when `Energy` is missing
 *   voltage  the line-to-line average (~415 V), the figure a 3-phase supply
 *            is quoted in; line-to-neutral only when that is all there is
 *   current  the average of the three phases
 *   power    total kW, signed as the meter reports it. On VMC - 1 - F it is
 *            negative and Export energy outruns Import, which means the
 *            current transformers face the wrong way. Kept as sent so that
 *            stays visible; the Energy screen reads its size.
 *
 * The flat keys of the payload contract (energy, voltage, current, power)
 * still work, for collectors that send those instead.
 */

import { canonicalPayload, num } from './condition-signals.js';
import { parseEnergy } from './normalize-status.js';

const isBlock = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function powerSignals(payload) {
  const p     = canonicalPayload(payload);
  const top   = isBlock(p) ? p : {};
  // the block's own keys are matched case-insensitively too
  const block = canonicalPayload(top.powerdata ?? top.power_data);
  const m     = isBlock(block) ? block : {};

  return {
    energy:  parseEnergy(top.energy) ?? num(m.total_active_energy_kwh),
    voltage: num(m.average_voltage_ll) ?? num(m.average_voltage_ln) ?? num(top.voltage ?? top.volts),
    current: num(m.average_current) ?? num(top.current ?? top.amps ?? top.amperes),
    power:   num(m.total_kw) ?? num(top.power ?? top.kw)
  };
}
