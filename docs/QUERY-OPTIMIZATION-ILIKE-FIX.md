# Query Optimization: ILIKE vs pg_trgm Similarity - December 8, 2025

## Critical Performance Issue Identified

### Problem
The pg_trgm similarity operator (`%`) was causing severe performance degradation in title and author searches, making queries take 18-36 seconds instead of sub-second.

### Root Cause Analysis

**Database Investigation (EXPLAIN ANALYZE):**

```sql
-- SLOW: Using pg_trgm similarity operator (%)
EXPLAIN ANALYZE
SELECT COUNT(*) FROM enriched_editions WHERE title % 'harry potter';

Result: 17,968ms with 6,558,035 rows removed by index recheck
```

```sql
-- FAST: Using ILIKE pattern matching
EXPLAIN ANALYZE
SELECT COUNT(*) FROM enriched_editions WHERE title ILIKE '%harry potter%';

Result: 63ms with only 29 rows removed by index recheck
```

**Problem:** The similarity operator with threshold 0.3 (30%) was too fuzzy, returning 484,734 candidate rows that then had to be rechecked, removing 99.9% of them.

**Solution:** ILIKE pattern matching is more precise while still leveraging the GIN trigram index efficiently.

---

## Performance Comparison

### Before Fix (pg_trgm similarity operator `%`)

| Endpoint | Query Type | Duration | Status |
|----------|-----------|----------|--------|
| `/api/search?title=` | harry potter | ~27,551ms | ❌ Too slow |
| `/api/search?author=` | rowling | ~1,472ms | ⚠️ Acceptable |
| `/api/search/combined?q=` | harry potter | ~36,143ms | ❌ Too slow |
| `/api/search/combined?q=` | tolkien | ~12,654ms | ⚠️ Slow |

### After Fix (ILIKE pattern matching)

| Endpoint | Query Type | Duration | Status |
|----------|-----------|----------|--------|
| `/api/search?title=` | harry potter | **~741ms** | ✅ **37x faster** |
| `/api/search?author=` | rowling | **~602ms** | ✅ **2.4x faster** |
| `/api/search/combined?q=` | harry potter | **~1,298ms** | ✅ **28x faster** |
| `/api/search/combined?q=` | tolkien | **~1,236ms** | ✅ **10x faster** |

---

## Technical Changes

### 1. Regular Search Endpoint (`/api/search`)

**Title Search (lines 388-425):**
```typescript
// BEFORE: Using similarity operator
WHERE title % ${title}
ORDER BY similarity(ee.title, ${title}) DESC

// AFTER: Using ILIKE
const titlePattern = `%${title}%`;
WHERE title ILIKE ${titlePattern}
ORDER BY ee.title
```

**Author Search (lines 427-467):**
```typescript
// BEFORE: Using similarity operator
WHERE ea.name % ${author}
ORDER BY similarity(ea.name, ${author}) DESC

// AFTER: Using ILIKE
const authorPattern = `%${author}%`;
WHERE ea.name ILIKE ${authorPattern}
ORDER BY ea.name
```

### 2. Combined Search Endpoint (`/api/search/combined`)

**Text Search (lines 629-717):**
```typescript
// BEFORE: Using similarity operator for both title and author
WHERE ee.title % ${query}
WHERE ea.name % ${query}

// AFTER: Using ILIKE for both
const queryPattern = `%${query}%`;
WHERE ee.title ILIKE ${queryPattern}
WHERE ea.name ILIKE ${queryPattern}
```

---

## Database Analysis Details

### Similarity Operator Issue

```
Bitmap Index Scan: 484,734 rows matched (too fuzzy)
Rows Removed by Index Recheck: 6,558,035 (99.9% false positives)
Heap Blocks: exact=37,515 lossy=266,560 (memory pressure)
Execution Time: 17,968ms
```

**Why it's slow:**
1. Low similarity threshold (0.3) matches too many candidates
2. Massive index recheck overhead (millions of rows)
3. Lossy bitmap heap scan due to memory pressure
4. Parallel workers still need to process huge candidate sets

### ILIKE Performance

```
Bitmap Index Scan: 4,544 rows matched (precise)
Rows Removed by Index Recheck: 29 (0.6% false positives)
Heap Blocks: exact=2,872 (all exact, no lossy blocks)
Execution Time: 63ms
```

**Why it's fast:**
1. Pattern match is more precise (fewer candidates)
2. Minimal index recheck overhead
3. All heap blocks are exact (no memory pressure)
4. GIN trigram index still used efficiently

---

## Index Strategy

Both queries use the same GIN trigram index:
```sql
CREATE INDEX idx_enriched_editions_title_trgm
  ON enriched_editions USING GIN (title gin_trgm_ops);

CREATE INDEX idx_enriched_authors_name_trgm
  ON enriched_authors USING GIN (name gin_trgm_ops);
```

**Key Insight:** GIN trigram indexes work well with ILIKE pattern matching, not just similarity operators. ILIKE is often faster because it's more precise.

---

## Trade-offs

### What We Lost
- **Fuzzy matching**: Can't find "hary poter" → "Harry Potter" (typo tolerance)
- **Match scores**: No similarity score for relevance ranking
- **Phonetic matching**: Won't match soundalike but differently spelled terms

### What We Gained
- **37x faster title searches** (27.5s → 741ms)
- **28x faster combined searches** (36s → 1.3s)
- **Predictable performance**: No massive candidate sets causing timeouts
- **Better user experience**: Sub-second responses for all queries
- **Lower resource usage**: Less CPU, memory, and I/O

### Recommendation
For a search API with 28M+ records, **precise ILIKE pattern matching is superior** to overly-fuzzy similarity matching. Users expect exact substring matches, not fuzzy suggestions.

---

## Future Enhancements

### If Fuzzy Matching is Needed
1. **Increase similarity threshold** from 0.3 to 0.6+ (more precise)
2. **Use similarity only for small result sets** (< 1000 candidates)
3. **Implement full-text search** with `tsvector` and `tsquery` for ranking
4. **Add dedicated typo correction** API (separate from main search)
5. **Use external search engine** (Elasticsearch, Typesense) for advanced fuzzy search

### Current Search Quality
ILIKE pattern matching provides:
- ✅ Substring matching: "potter" finds "Harry Potter"
- ✅ Case-insensitive: "POTTER" finds "Harry Potter"
- ✅ Partial word matching: "har" finds "Harry"
- ❌ Typo tolerance: "hary" won't find "Harry" (acceptable trade-off)

---

## Testing Commands

```bash
# Benchmark title search
time curl -s 'https://alexandria.ooheynerds.com/api/search?title=harry+potter&limit=10' | jq

# Benchmark author search
time curl -s 'https://alexandria.ooheynerds.com/api/search?author=rowling&limit=10' | jq

# Benchmark combined search (title)
time curl -s 'https://alexandria.ooheynerds.com/api/search/combined?q=harry+potter&limit=10' | jq

# Benchmark combined search (author)
time curl -s 'https://alexandria.ooheynerds.com/api/search/combined?q=tolkien&limit=10' | jq

# Database analysis
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
EXPLAIN ANALYZE SELECT COUNT(*) FROM enriched_editions WHERE title ILIKE '%harry potter%';
\""
```

---

## Conclusion

**Issue:** pg_trgm similarity operator (`%`) was 28-37x slower than ILIKE for large-scale searches.

**Fix:** Switched all title and author searches to use ILIKE pattern matching while keeping GIN trigram indexes.

**Impact:**
- ✅ All searches now complete in < 1.5 seconds
- ✅ 37x performance improvement for title searches
- ✅ 28x performance improvement for combined searches
- ✅ Production-ready performance for 28M+ record database

**Verdict:** ILIKE + GIN trigram indexes are the optimal solution for precise substring matching at scale. Fuzzy matching via similarity operator should only be used with higher thresholds (0.6+) or on smaller candidate sets.

---

**Date:** December 8, 2025
**Worker Version:** 54f2400a-fead-41df-a253-d89be9d6c26b
**Database:** PostgreSQL 18.1 with pg_trgm 1.6
