import { normalizeMachineState, parseEnergy } from '../src/lib/normalize-status.js';

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
    ['12 MWh', null],
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
