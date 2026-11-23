import fs from 'node:fs';
import { powerSignals, meterReading, METER_FIELDS } from '../src/lib/power-signals.js';

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/nested-energy.json', import.meta.url), 'utf8'));
const leaf = (value, unit) => ({ parameter: 'description only', value, unit });

test('the VMC9 contract preserves every measured channel and every unknown sensor', () => {
  expect(powerSignals(sample)).toEqual({ energy: 681.4, voltage: 414.78, current: 0.632, power: -0.199 });
  expect(meterReading(sample)).toEqual({
    v1n: 239.97, v2n: 239.03, v3n: 239.42, v_ln_avg: 239.47,
    v12: 414.97, v23: 413.66, v31: 415.72, v_ll_avg: 414.78,
    i1: 0.504, i2: 0.828, i3: 0.564, i_avg: 0.632,
    kw1: 0.026, kw2: -0.114, kw3: -0.111, kw_total: -0.199,
    kvar1: 0.118, kvar2: 0.162, kvar3: -0.076, kvar_total: 0.205,
    kva1: 0.121, kva2: 0.198, kva3: 0.135, kva_total: 0.454,
    pf1: -0.213, pf2: -0.574, pf3: 0.825, pf_avg: -0.697, frequency_hz: 49.941,
    kw_demand_max: 0.103, kw_demand_min: -0.94,
    kvar_demand_max: 1.159, kvar_demand_min: -0.11, kva_demand_max: 4.791,
    v1n_max: 267.69, v2n_max: 266.6, v3n_max: 268.13,
    v12_max: 462.25, v23_max: 462.58, v31_max: 465.01,
    i1_max: 20.536, i2_max: 20.69, i3_max: 21.692,
    kwh_import: 249.1, kwh_export: 430.2, kwh_total: 681.4,
    kvarh_import: 313.5, kvarh_export: 115, kvarh_total: 431.2, kvah_total: 858.7,
    run_hours: null, aux_interrupts: null,
    thd_v1n: null, thd_v2n: null, thd_v3n: null, thd_v12: null, thd_v23: null, thd_v31: null,
    thd_i1: null, thd_i2: null, thd_i3: null
  });
  expect(Object.keys(meterReading(sample))).toEqual(METER_FIELDS.map(([column]) => column));
});

test('THD phases, true zeros and operating readings are stored independently', () => {
  const reading = meterReading({
    THD: {
      voltage: Object.fromEntries(['V1N', 'V2N', 'V3N', 'V12', 'V23', 'V31'].map((key, i) => [key, leaf(i, '%')])),
      current: { I1: leaf(6, '%'), I2: leaf(7, '%'), I3: leaf(8, '%') }
    },
    operating_data: { run_hour: leaf(0, 'Hour'), auxiliary_interrupts: leaf(5, 'Count') }
  });
  expect(Object.entries(reading).filter(([, value]) => value !== null)).toEqual([
    ['run_hours', 0], ['aux_interrupts', 5],
    ['thd_v1n', 0], ['thd_v2n', 1], ['thd_v3n', 2], ['thd_v12', 3], ['thd_v23', 4], ['thd_v31', 5],
    ['thd_i1', 6], ['thd_i2', 7], ['thd_i3', 8]
  ]);
});

test('nested keys are case insensitive and parameter descriptions never select channels', () => {
  const payload = { VOLTAGE: { AVERAGE_LL: { VALUE: '4.15e2', UNIT: 'V', parameter: 'wrong description' } },
    ENERGY: { TOTAL_ACTIVE: leaf('1,5', 'MWh') }, ACTIVE_POWER: { TOTAL: leaf(-955, 'W') } };
  expect(powerSignals(payload)).toEqual({ energy: 1500, voltage: 415, current: null, power: -0.955 });
  expect(meterReading(payload)).toMatchObject({ kwh_total: 1500, v_ll_avg: 415, kw_total: -0.955 });
});

test('new readings take precedence per field while valid legacy alternatives remain usable', () => {
  const payload = { ...sample, PowerData: { Total_Active_Energy_kWh: 12, Total_kW: 2, Average_Current: 3 } };
  expect(meterReading(payload)).toMatchObject({ kwh_total: 681.4, kw_total: -0.199, i_avg: 0.632 });
  payload.current = { average: leaf(null, 'A') };
  expect(meterReading(payload).i_avg).toBe(3);
});

test.each([null, undefined, true, [], {}, '', '1.2oops', 'NaN', 'Infinity', 1e100, -1])(
  'invalid or unstorable THD %j never becomes a measurement', value => {
    expect(meterReading({ THD: { current: { I1: leaf(value, '%') } } })).toBeNull();
  });

test.each([
  { energy: { total_active: leaf(1, 'kW') } },
  { active_power: { total: leaf(1, 'kWh') } },
  { voltage: { average_LL: leaf(415, 'A') } },
  { current: { average: leaf(-1, 'A') } },
  { apparent_power: { total: leaf(-1, 'kVA') } },
  { energy: { total_active: leaf(-1, 'kWh') } },
  { THD: { current: { I1: leaf(5, 'V') } } },
  { frequency: { value: 50 } },
  { operating_data: { run_hour: leaf(null, 'Hour'), auxiliary_interrupts: leaf(null, 'Count') } }
])('wrong dimensions, negative unsigned quantities and unknown-only packets stay empty: %j', payload => {
  expect(meterReading(payload)).toBeNull();
});

test('a change-only nested packet never carries over the previous packet or substitutes LN for LL', () => {
  meterReading(sample);
  const payload = { voltage: { average_LN: leaf(239, 'V') } };
  expect(Object.entries(meterReading(payload)).filter(([, value]) => value !== null)).toEqual([['v_ln_avg', 239]]);
  expect(powerSignals(payload)).toEqual({ energy: null, voltage: null, current: null, power: null });
});
