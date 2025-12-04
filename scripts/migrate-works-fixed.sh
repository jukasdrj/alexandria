#!/bin/bash
#
# migrate-works-fixed.sh
# Fixed works migration with subject_tags truncation to prevent index overflow
#

set -e

echo "[$(date)] Starting works migration with subject truncation..."

ssh root@Tower.local 'nohup docker exec postgres psql -U openlibrary -d openlibrary -c "
-- Clear any existing failed data
TRUNCATE enriched_works CASCADE;

-- Migrate works with subject_tags limited to 50 entries
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
  -- CRITICAL FIX: Limit subject_tags to first 50 entries to prevent index overflow
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
ON CONFLICT (work_key) DO NOTHING;
" > /tmp/works_migration.log 2>&1 &'

echo "[$(date)] Migration started in background"
echo "Monitor progress with: ssh root@Tower.local 'tail -f /tmp/works_migration.log'"
echo "Check status with: ./scripts/monitor-migration.sh"
