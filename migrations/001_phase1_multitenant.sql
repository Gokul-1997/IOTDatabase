-- =============================================================
-- Phase 1 migration: denormalize company_id onto hot-path tables
-- Run ONCE, manually, during a short maintenance window.
-- Safe to re-run (uses IF NOT EXISTS / guarded steps).
-- =============================================================

BEGIN;

-- 1. telemetry_raw -------------------------------------------------
ALTER TABLE telemetry_raw
  ADD COLUMN IF NOT EXISTS company_id INT;

-- backfill from machines
UPDATE telemetry_raw t
SET    company_id = m.company_id
FROM   machines m
WHERE  t.machine_id = m.id
  AND  t.company_id IS NULL;

-- NOTE: NOT NULL + FK added AFTER code is deployed that writes the column.
-- Uncomment when you're ready to enforce:
-- ALTER TABLE telemetry_raw
--   ALTER COLUMN company_id SET NOT NULL,
--   ADD CONSTRAINT telemetry_raw_company_fk
--     FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_telemetry_company_time
  ON telemetry_raw (company_id, received_at DESC);

-- 2. production_hourly --------------------------------------------
ALTER TABLE production_hourly
  ADD COLUMN IF NOT EXISTS company_id INT;

UPDATE production_hourly ph
SET    company_id = m.company_id
FROM   machines m
WHERE  ph.machine_id = m.id
  AND  ph.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_production_hourly_company_hour
  ON production_hourly (company_id, hour_start DESC);

-- 3. oee_hourly ---------------------------------------------------
ALTER TABLE oee_hourly
  ADD COLUMN IF NOT EXISTS company_id INT;

UPDATE oee_hourly o
SET    company_id = m.company_id
FROM   machines m
WHERE  o.machine_id = m.id
  AND  o.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_oee_hourly_company_hour
  ON oee_hourly (company_id, hour_start DESC);

-- 4. oee_shift_summary --------------------------------------------
ALTER TABLE oee_shift_summary
  ADD COLUMN IF NOT EXISTS company_id INT;

UPDATE oee_shift_summary o
SET    company_id = m.company_id
FROM   machines m
WHERE  o.machine_id = m.id
  AND  o.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_oee_shift_company_date
  ON oee_shift_summary (company_id, shift_date DESC);

COMMIT;

-- =============================================================
-- Verify:
--   SELECT count(*) FROM telemetry_raw      WHERE company_id IS NULL;
--   SELECT count(*) FROM production_hourly  WHERE company_id IS NULL;
--   SELECT count(*) FROM oee_hourly         WHERE company_id IS NULL;
--   SELECT count(*) FROM oee_shift_summary  WHERE company_id IS NULL;
-- All four should return 0.
-- =============================================================
