#!/bin/bash
#
# Alexandria Current Month Harvester
#
# Harvests books published in the current month from ISBNdb.
# Safe for cron automation - checks quota first.
#
# Usage:
#   ./harvest-current-month.sh
#
# Cron example (runs 1st of each month at 3 AM UTC):
#   0 3 1 * * /path/to/harvest-current-month.sh >> /var/log/alexandria-harvest.log 2>&1
#

set -euo pipefail

ALEXANDRIA_URL="https://alexandria.ooheynerds.com"
MONTH=$(date +%Y-%m)
MAX_PAGES=50  # 50 pages = ~5,000 books

echo "==================================="
echo "Alexandria Current Month Harvester"
echo "==================================="
echo "Date: $(date)"
echo "Month: $MONTH"
echo ""

# Check quota first
echo "Checking ISBNdb quota..."
QUOTA_RESPONSE=$(curl -s "$ALEXANDRIA_URL/api/quota/status")
REMAINING=$(echo "$QUOTA_RESPONSE" | jq -r '.data.remaining')
CAN_MAKE_CALLS=$(echo "$QUOTA_RESPONSE" | jq -r '.data.can_make_calls')

echo "Quota remaining: $REMAINING calls"

if [ "$CAN_MAKE_CALLS" != "true" ]; then
  echo "ERROR: ISBNdb quota exhausted. Aborting harvest."
  exit 1
fi

if [ "$REMAINING" -lt "$MAX_PAGES" ]; then
  echo "WARNING: Insufficient quota ($REMAINING < $MAX_PAGES). Reducing pages to $REMAINING."
  MAX_PAGES=$REMAINING
fi

echo ""
echo "Starting harvest for $MONTH..."
echo "Max pages: $MAX_PAGES (estimated ~$((MAX_PAGES * 100)) books)"
echo ""

# Run harvest
HARVEST_START=$(date +%s)

RESPONSE=$(curl -s -X POST "$ALEXANDRIA_URL/api/books/enrich-new-releases" \
  -H "Content-Type: application/json" \
  -d "{
    \"start_month\": \"$MONTH\",
    \"end_month\": \"$MONTH\",
    \"max_pages_per_month\": $MAX_PAGES,
    \"skip_existing\": true
  }")

HARVEST_END=$(date +%s)
DURATION=$((HARVEST_END - HARVEST_START))

echo ""
echo "==================================="
echo "Harvest Complete"
echo "==================================="
echo "Duration: ${DURATION}s"
echo ""

# Parse response
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')

if [ "$SUCCESS" != "true" ]; then
  echo "ERROR: Harvest failed"
  echo "$RESPONSE" | jq
  exit 1
fi

# Display results
echo "Results:"
echo "$RESPONSE" | jq '.data'

echo ""
echo "Summary:"
BOOKS_FOUND=$(echo "$RESPONSE" | jq -r '.data.total_books_found')
NEWLY_ENRICHED=$(echo "$RESPONSE" | jq -r '.data.newly_enriched')
ALREADY_EXISTED=$(echo "$RESPONSE" | jq -r '.data.already_existed')
COVERS_QUEUED=$(echo "$RESPONSE" | jq -r '.data.covers_queued')
API_CALLS=$(echo "$RESPONSE" | jq -r '.data.api_calls')

echo "  Books found: $BOOKS_FOUND"
echo "  Newly enriched: $NEWLY_ENRICHED"
echo "  Already existed: $ALREADY_EXISTED"
echo "  Covers queued: $COVERS_QUEUED"
echo "  API calls used: $API_CALLS"

# Check final quota
echo ""
echo "Final quota status:"
FINAL_QUOTA=$(echo "$RESPONSE" | jq -r '.data.quota_status')
echo "$FINAL_QUOTA" | jq

echo ""
echo "Harvest complete! ✓"
