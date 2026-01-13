-- Migration: Reset Failed Backfill Entries (Constraint Violation Fix)
-- Date: 2026-01-13
-- Issue: backfill_log_check2 constraint violations due to completed_at being set on retries
-- Fix: Reset failed/stuck entries to pending after deploying async-backfill.ts fix

-- Reset failed entries that hit constraint violations
-- These have retry_count = 5 (maxed out) with check constraint errors
UPDATE backfill_log
SET
  status = 'pending',
  retry_count = 0,
  error_message = NULL,
  completed_at = NULL,
  started_at = NULL,
  last_retry_at = NULL
WHERE status = 'failed'
  AND error_message LIKE '%backfill_log_check2%';

-- Reset stuck processing entries (likely orphaned queue messages)
-- These have been processing for > 1 hour without completion
UPDATE backfill_log
SET
  status = 'pending',
  retry_count = 0,
  started_at = NULL,
  completed_at = NULL,
  error_message = NULL
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '1 hour';

-- Verify reset counts
DO $$
DECLARE
  failed_reset_count INTEGER;
  stuck_reset_count INTEGER;
BEGIN
  -- Count resets
  SELECT COUNT(*) INTO failed_reset_count
  FROM backfill_log
  WHERE status = 'pending'
    AND retry_count = 0
    AND started_at IS NULL;

  RAISE NOTICE 'Migration 014: Reset % failed entries and processing entries', failed_reset_count;
END $$;

-- Summary query (run manually to verify)
-- SELECT
--   status,
--   COUNT(*) as count,
--   SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) as with_retries
-- FROM backfill_log
-- GROUP BY status
-- ORDER BY status;
