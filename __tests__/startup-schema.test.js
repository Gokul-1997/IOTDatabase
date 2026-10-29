import { jest } from '@jest/globals';

// Mock service boundaries before importing the entry module: this test must
// never read .env, open the operational journal or contact live services.
const query = jest.fn(async sql => {
  if (sql.includes("table_name = 'telemetry_raw'")) return { rows: [{ column_name: 'machine_id' }] };
  if (sql.includes("to_regclass('machine_alarms')")) return { rows: [{ column_name: 'started_at' }] };
  return { rows: ['ingest_checkpoint', 'telemetry_late', 'machine_alarms', 'energy_meter_readings', 'ingest_gaps']
    .map(table_name => ({ table_name })) };
});
const open = jest.fn();
const writerStart = jest.fn();
const shiftStart = jest.fn();
const startMQTT = jest.fn();
const startHealthServer = jest.fn();
const telemetryColumns = ['machine_id'];
jest.unstable_mockModule('../db.js', () => ({ pool: { query } }));
jest.unstable_mockModule('../redis.js', () => ({ redis: {} }));
jest.unstable_mockModule('../buffer.js', () => ({ TELEMETRY_COLUMNS: telemetryColumns, telemetryInsert: jest.fn() }));
jest.unstable_mockModule('../mqtt.js', () => ({ startMQTT, stopMQTT: jest.fn(), initIngest: jest.fn(), ingressLag: {} }));
jest.unstable_mockModule('../health.js', () => ({ startHealthServer, setSources: jest.fn() }));
jest.unstable_mockModule('../src/lib/journal.js', () => ({ createJournal: () => ({ open }) }));
jest.unstable_mockModule('../src/lib/flusher.js', () => ({ createFlusher: () => ({ start: writerStart }) }));
jest.unstable_mockModule('../src/lib/shifts.js', () => ({ createShiftCache: () => ({ start: shiftStart }) }));
const existingSignals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
const { startServer } = await import('../server.js');

afterAll(() => {
  for (const [signal, existing] of existingSignals) {
    for (const listener of process.listeners(signal)) if (!existing.has(listener)) process.removeListener(signal, listener);
  }
});

test('missing migration 048 exits before journal, writer, health server or MQTT admission starts', async () => {
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await startServer({});
    expect(exit).toHaveBeenCalledWith(1);
    const log = JSON.parse(error.mock.calls[0][0]);
    expect(log.msg).toContain('048_alarm_notification_policies.sql');
    expect(log.missing_alarm_columns).toEqual(['notification_continuity_started_at',
      'notification_priority_changed_at', 'severity_observed_at', 'severity_received_at', 'ended_received_at']);
    expect(log.missing_tables).toContain('alarm_notification_events');
    for (const sideEffect of [open, writerStart, shiftStart, startHealthServer, startMQTT]) expect(sideEffect).not.toHaveBeenCalled();
  } finally { exit.mockRestore(); error.mockRestore(); }
});

test('missing migration 062 identifies the new JSON columns and never subscribes before migration', async () => {
  telemetryColumns.push('acc_battery_status', 'cnc_battery_warning');
  query.mockImplementation(async sql => {
    if (sql.includes("table_name = 'telemetry_raw'")) return { rows: [{ column_name: 'machine_id' }] };
    if (sql.includes("to_regclass('machine_alarms')")) return { rows: ['notification_continuity_started_at',
      'notification_priority_changed_at', 'severity_observed_at', 'severity_received_at', 'ended_received_at']
      .map(column_name => ({ column_name })) };
    return { rows: ['ingest_checkpoint', 'telemetry_late', 'machine_alarms', 'energy_meter_readings',
      'ingest_gaps', 'alarm_notification_events'].map(table_name => ({ table_name })) };
  });
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await startServer({});
    expect(exit).toHaveBeenCalledWith(1);
    const log = JSON.parse(error.mock.calls[0][0]);
    expect(log.msg).toContain('migration 062');
    expect(log.missing_columns).toEqual(['acc_battery_status', 'cnc_battery_warning']);
    for (const sideEffect of [open, writerStart, shiftStart, startHealthServer, startMQTT]) expect(sideEffect).not.toHaveBeenCalled();
  } finally {
    telemetryColumns.splice(1);
    exit.mockRestore(); error.mockRestore();
  }
});

test('missing sparse-energy marker/update grant exits before accepting machine messages', async () => {
  query.mockImplementation(async sql => {
    if (sql.includes("table_name = 'telemetry_raw'")) return { rows: [{ column_name: 'machine_id' }] };
    if (sql.includes("to_regclass('machine_alarms')")) return { rows: ['notification_continuity_started_at',
      'notification_priority_changed_at','severity_observed_at','severity_received_at','ended_received_at']
      .map(column_name=>({column_name})) };
    if (sql.includes("to_regclass('energy_meter_readings')")) return { rows: [] };
    return { rows: ['ingest_checkpoint','telemetry_late','machine_alarms','energy_meter_readings',
      'ingest_gaps','alarm_notification_events','energy_observations'].map(table_name=>({table_name})) };
  });
  const exit=jest.spyOn(process,'exit').mockImplementation(()=>{});
  const error=jest.spyOn(console,'error').mockImplementation(()=>{});
  try {
    await startServer({});expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(error.mock.calls[0][0]).msg).toContain('063_sparse_energy_observations.sql');
    for(const effect of [open,writerStart,shiftStart,startHealthServer,startMQTT])expect(effect).not.toHaveBeenCalled();
  } finally {exit.mockRestore();error.mockRestore();}
});
