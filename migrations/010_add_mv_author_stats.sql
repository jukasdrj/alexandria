-- Migration: Add materialized view for author statistics
-- Created: 2026-01-12
-- Issue: #161 - Database Performance: ANALYZE Statistics Fix & Query Optimization
-- Performance: 49s → 2.8ms (17,500x speedup)

-- =========================================================================
-- Materialized View: mv_author_stats
-- =========================================================================
--
-- Purpose: Pre-computes work counts for all authors to avoid expensive
-- JOIN operations on 14.7M authors × 24.5M work_authors_enriched rows.
--
-- Performance Impact:
-- - Query time: 49,000ms → 2.8ms (17,500x faster)
-- - Rows scanned: 24.5M → 10
-- - Buffers used: 23.5M → 13
-- - Storage: 2.4GB (1.1GB table + 1.2GB indexes)
--
-- Maintenance:
-- - Daily refresh: 2 AM (CONCURRENTLY - zero downtime)
-- - Refresh time: ~30-60 seconds
-- - Maximum staleness: 24 hours (acceptable for discovery)
--
-- =========================================================================

-- Create materialized view
CREATE MATERIALIZED VIEW mv_author_stats AS
SELECT
  a.key as author_key,
  a.data->>'name' as name,
  COUNT(DISTINCT wae.work_key) as work_count
FROM authors a
LEFT JOIN work_authors_enriched wae ON a.key = wae.author_key
GROUP BY a.key, a.data->>'name';

-- Create indexes
-- Primary key (required for CONCURRENT refresh)
CREATE UNIQUE INDEX idx_mv_author_stats_pk ON mv_author_stats(author_key);

-- Work count index (for "top authors" queries)
CREATE INDEX idx_mv_author_stats_work_count ON mv_author_stats(work_count DESC);

-- Name index (for name lookups)
CREATE INDEX idx_mv_author_stats_name ON mv_author_stats(name);

-- Initial statistics
ANALYZE mv_author_stats;

-- =========================================================================
-- Usage Example: Top 10 Authors by Work Count
-- =========================================================================
--
-- Old way (49 seconds):
-- SELECT a.key, a.data->>'name' as name, COUNT(DISTINCT wae.work_key) as work_count
-- FROM authors a
-- JOIN work_authors_enriched wae ON a.key = wae.author_key
-- GROUP BY a.key, a.data->>'name'
-- ORDER BY work_count DESC
-- LIMIT 10;
--
-- New way (2.8ms):
-- SELECT author_key, name, work_count
-- FROM mv_author_stats
-- ORDER BY work_count DESC
-- LIMIT 10;
--
-- =========================================================================

-- =========================================================================
-- Automated Maintenance (Configure via crontab)
-- =========================================================================
--
-- Daily refresh at 2 AM:
-- 0 2 * * * docker exec postgres psql -U openlibrary -d openlibrary -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_author_stats;" >> /var/log/alexandria-refresh.log 2>&1
--
-- Weekly ANALYZE at 3 AM Sunday:
-- 0 3 * * 0 docker exec postgres psql -U openlibrary -d openlibrary -c "ANALYZE;" >> /var/log/alexandria-analyze.log 2>&1
--
-- =========================================================================

-- =========================================================================
-- Rollback (if needed)
-- =========================================================================
-- DROP MATERIALIZED VIEW IF EXISTS mv_author_stats CASCADE;
-- =========================================================================
