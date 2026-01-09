# ANALYZE Fix Results - PostgreSQL Statistics Repair

**Date**: 2026-01-09
**Issue**: GitHub Issue #159 (Database Organization Performance)
**Action**: Ran ANALYZE on all core OpenLibrary tables

## Problem Discovered

The PostgreSQL query planner had **catastrophically wrong statistics** for core tables:

| Table | pg_stat said | Reality | Discrepancy |
|-------|-------------|---------|-------------|
| work_authors_enriched | 56 rows | 24.5M rows | 437,660x off! |
| author_works | 0 rows | 42.8M rows | ∞ |
| works | 0 rows | 40M+ rows | ∞ |
| authors | 0 rows | 14.7M rows | ∞ |
| editions | 0 rows | 54.8M rows | ∞ |

**Root Cause**: Core OpenLibrary tables are bulk-loaded and read-only. No updates/deletes → autovacuum never runs → ANALYZE never runs → PostgreSQL has no idea how many rows exist.

## Fix Applied

```sql
ANALYZE authors;
ANALYZE works;
ANALYZE editions;
ANALYZE author_works;
ANALYZE edition_isbns;
ANALYZE work_authors_enriched;
```

## Results After ANALYZE

### Statistics Now Accurate

```
        relname        | live_tuples | dead_tuples |         last_analyze
-----------------------+-------------+-------------+-------------------------------
 author_works          |    42,881,121 |        3,062 | 2026-01-09 14:45:14.230522-06
 authors               |    14,711,451 |        3,635 | 2026-01-09 14:45:04.487069-06
 edition_isbns         |    49,330,595 |        3,060 | 2026-01-09 14:45:14.419109-06
 editions              |    54,858,265 |        4,285 | 2026-01-09 14:45:08.203444-06
 work_authors_enriched |    24,490,663 |          23 | 2026-01-09 14:45:14.632081-06
 works                 |    40,197,889 |        2,642 | 2026-01-09 14:45:06.17133-06
```

### Query Performance - "Top 100 Authors"

**Test Query**:
```sql
SELECT a.key, a.data->>'name' as name, COUNT(DISTINCT wae.work_key) as work_count
FROM authors a
JOIN work_authors_enriched wae ON a.key = wae.author_key
GROUP BY a.key, a.data->>'name'
ORDER BY work_count DESC
LIMIT 100;
```

**Execution Time**: 23.5 seconds (28.6 seconds wall clock)

**Query Plan Analysis**:
- ✅ **Merge Join** used (good choice for sorted data)
- ✅ **Index scans** on both tables (efficient)
- ✅ **Accurate row estimates** (planner now knows true sizes)
- ⚠️ **Still slow** due to:
  - Processing 24.5M rows from work_authors_enriched
  - GroupAggregate on 8.1M distinct authors
  - COUNT(DISTINCT) operation on 24.5M rows
  - JIT compilation overhead: 75ms

### Key Findings

1. **ANALYZE Fixed Statistics** ✅
   - PostgreSQL now knows true table sizes
   - Query planner making informed decisions
   - Using efficient Merge Join instead of Nested Loop

2. **Performance Still Limited** ⚠️
   - Not a statistics problem, but a **query complexity problem**
   - Must process ALL 24.5M work-author relationships
   - Must compute DISTINCT counts for ALL 8.1M authors to find top 100
   - JIT overhead minimal (75ms out of 23.5s = 0.3%)

3. **Remaining Bottlenecks**:
   - **GroupAggregate**: 23 seconds
   - **Incremental Sort**: External merge sort using disk (2.7MB peak)
   - **No index** can help - must scan all relationships to find top authors

## Impact Assessment

### What ANALYZE Fixed
- ✅ Query planner accuracy
- ✅ Eliminated risk of Nested Loop joins
- ✅ Foundation for future optimizations

### What ANALYZE Didn't Fix
- ❌ Still 23+ second queries for "Top Authors"
- ❌ Must still scan 24.5M rows
- ❌ Must still count distinct works for all authors

## Recommended Next Steps

### 1. Materialized View for Top Authors (HIGH PRIORITY)
Create a pre-computed table with author work counts:

```sql
CREATE MATERIALIZED VIEW top_authors AS
SELECT
  a.key as author_key,
  a.data->>'name' as name,
  COUNT(DISTINCT wae.work_key) as work_count
FROM authors a
JOIN work_authors_enriched wae ON a.key = wae.author_key
GROUP BY a.key, a.data->>'name';

CREATE INDEX idx_top_authors_work_count ON top_authors(work_count DESC);
```

**Impact**: Query time: 23s → <100ms

### 2. Disable JIT for OLTP Queries (MEDIUM PRIORITY)
JIT provides minimal benefit (0.3% of query time) but adds planning overhead.

```sql
ALTER DATABASE openlibrary SET jit = off;
```

**Impact**: Reduces planning time from 310ms → ~50ms

### 3. Regular ANALYZE Schedule (HIGH PRIORITY)
Set up cron job to run ANALYZE weekly on all tables:

```bash
0 2 * * 0 ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'ANALYZE;'"
```

**Impact**: Ensures statistics stay accurate as data evolves

## Conclusion

**ANALYZE was essential** - fixed catastrophic statistics problem and eliminated risk of terrible query plans.

**But not sufficient** - the "Top Authors" query is fundamentally expensive due to data volume. Need materialized views or application-level caching for production performance.

**Status**: Database is now properly maintained and ready for production optimizations.

---

**Next Actions**:
1. ✅ ANALYZE complete - statistics accurate
2. ⏳ Create materialized view for top authors
3. ⏳ Disable JIT for OLTP workload
4. ⏳ Schedule weekly ANALYZE job
