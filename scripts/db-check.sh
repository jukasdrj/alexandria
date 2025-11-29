#!/bin/bash
# Check PostgreSQL database status and stats

echo "📊 Alexandria Database Status..."
echo ""

# Check if postgres container is running
echo "📦 PostgreSQL Container:"
ssh root@Tower.local "docker ps --filter name=postgres --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
echo ""

# Get database statistics
echo "📈 Database Statistics:"
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT 
    'Authors' as table_name, COUNT(*) as count FROM authors
UNION ALL
SELECT 'Works', COUNT(*) FROM works
UNION ALL  
SELECT 'Editions', COUNT(*) FROM editions
UNION ALL
SELECT 'ISBNs', COUNT(*) FROM edition_isbns
UNION ALL
SELECT 'Author-Works', COUNT(*) FROM author_works;
\""
echo ""

# Test a sample query
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
