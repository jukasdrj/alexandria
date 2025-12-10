---
description: Check status of enriched tables and recent enrichment activity
---

Check the health and status of Alexandria's enriched tables, including recent enrichment activity.

## Steps

1. Check row counts and recent activity in enriched tables:
   ```bash
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
   SELECT
     'enriched_works' as table_name,
     COUNT(*) as total_rows,
     COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as created_1h,
     COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as created_24h
   FROM enriched_works
   UNION ALL
   SELECT
     'enriched_editions',
     COUNT(*),
     COUNT(CASE WHEN updated_at > NOW() - INTERVAL '1 hour' THEN 1 END),
     COUNT(CASE WHEN updated_at > NOW() - INTERVAL '24 hours' THEN 1 END)
   FROM enriched_editions
   UNION ALL
   SELECT
     'enriched_authors',
     COUNT(*),
     COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END),
     COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END)
   FROM enriched_authors;
   \""
   ```

2. Check recent enrichment samples (last 5 enriched editions):
   ```bash
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
   SELECT isbn, title, primary_provider, updated_at
   FROM enriched_editions
   WHERE updated_at > NOW() - INTERVAL '24 hours'
   ORDER BY updated_at DESC
   LIMIT 5;
   \""
   ```

3. Check index status:
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

4. Check recent statistics analysis:
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

5. Report status:
   - Row counts for each enriched table
   - **Recent activity (1h and 24h counts)**
   - Sample of recently enriched editions
   - Index sizes and status
   - When statistics were last analyzed
   - Any issues found

**Note**: enriched_editions uses upsert, so `updated_at` is the correct column for tracking recent activity (not `created_at`).
