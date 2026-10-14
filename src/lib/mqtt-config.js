import fs from 'node:fs';

// This module has no clients or timers. Validate it before loading the runtime.
export function mqttConfig(env = process.env, readFile = fs.readFileSync) {
  const url = env.MQTT_URL || 'mqtt://127.0.0.1:1883';
  let endpoint;
  try { endpoint = new URL(url); }
  catch { throw new Error('MQTT_URL must be a valid mqtt:// or mqtts:// broker URL'); }
  if (!['mqtt:', 'mqtts:'].includes(endpoint.protocol) || !endpoint.hostname) {
    throw new Error('MQTT_URL must use mqtt:// or mqtts:// with a broker hostname');
  }
  const secure = endpoint.protocol === 'mqtts:';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname.toLowerCase());
  if (env.NODE_ENV === 'production' && !secure) {
    if (env.MQTT_ALLOW_INSECURE !== 'true') {
      throw new Error('Production MQTT requires MQTT_URL=mqtts://<broker-host>:8883. For a confirmed same-host loopback broker only, use mqtt://127.0.0.1:1883 and MQTT_ALLOW_INSECURE=true, then restart PM2 with --update-env');
    }
    if (!loopback) {
      throw new Error('MQTT_ALLOW_INSECURE=true only permits a same-host loopback broker in production. Remote brokers require MQTT_URL=mqtts://<broker-host>:8883');
    }
  }
  let ca;
  if (env.MQTT_CA_FILE) {
    if (!secure) throw new Error('MQTT_CA_FILE requires an mqtts:// broker URL');
    try { ca = readFile(env.MQTT_CA_FILE); }
    catch { throw new Error('MQTT_CA_FILE could not be read. Set it to the readable PEM CA certificate for your TLS broker'); }
    if (!String(ca).includes('-----BEGIN CERTIFICATE-----')) {
      throw new Error('MQTT_CA_FILE must contain a PEM CA certificate');
    }
  }
  return {
    url,
    options: {
      clientId: env.MQTT_CLIENT_ID || `pms-ingest-${env.NODE_APP_INSTANCE || '0'}`,
      clean: false, reconnectPeriod: 2000, connectTimeout: 10_000,
      keepalive: 30, resubscribe: true, queueQoSZero: false,
      ...(secure && { rejectUnauthorized: true }),
      ...(ca && { ca }),
      ...(env.MQTT_USER && { username: env.MQTT_USER }),
      ...(env.MQTT_PASS && { password: env.MQTT_PASS })
    }
  };
}
