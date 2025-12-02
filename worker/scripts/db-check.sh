#!/bin/bash
# Check PostgreSQL database status and run sample query

echo "📊 Alexandria Database Status..."
echo ""

# Check PostgreSQL container
echo "📦 PostgreSQL Container:"
ssh root@Tower.local "docker ps --filter name=postgres --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
echo ""

# Get database statistics
echo "📈 Database Statistics:"
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  'Authors' as table_name, COUNT(*) as count FROM authors
UNION ALL
SELECT 'Author-Works', COUNT(*) FROM author_works
UNION ALL
SELECT 'ISBNs', COUNT(*) FROM edition_isbns
UNION ALL
SELECT 'Works', COUNT(*) FROM works
UNION ALL
SELECT 'Editions', COUNT(*) FROM editions;
\""
echo ""

# Sample query (Harry Potter)
echo "🔍 Sample Query (Harry Potter ISBN):"
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
    e.data->>'title' AS title,
    a.data->>'name' AS author
FROM editions e
JOIN edition_isbns ei ON ei.edition_key = e.key
JOIN works w ON w.key = e.work_key
JOIN author_works aw ON aw.work_key = w.key
JOIN authors a ON aw.author_key = a.key
WHERE ei.isbn = '9780439064873'
LIMIT 1;
\""
echo ""

echo "✅ Database check complete"
