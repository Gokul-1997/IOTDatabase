/*
 * Machine condition signals, tested against the embedded team's own sample.
 *
 * The payload below is the one the FOCAS collector actually produced for a
 * machine at 192.168.200.2 (program text trimmed). Testing against it rather
 * than an idealised shape is the point: the real one has empty maps, all-null
 * fans, and a position block with control characters for axis names.
 */

import {
  num, splitAxes, fanStatus, isAlarming, alarmIdentity,
  conditionSignals, controllerIdentity, isDisconnected, focasResult,
  canonicalPayload, temperature, activeAlarms
} from '../src/lib/condition-signals.js';

const sample = {
  machine_ip: '192.168.200.2',
  connection: true,
  machine_status: 'STOP',
  status: 0,
  mode: 'AUTO',
  feed_rate: 0,
  spindle_speed: 70,
  spindle_load: 0,
  parts_count: 33,
  total_run_time: 289836,
  total_cutting_time: 23153228,
  run_time: 262,
  program_number: 1083,
  current_sequence_number: 100,
  job_name: 'CD U  VOLUTE',
  position: {
    '': { absolute: 140.02, machine: -2.60571048e-32, relative: 5767169 },
    H:        { absolute: 0.4, machine: 262198 }
  },
  servo_axis_load_percent: { X: 5, Y: 6, Z: 6 },
  cnc_battery: null,
  apc_battery: null,
  servo_motor_temperature: { X: 27, Y: 26, Z: 32 },
  spindle_motor_temperature: 36,
  encoder_temperatures: {},
  spindle_insulation_resistance: null,
  servo_motor_insulation_resistance: null,
  fans: {
    internal_fan1_spindle_motor: null,
    internal_fan1_servo_amplifier: null,
    radiator_fan1_servo_spindle_amplifier: null,
    radiator_fan2_servo_spindle_amplifier: null
  },
  servo_pulse_diagnostic: { X: 32, Y: 31, Z: 36 },
  cnc_type: '0',
  machine_type: 'M',
  series: 'D4G3',
  version: '22.0',
  controlled_axes: '03',
  pmc_alarm: { exist: 0, count: 0, alarms: [], return_codes: { all: 0 } },
  time: 1788202023,
  stat_run: 0, stat_motion: 0, stat_alarm: 0, stat_emergency: 0, stat_aut: 1
};

describe('the real sample payload', () => {
  const s = conditionSignals(sample);

  test('stores the signals this controller supplies', () => {
    expect(s.spindle_speed).toBe(70);
    expect(s.spindle_motor_temp).toBe(36);
    expect([s.servo_load_x, s.servo_load_y, s.servo_load_z]).toEqual([5, 6, 6]);
    expect([s.servo_temp_x, s.servo_temp_y, s.servo_temp_z]).toEqual([27, 26, 32]);
    expect([s.servo_pulse_x, s.servo_pulse_y, s.servo_pulse_z]).toEqual([32, 31, 36]);
    expect(s.sequence_number).toBe(100);
  });

  test('what the controller returns as null or empty stays null, never zero', () => {
    expect(s.cnc_battery_voltage).toBeNull();
    expect(s.apc_battery_voltage).toBeNull();
    expect(s.spindle_insulation_res).toBeNull();
    expect([s.encoder_temp_x, s.encoder_temp_y, s.encoder_temp_z]).toEqual([null, null, null]);
    expect([s.servo_insulation_res_x, s.servo_insulation_res_y, s.servo_insulation_res_z])
      .toEqual([null, null, null]);
  });

  test('ten null fans are stored as nothing, not as an object of nulls', () => {
    expect(s.fan_status).toBeNull();
  });

  test('a 3-axis machine has no extra axes', () => {
    expect(s.extra_axes).toBeNull();
  });

  test('is not alarming: STOP with every alarm flag at zero', () => {
    expect(isAlarming(sample)).toBe(false);
  });

  test('the controller identity is read for the machines table', () => {
    expect(controllerIdentity(sample)).toEqual({
      controller_ip: '192.168.200.2', cnc_series: 'D4G3', cnc_version: '22.0',
      cnc_type: '0', cnc_machine_type: 'M', controlled_axes: 3
    });
  });

  test('the corrupt position block is not stored anywhere', () => {
    // its axis keys are control characters and its values are
    // uninitialised memory; nothing in the output may carry them
    expect(JSON.stringify(s)).not.toMatch(/5767169|e-32/);
  });
});

describe('partial axis data', () => {
  // "for some machines temperature is available for 1 servo"
  test('only X reporting leaves Y and Z null, not zero', () => {
    const s = conditionSignals({ servo_motor_temperature: { X: 41 } });
    expect(s.servo_temp_x).toBe(41);
    expect(s.servo_temp_y).toBeNull();
    expect(s.servo_temp_z).toBeNull();
  });

  test('an axis sent as null is null, and its neighbours are unaffected', () => {
    const s = conditionSignals({ servo_motor_temperature: { X: null, Y: 30, Z: null } });
    expect([s.servo_temp_x, s.servo_temp_y, s.servo_temp_z]).toEqual([null, 30, null]);
  });

  test('a genuine 0 is kept as 0', () => {
    // 0 % load on an idle axis is a reading, not a missing sensor
    expect(conditionSignals({ servo_axis_load_percent: { X: 0 } }).servo_load_x).toBe(0);
  });

  test('one signal missing entirely does not disturb the others', () => {
    const s = conditionSignals({ servo_axis_load_percent: { X: 5, Y: 6, Z: 7 } });
    expect(s.servo_load_z).toBe(7);
    expect(s.servo_temp_x).toBeNull();
  });
});

describe('splitAxes', () => {
  test('axis keys are case- and padding-insensitive', () => {
    expect(splitAxes({ x: 1, ' Y ': 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3, extra: null });
  });

  test('axes past Z are kept, not dropped', () => {
    expect(splitAxes({ X: 1, A: 9, B: 8 }).extra).toEqual({ A: 9, B: 8 });
  });

  test('numbers sent as strings are read; non-numbers become null, never NaN', () => {
    const r = splitAxes({ X: '12,5', Y: 'n/a', Z: '' });
    expect(r.x).toBe(12.5);
    expect(r.y).toBeNull();
    expect(r.z).toBeNull();
  });

  test.each([null, undefined, [], 'X:5', 42])('a non-object (%p) yields all nulls', bad => {
    expect(splitAxes(bad)).toEqual({ x: null, y: null, z: null, extra: null });
  });
});

describe('extra axes on a 5-axis machine', () => {
  test('are grouped by axis across every signal', () => {
    const s = conditionSignals({
      servo_axis_load_percent: { X: 1, A: 11, B: 12 },
      servo_motor_temperature: { X: 20, A: 31 }
    });
    expect(s.extra_axes).toEqual({ A: { servo_load: 11, servo_temp: 31 }, B: { servo_load: 12 } });
  });
});

describe('fanStatus', () => {
  test('keeps only fans that report', () => {
    expect(fanStatus({ a: null, b: 1450, c: undefined })).toEqual({ b: 1450 });
  });

  test('keeps a word as a word — "OK" coerced to a number would become null', () => {
    expect(fanStatus({ radiator_fan1: 'OK', radiator_fan2: 'NG' }))
      .toEqual({ radiator_fan1: 'OK', radiator_fan2: 'NG' });
  });

  test.each([null, undefined, [], 'fans'])('non-object %p is null', bad => {
    expect(fanStatus(bad)).toBeNull();
  });
});

describe('isAlarming — the fix for zero alarms in twelve million messages', () => {
  test('stat_alarm set means alarming even while the string says STOP', () => {
    expect(isAlarming({ ...sample, stat_alarm: 1 })).toBe(true);
  });

  test('emergency stop means alarming', () => {
    expect(isAlarming({ ...sample, stat_emergency: 1 })).toBe(true);
  });

  test('a PMC alarm means alarming, by exist, count or a non-empty list', () => {
    expect(isAlarming({ ...sample, pmc_alarm: { exist: 1 } })).toBe(true);
    expect(isAlarming({ ...sample, pmc_alarm: { count: 2 } })).toBe(true);
    expect(isAlarming({ ...sample, pmc_alarm: { alarms: ['1000'] } })).toBe(true);
  });

  test('the original ALARM string still works for devices that send it', () => {
    expect(isAlarming({ machine_status: 'alarm' })).toBe(true);
  });

  test('flags sent as the string "0" are not alarms', () => {
    expect(isAlarming({ machine_status: 'RUN', stat_alarm: '0', stat_emergency: '0' })).toBe(false);
  });

  test.each([null, undefined, 'ALARM'])('a non-object payload (%p) is not alarming', bad => {
    expect(isAlarming(bad)).toBe(false);
  });
});

describe('alarmIdentity', () => {
  test('explicit fields win', () => {
    expect(alarmIdentity({
      alarm_code: 'SV0401', alarm_type: 'Spindle overload', alarm_severity: 'CRITICAL',
      pmc_alarm: { alarms: [{ code: 'IGNORED' }] }
    })).toMatchObject({ alarm_code: 'SV0401', alarm_type: 'Spindle overload', alarm_severity: 'CRITICAL' });
  });

  test('otherwise the first PMC alarm supplies code and message', () => {
    expect(alarmIdentity({ pmc_alarm: { alarms: [{ code: 1001, message: 'Door open' }] } }))
      .toMatchObject({ alarm_code: '1001', alarm_message: 'Door open' });
  });

  test('a bare PMC code is read as the code, not "[object Object]"', () => {
    expect(alarmIdentity({ pmc_alarm: { alarms: ['EX1002'] } }).alarm_code).toBe('EX1002');
  });

  test('an emergency stop is CRITICAL whatever the payload claims', () => {
    expect(alarmIdentity({ stat_emergency: 1, alarm_severity: 'NORMAL' }))
      .toMatchObject({ alarm_type: 'EMERGENCY STOP', alarm_severity: 'CRITICAL' });
  });

  test('nothing to go on gives nulls, and the caller falls back to UNSPECIFIED', () => {
    expect(alarmIdentity({ stat_alarm: 1 })).toEqual({
      alarm_code: null, alarm_type: null, alarm_message: null, alarm_severity: null
    });
  });
});

describe('controllerIdentity', () => {
  test('a device that sends no identity triggers no write', () => {
    expect(controllerIdentity({ machine_status: 'RUN', parts_count: 1 })).toBeNull();
  });

  test('over-long values are cut to the column width', () => {
    expect(controllerIdentity({ series: 'S'.repeat(100) }).cnc_series).toHaveLength(32);
  });
});

test('num never returns NaN', () => {
  for (const v of [NaN, Infinity, 'abc', {}, [], true]) {
    const r = num(v);
    expect(r === null || Number.isFinite(r)).toBe(true);
  }
});

describe('isDisconnected', () => {
  test('the sample, connection true, is ingested', () => {
    expect(isDisconnected(sample)).toBe(false);
  });

  test.each([false, 0, 'false', '0'])('connection %p means the controller is unreachable', c => {
    expect(isDisconnected({ ...sample, connection: c })).toBe(true);
  });

  test('a device that never sends the field is not treated as disconnected', () => {
    const { connection, ...older } = sample;
    expect(isDisconnected(older)).toBe(false);
    expect(isDisconnected({ ...older, connection: null })).toBe(false);
  });
});

describe('focasResult', () => {
  const codes = { cnc_diagnoss_308_1: 0, cnc_diagnoss_308_4: 4, cnc_rdalmmsg: { all: 0 } };

  test('keeps the return codes as sent', () => {
    expect(focasResult({ focas_result: codes })).toEqual(codes);
  });

  test.each([null, undefined, [], 'ok', 7])('a non-object (%p) is null', bad => {
    expect(focasResult({ focas_result: bad })).toBeNull();
  });

  test('an oversized object is refused rather than written to a machine row', () => {
    const huge = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`call_${i}`, i]));
    expect(focasResult({ focas_result: huge })).toBeNull();
  });
});

/*
 * The second sample: 192.168.200.3, a 4-axis machine caught alarming.
 * Exactly as the embedded team sent it, apart from trimming.
 */
const sample2 = {
  machine_ip: '192.168.200.3', connection: true, machine_status: 'ALARM', status: 4, mode: 'AUTO',
  feed_rate: 0, spindle_speed: 0, spindle_load: 0, parts_count: 3, part_change: 0,
  total_run_time: 507312, total_cutting_time: 79955684, run_time: 1254,
  program_number: 9001, program_path: '//CNC_MEM/MTB1/O9001', job_name: '',
  position: {
    X: { absolute: -687.485, machine: 0, relative: -526.517, distance: 0 },
    A: { absolute: 0, machine: 270.352, relative: 333.012, distance: 0 }
  },
  servo_axis_load_percent: { X: 10, Y: 3, Z: 39, A: 0 },
  servo_motor_temperature: { X: 0, Y: 0, Z: 45, A: 0 },
  Encoder_temperature: { X: 34, Y: 31, Z: 46, A: 31 },
  pmc_alarm: {
    exist: 1, count: 3,
    alarms: [
      { number: 1046, type: 15, axis: 0, message: 'ATC CYCLE INTERRUPTED.SELECT HANDLE PRESS O.T PB' },
      { number: 1037, type: 15, axis: 0, message: 'ARM TO CLAMP-M6 TIMEOUT' },
      { number: 1027, type: 15, axis: 0, message: 'M06 TIMEOUT ALARM' }
    ]
  },
  time: 1789404554,
  spindle_motor_temperature: 40
};

describe('second sample — 192.168.200.3, 4-axis, alarming', () => {
  const s = conditionSignals(sample2);

  test('Encoder_temperature, capital E and singular, is read — it used to be dropped', () => {
    expect([s.encoder_temp_x, s.encoder_temp_y, s.encoder_temp_z]).toEqual([34, 31, 46]);
  });

  test('servo temperatures sent as 0 are no reading; the real one is kept', () => {
    expect(s.servo_temp_x).toBeNull();
    expect(s.servo_temp_y).toBeNull();
    expect(s.servo_temp_z).toBe(45);
  });

  test('servo load keeps its zeros, because 0 % load is a real reading', () => {
    expect([s.servo_load_x, s.servo_load_y, s.servo_load_z]).toEqual([10, 3, 39]);
  });

  test('the A axis is kept, and its 0 °C temperature is not', () => {
    expect(s.extra_axes).toEqual({ A: { servo_load: 0, encoder_temp: 31 } });
  });

  test('spindle motor temperature is read', () => {
    expect(s.spindle_motor_temp).toBe(40);
  });

  test('is alarming', () => {
    expect(isAlarming(sample2)).toBe(true);
  });

  test('all three PMC alarms are reported, not only the first', () => {
    const alarms = activeAlarms(sample2);
    expect(alarms.map(a => a.alarm_code)).toEqual(['EX1046', 'EX1037', 'EX1027']);
    expect(alarms[2]).toEqual({
      alarm_code: 'EX1027', alarm_type: 'M06 TIMEOUT ALARM',
      alarm_message: 'M06 TIMEOUT ALARM', alarm_severity: null
    });
  });

  test('the numeric FOCAS type is never stored as the alarm name', () => {
    // before: alarm_type "15", alarm_code null
    for (const a of activeAlarms(sample2)) {
      expect(a.alarm_type).not.toBe('15');
      expect(a.alarm_code).not.toBeNull();
    }
  });

  test('only the IP is identity here; the rest stays null rather than guessed', () => {
    expect(controllerIdentity(sample2)).toEqual({
      controller_ip: '192.168.200.3', cnc_series: null, cnc_version: null,
      cnc_type: null, cnc_machine_type: null, controlled_axes: null
    });
  });
});

describe('canonicalPayload — key spelling drift between collectors', () => {
  test('top-level keys are lower-cased', () => {
    expect(canonicalPayload({ Encoder_Temperature: 1, TIME: 2 })).toEqual({ encoder_temperature: 1, time: 2 });
  });

  test('the exactly lower-case key wins, in either order', () => {
    expect(canonicalPayload({ Energy: 1, energy: 2 }).energy).toBe(2);
    expect(canonicalPayload({ energy: 2, Energy: 1 }).energy).toBe(2);
  });

  test('nested keys are left as sent', () => {
    expect(canonicalPayload({ fans: { Radiator_Fan1: 'OK' } }).fans).toEqual({ Radiator_Fan1: 'OK' });
  });

  test.each([null, undefined, 'x', 5, []])('a non-object (%p) passes through untouched', v => {
    expect(canonicalPayload(v)).toEqual(v);
  });

  test('every reader is case-insensitive at the top level', () => {
    expect(isAlarming({ Machine_Status: 'ALARM' })).toBe(true);
    expect(isDisconnected({ Connection: false })).toBe(true);
    expect(conditionSignals({ Spindle_Speed: 1200 }).spindle_speed).toBe(1200);
    expect(controllerIdentity({ Machine_IP: '10.0.0.1' }).controller_ip).toBe('10.0.0.1');
  });
});

describe('temperature — 0 means no sensor', () => {
  test.each([[0, null], [-5, null], ['0', null], [null, null], [36.5, 36.5], ['41', 41]])
    ('%p reads as %p', (input, expected) => {
      expect(temperature(input)).toBe(expected);
    });

  test('spindle motor temperature of 0 is no reading', () => {
    expect(conditionSignals({ spindle_motor_temperature: 0 }).spindle_motor_temp).toBeNull();
  });

  test('insulation resistance and battery keep 0 — a short and a dead battery are real', () => {
    const s = conditionSignals({ servo_motor_insulation_resistance: { X: 0 }, cnc_battery: 0 });
    expect(s.servo_insulation_res_x).toBe(0);
    expect(s.cnc_battery_voltage).toBe(0);
  });
});

describe('PMC alarm entries', () => {
  const on = alarms => ({ pmc_alarm: { exist: 1, alarms } });

  test('a FOCAS servo alarm becomes SV0401 and is critical', () => {
    expect(activeAlarms(on([{ number: 401, type: 6, axis: 2, message: 'IMPROPER V_READY OFF' }]))[0])
      .toEqual({
        alarm_code: 'SV0401', alarm_type: 'IMPROPER V_READY OFF',
        alarm_message: 'IMPROPER V_READY OFF (axis 2)', alarm_severity: 'CRITICAL'
      });
  });

  test('spindle and overheat alarms are critical; external alarms are not', () => {
    expect(activeAlarms(on([{ number: 1, type: 9 }]))[0].alarm_severity).toBe('CRITICAL');
    expect(activeAlarms(on([{ number: 1, type: 5 }]))[0].alarm_severity).toBe('CRITICAL');
    expect(activeAlarms(on([{ number: 1, type: 15 }]))[0].alarm_severity).toBeNull();
  });

  test('a severity sent on the entry overrides the type default', () => {
    expect(activeAlarms(on([{ number: 401, type: 6, severity: 'MEDIUM' }]))[0].alarm_severity).toBe('MEDIUM');
  });

  test('type sent as a digit string or a two-letter prefix is understood', () => {
    expect(activeAlarms(on([{ number: 7, type: '15' }]))[0].alarm_code).toBe('EX0007');
    expect(activeAlarms(on([{ number: 7, type: 'sv' }]))[0].alarm_code).toBe('SV0007');
  });

  test('an unknown type keeps the bare number rather than guessing a prefix', () => {
    expect(activeAlarms(on([{ number: 55, type: 99 }]))[0].alarm_code).toBe('55');
  });

  test('the same alarm listed twice is reported once', () => {
    expect(activeAlarms(on([{ number: 1, type: 15 }, { number: 1, type: 15 }]))).toHaveLength(1);
  });

  test('empty and nameless entries are skipped, not stored as "[object Object]"', () => {
    const alarms = activeAlarms(on([null, {}, { axis: 1 }, { number: 3, type: 15 }]));
    expect(alarms.map(a => a.alarm_code)).toEqual(['EX0003']);
  });

  test('an emergency stop with no alarm list is one CRITICAL alarm', () => {
    expect(activeAlarms({ stat_emergency: 1 })).toEqual([{
      alarm_code: null, alarm_type: 'EMERGENCY STOP', alarm_message: null, alarm_severity: 'CRITICAL'
    }]);
  });

  test('a machine that is not alarming has no active alarms, whatever lingers in the payload', () => {
    expect(activeAlarms({ machine_status: 'RUN', alarm_code: 'SV0401' })).toEqual([]);
  });
});
