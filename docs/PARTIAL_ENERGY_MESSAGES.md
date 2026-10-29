# Independent and partial energy messages

Publish to the existing `machines/<machine-api-key>/telemetry` topic. The authenticated topic identifies the machine and company; no different endpoint or machine IP mapping is required.

The existing full machine JSON continues to work. A separate energy JSON may contain the entire PowerData block, one PowerData field, or one cumulative-energy alias:

```json
{"PowerData":{"Total_kW":-0.9550080299377441}}
```

```json
{"EnergyData":{"Total_kWh":3104}}
```

```json
{"EnergyFormatted":3104}
```

All 52 existing PowerData fields are independently accepted. Numeric/string Energy and the flat voltage/current/power aliases remain supported. Energy aliases use first-valid precedence: Energy, EnergyFormatted, EnergyData.Total_kWh, PowerData.Total_Active_Energy_kWh. Repeated aliases represent one counter, not extra consumption.

Send current UNIX seconds in `time` on each publication whenever available. A timestamp-free energy-only packet uses server receipt time; a malformed or future supplied timestamp is rejected. CNC snapshots still require their existing device time. Timestamped QoS1 replay is deduplicated using the complete payload and durable journal state; timestamp-free redelivery cannot establish the original observation time.

Only valid supplied measurements are written. Zero and signed kW/PF are preserved. Missing/invalid fields remain absent in history and never clear another field. Same-second updates merge per field. An independent energy field takes precedence over a conflicting full-machine field in that same device second. Company ownership cannot be changed by a merge.

Energy-only publications never update CNC runtime, parts, alarms, battery state or machine online freshness. They use the existing durable journal/checkpoint and energy meter table, avoiding a duplicate full CNC telemetry row. Latest API readings retain each field with its own observation time; a new kWh value does not make old voltage measurements fresh. Historical averages describe reported samples.

Consumption requires at least two valid cumulative observations; the first lifetime total is not consumption. Reset/impossible increments remain guarded. Short intervals update hourly energy without adding CNC runtime/parts. Longer missing-counter intervals retain their total change and provenance as unallocated instead of inventing an hour/shift split. For reliable hour/shift allocation, continue a timestamped total-kWh heartbeat at most 60 seconds apart (30 seconds recommended), while other electrical fields may be sent only when changed. A silent change-only stream cannot prove unchanged readings or device connectivity.

Deploy Backend migration 063 before starting the updated Backend and collector. Startup checks refuse admission until the marker, source field metadata, canonical view and measurement UPDATE privileges are available. The migration adds no replacement production table and changes no historical measurements. Rollback refuses to hide already stored standalone measurements.
