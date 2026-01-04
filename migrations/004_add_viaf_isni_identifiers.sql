-- ============================================================================
-- Migration 004: Add VIAF and ISNI Identifier Columns
-- ============================================================================
-- Purpose:
--   Add VIAF (Virtual International Authority File) and ISNI
--   (International Standard Name Identifier) columns to enriched_authors
--   table to support external authority identifier crosswalking.
--
-- Deploy to Unraid PostgreSQL:
--   scp migrations/004_add_viaf_isni_identifiers.sql root@Tower.local:/tmp/
--   ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/004_add_viaf_isni_identifiers.sql"
--
-- Expected Results:
--   - viaf_id and isni columns added to enriched_authors
--   - Indexes created for efficient lookups
--   - Seed VIAF/ISNI from OpenLibrary remote_ids if available
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: Add VIAF and ISNI columns
-- ============================================================================

ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS viaf_id TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS isni TEXT;

COMMENT ON COLUMN enriched_authors.viaf_id IS 'Virtual International Authority File identifier (numeric, e.g., "97113511")';
COMMENT ON COLUMN enriched_authors.isni IS 'International Standard Name Identifier (16 digits, e.g., "0000 0001 2144 1970")';

-- ============================================================================
-- PHASE 2: Add indexes for identifier lookups
-- ============================================================================

-- Index for VIAF lookups (used by resolve-identifier endpoint)
CREATE INDEX IF NOT EXISTS idx_enriched_authors_viaf_id
ON enriched_authors (viaf_id)
WHERE viaf_id IS NOT NULL;

-- Index for ISNI lookups (used by resolve-identifier endpoint)
CREATE INDEX IF NOT EXISTS idx_enriched_authors_isni
ON enriched_authors (isni)
WHERE isni IS NOT NULL;

-- Composite index for finding authors with external identifiers
CREATE INDEX IF NOT EXISTS idx_enriched_authors_external_ids
ON enriched_authors (author_key)
WHERE viaf_id IS NOT NULL OR isni IS NOT NULL;

-- ============================================================================
-- PHASE 3: Seed VIAF and ISNI from OpenLibrary remote_ids
-- ============================================================================

-- Seed VIAF from OpenLibrary authors.data->'remote_ids'->>'viaf'
UPDATE enriched_authors ea
SET
    viaf_id = a.data->'remote_ids'->>'viaf',
    updated_at = NOW()
FROM authors a
WHERE ea.author_key = a.key
  AND a.data->'remote_ids'->>'viaf' IS NOT NULL
  AND ea.viaf_id IS NULL;

-- Report VIAF seeding results
SELECT 'VIAF IDs seeded: ' || COUNT(*)::text as status
FROM enriched_authors
WHERE viaf_id IS NOT NULL;

-- Seed ISNI from OpenLibrary authors.data->'remote_ids'->>'isni'
UPDATE enriched_authors ea
SET
    isni = a.data->'remote_ids'->>'isni',
    updated_at = NOW()
FROM authors a
WHERE ea.author_key = a.key
  AND a.data->'remote_ids'->>'isni' IS NOT NULL
  AND ea.isni IS NULL;

-- Report ISNI seeding results
SELECT 'ISNI IDs seeded: ' || COUNT(*)::text as status
FROM enriched_authors
WHERE isni IS NOT NULL;

-- ============================================================================
-- SUMMARY STATISTICS
-- ============================================================================

SELECT 'Migration 004 Complete!' as status;

SELECT
    'Total enriched_authors: ' || COUNT(*)::text as stat
FROM enriched_authors
UNION ALL
SELECT
    'With VIAF ID: ' || COUNT(*)::text
FROM enriched_authors WHERE viaf_id IS NOT NULL
UNION ALL
SELECT
    'With ISNI: ' || COUNT(*)::text
FROM enriched_authors WHERE isni IS NOT NULL
UNION ALL
SELECT
    'With Wikidata ID: ' || COUNT(*)::text
FROM enriched_authors WHERE wikidata_id IS NOT NULL
UNION ALL
SELECT
    'With any external ID: ' || COUNT(*)::text
FROM enriched_authors
WHERE viaf_id IS NOT NULL OR isni IS NOT NULL OR wikidata_id IS NOT NULL;

COMMIT;

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================
-- After running this migration, you can:
--
-- 1. Resolve VIAF to Wikidata:
--    curl -X POST 'https://alexandria.ooheynerds.com/api/authors/resolve-identifier' \
--      -H 'Content-Type: application/json' \
--      -d '{"type": "viaf", "id": "97113511"}'
--
-- 2. Resolve ISNI to Wikidata:
--    curl -X POST 'https://alexandria.ooheynerds.com/api/authors/resolve-identifier' \
--      -H 'Content-Type: application/json' \
--      -d '{"type": "isni", "id": "0000 0001 2144 1970"}'
--
-- 3. Find authors with VIAF IDs:
--    SELECT author_key, name, viaf_id, wikidata_id
--    FROM enriched_authors
--    WHERE viaf_id IS NOT NULL
--    LIMIT 10;
--
-- 4. Find authors with ISNI but no Wikidata ID (candidates for enrichment):
--    SELECT author_key, name, isni
--    FROM enriched_authors
--    WHERE isni IS NOT NULL AND wikidata_id IS NULL
--    LIMIT 100;
-- ============================================================================
