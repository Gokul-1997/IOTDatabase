// Read-only quarantine diagnostics. Never loads application env or clients.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const id = value => {
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
const identifier = value => typeof value === 'string' && /^[a-z_][a-z_0-9]{0,63}$/i.test(value) ? value : undefined;
const length = value => value == null ? null : Array.from(String(value)).length;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;

export function summaryOf(entry) {
  const record = entry?.record || {};
  const row = record.r || record.l || {};
  const alarm = record.a;
  const machine = id(row.machine_id ?? alarm?.machineId ?? record.m?.machineId ?? record.gap?.machine_id);
  const company = id(row.company_id ?? alarm?.companyId ?? record.m?.companyId ?? record.gap?.company_id);
  const fields = [];
  const add = (table, column, value, index) => {
    if (value != null) fields.push({ table, column, characters: length(value), ...(index == null ? {} : { alarm_index: index }) });
  };
  if (record.r) {
    add('telemetry_raw', 'machine_status', row.machine_status);
    add('telemetry_raw', 'mode', row.mode);
  }
  if (record.l) add('telemetry_late', 'reason', row.reason);
  if (record.gap) add('ingest_gaps', 'reason', record.gap.reason);
  for (const [index, item] of (Array.isArray(alarm?.opens) ? alarm.opens : []).entries()) {
    add('machine_alarms', 'alarm_type', item?.alarm_type, index);
    add('machine_alarms', 'alarm_code', item?.alarm_code, index);
    add('machine_alarms', 'severity', item?.alarm_severity, index);
    add('machine_alarms', 'message', item?.alarm_message, index);
  }
  return {
    sequence: id(record.s), machine_id: machine, company_id: company,
    ...(id(row.device_time) ? { device_time: id(row.device_time) } : {}),
    ...(timestamp(entry?.at) ? { quarantined_at: timestamp(entry.at) } : {}),
    reason: ['database_rejected', 'corrupt_record', 'torn_record', 'oversized_record'].includes(entry?.reason) ? entry.reason : 'unclassified',
    ...(typeof entry?.code === 'string' && /^[A-Z0-9]{5}$/.test(entry.code) ? { sqlstate: entry.code } : {}),
    ...(identifier(entry?.stage) ? { stage: entry.stage } : {}),
    ...(identifier(entry?.table) ? { table: entry.table } : {}),
    ...(identifier(entry?.column) ? { column: entry.column } : {}),
    text_fields: fields
  };
}

async function* linesOf(filename, maxLineBytes, counts) {
  const stream = fs.createReadStream(filename, { highWaterMark: 64 * 1024 });
  let pieces = [], bytes = 0, oversized = false;
  try {
    for await (const chunk of stream) {
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(10, start);
        const piece = chunk.subarray(start, end < 0 ? chunk.length : end);
        bytes += piece.length;
        if (bytes > maxLineBytes) { oversized = true; pieces = []; }
        if (!oversized) pieces.push(piece);
        if (end < 0) break;
        if (oversized) counts.oversized_lines++;
        else yield Buffer.concat(pieces).toString('utf8');
        pieces = []; bytes = 0; oversized = false; start = end + 1;
      }
    }
    if (oversized) counts.oversized_lines++;
    else if (bytes) yield Buffer.concat(pieces).toString('utf8');
  } finally { stream.destroy(); }
}

export async function inspectFile(filename, { seq, machine, limit = 10, maxLineBytes = 1024 * 1024 } = {}) {
  if (seq != null && !id(seq)) throw new Error('Sequence must be a positive safe integer');
  if (machine != null && !id(machine)) throw new Error('Machine must be a positive safe integer');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be between 1 and 100');
  if (!Number.isInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > 1024 * 1024) throw new Error('Invalid line size limit');
  if (!fs.statSync(filename).isFile()) throw new Error('Quarantine path must be a regular file');
  const counts = { scanned_lines: 0, malformed_lines: 0, oversized_lines: 0 };
  const records = [];
  let stopped_at_limit = false;
  for await (const line of linesOf(filename, maxLineBytes, counts)) {
    if (!line.trim()) continue;
    counts.scanned_lines++;
    let entry;
    try { entry = JSON.parse(line); }
    catch { counts.malformed_lines++; continue; }
    const summary = summaryOf(entry);
    if (seq != null && summary.sequence !== id(seq)) continue;
    if (machine != null && summary.machine_id !== id(machine)) continue;
    records.push(summary);
    if (records.length >= limit) { stopped_at_limit = true; break; }
  }
  return { access: 'READ ONLY; values and payloads omitted', records, ...counts, stopped_at_limit };
}

async function main(args) {
  const filename = args.shift();
  if (!filename || filename.startsWith('--')) throw new Error('Usage: node tools/inspect-quarantine.mjs <quarantine.ndjson> [--seq <number>] [--machine <number>] [--limit <1..100>]');
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--seq', '--machine', '--limit'].includes(key) || !args.length) throw new Error('Unknown or incomplete argument');
    const value = args.shift();
    if (!id(value)) throw new Error('Arguments must be positive safe integers');
    options[key.slice(2)] = Number(value);
  }
  console.log(JSON.stringify(await inspectFile(filename, options), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.code ? `Quarantine inspection failed: ${error.code}` : error.message);
    process.exitCode = 1;
  });
}
