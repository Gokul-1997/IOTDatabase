/*
 * Controller identity writes: rate-limited, and switched off cleanly when the
 * ingestion user may not UPDATE machines — the error the production server
 * logged for every machine on 2026-09-15.
 */

import { jest } from '@jest/globals';
import { createIdentityWriter } from '../src/lib/controller-identity.js';

const identity = { controller_ip: '192.168.200.3', cnc_series: 'D4G3', cnc_version: '22.0',
                   cnc_type: '0', cnc_machine_type: 'M', controlled_axes: 4 };
const denied = () => Object.assign(new Error('permission denied for table machines'), { code: '42501' });

function setup(queryImpl = async () => ({ rowCount: 1 })) {
  let clock = 1_000_000;
  const pool = { query: jest.fn(queryImpl) };
  const log = jest.fn();
  const record = createIdentityWriter({ pool, log, now: () => clock });
  return { pool, log, record, advance: ms => { clock += ms; } };
}

test('writes identity and FOCAS codes, binding exactly the parameters it references', async () => {
  const { pool, record } = setup();
  await record(17, identity, { cnc_diagnoss_308_1: 0 });
  const [sql, params] = pool.query.mock.calls[0];
  const highest = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
  expect(params.length).toBe(highest);
  expect(params[0]).toBe(17);
  expect(JSON.parse(params[7])).toEqual({ cnc_diagnoss_308_1: 0 });
});

test('the same identity again within the hour writes nothing', async () => {
  const { pool, record, advance } = setup();
  await record(17, identity, null);
  advance(59 * 60_000);
  await record(17, identity, null);
  expect(pool.query).toHaveBeenCalledTimes(1);
  advance(2 * 60_000);
  await record(17, identity, null);
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test('a changed identity is written straight away', async () => {
  const { pool, record } = setup();
  await record(17, identity, null);
  await record(17, { ...identity, cnc_version: '23.0' }, null);
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test('permission denied switches writes off and logs the fix once — not once per machine', async () => {
  const { pool, log, record } = setup(async () => { throw denied(); });
  for (const machine of [16, 17, 20, 21, 28, 31]) await record(machine, identity, null);

  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][1]).toMatch(/GRANT UPDATE \(.*\) ON machines/);
  expect(log.mock.calls[0][1]).toMatch(/Telemetry and alarms are unaffected/);
});

test('a permission error does not throw to the message handler', async () => {
  const { record } = setup(async () => { throw denied(); });
  await expect(record(17, identity, null)).resolves.toBeUndefined();
});

test('any other error is still thrown, so the caller logs it', async () => {
  const { record } = setup(async () => { throw Object.assign(new Error('timeout'), { code: '57014' }); });
  await expect(record(17, identity, null)).rejects.toThrow('timeout');
});
