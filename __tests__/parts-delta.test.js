import { partsDelta } from '../src/lib/parts-delta.js';

describe('partsDelta', () => {
  test('null prev (first message) → 0', () => {
    expect(partsDelta(null, 5)).toBe(0);
  });

  test('normal increment 5 → 6 = +1', () => {
    expect(partsDelta(5, 6)).toBe(1);
  });

  test('multi-part increment 10 → 13 = +3', () => {
    expect(partsDelta(10, 13)).toBe(3);
  });

  test('counter reset 76 → 0 = 0', () => {
    expect(partsDelta(76, 0)).toBe(0);
  });

  test('counter reset 76 → 1 (real reset, small) = 1', () => {
    expect(partsDelta(76, 1)).toBe(1);
  });

  test('counter reset 76 → 5 (likely stale reading) = 0', () => {
    expect(partsDelta(76, 5)).toBe(0);
  });

  test('stale counter recovery 0 → 28 = 0 (NOT +28)', () => {
    expect(partsDelta(0, 28)).toBe(0);
  });

  test('stale counter recovery 2 → 50 = 0', () => {
    expect(partsDelta(2, 50)).toBe(0);
  });

  test('legitimate large jump 50 → 56 = +6 (prev was high, delta < threshold)', () => {
    expect(partsDelta(50, 56)).toBe(6);
  });

  test('big jump from 3 → 100 clamped by MAX_PARTS_DELTA → 0 (reconnect spike)', () => {
    // prev=3 is above <=2 but delta=97 exceeds MAX_PARTS_DELTA
    expect(partsDelta(3, 100)).toBe(0);
  });

  test('reconnect spike prev=7 → 150 → 0 (was causing 151 parts/hr bug)', () => {
    expect(partsDelta(7, 150)).toBe(0);
  });

  test('exactly delta=5 from near-zero prev=0 → 5 = 0 (>= 5 guard fix)', () => {
    expect(partsDelta(0, 5)).toBe(0);
  });

  test('exactly delta=5 from near-zero prev=2 → 7 = 0 (>= 5 guard fix)', () => {
    expect(partsDelta(2, 7)).toBe(0);
  });

  test('delta=4 from near-zero prev=1 → 5 = 4 (legitimate, under threshold)', () => {
    expect(partsDelta(1, 5)).toBe(4);
  });

  test('delta=20 from high prev=50 → 70 = 20 (at MAX limit, allowed)', () => {
    expect(partsDelta(50, 70)).toBe(20);
  });

  test('delta=21 from high prev=50 → 71 = 0 (exceeds MAX_PARTS_DELTA)', () => {
    expect(partsDelta(50, 71)).toBe(0);
  });

  test('non-numeric inputs → 0 (safe default)', () => {
    expect(partsDelta('foo', 5)).toBe(0);
    expect(partsDelta(5, 'bar')).toBe(0);
    expect(partsDelta(undefined, 5)).toBe(0);
  });
});
