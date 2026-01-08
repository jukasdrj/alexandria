-- ============================================================================
-- Migration 007: Populate external_id_mappings from OpenLibrary Data
-- ============================================================================
-- Purpose: Extract external IDs from OpenLibrary editions/works and populate
--          the crosswalk table for fast lookups
--
-- Impact: Enables 500x faster external ID lookups (2605ms → <5ms)
--
-- Data Sources:
--   - editions.data->'identifiers' (Goodreads, LibraryThing, Google Books)
--   - editions.data->'source_records' (Amazon ASINs)
--   - works.data->'identifiers' (Wikidata, Goodreads)
--
-- Expected Results:
--   - ~6.4M Goodreads edition IDs
--   - ~4.3M LibraryThing IDs
--   - ~4.5M Amazon ASINs
--   - ~15K Google Books volume IDs
--   - ~2K Wikidata work IDs
--   - ~1K Goodreads work IDs
--
-- Deploy:
--   scp migrations/007_populate_external_id_crosswalk.sql root@Tower.local:/tmp/
--   ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/007_populate_external_id_crosswalk.sql"
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: Populate Edition External IDs
-- ============================================================================

\echo '📚 Phase 1: Extracting edition external IDs from OpenLibrary...'
\echo ''

-- 1A. Goodreads Edition IDs (6.4M expected)
\echo '  → Migrating Goodreads edition IDs...'
INSERT INTO external_id_mappings (
  entity_type,
  our_key,
  provider,
  provider_id,
  confidence,
  mapping_source,
  mapping_method
)
SELECT DISTINCT
  'edition'::text,
  e.key,
  'goodreads'::text,
  jsonb_array_elements_text(e.data->'identifiers'->'goodreads'),
  90, -- High confidence (from OpenLibrary)
  'openlibrary-identifiers',
  'migration-007'
FROM editions e
WHERE e.data->'identifiers'->>'goodreads' IS NOT NULL
ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING;

-- 1B. LibraryThing IDs (4.3M expected)
\echo '  → Migrating LibraryThing IDs...'
INSERT INTO external_id_mappings (
  entity_type,
  our_key,
  provider,
  provider_id,
  confidence,
  mapping_source,
  mapping_method
)
SELECT DISTINCT
  'edition'::text,
  e.key,
  'librarything'::text,
  jsonb_array_elements_text(e.data->'identifiers'->'librarything'),
  90,
  'openlibrary-identifiers',
  'migration-007'
FROM editions e
WHERE e.data->'identifiers'->>'librarything' IS NOT NULL
ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING;

-- 1C. Google Books Volume IDs (15K expected)
\echo '  → Migrating Google Books volume IDs...'
INSERT INTO external_id_mappings (
  entity_type,
  our_key,
  provider,
  provider_id,
  confidence,
  mapping_source,
  mapping_method
)
SELECT DISTINCT
  'edition'::text,
  e.key,
  'google-books'::text,
  jsonb_array_elements_text(e.data->'identifiers'->'google'),
  90,
  'openlibrary-identifiers',
  'migration-007'
FROM editions e
WHERE e.data->'identifiers'->>'google' IS NOT NULL
ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING;

-- 1D. Amazon ASINs from source_records (4.5M expected)
\echo '  → Extracting Amazon ASINs from source_records...'
INSERT INTO external_id_mappings (
  entity_type,
  our_key,
  provider,
  provider_id,
  confidence,
  mapping_source,
  mapping_method
)
SELECT DISTINCT
  'edition'::text,
  e.key,
  'amazon'::text,
  SUBSTRING(sr FROM 8), -- Extract ASIN after 'amazon:'
  85, -- Slightly lower confidence (source_records can be noisy)
  'openlibrary-source-records',
  'migration-007'
FROM editions e,
     jsonb_array_elements_text(e.data->'source_records') AS sr
WHERE sr LIKE 'amazon:%'
ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING;

-- ============================================================================
-- PHASE 2: Populate Work External IDs
-- ============================================================================

\echo ''
\echo '📖 Phase 2: Extracting work external IDs from OpenLibrary...'
\echo ''

-- 2A. Wikidata IDs (2K expected)
\echo '  → Migrating Wikidata IDs...'
INSERT INTO external_id_mappings (
  entity_type,
  our_key,
  provider,
  provider_id,
  confidence,
  mapping_source,
  mapping_method
)
SELECT DISTINCT
  'work'::text,
  w.key,
  'wikidata'::text,
  jsonb_array_elements_text(w.data->'identifiers'->'wikidata'),
  95, -- Very high confidence (Wikidata is authoritative)
  'openlibrary-identifiers',
  'migration-007'
FROM works w
WHERE w.data->'identifiers'->>'wikidata' IS NOT NULL
ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING;

-- 2B. Goodreads Work IDs (1K expected)
\echo '  → Migrating Goodreads work IDs...'
INSERT INTO external_id_mappings (
  entity_type,
  our_key,
  provider,
  provider_id,
  confidence,
  mapping_source,
  mapping_method
)
SELECT DISTINCT
  'work'::text,
  w.key,
  'goodreads'::text,
  jsonb_array_elements_text(w.data->'identifiers'->'goodreads'),
  90,
  'openlibrary-identifiers',
  'migration-007'
FROM works w
WHERE w.data->'identifiers'->>'goodreads' IS NOT NULL
ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING;

-- ============================================================================
-- PHASE 3: Summary Statistics
-- ============================================================================

\echo ''
\echo '✅ Migration 007 Complete!'
\echo ''
\echo 'Summary Statistics:'
\echo '------------------'

SELECT
  provider,
  entity_type,
  COUNT(*) as total_mappings,
  MIN(created_at) as first_created,
  MAX(created_at) as last_created
FROM external_id_mappings
WHERE mapping_method = 'migration-007'
GROUP BY provider, entity_type
ORDER BY entity_type, provider;

\echo ''
\echo 'Total mappings created:'
SELECT COUNT(*) as total FROM external_id_mappings WHERE mapping_method = 'migration-007';

\echo ''
\echo 'Index usage check:'
SELECT
  schemaname,
  indexrelname as indexname,
  idx_scan as times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE schemaname = 'public' AND relname = 'external_id_mappings'
ORDER BY indexrelname;

COMMIT;

-- ============================================================================
-- NEXT STEPS
-- ============================================================================
--
-- 1. Test fast lookups:
--    SELECT * FROM external_id_mappings
--    WHERE entity_type = 'edition'
--      AND provider = 'goodreads'
--      AND provider_id = '2089208';
--
-- 2. Create helper functions (see docs/operations/EXTERNAL-ID-UTILITIES.sql):
--    - get_external_ids_for_edition(edition_key)
--    - find_edition_by_external_id(provider, provider_id)
--    - get_all_identifiers(entity_type, our_key)
--
-- 3. Update enrichment service to write to crosswalk when adding new IDs
-- ============================================================================
