import quality from '../src/lib/energy-quality.cjs';
import { METER_FIELDS } from '../src/lib/power-signals.js';

const { cleanElectrical, bounds } = quality;

test.each([null, undefined, '', '  ', true, false, [], [1], {}, NaN, Infinity, -Infinity])(
  'non-measurement %j stays unknown instead of becoming a number', value => {
    expect(cleanElectrical('voltage', value)).toBeNull();
  });

test('all typed channels have physical bounds while unknown channels fail closed', () => {
  for (const [channel] of METER_FIELDS) expect(bounds(channel)).toHaveLength(2);
  expect(() => cleanElectrical('not_a_channel', 1)).toThrow(TypeError);
});

test('canonical physical guards preserve genuine zero and exported power without unit conversion', () => {
  expect(cleanElectrical('energy', 681.4)).toBe(681.4);
  expect(cleanElectrical('kw_total', -0.199)).toBe(-0.199);
  expect(cleanElectrical('power', 0)).toBe(0);
  expect(cleanElectrical('pf_avg', -0.697)).toBe(-0.697);
  expect(cleanElectrical('thd_i1', 135)).toBe(135);
});
