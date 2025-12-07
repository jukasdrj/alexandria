---
description: Check status of enriched tables and recent enrichment activity
---

Check the health and status of Alexandria's enriched tables.

## Steps

1. Check row counts in enriched tables:
   ```bash
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
   SELECT
     'enriched_works' as table_name, COUNT(*) as rows FROM enriched_works
   UNION ALL
   SELECT 'enriched_editions', COUNT(*) FROM enriched_editions
   UNION ALL
   SELECT 'enriched_authors', COUNT(*) FROM enriched_authors;
   \""
   ```

2. Check index status:
   ```bash
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
   SELECT
     schemaname,
     tablename,
     indexname,
     pg_size_pretty(pg_relation_size(indexrelid)) as size
   FROM pg_stat_user_indexes
   WHERE schemaname = 'public'
     AND tablename LIKE 'enriched_%'
   ORDER BY tablename, indexname;
   \""
   ```

3. Check recent statistics analysis:
   ```bash
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
   SELECT
     schemaname,
     tablename,
     last_analyze,
     last_autoanalyze,
     n_live_tup as live_rows
   FROM pg_stat_user_tables
   WHERE tablename LIKE 'enriched_%';
   \""
   ```

4. Report status:
   - Row counts for each enriched table
   - Index sizes and status
   - When statistics were last analyzed
   - Any issues found
