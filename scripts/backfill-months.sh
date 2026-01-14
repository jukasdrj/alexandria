#!/bin/bash
# Backfill scheduler helper script
# Usage: ./scripts/backfill-months.sh [batch_size] [start_year] [end_year] [dry_run]

set -e

# Check if ALEXANDRIA_WEBHOOK_SECRET is set
if [[ -z "$ALEXANDRIA_WEBHOOK_SECRET" ]]; then
  echo "❌ Error: ALEXANDRIA_WEBHOOK_SECRET environment variable not set"
  echo "Please set it first:"
  echo "  export ALEXANDRIA_WEBHOOK_SECRET=your_secret_here"
  exit 1
fi

# Default values
BATCH_SIZE=${1:-5}
START_YEAR=${2:-2020}
END_YEAR=${3:-2020}
DRY_RUN=${4:-false}

BASE_URL="https://alexandria.ooheynerds.com"

echo "📚 Alexandria Backfill Scheduler"
echo "================================"
echo "Batch size: $BATCH_SIZE months"
echo "Year range: $START_YEAR - $END_YEAR"
echo "Dry run: $DRY_RUN"
echo ""

# Function to check stats
check_stats() {
  echo "📊 Current Backfill Statistics:"
  curl -s "$BASE_URL/api/internal/backfill-stats" \
    -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" | jq '.'
  echo ""
}

# Function to schedule backfill
schedule_backfill() {
  local batch_size=$1
  local start_year=$2
  local end_year=$3
  local dry_run=$4

  echo "🚀 Scheduling backfill..."
  curl -X POST "$BASE_URL/api/internal/schedule-backfill" \
    -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
    -H "Content-Type: application/json" \
    --data-raw "{
      \"batch_size\": $batch_size,
      \"year_range\": {
        \"start\": $start_year,
        \"end\": $end_year
      },
      \"dry_run\": $dry_run
    }" | jq '.'
  echo ""
}

# Check current stats first
check_stats

# Schedule the backfill
schedule_backfill "$BATCH_SIZE" "$START_YEAR" "$END_YEAR" "$DRY_RUN"

# If not dry run, wait a bit and check stats again
if [[ "$DRY_RUN" == "false" ]]; then
  echo "⏳ Waiting 30 seconds for queue processing..."
  sleep 30
  check_stats
fi

echo "✅ Done!"
