#!/bin/bash
# Simple Author Bibliography Harvest
# Processes authors from /tmp/remaining_authors.txt

PROCESSED=0
TOTAL=$(wc -l < /tmp/remaining_authors.txt)
TOTAL_BOOKS=0
TOTAL_NEW=0
TOTAL_COVERS=0

echo "Starting harvest of $TOTAL authors..."
echo "======================================="

while IFS= read -r author; do
    PROCESSED=$((PROCESSED + 1))

    # Call the API
    RESULT=$(curl -s --max-time 120 "https://alexandria.ooheynerds.com/api/authors/enrich-bibliography" \
        -X POST -H "Content-Type: application/json" \
        -d "{\"author_name\": \"$author\", \"max_pages\": 1}" 2>/dev/null)

    # Extract stats
    BOOKS=$(echo "$RESULT" | jq -r '.books_found // 0')
    NEW=$(echo "$RESULT" | jq -r '.enriched // 0')
    COVERS=$(echo "$RESULT" | jq -r '.covers_queued // 0')
    DURATION=$(echo "$RESULT" | jq -r '.duration_ms // 0')

    TOTAL_BOOKS=$((TOTAL_BOOKS + BOOKS))
    TOTAL_NEW=$((TOTAL_NEW + NEW))
    TOTAL_COVERS=$((TOTAL_COVERS + COVERS))

    # Progress output
    printf "[%3d/%3d] %-35s books=%3d new=%3d covers=%3d (%dms)\n" \
        "$PROCESSED" "$TOTAL" "${author:0:35}" "$BOOKS" "$NEW" "$COVERS" "$DURATION"

    # Rate limit (1.5s between authors)
    sleep 1.5

done < /tmp/remaining_authors.txt

echo ""
echo "======================================="
echo "COMPLETE!"
echo "  Authors: $PROCESSED"
echo "  Books found: $TOTAL_BOOKS"
echo "  Newly enriched: $TOTAL_NEW"
echo "  Covers queued: $TOTAL_COVERS"
