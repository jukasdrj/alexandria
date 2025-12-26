---
description: Execute a database query via SSH tunnel for testing
allowed-tools:
  - Bash
  - Read
---

Execute a PostgreSQL query against the Alexandria database via SSH.

## Usage

Run the query via docker exec:

```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c '[QUERY]'"
```

## Important Notes

- This is for **testing queries only** before implementing in Worker code
- For production queries, use the Worker with Hyperdrive
- Always use EXPLAIN ANALYZE for performance testing
- Results may be truncated for large result sets

## Common Queries

### Check table counts:
```sql
SELECT 'editions' as table, count(*) FROM editions
UNION ALL
SELECT 'works', count(*) FROM works
UNION ALL
SELECT 'authors', count(*) FROM authors;
```

### Check indexes:
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'editions';
```

### Test ISBN lookup:
```sql
EXPLAIN ANALYZE SELECT * FROM edition_isbns WHERE isbn = '9780439064873';
```
