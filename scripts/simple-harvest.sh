#!/bin/bash
# Simple Sequential Author Harvest
# No parallelism, just reliable processing

MAX_PAGES=10
TIMEOUT=300

AUTHORS_FILE="/tmp/final_remaining.txt"
RESULTS_FILE="/tmp/harvest_results.log"

TOTAL=$(wc -l < "$AUTHORS_FILE")
COUNT=0

echo "Starting sequential harvest of $TOTAL authors..."
echo "  Max pages: $MAX_PAGES | Timeout: ${TIMEOUT}s"
echo "======================================="

while IFS= read -r author || [[ -n "$author" ]]; do
    [[ -z "$author" ]] && continue
    COUNT=$((COUNT + 1))

    # Escape for JSON
    escaped=$(printf '%s' "$author" | sed 's/\\/\\\\/g; s/"/\\"/g')

    result=$(curl -s --max-time "$TIMEOUT" \
        "https://alexandria.ooheynerds.com/api/authors/enrich-bibliography" \
        -X POST -H "Content-Type: application/json" \
        -d "{\"author_name\": \"$escaped\", \"max_pages\": $MAX_PAGES}" 2>/dev/null)

    books=$(echo "$result" | jq -r '.books_found // 0' 2>/dev/null || echo "0")
    new=$(echo "$result" | jq -r '.enriched // 0' 2>/dev/null || echo "0")
    covers=$(echo "$result" | jq -r '.covers_queued // 0' 2>/dev/null || echo "0")
    duration=$(echo "$result" | jq -r '.duration_ms // 0' 2>/dev/null || echo "0")
    pages=$(echo "$result" | jq -r '.pages_fetched // 0' 2>/dev/null || echo "0")

    echo "$author|$books|$new|$covers|$duration|$pages" >> "$RESULTS_FILE"
    printf "[%3d/%3d] %-40s books=%4d new=%4d covers=%4d pages=%2d (%ds)\n" \
        "$COUNT" "$TOTAL" "${author:0:40}" "$books" "$new" "$covers" "$pages" "$((duration/1000))"

done < "$AUTHORS_FILE"

echo ""
echo "======================================="
echo "COMPLETE! Processed $COUNT authors"
