import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { installAdmission, parseTelemetry, fingerprint } from '../src/lib/admission.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
import { createJournal } from '../src/lib/journal.js';

const now = Date.now();
const time = Math.floor(now / 1000);
const packet = (data = {}, topic = 'machines/device-secret/telemetry') => ({ topic, qos: 1,
  payload: Buffer.from(JSON.stringify({ time, machine_status: 'RUN', parts_count: 100, ...data })) });
const tick = () => new Promise(resolve => setImmediate(resolve));
const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture({ redis, journalOverride, previous } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnc-admission-')); temporary.push(dir);
  const journal = createJournal({ dir, fsyncMs: 100 }); journal.open();
  const shifts = { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] };
  const count = jest.fn();
  const processor = createMessageProcessor({ journal: journalOverride || journal, shifts, redis, count,
    hydrate: async () => previous || null,
    lookupMachine: async () => ({ id: 7, company_id: 4, machine_serial_no: 'CNC-7' }) });
  return { dir, journal, processor, count };
}

test.each([Infinity, 'Infinity', NaN, 1_700_000_000_000, time + 61, -1, 42, time + 0.5])('invalid timestamp %s cannot reach ingestion', value => {
  expect(parseTelemetry(packet({ time: value }), now)).toBeNull();
});
test('invalid topics, arrays, oversize and deeply nested payloads are rejected before mutation', () => {
  expect(parseTelemetry(packet({}, 'machines/x/commands'), now)).toBeNull();
  expect(parseTelemetry({ topic: packet().topic, payload: Buffer.from('[]') }, now)).toBeNull();
  expect(parseTelemetry(packet({ data: 'x'.repeat(65536) }), now)).toBeNull();
  let nested = {}; for (let i = 0; i < 20; i++) nested = { nested };
  expect(parseTelemetry(packet({ nested }), now)).toBeNull();
});
test('fingerprint keeps all signals and ignores object key order', () => {
  expect(fingerprint({ a: 1, b: { c: 2 } })).toBe(fingerprint({ b: { c: 2 }, a: 1 }));
  expect(fingerprint({ time, parts_count: 2, alarm: true })).not.toBe(fingerprint({ time, parts_count: 2, alarm: false }));
});
test('MQTT callback waits for durable admission; failure destroys transport without ACK', async () => {
  let accept;
  const client = { stream: { destroy: jest.fn() } };
  const callback = jest.fn();
  installAdmission(client, { process: () => new Promise(resolve => { accept = resolve; }) });
  client.handleMessage(packet(), callback); await tick();
  expect(callback).not.toHaveBeenCalled();
  accept(); await tick(); expect(callback).toHaveBeenCalledTimes(1);
  installAdmission(client, { process: async () => { throw new Error('disk full'); } });
  callback.mockClear(); client.handleMessage(packet(), callback); await tick();
  expect(callback).not.toHaveBeenCalled(); expect(client.stream.destroy).toHaveBeenCalledTimes(1);
});
test('admission bounds work to one callback even if miscalled concurrently', async () => {
  const client = { stream: { destroy: jest.fn() } };
  const intake = installAdmission(client, { process: () => new Promise(() => {}) });
  client.handleMessage(packet(), jest.fn()); client.handleMessage(packet(), jest.fn());
  expect(intake.stats().active).toBe(1); expect(client.stream.destroy).toHaveBeenCalledTimes(1);
});
test('journal refusal cannot advance state/dedup/live; replay is accepted after space recovers', async () => {
  let full = true;
  const records = [];
  const fake = { append: record => { if (full) return 0; records.push(record); return records.length; }, syncThrough: async () => {} };
  const { journal, processor } = fixture({ journalOverride: fake });
  await expect(processor.handleMessage('key', { time, parts_count: 100, machine_status: 'RUN' }, now)).rejects.toThrow('refused');
  expect(processor.state(7)).toBeNull();
  full = false;
  await processor.handleMessage('key', { time, parts_count: 100, machine_status: 'RUN' }, now);
  expect(records).toHaveLength(1); expect(processor.state(7).parts_count).toBe(100);
  journal.close();
});
test('Redis outage retains production continuity and same-second signal changes', async () => {
  const { journal, processor } = fixture({ redis: { isReady: false } });
  await processor.handleMessage('key', { time: time - 1, parts_count: 100, machine_status: 'RUN' }, now);
  await processor.handleMessage('key', { time, parts_count: 101, machine_status: 'RUN' }, now);
  await processor.handleMessage('key', { time, parts_count: 101, machine_status: 'STOP', stat_alarm: 1 }, now);
  await processor.handleMessage('key', { time, parts_count: 101, machine_status: 'STOP', stat_alarm: 1 }, now);
  const records = journal.read(100).records;
  expect(records).toHaveLength(3);
  expect(records[1].h.reduce((sum, h) => sum + h.produced, 0)).toBe(1);
  expect(records[2].a.opens).toHaveLength(1);
  expect(processor.state(7).alarm).toBe(true);
  journal.close();
});
test('restart recovers accepted counter/ordering from journal and later state snapshot', async () => {
  const { dir, journal, processor } = fixture();
  await processor.handleMessage('key', { time: time - 1, parts_count: 100, machine_status: 'RUN' }, now);
  journal.close();
  const recovered = createJournal({ dir, segmentMaxRecords: 1 }); recovered.open();
  const next = createMessageProcessor({ journal: recovered, hydrate: async () => { throw new Error('DB must not be needed'); },
    lookupMachine: async () => ({ id: 7, company_id: 4 }),
    shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] } });
  await next.handleMessage('key', { time, parts_count: 101, machine_status: 'RUN' }, now);
  const read = recovered.read(100); recovered.ack(read.position, read.records.length); recovered.close();
  const after = createJournal({ dir }); after.open();
  expect(after.latestStates().get(7).parts_count).toBe(101);
  after.close();
});
test('a same-second counter advance keeps production once without adding runtime', async () => {
  const { journal, processor } = fixture();
  await processor.handleMessage('key', { time, parts_count: 100, machine_status: 'RUN' }, now);
  await processor.handleMessage('key', { time, parts_count: 101, machine_status: 'RUN' }, now);
  await processor.handleMessage('key', { time, parts_count: 101, machine_status: 'RUN' }, now);
  const records = journal.read(100).records;
  expect(records).toHaveLength(2);
  expect(records[1].h).toEqual([expect.objectContaining({ produced: 1, run: 0, idle: 0, manual: 0, energy: 0 })]);
  journal.close();
});
test('stale broker replay stays in late audit and cannot publish current state', async () => {
  const { journal, processor } = fixture();
  await processor.handleMessage('key', { time: time - 1000, parts_count: 100 }, now);
  expect(journal.read(100).records[0].l.reason).toBe('stale');
  expect(processor.state(7)).toBeUndefined(); journal.close();
});
test('corrupt complete lines and oversized lines cannot strand a journal cursor', () => {
  const { dir, journal } = fixture(); journal.close();
  const file = path.join(dir, 'seg-00000000000000001.ndjson');
  fs.writeFileSync(file, '{bad-json}\n' + 'x'.repeat(4 * 1024 * 1024 + 20) + '\n' + JSON.stringify({ s: 2, r: { machine_id: 7 } }) + '\n');
  const recovered = createJournal({ dir }); recovered.open();
  const batch = recovered.read(100);
  expect(batch.records).toHaveLength(1);
  expect(batch.records[0].s).toBe(2);
  expect(fs.readFileSync(path.join(dir, 'quarantine.ndjson'), 'utf8')).toContain('oversized_record');
  recovered.ack(batch.position, batch.records.length); recovered.close();
});

test('fsync failure stops admission and database writes before state changes', async () => {
  const { journal, processor } = fixture();
  const sync = jest.spyOn(fs, 'fsync').mockImplementation((_fd, callback) => callback(new Error('disk I/O failed')));
  try {
    await expect(processor.handleMessage('key', { time, parts_count: 100 }, now)).rejects.toThrow('disk I/O failed');
    expect(processor.state(7)).toBeNull(); expect(journal.stats().failed).toBe(true);
    const { createFlusher } = await import('../src/lib/flusher.js');
    const connect = jest.fn();
    const flusher = createFlusher({ pool: { connect }, journal, collectorId: 'test', telemetryInsert: () => ({}) });
    await expect(flusher.pass()).rejects.toThrow('disk I/O failed');
    expect(connect).not.toHaveBeenCalled();
  } finally { sync.mockRestore(); journal.close(); }
});
test('partial filesystem writes must finish the entire record before admission', async () => {
  const { journal, processor } = fixture();
  const actual = fs.writeSync;
  const write = jest.spyOn(fs, 'writeSync').mockImplementation((fd, buffer, offset, length) =>
    actual(fd, buffer, offset, Math.min(length, 17)));
  try {
    await processor.handleMessage('key', { time, parts_count: 100, machine_status: 'RUN' }, now);
    expect(journal.read(100).records).toEqual([expect.objectContaining({ r: expect.objectContaining({ parts_count: 100 }) })]);
    expect(journal.stats().durable_seq).toBe(journal.lastSeq);
    expect(write.mock.calls.length).toBeGreaterThan(1);
  } finally { write.mockRestore(); journal.close(); }
});
test('a long reconnect gap preserves counter provenance without inventing runtime or shift allocation', async () => {
  const { journal, processor } = fixture({ previous: { received_at: time - 86400,
    parts_count: 100, machine_status: 'RUNNING', mode: 'AUTO', alarm: false } });
  await processor.handleMessage('key', { time, parts_count: 108, machine_status: 'RUN' }, now);
  const slices = journal.read(100).records[0].h;
  expect(slices.reduce((sum, h) => sum + h.run + h.idle, 0)).toBe(60);
  expect(slices.reduce((sum, h) => sum + h.produced, 0)).toBe(0);
  expect(processor.state(7).unallocated_parts).toBe(8);
  expect(journal.read(100).records[0].gap.unallocated_parts).toBe(8);
  journal.close();
});

test('priority class changes are journaled with receipt time; unchanged readings need no alarm write', async () => {
  const { journal, processor } = fixture({ redis: { isReady: false } });
  try {
    const data = { machine_status: 'STOP', stat_alarm: 1, alarm_code: 'EX1000', alarm_type: 'Door open' };
    await processor.handleMessage('key', { ...data, time: time - 3, alarm_severity: 'NORMAL' }, now - 3000);
    await processor.handleMessage('key', { ...data, time: time - 2, alarm_severity: 'CRITICAL' }, now - 2000);
    await processor.handleMessage('key', { ...data, time: time - 1, alarm_severity: 'CRITICAL' }, now - 1000);
    await processor.handleMessage('key', { machine_status: 'RUN', time, stat_alarm: 0 }, now);
    const records = journal.read(100).records;
    expect(records[0].a.opens).toHaveLength(1);
    expect(records[1].a.opens).toEqual([]);
    expect(records[1].a.updates[0].alarm_severity).toBe('CRITICAL');
    expect(records[1].a.receivedAt).toBe(new Date(now - 2000).toISOString());
    expect(records[1].state.alarm_severities).toEqual({ EX1000: 'CRITICAL' });
    expect(records[2].a).toBeUndefined();
    expect(records[3].a.closes).toEqual(['EX1000']);
    expect(records[3].state.alarm_severities).toEqual({});
  } finally { journal.close(); }
});
