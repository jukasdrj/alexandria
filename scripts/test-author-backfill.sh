#!/bin/bash
#
# Test Author Backfill Endpoint (Issue #186)
#
# Usage:
#   export ALEXANDRIA_WEBHOOK_SECRET="your-secret-here"
#   ./scripts/test-author-backfill.sh [batch_size] [dry_run]
#
# Examples:
#   ./scripts/test-author-backfill.sh 5 true    # Dry run with 5 works
#   ./scripts/test-author-backfill.sh 10 false  # Live test with 10 works
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-https://alexandria.ooheynerds.com}"
BATCH_SIZE="${1:-5}"
DRY_RUN="${2:-true}"

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Alexandria Author Backfill Test (Issue #186)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if ALEXANDRIA_WEBHOOK_SECRET is set
if [[ -z "${ALEXANDRIA_WEBHOOK_SECRET:-}" ]]; then
  echo -e "${RED}❌ Error: ALEXANDRIA_WEBHOOK_SECRET environment variable not set${NC}"
  echo ""
  echo "Please set it with:"
  echo "  export ALEXANDRIA_WEBHOOK_SECRET=your_secret_here"
  echo ""
  echo "To retrieve the secret from Cloudflare:"
  echo "  cd worker && npx wrangler secret list"
  echo "  # Note: You'll need to retrieve the actual value from your secure storage"
  echo ""
  exit 1
fi

echo -e "${GREEN}✓${NC} Webhook secret configured"
echo -e "${YELLOW}→${NC} API URL: ${API_URL}"
echo -e "${YELLOW}→${NC} Batch size: ${BATCH_SIZE} works"
echo -e "${YELLOW}→${NC} Dry run: ${DRY_RUN}"
echo ""

# Prepare request
REQUEST_BODY=$(cat <<EOF
{
  "batch_size": ${BATCH_SIZE},
  "dry_run": ${DRY_RUN}
}
EOF
)

echo -e "${BLUE}Sending request...${NC}"
echo ""

# Make request
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/internal/backfill-author-works" \
  -H "X-Cron-Secret: ${ALEXANDRIA_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d "${REQUEST_BODY}")

# Extract status code and body
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check status code
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo -e "${RED}❌ Request failed with HTTP ${HTTP_CODE}${NC}"
  echo ""
  echo "Response:"
  echo "${BODY}" | jq '.' 2>/dev/null || echo "${BODY}"
  exit 1
fi

echo -e "${GREEN}✓ Request successful (HTTP ${HTTP_CODE})${NC}"
echo ""

# Parse and display results
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Results${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Pretty print the JSON response
echo "${BODY}" | jq '.'

# Extract key metrics
WORKS_PROCESSED=$(echo "${BODY}" | jq -r '.works_processed // 0')
AUTHORS_LINKED=$(echo "${BODY}" | jq -r '.authors_linked // 0')
OPENLIB_HITS=$(echo "${BODY}" | jq -r '.openlib_direct_hits // 0')
EXTERNAL_HITS=$(echo "${BODY}" | jq -r '.external_api_hits // 0')
FAILED=$(echo "${BODY}" | jq -r '.failed // 0')
DURATION_MS=$(echo "${BODY}" | jq -r '.duration_ms // 0')

# Summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Works Processed:${NC}      ${WORKS_PROCESSED}"
echo -e "${GREEN}Authors Linked:${NC}       ${AUTHORS_LINKED}"
echo -e "${GREEN}OpenLibrary Direct:${NC}   ${OPENLIB_HITS}"
echo -e "${GREEN}External API Hits:${NC}    ${EXTERNAL_HITS}"
echo -e "${RED}Failed:${NC}               ${FAILED}"
echo -e "${YELLOW}Duration:${NC}             $(awk "BEGIN {printf \"%.2f\", ${DURATION_MS}/1000}") seconds"
echo ""

# Success rate
if [[ ${WORKS_PROCESSED} -gt 0 ]]; then
  SUCCESS_COUNT=$((WORKS_PROCESSED - FAILED))
  SUCCESS_RATE=$(awk "BEGIN {printf \"%.1f\", (${SUCCESS_COUNT}/${WORKS_PROCESSED})*100}")
  echo -e "${GREEN}Success Rate:${NC}         ${SUCCESS_RATE}%"
  echo ""
fi

# Dry run notice
if [[ "${DRY_RUN}" == "true" ]]; then
  echo -e "${YELLOW}ℹ${NC} This was a DRY RUN - no database changes were made"
  echo ""
  echo "To run a live test with 10 works:"
  echo "  ./scripts/test-author-backfill.sh 10 false"
else
  echo -e "${GREEN}✓${NC} Database has been updated with author mappings"
  echo ""
  echo "To validate, check a sample work:"
  echo "  curl 'https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873' | jq '.data.authors'"
fi

echo ""
echo -e "${GREEN}✓ Test complete!${NC}"
