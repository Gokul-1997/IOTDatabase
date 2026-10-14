import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mqttConfig } from '../src/lib/mqtt-config.js';

test('production TLS retains certificate verification and persistent subscriber options', () => {
  const config = mqttConfig({ NODE_ENV: 'production', MQTT_URL: 'mqtts://broker.example.com:8883',
    MQTT_CLIENT_ID: 'collector-test', MQTT_USER: 'collector', MQTT_PASS: 'test-secret' });
  expect(config.options).toMatchObject({ clientId: 'collector-test', clean: false,
    rejectUnauthorized: true, queueQoSZero: false, username: 'collector', password: 'test-secret' });
});

test.each([undefined, 'mqtt://127.0.0.1:1883', 'mqtt://broker.example.com:1883'])
('production rejects plaintext without an explicit exception: %s', MQTT_URL => {
  expect(() => mqttConfig({ NODE_ENV: 'production', MQTT_URL })).toThrow(/MQTT_URL=mqtts.*--update-env/);
});

test.each(['127.0.0.1', 'localhost', '[::1]'])
('explicit same-host plaintext exception works for %s', hostname => {
  const config = mqttConfig({ NODE_ENV: 'production', MQTT_URL: `mqtt://${hostname}:1883`, MQTT_ALLOW_INSECURE: 'true' });
  expect(config.options.rejectUnauthorized).toBeUndefined();
});

test.each(['broker.example.com', '172.31.32.249', '0.0.0.0'])
('plaintext production exception cannot be used for a remote/non-loopback broker: %s', hostname => {
  expect(() => mqttConfig({ NODE_ENV: 'production', MQTT_URL: `mqtt://${hostname}:1883`, MQTT_ALLOW_INSECURE: 'true' }))
    .toThrow(/same-host loopback/);
});

test.each(['not a URL', 'https://broker.example.com', 'ws://broker.example.com', 'mqtts://broker.example.com:99999'])
('unsupported or malformed URL fails without echoing credentials: %s', MQTT_URL => {
  expect(() => mqttConfig({ MQTT_URL })).toThrow(/MQTT_URL must/);
});

test('development still supports the existing local default', () => {
  expect(mqttConfig({}).url).toBe('mqtt://127.0.0.1:1883');
});

test('private CA is loaded before runtime and TLS remains strict', () => {
  const ca = Buffer.from('-----BEGIN CERTIFICATE-----\ntest-fixture\n-----END CERTIFICATE-----');
  const readFile = jest.fn(() => ca);
  const config = mqttConfig({ MQTT_URL: 'mqtts://broker.example.com:8883', MQTT_CA_FILE: '/test/ca.pem' }, readFile);
  expect(readFile).toHaveBeenCalledWith('/test/ca.pem');
  expect(config.options).toMatchObject({ ca, rejectUnauthorized: true });
});

test('unreadable CA fails with a safe actionable message', () => {
  expect(() => mqttConfig({ MQTT_URL: 'mqtts://broker.example.com', MQTT_CA_FILE: '/private/ca.pem' }, () => {
    throw new Error('Sensitive filesystem details');
  })).toThrow('MQTT_CA_FILE could not be read. Set it to the readable PEM CA certificate for your TLS broker');
});

test('non-PEM CA and CA with plaintext transport fail before connecting', () => {
  expect(() => mqttConfig({ MQTT_URL: 'mqtts://broker.example.com', MQTT_CA_FILE: 'ca' }, () => Buffer.from('not a certificate')))
    .toThrow(/PEM CA/);
  expect(() => mqttConfig({ MQTT_URL: 'mqtt://localhost', MQTT_CA_FILE: 'ca' })).toThrow(/requires an mqtts/);
});

test('actual entry exits on invalid transport before DB, Redis, journal, writer or health startup', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-config-startup-'));
  const journalDir = path.join(cwd, 'journal');
  try {
    const entry = fileURLToPath(new URL('../app.js', import.meta.url));
    const result = spawnSync(process.execPath, [entry], { cwd, encoding: 'utf8', timeout: 5000,
      env: { NODE_ENV: 'production', MQTT_URL: 'mqtt://broker.example.com:1883', JOURNAL_DIR: journalDir,
        DB_HOST: 'invalid-config-must-not-connect.example', REDIS_HOST: 'invalid-config-must-not-connect.example' } });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('failed to start MQTT ingestion');
    expect(result.stderr).toContain('MQTT_URL=mqtts://');
    expect(result.stderr).not.toMatch(/redis|DB connection|writer started|health server listening|ENOTFOUND/);
    expect(fs.existsSync(journalDir)).toBe(false);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
