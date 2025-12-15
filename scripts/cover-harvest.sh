#!/bin/bash
# Cover Harvest Script
# Calls /api/harvest/covers repeatedly to update cover URLs AND queue downloads
#
# IMPORTANT: ISBNdb image_original URLs expire in 2 hours!
# Covers MUST be downloaded before expiry, so we queue immediately.
#
# Usage:
#   ./cover-harvest.sh              # Run 10 batches (10K covers), queue downloads
#   ./cover-harvest.sh 100          # Run 100 batches (100K covers)
#   ./cover-harvest.sh 100 5000     # Start from offset 5000
#   ./cover-harvest.sh 100 0 50     # Smaller batch size (50) to control queue
#
# Queue capacity: ~30 covers/minute = ~1,800/hour
# At batch_size=100, wait ~3-4 min between batches for queue to clear

BATCHES=${1:-10}
START_OFFSET=${2:-0}
BATCH_SIZE=${3:-100}  # Smaller default to control queue depth
QUEUE_COVERS=true     # Always queue - URLs expire in 2 hours!

OFFSET=$START_OFFSET
TOTAL_UPDATED=0
TOTAL_FOUND=0
TOTAL_QUEUED=0

# Calculate delay based on batch size and queue capacity (~30/min)
# batch_size / 30 = minutes to process, convert to seconds with buffer
DELAY_SECONDS=$((BATCH_SIZE * 2 + 30))  # 2 sec per cover + 30 sec buffer

echo "========================================="
echo "Cover Harvest - Starting"
echo "  Batches: $BATCHES"
echo "  Start offset: $START_OFFSET"
echo "  Batch size: $BATCH_SIZE"
echo "  Queue covers: $QUEUE_COVERS"
echo "  Delay between batches: ${DELAY_SECONDS}s"
echo "========================================="

for i in $(seq 1 $BATCHES); do
    START_TIME=$(date +%s)

    RESULT=$(curl -s "https://alexandria.ooheynerds.com/api/harvest/covers" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "{\"batch_size\": $BATCH_SIZE, \"offset\": $OFFSET, \"queue_covers\": $QUEUE_COVERS}")

    QUERIED=$(echo "$RESULT" | jq -r '.queried // 0')
    FOUND=$(echo "$RESULT" | jq -r '.found_in_isbndb // 0')
    UPDATED=$(echo "$RESULT" | jq -r '.editions_updated // 0')
    QUEUED=$(echo "$RESULT" | jq -r '.covers_queued // 0')
    DURATION=$(echo "$RESULT" | jq -r '.duration_ms // 0')
    REMAINING=$(echo "$RESULT" | jq -r '.estimated_remaining // "?"')

    TOTAL_UPDATED=$((TOTAL_UPDATED + UPDATED))
    TOTAL_FOUND=$((TOTAL_FOUND + FOUND))
    TOTAL_QUEUED=$((TOTAL_QUEUED + QUEUED))

    # Calculate hit rate
    if [ "$QUERIED" -gt 0 ]; then
        HIT_RATE=$(echo "scale=1; $FOUND * 100 / $QUERIED" | bc)
    else
        HIT_RATE="0"
    fi

    printf "[%3d/%3d] offset=%7d | found=%4d (%s%%) | queued=%4d | %5dms | remaining=%s\n" \
        "$i" "$BATCHES" "$OFFSET" "$FOUND" "$HIT_RATE" "$QUEUED" "$DURATION" "$REMAINING"

    # Move to next batch
    OFFSET=$((OFFSET + BATCH_SIZE))

    # Check for completion
    if [ "$QUERIED" -eq 0 ]; then
        echo ""
        echo "No more editions to process!"
        break
    fi

    # Wait for queue to process before next batch
    if [ "$i" -lt "$BATCHES" ]; then
        echo "    Waiting ${DELAY_SECONDS}s for queue to process..."
        sleep $DELAY_SECONDS
    fi
done

echo ""
echo "========================================="
echo "Cover Harvest - Complete"
echo "  Total found in ISBNdb: $TOTAL_FOUND"
echo "  Total editions updated: $TOTAL_UPDATED"
echo "  Total covers queued: $TOTAL_QUEUED"
echo "  Next offset: $OFFSET"
echo "========================================="
