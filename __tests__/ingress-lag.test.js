/*
 * How late readings arrive, per machine: transitions and periodic reminders,
 * never one line per reading; recovery needs a new reading from that machine.
 */
import { createLagTracker, lagMetricLines } from '../src/lib/ingress-lag.js';

function setup() {
  let t = Date.parse('2026-10-07T00:55:00+05:30');
  const lines = [];
  const lag = createLagTracker({ log: (level, msg, meta) => lines.push({ level, msg, ...meta }), now: () => t });
  return { lag, lines, advance: ms => { t += ms; } };
}

test('readings on time log nothing; /metrics shows each machine\'s latest lag', () => {
  const { lag, lines, advance } = setup();
  for (let i = 0; i < 60; i++) {
    lag.observe(15, 2_400);
    lag.observe(28, -900);        // a gateway clock a little ahead of the server's
    advance(3_000);
  }
  expect(lines).toEqual([]);
  expect(lag.snapshot()).toEqual({ worst: { machine_id: 15, lag_ms: 2_400 }, machines: { 15: 2_400, 28: -900 } });
});

test('a gateway 14.5 s behind for two minutes: one warning, naming each late machine and its worst lag', () => {
  const { lag, lines, advance } = setup();
  // as on 7 Oct 2026 00:55 IST: ten Fanuc machines every 3 s, ~14.5 s late; a Mitsubishi on time
  for (let i = 0; i < 40; i++) {
    for (let id = 15; id <= 24; id++) lag.observe(id, 14_500 + id);
    lag.observe(28, -400);
    advance(3_000);
  }
  expect(lines).toHaveLength(1);                 // not 400 lines
  const [line] = lines;
  expect(line).toMatchObject({ level: 'warn', msg: 'readings arriving late', worst_ms: 14_524, threshold_ms: 10_000, limit_ms: 300_000, window_s: 60 });
  expect(Object.keys(line.machines).map(Number)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  expect(line.machines[17]).toBe(14_517);
  expect(line.late_readings).toBeGreaterThanOrEqual(200);
  expect(line.machines[28]).toBeUndefined();     // the machine on time is not named
});

test('a late machine going silent is not reported recovered when other machines are on time', () => {
  const { lag, lines, advance } = setup();
  lag.observe(23, 61_762_437);
  advance(61_000);
  lag.observe(28, 1_000);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 'error', machines: { 23: 61_762_437 } });
  for (let i = 0; i < 4; i++) {
    advance(61_000);
    lag.observe(28, 1_000);
  }
  expect(lines.filter(line => line.msg === 'readings on time again')).toEqual([]);
  expect(lag.snapshot().machines).toEqual({ 23: 61_762_437, 28: 1_000 });
  lag.observe(23, 1_000);
  advance(61_000);
  lag.observe(28, 1_000);
  expect(lines[1]).toMatchObject({ msg: 'readings on time again', machines: [23] });
});

test('only the machine with a new on-time reading recovers while another stays late', () => {
  const { lag, lines, advance } = setup();
  lag.observe(15, 20_000);
  lag.observe(16, 25_000);
  advance(61_000);
  lag.observe(16, 25_000);
  lag.observe(15, 1_000);
  advance(61_000);
  lag.observe(16, 25_000);
  expect(lines.map(line => [line.msg, line.machines])).toEqual([
    ['readings arriving late', { 15: 20_000, 16: 25_000 }],
    ['readings on time again', [15]]
  ]);
  advance(61_000);
  lag.observe(16, 1_000);
  expect(lines[2]).toMatchObject({ msg: 'readings on time again', machines: [16] });
  advance(61_000);
  lag.observe(15, 1_000);
  expect(lines).toHaveLength(3);
});

test('a new late reading cancels pending recovery before the summary', () => {
  const { lag, lines, advance } = setup();
  lag.observe(15, 20_000);
  advance(61_000);
  lag.observe(15, 20_000);
  lag.observe(15, 1_000);
  lag.observe(15, 20_000);
  advance(61_000);
  lag.observe(28, 1_000);
  expect(lines).toHaveLength(1);
  lag.observe(15, 1_000);
  advance(61_000);
  lag.observe(28, 1_000);
  expect(lines[1]).toMatchObject({ msg: 'readings on time again', machines: [15] });
});

test('a silent severe machine does not suppress another machine escalating', () => {
  const { lag, lines, advance } = setup();
  lag.observe(23, 61_762_437);
  lag.observe(28, 15_000);
  advance(61_000);
  lag.observe(28, 15_000);
  advance(61_000);
  lag.observe(28, 70_000);
  expect(lines.map(line => [line.msg, line.level, line.machines])).toEqual([
    ['readings arriving late', 'error', { 23: 61_762_437, 28: 15_000 }],
    ['readings arriving late', 'warn', { 28: 70_000 }]
  ]);
});

test('expiring a silent machine from metrics does not announce recovery', () => {
  const { lag, lines, advance } = setup();
  lag.observe(15, 20_000);
  advance(61_000);
  lag.observe(28, 1_000);
  advance(10 * 60_000);
  lag.observe(28, 1_000);
  expect(lag.snapshot().machines).toEqual({ 28: 1_000 });
  expect(lines.map(line => line.msg)).toEqual(['readings arriving late']);
  // A new late episode after expiry gets a fresh warning.
  advance(61_000);
  lag.observe(15, 20_000);
  expect(lines[1]).toMatchObject({ msg: 'readings arriving late', machines: { 15: 20_000 } });
});

test('back under the threshold is said once; a machine falling behind later gets its own line', () => {
  const { lag, lines, advance } = setup();
  lag.observe(15, 20_000);
  advance(61_000);
  lag.observe(15, 1_000);                         // closes the first minute: one line
  advance(61_000);
  lag.observe(15, 1_000);                         // a minute with nobody late: "on time again"
  advance(61_000);
  lag.observe(15, 1_000);                         // and another: nothing more
  advance(61_000);
  lag.observe(16, 45_000);                        // late, and the minute is up: its own line
  expect(lines.map(l => [l.msg, l.machines])).toEqual([
    ['readings arriving late', { 15: 20_000 }],
    ['readings on time again', [15]],
    ['readings arriving late', { 16: 45_000 }]
  ]);
  expect(lines[1].level).toBe('info');
});

test('a steady lag is logged when it starts and every 15 minutes, not every minute', () => {
  const { lag, lines, advance } = setup();
  for (let i = 0; i < 20 * 20; i++) {             // 20 minutes, ten machines every 3 s, 15 s late
    for (let id = 15; id <= 24; id++) lag.observe(id, 15_000);
    advance(3_000);
  }
  expect(lines).toHaveLength(2);
  expect(lines.every(l => l.level === 'warn' && Object.keys(l.machines).length === 10)).toBe(true);
});

test('another machine falling behind, or the lag getting worse, is logged at once; from 2 minutes it is an error', () => {
  const { lag, lines, advance } = setup();
  // two minutes per phase, one reading every 3 s from each machine named
  const phase = (ms, ids) => { for (let i = 0; i < 40; i++) { ids.forEach(id => lag.observe(id, ms)); advance(3_000); } };
  phase(15_000, [15]);                             // starts: a line; its second minute: nothing
  phase(15_000, [15, 16]);                         // machine 16 falls behind: a line
  phase(70_000, [15, 16]);                         // past 60 s: a line
  phase(130_000, [15, 16]);                        // past 2 minutes: a line, an error
  lag.observe(15, 130_000);                        // closes the last minute
  expect(lines.map(l => [l.level, l.worst_ms, Object.keys(l.machines).length])).toEqual([
    ['warn', 15_000, 1], ['warn', 15_000, 2], ['warn', 70_000, 2], ['error', 130_000, 2]
  ]);
});

test('a machine not heard from for 10 minutes drops off /metrics', () => {
  const { lag, advance } = setup();
  lag.observe(15, 14_000);
  advance(5 * 60_000);
  lag.observe(16, 3_000);
  advance(6 * 60_000);
  expect(lag.snapshot().machines).toEqual({ 16: 3_000 });
});

test('/metrics lines, in seconds', () => {
  expect(lagMetricLines({ worst: { machine_id: 17, lag_ms: 16_628 }, machines: { 15: 14_504, 17: 16_628, 28: -900 } })).toEqual([
    'pms_ingress_lag_max_seconds 16.6',
    'pms_ingress_lag_seconds{machine_id="15"} 14.5',
    'pms_ingress_lag_seconds{machine_id="17"} 16.6',
    'pms_ingress_lag_seconds{machine_id="28"} -0.9'
  ]);
  expect(lagMetricLines({ worst: null, machines: {} })).toEqual([]);
});
