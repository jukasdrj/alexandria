#!/bin/bash
# Parallel Author Bibliography Harvest v2
# Uses GNU parallel or falls back to sequential with backgrounding
# Properly handles special characters in author names

set -o pipefail

PARALLEL_JOBS=3
MAX_PAGES=10
TIMEOUT=300

AUTHORS_FILE="/tmp/still_remaining.txt"
RESULTS_FILE="/tmp/harvest_results.log"
LOCK_FILE="/tmp/harvest.lock"

TOTAL=$(wc -l < "$AUTHORS_FILE")
PROCESSED=0

echo "Starting harvest of $TOTAL authors..."
echo "  Parallel: $PARALLEL_JOBS | Max pages: $MAX_PAGES | Timeout: ${TIMEOUT}s"
echo "======================================="

# Process one author (called in background)
process_one() {
    local author="$1"

    # Escape special chars for JSON
    local escaped_author
    escaped_author=$(printf '%s' "$author" | sed 's/\\/\\\\/g; s/"/\\"/g')

    local result
    result=$(curl -s --max-time "$TIMEOUT" \
        "https://alexandria.ooheynerds.com/api/authors/enrich-bibliography" \
        -X POST -H "Content-Type: application/json" \
        -d "{\"author_name\": \"$escaped_author\", \"max_pages\": $MAX_PAGES}" 2>/dev/null)

    local books new covers duration pages
    books=$(echo "$result" | jq -r '.books_found // 0' 2>/dev/null || echo "0")
    new=$(echo "$result" | jq -r '.enriched // 0' 2>/dev/null || echo "0")
    covers=$(echo "$result" | jq -r '.covers_queued // 0' 2>/dev/null || echo "0")
    duration=$(echo "$result" | jq -r '.duration_ms // 0' 2>/dev/null || echo "0")
    pages=$(echo "$result" | jq -r '.pages_fetched // 0' 2>/dev/null || echo "0")

    # Thread-safe write using flock
    (
        flock -x 200
        echo "$author|$books|$new|$covers|$duration|$pages" >> "$RESULTS_FILE"
        CURRENT=$(wc -l < "$RESULTS_FILE")
        printf "[%3d/%3d] %-40s books=%4d new=%4d covers=%4d pages=%2d (%ds)\n" \
            "$CURRENT" "$TOTAL" "${author:0:40}" "$books" "$new" "$covers" "$pages" "$((duration/1000))"
    ) 200>"$LOCK_FILE"
}

# Read authors and process in batches
declare -a PIDS=()

while IFS= read -r author || [[ -n "$author" ]]; do
    # Skip empty lines
    [[ -z "$author" ]] && continue

    # Start background job
    process_one "$author" &
    PIDS+=($!)

    # Limit parallel jobs
    if [[ ${#PIDS[@]} -ge $PARALLEL_JOBS ]]; then
        # Wait for at least one to finish
        wait -n 2>/dev/null || wait "${PIDS[0]}"
        # Remove completed PIDs
        PIDS=($(jobs -rp))
    fi
done < "$AUTHORS_FILE"

# Wait for remaining jobs
wait

echo ""
echo "======================================="
echo "COMPLETE!"

# Summary
TOTAL_BOOKS=$(awk -F'|' '{sum+=$2} END {print sum}' "$RESULTS_FILE" 2>/dev/null || echo "0")
TOTAL_NEW=$(awk -F'|' '{sum+=$3} END {print sum}' "$RESULTS_FILE" 2>/dev/null || echo "0")
TOTAL_COVERS=$(awk -F'|' '{sum+=$4} END {print sum}' "$RESULTS_FILE" 2>/dev/null || echo "0")
FINAL_COUNT=$(wc -l < "$RESULTS_FILE" 2>/dev/null || echo "0")

echo "  Authors processed: $FINAL_COUNT"
echo "  Books found: $TOTAL_BOOKS"
echo "  Newly enriched: $TOTAL_NEW"
echo "  Covers queued: $TOTAL_COVERS"
