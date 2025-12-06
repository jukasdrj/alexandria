#!/bin/bash
#
# migrate-works-aggressive.sh
# Aggressive filter: ISBN-13 works from 1980+ ONLY
# Target: ~12-15M works (high quality, modern, ISBN-ready)
#

set -e

DRY_RUN=${1:-false}  # Set to 'true' to test without inserting

echo "[$(date)] Starting AGGRESSIVE FILTERED works migration..."
echo "Filter: ISBN-13 editions + published 1980 or later"
echo "Dry run: $DRY_RUN"

if [ "$DRY_RUN" = "true" ]; then
  echo "[$(date)] DRY RUN - counting what would be migrated..."

  ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
  -- Count what we'd migrate with aggressive filter
  SELECT
    COUNT(DISTINCT w.key) as would_migrate,
    ROUND(COUNT(DISTINCT w.key)::numeric / (SELECT COUNT(*) FROM works) * 100, 2) as pct_of_total
  FROM works w
  WHERE w.key IS NOT NULL
    AND w.data->>'title' IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM editions e
      JOIN edition_isbns ei ON ei.edition_key = e.key
      WHERE e.work_key = w.key
        AND LENGTH(ei.isbn) = 13
      LIMIT 1
    )
    AND (
      -- Published 1980 or later
      (REGEXP_MATCH(w.data->>'first_publish_date', '\\\d{4}'))[1]::integer >= 1980
      OR
      -- No publication date but has rich metadata (likely modern)
      (
        w.data->>'first_publish_date' IS NULL
        AND w.data->>'description' IS NOT NULL
        AND jsonb_array_length(w.data->'subjects') > 3
      )
    );
  \""

  exit 0
fi

echo "[$(date)] PRODUCTION RUN - migrating with aggressive filter..."

ssh root@Tower.local 'nohup docker exec postgres psql -U openlibrary -d openlibrary -c "
-- Clear existing data
TRUNCATE enriched_works CASCADE;

-- Migrate with AGGRESSIVE filter + subject truncation (max 50)
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
SELECT
  w.key,
  w.data->>'\''title'\'',
  w.data->>'\''subtitle'\'',
  CASE
    WHEN jsonb_typeof(w.data->'\''description'\'') = '\''string'\'' THEN w.data->>'\''description'\''
    WHEN jsonb_typeof(w.data->'\''description'\'') = '\''object'\'' THEN w.data->'\''description'\''->>'\''value'\''
    ELSE NULL
  END,
  w.data->>'\''original_language'\'',
  (REGEXP_MATCH(w.data->>'\''first_publish_date'\'', '\''\\\d{4}'\''))[1]::integer,
  -- Subject truncation: LIMIT to 50 to prevent index overflow
  CASE
    WHEN jsonb_array_length(w.data->'\''subjects'\'') > 50 THEN
      (SELECT array_agg(elem) FROM (
        SELECT jsonb_array_elements_text(w.data->'\''subjects'\'') as elem
        LIMIT 50
      ) sub)
    WHEN w.data->'\''subjects'\'' IS NOT NULL THEN
      (SELECT array_agg(elem) FROM jsonb_array_elements_text(w.data->'\''subjects'\'') elem)
    ELSE NULL
  END,
  REPLACE(w.key, '\''/works/'\'', '\''\'''\''),
  '\''openlibrary'\'',
  ARRAY['\''openlibrary'\''],
  -- Quality scoring
  CASE
    WHEN w.data->>'\''description'\'' IS NOT NULL
     AND jsonb_array_length(w.data->'\''subjects'\'') > 5 THEN 60
    WHEN w.data->>'\''description'\'' IS NOT NULL THEN 45
    WHEN jsonb_array_length(w.data->'\''subjects'\'') > 3 THEN 35
    ELSE 25
  END,
  NOW(),
  NOW()
FROM works w
WHERE w.key IS NOT NULL
  AND w.data->>'\''title'\'' IS NOT NULL
  -- AGGRESSIVE FILTER: Must have ISBN-13 edition
  AND EXISTS (
    SELECT 1 FROM editions e
    JOIN edition_isbns ei ON ei.edition_key = e.key
    WHERE e.work_key = w.key
      AND LENGTH(ei.isbn) = 13
    LIMIT 1
  )
  -- AGGRESSIVE FILTER: Published 1980+ OR rich modern metadata
  AND (
    (REGEXP_MATCH(w.data->>'\''first_publish_date'\'', '\''\\\d{4}'\''))[1]::integer >= 1980
    OR
    (
      w.data->>'\''first_publish_date'\'' IS NULL
      AND w.data->>'\''description'\'' IS NOT NULL
      AND jsonb_array_length(w.data->'\''subjects'\'') > 3
    )
  )
ON CONFLICT (work_key) DO NOTHING;
" > /tmp/works_migration_aggressive.log 2>&1 &'

echo "[$(date)] Migration started in background"
echo "Monitor progress with: bash scripts/monitor-migration.sh"
echo "View log with: ssh root@Tower.local 'tail -f /tmp/works_migration_aggressive.log'"
