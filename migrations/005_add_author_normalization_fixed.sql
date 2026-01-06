-- ============================================================================
-- Migration 005: Author Name Normalization & Deduplication (FIXED)
-- ============================================================================
-- Purpose: Add normalized_name column and supporting infrastructure for
--          author deduplication and improved search (Issue #114)
--
-- Deploy to Unraid PostgreSQL:
--   scp migrations/005_add_author_normalization_fixed.sql root@Tower.local:/tmp/
--   ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/005_add_author_normalization_fixed.sql"
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: Add normalized_name column
-- ============================================================================

ALTER TABLE enriched_authors
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

COMMENT ON COLUMN enriched_authors.normalized_name IS
  'Normalized author name for search and deduplication. Lowercase, trimmed, standardized punctuation.';

-- ============================================================================
-- PHASE 2: Create Normalization Function
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_author_name(author_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE  -- Mark as immutable so it can be used in indexes
AS $$
DECLARE
  normalized TEXT;
BEGIN
  -- Handle NULL input
  IF author_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Start with the original name
  normalized := author_name;

  -- 1. Trim leading/trailing whitespace
  normalized := TRIM(normalized);

  -- 2. Convert to lowercase for case-insensitive comparison
  normalized := LOWER(normalized);

  -- 3. Normalize multiple spaces to single space
  normalized := REGEXP_REPLACE(normalized, '\s+', ' ', 'g');

  -- 4. Standardize period spacing: ". " → "."
  -- (e.g., "J. K. Rowling" → "j.k.rowling")
  normalized := REGEXP_REPLACE(normalized, '\.\s+', '.', 'g');

  -- 5. Remove common suffixes that create duplicates
  -- (e.g., "Stephen King, Jr." → "stephen king")
  normalized := REGEXP_REPLACE(normalized, ',?\s+(jr\.?|sr\.?|ii|iii|iv|phd|md|esq\.?)$', '', 'gi');

  -- 6. Normalize apostrophes and quotes
  -- Replace curly quotes with straight quotes
  normalized := REPLACE(normalized, ''', '''');
  normalized := REPLACE(normalized, ''', '''');
  normalized := REPLACE(normalized, '"', '"');
  normalized := REPLACE(normalized, '"', '"');

  -- 7. Handle co-authors by extracting primary author
  -- (e.g., "Stephen King & Owen King" → "stephen king")
  IF normalized LIKE '% & %' OR normalized LIKE '% and %' THEN
    -- Extract first author only (before " & " or " and ")
    normalized := REGEXP_REPLACE(normalized, '\s+(and|&)\s+.*$', '', 'i');
  END IF;

  -- 8. Handle "Various Authors" / "Multiple Authors" / "Collective" uniformly
  IF normalized IN ('various authors', 'multiple authors', 'collective', 'anthology', 'various') THEN
    normalized := 'various authors';
  END IF;

  -- 9. Final trim (in case normalization added whitespace)
  normalized := TRIM(normalized);

  RETURN normalized;
END;
$$;

COMMENT ON FUNCTION normalize_author_name(TEXT) IS
  'Normalizes author names for consistent search and deduplication. Handles case, whitespace, punctuation, co-authors, and common variations.';

-- ============================================================================
-- PHASE 3: Test Normalization Function
-- ============================================================================

DO $$
DECLARE
  test_results TEXT := '';
BEGIN
  -- Test 1: Basic lowercase + trim
  IF normalize_author_name('  Stephen King  ') != 'stephen king' THEN
    RAISE EXCEPTION 'Test 1 failed: Basic lowercase + trim';
  END IF;

  -- Test 2: Period spacing standardization
  IF normalize_author_name('J. K. Rowling') != 'j.k.rowling' THEN
    RAISE EXCEPTION 'Test 2 failed: Period spacing (got: %)', normalize_author_name('J. K. Rowling');
  END IF;

  -- Test 3: Co-author extraction
  IF normalize_author_name('Stephen King & Owen King') != 'stephen king' THEN
    RAISE EXCEPTION 'Test 3 failed: Co-author extraction (got: %)', normalize_author_name('Stephen King & Owen King');
  END IF;

  -- Test 4: Suffix removal
  IF normalize_author_name('Martin Luther King, Jr.') != 'martin luther king' THEN
    RAISE EXCEPTION 'Test 4 failed: Suffix removal (got: %)', normalize_author_name('Martin Luther King, Jr.');
  END IF;

  -- Test 5: Various authors normalization
  IF normalize_author_name('Multiple Authors') != 'various authors' THEN
    RAISE EXCEPTION 'Test 5 failed: Various authors normalization';
  END IF;

  -- Test 6: Multiple spaces
  IF normalize_author_name('Neil   Gaiman') != 'neil gaiman' THEN
    RAISE EXCEPTION 'Test 6 failed: Multiple spaces';
  END IF;

  RAISE NOTICE 'All normalization tests passed!';
END $$;

-- ============================================================================
-- PHASE 4: Backfill normalized_name for existing authors
-- ============================================================================

-- Simple single-pass update (will take 30-60 minutes for 14.7M rows)
UPDATE enriched_authors
SET normalized_name = normalize_author_name(name)
WHERE normalized_name IS NULL;

-- ============================================================================
-- PHASE 5: Add Indexes for normalized_name
-- ============================================================================

-- GIN trigram index for fuzzy search on normalized names
CREATE INDEX IF NOT EXISTS idx_enriched_authors_normalized_name_trgm
  ON enriched_authors USING gin(normalized_name gin_trgm_ops);

-- B-tree index for exact lookups and grouping
CREATE INDEX IF NOT EXISTS idx_enriched_authors_normalized_name
  ON enriched_authors(normalized_name);

-- Unique index to identify duplicate normalized names (for analysis)
CREATE INDEX IF NOT EXISTS idx_enriched_authors_normalized_duplicates
  ON enriched_authors(normalized_name, author_key);

-- ============================================================================
-- PHASE 6: Add Trigger to Auto-Normalize on Insert/Update
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_normalize_author_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Automatically set normalized_name when name is inserted or updated
  NEW.normalized_name := normalize_author_name(NEW.name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_normalize_author_name
  BEFORE INSERT OR UPDATE OF name ON enriched_authors
  FOR EACH ROW
  EXECUTE FUNCTION auto_normalize_author_name();

COMMENT ON TRIGGER trigger_auto_normalize_author_name ON enriched_authors IS
  'Automatically normalizes author name on insert/update to keep normalized_name in sync.';

-- ============================================================================
-- PHASE 7: Statistics & Validation
-- ============================================================================

-- Report on normalization results
SELECT 'Author Normalization Statistics' as report;

SELECT
  'Total authors: ' || COUNT(*)::text as stat
FROM enriched_authors
UNION ALL
SELECT
  'With normalized_name: ' || COUNT(*)::text
FROM enriched_authors
WHERE normalized_name IS NOT NULL
UNION ALL
SELECT
  'Unique normalized names: ' || COUNT(DISTINCT normalized_name)::text
FROM enriched_authors
WHERE normalized_name IS NOT NULL
UNION ALL
SELECT
  'Potential duplicates: ' || COUNT(*)::text
FROM (
  SELECT normalized_name
  FROM enriched_authors
  WHERE normalized_name IS NOT NULL
  GROUP BY normalized_name
  HAVING COUNT(*) > 1
) dupes;

-- Show top duplicate normalized names (for verification) - simplified version
SELECT
  normalized_name,
  COUNT(*) as author_count
FROM enriched_authors
WHERE normalized_name IS NOT NULL
GROUP BY normalized_name
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- ============================================================================
-- PHASE 8: Create Helper View for Deduplicated Authors
-- ============================================================================

-- View that shows canonical author per normalized_name
-- Uses the author with the most books as the canonical version
CREATE OR REPLACE VIEW authors_canonical AS
SELECT DISTINCT ON (normalized_name)
  author_key as canonical_author_key,
  name as canonical_name,
  normalized_name,
  book_count,
  wikidata_id,
  bio,
  birth_year,
  death_year,
  nationality,
  gender
FROM enriched_authors
WHERE normalized_name IS NOT NULL
ORDER BY normalized_name, book_count DESC NULLS LAST, author_key;

COMMENT ON VIEW authors_canonical IS
  'Deduplicated view of authors, showing one canonical author per normalized_name. Selects author with most books as canonical.';

COMMIT;

SELECT 'Migration 005 Complete! Author normalization active.' as status;
