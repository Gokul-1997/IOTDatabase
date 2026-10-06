/*
 * /health must answer while a dependency cannot — that is when monitoring
 * needs it. The Redis client holds commands while it reconnects, so an
 * unbounded ping left /health and /metrics hanging for the whole outage.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../redis.js', () => ({ redis: { ping: () => new Promise(() => {}) } }));   // reconnecting: never answers
jest.unstable_mockModule('../db.js', () => ({
  pool: { query: async () => ({ rows: [{ ok: 1 }] }), totalCount: 2, idleCount: 2, waitingCount: 0 }
}));
const { startHealthServer, setSources } = await import('../health.js');
const { createLagTracker } = await import('../src/lib/ingress-lag.js');

let server, base;
beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const lag = createLagTracker({ log: () => {} });
  lag.observe(17, 16_628);
  setSources({ lag });
  server = startHealthServer(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));

test('with Redis unreachable, /health answers 503 within the ping limit and says which part is down', async () => {
  const t0 = Date.now();
  const res = await fetch(`${base}/health`);
  const h = await res.json();
  expect(Date.now() - t0).toBeLessThan(3000);
  expect(res.status).toBe(503);
  expect(h).toMatchObject({ status: 'degraded', redis: { connected: false }, db: { connected: true } });
  expect(h.ingress_lag.worst).toEqual({ machine_id: 17, lag_ms: 16_628 });
});

test('/metrics answers too, with the gateway lag', async () => {
  const text = await (await fetch(`${base}/metrics`)).text();
  expect(text).toContain('pms_redis_connected 0');
  expect(text).toContain('pms_ingress_lag_max_seconds 16.6');
  expect(text).toContain('pms_ingress_lag_seconds{machine_id="17"} 16.6');
});
