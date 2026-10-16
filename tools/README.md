# Collector verification

Run `npm test -- --runInBand`. The MQTT acknowledgement test starts a temporary
loopback-only Mosquitto broker when its binary is installed; otherwise that
specific test is reported as skipped. The health test also needs local listener
permission. Tests do not use application environment files or configured services.

`node tools/verify-ingestion.mjs` starts and removes its own Unix-socket-only
PostgreSQL cluster. It verifies raw telemetry, hourly parts, alarm transitions
and meter rows, including durable short-critical priority events, through Redis unavailability, database failure and a lost COMMIT
response. It is a PostgreSQL transaction test, not Timescale version validation.

`node tools/benchmark-admission.mjs 10000 1000` measures the actual message
processor and per-message journal fsync on local disk, with Redis unavailable
and database writes waiting. It records throughput, admission latency, memory,
event-loop delay and journal size. This is not a broker/cloud/database load test.

On 13 October 2026, 10,000 messages for 1,000 machines took 32.8 s on local APFS
(305 admissions/s, p50 3.018ms, p95 4.088ms, RSS growth 8.9 MB, event-loop p99
12.5 ms). 15.88 MB waited on disk, with zero refusals. This result supports testing
at 100 machines × 1 Hz on this disk; it does not demonstrate capacity for 1,000 × 1 Hz.
Per-message durable acknowledgement adds disk latency. Benchmark target hardware
before raising the machine rate or choosing a partitioned collector deployment.

The final-code repeat on the same host took 29.7 s (336 admissions/s, p50 2.992 ms,
p95 4.312 ms, event-loop p99 12.41 ms, 15.51 MiB pending journal, zero refusals).
RSS end-to-start was -10.7 MB; garbage collection/startup allocation makes that
net change unsuitable as a peak-memory estimate. These measurements vary with
local workload/cache; neither measures broker or database capacity or proves
1,000 machines at 1 Hz.

Apply Backend migrations through **048** before deploying this build. Startup checks require `ingest_gaps`, the alarm continuity and priority observation columns, and `alarm_notification_events`. Accepted critical opens and changes into critical priority persist an outbox event with the same journal transaction; PostgreSQL NOTIFY wakes the API only after commit. Unchanged readings produce no new alarm operation. See the Backend `docs/ALARM_NOTIFICATIONS.md` guide for policy configuration and deployment order.

Alarm text writers now match the existing VARCHAR(50) type/code contract and preserve full original descriptions in TEXT. For rejected records, `node tools/inspect-quarantine.mjs <file> --seq <sequence>` provides private read-only IDs/field-length diagnostics without loading environment or connecting services. See [quarantine text correction and recovery limits](../deploy/QUARANTINE_TEXT_FIX.md). Restarting does not automatically replay records the checkpoint has already passed.
Gap records are queryable by company/machine/time and commit with the journal checkpoint.
No retroactive shift allocation or automatic retention deletion is performed.

New accepted records include immutable alarm transitions, sampled meter values
and per-machine state. Keep the journal on persistent storage with its stable
collector ID. A previous collector build cannot replay these secondary records:
drain the new journal before rolling back. The journal quarantines rejected
records in `quarantine.ndjson`; inspect and repair them rather than treating them
as successfully ingested. Quarantine has a 256 MiB cap and fails closed if full.

QoS1 PUBACK follows journal fsync. Refused/transiently failed admissions close the
MQTT transport and remain eligible for persistent-session broker replay. Invalid
packets are counted and acknowledged so one malformed packet cannot block valid
telemetry. Device timestamp must be finite integer epoch seconds, from 2000 onwards,
and no more than 60 s ahead of the collector. Payloads are limited to 64 KiB and 12
nested levels. Readings over 5 min old go to `telemetry_late`, including at startup;
they are never advertised as current observations.

Redis is only the display cache. Accepted ordering/counter state comes from the
journal snapshot or a tenant-scoped database baseline. State and dedup change
only after durable admission. Distinct payloads within the same second are kept.
Elapsed runtime is credited only through the 60 s freshness window; later
unobserved runtime is not inferred, and counter increments across missing observations remain unallocated with
raw counter/provenance, rather than assigned to an unverified shift. Every collector must exclusively own its machine set: running
two independent collectors against the same wildcard is not supported.

`deploy/mosquitto.conf` and `deploy/iot.acl` are secure templates requiring real
certificates and passwords before deployment. Each device username must equal its
own machine API key so the ACL permits only that device's telemetry topic. The
collector gets its own credential and read access. Broker queue bytes and message
counts are both bounded. Devices must publish QoS1 for replay guarantees. Real
controller compatibility and deployment TLS/ACL enforcement require staging tests.
