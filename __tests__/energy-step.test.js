import { energyStep } from '../src/lib/energy-step.js';

const T = 1_790_000_000;              // any epoch second
const at = (meter, t = T) => ({ meter, at: t });

describe('energyStep', () => {
  test('first reading of a session → nothing to compare, becomes the baseline', () => {
    expect(energyStep(null, 1500.5, T)).toEqual({ delta: null, last: at(1500.5) });
  });

  test('normal climb 1500 → 1500.4 = 0.4 kWh', () => {
    const r = energyStep(at(1500), 1500.4, T + 12);
    expect(r.last).toEqual(at(1500.4, T + 12));
    expect(r.delta).toBeCloseTo(0.4, 6);
  });

  test('meter unchanged → 0 kWh', () => {
    expect(energyStep(at(1500), 1500, T + 12)).toEqual({ delta: 0, last: at(1500, T + 12) });
  });

  test('a reading of 0 is a dropped read: nothing counted, the baseline and its time are kept', () => {
    expect(energyStep(at(107614960), 0, T + 12)).toEqual({ delta: null, last: at(107614960) });
  });

  test('VMC - 13 - M: total → 0 → total counts only the real climb, not the whole meter', () => {
    const a = energyStep(at(107614960), 0, T + 12);
    const b = energyStep(a.last, 107614984, T + 24);
    expect(b).toEqual({ delta: 24, last: at(107614984, T + 24) });
  });

  test('a misread spike is not counted; the reading after it restarts counting', () => {
    const spike = energyStep(at(107614960), 5427661841104900, T + 12);
    expect(spike.delta).toBe(0);
    const back = energyStep(spike.last, 107614968, T + 24);
    expect(back.delta).toBe(0);
    expect(energyStep(back.last, 107614976, T + 36)).toEqual({ delta: 8, last: at(107614976, T + 36) });
  });

  test('a small stray reading and the climb back from it count nothing', () => {
    const low = energyStep(at(107614960), 2.718, T + 12);
    expect(low).toEqual({ delta: 0, last: at(2.718, T + 12) });
    expect(energyStep(low.last, 107614968, T + 24).delta).toBe(0);
  });

  test('meter replaced or reset 5000 → 12 counts nothing, then counts from 12', () => {
    const r = energyStep(at(5000), 12, T + 12);
    expect(r).toEqual({ delta: 0, last: at(12, T + 12) });
    expect(energyStep(r.last, 13, T + 24).delta).toBe(1);
  });

  test('two messages in the same second still count a real step', () => {
    expect(energyStep(at(1500), 1508, T).delta).toBe(8);
  });

  test('the limit grows with the time since the last real reading, not since the last message', () => {
    // two hours of dropped reads, then a 300 kWh climb: possible at 150 kW
    const dropped = energyStep(at(1000), 0, T + 7188);
    expect(energyStep(dropped.last, 1300, T + 7200).delta).toBe(300);
    // 5,000 kWh in an hour is not
    expect(energyStep(at(1000), 6000, T + 3600).delta).toBe(0);
  });

  test('missing, non-numeric or negative readings keep the baseline', () => {
    for (const bad of [null, undefined, NaN, -3, 'abc']) {
      expect(energyStep(at(1500), bad, T + 12)).toEqual({ delta: null, last: at(1500) });
    }
  });

  test('a baseline of 0 or junk is no baseline', () => {
    expect(energyStep(at(0), 1500, T + 12)).toEqual({ delta: null, last: at(1500, T + 12) });
    expect(energyStep({ meter: 'x', at: T }, 1500, T + 12)).toEqual({ delta: null, last: at(1500, T + 12) });
  });

  test('no baseline and no reading → nothing', () => {
    expect(energyStep(null, null, T)).toEqual({ delta: null, last: null });
  });
});
