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

const { trackAlarm, openAlarm, closeAlarms, closeAlarmKeys, alarmKey } = await import('../src/lib/alarm-log.js');

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

/*
 * Several alarms at once — the 192.168.200.3 sample has three.
 */
describe('one row per alarm', () => {
  const threeAlarms = {
    machine_status: 'ALARM',
    pmc_alarm: { exist: 1, count: 3, alarms: [
      { number: 1046, type: 15, axis: 0, message: 'ATC CYCLE INTERRUPTED.SELECT HANDLE PRESS O.T PB' },
      { number: 1037, type: 15, axis: 0, message: 'ARM TO CLAMP-M6 TIMEOUT' },
      { number: 1027, type: 15, axis: 0, message: 'M06 TIMEOUT ALARM' }
    ] }
  };
  const inserts = () => query.mock.calls.filter(c => /INSERT INTO machine_alarms/.test(c[0]));
  const updates = () => query.mock.calls.filter(c => /UPDATE machine_alarms/.test(c[0]));

  test('going into alarm with three active opens three rows, each with its own code', async () => {
    await trackAlarm({ ...base, prev: { alarm: false }, isAlarm: true, payload: threeAlarms });
    expect(inserts().map(c => c[1][4])).toEqual(['EX1046', 'EX1037', 'EX1027']);
    expect(inserts()[2][1][3]).toBe('M06 TIMEOUT ALARM');
  });

  test('the same three still active writes nothing', async () => {
    await trackAlarm({
      ...base, isAlarm: true, payload: threeAlarms,
      prev: { alarm: true, alarm_codes: ['EX1046', 'EX1037', 'EX1027'] }
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('an alarm appearing mid-alarm opens only the new one', async () => {
    await trackAlarm({
      ...base, isAlarm: true, payload: threeAlarms,
      prev: { alarm: true, alarm_codes: ['EX1046', 'EX1037'] }
    });
    expect(inserts().map(c => c[1][4])).toEqual(['EX1027']);
    expect(updates()).toHaveLength(0);
  });

  test('one alarm clearing while others remain closes only that one', async () => {
    const twoLeft = { ...threeAlarms, pmc_alarm: { exist: 1, alarms: threeAlarms.pmc_alarm.alarms.slice(0, 2) } };
    await trackAlarm({
      ...base, isAlarm: true, payload: twoLeft,
      prev: { alarm: true, alarm_codes: ['EX1046', 'EX1037', 'EX1027'] }
    });
    expect(inserts()).toHaveLength(0);
    const [sql, params] = updates()[0];
    expect(sql).toMatch(/COALESCE\(alarm_code, alarm_type\) = ANY\(\$3::text\[\]\)/);
    expect(params).toEqual([5, expect.any(Date), ['EX1027']]);
  });

  test('the machine leaving alarm closes everything, not a list', async () => {
    await trackAlarm({
      ...base, isAlarm: false, payload: {},
      prev: { alarm: true, alarm_codes: ['EX1046', 'EX1037'] }
    });
    expect(updates()).toHaveLength(1);
    expect(updates()[0][0]).not.toMatch(/ANY/);
  });

  test('closing no keys issues no query', async () => {
    await closeAlarmKeys({ machineId: 5, keys: [], at: new Date() });
    expect(query).not.toHaveBeenCalled();
  });

  test('every close binds exactly the parameters it references', async () => {
    await closeAlarmKeys({ machineId: 5, keys: ['EX1027'], at: new Date() });
    const [sql, params] = query.mock.calls[0];
    const highest = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
    expect(params.length).toBe(highest);
  });
});

describe('alarmKey matches the open-alarm unique index', () => {
  test('the code when there is one', () => {
    expect(alarmKey({ alarm_code: 'EX1046', alarm_type: 'M06' })).toBe('EX1046');
  });
  test('the type when there is no code', () => {
    expect(alarmKey({ alarm_code: null, alarm_type: 'Door open' })).toBe('Door open');
  });
  test('UNSPECIFIED when there is neither, as openAlarm stores it', () => {
    expect(alarmKey({})).toBe('UNSPECIFIED');
    expect(alarmKey(null)).toBe('UNSPECIFIED');
  });
  test('truncated exactly as the insert truncates, so the close finds the row', () => {
    expect(alarmKey({ alarm_code: 'c'.repeat(80) })).toHaveLength(50);
    expect(alarmKey({ alarm_type: 't'.repeat(300) })).toHaveLength(100);
  });
});

describe('writes for one machine run in order', () => {
  test('a close issued straight after an open waits for the open', async () => {
    const order = [];
    query.mockImplementation(async sql => {
      if (/INSERT/.test(sql)) await new Promise(r => setTimeout(r, 25));
      order.push(/INSERT/.test(sql) ? 'open' : 'close');
      return { rows: [], rowCount: 1 };
    });

    // fire-and-forget, exactly as the message handler calls it
    const first  = trackAlarm({ ...base, prev: { alarm: false }, isAlarm: true, payload: { stat_alarm: 1 } });
    const second = trackAlarm({ ...base, prev: { alarm: true, alarm_codes: ['UNSPECIFIED'] }, isAlarm: false });
    await Promise.all([first, second]);

    // without the chain the close would land first and the alarm stay open forever
    expect(order).toEqual(['open', 'close']);
    query.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
  });

  test('a failed write does not block the next one for that machine', async () => {
    query.mockImplementationOnce(async () => { throw new Error('connection reset'); });
    await expect(trackAlarm({ ...base, prev: { alarm: false }, isAlarm: true })).rejects.toThrow('connection reset');
    await trackAlarm({ ...base, prev: { alarm: true, alarm_codes: ['UNSPECIFIED'] }, isAlarm: false });
    expect(query.mock.calls.at(-1)[0]).toMatch(/UPDATE machine_alarms/);
  });
});
