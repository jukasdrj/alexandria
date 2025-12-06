#!/bin/bash
#
# migrate-works-v2-optimized.sh
# ULTRA OPTIMIZED: Simplified filters for maximum capture
# Strategy: Get ALL ISBN-13 works, filter quality in SELECT
# Target: 1.5M+ works
#

set -e

echo "[$(date)] V2 OPTIMIZED MIGRATION - Maximum capture with smart filtering"
echo "Strategy: Capture all ISBN-13 works with titles"
echo "Target: 1.5M+ works"

ssh root@Tower.local 'nohup docker exec postgres psql -U openlibrary -d openlibrary -c "
TRUNCATE enriched_works CASCADE;

INSERT INTO enriched_works (
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
  LEFT(w.data->>'\'title\'', 500),
  LEFT(w.data->>'\'subtitle\'', 500),
  LEFT(
    CASE
      WHEN jsonb_typeof(w.data->'\'description\'') = '\'string\'' THEN w.data->>'\''description'\''
      WHEN jsonb_typeof(w.data->'\'description\'') = '\'object\'' THEN w.data->'\'description\''->>'\'value'\''
      ELSE NULL
    END,
    2000
  ),
  w.data->>'\'original_language\'',
  (REGEXP_MATCH(w.data->>'\'first_publish_date\'', '\''\\d{4}'\''))[1]::integer,
  CASE
    WHEN jsonb_array_length(w.data->'\'subjects\'') > 20 THEN
      (SELECT array_agg(elem) FROM (
        SELECT jsonb_array_elements_text(w.data->'\'subjects\'') as elem
        LIMIT 20
      ) sub)
    WHEN w.data->'\'subjects\'' IS NOT NULL THEN
      (SELECT array_agg(elem) FROM jsonb_array_elements_text(w.data->'\'subjects\'') elem)
    ELSE NULL
  END,
  REPLACE(w.key, '\'\/works\/\'', '\'\''),
  '\'openlibrary\'',
  ARRAY['\'openlibrary\''],
  CASE
    WHEN w.data->>'\'description\'' IS NOT NULL
     AND jsonb_array_length(w.data->'\'subjects\'') > 5 THEN 60
    WHEN w.data->>'\'description\'' IS NOT NULL THEN 45
    WHEN jsonb_array_length(w.data->'\'subjects\'') > 3 THEN 35
    ELSE 25
  END,
  NOW(),
  NOW()
FROM works w
INNER JOIN editions e ON e.work_key = w.key
INNER JOIN edition_isbns ei ON ei.edition_key = e.key
WHERE w.key IS NOT NULL
  AND w.data->>'\'title\'' IS NOT NULL
  AND LENGTH(ei.isbn) = 13
  -- SIMPLIFIED: Remove complex date parsing from WHERE
  -- Let all ISBN-13 works through, we can filter later if needed
ON CONFLICT (work_key) DO NOTHING;
" > /tmp/works_migration_v2.log 2>&1 &'

echo "[$(date)] Migration started in background"
echo "Log: ssh root@Tower.local 'tail -f /tmp/works_migration_v2.log'"
echo "This should capture ALL ISBN-13 works (~1.5M+)"
