# MQTT collector startup configuration

If PM2 repeatedly reports `Production MQTT requires mqtts://`, the collector
has production mode enabled while `MQTT_URL` is plaintext (or is absent and
therefore defaults to the development loopback URL). The supplied October 14,
2026 logs show successful database/Redis connections, followed by this fatal
configuration error. PM2's `online` means the process was spawned; it does not
mean ingestion has connected or subscribed. Until fixed, new telemetry is not
being ingested. Broker replay depends on the existing persistent subscription,
QoS 1 messages and the broker's configured persistence/queue capacity.

Keep the stable `MQTT_CLIENT_ID` and the existing journal directory. Do not
delete the journal to fix a broker configuration error.

## Remote broker: TLS

In the collector's `.env`, use the actual broker's certificate hostname and
configured TLS listener. Port 8883 below is an example, not evidence of the
server's listener configuration:

```dotenv
MQTT_URL=mqtts://your-broker-certificate-hostname:8883
MQTT_USER=your-collector-user
MQTT_PASS=your-collector-password
MQTT_CLIENT_ID=pms-ingest-0
# Only for a private CA; omit this for a publicly trusted certificate.
MQTT_CA_FILE=/etc/iot/certs/ca.crt
```

Configure the broker's TLS listener, password file and telemetry ACL first;
`deploy/mosquitto.conf` and `deploy/iot.acl` provide templates. Certificate
hostname/chain validation stays enabled. Do not solve certificate errors with
`rejectUnauthorized=false` or by switching a remote broker to plaintext.

## Confirmed same-host broker: explicit loopback exception

Only if Mosquitto is running on the **same host as the collector** and its
plaintext listener is bound to loopback, this explicit configuration is
supported:

```dotenv
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_ALLOW_INSECURE=true
```

This is a narrow production exception for loopback. A private VPC address is
still a remote endpoint. The collector now refuses a plaintext remote endpoint
even when this flag is set. The secure remote-broker configuration above is
required for remote connections.

## Restart and verify

From the deployed collector directory, after saving `.env`:

```sh
pm2 restart mqtt-ingest --update-env
pm2 logs mqtt-ingest --lines 50
```

If PM2's environment also defines these variables, make it match `.env`:
dotenv preserves variables already provided by PM2. Updating `.env` cannot
override a conflicting value supplied by the process manager. Do not paste
passwords or a credential-bearing URL into shared logs.

Confirm `mqtt connected` and a healthy subscription, then check `/health` at
the collector's configured `HEALTH_PORT` (9100 in the supplied logs). Confirm
new telemetry/checkpoint advancement for a real device; successful process
startup alone does not prove data delivery.

The entry point now validates URL, production transport policy and CA file
before loading any database/Redis clients, opening the journal, starting the
writer, health listener or refresh timers. This removes misleading startup
success messages when the configuration cannot connect safely.
