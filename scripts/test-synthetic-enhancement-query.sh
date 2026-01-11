#!/bin/bash
# Test synthetic works enhancement query performance
# Demonstrates EXPLAIN ANALYZE before/after index creation

set -e

echo "======================================================================"
echo "Synthetic Works Enhancement Query Test"
echo "======================================================================"
echo ""

# Check if we should explain or just query
MODE="${1:-explain}"  # explain, query, or count

if [ "$MODE" = "count" ]; then
    echo "📊 Counting synthetic works needing enhancement..."
    echo ""

    ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary" << 'EOF'
SELECT
    COUNT(*) as total_synthetic_works,
    COUNT(*) FILTER (WHERE completeness_score < 50) as needs_enhancement,
    COUNT(*) FILTER (WHERE completeness_score >= 50) as already_enhanced,
    COUNT(*) FILTER (WHERE last_isbndb_sync IS NULL) as never_attempted
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill';
EOF

elif [ "$MODE" = "explain" ]; then
    echo "🔍 Running EXPLAIN ANALYZE (shows index usage and performance)..."
    echo ""

    ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary" << 'EOF'
EXPLAIN ANALYZE
SELECT
    work_key,
    title,
    (metadata#>>'{}')::jsonb->>'gemini_author' as author,
    (metadata#>>'{}')::jsonb->>'gemini_publisher' as publisher,
    completeness_score,
    created_at,
    last_isbndb_sync
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
  AND last_isbndb_sync IS NULL
ORDER BY created_at ASC
LIMIT 100;
EOF

    echo ""
    echo "✅ Check output for index usage:"
    echo "   - GOOD: 'Index Scan using idx_enriched_works_synthetic_enhancement'"
    echo "   - BAD:  'Seq Scan on enriched_works'"
    echo ""

elif [ "$MODE" = "query" ]; then
    echo "📖 Fetching synthetic works needing enhancement (first 10)..."
    echo ""

    ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary" << 'EOF'
SELECT
    work_key,
    title,
    (metadata#>>'{}')::jsonb->>'gemini_author' as author,
    (metadata#>>'{}')::jsonb->>'gemini_publisher' as publisher,
    completeness_score,
    TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
    TO_CHAR(last_isbndb_sync, 'YYYY-MM-DD HH24:MI:SS') as last_sync
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
  AND last_isbndb_sync IS NULL
ORDER BY created_at ASC
LIMIT 10;
EOF

else
    echo "❌ Invalid mode: $MODE"
    echo ""
    echo "Usage: $0 [mode]"
    echo ""
    echo "Modes:"
    echo "  count   - Count synthetic works (total, enhanced, needs enhancement)"
    echo "  explain - Show EXPLAIN ANALYZE (check index usage)"
    echo "  query   - Fetch first 10 synthetic works needing enhancement"
    echo ""
    echo "Example:"
    echo "  $0 count          # Count synthetic works"
    echo "  $0 explain        # Check query performance"
    echo "  $0 query          # Show first 10 results"
    exit 1
fi

echo ""
echo "======================================================================"
echo "Test complete!"
echo "======================================================================"
