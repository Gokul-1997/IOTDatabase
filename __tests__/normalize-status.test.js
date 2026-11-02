import { normalizeMachineState, parseEnergy, parsePower } from '../src/lib/normalize-status.js';

describe('normalizeMachineState', () => {
  test.each([
    ['RUN',      { machine_status: 'RUNNING', alarm: false }],
    ['RUNNING',  { machine_status: 'RUNNING', alarm: false }],
    ['CUTTING',  { machine_status: 'RUNNING', alarm: false }],
    ['running',  { machine_status: 'RUNNING', alarm: false }],  // case-insensitive
    ['ALARM',    { machine_status: 'IDLE',    alarm: true  }],
    ['IDLE',     { machine_status: 'IDLE',    alarm: false }],
    ['SETUP',    { machine_status: 'IDLE',    alarm: false }],
    ['',         { machine_status: 'IDLE',    alarm: false }],
    [null,       { machine_status: 'IDLE',    alarm: false }],
    [undefined,  { machine_status: 'IDLE',    alarm: false }]
  ])('"%s" → %o', (input, expected) => {
    expect(normalizeMachineState(input)).toEqual(expected);
  });
});

describe('parseEnergy', () => {
  test.each([
    ['12.5',    12.5],
    ['12,5',    12.5],     // European decimal comma
    ['1234',    1234],
    ['12.5kWh', 12.5],     // strips units
    [' 7.0 ',   7.0],
    [42,        42],
    [110.80000305175781, 110.80000305175781],   // the meter's number, as VMC - 1 - F sends it now
    [3.6e-7,    3.6e-7],   // not "3.6e-7" → "3.67" once the "e-" is stripped
    ['3.6e-7 kWh', 3.6e-7],
    ['1e3 kWh', 1000],
    ['+12,5 KWH', 12.5],
    [0, 0],
    ['0 kWh', 0],
    [-12.5, null],
    ['-12.5 kWh', null],
    ['error123', null],
    ['1.2.3', null],
    ['12 kWh unavailable', null],
    ['12 MWh', 12000],
    ['12000 Wh', 12],
    ['1e999', null],
    ['9'.repeat(400), null],
    [true, null],
    [[], null],
    [{ value: 12 }, null],
    [NaN,       null],
    [Infinity,  null],
    [null,      null],
    [undefined, null],
    ['abc',     null],
    ['',        null]
  ])('%j → %j', (input, expected) => {
    expect(parseEnergy(input)).toBe(expected);
  });
});

describe('explicit electrical units', () => {
  test.each([
    [1000, 'Wh', 1], [1, 'MWh', 1000], ['1,5', 'MWh', 1500],
    ['1e3 Wh', 'Wh', 1], ['+12 KWH', 'kWh', 12], [0, 'Wh', 0],
    [1, 'kW', null], ['1 kW', undefined, null], [1, 'kVAh', null],
    [1, 'GW', null], [1, null, null], ['1 MWh', 'kWh', null],
    ['1 mWh', undefined, null], [1, 'mwh', null],
    ['-1 Wh', undefined, null], ['1e308 MWh', undefined, null],
    [1e-323, 'Wh', null],
  ])('energy %j with metadata %j becomes %j kWh', (value, unit, expected) => {
    expect(parseEnergy(value, unit)).toBe(expected);
  });

  test.each([
    [2, undefined, 2], [-2, undefined, -2], ['-1500 W', undefined, -1.5],
    ['0.002 MW', undefined, 2], ['+2,5 kW', undefined, 2.5],
    [-1500, 'W', -1.5], [0.002, 'MW', 2], ['1e3', 'W', 1],
    [0, 'W', 0], ['-0 kW', undefined, 0],
    ['1 kWh', undefined, null], [1, 'Wh', null], ['1 W', 'kW', null],
    ['1 mW', undefined, null], [1, 'mw', null],
    ['1 kW unavailable', undefined, null], [1, 'horsepower', null],
    [Infinity, undefined, null], ['1e308 MW', undefined, null],
    [true, undefined, null], [{ value: 2 }, undefined, null],
  ])('power %j with metadata %j becomes %j kW', (value, unit, expected) => {
    expect(parsePower(value, unit)).toBe(expected);
  });
});
