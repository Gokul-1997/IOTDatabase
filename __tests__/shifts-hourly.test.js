/*
 * Shift membership and the hourly production split — the arithmetic every
 * OEE, Downtime and Factory figure is built from.
 */
import { shiftAt, timeToSec, istSecondOfDay, shiftBoundariesBetween } from '../src/lib/shifts.js';
import { hourlySlices, istHourStart, sumSlices } from '../src/lib/hourly.js';

// IST wall-clock → epoch seconds (IST = UTC+05:30, no DST)
const ist = s => Date.parse(`${s}+05:30`) / 1000;
const shifts = [
  { id: 1, start: timeToSec('06:00:00'), end: timeToSec('14:00:00') },
  { id: 2, start: timeToSec('14:00:00'), end: timeToSec('22:00:00') },
  { id: 3, start: timeToSec('22:00:00'), end: timeToSec('06:00:00') }   // across midnight
];

describe('which shift a moment belongs to', () => {
  test('inside each shift, in IST', () => {
    expect(shiftAt(shifts, ist('2026-10-05T09:15:00'))).toBe(1);
    expect(shiftAt(shifts, ist('2026-10-05T17:30:00'))).toBe(2);
    expect(shiftAt(shifts, ist('2026-10-05T23:59:59'))).toBe(3);
    expect(shiftAt(shifts, ist('2026-10-06T00:00:00'))).toBe(3);   // midnight
    expect(shiftAt(shifts, ist('2026-10-06T05:59:59'))).toBe(3);
  });

  test('a shared boundary second belongs to the lower id, as BETWEEN with LIMIT 1 did', () => {
    expect(shiftAt(shifts, ist('2026-10-05T14:00:00'))).toBe(1);
    // half a second later it is the next shift
    expect(shiftAt(shifts, ist('2026-10-05T14:00:00') + 0.5)).toBe(2);
  });

  test('a gap between shifts belongs to none', () => {
    const day = [{ id: 7, start: timeToSec('08:00'), end: timeToSec('17:00') }];
    expect(shiftAt(day, ist('2026-10-05T07:59:59'))).toBeNull();
    expect(shiftAt(day, ist('2026-10-05T19:00:00'))).toBeNull();
    expect(shiftAt([], ist('2026-10-05T09:00:00'))).toBeNull();
  });

  test('IST second of the day, and the boundaries inside an interval', () => {
    expect(istSecondOfDay(ist('2026-10-05T00:00:10'))).toBe(10);
    expect(shiftBoundariesBetween(shifts, ist('2026-10-05T13:59:00'), ist('2026-10-05T14:01:00')))
      .toEqual([ist('2026-10-05T14:00:00')]);
    expect(shiftBoundariesBetween(shifts, ist('2026-10-05T21:59:00'), ist('2026-10-05T22:00:00'))).toEqual([]);
  });
});

describe('the hourly split', () => {
  const base = { companyId: 4, machineId: 9, prevMode: 'AUTO', shifts };

  test('an interval inside one hour is one row, credited to the earlier state', () => {
    const s = hourlySlices({ ...base, prevStatus: 'RUNNING', from: ist('2026-10-05T10:10:00'), to: ist('2026-10-05T10:10:05'), produced: 1 });
    expect(s).toEqual([{ company_id: 4, machine_id: 9, shift_id: 1, hour_start: ist('2026-10-05T10:00:00'),
      run: 5, idle: 0, manual: 0, produced: 1, energy: 0 }]);
  });

  test('hours are IST hours (hh:00 IST is hh-1:30 UTC)', () => {
    expect(istHourStart(ist('2026-10-05T10:59:59'))).toBe(ist('2026-10-05T10:00:00'));
    expect(new Date(istHourStart(ist('2026-10-05T10:20:00')) * 1000).toISOString()).toBe('2026-10-05T04:30:00.000Z');
  });

  test('crossing an IST hour splits at it; the parts are counted once, in the later slice', () => {
    const s = hourlySlices({ ...base, prevStatus: 'IDLE', from: ist('2026-10-05T10:59:58'), to: ist('2026-10-05T11:00:03'), produced: 2 });
    expect(s.map(x => [x.hour_start, x.idle, x.produced])).toEqual([
      [ist('2026-10-05T10:00:00'), 2, 0],
      [ist('2026-10-05T11:00:00'), 3, 2]
    ]);
  });

  test('crossing a shift change splits at it and credits each side to its own shift', () => {
    const s = hourlySlices({ ...base, prevStatus: 'RUN', from: ist('2026-10-05T13:59:58'), to: ist('2026-10-05T14:00:02') });
    expect(s.map(x => [x.shift_id, x.run])).toEqual([[1, 2], [2, 2]]);
  });

  test('across midnight, the night shift keeps both sides; the IST date changes', () => {
    const s = hourlySlices({ ...base, prevStatus: 'RUN', from: ist('2026-10-05T23:59:59'), to: ist('2026-10-06T00:00:04') });
    expect(s.map(x => [x.shift_id, x.hour_start, x.run])).toEqual([
      [3, ist('2026-10-05T23:00:00'), 1],
      [3, ist('2026-10-06T00:00:00'), 4]
    ]);
  });

  test('energy is spread by time; manual mode is counted as manual too', () => {
    const s = hourlySlices({ ...base, prevStatus: 'RUN', prevMode: 'MANUAL', energy: 1,
      from: ist('2026-10-05T10:59:00'), to: ist('2026-10-05T11:01:00') });
    expect(s.map(x => [x.energy, x.manual])).toEqual([[0.5, 60], [0.5, 60]]);
  });

  test('time outside every shift adds nothing; an empty or backwards interval adds nothing', () => {
    const day = [{ id: 7, start: timeToSec('08:00'), end: timeToSec('17:00') }];
    expect(hourlySlices({ ...base, shifts: day, prevStatus: 'RUN', from: ist('2026-10-05T19:00:00'), to: ist('2026-10-05T19:00:05') })).toEqual([]);
    expect(hourlySlices({ ...base, prevStatus: 'RUN', from: 100, to: 100 })).toEqual([]);
    expect(hourlySlices({ ...base, prevStatus: 'RUN', from: 200, to: 100 })).toEqual([]);
  });

  test('a day of 1-second readings adds up to the day, with no second counted twice', () => {
    const from = ist('2026-10-05T00:00:00');
    let all = [];
    for (let t = from; t < from + 86_400; t++) all.push(...hourlySlices({ ...base, prevStatus: t % 60 < 45 ? 'RUN' : 'IDLE', from: t, to: t + 1 }));
    const rows = sumSlices(all);
    expect(rows).toHaveLength(24);              // one row per hour: the shift changes fall on the hour
    expect(rows.reduce((a, r) => a + r.run + r.idle, 0)).toBe(86_400);
    expect(rows.reduce((a, r) => a + r.run, 0)).toBe(86_400 * 45 / 60);
  });
});
