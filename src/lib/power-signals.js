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
 * November's standalone meter contract groups readings by quantity, with
 * { parameter, value, unit } leaves. Both formats and the flat telemetry
 * keys remain readable; the grouped contract takes precedence per channel.
 */

import { canonicalPayload } from './condition-signals.js';
import { parseEnergy, parsePower } from './normalize-status.js';
import quality from './energy-quality.cjs';
const { cleanElectrical } = quality;

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

// Explicit paths keep demand/maxima separate from instantaneous readings.
// Labels in `parameter` are descriptive; only contract keys select a channel.
const NESTED_FIELDS = {
  v1n: ['voltage.v1n', 'V'], v2n: ['voltage.v2n', 'V'], v3n: ['voltage.v3n', 'V'],
  v_ln_avg: ['voltage.average_ln', 'V'],
  v12: ['voltage.v12', 'V'], v23: ['voltage.v23', 'V'], v31: ['voltage.v31', 'V'],
  v_ll_avg: ['voltage.average_ll', 'V'],
  i1: ['current.i1', 'A'], i2: ['current.i2', 'A'], i3: ['current.i3', 'A'],
  i_avg: ['current.average', 'A'],
  kw1: ['active_power.kw1', 'kW'], kw2: ['active_power.kw2', 'kW'], kw3: ['active_power.kw3', 'kW'],
  kw_total: ['active_power.total', 'kW'],
  kvar1: ['reactive_power.kvar1', 'kVAr'], kvar2: ['reactive_power.kvar2', 'kVAr'], kvar3: ['reactive_power.kvar3', 'kVAr'],
  kvar_total: ['reactive_power.total', 'kVAr'],
  kva1: ['apparent_power.kva1', 'kVA'], kva2: ['apparent_power.kva2', 'kVA'], kva3: ['apparent_power.kva3', 'kVA'],
  kva_total: ['apparent_power.total', 'kVA'],
  pf1: ['power_factor.pf1', ''], pf2: ['power_factor.pf2', ''], pf3: ['power_factor.pf3', ''],
  pf_avg: ['power_factor.average', ''], frequency_hz: ['frequency', 'Hz'],
  kw_demand_max: ['demand.active_power.maximum', 'kW'], kw_demand_min: ['demand.active_power.minimum', 'kW'],
  kvar_demand_max: ['demand.reactive_power.maximum', 'kVAr'], kvar_demand_min: ['demand.reactive_power.minimum', 'kVAr'],
  kva_demand_max: ['demand.apparent_power.maximum', 'kVA'],
  v1n_max: ['voltage.maximum.v1n', 'V'], v2n_max: ['voltage.maximum.v2n', 'V'], v3n_max: ['voltage.maximum.v3n', 'V'],
  v12_max: ['voltage.maximum.v12', 'V'], v23_max: ['voltage.maximum.v23', 'V'], v31_max: ['voltage.maximum.v31', 'V'],
  i1_max: ['current.maximum.i1', 'A'], i2_max: ['current.maximum.i2', 'A'], i3_max: ['current.maximum.i3', 'A'],
  kwh_import: ['energy.import_active', 'kWh'], kwh_export: ['energy.export_active', 'kWh'],
  kwh_total: ['energy.total_active', 'kWh'],
  kvarh_import: ['energy.import_reactive', 'kVArh'], kvarh_export: ['energy.export_reactive', 'kVArh'],
  kvarh_total: ['energy.total_reactive', 'kVArh'], kvah_total: ['energy.total_apparent', 'kVAh'],
  run_hours: ['operating_data.run_hour', 'Hour'], aux_interrupts: ['operating_data.auxiliary_interrupts', 'Count'],
  thd_v1n: ['thd.voltage.v1n', '%'], thd_v2n: ['thd.voltage.v2n', '%'], thd_v3n: ['thd.voltage.v3n', '%'],
  thd_v12: ['thd.voltage.v12', '%'], thd_v23: ['thd.voltage.v23', '%'], thd_v31: ['thd.voltage.v31', '%'],
  thd_i1: ['thd.current.i1', '%'], thd_i2: ['thd.current.i2', '%'], thd_i3: ['thd.current.i3', '%']
};

function nestedCandidate(top, column) {
  const [path, unit] = NESTED_FIELDS[column];
  const leaf = path.split('.').reduce((block, key) => isBlock(block) ? canonicalPayload(block)[key] : undefined, top);
  return { leaf: canonicalPayload(leaf), unit };
}

function nestedNumber({ leaf, unit }, unsigned = false) {
  if (!isBlock(leaf) || typeof leaf.unit !== 'string') return null;
  if (unit === 'kW') return parsePower(leaf.value, leaf.unit);
  if (unit === 'kWh') return parseEnergy(leaf.value, leaf.unit);
  if (leaf.unit.trim().toLowerCase() !== unit.toLowerCase()) return null;
  return meterNumber(leaf.value, unsigned);
}

function readingCandidates(top, m) {
  const energy = namedBlock(top, ['energydata', 'energy_data']);
  const quantity = (value, unit) => ({ value, unit });
  return {
    kwh_total: [
      quantity(top.energy, top.energy_unit),
      quantity(top.energyformatted, top.energy_unit),
      quantity(top.energy_formatted, top.energy_unit),
      quantity(energy.total_kwh, 'kWh'),
      quantity(energy.total_wh, 'Wh'),
      quantity(energy.total_mwh, 'MWh'),
      // A generic nested value needs its own explicit unit. An omitted unit
      // must not turn an ambiguous device-specific value into a kWh reading.
      quantity(energy.value, energy.unit === undefined ? null : energy.unit),
      quantity(m.total_active_energy_kwh, 'kWh'),
    ],
    v_ll_avg: [m.average_voltage_ll, top.voltage, top.volts],
    i_avg: [m.average_current, top.current, top.amps, top.amperes],
    kw_total: [quantity(m.total_kw, 'kW'), quantity(top.power, top.power_unit), quantity(top.kw, 'kW')]
  };
}

const energyQuantity = candidate => parseEnergy(candidate.value, candidate.unit);
const powerQuantity = candidate => parsePower(candidate.value, candidate.unit);

export function powerSignals(payload) {
  const p   = canonicalPayload(payload);
  const top = isBlock(p) ? p : {};
  const m   = meterBlock(top);
  const candidates = readingCandidates(top, m);

  const select = (column, read, unsigned = false) => {
    const nested = nestedCandidate(top, column);
    return firstReading([nested, ...candidates[column]], candidate => cleanElectrical(column,
      candidate === nested ? nestedNumber(candidate, unsigned) : read(candidate)));
  };
  return {
    energy: select('kwh_total', energyQuantity, true),
    voltage: select('v_ll_avg', v => meterNumber(v, true), true),
    current: select('i_avg', v => meterNumber(v, true), true),
    power: select('kw_total', powerQuantity)
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
  ['aux_interrupts', 'auxiliary_interrupts'],
  // Total harmonic distortion, percent; absent sensors stay unknown.
  ['thd_v1n', 'thd_voltage_v1n'], ['thd_v2n', 'thd_voltage_v2n'], ['thd_v3n', 'thd_voltage_v3n'],
  ['thd_v12', 'thd_voltage_v12'], ['thd_v23', 'thd_voltage_v23'], ['thd_v31', 'thd_voltage_v31'],
  ['thd_i1', 'thd_current_i1'], ['thd_i2', 'thd_current_i2'], ['thd_i3', 'thd_current_i3']
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
    const nested = nestedCandidate(top, column);
    const unsigned = /^(?:v\d|v_ln|v_ll|i\d|i_avg|kva(?:\d|_total|_demand)|kwh|kvarh|kvah|run_hours|aux_interrupts|thd_)/.test(column);
    const value = firstReading([nested, ...(candidates[column] ?? [m[key]])], candidate => {
      let value;
      if (candidate === nested) value = nestedNumber(candidate, unsigned);
      else if (column === 'kwh_total') value = energyQuantity(candidate);
      else if (column === 'kw_total') value = powerQuantity(candidate);
      else if (/^kwh_/.test(column)) value = parseEnergy(candidate, 'kWh');
      else if (/^kw(?:\d|_demand)/.test(column)) value = parsePower(candidate, 'kW');
      else value = meterNumber(candidate, unsigned);
      if (value === null) return null;
      if (column === 'aux_interrupts') {
        value = Math.trunc(value);
        if (value > INT32_MAX) value = null;
      } else if (!DOUBLE_COLUMNS.test(column)) {
        const magnitude = Math.abs(value);
        if (magnitude > FLOAT4_MAX || (magnitude !== 0 && magnitude < FLOAT4_MIN)) value = null;
      }
      return cleanElectrical(column, value);
    });
    out[column] = value;
    if (value !== null) any = true;
  }
  return any ? out : null;
}
