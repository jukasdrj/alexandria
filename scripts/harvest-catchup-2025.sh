#!/bin/bash
#
# Alexandria 2025 Catch-Up Harvester
#
# Harvests all books published in 2025 in quarterly batches.
# Designed to backfill recent releases not in OpenLibrary dump.
#
# Usage:
#   ./harvest-catchup-2025.sh
#

set -euo pipefail

ALEXANDRIA_URL="https://alexandria.ooheynerds.com"
MAX_PAGES_PER_MONTH=50

echo "========================================"
echo "Alexandria 2025 Catch-Up Harvester"
echo "========================================"
echo "Date: $(date)"
echo ""

# Define quarters
declare -a QUARTERS=(
  "2025-01 2025-03 Q1"
  "2025-04 2025-06 Q2"
  "2025-07 2025-09 Q3"
  "2025-10 2025-12 Q4"
)

TOTAL_QUARTERS=${#QUARTERS[@]}
CURRENT_QUARTER=0

for quarter_info in "${QUARTERS[@]}"; do
  CURRENT_QUARTER=$((CURRENT_QUARTER + 1))

  read -r START END LABEL <<< "$quarter_info"

  echo ""
  echo "========================================"
  echo "Processing $LABEL: $START to $END"
  echo "Progress: $CURRENT_QUARTER/$TOTAL_QUARTERS quarters"
  echo "========================================"
  echo ""

  # Check quota before starting quarter
  QUOTA_RESPONSE=$(curl -s "$ALEXANDRIA_URL/api/quota/status")
  REMAINING=$(echo "$QUOTA_RESPONSE" | jq -r '.data.remaining')
  CAN_MAKE_CALLS=$(echo "$QUOTA_RESPONSE" | jq -r '.data.can_make_calls')

  echo "Current quota: $REMAINING calls remaining"

  if [ "$CAN_MAKE_CALLS" != "true" ]; then
    echo "ERROR: ISBNdb quota exhausted at $LABEL"
    echo "Harvested: $((CURRENT_QUARTER - 1))/$TOTAL_QUARTERS quarters"
    exit 1
  fi

  # Calculate API calls needed for this quarter (3 months × max_pages)
  ESTIMATED_CALLS=$((3 * MAX_PAGES_PER_MONTH))

  if [ "$REMAINING" -lt "$ESTIMATED_CALLS" ]; then
    echo "WARNING: Insufficient quota for full quarter"
    echo "  Required: ~$ESTIMATED_CALLS calls"
    echo "  Available: $REMAINING calls"
    echo "Proceeding with reduced pages..."
  fi

  # Run harvest
  QUARTER_START=$(date +%s)

  RESPONSE=$(curl -s -X POST "$ALEXANDRIA_URL/api/books/enrich-new-releases" \
    -H "Content-Type: application/json" \
    -d "{
      \"start_month\": \"$START\",
      \"end_month\": \"$END\",
      \"max_pages_per_month\": $MAX_PAGES_PER_MONTH,
      \"skip_existing\": true
    }")

  QUARTER_END=$(date +%s)
  DURATION=$((QUARTER_END - QUARTER_START))

  SUCCESS=$(echo "$RESPONSE" | jq -r '.success')

  if [ "$SUCCESS" != "true" ]; then
    echo "ERROR: Harvest failed for $LABEL"
    echo "$RESPONSE" | jq
    exit 1
  fi

  # Display results
  BOOKS_FOUND=$(echo "$RESPONSE" | jq -r '.data.total_books_found')
  NEWLY_ENRICHED=$(echo "$RESPONSE" | jq -r '.data.newly_enriched')
  API_CALLS=$(echo "$RESPONSE" | jq -r '.data.api_calls')
  QUOTA_EXHAUSTED=$(echo "$RESPONSE" | jq -r '.data.quota_exhausted // false')

  echo ""
  echo "$LABEL Summary:"
  echo "  Duration: ${DURATION}s"
  echo "  Books found: $BOOKS_FOUND"
  echo "  Newly enriched: $NEWLY_ENRICHED"
  echo "  API calls: $API_CALLS"

  # Check if quota was exhausted mid-operation
  if [ "$QUOTA_EXHAUSTED" = "true" ]; then
    echo ""
    echo "WARNING: Quota exhausted during $LABEL"
    echo "Harvest incomplete. Resume tomorrow after quota reset."
    exit 0
  fi

  # Wait between quarters (unless last quarter)
  if [ "$CURRENT_QUARTER" -lt "$TOTAL_QUARTERS" ]; then
    echo ""
    echo "Waiting 60 seconds before next quarter..."
    sleep 60
  fi
done

echo ""
echo "========================================"
echo "2025 Catch-Up Complete! ✓"
echo "========================================"
echo "All $TOTAL_QUARTERS quarters harvested successfully"
echo ""

# Final quota check
echo "Final quota status:"
curl -s "$ALEXANDRIA_URL/api/quota/status" | jq '.data'
