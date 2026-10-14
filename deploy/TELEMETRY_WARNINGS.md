# Reading the collector warnings

The supplied 14 October 2026 log shows the collector staying up beyond 30 seconds. PM2 resetting its restart delay is normal after a stable run; this line is not an application error. It does not independently prove that every machine's data is current.

## Readings arriving late

Lag is collector receipt time minus the gateway's `payload.time` in epoch seconds. The outer PM2 timestamp is IST while JSON `t` is UTC; their 5h30m difference is normal and does not itself create lag.

- Machine 23: 61,762,437ms is about 17h 9m 22s old.
- Other listed machines: roughly 10–24s, above the 10s warning threshold.
- Readings older than 5 minutes are journaled for `telemetry_late`; they are not advertised as current telemetry or blindly credited to current production.
- Delay can come from broker/gateway replay, polling/buffering, network delay or an incorrect sender clock. These log lines alone do not identify which one.

Check the Ubuntu and gateway clocks/time synchronization, and whether the gateway republishes old samples after disconnection. Keep sample timestamps as the original observation time; do not rewrite old timestamps to make delayed data appear current. Inspect `/health` and `/metrics`, including writer state, pending journal, last MQTT message and per-machine ingress lag. Check an actual fresh sample for each affected machine.

The previous logger could announce “readings on time again” when no late readings appeared in a window, even if the affected machine had gone silent. The correction requires an actual subsequent on-time reading for each recovered machine. Silent machines expire from the lag view without being labelled recovered. Default offline/freshness handling remains separate.

## run_time outside the accepted integer range

Machine 17 sent `run_time=22145929707`. The collector currently protects this field with the signed 32-bit range, whose maximum is 2,147,483,647. It substitutes NULL for this field and logs the value, leaving the other fields available for insertion instead of letting one overflow fail the multi-machine batch. This warning is not a process crash.

Verify the controller/device field and unit before choosing a correction. A milliseconds counter needs explicit, documented conversion if the API contract is seconds; a legitimate large integer counter may need a matching schema and collector change. Do not guess the unit, clamp the counter, divide every device's value by 1000, or widen a compressed Timescale column without version/restore review. Existing warning suppression is once per machine/column per 10 minutes.

Review the database types with a read-only query:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'telemetry_raw'
  AND column_name IN ('run_time', 'total_run_time', 'total_cutting_time');
```

Obtain one raw machine 17 sample containing `time`, `run_time`, `total_run_time` and `total_cutting_time`, with credentials removed. The gateway/controller documentation must establish the unit. The dashboard's run/idle production duration comes from `production_hourly.run_seconds` and state observations, rather than this raw `run_time` counter.

No database type or sender value was changed based only on the warning.

The recovery correction passed all 18 collector suites / 342 tests, including five new recovery regressions and the disposable broker tests. The source correction is local and requires deployment; the pasted server log predates it.
