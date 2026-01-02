#!/bin/bash
#
# Execute Migration 003 via Alexandria Worker API
#
# This script uses the /api/migrate/003 endpoint but with chunked execution
# to avoid Worker CPU timeouts.
#

set -e

API_BASE="https://alexandria.ooheynerds.com"

echo "🚀 Executing Migration 003 via API..."
echo ""

# Execute the migration
echo "📤 Sending migration request..."
response=$(curl -s -X POST "${API_BASE}/api/migrate/003" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"EXECUTE_MIGRATION_003"}' \
  --max-time 180)

echo "$response" | jq '.' 2>/dev/null || echo "$response"

echo ""
echo "✅ Migration request sent!"
echo ""
echo "📊 Checking statistics..."

# Wait a bit for migration to complete
sleep 5

# Check author stats
curl -s "${API_BASE}/api/authors/top?limit=1" | jq '.data.total' 2>/dev/null || echo "Stats check failed"

echo ""
echo "Next: Test Wikidata enrichment endpoint"
echo "  curl -X POST '${API_BASE}/api/authors/enrich-wikidata' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"limit\": 10}'"
