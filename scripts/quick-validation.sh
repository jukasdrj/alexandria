#!/bin/bash
# Quick Alexandria Workflow Validation
set -e

BASE_URL="https://alexandria.ooheynerds.com"
TEST_ISBN="9780439064873"  # Harry Potter

echo "═══════════════════════════════════════════════════════════════"
echo "  Alexandria Quick Workflow Validation"
echo "═══════════════════════════════════════════════════════════════"

echo -e "\n1️⃣  Health Check"
curl -s "$BASE_URL/health" | jq .

echo -e "\n2️⃣  Edition Lookup (enriched data)"
curl -s "$BASE_URL/api/editions/$TEST_ISBN" | jq '{isbn, title, quality: .isbndb_quality, provider: .primary_provider, cover: .cover_url_large}'

echo -e "\n3️⃣  Cover Endpoints (WebP processing)"
echo "   Large:"
curl -s -o /dev/null -w "   HTTP %{http_code}, Content-Type: %{content_type}, Size: %{size_download} bytes\n" "$BASE_URL/covers/$TEST_ISBN/large"
echo "   Medium:"
curl -s -o /dev/null -w "   HTTP %{http_code}, Content-Type: %{content_type}, Size: %{size_download} bytes\n" "$BASE_URL/covers/$TEST_ISBN/medium"
echo "   Small:"
curl -s -o /dev/null -w "   HTTP %{http_code}, Content-Type: %{content_type}, Size: %{size_download} bytes\n" "$BASE_URL/covers/$TEST_ISBN/small"

echo -e "\n4️⃣  Search API - ISBN"
curl -s "$BASE_URL/api/search?q=$TEST_ISBN&type=isbn" | jq '{total: .total, found: (.results | length > 0)}'

echo -e "\n5️⃣  Search API - Title"
curl -s "$BASE_URL/api/search?q=Harry%20Potter&type=title&limit=3" | jq '{total: .total, titles: [.results[]?.title]}'

echo -e "\n6️⃣  Batch Enrichment Test (queue 1 new ISBN)"
NEW_ISBN="9780451524935"  # 1984 by Orwell
curl -s -X POST "$BASE_URL/api/enrich/queue/batch" \
  -H "Content-Type: application/json" \
  -d "{\"isbns\": [\"$NEW_ISBN\"]}" | jq .

echo -e "\n   Waiting 30s for queue processing..."
sleep 30

echo "   Checking enrichment result:"
curl -s "$BASE_URL/api/editions/$NEW_ISBN" | jq '{isbn, title, quality: .isbndb_quality, provider: .primary_provider}'

echo -e "\n═══════════════════════════════════════════════════════════════"
echo "  Validation Complete"
echo "═══════════════════════════════════════════════════════════════"
