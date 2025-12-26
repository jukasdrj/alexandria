-- ============================================================================
-- Migration 003: Add Wikidata Columns & Seed Wikidata IDs for Author Enrichment
-- ============================================================================
-- Purpose:
--   Phase 1: Add missing columns for Wikidata diversity data
--   Phase 2: Seed wikidata_id from OpenLibrary remote_ids
--
-- Deploy to Unraid PostgreSQL:
--   scp migrations/003_seed_wikidata_author_enrichment.sql root@Tower.local:/tmp/
--   ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/003_seed_wikidata_author_enrichment.sql"
--
-- Expected Results:
--   - ~174,000 authors will have wikidata_id populated
--   - Wikidata enrichment endpoint can then fetch diversity data
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1A: Add Wikidata diversity columns to enriched_authors
-- ============================================================================

-- Q-ID columns for stable Wikidata references
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS gender_qid TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS citizenship_qid TEXT;

-- Birth/death place information
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_place TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_place_qid TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_country TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_country_qid TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS death_place TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS death_place_qid TEXT;

-- Enrichment tracking
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikidata_enriched_at TIMESTAMPTZ;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS enrichment_source TEXT;

-- Extended fields (Phase 3+)
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS occupations TEXT[];
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS languages TEXT[];
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS awards TEXT[];
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS literary_movements TEXT[];

-- ============================================================================
-- PHASE 1B: Add indexes for enrichment queries
-- ============================================================================

-- Index for finding authors with wikidata_id but not yet enriched
CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_pending
ON enriched_authors (author_key)
WHERE wikidata_id IS NOT NULL AND wikidata_enriched_at IS NULL;

-- Index for finding authors by wikidata_id (for deduplication)
CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_id
ON enriched_authors (wikidata_id)
WHERE wikidata_id IS NOT NULL;

-- Index for sync tracking
CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_sync
ON enriched_authors (wikidata_enriched_at DESC)
WHERE wikidata_id IS NOT NULL;

-- Index for diversity field queries
CREATE INDEX IF NOT EXISTS idx_enriched_authors_has_gender
ON enriched_authors (author_key)
WHERE gender IS NOT NULL AND gender != 'Unknown';

-- ============================================================================
-- PHASE 2: Seed wikidata_id from OpenLibrary authors.data->'remote_ids'
-- ============================================================================

-- First, ensure enriched_authors is populated from OpenLibrary authors
-- (Insert any authors from OL that don't exist yet in enriched_authors)
INSERT INTO enriched_authors (author_key, name, openlibrary_author_id)
SELECT
    a.key as author_key,
    a.data->>'name' as name,
    a.key as openlibrary_author_id
FROM authors a
WHERE a.data->>'name' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM enriched_authors ea WHERE ea.author_key = a.key
  )
ON CONFLICT (author_key) DO NOTHING;

-- Report how many authors we're seeding
SELECT 'Authors with wikidata_id in remote_ids: ' || COUNT(*)::text as status
FROM authors a
WHERE a.data->'remote_ids'->>'wikidata' IS NOT NULL;

-- Now seed wikidata_id from OpenLibrary remote_ids
UPDATE enriched_authors ea
SET
    wikidata_id = a.data->'remote_ids'->>'wikidata',
    updated_at = NOW()
FROM authors a
WHERE ea.author_key = a.key
  AND a.data->'remote_ids'->>'wikidata' IS NOT NULL
  AND ea.wikidata_id IS NULL;

-- Report results
SELECT 'Wikidata IDs seeded: ' || COUNT(*)::text as status
FROM enriched_authors
WHERE wikidata_id IS NOT NULL;

-- Also seed birth_year from OpenLibrary if available
UPDATE enriched_authors ea
SET
    birth_year = CASE
        WHEN a.data->>'birth_date' ~ '^\d{4}'
        THEN SUBSTRING(a.data->>'birth_date' FROM '^\d{4}')::INTEGER
        ELSE NULL
    END,
    updated_at = NOW()
FROM authors a
WHERE ea.author_key = a.key
  AND ea.birth_year IS NULL
  AND a.data->>'birth_date' IS NOT NULL
  AND a.data->>'birth_date' ~ '^\d{4}';

-- Seed bio from OpenLibrary if available
UPDATE enriched_authors ea
SET
    bio = CASE
        WHEN jsonb_typeof(a.data->'bio') = 'string' THEN a.data->>'bio'
        WHEN jsonb_typeof(a.data->'bio') = 'object' THEN a.data->'bio'->>'value'
        ELSE NULL
    END,
    bio_source = 'openlibrary',
    updated_at = NOW()
FROM authors a
WHERE ea.author_key = a.key
  AND ea.bio IS NULL
  AND a.data->'bio' IS NOT NULL;

-- ============================================================================
-- SUMMARY STATISTICS
-- ============================================================================

SELECT 'Phase 1 & 2 Complete!' as status;

SELECT
    'Total enriched_authors: ' || COUNT(*)::text as stat
FROM enriched_authors
UNION ALL
SELECT
    'With wikidata_id: ' || COUNT(*)::text
FROM enriched_authors WHERE wikidata_id IS NOT NULL
UNION ALL
SELECT
    'Pending Wikidata enrichment: ' || COUNT(*)::text
FROM enriched_authors WHERE wikidata_id IS NOT NULL AND wikidata_enriched_at IS NULL
UNION ALL
SELECT
    'With birth_year: ' || COUNT(*)::text
FROM enriched_authors WHERE birth_year IS NOT NULL
UNION ALL
SELECT
    'With bio: ' || COUNT(*)::text
FROM enriched_authors WHERE bio IS NOT NULL;

COMMIT;

-- ============================================================================
-- NEXT STEP: Run Wikidata enrichment via API
-- ============================================================================
-- After running this migration, call the Wikidata enrichment endpoint:
--
-- curl -X POST 'https://alexandria.ooheynerds.com/api/authors/enrich-wikidata' \
--   -H 'Content-Type: application/json' \
--   -d '{"limit": 100}'
--
-- This will fetch gender, nationality, birth/death info from Wikidata
-- for the first 100 authors with wikidata_id.
--
-- For bulk enrichment (run multiple times or increase limit):
--   for i in {1..100}; do
--     curl -X POST 'https://alexandria.ooheynerds.com/api/authors/enrich-wikidata' \
--       -H 'Content-Type: application/json' \
--       -d '{"limit": 1000}'
--     sleep 60  # Rate limit: 1000 authors/minute
--   done
-- ============================================================================
