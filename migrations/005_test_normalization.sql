-- ============================================================================
-- Test Suite for Author Name Normalization (Migration 005)
-- ============================================================================
-- Purpose: Comprehensive tests for normalize_author_name() function
--
-- Run this AFTER deploying migration 005 to verify correctness:
--   ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/005_test_normalization.sql"
-- ============================================================================

\echo '🧪 Testing Author Name Normalization Function'
\echo ''

-- ============================================================================
-- Test 1: Basic Normalization (lowercase + trim)
-- ============================================================================

\echo 'Test 1: Basic lowercase and trim'
SELECT
  '  Stephen King  ' as original,
  normalize_author_name('  Stephen King  ') as normalized,
  CASE
    WHEN normalize_author_name('  Stephen King  ') = 'stephen king' THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as result;

-- ============================================================================
-- Test 2: Period Spacing Standardization
-- ============================================================================

\echo 'Test 2: Period spacing (J. K. Rowling)'
SELECT
  'J. K. Rowling' as original,
  normalize_author_name('J. K. Rowling') as normalized,
  CASE
    WHEN normalize_author_name('J. K. Rowling') = 'j.k.rowling' THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as result;

\echo 'Test 2b: Period spacing variations'
SELECT
  input as original,
  normalize_author_name(input) as normalized,
  CASE
    WHEN normalize_author_name(input) = expected THEN '✓ PASS'
    ELSE '✗ FAIL: got ' || normalize_author_name(input)
  END as result
FROM (VALUES
  ('J.K. Rowling', 'j.k.rowling'),
  ('J. K. Rowling', 'j.k.rowling'),
  ('J.K.Rowling', 'j.k.rowling'),
  ('J K Rowling', 'j k rowling')
) AS t(input, expected);

-- ============================================================================
-- Test 3: Co-Author Extraction
-- ============================================================================

\echo 'Test 3: Co-author extraction'
SELECT
  input as original,
  normalize_author_name(input) as normalized,
  CASE
    WHEN normalize_author_name(input) = expected THEN '✓ PASS'
    ELSE '✗ FAIL: got ' || normalize_author_name(input)
  END as result
FROM (VALUES
  ('Stephen King & Owen King', 'stephen king'),
  ('Stephen King and Peter Straub', 'stephen king'),
  ('Neil Gaiman & Terry Pratchett', 'neil gaiman'),
  ('Douglas Preston and Lincoln Child', 'douglas preston')
) AS t(input, expected);

-- ============================================================================
-- Test 4: Suffix Removal
-- ============================================================================

\echo 'Test 4: Suffix removal (Jr., Sr., PhD, etc.)'
SELECT
  input as original,
  normalize_author_name(input) as normalized,
  CASE
    WHEN normalize_author_name(input) = expected THEN '✓ PASS'
    ELSE '✗ FAIL: got ' || normalize_author_name(input)
  END as result
FROM (VALUES
  ('Martin Luther King, Jr.', 'martin luther king'),
  ('Martin Luther King Jr.', 'martin luther king'),
  ('John Smith, Sr.', 'john smith'),
  ('Jane Doe, PhD', 'jane doe'),
  ('Robert Jones, MD', 'robert jones'),
  ('William Brown, Esq.', 'william brown'),
  ('Henry Davis II', 'henry davis'),
  ('Henry Davis III', 'henry davis')
) AS t(input, expected);

-- ============================================================================
-- Test 5: Various Authors Normalization
-- ============================================================================

\echo 'Test 5: Various/Multiple/Collective authors'
SELECT
  input as original,
  normalize_author_name(input) as normalized,
  CASE
    WHEN normalize_author_name(input) = 'various authors' THEN '✓ PASS'
    ELSE '✗ FAIL: got ' || normalize_author_name(input)
  END as result
FROM (VALUES
  ('Various Authors'),
  ('Multiple Authors'),
  ('Collective'),
  ('Anthology'),
  ('Various')
) AS t(input);

-- ============================================================================
-- Test 6: Multiple Spaces
-- ============================================================================

\echo 'Test 6: Multiple spaces normalization'
SELECT
  input as original,
  normalize_author_name(input) as normalized,
  CASE
    WHEN normalize_author_name(input) = expected THEN '✓ PASS'
    ELSE '✗ FAIL: got ' || normalize_author_name(input)
  END as result
FROM (VALUES
  ('Neil   Gaiman', 'neil gaiman'),
  ('Isaac  Asimov', 'isaac asimov'),
  ('Brandon    Sanderson', 'brandon sanderson')
) AS t(input, expected);

-- ============================================================================
-- Test 7: Apostrophes and Quotes Normalization
-- ============================================================================

\echo 'Test 7: Apostrophes and quotes'
SELECT
  'O''Brien vs O'Brien' as test_case,
  normalize_author_name('Patrick O''Brien') as straight_quote,
  normalize_author_name('Patrick O'Brien') as curly_quote,
  CASE
    WHEN normalize_author_name('Patrick O''Brien') = normalize_author_name('Patrick O'Brien')
    THEN '✓ PASS: Both normalize to same value'
    ELSE '✗ FAIL: Different values'
  END as result;

-- ============================================================================
-- Test 8: NULL Handling
-- ============================================================================

\echo 'Test 8: NULL handling'
SELECT
  NULL as original,
  normalize_author_name(NULL) as normalized,
  CASE
    WHEN normalize_author_name(NULL) IS NULL THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as result;

-- ============================================================================
-- Test 9: Edge Cases
-- ============================================================================

\echo 'Test 9: Edge cases'
SELECT
  input as original,
  normalize_author_name(input) as normalized,
  CASE
    WHEN normalize_author_name(input) = expected THEN '✓ PASS'
    ELSE '✗ FAIL: got ' || COALESCE(normalize_author_name(input), 'NULL')
  END as result
FROM (VALUES
  ('', ''),  -- Empty string
  ('   ', ''),  -- Only whitespace
  ('a', 'a'),  -- Single character
  ('123', '123'),  -- Numbers only
  ('Dr. Seuss', 'dr.seuss')  -- Period but not initial
) AS t(input, expected);

-- ============================================================================
-- Test 10: Real-World Duplicates
-- ============================================================================

\echo 'Test 10: Real-world duplicate detection'
\echo 'These variations should all normalize to the same value:'

WITH test_variations AS (
  SELECT unnest(ARRAY[
    'Stephen King',
    'STEPHEN KING',
    '  Stephen King  ',
    'Stephen  King'
  ]) as variation
)
SELECT
  variation as original,
  normalize_author_name(variation) as normalized,
  COUNT(*) OVER (PARTITION BY normalize_author_name(variation)) as duplicate_group_size,
  CASE
    WHEN COUNT(*) OVER (PARTITION BY normalize_author_name(variation)) = 4
    THEN '✓ All normalize to same value'
    ELSE '✗ Different normalized values'
  END as result
FROM test_variations;

-- ============================================================================
-- Test 11: Verify Trigger Works
-- ============================================================================

\echo 'Test 11: Verify auto-normalize trigger'

-- Create temp table to test trigger without affecting real data
CREATE TEMP TABLE test_authors (
  author_key TEXT PRIMARY KEY,
  name TEXT,
  normalized_name TEXT
);

-- Copy the trigger to temp table
CREATE TRIGGER test_auto_normalize
  BEFORE INSERT OR UPDATE OF name ON test_authors
  FOR EACH ROW
  EXECUTE FUNCTION auto_normalize_author_name();

-- Test INSERT
INSERT INTO test_authors (author_key, name)
VALUES ('test1', 'J. K. Rowling');

SELECT
  'INSERT test' as test_case,
  name as original,
  normalized_name,
  CASE
    WHEN normalized_name = 'j.k.rowling' THEN '✓ PASS: Trigger fired on INSERT'
    ELSE '✗ FAIL: Trigger did not fire correctly'
  END as result
FROM test_authors
WHERE author_key = 'test1';

-- Test UPDATE
UPDATE test_authors
SET name = 'Stephen King & Owen King'
WHERE author_key = 'test1';

SELECT
  'UPDATE test' as test_case,
  name as original,
  normalized_name,
  CASE
    WHEN normalized_name = 'stephen king' THEN '✓ PASS: Trigger fired on UPDATE'
    ELSE '✗ FAIL: Trigger did not fire correctly'
  END as result
FROM test_authors
WHERE author_key = 'test1';

-- Cleanup
DROP TABLE test_authors;

-- ============================================================================
-- Test 12: Performance Test
-- ============================================================================

\echo 'Test 12: Performance benchmark'
\timing on

-- Test normalization performance on 1000 iterations
DO $$
DECLARE
  i INT;
  result TEXT;
BEGIN
  FOR i IN 1..1000 LOOP
    result := normalize_author_name('J. K. Rowling & Neil Gaiman');
  END LOOP;
END $$;

\timing off

-- ============================================================================
-- Test 13: Verify Indexes Exist
-- ============================================================================

\echo 'Test 13: Verify indexes created'
SELECT
  indexname,
  indexdef,
  CASE
    WHEN indexname IN (
      'idx_enriched_authors_normalized_name_trgm',
      'idx_enriched_authors_normalized_name',
      'idx_enriched_authors_normalized_duplicates'
    ) THEN '✓ Index exists'
    ELSE '✗ Missing index'
  END as result
FROM pg_indexes
WHERE tablename = 'enriched_authors'
  AND indexname LIKE '%normalized%'
ORDER BY indexname;

-- ============================================================================
-- Test Summary
-- ============================================================================

\echo ''
\echo '✅ Test Suite Complete!'
\echo ''
\echo 'Summary:'
\echo '  - Normalization function tested with edge cases'
\echo '  - Trigger verified on INSERT/UPDATE'
\echo '  - Indexes confirmed'
\echo '  - Performance benchmarked'
\echo ''
\echo 'Next: Review any FAIL results above and fix if needed.'
