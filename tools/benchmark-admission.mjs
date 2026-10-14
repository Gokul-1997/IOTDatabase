// Offline durability microbenchmark. Not a database, broker or cloud capacity claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { createJournal } from '../src/lib/journal.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnc-admission-bench-'));
const total = Number(process.argv[2] || 10000);
const machines = Number(process.argv[3] || 1000);
const journal = createJournal({ dir }); journal.open();
const timing = [], start = performance.now(), rssStart = process.memoryUsage().rss;
const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
const processor = createMessageProcessor({ journal, redis: { isReady: false }, hydrate: async () => null,
  lookupMachine: async key => ({ id: Number(key), company_id: 1 }),
  shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] } });
try {
  const now = Date.now(), t = Math.floor(now / 1000) - Math.ceil(total / machines);
  for (let i = 0; i < total; i++) {
    const at = performance.now();
    await processor.handleMessage(String(i % machines + 1), {
      time: t + Math.floor(i / machines), parts_count: 100 + Math.floor(i / machines),
      machine_status: 'RUN', spindle_load: 42, feed_rate: 1200,
      powerdata: { total_kw: 12, total_active_energy_kwh: 100 + i / machines / 100 }
    }, now);
    timing.push(performance.now() - at);
  }
  timing.sort((a, b) => a - b);
  const ms = performance.now() - start;
  console.log(JSON.stringify({ fixture: 'offline processor + per-message durable fsync, Redis down, DB writes waiting',
    machines, messages: total, duration_ms: Math.round(ms), messages_per_second: Math.round(total * 1000 / ms),
    admission_p50_ms: Number(timing[Math.floor(total * 0.5)].toFixed(3)),
    admission_p95_ms: Number(timing[Math.floor(total * 0.95)].toFixed(3)),
    rss_growth_mb: Number(((process.memoryUsage().rss - rssStart) / 1024 ** 2).toFixed(1)),
    event_loop_p99_ms: Number((delay.percentile(99) / 1e6).toFixed(2)),
    journal: journal.stats(), state: processor.stats() }, null, 2));
} finally { delay.disable(); journal.close(); fs.rmSync(dir, { recursive: true, force: true }); }
