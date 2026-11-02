import { powerSignals, meterReading, METER_FIELDS } from '../src/lib/power-signals.js';
import { isEnergyPacket, observationTime } from '../src/lib/energy-packet.js';

describe('canonical energy and power units in sparse observations', () => {
  test.each([
    [{ Energy: '3104000 Wh' }, 3104],
    [{ EnergyFormatted: '3.104 MWh' }, 3104],
    [{ energy: 3104000, energy_unit: 'Wh' }, 3104],
    [{ Energy_Formatted: 3.104, ENERGY_UNIT: 'MWh' }, 3104],
    [{ EnergyData: { Total_Wh: 3104000 } }, 3104],
    [{ ENERGY_DATA: { TOTAL_MWH: '3,104' } }, 3104],
    [{ EnergyData: { value: 3104000, unit: 'Wh' } }, 3104],
    [{ EnergyData: { value: '3.104 MWh', unit: 'MWh' } }, 3104],
    [{ energy: 0, energy_unit: 'MWh' }, 0],
  ])('normalizes independent energy %j to %s kWh', (payload, expected) => {
    expect(powerSignals(payload).energy).toBe(expected);
    expect(meterReading(payload).kwh_total).toBe(expected);
    expect(isEnergyPacket(payload)).toBe(true);
    expect(observationTime(payload, 1793127205123)).toBe(1793127205);
  });

  test.each([
    [{ power: '-955 W' }, -0.955],
    [{ power: '-0.000955 MW' }, -0.955],
    [{ power: -955, power_unit: 'W' }, -0.955],
    [{ POWER: '0.002', POWER_UNIT: 'MW' }, 2],
    [{ power: 0, power_unit: 'W' }, 0],
  ])('normalizes independent signed power %j to %s kW', (payload, expected) => {
    expect(powerSignals(payload).power).toBe(expected);
    expect(meterReading(payload).kw_total).toBe(expected);
    expect(isEnergyPacket(payload)).toBe(true);
  });

  test('fixed-unit keys ignore metadata belonging to separate ambiguous flat values', () => {
    const payload = { energy_unit: 'MWh', power_unit: 'W', kw: 2,
      EnergyData: { Total_kWh: 3104, unit: 'Wh' },
      PowerData: { Total_kW: -0.955, Import_Active_Energy_kWh: 1102.4,
        Export_Active_Energy_kWh: 2000.3, Total_Active_Energy_kWh: 3104 } };
    expect(powerSignals(payload)).toMatchObject({ energy: 3104, power: -0.955 });
    expect(meterReading(payload)).toMatchObject({ kwh_total: 3104, kw_total: -0.955,
      kwh_import: 1102.4, kwh_export: 2000.3 });
    expect(powerSignals({ kw: 2, power_unit: 'MW' }).power).toBe(2);
  });

  test('fixed-unit block strings may state their own correct unit', () => {
    const payload = { PowerData: { kw1: '-0.5 kW', Total_kW: '-0.955 kW',
      Active_Power_Min_Demand: '-4 kW', Total_Active_Energy_kWh: '3104 kWh',
      Import_Active_Energy_kWh: '1102.4 kWh' } };
    expect(powerSignals(payload)).toMatchObject({ energy: 3104, power: -0.955 });
    expect(meterReading(payload)).toMatchObject({ kw1: -0.5, kw_total: -0.955,
      kw_demand_min: -4, kwh_total: 3104, kwh_import: 1102.4 });
  });

  test('invalid unit aliases do not hide a valid independently named reading', () => {
    const payload = { Energy: 3.104, energy_unit: 'horsepower', power: 955, power_unit: 'Wh',
      EnergyData: { Total_MWh: 3.104 }, kw: -0.955 };
    expect(powerSignals(payload)).toMatchObject({ energy: 3104, power: -0.955 });
    expect(meterReading(payload)).toMatchObject({ kwh_total: 3104, kw_total: -0.955 });
    expect(isEnergyPacket(payload)).toBe(true);
  });

  test.each([
    { Energy: 12, energy_unit: 'kW' }, { Energy: '12 MWh', energy_unit: 'kWh' },
    { EnergyData: { value: 12 } }, { EnergyData: { value: 12, unit: 'kW' } },
    { EnergyData: { Total_Wh: -10 } }, { EnergyData: { Total_MWh: '1 kWh' } },
    { power: 12, power_unit: 'kWh' }, { power: '1 MW', power_unit: 'W' },
    { PowerData: { Total_kW: '1000 W' } },
    { PowerData: { Total_Active_Energy_kWh: '1 MWh' } },
    { energy_unit: 'kWh', power_unit: 'kW' },
  ])('rejects ambiguous, negative or dimension-conflicting independent payload %j', payload => {
    expect(meterReading(payload)).toBeNull();
    expect(isEnergyPacket(payload)).toBe(false);
  });

  test('all canonical DB columns remain unchanged and sparse values stay sparse', () => {
    const columns = METER_FIELDS.map(([column]) => column);
    const reading = meterReading({ energy: 1000, energy_unit: 'Wh' });
    expect(Object.keys(reading)).toEqual(columns);
    expect(Object.entries(reading).filter(([, value]) => value !== null)).toEqual([['kwh_total', 1]]);
    const next = meterReading({ power: 2000, power_unit: 'W' });
    expect(Object.entries(next).filter(([, value]) => value !== null)).toEqual([['kw_total', 2]]);
  });
});
