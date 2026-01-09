# Query Optimization Opportunities - Post Phase 1 & 2 Analysis

**Date**: 2026-01-09
**Context**: After completing Phase 1 (index cleanup + config) and Phase 2 (mv_author_stats), analyzing remaining optimization opportunities

## Summary

Identified 3 major optimization candidates:
1. **Stats Endpoint** - 13 second query (9 COUNT queries) → Materialized view
2. **Genre/Subject Queries** - Missing indexes, 36% coverage issues
3. **Sequential Scans** - enriched_editions still has 719 seq scans (6.9B tuples)

---

## 1. Stats Endpoint Performance (HIGH PRIORITY)

### Current State

**Endpoint**: `GET /api/stats`
**Query Time**: 13 seconds
**Problem**: 9 separate COUNT(*) queries on large tables

```sql
SELECT
  (SELECT COUNT(*) FROM enriched_editions) as enriched_editions,
  (SELECT COUNT(*) FROM enriched_editions WHERE updated_at > NOW() - INTERVAL '1 hour') as enriched_editions_1h,
  (SELECT COUNT(*) FROM enriched_editions WHERE updated_at > NOW() - INTERVAL '24 hours') as enriched_editions_24h,
  (SELECT COUNT(*) FROM enriched_works) as enriched_works,
  (SELECT COUNT(*) FROM enriched_works WHERE created_at > NOW() - INTERVAL '1 hour') as enriched_works_1h,
  (SELECT COUNT(*) FROM enriched_works WHERE created_at > NOW() - INTERVAL '24 hours') as enriched_works_24h,
  (SELECT COUNT(*) FROM enriched_authors) as enriched_authors,
  (SELECT COUNT(*) FROM enriched_authors WHERE created_at > NOW() - INTERVAL '1 hour') as enriched_authors_1h,
  (SELECT COUNT(*) FROM enriched_authors WHERE created_at > NOW() - INTERVAL '24 hours') as enriched_authors_24h;
```

**Current Performance**: 13.3 seconds

### Bottlenecks

1. **Full table scans**: COUNT(*) requires scanning entire tables
   - enriched_editions: 28.7M rows
   - enriched_works: 21.3M rows
   - enriched_authors: 14.7M rows

2. **No indexes** on timestamp columns for time-range queries

3. **9 separate queries** when could be pre-computed

### Recommended Solution: Materialized View

```sql
CREATE MATERIALIZED VIEW mv_stats AS
SELECT
  -- Total counts
  (SELECT COUNT(*) FROM enriched_editions) as total_editions,
  (SELECT COUNT(*) FROM enriched_works) as total_works,
  (SELECT COUNT(*) FROM enriched_authors) as total_authors,

  -- Recent activity (1 hour)
  (SELECT COUNT(*) FROM enriched_editions WHERE updated_at > NOW() - INTERVAL '1 hour') as editions_1h,
  (SELECT COUNT(*) FROM enriched_works WHERE created_at > NOW() - INTERVAL '1 hour') as works_1h,
  (SELECT COUNT(*) FROM enriched_authors WHERE created_at > NOW() - INTERVAL '1 hour') as authors_1h,

  -- Recent activity (24 hours)
  (SELECT COUNT(*) FROM enriched_editions WHERE updated_at > NOW() - INTERVAL '24 hours') as editions_24h,
  (SELECT COUNT(*) FROM enriched_works WHERE created_at > NOW() - INTERVAL '24 hours') as works_24h,
  (SELECT COUNT(*) FROM enriched_authors WHERE created_at > NOW() - INTERVAL '24 hours') as authors_24h,

  -- Subject coverage
  (SELECT COUNT(*) FROM enriched_works WHERE subject_tags IS NOT NULL AND array_length(subject_tags, 1) > 0) as works_with_subjects,
  (SELECT ROUND(AVG(array_length(subject_tags, 1))) FROM enriched_works WHERE subject_tags IS NOT NULL) as avg_subjects_per_work,

  -- Core OpenLibrary counts
  (SELECT COUNT(*) FROM editions) as ol_editions,
  (SELECT COUNT(*) FROM works) as ol_works,
  (SELECT COUNT(*) FROM authors) as ol_authors,

  -- Timestamp
  NOW() as computed_at;
```

**Expected Impact**: 13s → <1ms (13,000x speedup)

**Refresh Strategy**: Every 15 minutes (stats don't need real-time accuracy)

```bash
# Cron: Refresh every 15 minutes
*/15 * * * * docker exec postgres psql -U openlibrary -d openlibrary -c "REFRESH MATERIALIZED VIEW mv_stats;" >> /var/log/alexandria-stats-refresh.log 2>&1
```

**Staleness**: Maximum 15 minutes old (acceptable for dashboard stats)

---

## 2. Genre/Subject Data Quality (MEDIUM PRIORITY)

### Current State

**Coverage Analysis**:
```
Total works: 21,324,332
Works with subjects: 7,717,302 (36.19%)
Average subjects per work: 1.43
Max subjects per work: 114
```

**Issues Identified**:

1. **Low Coverage**: Only 36% of works have subject tags
2. **No indexes** on subject_tags for subject-based queries
3. **Inconsistent formatting**: Mix of "Fiction" vs "Fiction, general" vs "Fiction, romance, general"

### Top 20 Subjects

| Subject | Work Count |
|---------|------------|
| History | 850,153 |
| Fiction | 437,867 |
| Biography | 366,775 |
| Children's fiction | 275,907 |
| Congresses | 191,292 |
| History and criticism | 180,308 |
| Juvenile literature | 177,472 |
| Politics and government | 175,251 |
| Juvenile fiction | 125,662 |
| Fiction, general | 124,589 |
| Fiction, romance, general | 119,084 |
| Education | 118,237 |
| Criticism and interpretation | 104,106 |
| Religion | 99,504 |
| Exhibitions | 96,651 |

### Optimization Opportunities

#### Option A: GIN Index on subject_tags (Query Optimization)

```sql
CREATE INDEX idx_enriched_works_subjects ON enriched_works USING GIN (subject_tags);
```

**Benefits**:
- Fast "find works by subject" queries
- Supports `WHERE 'Fiction' = ANY(subject_tags)`
- Enables `WHERE subject_tags @> ARRAY['Fiction', 'Romance']` containment queries

**Cost**: ~500MB-1GB index size (estimate)

**Query Performance**:
- Before: Sequential scan of 21M works
- After: Index scan of matching works

#### Option B: Materialized View for Popular Subjects

```sql
CREATE MATERIALIZED VIEW mv_subject_stats AS
SELECT
  unnest(subject_tags) as subject,
  COUNT(*) as work_count,
  AVG(completeness_score) as avg_completeness,
  COUNT(DISTINCT primary_provider) as provider_count
FROM enriched_works
WHERE subject_tags IS NOT NULL
GROUP BY subject
ORDER BY work_count DESC;

CREATE INDEX idx_mv_subject_stats_subject ON mv_subject_stats(subject);
CREATE INDEX idx_mv_subject_stats_count ON mv_subject_stats(work_count DESC);
```

**Use Cases**:
- `/api/subjects/popular` - Top subjects by work count
- `/api/subjects/{subject}/stats` - Subject-specific statistics
- Subject autocomplete
- Genre browsing UI

**Refresh**: Daily (subjects don't change often)

#### Option C: Improve Coverage (Data Quality)

**Current gaps**: 13.6M works (64%) missing subjects

**Sources to enhance coverage**:
1. Google Books API (has categories/subjects)
2. ISBNdb (has subjects, though sometimes messy)
3. OpenLibrary works table (has `data->>'subjects'` array)
4. Gemini backfill (can infer genres from titles/descriptions)

**Implementation**: Enhance enrichment pipeline to extract subjects from multiple sources

### Recommended Approach

**Phase 1** (Immediate):
- Create GIN index on `subject_tags` (500MB-1GB)
- Enables fast subject queries NOW

**Phase 2** (Short-term):
- Create `mv_subject_stats` materialized view
- Provides instant subject browsing/stats

**Phase 3** (Long-term):
- Enhance enrichment pipeline to improve 64% missing coverage
- Add subject extraction from Google Books, OpenLibrary data
- Standardize subject names (normalize casing, handle duplicates)

---

## 3. Sequential Scan Analysis (MEDIUM PRIORITY)

### enriched_editions - 719 Sequential Scans

**Stats**:
- Sequential scans: 719
- Tuples read: 6,935,493,143 (6.9 billion!)
- Index scans: 128,769
- Sequential scan percentage: 0.56%
- Table size: 9.2GB (28.7M rows)

**Why Sequential Scans?**

Looking at code patterns, common queries:
1. Stats endpoint: `COUNT(*)` queries
2. Deduplication: ISBN lookups, title similarity searches
3. Search endpoints: Title searches with ILIKE
4. Harvest: ISBN existence checks

### Queries Causing Sequential Scans

**Query Pattern 1: COUNT(*) with time ranges**
```sql
SELECT COUNT(*) FROM enriched_editions WHERE updated_at > NOW() - INTERVAL '1 hour';
```

**Fix**: Materialized view (mv_stats) - eliminates these entirely

**Query Pattern 2: Title similarity searches**
```sql
SELECT * FROM enriched_editions WHERE title ILIKE '%search%';
```

**Current Index**: `idx_enriched_editions_title_trgm` (trigram)
**Status**: Should be using index, but may fall back to seq scan for very short search terms

**Potential Fix**: Lower trigram similarity threshold or use full-text search

**Query Pattern 3: Multiple ISBN lookups**
```sql
SELECT * FROM enriched_editions WHERE isbn IN (isbn1, isbn2, ..., isbn100);
```

**Current Index**: `idx_enriched_editions_isbn_cover` (B-tree on isbn)
**Status**: Should be using index - investigate why not

### Recommended Actions

1. **Implement mv_stats** - Eliminates COUNT(*) sequential scans
2. **Analyze actual query patterns** - Use `pg_stat_statements` to capture real queries
3. **Check index usage** - Verify trigram indexes are being used properly

---

## 4. Potential Materialized Views (LOW PRIORITY)

### mv_work_stats

**Use Case**: Work-level aggregations

```sql
CREATE MATERIALIZED VIEW mv_work_stats AS
SELECT
  w.work_key,
  w.title,
  COUNT(DISTINCT ee.isbn) as edition_count,
  COUNT(DISTINCT wae.author_key) as author_count,
  MAX(ee.updated_at) as last_edition_update,
  ARRAY_AGG(DISTINCT wae.author_key) as author_keys
FROM enriched_works w
LEFT JOIN enriched_editions ee ON w.work_key = ee.work_key
LEFT JOIN work_authors_enriched wae ON w.work_key = wae.work_key
GROUP BY w.work_key, w.title;

CREATE INDEX idx_mv_work_stats_edition_count ON mv_work_stats(edition_count DESC);
CREATE INDEX idx_mv_work_stats_work_key ON mv_work_stats(work_key);
```

**Benefits**:
- Fast "works with most editions" queries
- Author → works relationship pre-computed
- Could replace some work_authors_enriched queries

**Size Estimate**: ~3-4GB (21M works)

**Refresh**: Daily

### mv_popular_books

**Use Case**: "Trending" or "Popular" book rankings

```sql
CREATE MATERIALIZED VIEW mv_popular_books AS
SELECT
  ee.isbn,
  ee.title,
  ee.work_key,
  ee.completeness_score,
  ee.updated_at,
  ARRAY_AGG(DISTINCT wae.author_key) as author_keys,
  COUNT(DISTINCT wae.author_key) as author_count
FROM enriched_editions ee
JOIN work_authors_enriched wae ON ee.work_key = wae.work_key
WHERE ee.completeness_score >= 50  -- Only "complete" editions
GROUP BY ee.isbn, ee.title, ee.work_key, ee.completeness_score, ee.updated_at
ORDER BY ee.completeness_score DESC, ee.updated_at DESC;

CREATE INDEX idx_mv_popular_books_completeness ON mv_popular_books(completeness_score DESC);
CREATE INDEX idx_mv_popular_books_work_key ON mv_popular_books(work_key);
```

**Benefits**:
- Pre-filtered "high quality" editions
- Fast "recommended books" queries
- Could power discovery features

**Size Estimate**: ~2-3GB (subset of editions)

**Refresh**: Daily or weekly

---

## Implementation Priority

### Immediate (This Session)

1. ✅ **mv_author_stats** - COMPLETE (398,374x speedup)
2. 🟡 **mv_stats** - Stats endpoint (13s → <1ms, 13,000x speedup)
3. 🟡 **GIN index on subject_tags** - Enable fast subject queries

### Short-term (Next Session)

4. **mv_subject_stats** - Subject browsing/statistics
5. **Investigate sequential scans** - Use pg_stat_statements to find actual problem queries
6. **Index tuning** - Verify trigram indexes working properly

### Long-term (Future)

7. **mv_work_stats** - Work-level aggregations
8. **Improve subject coverage** - Enhance enrichment pipeline (64% → 80%+)
9. **mv_popular_books** - Discovery features

---

## Cost-Benefit Analysis

| Optimization | Time Investment | Storage Cost | Performance Gain | Impact |
|--------------|----------------|--------------|------------------|--------|
| mv_stats | 30 min | <100MB | 13s → <1ms | High - Every /api/stats call |
| GIN index (subjects) | 10 min | 500MB-1GB | Unknown → Fast | Medium - Subject queries |
| mv_subject_stats | 30 min | 100-200MB | Unknown → <1ms | Medium - Subject browsing |
| mv_work_stats | 60 min | 3-4GB | Unknown → <1ms | Low - Not critical path |
| Improve subject coverage | Many hours | 0GB | N/A (quality) | Medium - Better data |

---

## Genre Data Quality Findings

### Coverage Breakdown

**By Provider**:
```sql
-- TODO: Run this query to understand which providers give us subjects
SELECT
  primary_provider,
  COUNT(*) as total_works,
  COUNT(CASE WHEN subject_tags IS NOT NULL AND array_length(subject_tags, 1) > 0 THEN 1 END) as with_subjects,
  ROUND(100.0 * COUNT(CASE WHEN subject_tags IS NOT NULL AND array_length(subject_tags, 1) > 0 THEN 1 END) / COUNT(*), 2) as percent
FROM enriched_works
GROUP BY primary_provider
ORDER BY total_works DESC;
```

### Quality Issues

1. **Inconsistent naming**:
   - "Fiction" vs "Fiction, general" vs "Fiction, romance, general"
   - "History" vs "History and criticism"
   - Need normalization/standardization

2. **Generic subjects**:
   - "Arborist Merchandising Root" (ISBNdb artifact?)
   - "Self Service" (not a book genre!)
   - May need filtering/cleanup

3. **Missing hierarchies**:
   - No parent-child relationships
   - "Fiction, romance, general" should map to Fiction → Romance
   - Could enhance with genre taxonomy

### Recommendations for Genre/Subject System

**Short-term** (Quick wins):
1. Add GIN index for fast subject queries
2. Create mv_subject_stats for browsing
3. Filter out obvious junk subjects ("Arborist Merchandising Root", etc.)

**Long-term** (Proper solution):
1. Build genre taxonomy (parent-child relationships)
2. Normalize subject names (deduplicate, standardize casing)
3. Extract subjects from multiple sources during enrichment
4. Add confidence scores to subjects (based on provider)
5. Allow user-contributed subject tags (with moderation)

---

## Conclusion

**High-impact optimizations identified:**
1. Stats endpoint materialized view (13s → <1ms)
2. Subject GIN index (enables fast subject queries)
3. Subject stats materialized view (enables browsing)

**Data quality issues:**
- 64% of works missing subjects (coverage problem)
- Inconsistent subject naming (normalization needed)
- Some junk subjects from providers (filtering needed)

**Next steps:**
1. Create mv_stats (immediate win)
2. Add GIN index on subject_tags (enables subject features)
3. Create mv_subject_stats (enables subject browsing)
4. Long-term: Enhance enrichment pipeline for better subject coverage

**Storage impact**: ~2-3GB total for all proposed materialized views and indexes (1.6% of 186GB database)

**Performance impact**: Multiple 10,000x+ speedups on aggregation queries
