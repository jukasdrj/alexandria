#!/bin/bash
#
# migrate-works-optimized.sh
# OPTIMIZED: Use JOIN instead of EXISTS for better query performance
# Target: 1.34M+ modern ISBN-13 works
#

set -e

echo "[$(date)] OPTIMIZED MIGRATION - Using JOIN instead of EXISTS"
echo "Target: 21.25M works with ISBN-13 editions"
echo "Filter: ISBN-13 works with titles (NO date restriction)"

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
  -- TRUNCATE title to 500 chars (safe for indexing)
  LEFT(w.data->>'\'title\'', 500),
  -- TRUNCATE subtitle to 500 chars
  LEFT(w.data->>'\'subtitle\'', 500),
  -- TRUNCATE description to 2000 chars (no index on this field)
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
  -- TRUNCATE subjects to first 20 entries (safe for GIN index)
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
-- OPTIMIZED: Use INNER JOIN instead of EXISTS
INNER JOIN editions e ON e.work_key = w.key
INNER JOIN edition_isbns ei ON ei.edition_key = e.key
WHERE w.key IS NOT NULL
  AND w.data->>'\'title\'' IS NOT NULL
  AND LENGTH(ei.isbn) = 13
ON CONFLICT (work_key) DO NOTHING;
" > /tmp/works_migration_optimized.log 2>&1 &'

echo "[$(date)] Migration started in background"
echo "Log: ssh root@Tower.local 'tail -f /tmp/works_migration_optimized.log'"
echo "Monitor: bash scripts/monitor-migration.sh"
