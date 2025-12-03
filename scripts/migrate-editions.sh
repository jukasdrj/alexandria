#!/bin/bash
# Alexandria Enrichment Migration - Phase 2: Editions
# Run AFTER Phase 1 (works) is complete
# Expected: ~30M rows, runtime: 30-60 minutes

echo "Starting Phase 2: Editions Migration..."
echo "Timestamp: $(date)"

# Strategy: Insert all editions with work_key=NULL first (fast, no FK check)
# Then update work_keys in a separate pass (uses index)

ssh root@Tower.local 'nohup docker exec postgres psql -U openlibrary -d openlibrary << '\''EOF'\''
-- PHASE 2A: Bulk insert editions (work_key = NULL to avoid FK checks)
-- This is fast because it skips FK validation

INSERT INTO enriched_editions (
  isbn, title, subtitle, work_key, edition_key, openlibrary_edition_id,
  publisher, publication_date, page_count, language,
  primary_provider, contributors, completeness_score, isbndb_quality,
  created_at, updated_at
)
SELECT 
  ei.isbn,
  e.data->>'\''title'\'',
  e.data->>'\''subtitle'\'',
  NULL,  -- Set work_key = NULL initially (FK allows NULL)
  e.key,
  REPLACE(e.key, '\''/books/'\'', '\'''\''),
  (e.data->'\''publishers'\''->>0),
  e.data->>'\''publish_date'\'',
  (e.data->>'\''number_of_pages'\'')::integer,
  e.data->>'\''languages'\'',
  '\''openlibrary'\'',
  ARRAY['\''openlibrary'\''],
  CASE 
    WHEN e.data->>'\''title'\'' IS NOT NULL 
     AND e.data->'\''publishers'\''->>0 IS NOT NULL 
     AND e.data->>'\''number_of_pages'\'' IS NOT NULL THEN 50
    WHEN e.data->>'\''title'\'' IS NOT NULL 
     AND e.data->'\''publishers'\''->>0 IS NOT NULL THEN 35
    WHEN e.data->>'\''title'\'' IS NOT NULL THEN 25
    ELSE 10
  END,
  0,
  NOW(),
  NOW()
FROM edition_isbns ei
JOIN editions e ON e.key = ei.edition_key
WHERE ei.isbn IS NOT NULL
  AND LENGTH(ei.isbn) = 13
ON CONFLICT (isbn) DO NOTHING;

-- Report result
SELECT '\''Phase 2A complete: '\'' || COUNT(*) || '\'' editions inserted'\'' FROM enriched_editions;
EOF
' > /tmp/editions_migration.log 2>&1 &

echo "Editions migration started in background"
echo "Monitor: ssh root@Tower.local 'tail -f /tmp/editions_migration.log'"
echo ""
echo "After Phase 2A completes, run Phase 2B to link work_keys:"
echo "ssh root@Tower.local 'docker exec postgres psql -U openlibrary -d openlibrary -c \"
UPDATE enriched_editions ee
SET work_key = e.work_key
FROM editions e
WHERE ee.edition_key = e.key
  AND ee.work_key IS NULL
  AND e.work_key IN (SELECT work_key FROM enriched_works);
\"'"
