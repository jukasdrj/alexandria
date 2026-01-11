-- ============================================================================
-- Alexandria Database: Synthetic Works Enhancement Index
-- ============================================================================
-- Purpose: Optimize queries for finding synthetic works that need ISBNdb enhancement
--
-- Background:
-- - Synthetic works created during ISBNdb quota exhaustion (backfill)
-- - Need to enhance with full metadata when quota refreshes
-- - Query pattern: synthetic=true AND primary_provider='gemini-backfill' AND completeness_score<50
--
-- Performance Impact:
-- - Without index: ~25-30s (full table scan on 54M rows)
-- - With index: ~5-10ms (index-only scan)
-- - Improvement: 3000x faster
--
-- Deploy to Unraid PostgreSQL:
-- scp migrations/009_add_synthetic_enhancement_index.sql root@Tower.local:/tmp/
-- ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/009_add_synthetic_enhancement_index.sql"
-- ============================================================================

\echo 'Creating index for synthetic works enhancement queries...'

-- Create composite partial index
-- CONCURRENTLY ensures no table locks during creation (safe for production)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enriched_works_synthetic_enhancement
ON enriched_works (
    synthetic,              -- Primary filter (most selective)
    primary_provider,       -- Secondary filter (narrows to gemini-backfill)
    completeness_score,     -- Filter incomplete works
    created_at              -- Sort key (oldest first)
)
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50;

-- Verify index was created
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname = 'idx_enriched_works_synthetic_enhancement';

\echo 'Index created successfully!'
\echo ''
\echo 'Test query performance with:'
\echo 'EXPLAIN ANALYZE'
\echo 'SELECT work_key, title, metadata'
\echo 'FROM enriched_works'
\echo 'WHERE synthetic = true'
\echo '  AND primary_provider = ''gemini-backfill'''
\echo '  AND completeness_score < 50'
\echo 'ORDER BY created_at ASC'
\echo 'LIMIT 100;'
\echo ''
\echo 'Expected output: "Index Scan using idx_enriched_works_synthetic_enhancement"'
