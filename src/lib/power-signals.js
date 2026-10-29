/*
 * Electrical readings from a machine's energy meter.
 *
 * The embedded team's collector sends either a full block or changed fields,
 * first seen
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
 *   energy   the meter's running total in kWh: `Energy`, `EnergyFormatted`,
 *            `EnergyData.Total_kWh`, or PowerData.Total_Active_Energy_kWh.
 *            The first valid value wins; zero is a real reading.
 *   voltage  the line-to-line average (~415 V), the figure a 3-phase supply
 *            is quoted in; the separate phase-to-neutral reading is never
 *            substituted for it
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

import { canonicalPayload } from './condition-signals.js';
import { parseEnergy } from './normalize-status.js';

const isBlock = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// Migration029 uses REAL for instantaneous readings, DOUBLE PRECISION for
// cumulative registers/run_hours, and INT for interruption counts. A finite
// JavaScript number can still overflow REAL/INT and poison a journal batch.
const FLOAT4_MAX = (2 - 2 ** -23) * 2 ** 127;
const FLOAT4_MIN = 2 ** -149;
const INT32_MAX = 2 ** 31 - 1;
const DOUBLE_COLUMNS = /^(?:kwh_|kvarh_|kvah_|run_hours$)/;

// Electrical values must be complete finite numbers. A diagnostic string
// such as "230 unavailable" must not become a convincing 230 V reading.
function meterNumber(value, unsigned = false) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = typeof value === 'string' ? value.trim() : null;
  if (text !== null && !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = text === null ? value : Number(text.replace(',', '.'));
  return Number.isFinite(number) && (!unsigned || number >= 0) ? number : null;
}

/** The meter block with its keys lower-cased, or {} when there is none. */
function meterBlock(top) {
  return namedBlock(top, ['powerdata', 'power_data']);
}

function namedBlock(top, keys) {
  for (const key of keys) {
    const block = canonicalPayload(top[key]);
    if (isBlock(block)) return block;
  }
  return {};
}

function firstReading(values, read) {
  for (const value of values) {
    const parsed = read(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readingCandidates(top, m) {
  const energy = namedBlock(top, ['energydata', 'energy_data']);
  return {
    kwh_total: [top.energy, top.energyformatted, top.energy_formatted, energy.total_kwh, m.total_active_energy_kwh],
    v_ll_avg: [m.average_voltage_ll, top.voltage, top.volts],
    i_avg: [m.average_current, top.current, top.amps, top.amperes],
    kw_total: [m.total_kw, top.power, top.kw]
  };
}

export function powerSignals(payload) {
  const p   = canonicalPayload(payload);
  const top = isBlock(p) ? p : {};
  const m   = meterBlock(top);
  const candidates = readingCandidates(top, m);

  return {
    energy:  firstReading(candidates.kwh_total, parseEnergy),
    voltage: firstReading(candidates.v_ll_avg, v => meterNumber(v, true)),
    current: firstReading(candidates.i_avg, v => meterNumber(v, true)),
    power:   firstReading(candidates.kw_total, meterNumber)
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
 * The fields received in this message, by column. A single changed field is
 * enough to create a reading; omitted fields stay null and are never copied
 * from an older message. No row is created when nothing can be read.
 */
export function meterReading(payload) {
  const p = canonicalPayload(payload);
  const top = isBlock(p) ? p : {};
  const m = meterBlock(top);
  const candidates = readingCandidates(top, m);

  const out = {};
  let any = false;
  for (const [column, key] of METER_FIELDS) {
    const unsigned = /^(?:v\d|v_ln|v_ll|i\d|i_avg|kva(?:\d|_total|_demand)|kwh|kvarh|kvah|run_hours|aux_interrupts)/.test(column);
    const value = firstReading(candidates[column] ?? [m[key]], candidate => {
      let value = column === 'kwh_total' ? parseEnergy(candidate) : meterNumber(candidate, unsigned);
      if (value === null) return null;
      if (column === 'aux_interrupts') {
        value = Math.trunc(value);
        if (value > INT32_MAX) value = null;
      } else if (!DOUBLE_COLUMNS.test(column)) {
        const magnitude = Math.abs(value);
        if (magnitude > FLOAT4_MAX || (magnitude !== 0 && magnitude < FLOAT4_MIN)) value = null;
      }
      return value;
    });
    out[column] = value;
    if (value !== null) any = true;
  }
  return any ? out : null;
}
