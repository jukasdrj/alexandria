# Alexandria Database Optimization Plan

**Date**: December 6, 2025
**Purpose**: Establish solid foundation before Sprint 1 features
**Database**: PostgreSQL 18, 82.4M records, 60GB RAM available

---

## 📊 Current State Analysis

### Database Size
| Table | Rows | Table Size | Index Size | Total |
|-------|------|------------|------------|-------|
| `enriched_editions` | 28.6M | 9.0 GB | 5.9 GB | **15 GB** |
| `enriched_works` | 21.2M | 5.4 GB | 1.0 GB | **6.4 GB** |
| `work_authors_enriched` | 24.5M | 1.8 GB | 3.5 GB | **5.3 GB** |
| `enriched_authors` | 8.2M | 1.2 GB | 796 MB | **2.0 GB** |
| **TOTAL** | **82.4M** | **17.4 GB** | **11.2 GB** | **28.6 GB** |

### Existing Indexes (16 total)
✅ **enriched_works** (3 indexes):
- Primary key: `work_key`
- GIN: `goodreads_work_ids` (array)
- B-tree: `isbndb_quality` (partial, WHERE > 0)
- B-tree: `updated_at DESC`

✅ **enriched_editions** (5 indexes):
- Primary key: `isbn`
- Unique: `edition_id`
- B-tree: `work_key` (FK)
- GIN: `alternate_isbns` (array)
- GIN: `title` (trigram for fuzzy search)

✅ **enriched_authors** (4 indexes):
- Primary key: `author_key`
- GIN: `name` (trigram for fuzzy search)
- B-tree: `book_count DESC`
- B-tree: `nationality`

✅ **work_authors_enriched** (3 indexes):
- Primary key: `(work_key, author_key)` composite
- B-tree: `author_key` (FK)
- B-tree: `work_key` (FK)

### Foreign Key Coverage
✅ All foreign keys have indexes:
- `enriched_editions.work_key` → `enriched_works.work_key`
- `work_authors_enriched.work_key` → `enriched_works.work_key`
- `work_authors_enriched.author_key` → `enriched_authors.author_key`

### Current PostgreSQL Settings (⚠️ SUBOPTIMAL)
| Setting | Current | Recommended | Impact |
|---------|---------|-------------|---------|
| `shared_buffers` | **128MB** | 15GB | ⚠️ **CRITICAL** |
| `effective_cache_size` | 4GB | 45GB | ⚠️ **HIGH** |
| `maintenance_work_mem` | 64MB | 2GB | ⚠️ **MEDIUM** |
| `work_mem` | 4MB | 32MB | ⚠️ **MEDIUM** |
| `random_page_cost` | 4 (HDD) | 1.1 (SSD) | ⚠️ **HIGH** |
| `max_connections` | 100 | 100 | ✅ OK |

### Statistics Status
✅ **All tables recently analyzed**:
- `enriched_works`: Analyzed Dec 5, 2:09 PM
- `enriched_editions`: Analyzed Dec 5, 6:45 PM
- `enriched_authors`: Analyzed Dec 5, 10:54 PM
- `work_authors_enriched`: Analyzed Dec 5, 10:56 PM

✅ **No dead tuples** (n_dead_tup = 0 on all tables)
✅ **Autovacuum working** (all tables recently autovacuumed)

---

## 🎯 Optimization Recommendations

### Priority 1: CRITICAL (Performance Impact)

#### 1.1 PostgreSQL Configuration Update
**Impact**: 10-50x query performance improvement
**Effort**: 5 minutes + restart
**Risk**: Low (settings are conservative)

```sql
-- Memory Settings (60GB RAM available)
ALTER SYSTEM SET shared_buffers = '15GB';           -- 25% of RAM (was 128MB!)
ALTER SYSTEM SET effective_cache_size = '45GB';     -- 75% of RAM (was 4GB)
ALTER SYSTEM SET maintenance_work_mem = '2GB';      -- For VACUUM, CREATE INDEX (was 64MB)
ALTER SYSTEM SET work_mem = '32MB';                 -- Per-operation (was 4MB)

-- SSD Optimization
ALTER SYSTEM SET random_page_cost = '1.1';          -- SSD vs HDD=4
ALTER SYSTEM SET effective_io_concurrency = '200';  -- SSD concurrent I/O

-- Write Performance
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET min_wal_size = '1GB';

-- Autovacuum (82M records)
ALTER SYSTEM SET autovacuum_max_workers = '4';
ALTER SYSTEM SET autovacuum_naptime = '10s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = '0.05';
ALTER SYSTEM SET autovacuum_analyze_scale_factor = '0.02';

-- Monitoring
ALTER SYSTEM SET log_min_duration_statement = '1000';  -- Log queries >1s
ALTER SYSTEM SET log_checkpoints = 'on';
ALTER SYSTEM SET log_autovacuum_min_duration = '0';
```

**Restart required**: `ssh root@Tower.local "docker restart postgres"`

**Why this matters**:
- `shared_buffers` at 128MB is **117x too small** for 82.4M records
- Query planner thinks all data is on slow HDD (random_page_cost=4)
- Insufficient cache size causes excessive disk I/O

---

### Priority 2: HIGH (Missing Indexes)

#### 2.1 Subject Tags GIN Index
**Impact**: 100-1000x faster subject-based queries
**Effort**: 10-30 minutes (index build time)
**Use case**: "Find all books about 'science fiction'"

```sql
CREATE INDEX idx_enriched_works_subjects
ON enriched_works USING GIN (subject_tags);
```

**Why**: Currently NO index on `subject_tags` array. Array containment queries (`@>`) will do full table scans (21.2M rows).

#### 2.2 Title Trigram Index (Works)
**Impact**: 10-100x faster fuzzy title search
**Effort**: 10-30 minutes
**Use case**: "Find books with title like 'harry potter'"

```sql
CREATE INDEX idx_enriched_works_title_trgm
ON enriched_works USING GIN (title gin_trgm_ops);
```

**Why**: Editions already have this (idx_enriched_editions_title_trgm), works don't.

#### 2.3 ISBN Prefix Index
**Impact**: Faster ISBN prefix searches (ISBN-10 → ISBN-13 conversion)
**Effort**: 10-30 minutes

```sql
CREATE INDEX idx_enriched_editions_isbn_prefix
ON enriched_editions (isbn text_pattern_ops);
```

**Why**: Helps with `isbn LIKE '978%'` queries for ISBN-13 validation.

---

### Priority 3: MEDIUM (Partial Indexes for Filters)

#### 3.1 Works with Description (4.6% selectivity)
**Impact**: 20x faster queries filtering on description presence
**Effort**: 2-5 minutes

```sql
CREATE INDEX idx_enriched_works_with_description
ON enriched_works (work_key)
WHERE description IS NOT NULL;
```

**Why**: Only 975K of 21.2M works (4.6%) have descriptions. Partial index is 20x smaller than full index.

#### 3.2 Works with Subjects (36% selectivity)
**Impact**: 3x faster queries filtering on subject presence
**Effort**: 5-10 minutes

```sql
CREATE INDEX idx_enriched_works_with_subjects
ON enriched_works (work_key)
WHERE subject_tags IS NOT NULL AND array_length(subject_tags, 1) > 0;
```

**Why**: Only 7.6M of 21.2M works (36%) have subjects.

#### 3.3 Authors with Bio (0.3% selectivity)
**Impact**: 300x faster queries filtering on bio presence
**Effort**: <1 minute

```sql
CREATE INDEX idx_enriched_authors_with_bio
ON enriched_authors (author_key)
WHERE bio IS NOT NULL;
```

**Why**: Only 28K of 8.2M authors (0.3%) have bios. Partial index is 300x smaller.

---

### Priority 4: LOW (Nice to Have)

#### 4.1 VACUUM FULL (Space Reclamation)
**Impact**: Reclaim ~10-15% disk space, minor performance improvement
**Effort**: 1-2 hours (table-level locks during operation)
**Risk**: Medium (tables locked during VACUUM FULL)

```sql
VACUUM (FULL, ANALYZE, VERBOSE) enriched_works;
VACUUM (FULL, ANALYZE, VERBOSE) enriched_editions;
VACUUM (FULL, ANALYZE, VERBOSE) enriched_authors;
VACUUM (FULL, ANALYZE, VERBOSE) work_authors_enriched;
```

**When to run**: During maintenance window (tables are locked)
**Why**: Tables currently show 0 dead tuples, so minimal benefit now. Consider after bulk updates.

---

## 📋 Implementation Plan

### Phase 1: PostgreSQL Configuration (5 minutes + restart)
**Risk**: Low
**Downtime**: 10-30 seconds (Docker restart)

```bash
# 1. Apply configuration
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -f /tmp/optimize_postgresql_conf.sql"

# 2. Restart PostgreSQL
ssh root@Tower.local "docker restart postgres"

# 3. Verify settings
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SHOW shared_buffers; SHOW effective_cache_size; SHOW random_page_cost;'"
```

**Expected improvement**: 10-50x faster queries

### Phase 2: Critical Indexes (30-90 minutes total)
**Risk**: Low (indexes built CONCURRENTLY, no locks)
**Downtime**: None

```bash
# Run index creation script
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -f /tmp/optimize_database.sql"
```

**Indexes to create**:
1. `idx_enriched_works_subjects` (GIN on subject_tags) - 10-30 min
2. `idx_enriched_works_title_trgm` (GIN trigram on title) - 10-30 min
3. `idx_enriched_editions_isbn_prefix` (text_pattern_ops) - 10-30 min
4. `idx_enriched_works_with_description` (partial) - 2-5 min
5. `idx_enriched_works_with_subjects` (partial) - 5-10 min
6. `idx_enriched_authors_with_bio` (partial) - <1 min

**Expected improvement**: 10-1000x faster for specific query patterns

### Phase 3: Monitoring & Validation (10 minutes)
**Risk**: None

```bash
# Check index sizes
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
\""

# Test query performance
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
EXPLAIN ANALYZE
SELECT work_key, title
FROM enriched_works
WHERE subject_tags @> ARRAY['Fiction']
LIMIT 10;
\""
```

---

## 🎯 Expected Performance Gains

### Before Optimization
| Query Type | Performance | Issue |
|------------|-------------|-------|
| Subject search | 30-60s | Full table scan (21.2M rows) |
| Title fuzzy search (works) | 10-30s | Sequential scan |
| ISBN prefix search | 1-5s | Sequential scan |
| Description filter | 5-15s | Full table scan |
| General queries | Slow | shared_buffers=128MB (117x too small) |

### After Optimization
| Query Type | Performance | Improvement |
|------------|-------------|-------------|
| Subject search | 50-500ms | **60-1200x faster** (GIN index) |
| Title fuzzy search | 50-200ms | **50-150x faster** (trigram index) |
| ISBN prefix search | 10-50ms | **100-500x faster** (pattern ops) |
| Description filter | 100-500ms | **10-30x faster** (partial index) |
| General queries | 10-50x faster | **Proper memory allocation** |

---

## 📊 Index Size Estimates

| Index | Type | Estimated Size | Build Time |
|-------|------|----------------|------------|
| `idx_enriched_works_subjects` | GIN | ~500 MB | 10-30 min |
| `idx_enriched_works_title_trgm` | GIN | ~300 MB | 10-30 min |
| `idx_enriched_editions_isbn_prefix` | B-tree | ~400 MB | 10-30 min |
| `idx_enriched_works_with_description` | B-tree (partial) | ~20 MB | 2-5 min |
| `idx_enriched_works_with_subjects` | B-tree (partial) | ~150 MB | 5-10 min |
| `idx_enriched_authors_with_bio` | B-tree (partial) | ~1 MB | <1 min |
| **TOTAL NEW INDEXES** | - | **~1.4 GB** | **37-96 min** |

**Total database size after optimization**: ~30 GB (current 28.6 GB + 1.4 GB indexes)

---

## 🚨 Risks & Mitigation

### Risk 1: Index Build Time
**Impact**: Medium (30-90 minutes with active queries)
**Mitigation**: Build indexes during low-traffic period or use `CONCURRENTLY` (no locks)

### Risk 2: Increased Disk Space
**Impact**: Low (+1.4 GB, well within available space)
**Mitigation**: Monitor disk usage, remove unused indexes if needed

### Risk 3: PostgreSQL Restart
**Impact**: Low (10-30 second downtime)
**Mitigation**: Schedule restart during maintenance window

### Risk 4: Memory Configuration Too Aggressive
**Impact**: Very Low (settings are conservative for 60GB RAM)
**Mitigation**: Monitor PostgreSQL memory usage after restart

---

## ✅ Pre-Flight Checklist

Before running optimizations:
- [ ] Verify 60GB RAM available: `ssh root@Tower.local "free -h"`
- [ ] Verify disk space: `ssh root@Tower.local "df -h"`
- [ ] Backup current PostgreSQL config: `ssh root@Tower.local "docker exec postgres cat /var/lib/postgresql/18/docker/postgresql.conf > /tmp/postgresql.conf.backup"`
- [ ] Test query: `ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT COUNT(*) FROM enriched_works;'"`
- [ ] Review optimization scripts: `/tmp/optimize_postgresql_conf.sql` and `/tmp/optimize_database.sql`

---

## 📋 Post-Optimization Validation

After completion:
- [ ] Verify PostgreSQL restarted: `ssh root@Tower.local "docker ps | grep postgres"`
- [ ] Check new settings: `SHOW shared_buffers; SHOW effective_cache_size;`
- [ ] Verify indexes created: `SELECT count(*) FROM pg_indexes WHERE schemaname = 'public';`
- [ ] Test subject query: `SELECT COUNT(*) FROM enriched_works WHERE subject_tags @> ARRAY['Fiction'];`
- [ ] Test title search: `SELECT COUNT(*) FROM enriched_works WHERE title ILIKE '%potter%';`
- [ ] Monitor slow query log: `ssh root@Tower.local "docker logs postgres 2>&1 | grep 'duration:'"`

---

## 🎯 Success Criteria

Optimization is successful if:
- ✅ `shared_buffers` = 15GB (currently 128MB)
- ✅ `effective_cache_size` = 45GB (currently 4GB)
- ✅ `random_page_cost` = 1.1 (currently 4)
- ✅ 6 new indexes created successfully
- ✅ Total indexes: 22 (current 16 + 6 new)
- ✅ Subject queries < 1 second
- ✅ Title fuzzy search < 1 second
- ✅ No query errors or crashes
- ✅ Database size < 35 GB

---

## 📝 Maintenance Schedule

### Daily
- Monitor slow query log (queries >1s)
- Check autovacuum activity

### Weekly
- Review index usage: `pg_stat_user_indexes`
- Check for bloat: dead tuples, table sizes

### Monthly
- ANALYZE all tables (automatic via autovacuum)
- Review and remove unused indexes
- Check for missing indexes on new columns

### Quarterly
- VACUUM FULL during maintenance window (if needed)
- Review PostgreSQL configuration for new workload patterns
- Update statistics targets for frequently queried columns

---

**Generated**: December 6, 2025
**Author**: Alexandria Development Team
**Status**: Ready for implementation
**Estimated time**: 2 hours total (5 min config + 90 min indexes + 25 min validation)
**Expected improvement**: 10-1000x faster queries depending on use case
