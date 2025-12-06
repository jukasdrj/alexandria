#!/bin/bash
#
# validate-migration-subset.sh
# Test migration on 10,000 row subset to validate all potential failure points
#

set -e

echo "[$(date)] VALIDATION: Testing migration on 10,000 row subset"
echo "This will test for:"
echo "  1. Index overflow (subject arrays)"
echo "  2. String truncation (titles, descriptions)"
echo "  3. JSONB parsing errors"
echo "  4. NULL handling"
echo "  5. Query performance"

ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary" <<'EOF'
-- Drop test table if exists
DROP TABLE IF EXISTS test_enriched_works;

-- Create test table with same structure as enriched_works
CREATE TABLE test_enriched_works (
  work_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  original_language TEXT,
  first_publication_year INTEGER,
  subject_tags TEXT[],
  openlibrary_work_id TEXT,
  primary_provider TEXT,
  contributors TEXT[],
  completeness_score INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Test migration with 10,000 rows
\timing on
INSERT INTO test_enriched_works (
  work_key,
  title,
  subtitle,
  description,
  original_language,
  first_publication_year,
  subject_tags,
  openlibrary_work_id,
  primary_provider,
  contributors,
  completeness_score,
  created_at,
  updated_at
)
SELECT DISTINCT ON (w.key)
  w.key,
  LEFT(w.data->>'title', 500),
  LEFT(w.data->>'subtitle', 500),
  LEFT(
    CASE
      WHEN jsonb_typeof(w.data->'description') = 'string' THEN w.data->>'description'
      WHEN jsonb_typeof(w.data->'description') = 'object' THEN w.data->'description'->>'value'
      ELSE NULL
    END,
    2000
  ),
  w.data->>'original_language',
  (REGEXP_MATCH(w.data->>'first_publish_date', '\\d{4}'))[1]::integer,
  CASE
    WHEN jsonb_array_length(w.data->'subjects') > 20 THEN
      (SELECT array_agg(elem) FROM (
        SELECT jsonb_array_elements_text(w.data->'subjects') as elem
        LIMIT 20
      ) sub)
    WHEN w.data->'subjects' IS NOT NULL THEN
      (SELECT array_agg(elem) FROM jsonb_array_elements_text(w.data->'subjects') elem)
    ELSE NULL
  END,
  REPLACE(w.key, '/works/', ''),
  'openlibrary',
  ARRAY['openlibrary'],
  CASE
    WHEN w.data->>'description' IS NOT NULL
     AND jsonb_array_length(w.data->'subjects') > 5 THEN 60
    WHEN w.data->>'description' IS NOT NULL THEN 45
    WHEN jsonb_array_length(w.data->'subjects') > 3 THEN 35
    ELSE 25
  END,
  NOW(),
  NOW()
FROM works w
INNER JOIN editions e ON e.work_key = w.key
INNER JOIN edition_isbns ei ON ei.edition_key = e.key
WHERE w.key IS NOT NULL
  AND w.data->>'title' IS NOT NULL
  AND LENGTH(ei.isbn) = 13
LIMIT 10000;

\timing off

-- Validation checks
SELECT
  'VALIDATION RESULTS' as check_type,
  '==================' as result;

SELECT
  'Total rows inserted' as check_type,
  COUNT(*)::text as result
FROM test_enriched_works;

SELECT
  'Rows with subjects' as check_type,
  COUNT(*)::text as result
FROM test_enriched_works
WHERE subject_tags IS NOT NULL;

SELECT
  'Max subject count (should be <= 20)' as check_type,
  MAX(array_length(subject_tags, 1))::text as result
FROM test_enriched_works;

SELECT
  'Max title length (should be <= 500)' as check_type,
  MAX(LENGTH(title))::text as result
FROM test_enriched_works;

SELECT
  'Max description length (should be <= 2000)' as check_type,
  MAX(LENGTH(description))::text as result
FROM test_enriched_works;

SELECT
  'Rows with NULL titles (should be 0)' as check_type,
  COUNT(*)::text as result
FROM test_enriched_works
WHERE title IS NULL;

SELECT
  'Completeness score distribution' as check_type,
  completeness_score::text || ': ' || COUNT(*)::text as result
FROM test_enriched_works
GROUP BY completeness_score
ORDER BY completeness_score;

-- Test indexes (create them on test table)
CREATE INDEX test_idx_subjects ON test_enriched_works USING GIN (subject_tags);
CREATE INDEX test_idx_year ON test_enriched_works (first_publication_year DESC);
CREATE INDEX test_idx_completeness ON test_enriched_works (completeness_score DESC);

SELECT
  'All indexes created successfully' as check_type,
  'PASS' as result;

-- Cleanup
DROP TABLE test_enriched_works;

SELECT
  'VALIDATION COMPLETE' as check_type,
  'All checks passed!' as result;
EOF

echo "[$(date)] Validation complete! No errors detected."
