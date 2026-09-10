/*
 * Tests for src/lib/alarm-log — turning a per-message alarm flag into rows
 * that describe alarm *periods*.
 *
 * The flag on telemetry_raw cannot answer what the alarm report asks: how
 * many alarms happened, how long each lasted, which shift it fell in.
 * Those need a row opened when a machine starts alarming and closed when
 * it stops — which makes transition detection the whole job.
 *
 * Getting it wrong is expensive in a specific way: telemetry arrives about
 * once a second, so writing on every message instead of on every change
 * turns one real alarm into thousands of rows and every count on the
 * report becomes meaningless.
 */

import { jest } from '@jest/globals';

const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
jest.unstable_mockModule('../db.js', () => ({ pool: { query } }));

const { trackAlarm, openAlarm, closeAlarms } = await import('../src/lib/alarm-log.js');

const base = {
  companyId: 4, machineId: 5, shiftId: 1,
  deviceTime: 1789025229, payload: {}
};

beforeEach(() => query.mockClear());

describe('only transitions are written', () => {
  test('no alarm before, no alarm now — nothing happens', async () => {
    await trackAlarm({ ...base, prev: { alarm: false }, isAlarm: false });
    expect(query).not.toHaveBeenCalled();
  });

  test('alarming before, still alarming — nothing happens', async () => {
    // this is the case that matters: ~1 message/second for the whole
    // duration of the alarm, and none of them should write
    await trackAlarm({ ...base, prev: { alarm: true }, isAlarm: true });
    expect(query).not.toHaveBeenCalled();
  });

  test('going into alarm opens a row', async () => {
    await trackAlarm({ ...base, prev: { alarm: false }, isAlarm: true });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO machine_alarms/i);
  });

  test('coming out of alarm closes it', async () => {
    await trackAlarm({ ...base, prev: { alarm: true }, isAlarm: false });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/UPDATE machine_alarms/i);
    expect(query.mock.calls[0][0]).toMatch(/SET ended_at/);
  });

  test('no previous state and no alarm — nothing happens', async () => {
    // after a restart Redis is empty; a machine that is fine must not have
    // a phantom alarm closed for it
    await trackAlarm({ ...base, prev: null, isAlarm: false });
    expect(query).not.toHaveBeenCalled();
  });

  test('no previous state but alarming now — opens a row', async () => {
    await trackAlarm({ ...base, prev: null, isAlarm: true });
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO machine_alarms/i);
  });
});

describe('opening an alarm', () => {
  test('is idempotent against the partial unique index', async () => {
    await openAlarm({ ...base, at: new Date() });
    // the broker replays after a restart and pm2 runs several instances,
    // so this genuinely fires more than once for one real alarm
    expect(query.mock.calls[0][0]).toMatch(/ON CONFLICT DO NOTHING/);
  });

  test('records company, machine and shift', async () => {
    const at = new Date('2026-09-10T02:00:00Z');
    await openAlarm({ ...base, at });
    const p = query.mock.calls[0][1];
    expect(p[0]).toBe(4);   // company
    expect(p[1]).toBe(5);   // machine
    expect(p[2]).toBe(1);   // shift — stored, not derived later
    expect(p[7]).toEqual(at);
  });

  test('falls back to a placeholder type when the device sends none', async () => {
    await openAlarm({ ...base, at: new Date() });
    // an alarm with no name is still an alarm; dropping it would lose the
    // event entirely
    expect(query.mock.calls[0][1][3]).toBe('UNSPECIFIED');
    expect(query.mock.calls[0][1][4]).toBeNull();   // no code
  });

  test('takes code, name and severity when the device does send them', async () => {
    await openAlarm({
      ...base, at: new Date(),
      payload: { alarm_code: 'SV0401', alarm_type: 'Spindle overload',
                 alarm_severity: 'critical', alarm_message: 'Load exceeded' }
    });
    const p = query.mock.calls[0][1];
    expect(p[3]).toBe('Spindle overload');
    expect(p[4]).toBe('SV0401');
    expect(p[5]).toBe('CRITICAL');            // normalised
    expect(p[6]).toBe('Load exceeded');
  });

  test('truncates oversized values rather than letting the insert fail', async () => {
    await openAlarm({
      ...base, at: new Date(),
      payload: { alarm_type: 'x'.repeat(500), alarm_code: 'y'.repeat(500) }
    });
    const p = query.mock.calls[0][1];
    // a device sending junk must not stop every later alarm being recorded
    expect(p[3].length).toBeLessThanOrEqual(100);
    expect(p[4].length).toBeLessThanOrEqual(50);
  });
});

describe('closing alarms', () => {
  test('closes every open row for the machine', async () => {
    await closeAlarms({ machineId: 5, at: new Date() });
    const sql = query.mock.calls[0][0];
    // the telemetry says "this machine is no longer alarming", not "code
    // SV0401 cleared" — leaving others open would strand them forever
    expect(sql).toMatch(/WHERE machine_id = \$1/);
    expect(sql).toMatch(/ended_at IS NULL/);
  });

  test('never reopens or touches an already-closed alarm', async () => {
    await closeAlarms({ machineId: 5, at: new Date() });
    expect(query.mock.calls[0][0]).toMatch(/AND\s+ended_at IS NULL/);
  });
});
