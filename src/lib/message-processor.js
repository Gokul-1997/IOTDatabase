import { hourlySlices, istHourStart } from './hourly.js';
import { partsDelta, partsCountOf } from './parts-delta.js';
import { energyStep } from './energy-step.js';
import { powerSignals, meterReading } from './power-signals.js';
import { conditionSignals, isAlarming, isDisconnected, controllerIdentity, focasResult, activeAlarms } from './condition-signals.js';
import { alarmKey, alarmTransition } from './alarm-transition.js';
import { alarmFields } from './alarm-text.js';
import { fingerprint, validDeviceTime } from './admission.js';

const RUN_STATES = new Set(['RUN', 'RUNNING', 'CUTTING']);
const num = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const int = v => { const n = num(v); return n == null ? null : Math.trunc(n); };
function normalizeMachineState(status, payload) {
  return { machine_status: RUN_STATES.has(String(status || '').toUpperCase()) ? 'RUNNING' : 'IDLE', alarm: isAlarming(payload) };
}

/** Accepted state changes follow durable journal admission, independent of Redis availability. */
export function createMessageProcessor({ journal, shifts, lookupMachine, hydrate, redis,
  recordControllerIdentity = async () => {}, recordMessage = () => {}, count = () => {},
  log = () => {}, ingressLag, maxStaleMs = 300_000, maxDedup = 10_000, commandTimeoutMs = 250 }) {
  const states = journal.latestStates?.() || new Map();
  const accepted = new Map();
  function seen(machineId, hash) {
    const at = accepted.get(`${machineId}:${hash}`);
    return at != null && Date.now() - at < 300_000;
  }
  function remember(machineId, hash) {
    accepted.set(`${machineId}:${hash}`, Date.now());
    while (accepted.size > maxDedup) accepted.delete(accepted.keys().next().value);
  }
  async function baseline(machine) {
    if (states.has(machine.id)) {
      const state = states.get(machine.id);
      if (!state || state.company_id == null || state.company_id === machine.company_id) return state;
    }
    const previous = await hydrate(machine);
    states.set(machine.id, previous || null);
    return previous || null;
  }
  async function admit(record) {
    const seq = journal.append(record);
    if (!seq) { count('journal_refused'); throw new Error('Journal refused reading'); }
    await journal.syncThrough(seq);
  }
  async function keepLate(machine, payload, deviceTime, receivedAt, reason) {
    await admit({ l: { machine_id: machine.id, company_id: machine.company_id,
      device_time: deviceTime, received_at: receivedAt, reason, payload } });
    count(`late_${reason}`);
  }
  async function publishLive(machine, livePayload, lastKey, liveKey) {
    if (!redis?.isReady) { count('redis_degraded'); return; }
    let timer;
    try {
      // Offline queue disabled on the client; a deadline bounds slow online replies.
      await Promise.race([
        redis.multi().setEx(lastKey, 300, String(livePayload.received_at))
          .setEx(liveKey, 300, JSON.stringify(livePayload))
          .publish('machine_updates', JSON.stringify({ ...livePayload,
            // Observation time stays the device's time; queued packets must not look newly observed.
            received_at: livePayload.received_at,
            ingested_at: Math.floor(Date.now() / 1000) })).exec(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Redis command timed out')), commandTimeoutMs); })
      ]);
    } catch { count('redis_degraded'); }
    finally { clearTimeout(timer); }
  }

async function handleMessage(apiKey, payload, receivedAtMs) {
  const machine = await lookupMachine(apiKey);
  if (!machine) { count('unknown_machine'); return; }   // negative-cached; not logged per message

  const deviceTime = Number(payload.time);
  if (!validDeviceTime(deviceTime, receivedAtMs)) { count('invalid'); return; }

  const hash = fingerprint(payload);
  if (seen(machine.id, hash)) { count('duplicate'); return; }

  /* The collector could not reach the controller, and says so. Its other
     values are whatever it last held, so storing them would record a dead
     network link as an idle machine. Counted, then dropped, so the machine
     goes OFFLINE through the freshness window. */
  if (isDisconnected(payload)) { count('disconnected'); return; }

  const receivedAt = new Date(receivedAtMs).toISOString();
  const ingressLatencyMs = receivedAtMs - deviceTime * 1000;
  ingressLag?.observe(machine.id, ingressLatencyMs);

  if (ingressLatencyMs > maxStaleMs) {
    await keepLate(machine, payload, deviceTime, receivedAt, 'stale', ingressLatencyMs);
    remember(machine.id, hash);
    return;
  }

  const normalized = normalizeMachineState(payload.machine_status, payload);
  const mode       = payload.mode == null ? null : String(payload.mode).slice(0, 64);
  // the energy meter: PowerData block or the contract's flat keys
  const meter      = powerSignals(payload);
  const energy     = meter.energy;

  const lastKey = `machine:${machine.id}:last_time`;
  const liveKey = `machine:${machine.id}:live`;
  const prev = await baseline(machine);
  if (prev && deviceTime < Number(prev.received_at)) {
    await keepLate(machine, payload, deviceTime, receivedAt, 'out_of_order', ingressLatencyMs);
    remember(machine.id, hash);
    return;
  }
  if (prev && deviceTime === Number(prev.received_at) && prev.fingerprint === hash) {
    count('duplicate'); return;
  }
  // null outside every shift: the reading is still stored and shown live;
  // only production_hourly, which is per shift, has nothing to add
  const shiftId = shifts.shiftFor(machine.company_id, deviceTime);

  const partsCount = partsCountOf(payload.parts_count);

  // The baseline survives Redis loss; a restart recovers it from journal or stored telemetry.
  let prevPartsCount  = prev?.parts_count ?? null;
  let prevReceivedAt  = prev?.received_at ?? null; // device epoch seconds
  let gapSeconds      = 0;

  // Compute gap so partsDelta can relax MAX_PARTS_DELTA for long-downtime recovery
  if (prevReceivedAt) {
    gapSeconds = Math.max(0, deviceTime - prevReceivedAt);
  }

  const producedDelta = prevPartsCount != null && partsCount != null
    ? partsDelta(prevPartsCount, partsCount, gapSeconds)
    : 0;

  /* Compared with the last real meter reading, kept in the live state, so a
     dropped read (0) or a misread cannot book the whole meter total as one
     step — see src/lib/energy-step.js. */
  const energyLast = prev?.energy_meter != null
    ? { meter: prev.energy_meter, at: prev.energy_meter_at }
    : null;
  const { delta: energyDelta, last: energyNow } = energyStep(energyLast, energy, deviceTime);

  /* Every alarm active now — a machine can carry several — computed once and
     kept in the live state, so the next message can tell which codes are new
     and which cleared. Transitions travel in the durable journal and commit alongside telemetry. */
  const alarmsNow  = normalized.alarm ? activeAlarms(payload, { alarming: true }) : [];
  const alarmCodes = alarmsNow.map(alarmKey);

  /* The time since the machine's previous accepted reading, credited to the state it
     was in then — written with the telemetry row, in the same transaction. */
  const longGap = gapSeconds > 60;
  const slices = (prev && prev.received_at)
    ? hourlySlices({
        companyId:  machine.company_id,
        machineId:  machine.id,
        prevStatus: prev.machine_status,
        prevMode:   prev.mode,
        from:       Number(prev.received_at),
        to:         longGap ? Number(prev.received_at) + 60 : deviceTime,
        produced:   longGap ? 0 : producedDelta,
        energy:     longGap ? null : energyDelta,
        shifts:     shifts.shiftsOf(machine.company_id)
      })
    : [];
  // The device timestamp has one-second resolution. A distinct reading can
  // advance the counter in that same second: keep the quantity exactly once
  // without inventing elapsed runtime or a second of energy use.
  if (prev && gapSeconds === 0 && producedDelta > 0 && shiftId) {
    slices.push({ company_id: machine.company_id, machine_id: machine.id, shift_id: shiftId,
      hour_start: istHourStart(deviceTime), run: 0, idle: 0, manual: 0,
      produced: producedDelta, energy: 0 });
  }
  const gap = longGap ? {
    company_id: machine.company_id, machine_id: machine.id,
    from: Number(prev.received_at), to: deviceTime,
    unallocated_parts: producedDelta, unallocated_energy: energyDelta,
    reason: 'observations_missing'
  } : null;
  // Counter deltas across an offline gap cannot be assigned to a particular
  // hour/shift. Preserve provenance and raw counters for later reconciliation.

  const livePayload = {
      machine_id:     machine.id,
      plant_id:       machine.plant_id,
      company_id:     machine.company_id,
      shift_id:       shiftId,
      machine_status: normalized.machine_status,
      alarm:          normalized.alarm,
      alarm_codes:    alarmCodes,
      alarm_severities: Object.fromEntries(alarmsNow.map(alarm => [alarmKey(alarm), alarmFields(alarm).severity])),
      mode,
      spindle_load:   payload.spindle_load ?? 0,
      feed_rate:      payload.feed_rate    ?? 0,
      parts_count:    partsCount ?? prevPartsCount,
      cutting_speed:  payload.cutting_speed ?? 0,
      energy,
      energy_meter:    energyNow?.meter ?? null,
      energy_meter_at: energyNow?.at ?? null,
      received_at:    deviceTime,
      fingerprint:    hash,
      unallocated_parts: (prev?.unallocated_parts || 0) + (gap?.unallocated_parts || 0),
      last_gap: gap || prev?.last_gap || null
    };

  /*
   * Everything telemetry_raw can hold.
   *
   * Four of these — program_number, total_run_time, total_cutting_time and
   * run_time — are columns that already existed and were already in the
   * INSERT, but were never passed here, so the buffer wrote NULL for them on
   * every one of the ~450,000 rows a day.
   *
   * Names are accepted in more than one spelling where controllers differ.
   * A field the devices do not send yet costs nothing: it arrives as null
   * today and lands the moment the firmware starts including it.
   */
  const row = {
    plant_id:       machine.plant_id,
    company_id:     machine.company_id,
    machine_id:     machine.id,
    machine_status: normalized.machine_status,
    alarm:          normalized.alarm,
    parts_count:    partsCount,
    spindle_load:   num(payload.spindle_load),
    feed_rate:      num(payload.feed_rate),
    cutting_speed:  num(payload.cutting_speed ?? payload.surface_speed),
    mode,
    energy,
    status:         payload.status ?? null,
    device_time:    deviceTime,
    received_at:    receivedAt,

    // running program on the controller — lets the app warn before a
    // transfer overwrites the program an operator is mid-way through
    program_number: int(payload.program_number ?? payload.program_no ?? payload.o_number),

    // controller lifetime counters, in seconds
    total_run_time:     int(payload.total_run_time     ?? payload.powered_on_time),
    total_cutting_time: int(payload.total_cutting_time ?? payload.cutting_time),
    run_time:           int(payload.run_time),

    // electrical, for the energy dashboard
    voltage: meter.voltage,
    current: meter.current,
    power:   meter.power,

    /* Machine condition — Screen 2's gauges. Each axis is independently
       nullable, because on some controllers only one servo reports a
       temperature and a missing sensor must not read as 0 °C. */
    ...conditionSignals(payload)
  };

  const alarm = alarmTransition({ prev, alarms: alarmsNow, isAlarm: normalized.alarm,
    companyId: machine.company_id, machineId: machine.id, shiftId, deviceTime, receivedAt });
  const reading = meterReading(payload);
  const meterDue = reading && (!prev?.meter_recorded_at || deviceTime - prev.meter_recorded_at >= 15);
  livePayload.meter_recorded_at = meterDue ? deviceTime : (prev?.meter_recorded_at ?? null);
  await admit({ r: row, h: slices, state: livePayload,
    ...(gap ? { gap } : {}),
    ...(alarm ? { a: alarm } : {}),
    ...(meterDue ? { m: { machineId: machine.id, companyId: machine.company_id, at: deviceTime, reading } } : {}) });
  states.set(machine.id, livePayload);
  remember(machine.id, hash);
  count('accepted');
  if (gap) count('unallocated_parts', producedDelta);
  recordMessage(`${machine.company_id}-${machine.id}-${machine.machine_serial_no}`, payload);
  await publishLive(machine, livePayload, lastKey, liveKey);


  /* The controller's own identity describes the machine, not the moment,
     so it is written to `machines` rather than to 450,000 rows a day.
     Rate-limited and bounded: only one intake callback is active, so
     a database outage cannot accumulate unlimited identity-write promises. */
  const identity = controllerIdentity(payload);
  const focas    = focasResult(payload);
  if (identity || focas) {
    await recordControllerIdentity(machine.id, identity, focas).catch(err =>
      log('error', 'controller identity write failed',
        { machine_id: machine.id, error: err.message }));
  }

}

  return { handleMessage, stats: () => ({ machines: states.size, dedup_entries: accepted.size }),
    state: machineId => states.get(machineId) };
}
