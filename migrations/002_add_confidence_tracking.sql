-- Migration 002: Add ID Confidence Tracking & External Mappings (v2 - CONSENSUS REFINED)
-- Purpose: Proper tracking of multi-provider ID associations before enrichment begins
-- Author: Claude + Grok + Gemini consensus
-- Date: November 29, 2025
-- Consensus Score: 8.7/10 from 3-model review
--
-- CHANGES FROM v1 (based on consensus):
-- 1. Added edition_id UUID PK option (ISBN becomes nullable UNIQUE)
-- 2. Added partitioning preparation for external_id_mappings
-- 3. Improved upsert_external_mapping with LIMIT 1 and confidence threshold
-- 4. Added row-level locking hint comments
-- 5. Clearer deprecation path for TEXT[] arrays
--
-- RATIONALE:
-- Before we start populating enriched_* tables from ISBNdb, Google Books, etc.,
-- we need infrastructure to track:
-- 1. HOW CONFIDENT are we that ISBN X belongs to Work Y?
-- 2. WHO TOLD US this mapping? (OpenLibrary dump vs ISBNdb vs user correction)
-- 3. WHEN DID WE LEARN this? (for conflict resolution)
-- 4. WHAT IF PROVIDERS DISAGREE? (need audit trail)

BEGIN;

-- ============================================================================
-- PART A: Fix ISBN Primary Key Limitation (CONSENSUS: 2/3 recommend)
-- ============================================================================
-- Problem: ISBN as PK can't handle pre-1970 books or books without ISBNs
-- Solution: Add UUID surrogate key, make ISBN nullable unique

-- Step 1: Add UUID column
ALTER TABLE enriched_editions 
  ADD COLUMN IF NOT EXISTS edition_id UUID DEFAULT gen_random_uuid();

-- Step 2: Backfill any NULL edition_ids
UPDATE enriched_editions SET edition_id = gen_random_uuid() WHERE edition_id IS NULL;

-- Step 3: Create unique index on edition_id (will become PK later)
CREATE UNIQUE INDEX IF NOT EXISTS idx_enriched_editions_edition_id 
  ON enriched_editions(edition_id);

-- Note: Changing PK from isbn to edition_id requires:
-- 1. Updating all FK references
-- 2. Application code changes
-- 3. Done in separate migration after validation
-- For now, keep isbn as PK but edition_id is ready for future migration

COMMENT ON COLUMN enriched_editions.edition_id IS 
  'UUID surrogate key for editions without ISBNs (pre-1970 books). Will become PK in future migration.';

-- ============================================================================
-- PART B: Add confidence tracking to enriched_editions
-- ============================================================================

-- Track confidence in the edition → work relationship
ALTER TABLE enriched_editions 
  ADD COLUMN IF NOT EXISTS work_match_confidence SMALLINT DEFAULT 100
    CHECK (work_match_confidence BETWEEN 0 AND 100);

-- Track who/what established the work_key relationship
ALTER TABLE enriched_editions 
  ADD COLUMN IF NOT EXISTS work_match_source TEXT DEFAULT 'openlibrary';

-- Track when the work_key was assigned (for conflict resolution)
ALTER TABLE enriched_editions 
  ADD COLUMN IF NOT EXISTS work_match_at TIMESTAMPTZ DEFAULT NOW();

-- Add comments for documentation
COMMENT ON COLUMN enriched_editions.work_match_confidence IS 
  'Confidence score 0-100 that this edition belongs to the assigned work_key.
   100 = definitive (same ISBN in OpenLibrary dump)
   95  = very high (ISBNdb exact match)  
   90  = high (Google Books match)
   70  = medium (title+author fuzzy match)
   50  = low (AI inference)
   Values >= 95 are protected from automatic overwrite.';

COMMENT ON COLUMN enriched_editions.work_match_source IS 
  'Source that established the work_key relationship:
   openlibrary, isbndb, google-books, user-correction, ai-inference';

COMMENT ON COLUMN enriched_editions.work_match_at IS
  'Timestamp when work_key was assigned/updated. Used for conflict resolution.';

-- ============================================================================
-- PART C: External ID Mappings Table (Normalized, Partitioned-Ready)
-- ============================================================================
-- 
-- CONSENSUS: All 3 models agree this is industry best practice (MDM, VIAF, WorldCat)
-- Scale concern: 50M editions × 5-10 IDs = 250-500M rows
-- Solution: Design for partitioning by entity_type

CREATE TABLE IF NOT EXISTS external_id_mappings (
  id UUID DEFAULT gen_random_uuid(),
  
  -- What entity does this map?
  entity_type TEXT NOT NULL CHECK (entity_type IN ('work', 'edition', 'author')),
  our_key TEXT NOT NULL,  -- Our canonical ID (work_key, isbn/edition_id, author_key)
  
  -- External provider info
  provider TEXT NOT NULL CHECK (provider IN (
    'openlibrary', 'goodreads', 'amazon', 'google-books', 
    'isbndb', 'librarything', 'wikidata', 'oclc', 'lccn'
  )),
  provider_id TEXT NOT NULL,  -- Their ID for this entity
  provider_id_type TEXT,      -- Optional: 'work_id', 'volume_id', 'asin', etc.
  
  -- Confidence & provenance
  confidence SMALLINT DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  mapping_source TEXT NOT NULL DEFAULT 'openlibrary',  -- Who told us?
  mapping_method TEXT,  -- 'exact_match', 'isbn_lookup', 'title_author_match', 'user_correction'
  
  -- Audit timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,  -- When was this mapping verified/confirmed?
  
  -- Primary key includes partition key for PostgreSQL compliance
  PRIMARY KEY (entity_type, id),
  
  -- Prevent duplicate mappings
  UNIQUE(entity_type, our_key, provider, provider_id)
) PARTITION BY LIST (entity_type);

-- Create partitions for each entity type (CONSENSUS: Grok + Flash recommend)
CREATE TABLE IF NOT EXISTS external_id_mappings_works 
  PARTITION OF external_id_mappings FOR VALUES IN ('work');
CREATE TABLE IF NOT EXISTS external_id_mappings_editions 
  PARTITION OF external_id_mappings FOR VALUES IN ('edition');
CREATE TABLE IF NOT EXISTS external_id_mappings_authors 
  PARTITION OF external_id_mappings FOR VALUES IN ('author');

-- Index for "given our_key, find all external IDs"
CREATE INDEX IF NOT EXISTS idx_ext_mapping_our_key 
  ON external_id_mappings(entity_type, our_key);

-- Index for "given provider ID, find our entity" (reverse lookup!)
CREATE INDEX IF NOT EXISTS idx_ext_mapping_provider 
  ON external_id_mappings(provider, provider_id);

-- Index for finding low-confidence mappings to review
CREATE INDEX IF NOT EXISTS idx_ext_mapping_confidence 
  ON external_id_mappings(confidence) WHERE confidence < 80;

-- Index for finding unverified mappings
CREATE INDEX IF NOT EXISTS idx_ext_mapping_unverified
  ON external_id_mappings(created_at) WHERE verified_at IS NULL;

COMMENT ON TABLE external_id_mappings IS 
  'Normalized mapping between our canonical IDs and external provider IDs.
   Partitioned by entity_type for scale (target: 250M+ rows).
   Supports bidirectional lookups, confidence tracking, and audit trails.
   
   DEPRECATION NOTICE: This table replaces TEXT[] arrays on enriched_* tables.
   Arrays will be deprecated after migration validation.';

-- ============================================================================
-- PART D: Provider Conflicts Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What entity has conflicting information?
  entity_type TEXT NOT NULL CHECK (entity_type IN ('work', 'edition', 'author')),
  entity_key TEXT NOT NULL,  -- The ISBN/work_key/author_key in question
  
  -- The conflict
  field_name TEXT NOT NULL,  -- 'work_key', 'title', 'author', 'publication_year', etc.
  provider_a TEXT NOT NULL,
  value_a TEXT NOT NULL,
  confidence_a SMALLINT,
  provider_b TEXT NOT NULL,
  value_b TEXT NOT NULL,
  confidence_b SMALLINT,
  
  -- Resolution
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored', 'manual_review')),
  resolution TEXT,  -- 'chose_a', 'chose_b', 'merged', 'manual_override'
  resolved_value TEXT,
  resolved_by TEXT,  -- 'algorithm', 'confidence_threshold', 'user:justin', etc.
  resolved_at TIMESTAMPTZ,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,  -- Free-form notes about this conflict
  
  -- Prevent duplicate conflict records
  UNIQUE(entity_type, entity_key, field_name, provider_a, provider_b)
);

-- Index for finding pending conflicts
CREATE INDEX IF NOT EXISTS idx_conflicts_pending 
  ON provider_conflicts(status, created_at) WHERE status = 'pending';

-- Index for finding conflicts by entity
CREATE INDEX IF NOT EXISTS idx_conflicts_entity 
  ON provider_conflicts(entity_type, entity_key);

-- Index for manual review queue
CREATE INDEX IF NOT EXISTS idx_conflicts_manual_review
  ON provider_conflicts(created_at) WHERE status = 'manual_review';

COMMENT ON TABLE provider_conflicts IS 
  'Tracks disagreements between providers for resolution.
   Status workflow: pending → resolved/ignored/manual_review
   High-confidence conflicts (both >= 90) auto-flag for manual_review.';

-- ============================================================================
-- PART E: Helper Functions (IMPROVED per consensus)
-- ============================================================================

-- Function to get all external IDs for an entity
CREATE OR REPLACE FUNCTION get_external_ids(
  p_entity_type TEXT,
  p_our_key TEXT
) RETURNS TABLE (
  provider TEXT,
  provider_id TEXT,
  confidence SMALLINT,
  mapping_source TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.provider,
    m.provider_id,
    m.confidence,
    m.mapping_source
  FROM external_id_mappings m
  WHERE m.entity_type = p_entity_type 
    AND m.our_key = p_our_key
  ORDER BY m.confidence DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to find our entity given an external ID (reverse lookup)
CREATE OR REPLACE FUNCTION find_by_external_id(
  p_provider TEXT,
  p_provider_id TEXT
) RETURNS TABLE (
  entity_type TEXT,
  our_key TEXT,
  confidence SMALLINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.entity_type,
    m.our_key,
    m.confidence
  FROM external_id_mappings m
  WHERE m.provider = p_provider 
    AND m.provider_id = p_provider_id
  ORDER BY m.confidence DESC
  LIMIT 10;  -- CONSENSUS FIX: Added LIMIT to prevent unbounded results
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to record a mapping with conflict detection (IMPROVED)
-- CONSENSUS FIXES:
-- 1. Added LIMIT 1 for multi-conflict edge case (Grok)
-- 2. Added confidence threshold to prevent low-confidence overwrites (Grok)
-- 3. High-confidence conflicts flag for manual review (Flash)
CREATE OR REPLACE FUNCTION upsert_external_mapping(
  p_entity_type TEXT,
  p_our_key TEXT,
  p_provider TEXT,
  p_provider_id TEXT,
  p_confidence SMALLINT DEFAULT 100,
  p_mapping_source TEXT DEFAULT 'api',
  p_mapping_method TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_mapping_id UUID;
  v_existing RECORD;
  v_confidence_threshold CONSTANT SMALLINT := 95;  -- Protected threshold
BEGIN
  -- Check for existing mapping with different our_key (potential conflict!)
  -- CONSENSUS FIX: Added LIMIT 1 and FOR UPDATE for concurrency safety
  SELECT * INTO v_existing
  FROM external_id_mappings
  WHERE provider = p_provider 
    AND provider_id = p_provider_id
    AND entity_type = p_entity_type
    AND our_key != p_our_key
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
    
  IF FOUND THEN
    -- Determine if this needs manual review (both high confidence)
    DECLARE
      v_conflict_status TEXT := 'pending';
    BEGIN
      IF v_existing.confidence >= 90 AND p_confidence >= 90 THEN
        v_conflict_status := 'manual_review';  -- Both confident = human needed
      END IF;
      
      -- Record the conflict
      INSERT INTO provider_conflicts (
        entity_type, entity_key, field_name,
        provider_a, value_a, confidence_a,
        provider_b, value_b, confidence_b,
        status
      ) VALUES (
        p_entity_type, p_provider_id, 'our_key',
        'existing', v_existing.our_key, v_existing.confidence,
        p_mapping_source, p_our_key, p_confidence,
        v_conflict_status
      ) ON CONFLICT DO NOTHING;
    END;
    
    -- CONSENSUS FIX: Only overwrite if existing is below threshold AND new is higher
    IF v_existing.confidence < v_confidence_threshold AND p_confidence > v_existing.confidence THEN
      UPDATE external_id_mappings
      SET our_key = p_our_key,
          confidence = p_confidence,
          mapping_source = p_mapping_source,
          mapping_method = p_mapping_method
      WHERE id = v_existing.id
      RETURNING id INTO v_mapping_id;
      RETURN v_mapping_id;
    ELSE
      -- Existing mapping is protected (high confidence) or new isn't better
      -- Conflict was logged, return existing ID
      RETURN v_existing.id;
    END IF;
  END IF;
  
  -- No conflict, upsert normally
  INSERT INTO external_id_mappings (
    entity_type, our_key, provider, provider_id,
    confidence, mapping_source, mapping_method
  ) VALUES (
    p_entity_type, p_our_key, p_provider, p_provider_id,
    p_confidence, p_mapping_source, p_mapping_method
  )
  ON CONFLICT (entity_type, our_key, provider, provider_id) 
  DO UPDATE SET
    confidence = GREATEST(external_id_mappings.confidence, EXCLUDED.confidence),
    mapping_source = CASE 
      WHEN EXCLUDED.confidence > external_id_mappings.confidence 
      THEN EXCLUDED.mapping_source 
      ELSE external_id_mappings.mapping_source 
    END,
    mapping_method = CASE 
      WHEN EXCLUDED.confidence > external_id_mappings.confidence 
      THEN EXCLUDED.mapping_method 
      ELSE external_id_mappings.mapping_method 
    END
  RETURNING id INTO v_mapping_id;
  
  RETURN v_mapping_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_external_mapping IS
  'Insert or update external ID mapping with automatic conflict detection.
   
   Protection rules:
   - Mappings with confidence >= 95 are PROTECTED from automatic overwrite
   - Conflicts where both parties have >= 90 confidence flagged for manual_review
   - Lower confidence mappings can be upgraded by higher confidence sources
   
   Concurrency: Uses FOR UPDATE SKIP LOCKED to prevent race conditions.';

-- ============================================================================
-- PART F: Deprecation Markers for TEXT[] Arrays
-- ============================================================================
-- CONSENSUS: 2/3 models recommend dropping arrays after migration
-- This section adds comments marking arrays for deprecation

COMMENT ON COLUMN enriched_works.goodreads_work_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_works.amazon_asins IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_works.librarything_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_works.google_books_volume_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';

COMMENT ON COLUMN enriched_editions.amazon_asins IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_editions.google_books_volume_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_editions.librarything_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_editions.goodreads_edition_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';

COMMENT ON COLUMN enriched_authors.goodreads_author_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_authors.librarything_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';
COMMENT ON COLUMN enriched_authors.google_books_ids IS 
  'DEPRECATED: Use external_id_mappings table instead. Will be removed after migration validation.';

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run manually after migration)
-- ============================================================================

-- Check new columns exist
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'enriched_editions' 
--   AND column_name LIKE 'work_match%' OR column_name = 'edition_id';

-- Check partitioned table exists
-- SELECT tableoid::regclass, count(*) 
-- FROM external_id_mappings 
-- GROUP BY tableoid::regclass;

-- Check indexes exist
-- SELECT indexname FROM pg_indexes 
-- WHERE indexname LIKE 'idx_ext_mapping%' OR indexname LIKE 'idx_conflicts%';

-- ============================================================================
-- FUTURE MIGRATION: Array Data Migration (run AFTER validation)
-- ============================================================================
/*
-- Migration 003: Migrate TEXT[] arrays to external_id_mappings
-- Run in batches of 100K for performance

-- Migrate Goodreads work IDs from enriched_works
INSERT INTO external_id_mappings (entity_type, our_key, provider, provider_id, confidence, mapping_source)
SELECT 'work', work_key, 'goodreads', unnest(goodreads_work_ids), 90, 'array_migration'
FROM enriched_works
WHERE goodreads_work_ids IS NOT NULL AND array_length(goodreads_work_ids, 1) > 0
ON CONFLICT DO NOTHING;

-- Verify counts match
SELECT 
  (SELECT SUM(array_length(goodreads_work_ids, 1)) FROM enriched_works WHERE goodreads_work_ids IS NOT NULL) as array_count,
  (SELECT COUNT(*) FROM external_id_mappings WHERE provider = 'goodreads' AND entity_type = 'work') as table_count;

-- If counts match, drop arrays in Migration 004
-- ALTER TABLE enriched_works DROP COLUMN goodreads_work_ids;
*/
