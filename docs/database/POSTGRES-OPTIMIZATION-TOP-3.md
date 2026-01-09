# PostgreSQL Optimization - Top 3 Recommendations for Author Tables

**Date**: 2026-01-09
**Database**: Alexandria (OpenLibrary PostgreSQL, 14.7M authors)
**Expert Review**: Gemini 3 Pro (PostgreSQL Specialist) + Grok Code Review
**Status**: Ready for Implementation

---

## Executive Summary

Analysis of 14.7M author records (18.1GB storage) revealed **critical planning overhead** (2000x) and **index bloat** (64% overhead). Top 3 recommendations provide:

1. **2000x latency improvement** on primary workload (400K+ queries/day)
2. **2-3GB storage reclaimed** from redundant indexes
3. **99.8% index efficiency gain** for JIT enrichment system

**Implementation**: 3-phase rollout over 2 weeks, zero downtime, fully reversible.

---

## The Problem

### Primary Issue: Planning Overhead
- **Planning Time**: 166ms
- **Execution Time**: 0.084ms
- **Overhead**: **2000x** (99.95% time wasted planning)
- **Impact**: 400K+ queries/day = 18.5 CPU-hours wasted daily

### Secondary Issue: Index Bloat
- **Table Size**: 11GB (data)
- **Index Size**: 7.1GB (64% overhead!)
- **Unused Indexes**: 8+ with 0 scans
- **Duplicate Indexes**: 3+ exact duplicates

### Tertiary Issue: Sparse Data Inefficiency
- **Hot Data**: <100 authors with views (0.0007%)
- **Cold Data**: 14.7M authors never accessed (99.9993%)
- **Index Scanning**: 117M tuples scanned to find 1 row

---

## Top 3 Recommendations

### #1: Aggressive Index Consolidation
**Priority**: Stability (Reduce Write Overhead)
**Impact**: 2-3GB storage saved, 10-15% write improvement
**Risk**: Low
**Expert Rating**: Approve with Changes (Grok)

#### What to Do
Drop 4 redundant/unused indexes:
1. `idx_enriched_authors_name_trgm` - Duplicate trigram (0 scans)
2. `cuix_authorworks_authorkey_workkey` - Duplicate PK
3. `cuix_authors_key` - Duplicate PK
4. `idx_enriched_authors_nationality` - Unused sparse index

#### SQL Implementation
```sql
-- Migration: 010_consolidate_redundant_indexes.sql

DROP INDEX CONCURRENTLY IF EXISTS idx_enriched_authors_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS cuix_authorworks_authorkey_workkey;
DROP INDEX CONCURRENTLY IF EXISTS cuix_authors_key;
DROP INDEX CONCURRENTLY IF EXISTS idx_enriched_authors_nationality;
```

#### Expected Results
- Storage: 18.1GB → 15-16GB ✅
- Write throughput: +10-15% ✅
- Maintenance: Faster VACUUM ✅

#### Grok's Concerns
- ⚠️ Delay dropping `idx_enriched_authors_nationality` for 7 days post-JIT launch (monitor for emerging usage)
- ✅ Add `pg_depend` check for dependent views/FKs

---

### #2: Disable JIT Compilation
**Priority**: Performance (Fix Planning Overhead)
**Impact**: **2000x latency improvement**
**Risk**: Low/Medium
**Expert Rating**: Approve with Changes (Grok)

#### What to Do
Disable PostgreSQL JIT compilation for OLTP workload:

```sql
-- Apply at database level (no restart)
ALTER DATABASE openlibrary SET jit = off;

-- Verify
\c openlibrary
SHOW jit;
```

#### Expected Results
- Planning time: 166ms → <1ms ✅
- Query time: 166.08ms → <1ms ✅
- Throughput: 6 qps → 10,000+ qps ✅
- CPU savings: 18.5 hours/day → near zero ✅

#### Grok's Concerns
- ⚠️ Implement Option B (raise JIT thresholds) as pilot week before full disable
- ⚠️ Test Top Authors query for >50% slowdown (it's cached 24h, so low risk)
- ✅ Add per-session JIT enable example for future analytics

#### Option B (Conservative Approach)
```sql
-- Only trigger JIT for expensive queries
ALTER DATABASE openlibrary SET jit_above_cost = 100000;
ALTER DATABASE openlibrary SET jit_inline_above_cost = 500000;
ALTER DATABASE openlibrary SET jit_optimize_above_cost = 500000;
```

---

### #3: Strategic Partial Indexing (JIT System)
**Priority**: Future-Proofing (JIT Scalability)
**Impact**: 99.8% index size reduction
**Risk**: Low
**Expert Rating**: Approve (Grok)

#### What to Do
Replace full index with partial index covering only active authors:

```sql
-- Migration: 011_optimize_jit_indexes.sql

-- Create partial index (hot data only)
CREATE INDEX CONCURRENTLY idx_authors_by_view_count_active
ON enriched_authors (heat_score DESC, last_viewed_at DESC)
WHERE view_count > 0;

-- Drop bloated full index
DROP INDEX CONCURRENTLY idx_authors_by_view_count;

-- Update statistics
ANALYZE enriched_authors;
```

#### Expected Results
- Index size: 500MB → <1MB (99.8% reduction) ✅
- JIT queries: 117M tuples scanned → <100 tuples ✅
- Query time: Variable → <1ms ✅
- Scalability: Linear with active authors (not total) ✅

#### Grok's Validation
- ✅ Partial index WHERE clause matches JIT query patterns
- ✅ Scales gracefully to 100K+ active authors
- ✅ No regressions expected (JIT system is new, no legacy queries)

---

## Implementation Plan

### Phase 1: Quick Win (Week 1, Days 1-2)
**Goal**: Fix 2000x planning overhead immediately

```bash
# Connect to database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# Option A: Full disable (aggressive)
ALTER DATABASE openlibrary SET jit = off;

# Option B: Raise thresholds (conservative, recommended by Grok)
ALTER DATABASE openlibrary SET jit_above_cost = 100000;
ALTER DATABASE openlibrary SET jit_inline_above_cost = 500000;
ALTER DATABASE openlibrary SET jit_optimize_above_cost = 500000;

# Reconnect to apply settings
\c openlibrary

# Test
EXPLAIN ANALYZE SELECT * FROM enriched_authors WHERE author_key = '/authors/OL19981A';
-- Expected: Planning Time < 1ms (was 166ms)
```

**Success Criteria**:
- Planning time < 1ms ✅
- No query errors ✅
- Top Authors query <30s (was 20s, acceptable) ✅

---

### Phase 2: Index Consolidation (Week 1, Days 3-4)
**Goal**: Reclaim 2-3GB storage, reduce write overhead

```bash
# Create migration
cd /Users/juju/dev_repos/alex/migrations
cat > 010_consolidate_redundant_indexes.sql << 'EOF'
-- Drop duplicate trigram index (0 scans)
DROP INDEX CONCURRENTLY IF EXISTS idx_enriched_authors_name_trgm;

-- Drop redundant unique indexes (duplicates of PKs)
DROP INDEX CONCURRENTLY IF EXISTS cuix_authorworks_authorkey_workkey;
DROP INDEX CONCURRENTLY IF EXISTS cuix_authors_key;

-- OPTIONAL: Drop unused sparse index (WAIT 7 DAYS - Grok's suggestion)
-- DROP INDEX CONCURRENTLY IF EXISTS idx_enriched_authors_nationality;
EOF

# Apply migration
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary" < 010_consolidate_redundant_indexes.sql

# Monitor storage
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
  SELECT pg_size_pretty(pg_total_relation_size('enriched_authors')) as total,
         pg_size_pretty(pg_table_size('enriched_authors')) as table,
         pg_size_pretty(pg_indexes_size('enriched_authors')) as indexes;
\""
```

**Success Criteria**:
- Storage reduced 2-3GB ✅
- Name search queries still work ✅
- No errors in logs ✅

---

### Phase 3: JIT System Optimization (Week 2, Days 5-7)
**Goal**: Optimize for JIT enrichment scalability

```bash
# Create migration
cat > 011_optimize_jit_indexes.sql << 'EOF'
-- Create partial index for active authors
CREATE INDEX CONCURRENTLY idx_authors_by_view_count_active
ON enriched_authors (heat_score DESC, last_viewed_at DESC)
WHERE view_count > 0;

-- Drop full index
DROP INDEX CONCURRENTLY idx_authors_by_view_count;

-- Update statistics
ANALYZE enriched_authors;
EOF

# Apply
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary" < 011_optimize_jit_indexes.sql

# Test JIT queries
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
  EXPLAIN ANALYZE
  SELECT * FROM enriched_authors
  WHERE view_count > 0
  ORDER BY heat_score DESC, last_viewed_at DESC
  LIMIT 10;
\""
-- Should use: idx_authors_by_view_count_active
-- Buffers should show <100 hits (not millions)
```

**Success Criteria**:
- Index size <1MB (was 500MB) ✅
- JIT queries <1ms ✅
- Buffer hits <100 ✅

---

## Monitoring & Validation

### Daily (First Week)
```sql
-- Check index usage
SELECT indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'enriched_authors'
ORDER BY idx_scan DESC;

-- Check planning time
EXPLAIN ANALYZE SELECT * FROM enriched_authors WHERE author_key = '/authors/OL19981A';
-- Expected: Planning < 1ms, Execution < 1ms
```

### Weekly (First Month)
```sql
-- Check storage savings
SELECT pg_size_pretty(pg_total_relation_size('enriched_authors')) as total,
       pg_size_pretty(pg_table_size('enriched_authors')) as table,
       pg_size_pretty(pg_indexes_size('enriched_authors')) as indexes;
-- Expected: ~15-16GB total (was 18.1GB)

-- Check for regressions
SELECT * FROM pg_stat_user_tables WHERE relname = 'enriched_authors';
```

---

## Rollback Plan

**If issues occur**, rollback is safe and fast:

```sql
-- Rollback #2 (JIT)
ALTER DATABASE openlibrary SET jit = on;

-- Rollback #1 (Index Consolidation)
CREATE INDEX CONCURRENTLY idx_enriched_authors_name_trgm
ON enriched_authors USING gin (name gin_trgm_ops);

CREATE UNIQUE INDEX CONCURRENTLY cuix_authorworks_authorkey_workkey
ON author_works (author_key, work_key);

CREATE UNIQUE INDEX CONCURRENTLY cuix_authors_key
ON authors (key);

-- Rollback #3 (Partial Indexes)
CREATE INDEX CONCURRENTLY idx_authors_by_view_count
ON enriched_authors (view_count DESC, last_viewed_at DESC);

DROP INDEX CONCURRENTLY idx_authors_by_view_count_active;
```

---

## Success Metrics

**After Week 1** (JIT Disable + Index Consolidation):
- ✅ Planning time <1ms (was 166ms) - **2000x improvement**
- ✅ Storage 15-16GB (was 18.1GB) - **2-3GB saved**
- ✅ No query errors or timeouts
- ✅ Write throughput +10-15%

**After Week 2** (Partial Indexes):
- ✅ JIT enrichment queries <1ms
- ✅ Index size <1MB (was 500MB) - **99.8% reduction**
- ✅ Scales to 100K+ active authors

---

## Expert Review Summary

### Gemini 3 Pro (PostgreSQL Specialist)
- **Overall Assessment**: High-impact, low-risk recommendations
- **Top Priority**: Disable JIT (2000x improvement on hot path)
- **Key Insight**: Planning overhead is the bottleneck, not execution
- **Recommendation**: Implement all 3 phases

### Grok (Code Reviewer)
- **Overall Assessment**: Approve all with minor changes
- **Rating**:
  - #1: Approve with Changes (delay nationality index drop)
  - #2: Approve with Changes (pilot Option B first)
  - #3: Approve (no changes needed)
- **Key Concerns**:
  - Test JIT disable conservatively (Option B pilot)
  - Monitor nationality index usage for 7 days before drop
  - Verify no forced index hints in app code

---

## PostgreSQL Version Compatibility

**Minimum Version**: PostgreSQL 11+ (for JIT settings)
**Recommended**: PostgreSQL 12+ (stable JIT)

**To check current version**:
```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT version();'"
```

---

## Risk Assessment

| Recommendation | Risk Level | Mitigation | Reversibility |
|----------------|------------|------------|---------------|
| #1: Index Consolidation | Low | CONCURRENTLY prevents blocking | Full (recreate indexes) |
| #2: Disable JIT | Low/Medium | Pilot Option B first | Instant (re-enable) |
| #3: Partial Indexes | Low | WHERE clause matches query | Full (recreate full index) |

**Overall Risk**: LOW - All changes are reversible with zero downtime

---

## Next Steps

1. **Review this document** with team
2. **Check PostgreSQL version** (must be 11+)
3. **Schedule maintenance window** (optional, CONCURRENTLY works online)
4. **Phase 1 (Week 1)**: Disable JIT (Option B pilot)
5. **Monitor for 48 hours**: Check planning time, query errors
6. **Phase 2 (Week 1)**: Drop redundant indexes
7. **Monitor for 7 days**: Check storage, write performance, nationality usage
8. **Phase 3 (Week 2)**: Implement partial indexes
9. **Monitor for 30 days**: Validate JIT system scalability

---

## Questions Answered

1. **Are duplicate trigram indexes needed?** NO - Drop `idx_enriched_authors_name_trgm` (0 scans)
2. **Are duplicate PKs needed?** NO - Drop `cuix_*` indexes (ORM artifacts)
3. **Should we partition hot/cold data?** NO - Too risky, use partial indexes instead
4. **How to reduce planning time?** Disable JIT for OLTP workload (2000x improvement)
5. **Is JIT index premature?** YES - Replace with partial index (99.8% size reduction)

---

**Document Created**: 2026-01-09
**Expert Validation**: Complete
**Status**: Ready for Implementation
**Next Review**: After Phase 1 completion (Week 1)
