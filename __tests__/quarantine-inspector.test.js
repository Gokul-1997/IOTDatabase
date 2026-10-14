import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectFile, summaryOf } from '../tools/inspect-quarantine.mjs';
let dir, file;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarantine-inspect-')); file = path.join(dir, 'quarantine.ndjson'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const record = () => ({ at: '2026-10-14T08:40:53.454Z', reason: 'database_rejected', code: '22001', error: 'secret raw diagnostic',
  record: { s: 1791967253439000, r: { machine_id: 20, company_id: 4, device_time: 1791967249, mode: 'AUTO' },
    a: { opens: [{ alarm_type: '🔧'.repeat(55), alarm_code: 'PRIVATE-CODE', alarm_severity: 'CRITICAL', alarm_message: 'private description' }] },
    state: { credentials: 'must-never-print' } } });

test('reports code-point lengths and identifiers without exposing descriptions, values or credentials', () => {
  const item = record(); const summary = summaryOf(item);
  expect(summary).toMatchObject({ sequence: 1791967253439000, machine_id: 20, company_id: 4, sqlstate: '22001' });
  expect(summary.text_fields).toContainEqual({ table: 'machine_alarms', column: 'alarm_type', characters: 55, alarm_index: 0 });
  const output = JSON.stringify(summary);
  for (const secret of ['PRIVATE-CODE', 'private description', 'must-never-print', 'secret raw diagnostic', 'AUTO', '🔧']) expect(output).not.toContain(secret);
});

test('filters the existing sequence read-only and handles malformed/torn lines', async () => {
  const first = record(), second = record(); second.record.s++; second.record.r.machine_id = 21;
  const bytes = JSON.stringify(first) + '\nnot-json\n' + JSON.stringify(second) + '\n{"torn":';
  fs.writeFileSync(file, bytes);
  const result = await inspectFile(file, { seq: first.record.s, machine: 20 });
  expect(result.records).toHaveLength(1); expect(result.malformed_lines).toBe(2);
  expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
});

test('oversized lines are skipped with bounded buffers while subsequent records remain readable', async () => {
  fs.writeFileSync(file, 'x'.repeat(200000) + '\n' + JSON.stringify(record()) + '\n');
  const result = await inspectFile(file, { maxLineBytes: 1000 });
  expect(result.oversized_lines).toBe(1); expect(result.records).toHaveLength(1);
});

test('bounded output and argument validation prevent unbounded result output', async () => {
  fs.writeFileSync(file, (JSON.stringify(record()) + '\n').repeat(20));
  expect((await inspectFile(file, { limit: 2 })).records).toHaveLength(2);
  await expect(inspectFile(file, { limit: 0 })).rejects.toThrow('Limit');
  await expect(inspectFile(file, { seq: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow('Sequence');
  await expect(inspectFile(file, { machine: '20;secret' })).rejects.toThrow('Machine');
});

test('untrusted metadata is omitted and no application environment is needed', async () => {
  const entry = record(); entry.code = 'secret'; entry.stage = 'unsafe secret'; entry.table = 'unsafe secret'; entry.column = 'unsafe secret';
  fs.writeFileSync(file, JSON.stringify(entry));
  const result = await inspectFile(file);
  expect(result.records[0].sqlstate).toBeUndefined(); expect(result.records[0].stage).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('unsafe secret');
});
