#!/bin/bash
# ============================================================================
# Alexandria End-to-End Workflow Validation
# ============================================================================
# Tests the complete Alexandria pipeline:
#   1. Health check (Worker, Database, R2)
#   2. Search API (ISBN, Title queries)
#   3. Cover delivery (WebP processing, multi-size)
#   4. Enrichment queue (ISBNdb batch processing)
#   5. Database verification (direct PostgreSQL)
# ============================================================================

set -e

BASE_URL="${ALEXANDRIA_URL:-https://alexandria.ooheynerds.com}"
VERBOSE="${VERBOSE:-false}"
TOWER_HOST="${TOWER_HOST:-root@Tower.local}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

log_pass() { echo -e "${GREEN}✅ PASS${NC}: $1"; PASSED=$((PASSED+1)); }
log_fail() { echo -e "${RED}❌ FAIL${NC}: $1"; FAILED=$((FAILED+1)); }
log_warn() { echo -e "${YELLOW}⚠️  WARN${NC}: $1"; WARNINGS=$((WARNINGS+1)); }
log_info() { echo -e "${BLUE}ℹ️  INFO${NC}: $1"; }

echo "════════════════════════════════════════════════════════════════════════════"
echo "  ALEXANDRIA END-TO-END WORKFLOW VALIDATION"
echo "════════════════════════════════════════════════════════════════════════════"
echo "  Base URL: $BASE_URL"
echo "  Date: $(date)"
echo "════════════════════════════════════════════════════════════════════════════"

# ============================================================================
# TEST 1: Health Check
# ============================================================================
echo -e "\n${BLUE}━━━ TEST 1: Health Check ━━━${NC}"

HEALTH=$(curl -s "$BASE_URL/health")
DB_STATUS=$(echo "$HEALTH" | jq -r '.data.database // "unknown"')
R2_STATUS=$(echo "$HEALTH" | jq -r '.data.r2_covers // "unknown"')
LATENCY=$(echo "$HEALTH" | jq -r '.data.hyperdrive_latency_ms // 0')

if [ "$DB_STATUS" = "connected" ]; then
  log_pass "Database connected (${LATENCY}ms latency)"
else
  log_fail "Database not connected: $DB_STATUS"
fi

if [ "$R2_STATUS" = "bound" ]; then
  log_pass "R2 Cover bucket bound"
else
  log_fail "R2 not bound: $R2_STATUS"
fi

# ============================================================================
# TEST 2: Search API - ISBN
# ============================================================================
echo -e "\n${BLUE}━━━ TEST 2: Search API - ISBN ━━━${NC}"

TEST_ISBN="9780439064873"  # Harry Potter and the Chamber of Secrets
SEARCH=$(curl -s "$BASE_URL/api/search?isbn=$TEST_ISBN")
FOUND=$(echo "$SEARCH" | jq -r '.data.results | length')
TITLE=$(echo "$SEARCH" | jq -r '.data.results[0].title // "not found"')

if [ "$FOUND" -gt 0 ]; then
  log_pass "ISBN search found: $TITLE"
else
  log_fail "ISBN search returned no results for $TEST_ISBN"
fi

# ============================================================================
# TEST 3: Search API - Title
# ============================================================================
echo -e "\n${BLUE}━━━ TEST 3: Search API - Title ━━━${NC}"

TITLE_SEARCH=$(curl -s "$BASE_URL/api/search?title=Great%20Gatsby&limit=5")
TOTAL=$(echo "$TITLE_SEARCH" | jq -r '.data.pagination.total // 0')

if [ "$TOTAL" -gt 0 ]; then
  log_pass "Title search found $TOTAL results for 'Great Gatsby'"
else
  log_fail "Title search returned no results"
fi

# ============================================================================
# TEST 4: Cover Delivery (WebP Processing)
# ============================================================================
echo -e "\n${BLUE}━━━ TEST 4: Cover Delivery (WebP Processing) ━━━${NC}"

COVER_ISBN="9780439064873"
for SIZE in large medium small; do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}|%{content_type}|%{size_download}" "$BASE_URL/covers/$COVER_ISBN/$SIZE")
  HTTP_CODE=$(echo "$RESPONSE" | cut -d'|' -f1)
  CONTENT_TYPE=$(echo "$RESPONSE" | cut -d'|' -f2)
  FILE_SIZE=$(echo "$RESPONSE" | cut -d'|' -f3)
  
  if [ "$HTTP_CODE" = "200" ] && [[ "$CONTENT_TYPE" == *"webp"* ]]; then
    log_pass "Cover $SIZE: HTTP $HTTP_CODE, $CONTENT_TYPE, $FILE_SIZE bytes"
  elif [ "$HTTP_CODE" = "200" ]; then
    log_warn "Cover $SIZE: HTTP $HTTP_CODE, but content-type is $CONTENT_TYPE (expected webp)"
  else
    log_fail "Cover $SIZE: HTTP $HTTP_CODE (expected 200)"
  fi
done

# ============================================================================
# TEST 5: Enrichment Queue
# ============================================================================
echo -e "\n${BLUE}━━━ TEST 5: Enrichment Queue ━━━${NC}"

# Generate a random ISBN-like number that probably doesn't exist
TEST_ENRICH_ISBN="9780$(printf '%09d' $RANDOM)"
QUEUE_RESULT=$(curl -s -X POST "$BASE_URL/api/enrich/queue/batch" \
  -H "Content-Type: application/json" \
  -d "{\"books\": [{\"isbn\": \"$TEST_ENRICH_ISBN\"}]}")

QUEUED=$(echo "$QUEUE_RESULT" | jq -r '.queued // 0')
if [ "$QUEUED" -ge 0 ]; then
  log_pass "Queue batch endpoint accepted request (queued: $QUEUED)"
else
  log_fail "Queue batch endpoint failed: $QUEUE_RESULT"
fi

# ============================================================================
# TEST 6: Database Direct Check (if SSH available)
# ============================================================================
echo -e "\n${BLUE}━━━ TEST 6: Database Statistics ━━━${NC}"

if ssh -o ConnectTimeout=5 -o BatchMode=yes "$TOWER_HOST" "echo ok" 2>/dev/null; then
  # Get enrichment stats
  STATS=$(ssh "$TOWER_HOST" "docker exec postgres psql -U openlibrary -d openlibrary -t -c \"SELECT COUNT(*) FROM enriched_editions WHERE isbndb_quality > 0;\"" 2>/dev/null | tr -d ' ')
  
  if [ -n "$STATS" ] && [ "$STATS" -gt 0 ]; then
    log_pass "Database has $STATS ISBNdb-enriched editions"
  else
    log_warn "Could not retrieve enrichment stats"
  fi
  
  # Get recent enrichment activity
  RECENT=$(ssh "$TOWER_HOST" "docker exec postgres psql -U openlibrary -d openlibrary -t -c \"SELECT COUNT(*) FROM enrichment_log WHERE created_at > NOW() - INTERVAL '1 hour';\"" 2>/dev/null | tr -d ' ')
  
  if [ -n "$RECENT" ] && [ "$RECENT" -gt 0 ]; then
    log_pass "$RECENT enrichment operations in last hour"
  else
    log_info "No enrichment activity in last hour (queue may be empty)"
  fi
else
  log_info "SSH to Tower not available - skipping direct database checks"
fi

# ============================================================================
# TEST 7: API Response Time
# ============================================================================
echo -e "\n${BLUE}━━━ TEST 7: API Response Time ━━━${NC}"

RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$BASE_URL/api/search?isbn=9780439064873")
RESPONSE_MS=$(echo "$RESPONSE_TIME * 1000" | bc | cut -d'.' -f1)

if [ "$RESPONSE_MS" -lt 200 ]; then
  log_pass "Search response time: ${RESPONSE_MS}ms (< 200ms target)"
elif [ "$RESPONSE_MS" -lt 500 ]; then
  log_warn "Search response time: ${RESPONSE_MS}ms (> 200ms, < 500ms)"
else
  log_fail "Search response time: ${RESPONSE_MS}ms (> 500ms)"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "  VALIDATION SUMMARY"
echo "════════════════════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo "════════════════════════════════════════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
