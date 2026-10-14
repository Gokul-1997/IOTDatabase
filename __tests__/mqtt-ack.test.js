import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import mqtt from 'mqtt';
import { installAdmission } from '../src/lib/admission.js';
import { createJournal } from '../src/lib/journal.js';

const binary = ['/opt/homebrew/sbin/mosquitto', '/usr/sbin/mosquitto', '/usr/bin/mosquitto'].find(file => fs.existsSync(file));
const brokerTest = binary ? test : test.skip;
const waitFor = async (condition, ms = 5000) => {
  const end = Date.now() + ms;
  while (!condition()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 10)); }
};
const connect = (url, options, configure = () => {}) => new Promise((resolve, reject) => {
  const client = mqtt.connect(url, { reconnectPeriod: 0, ...options });
  configure(client);
  client.once('connect', connack => resolve({ client, connack })); client.once('error', reject);
});
const end = client => new Promise(resolve => client.end(true, {}, resolve));

brokerTest('real disposable broker: QoS1 ACK follows fsync, refused delivery replays on persistent reconnect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnc-mqtt-test-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const config = path.join(dir, 'mosquitto.conf');
  fs.writeFileSync(config, `listener ${port} 127.0.0.1\nallow_anonymous true\npersistence true\npersistence_location ${dir}/\nautosave_interval 1\n`);
  const broker = spawn(binary, ['-c', config], { stdio: 'ignore' });
  const clients = [];
  const journal = createJournal({ dir: path.join(dir, 'journal') }); journal.open();
  try {
    await waitFor(() => broker.exitCode === null, 1000);
    // Broker spawn readiness is verified by a temporary TCP connection.
    await new Promise((resolve, reject) => {
      let attempts = 0;
      const probe = () => {
        const socket = net.connect(port, '127.0.0.1', () => { socket.destroy(); resolve(); });
        socket.on('error', () => { socket.destroy(); if (++attempts > 100) reject(new Error('Broker failed to start')); else setTimeout(probe, 20); });
      }; probe();
    });
    const url = `mqtt://127.0.0.1:${port}`;
    const subscriberId = `cnc-test-${process.pid}`;
    const first = (await connect(url, { clientId: subscriberId, clean: false })).client; clients.push(first);
    let release, attempts = 0, acked = 0, refuse = false;
    installAdmission(first, { process: async (_key, payload) => {
      attempts++;
      if (refuse) throw new Error('journal full');
      await new Promise(resolve => { release = resolve; });
      const seq = journal.append({ r: payload }); await journal.syncThrough(seq);
    } });
    first.on('packetsend', packet => { if (packet.cmd === 'puback') acked++; });
    await new Promise((resolve, reject) => first.subscribe('machines/+/telemetry', { qos: 1 }, error => error ? reject(error) : resolve()));
    const publisher = (await connect(url, {})).client; clients.push(publisher);
    const data = n => JSON.stringify({ time: Math.floor(Date.now() / 1000), parts_count: n });
    await new Promise((resolve, reject) => publisher.publish('machines/test-device/telemetry', data(100), { qos: 1 }, error => error ? reject(error) : resolve()));
    await waitFor(() => attempts === 1);
    expect(acked).toBe(0); expect(journal.stats().appended).toBe(0);
    release(); await waitFor(() => acked === 1);
    expect(journal.stats().durable_seq).toBeGreaterThan(0);

    refuse = true;
    await new Promise((resolve, reject) => publisher.publish('machines/test-device/telemetry', data(101), { qos: 1 }, error => error ? reject(error) : resolve()));
    await waitFor(() => attempts === 2 && !first.connected);
    expect(acked).toBe(1);
    await end(first);
    let redelivered = 0;
    // A persistent broker may send CONNACK and PUBLISH in the same read.
    // Match production: install the gate synchronously, before awaiting connect.
    const { client: second, connack } = await connect(url, { clientId: subscriberId, clean: false }, subscriber => {
      clients.push(subscriber);
      installAdmission(subscriber, { process: async (_key, payload) => {
        redelivered++;
        const seq = journal.append({ r: payload }); await journal.syncThrough(seq);
      } });
    });
    expect(connack.sessionPresent).toBe(true);
    await waitFor(() => redelivered === 1);
    expect(journal.read(100).records.map(r => r.r.parts_count)).toEqual([100, 101]);
  } finally {
    await Promise.allSettled(clients.map(end));
    journal.close();
    broker.kill('SIGTERM');
    await new Promise(resolve => { if (broker.exitCode !== null) resolve(); else broker.once('exit', resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
