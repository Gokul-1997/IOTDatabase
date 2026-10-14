# Text-length rejection and quarantined readings

The 14 October 2026 log reports machine 20, sequence 1791967253439000, rejected with `value too long for type character varying(50)`. The collector rolled back that record's database transaction, saved the original record in its private `quarantine.ndjson`, then advanced its normal checkpoint so other machines could continue. The normal telemetry/hourly/alarm/meter transaction for this particular record was not committed.

## Confirmed source defect and correction

Backend migration 007 defines `machine_alarms.alarm_type` as VARCHAR(50), while both collector alarm writers previously allowed 100 characters. This is a confirmed writer/schema mismatch. The old log does not identify the failing column, so the specific machine 20 record must still be inspected; `telemetry_raw.mode` and any custom schema limits are other possibilities.

Both alarm writers and their open/close/reconciliation keys now use one shared contract:

- Type/code fit 50 PostgreSQL characters; severity fits 20. Unicode characters are counted without splitting surrogate pairs.
- Full original long type/code text and the original description remain in `message TEXT`.
- Short labels/codes retain their existing identities.
- Overlong identity keys use a readable prefix and stable suffix, preserving distinct alarms whose first 50 characters are identical. Coded alarm types keep a readable prefix; code-less types use the stable identity form.

This confirmed defect needs no schema alteration. Deploy `src/lib/alarm-text.js`, both alarm writers and the updated flusher together. The new logs include SQLSTATE, write stage, available table/column/constraint and character counts of submitted values, without logging raw payload descriptions. Checkpoint/transaction failures are retried with records pending; they cannot be mistaken for bad machine data and quarantined.

## Existing quarantine: inspect, preserve, recover deliberately

Keep the quarantine, persistent journal and collector identity. Restarting does **not** automatically replay database-rejected records that the normal checkpoint has passed. Do not move the checkpoint backwards: that can duplicate already committed additive production totals. Do not resend an old reading with a fabricated current timestamp.

The read-only inspector streams the supplied file with bounded line/output sizes and prints IDs, timestamps, text-field names and Unicode character lengths. It loads no application environment and contacts no service. It never prints payload values, passwords or full descriptions:

```sh
cd /home/ubuntu/IOTDatabase
node tools/inspect-quarantine.mjs <actual-journal-directory>/quarantine.ndjson \
  --seq 1791967253439000 --machine 20
```

Replace the path with the deployed `JOURNAL_DIR`; when unset, the collector defaults to `data/journal` under its working directory. New metadata fields are included when available; old entries can still be inspected. Oversized/malformed lines are counted without modification. Keep the file private and backed up.

Use a read-only PostgreSQL query to confirm target text contracts:

```sql
SELECT table_name, column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('telemetry_raw', 'machine_alarms', 'telemetry_late',
                     'ingest_gaps', 'ingest_checkpoint', 'energy_meter_readings')
  AND character_maximum_length IS NOT NULL
ORDER BY table_name, ordinal_position;
```

After identifying the exact failed field and correcting its writer/schema contract, review the preserved original record in a private administration context. Historical repair must use a tested, idempotent recovery transaction with a durable replay identity; it must not simply reinsert the record blindly. Old alarm transitions may contain pre-fix keys, so their alarm identities need normalization/reconciliation against existing periods. This patch supplies inspection and prevents new matching failures; it does not automatically mutate historical quarantine or provide unverified replay against the target database.

## Other messages in the supplied log

Machine 17's repeatedly oversized `run_time` still becomes NULL. Its values change substantially and sometimes drop; verify the device field, encoding and units from a raw sample before converting them or widening a database column. A BIGINT change alone does not establish that these are valid seconds. The production dashboard run/idle durations use observed state and `production_hourly.run_seconds`, not this raw counter.

Machine 23's 76,066,615ms lag is about 21h 7m 47s. Packets more than 5 minutes old are retained as late observations rather than shown as current. Review gateway clocks and replay/buffering. Other machines' 10–26s lag exceeds the 10s warning threshold. A single Redis disconnect is insufficient evidence of a permanent outage; check later reconnect/ready logs and `/health`. Redis degradation can delay the live display while journal/database processing continues.

The recovery message correctly omits machine 23 in the supplied latest sample; verify its own new observations before declaring it recovered. Detailed lag/counter handling is in [TELEMETRY_WARNINGS.md](TELEMETRY_WARNINGS.md).

No target database, server configuration, historical record or device unit was changed by this local work.

Final verification: all 20 collector suites / 363 tests passed. The disposable PostgreSQL fixture passed with real VARCHAR(50) alarm columns, Unicode descriptions, distinct long labels/codes, independent close/reopen/reconciliation, atomic alarm/meter/rollup/checkpoint writes and outage/lost-COMMIT recovery. The inspector's bounded, value-free output and read-only behavior were tested separately.
