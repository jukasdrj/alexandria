#!/bin/bash
#
# monitor-migration.sh
# Monitor enrichment migration progress
#

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "========================================"
echo "Alexandria Migration Monitor"
echo "========================================"
echo ""

# Check if migration is running
echo -e "${YELLOW}Checking migration status...${NC}"
RUNNING=$(ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -t -c \"SELECT COUNT(*) FROM pg_stat_activity WHERE query LIKE '%INSERT INTO enriched_%' AND state = 'active';\"" | tr -d ' ')

if [ "$RUNNING" -gt 0 ]; then
    echo -e "${GREEN}✓ Migration is RUNNING${NC}"

    # Get process details
    ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
    SELECT
      pid,
      CASE
        WHEN query LIKE '%enriched_works%' THEN 'works'
        WHEN query LIKE '%enriched_editions%' THEN 'editions'
        WHEN query LIKE '%enriched_authors%' THEN 'authors'
        ELSE 'unknown'
      END as table_name,
      state,
      NOW() - query_start AS elapsed
    FROM pg_stat_activity
    WHERE query LIKE '%INSERT INTO enriched_%'
      AND state = 'active';
    \""
else
    echo -e "${RED}✗ No active migration${NC}"
fi

echo ""
echo -e "${YELLOW}Current record counts:${NC}"

# Get current counts
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  'enriched_works' as table_name,
  COUNT(*) as current_count,
  (SELECT COUNT(*) FROM works WHERE data->> 'title' IS NOT NULL) as target_count,
  ROUND(COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM works WHERE data->>'title' IS NOT NULL), 0) * 100, 2) as pct_complete
FROM enriched_works
UNION ALL
SELECT
  'enriched_editions' as table_name,
  COUNT(*) as current_count,
  (SELECT COUNT(*) FROM edition_isbns WHERE LENGTH(isbn) = 13) as target_count,
  ROUND(COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM edition_isbns WHERE LENGTH(isbn) = 13), 0) * 100, 2) as pct_complete
FROM enriched_editions
UNION ALL
SELECT
  'enriched_authors' as table_name,
  COUNT(*) as current_count,
  (SELECT COUNT(*) FROM authors WHERE data->>'name' IS NOT NULL) as target_count,
  ROUND(COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM authors WHERE data->>'name' IS NOT NULL), 0) * 100, 2) as pct_complete
FROM enriched_authors
ORDER BY table_name;
\""

echo ""
echo -e "${YELLOW}Recent migration log (last 10 lines):${NC}"
ssh root@Tower.local "tail -10 /tmp/works_migration.log 2>/dev/null || echo 'No log file found'"

echo ""
echo "========================================"
echo "Run this script again to refresh status"
echo "========================================"
