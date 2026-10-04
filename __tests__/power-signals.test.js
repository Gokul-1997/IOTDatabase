/*
 * Energy meter readings, tested against the embedded team's own sample:
 * the PowerData block VMC - 1 - F (192.168.200.2) sent on 3 Oct 2026, with
 * `Energy` as a number. Its kW is negative and Export energy outruns Import
 * (the meter's current transformers face the wrong way); kept as sent.
 */

import { powerSignals } from '../src/lib/power-signals.js';

const PowerData = {
  Voltage_V1N: 241.35000610351562, Voltage_V2N: 240.5399932861328, Voltage_V3N: 239.88999938964844,
  Average_Voltage_LN: 240.58999633789062,
  Voltage_V12: 418.05999755859375, Voltage_V23: 416.20001220703125, Voltage_V31: 415.92999267578125,
  Average_Voltage_LL: 416.7300109863281,
  Current_I1: 1.090000033378601, Current_I2: 1.4600000381469727, Current_I3: 1.184000015258789,
  Average_Current: 1.24399995803833,
  kW1: -0.1845848262310028, kW2: -0.2698122560977936, kW3: -0.2759864628314972,
  Average_PF: -0.8360000252723694, Frequency: 49.95800018310547,
  Total_kW: -0.7303835153579712, Total_kVAr: -0.4793573021888733, Total_kVA: 0.898289680480957,
  Import_Active_Energy_kWh: 33.099998474121094, Export_Active_Energy_kWh: 77.5,
  Total_Active_Energy_kWh: 110.80000305175781,
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
