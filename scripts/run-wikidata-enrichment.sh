#!/bin/bash
# Wikidata Enrichment Script
# Processes authors in batches of 500

ENDPOINT="https://alexandria.ooheynerds.com/api/authors/enrich-wikidata"
LIMIT=500
BATCH_COUNT=${1:-10}  # Default to 10 batches

echo "Starting Wikidata enrichment ($BATCH_COUNT batches of $LIMIT authors each)"
echo "---"

for i in $(seq 1 $BATCH_COUNT); do
  result=$(curl -s -X POST "$ENDPOINT" -H "Content-Type: application/json" -d "{\"limit\":$LIMIT}")
  processed=$(echo "$result" | jq -r '.processed // 0')
  enriched=$(echo "$result" | jq -r '.enriched // 0')

  if [ "$processed" -eq 0 ]; then
    echo "Batch $i: No more authors to process. Done!"
    break
  fi

  echo "Batch $i: processed=$processed, enriched=$enriched"
  sleep 2
done

echo "---"
echo "Final status:"
curl -s "https://alexandria.ooheynerds.com/api/authors/enrich-status" | jq .
