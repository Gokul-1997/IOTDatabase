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
 * Two readers:
 *
 * powerSignals — the four values telemetry_raw keeps on every message, which
 * the Energy screen's totals use and the agreement asks for (kWh, volts,
 * amps), plus kW for the overload check:
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
 * meterReading — the whole block, for energy_meter_readings (Backend
 * migration 029): every phase, kVA/kVAr, power factor, frequency, demand,
 * the meter's highest values and its import/export registers.
 *
 * The flat keys of the payload contract (energy, voltage, current, power)
 * still work, for collectors that send those instead.
 */

import { canonicalPayload, num } from './condition-signals.js';
import { parseEnergy } from './normalize-status.js';

const isBlock = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The meter block with its keys lower-cased, or {} when there is none. */
function meterBlock(top) {
  const block = canonicalPayload(top.powerdata ?? top.power_data);
  return isBlock(block) ? block : {};
}

export function powerSignals(payload) {
  const p   = canonicalPayload(payload);
  const top = isBlock(p) ? p : {};
  const m   = meterBlock(top);

  return {
    energy:  parseEnergy(top.energy) ?? num(m.total_active_energy_kwh),
    voltage: num(m.average_voltage_ll) ?? num(m.average_voltage_ln) ?? num(top.voltage ?? top.volts),
    current: num(m.average_current) ?? num(top.current ?? top.amps ?? top.amperes),
    power:   num(m.total_kw) ?? num(top.power ?? top.kw)
  };
}

/**
 * energy_meter_readings column ← PowerData key (lower-cased). One list, so
 * the reader and the INSERT cannot drift apart; the table's columns are the
 * same names in the same order.
 */
export const METER_FIELDS = [
  // voltage, V: each phase to neutral, each pair of phases, and the averages
  ['v1n', 'voltage_v1n'], ['v2n', 'voltage_v2n'], ['v3n', 'voltage_v3n'], ['v_ln_avg', 'average_voltage_ln'],
  ['v12', 'voltage_v12'], ['v23', 'voltage_v23'], ['v31', 'voltage_v31'], ['v_ll_avg', 'average_voltage_ll'],
  // current, A
  ['i1', 'current_i1'], ['i2', 'current_i2'], ['i3', 'current_i3'], ['i_avg', 'average_current'],
  // power per phase and in total: kW, kVAr, kVA
  ['kw1', 'kw1'], ['kw2', 'kw2'], ['kw3', 'kw3'], ['kw_total', 'total_kw'],
  ['kvar1', 'kvar1'], ['kvar2', 'kvar2'], ['kvar3', 'kvar3'], ['kvar_total', 'total_kvar'],
  ['kva1', 'kva1'], ['kva2', 'kva2'], ['kva3', 'kva3'], ['kva_total', 'total_kva'],
  // power factor per phase and average; supply frequency, Hz
  ['pf1', 'pf1'], ['pf2', 'pf2'], ['pf3', 'pf3'], ['pf_avg', 'average_pf'],
  ['frequency_hz', 'frequency'],
  // demand over the meter's own window
  ['kw_demand_max', 'active_power_max_demand'], ['kw_demand_min', 'active_power_min_demand'],
  ['kvar_demand_max', 'reactive_power_max_demand'], ['kvar_demand_min', 'reactive_power_min_demand'],
  ['kva_demand_max', 'apparent_power_max_demand'],
  // the highest values the meter has recorded
  ['v1n_max', 'maximum_voltage_v1n'], ['v2n_max', 'maximum_voltage_v2n'], ['v3n_max', 'maximum_voltage_v3n'],
  ['v12_max', 'maximum_voltage_v12'], ['v23_max', 'maximum_voltage_v23'], ['v31_max', 'maximum_voltage_v31'],
  ['i1_max', 'maximum_current_i1'], ['i2_max', 'maximum_current_i2'], ['i3_max', 'maximum_current_i3'],
  // running totals
  ['kwh_import', 'import_active_energy_kwh'], ['kwh_export', 'export_active_energy_kwh'],
  ['kwh_total', 'total_active_energy_kwh'],
  ['kvarh_import', 'import_reactive_energy_kvarh'], ['kvarh_export', 'export_reactive_energy_kvarh'],
  ['kvarh_total', 'total_reactive_energy_kvarh'],
  ['kvah_total', 'total_apparent_energy_kvah'],
  ['run_hours', 'run_hour'],
  ['aux_interrupts', 'auxiliary_interrupts']
];

/**
 * Every value in the meter block, by column — or null when the payload has
 * no block or nothing in it can be read, so a machine without a meter costs
 * nothing.
 */
export function meterReading(payload) {
  const p = canonicalPayload(payload);
  const m = meterBlock(isBlock(p) ? p : {});

  const out = {};
  let any = false;
  for (const [column, key] of METER_FIELDS) {
    const v = num(m[key]);
    out[column] = column === 'aux_interrupts' && v !== null ? Math.trunc(v) : v;
    if (v !== null) any = true;
  }
  return any ? out : null;
}
