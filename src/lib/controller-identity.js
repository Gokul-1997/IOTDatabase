/*
 * Write the controller's identity to its machine row.
 *
 * Constant per machine, so it is written only when it changes and at most
 * once an hour per machine — without both guards this is an UPDATE per
 * message per machine.
 *
 * It is bookkeeping, not telemetry. If the ingestion database user is not
 * allowed to UPDATE machines (SQLSTATE 42501, seen on the production server
 * on 2026-09-15), identity writes are switched off for the life of the
 * process and the fix is logged once, instead of an error line per machine
 * per hour with no instruction attached.
 */

const GRANT_HINT =
  'GRANT UPDATE (controller_ip, cnc_series, cnc_version, cnc_type, cnc_machine_type, ' +
  'controlled_axes, focas_result, controller_seen_at) ON machines TO <ingestion db user>;';

export function createIdentityWriter({ pool, log, now = () => Date.now() }) {
  const seen = new Map();
  let disabled = false;

  return async function recordControllerIdentity(machineId, identity, focas) {
    if (disabled) return;

    const fingerprint = JSON.stringify([identity, focas]);
    const last = seen.get(machineId);
    if (last && last.fingerprint === fingerprint && now() - last.at < 3_600_000) return;
    /* Marked before the write: a failing write is still retried at most once
       an hour per machine, not every second. */
    seen.set(machineId, { fingerprint, at: now() });

    const id = identity || {};
    try {
      await pool.query(
        `UPDATE machines
            SET controller_ip      = COALESCE($2, controller_ip),
                cnc_series         = COALESCE($3, cnc_series),
                cnc_version        = COALESCE($4, cnc_version),
                cnc_type           = COALESCE($5, cnc_type),
                cnc_machine_type   = COALESCE($6, cnc_machine_type),
                controlled_axes    = COALESCE($7, controlled_axes),
                focas_result       = COALESCE($8::jsonb, focas_result),
                controller_seen_at = NOW()
          WHERE id = $1`,
        [machineId, id.controller_ip ?? null, id.cnc_series ?? null, id.cnc_version ?? null,
         id.cnc_type ?? null, id.cnc_machine_type ?? null, id.controlled_axes ?? null,
         focas ? JSON.stringify(focas) : null]
      );
    } catch (err) {
      if (err && err.code === '42501') {
        disabled = true;
        log('error', 'controller identity writes disabled — the ingestion database user may not UPDATE ' +
          'machines. Telemetry and alarms are unaffected. To enable: ' + GRANT_HINT, { error: err.message });
        return;
      }
      throw err;
    }
  };
}
