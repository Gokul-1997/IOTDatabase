# MQTT telemetry payload — what the platform reads

Everything on the dashboards is derived from one MQTT message per machine.
This is the complete list of fields the collector reads, what each one
feeds, and what happens when it is absent.

**Topic** `machines/{api_key}/telemetry` — QoS 1, `clean: false`
(`api_key` is the machine's `api_key` in the platform, e.g. `ebf4c0b19eb26e061e2098a0104f9525`)

**Payload** a single flat JSON object.

---

## Currently sent — 7 fields

These arrive today, roughly once per second per machine.

| Field | Type | Feeds |
|---|---|---|
| `time` | epoch **seconds** | Everything. **Required** — a message without it is discarded. |
| `machine_status` | string | Running/idle split, availability, live status |
| `status` | integer | Stored raw as a controller state code |
| `mode` | string | `AUTO`, `EDIT`, `MDI`, `JOG`, `HANDLE` — manual-time analysis |
| `parts_count` | integer, cumulative | Production quantity, OEE performance, energy per part |
| `spindle_load` | number | Machine detail |
| `feed_rate` | number | Machine detail |

`machine_status` is matched case-insensitively. `RUN`, `RUNNING` and
`CUTTING` all mean running; `ALARM` raises an alarm; anything else is
treated as idle.

---

## Needed, and currently never sent

The collector already reads every one of these. They require no change on
our side — the moment the firmware includes them, they are stored and the
dashboards fill in.

### Alarms — Screens 3 and 5 depend entirely on this

Today no machine has ever reported an alarm state, so `machine_alarms` is
empty, the Alarm dashboard has nothing to show, and the preventive
maintenance rules have nothing to trigger on.

| Field | Type | Notes |
|---|---|---|
| `machine_status` | `"ALARM"` | Send this **while** the alarm is active, and stop sending it when the alarm clears. The platform records the period between those two, so duration is derived — no separate start/end message is needed. |
| `alarm_code` | string | The controller's own code, e.g. `SV0401` |
| `alarm_type` | string | Human-readable name, e.g. `Spindle overload` |
| `alarm_severity` | `"CRITICAL"` or `"NORMAL"` | Defaults to `NORMAL` |
| `alarm_message` | string | Optional detail |

### Energy — Screen 9 depends entirely on this

| Field | Type | Notes |
|---|---|---|
| `energy` | number, **cumulative kWh** | A counter that only rises. The platform takes the difference between readings, so a counter that resets to zero reads as a gap, not as negative usage. |
| `voltage` | number | Volts |
| `current` | number | Amperes |
| `power` | number | Instantaneous kW |

`Energy` with a capital E is also accepted, as are `volts`, `amps` and `kw`.

### Program number — makes the transfer safety check possible

| Field | Type | Notes |
|---|---|---|
| `program_number` | integer | The program selected on the controller. Lets the app warn before a transfer overwrites the program an operator is running. Also accepted as `program_no` or `o_number`. |

### Cutting speed and controller counters

| Field | Type | Notes |
|---|---|---|
| `cutting_speed` | number | Also accepted as `surface_speed` |
| `total_run_time` | integer seconds | Controller lifetime powered-on counter. Also `powered_on_time`. |
| `total_cutting_time` | integer seconds | Also `cutting_time` |
| `run_time` | integer seconds | Since the current program started |

---

## A complete example

```json
{
  "time": 1789025229,
  "machine_status": "RUN",
  "status": 3,
  "mode": "AUTO",
  "parts_count": 11146,
  "spindle_load": 42.5,
  "feed_rate": 1200,
  "cutting_speed": 180,
  "program_number": 1234,
  "run_time": 3600,
  "total_run_time": 9876543,
  "total_cutting_time": 5432100,
  "energy": 12345.67,
  "voltage": 415.2,
  "current": 18.6,
  "power": 7.7
}
```

And the same machine while alarming:

```json
{
  "time": 1789025244,
  "machine_status": "ALARM",
  "alarm_code": "SV0401",
  "alarm_type": "Spindle overload",
  "alarm_severity": "CRITICAL",
  "alarm_message": "Load exceeded on Z axis",
  "status": 5,
  "mode": "AUTO",
  "parts_count": 11146
}
```

---

## Rules that silently discard a message

Worth knowing, because none of these produce an error the device can see.

1. **No `time` field** — discarded.
2. **`time` older than 5 minutes** — discarded as stale. (For the first 10
   minutes after a platform restart the limit is 24 hours, so a broker can
   replay its backlog.)
3. **`time` not greater than the previous message from that machine** —
   discarded. Clocks that jump backwards lose data; keep the device clock
   in sync with NTP.
4. **No shift configured covering that timestamp** — discarded entirely.
   Telemetry outside configured shift hours is not stored at all.

## Types

Numbers may be sent as JSON numbers or as strings; `"12.5"` and `"12,5"`
are both read as 12.5. Anything that is not a finite number is stored as
null rather than failing the message. Unknown fields are ignored, so extra
keys are harmless.

## Sending order

Send one message per machine per interval with whatever is currently
available. There is no need to batch, to send deltas, or to omit unchanged
fields — the platform deduplicates on `(api_key, time, parts_count)` and
stores state transitions only.
