#!/bin/bash
#
# migrate-works-hybrid-filter.sh
# Hybrid filter migration: ISBN-13 works + High-quality works
# Expected: 15-20M works (50-60% reduction from 40M)
#

set -e

BATCH_SIZE=${1:-1000000}  # Default 1M per batch, can override with argument
DRY_RUN=${2:-false}       # Set to 'true' to test without inserting

echo "[$(date)] Starting HYBRID FILTERED works migration..."
echo "Batch size: $BATCH_SIZE"
echo "Dry run: $DRY_RUN"

if [ "$DRY_RUN" = "true" ]; then
  echo "[$(date)] DRY RUN - counting what would be migrated..."

  ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
  -- Count what we'd migrate
  SELECT
    COUNT(*) as would_migrate,
    ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM works) * 100, 2) as pct_of_total
  FROM works w
  WHERE w.key IS NOT NULL
    AND w.data->>'title' IS NOT NULL
    AND (
      -- Filter 1: Has ISBN-13 edition
      EXISTS (
        SELECT 1 FROM editions e
        JOIN edition_isbns ei ON ei.edition_key = e.key
        WHERE e.work_key = w.key
          AND LENGTH(ei.isbn) = 13
        LIMIT 1
      )
      OR
      -- Filter 2: High quality (description + subjects + cover)
      (
        w.data->>'description' IS NOT NULL
        AND jsonb_array_length(w.data->'subjects') > 3
        AND jsonb_array_length(w.data->'covers') > 0
      )
    );
  \""

  exit 0
fi

echo "[$(date)] PRODUCTION RUN - migrating with hybrid filter..."

ssh root@Tower.local 'nohup docker exec postgres psql -U openlibrary -d openlibrary -c "
-- Clear existing data
TRUNCATE enriched_works CASCADE;

-- Migrate with hybrid filter + subject truncation
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
  -- Subject truncation (max 50 to prevent index overflow)
  CASE
    WHEN jsonb_array_length(w.data->'\''subjects'\'') > 50 THEN
      (SELECT array_agg(elem) FROM (
        SELECT jsonb_array_elements_text(w.data->'\''subjects'\'') as elem
        LIMIT 50
      ) sub)
    ELSE
      (SELECT array_agg(elem) FROM jsonb_array_elements_text(w.data->'\''subjects'\'') elem)
  END,
  REPLACE(w.key, '\''/works/'\'', '\''\'''\''),
  '\''openlibrary'\'',
  ARRAY['\''openlibrary'\''],
  -- Quality scoring
  CASE
    WHEN w.data->>'\''title'\'' IS NOT NULL
     AND w.data->>'\''description'\'' IS NOT NULL
     AND jsonb_array_length(w.data->'\''subjects'\'') > 5 THEN 60
    WHEN w.data->>'\''title'\'' IS NOT NULL
     AND w.data->>'\''description'\'' IS NOT NULL THEN 45
    WHEN w.data->>'\''title'\'' IS NOT NULL
     AND jsonb_array_length(w.data->'\''subjects'\'') > 0 THEN 35
    WHEN w.data->>'\''title'\'' IS NOT NULL THEN 25
    ELSE 10
  END,
  NOW(),
  NOW()
FROM works w
WHERE w.key IS NOT NULL
  AND w.data->>'\''title'\'' IS NOT NULL
  AND (
    -- HYBRID FILTER: Include if ANY of these are true

    -- Filter 1: Has ISBN-13 edition (primary - for ISBNdb enrichment)
    EXISTS (
      SELECT 1 FROM editions e
      JOIN edition_isbns ei ON ei.edition_key = e.key
      WHERE e.work_key = w.key
        AND LENGTH(ei.isbn) = 13
      LIMIT 1
    )
    OR
    -- Filter 2: High quality metadata (fallback for books without ISBNs)
    (
      w.data->>'\''description'\'' IS NOT NULL
      AND jsonb_array_length(w.data->'\''subjects'\'') > 3
      AND jsonb_array_length(w.data->'\''covers'\'') > 0
    )
  )
ON CONFLICT (work_key) DO NOTHING;
" > /tmp/works_migration_hybrid.log 2>&1 &'

echo "[$(date)] Migration started in background"
echo "Monitor progress with: bash scripts/monitor-migration.sh"
echo "View log with: ssh root@Tower.local 'tail -f /tmp/works_migration_hybrid.log'"
