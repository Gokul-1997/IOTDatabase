/*
 * Energy meter readings, tested against the embedded team's own sample:
 * the PowerData block VMC - 1 - F (192.168.200.2) sent on 3 Oct 2026, with
 * `Energy` as a number. Its kW is negative and Export energy outruns Import
 * (the meter's current transformers face the wrong way); kept as sent.
 */

import { powerSignals, meterReading, METER_FIELDS } from '../src/lib/power-signals.js';

const PowerData = {
  Voltage_V1N: 241.35000610351562, Voltage_V2N: 240.5399932861328, Voltage_V3N: 239.88999938964844,
  Average_Voltage_LN: 240.58999633789062,
  Voltage_V12: 418.05999755859375, Voltage_V23: 416.20001220703125, Voltage_V31: 415.92999267578125,
  Average_Voltage_LL: 416.7300109863281,
  Current_I1: 1.090000033378601, Current_I2: 1.4600000381469727, Current_I3: 1.184000015258789,
  Average_Current: 1.24399995803833,
  kW1: -0.1845848262310028, kW2: -0.2698122560977936, kW3: -0.2759864628314972,
  kVAr1: -0.18744347989559174, kVAr2: -0.22479908168315887, kVAr3: -0.06711475551128387,
  kVA1: 0.2630715072154999, kVA2: 0.35118839144706726, kVA3: 0.2840297818183899,
  PF1: -0.7016000151634216, PF2: -0.7681999802589417, PF3: -0.9715999960899353, Average_PF: -0.8360000252723694,
  Frequency: 49.95800018310547,
  Total_kW: -0.7303835153579712, Total_kVAr: -0.4793573021888733, Total_kVA: 0.898289680480957,
  Active_Power_Max_Demand: 0.09415600448846817, Active_Power_Min_Demand: -2.204396963119507,
  Reactive_Power_Max_Demand: 0, Reactive_Power_Min_Demand: -2.183621883392334,
  Apparent_Power_Max_Demand: 3.139817714691162,
  Maximum_Voltage_V1N: 244.0399932861328, Maximum_Voltage_V2N: 243.1699981689453, Maximum_Voltage_V3N: 242.2899932861328,
  Maximum_Voltage_V12: 422.760009765625, Maximum_Voltage_V23: 420.489990234375, Maximum_Voltage_V31: 419.9700012207031,
  Maximum_Current_I1: 14.970000267028809, Maximum_Current_I2: 15.154000282287598, Maximum_Current_I3: 14.880000114440918,
  Import_Active_Energy_kWh: 33.099998474121094, Export_Active_Energy_kWh: 77.5, Total_Active_Energy_kWh: 110.80000305175781,
  Import_Reactive_Energy_kVArh: 0.699999988079071, Export_Reactive_Energy_kVArh: 107, Total_Reactive_Energy_kVArh: 107.9000015258789,
  Total_Apparent_Energy_kVAh: 158.1999969482422,
  Run_Hour: 116.30999755859375, Auxiliary_Interrupts: 5
};

const sample = {
  machine_ip: '192.168.200.2', connection: true, machine_status: 'EMERGENCY', status: 5, mode: 'EDIT',
  feed_rate: 0, spindle_speed: 0, spindle_load: 0, parts_count: 76, program_number: 1083,
  time: 1791027611, spindle_motor_temperature: 36,
  PowerData,
  Energy: 110.80000305175781
};

describe('powerSignals — the PowerData block', () => {
  test('VMC - 1 - F: kWh, line-to-line volts, average amps and total kW', () => {
    expect(powerSignals(sample)).toEqual({
      energy:  110.80000305175781,
      voltage: 416.7300109863281,
      current: 1.24399995803833,
      power:   -0.7303835153579712
    });
  });

  test('the old string form of Energy still reads', () => {
    expect(powerSignals({ ...sample, Energy: '110.8 kWh' }).energy).toBe(110.8);
  });

  test('without Energy, the block\'s running total is used — not Import alone, which stands still while the CTs face the wrong way', () => {
    const { Energy, ...noEnergy } = sample;
    expect(powerSignals(noEnergy).energy).toBe(110.80000305175781);
  });

  test('line-to-neutral only when no line-to-line voltage is sent', () => {
    const { Average_Voltage_LL, ...lnOnly } = PowerData;
    expect(powerSignals({ PowerData: lnOnly }).voltage).toBe(240.58999633789062);
  });

  test('keys match whatever their case or spelling of the block name', () => {
    const r = powerSignals({ powerdata: { average_voltage_ll: '415.2', AVERAGE_CURRENT: 18.6, total_KW: 7.7 } });
    expect(r).toEqual({ energy: null, voltage: 415.2, current: 18.6, power: 7.7 });
    expect(powerSignals({ power_data: { Total_kW: 3 } }).power).toBe(3);
  });

  test('a 0 is a reading, not a missing value (the supply can be off)', () => {
    expect(powerSignals({ PowerData: { Average_Voltage_LL: 0, Average_Current: 0, Total_kW: 0 } }))
      .toEqual({ energy: null, voltage: 0, current: 0, power: 0 });
  });
});

describe('powerSignals — the flat keys of the payload contract', () => {
  test('energy, voltage, current and power as top-level numbers', () => {
    expect(powerSignals({ energy: 12345.67, voltage: 415.2, current: 18.6, power: 7.7 }))
      .toEqual({ energy: 12345.67, voltage: 415.2, current: 18.6, power: 7.7 });
  });

  test('older spellings: volts, amps, amperes, kw', () => {
    expect(powerSignals({ volts: 415, amps: 10, kw: 5 })).toEqual({ energy: null, voltage: 415, current: 10, power: 5 });
    expect(powerSignals({ amperes: 11 }).current).toBe(11);
  });

  test('the block wins over flat keys when both are sent', () => {
    expect(powerSignals({ voltage: 1, PowerData: { Average_Voltage_LL: 416 } }).voltage).toBe(416);
  });
});

describe('powerSignals — nothing to read', () => {
  test.each([
    ['no meter at all', { machine_status: 'RUN' }],
    ['an empty block', { PowerData: {} }],
    ['a block that is not an object', { PowerData: 'n/a' }],
    ['junk values', { PowerData: { Average_Voltage_LL: 'x', Average_Current: null, Total_kW: '' } }]
  ])('%s → all null', (_label, payload) => {
    expect(powerSignals(payload)).toEqual({ energy: null, voltage: null, current: null, power: null });
  });

  test('not a payload at all', () => {
    expect(powerSignals(null)).toEqual({ energy: null, voltage: null, current: null, power: null });
  });
});

describe('meterReading — the whole block, for energy_meter_readings', () => {
  test('VMC - 1 - F: all 52 values land in their columns', () => {
    const r = meterReading(sample);
    expect(Object.keys(r)).toEqual(METER_FIELDS.map(([c]) => c));
    expect(Object.values(r).every(v => v !== null)).toBe(true);
    expect(r).toMatchObject({
      v1n: 241.35000610351562, v_ln_avg: 240.58999633789062, v12: 418.05999755859375, v_ll_avg: 416.7300109863281,
      i1: 1.090000033378601, i_avg: 1.24399995803833,
      kw_total: -0.7303835153579712, kvar_total: -0.4793573021888733, kva_total: 0.898289680480957,
      pf_avg: -0.8360000252723694, frequency_hz: 49.95800018310547,
      kw_demand_max: 0.09415600448846817, kva_demand_max: 3.139817714691162,
      v1n_max: 244.0399932861328, i2_max: 15.154000282287598,
      kwh_import: 33.099998474121094, kwh_export: 77.5, kwh_total: 110.80000305175781,
      kvarh_export: 107, kvah_total: 158.1999969482422, run_hours: 116.30999755859375, aux_interrupts: 5
    });
  });

  test('a demand of 0 is a reading', () => {
    expect(meterReading(sample).kvar_demand_max).toBe(0);
  });

  test('every column reads a different key', () => {
    expect(new Set(METER_FIELDS.map(([, k]) => k)).size).toBe(METER_FIELDS.length);
    expect(new Set(METER_FIELDS.map(([c]) => c)).size).toBe(METER_FIELDS.length);
  });

  test('a partial block keeps what it has and leaves the rest empty', () => {
    const r = meterReading({ PowerData: { Total_kW: 5.5, Frequency: '50.01', Auxiliary_Interrupts: 7.9 } });
    expect(r.kw_total).toBe(5.5);
    expect(r.frequency_hz).toBe(50.01);
    expect(r.aux_interrupts).toBe(7);
    expect(r.v1n).toBeNull();
  });

  test.each([
    ['no meter', { machine_status: 'RUN' }],
    ['only the flat contract keys', { energy: 12.5, voltage: 415 }],
    ['an empty block', { PowerData: {} }],
    ['nothing readable', { PowerData: { Total_kW: 'x' } }],
    ['not a payload', null]
  ])('%s → null, so nothing is written', (_label, payload) => {
    expect(meterReading(payload)).toBeNull();
  });
});
