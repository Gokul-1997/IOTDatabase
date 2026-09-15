/*
 * Refuse to ingest into a table that cannot hold what we write.
 *
 * buffer.js writes every column in TELEMETRY_COLUMNS on every flush. If this
 * service is deployed before the migration that adds a column (021 added the
 * machine condition signals), every INSERT fails with "column does not
 * exist". The buffer requeues the failed batch, so nothing is written at
 * all; once it holds 50,000 rows it starts dropping the oldest — and those
 * messages are gone, because the broker already considers them delivered.
 *
 * Exiting at startup is the safer failure. The service does not subscribe,
 * the broker's persistent session (clean: false, QoS 1) keeps the messages,
 * and they replay once the migration is applied and the service restarts.
 */

/**
 * Columns in `columns` that telemetry_raw does not have.
 *
 * Scoped to the search path, so a same-named table in another schema cannot
 * satisfy the check — and TimescaleDB's chunk tables, which live in
 * _timescaledb_internal under different names, never match.
 */
export async function missingTelemetryColumns(pool, columns) {
  const { rows } = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'telemetry_raw'
        AND table_schema = ANY (current_schemas(false))`
  );
  const have = new Set(rows.map(r => r.column_name));
  return columns.filter(c => !have.has(c));
}
