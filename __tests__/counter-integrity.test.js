import { partsCountOf, partsDelta } from '../src/lib/parts-delta.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';

test.each([-3, 1.5, true, false, {}, [], '12oops', ' ', 'Infinity', 2147483648, Number.MAX_SAFE_INTEGER + 1])(
  'invalid counter %j never changes production or becomes a new baseline', async value => {
    expect(partsCountOf(value)).toBeNull();
    expect(partsDelta(10, value)).toBe(0);
    expect(partsDelta(value, 12)).toBe(0);
    const records = [];
    const journal = { append: record => { records.push(record); return records.length; }, syncThrough: async () => {} };
    const time = Math.floor(Date.now() / 1000);
    const processor = createMessageProcessor({ journal, redis: { isReady: false },
      lookupMachine: async () => ({ id: 7, company_id: 4 }), hydrate: async () => null,
      shifts: { shiftFor: () => 1, shiftsOf: () => [{ id: 1, start: 0, end: 86399 }] } });
    for (const [i, count] of [10, value, 12].entries()) {
      await processor.handleMessage('device', { time: time + i, machine_status: 'RUN', parts_count: count }, (time + i) * 1000);
    }
    expect(records[1].r.parts_count).toBeNull();
    expect(records[1].state.parts_count).toBe(10);
    expect(records.flatMap(record => record.h).reduce((sum, hour) => sum + hour.produced, 0)).toBe(2);
  }
);
test('valid numeric strings and reset to zero retain the existing counter contract', () => {
  expect(partsCountOf('123')).toBe(123);
  expect(partsCountOf(2147483647)).toBe(2147483647);
  expect(partsDelta(10, '0')).toBe(0);
  expect(partsDelta('10', '12')).toBe(2);
});
