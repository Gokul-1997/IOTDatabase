import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partsCounterStep } from '../src/lib/parts-delta.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
import { createJournal } from '../src/lib/journal.js';

function steps(counts) {
  let baseline = null, produced = 0;
  for (const count of counts) {
    const next = partsCounterStep(baseline, count);
    baseline = next.baseline; produced += next.delta;
  }
  return { baseline, produced };
}

test('repeated backward/rebound readings cannot manufacture output', () => {
  expect(steps([11, ...Array.from({ length: 1209 }, () => [5, 11]).flat()]))
    .toEqual({ baseline: 11, produced: 0 });
  expect(steps([11, 5, 11, 5, 11, 12, 13])).toEqual({ baseline: 13, produced: 2 });
});

test('confirmed near-zero resets still count new output', () => {
  expect(steps([76, 0, 1, 2, 3])).toEqual({ baseline: 3, produced: 3 });
  expect(steps([76, 1, 2, 3])).toEqual({ baseline: 3, produced: 3 });
  expect(steps([76, 5, 6, 7, 0, 1, 2])).toEqual({ baseline: 2, produced: 2 });
});

test('invalid readings preserve the baseline and a large recovery remains a baseline change only', () => {
  expect(steps([11, null, 'bad', 5, 11, 12])).toEqual({ baseline: 12, produced: 1 });
  expect(steps([2, 150, 151])).toEqual({ baseline: 151, produced: 1 });
  expect(partsCounterStep(10, 1000, 301)).toEqual({ baseline: 1000, delta: 990, regressed: false });
});

function processor(journal, hydrate = async () => null) {
  return createMessageProcessor({ journal, hydrate, redis: { isReady: false },
    lookupMachine: async () => ({ id: 82, company_id: 4 }),
    shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] } });
}

test('raw counters remain unchanged while hourly output uses the retained baseline', async () => {
  const records = [];
  const journal = { append: record => { records.push(record); return records.length; }, syncThrough: async () => {} };
  const p = processor(journal);
  const start = Math.floor(Date.now() / 1000) - 100;
  for (const [i, count] of [11, 5, 11, 5, 11, 12].entries()) {
    await p.handleMessage('device', { time: start + i, machine_status: 'RUN', parts_count: count }, (start + i) * 1000);
  }
  expect(records.map(record => record.r.parts_count)).toEqual([11, 5, 11, 5, 11, 12]);
  expect(records.flatMap(record => record.h).reduce((sum, hour) => sum + hour.produced, 0)).toBe(1);
  expect(records[4].state.parts_counter_uncertain).toBe(true);
  expect(records[5].state.parts_counter_uncertain).toBe(false);
});

test('a durable journal restart cannot recount the rebound as new output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-baseline-'));
  let journal;
  try {
    const start = Math.floor(Date.now() / 1000) - 100;
    journal = createJournal({ dir });
    journal.open();
    let p = processor(journal);
    for (const [i, count] of [11, 5].entries()) {
      await p.handleMessage('device', { time: start + i, machine_status: 'RUN', parts_count: count }, (start + i) * 1000);
    }
    journal.close();
    journal = createJournal({ dir });
    journal.open();
    expect(journal.latestStates().get(82).parts_baseline).toBe(11);
    p = processor(journal, async () => { throw new Error('durable state must be used'); });
    await p.handleMessage('device', { time: start + 2, machine_status: 'RUN', parts_count: 11 }, (start + 2) * 1000);
    const records = journal.read(100).records;
    expect(records.flatMap(record => record.h || []).reduce((sum, hour) => sum + hour.produced, 0)).toBe(0);
    expect(p.state(82).parts_count).toBe(11);
    expect(p.state(82).parts_baseline).toBe(11);
  } finally { journal?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
