#!/bin/bash
#
# Alexandria Harvest Helper - Interactive Menu
#
# Provides user-friendly menu for common harvesting operations.
#
# Usage:
#   ./harvest-helper.sh
#

set -euo pipefail

ALEXANDRIA_URL="https://alexandria.ooheynerds.com"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "========================================"
echo "Alexandria Harvest Helper"
echo "========================================"
echo -e "${NC}"
echo ""
echo "Select an option:"
echo ""
echo "  1. Check quota status"
echo "  2. Check Worker health"
echo "  3. Harvest current month (2026-01)"
echo "  4. Harvest specific month"
echo "  5. Harvest year-to-date 2025"
echo "  6. Process top 1000 authors"
echo "  7. Test harvest (1 page only)"
echo "  8. View recent enrichment stats"
echo "  9. Exit"
echo ""
read -p "Select option [1-9]: " option

case $option in
  1)
    echo ""
    echo -e "${BLUE}ISBNdb Quota Status:${NC}"
    QUOTA=$(curl -s "$ALEXANDRIA_URL/api/quota/status")
    echo "$QUOTA" | jq '.data'

    USED=$(echo "$QUOTA" | jq -r '.data.used')
    REMAINING=$(echo "$QUOTA" | jq -r '.data.remaining')
    PERCENTAGE=$(echo "$QUOTA" | jq -r '.data.percentage_used')

    echo ""
    if [ "$REMAINING" -gt 5000 ]; then
      echo -e "${GREEN}✓ Quota healthy: $REMAINING calls remaining ($PERCENTAGE% used)${NC}"
    elif [ "$REMAINING" -gt 1000 ]; then
      echo -e "${YELLOW}⚠ Quota moderate: $REMAINING calls remaining ($PERCENTAGE% used)${NC}"
    else
      echo -e "${RED}✗ Quota low: $REMAINING calls remaining ($PERCENTAGE% used)${NC}"
    fi
    ;;

  2)
    echo ""
    echo -e "${BLUE}Worker Health Check:${NC}"
    HEALTH=$(curl -s "$ALEXANDRIA_URL/health")
    echo "$HEALTH" | jq

    STATUS=$(echo "$HEALTH" | jq -r '.data.status')
    if [ "$STATUS" = "ok" ]; then
      echo ""
      echo -e "${GREEN}✓ Worker healthy${NC}"
    else
      echo ""
      echo -e "${RED}✗ Worker unhealthy${NC}"
    fi
    ;;

  3)
    MONTH=$(date +%Y-%m)
    echo ""
    echo -e "${BLUE}Harvesting current month: $MONTH${NC}"
    echo "This will harvest up to 5,000 books (50 pages)..."
    read -p "Continue? [y/N]: " confirm

    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo ""
      echo "Starting harvest..."
      curl -s -X POST "$ALEXANDRIA_URL/api/books/enrich-new-releases" \
        -H "Content-Type: application/json" \
        -d "{\"start_month\":\"$MONTH\",\"end_month\":\"$MONTH\",\"max_pages_per_month\":50,\"skip_existing\":true}" \
        | jq '.data'
      echo ""
      echo -e "${GREEN}✓ Harvest complete${NC}"
    else
      echo "Cancelled"
    fi
    ;;

  4)
    echo ""
    read -p "Enter month to harvest (YYYY-MM): " MONTH

    # Validate format
    if ! [[ "$MONTH" =~ ^[0-9]{4}-[0-9]{2}$ ]]; then
      echo -e "${RED}ERROR: Invalid format. Use YYYY-MM (e.g., 2025-06)${NC}"
      exit 1
    fi

    echo ""
    echo -e "${BLUE}Harvesting $MONTH${NC}"
    echo "This will harvest up to 5,000 books (50 pages)..."
    read -p "Continue? [y/N]: " confirm

    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo ""
      echo "Starting harvest..."
      curl -s -X POST "$ALEXANDRIA_URL/api/books/enrich-new-releases" \
        -H "Content-Type: application/json" \
        -d "{\"start_month\":\"$MONTH\",\"end_month\":\"$MONTH\",\"max_pages_per_month\":50,\"skip_existing\":true}" \
        | jq '.data'
      echo ""
      echo -e "${GREEN}✓ Harvest complete${NC}"
    else
      echo "Cancelled"
    fi
    ;;

  5)
    echo ""
    echo -e "${BLUE}Harvesting year-to-date 2025${NC}"
    echo "This will harvest 2025-01 through 2025-12 (~60,000 books)"
    echo "Estimated API calls: 600"
    read -p "Continue? [y/N]: " confirm

    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo ""
      echo "Starting harvest..."
      "$REPO_ROOT/scripts/harvest-catchup-2025.sh"
    else
      echo "Cancelled"
    fi
    ;;

  6)
    echo ""
    echo -e "${BLUE}Processing top 1000 authors${NC}"
    echo "This will enrich ~100,000 books across 1000 authors"
    echo "Estimated API calls: 1000"
    read -p "Continue? [y/N]: " confirm

    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo ""
      cd "$REPO_ROOT"
      node scripts/bulk-author-harvest.js --tier top-1000
    else
      echo "Cancelled"
    fi
    ;;

  7)
    echo ""
    echo -e "${BLUE}Test Harvest (1 page)${NC}"
    echo "This will fetch 1 page (~100 books) from January 2025"
    echo "API calls: 1"
    read -p "Continue? [y/N]: " confirm

    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo ""
      echo "Running test..."
      RESPONSE=$(curl -s -X POST "$ALEXANDRIA_URL/api/books/enrich-new-releases" \
        -H "Content-Type: application/json" \
        -d '{"start_month":"2025-01","end_month":"2025-01","max_pages_per_month":1,"skip_existing":true}')

      echo "$RESPONSE" | jq '.data'

      SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
      if [ "$SUCCESS" = "true" ]; then
        echo ""
        echo -e "${GREEN}✓ Test successful${NC}"
      else
        echo ""
        echo -e "${RED}✗ Test failed${NC}"
      fi
    else
      echo "Cancelled"
    fi
    ;;

  8)
    echo ""
    echo -e "${BLUE}Recent Enrichment Activity (Last 7 Days):${NC}"
    echo ""

    # Note: This requires SSH access to the database server
    if command -v ssh &> /dev/null; then
      ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -t -A -F'|' -c \"
        SELECT
          DATE_TRUNC('day', created_at)::date as day,
          COUNT(*) as enriched_count
        FROM enriched_editions
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY 1
        ORDER BY 1 DESC;
      \"" | column -t -s'|'
    else
      echo -e "${YELLOW}SSH not available. Use Alexandria API instead:${NC}"
      curl -s "$ALEXANDRIA_URL/api/stats" | jq '.data.enriched'
    fi
    ;;

  9)
    echo "Goodbye!"
    exit 0
    ;;

  *)
    echo -e "${RED}Invalid option${NC}"
    exit 1
    ;;
esac

echo ""
