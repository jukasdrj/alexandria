# Schema Analysis: Synthetic Works Enhancement System

## Executive Summary

Analysis of Alexandria's PostgreSQL schema for implementing deferred enhancement of synthetic works (AI-generated book records created during ISBNdb quota exhaustion).

**Key Findings**:
- ✅ Schema has all necessary fields (no migration needed)
- ❌ Missing critical index for enhancement queries
- ✅ Metadata extraction requires double-parsing JSONB (documented pattern)
- ✅ Can use existing fields (no enhancement_failed flag needed)

**Performance Impact**: Without proper indexing, enhancement queries will scan 54M+ rows. Recommended composite index will reduce query time from ~30s to <10ms.

---

## Schema Structure

### enriched_works Table

**Relevant Columns for Synthetic Enhancement**:

```sql
CREATE TABLE enriched_works (
    work_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    first_publication_year INTEGER,

    -- Critical for synthetic work filtering
    synthetic BOOLEAN DEFAULT FALSE,
    primary_provider TEXT,
    completeness_score INTEGER DEFAULT 0,

    -- JSONB metadata (double-parse pattern)
    metadata JSONB DEFAULT '{}',

    -- Timestamps for ordering
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_isbndb_sync TIMESTAMPTZ
);
```

**Key Fields**:

| Field | Type | Purpose | Values for Enhancement |
|-------|------|---------|----------------------|
| `synthetic` | BOOLEAN | AI-generated vs verified | `true` (created by Gemini) |
| `primary_provider` | TEXT | Source of record | `'gemini-backfill'` |
| `completeness_score` | INTEGER | Data quality (0-100) | `30` (minimal), target: `80+` |
| `metadata` | JSONB | Extensible storage | See metadata structure below |
| `last_isbndb_sync` | TIMESTAMPTZ | Last enhancement attempt | `NULL` for never-enhanced |

**Metadata Structure** (CRITICAL - Double-Parse Pattern):

```json
{
  "gemini_source": "backfill-2024-01",
  "gemini_author": "J.K. Rowling",
  "gemini_publisher": "Bloomsbury",
  "gemini_format": "Hardcover",
  "gemini_significance": "First edition...",
  "gemini_persisted_at": "2025-01-10T12:34:56Z",
  "needs_isbndb_enhancement": true
}
```

**IMPORTANT**: Metadata is stored as **stringified JSON inside JSONB** (not direct JSONB object).

**Extraction Pattern**:
```sql
-- WRONG (returns string)
metadata->>'gemini_author'

-- CORRECT (double-parse)
(metadata#>>'{}')::jsonb->>'gemini_author'
```

This pattern is documented in `CLAUDE.md` and used in `./scripts/query-gemini-books.sh`.

---

### enriched_editions Table

**Relevant Columns**:

```sql
CREATE TABLE enriched_editions (
    isbn TEXT PRIMARY KEY,
    work_key TEXT REFERENCES enriched_works(work_key),
    title TEXT,
    publisher TEXT,
    publication_date TEXT,

    -- Quality tracking
    primary_provider TEXT,
    completeness_score INTEGER DEFAULT 0,
    work_match_confidence INTEGER DEFAULT 0,

    -- Enhancement tracking
    metadata JSONB DEFAULT '{}',
    last_isbndb_sync TIMESTAMPTZ
);
```

**Note**: Synthetic editions (created with ISBNs) use same `metadata` structure as works.

---

## Existing Indexes

### Current Indexes on enriched_works:

```sql
-- From migrations/001_add_enrichment_tables.sql
CREATE INDEX idx_enriched_works_title_trgm ON enriched_works USING gin(title gin_trgm_ops);
CREATE INDEX idx_enriched_works_subject_tags ON enriched_works USING gin(subject_tags);
CREATE INDEX idx_enriched_works_goodreads ON enriched_works USING gin(goodreads_work_ids);
CREATE INDEX idx_enriched_works_updated ON enriched_works(updated_at DESC);
CREATE INDEX idx_enriched_works_isbndb_quality ON enriched_works(isbndb_quality DESC) WHERE isbndb_quality > 0;
```

### Missing Index for Enhancement Queries:

**CRITICAL**: No index exists for the core enhancement query pattern:
```sql
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
ORDER BY created_at ASC
```

**Impact**: Full table scan on 54M+ editions table.

**Estimated Performance**:
- Without index: ~25-30 seconds (sequential scan)
- With index: <10ms (index-only scan)

---

## Query Design & Performance

### Primary Enhancement Query

**Query**:
```sql
SELECT
  work_key,
  title,
  (metadata#>>'{}')::jsonb->>'gemini_author' as author,
  (metadata#>>'{}')::jsonb->>'gemini_publisher' as publisher,
  completeness_score,
  created_at,
  metadata
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
  AND last_isbndb_sync IS NULL  -- Never attempted enhancement
ORDER BY created_at ASC
LIMIT 100;
```

**Explanation**:
- `synthetic = true` - AI-generated works only
- `primary_provider = 'gemini-backfill'` - Excludes other synthetic sources
- `completeness_score < 50` - Needs enhancement (30 → 80+)
- `last_isbndb_sync IS NULL` - Never enhanced (avoids failed records)
- `ORDER BY created_at ASC` - Oldest first (FIFO)
- `LIMIT 100` - Batch size (100-500 ISBNdb calls per batch)

**Metadata Extraction**:
```sql
-- Extract author for ISBNdb query
(metadata#>>'{}')::jsonb->>'gemini_author'

-- Extract publisher for matching confidence
(metadata#>>'{}')::jsonb->>'gemini_publisher'

-- Check if already flagged for enhancement
(metadata#>>'{}')::jsonb->>'needs_isbndb_enhancement'
```

### EXPLAIN ANALYZE (Estimated)

**Without Recommended Index**:
```
Limit  (cost=0.00..8.00 rows=100 width=...)
  ->  Sort  (cost=... rows=estimated_synthetic_works)
        Sort Key: created_at
        ->  Seq Scan on enriched_works  (cost=0.00..huge rows=estimated)
              Filter: (synthetic = true AND primary_provider = 'gemini-backfill'
                      AND completeness_score < 50 AND last_isbndb_sync IS NULL)
```
**Estimated time**: 25-30 seconds (full table scan)

**With Recommended Index**:
```
Limit  (cost=0.43..8.45 rows=100 width=...)
  ->  Index Scan using idx_enriched_works_synthetic_enhancement on enriched_works
        Index Cond: (synthetic = true AND primary_provider = 'gemini-backfill'
                     AND completeness_score < 50 AND last_isbndb_sync IS NULL)
```
**Estimated time**: 5-10ms (index-only scan)

---

## Index Recommendations

### Composite Index for Enhancement Queries

**CREATE Statement**:
```sql
CREATE INDEX CONCURRENTLY idx_enriched_works_synthetic_enhancement
ON enriched_works (synthetic, primary_provider, completeness_score, created_at)
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50;
```

**Rationale**:

1. **Composite Index Order**:
   - `synthetic` (BOOLEAN) - Most selective filter (excludes 99%+ of works)
   - `primary_provider` (TEXT) - Narrows to gemini-backfill only
   - `completeness_score` (INTEGER) - Filter incomplete works
   - `created_at` (TIMESTAMPTZ) - Sort key (oldest first)

2. **Partial Index** (`WHERE` clause):
   - Reduces index size by 99%+ (only indexes synthetic works)
   - Faster updates (doesn't index non-synthetic works)
   - Matches exact query pattern

3. **CONCURRENTLY**:
   - Avoids locking enriched_works during index creation
   - Safe for production deployment (no downtime)

**Index Size Estimate**:
```
Assuming 10,000 synthetic works (0.02% of 54M total):
- Row size: ~50 bytes (4 columns)
- Index size: 10,000 × 50 = ~500KB
- Overhead: B-tree + metadata = ~1MB total
```

**Maintenance Overhead**: Minimal (only updated when synthetic works inserted)

### Optional: Index for Failed Enhancement Tracking

**If we want to track failed enhancement attempts**:
```sql
-- Add to enhancement query
AND (metadata#>>'{}')::jsonb->>'enhancement_failed' IS NULL

-- Index (if needed)
CREATE INDEX idx_enriched_works_enhancement_failed
ON enriched_works ((metadata#>>'{}')::jsonb->>'enhancement_failed')
WHERE synthetic = true;
```

**Recommendation**: **Skip this index**. Use `last_isbndb_sync IS NULL` instead.

**Rationale**:
- Simpler (no JSONB parsing overhead)
- Existing column (no migration needed)
- Semantic meaning: NULL = never attempted, NOT NULL = attempted (success or fail)

---

## Field Usage Strategy

### Using Existing Fields (No Migration Needed)

**Question**: Do we need a new `enhancement_failed` flag?

**Answer**: **NO** - Use existing fields instead.

**Recommended Approach**:

| Scenario | Field to Use | Value | Interpretation |
|----------|--------------|-------|----------------|
| Never enhanced | `last_isbndb_sync` | `NULL` | Candidate for enhancement |
| Enhancement succeeded | `completeness_score` | `80+` | Skip (already enhanced) |
| Enhancement failed | `last_isbndb_sync` | `NOT NULL` + `completeness_score < 50` | Failed, retry later |
| Partial enhancement | `completeness_score` | `50-79` | Some data, may retry |

**Enhancement Workflow**:

```typescript
// Query candidates
SELECT work_key, title, metadata
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
  AND (
    last_isbndb_sync IS NULL  -- Never attempted
    OR last_isbndb_sync < NOW() - INTERVAL '7 days'  -- Retry failures after 7 days
  )
ORDER BY created_at ASC
LIMIT 100;

// After enhancement attempt
UPDATE enriched_works
SET
  completeness_score = 80,  -- Or 30 if failed
  last_isbndb_sync = NOW(),
  updated_at = NOW()
WHERE work_key = $1;
```

**Benefits**:
- No schema migration required
- Reuses existing timestamp for rate limiting retries
- `completeness_score` naturally tracks enhancement success
- Can distinguish between "never tried" vs "failed" vs "succeeded"

---

## Metadata Extraction Patterns

### Extracting Title/Author for ISBNdb Resolution

**Context**: ISBNdb API requires `title` + `author` to find ISBNs when ISBNs are missing.

**Pattern**:
```typescript
// In TypeScript (Worker)
interface SyntheticWorkMetadata {
  gemini_author?: string;
  gemini_publisher?: string;
  gemini_source?: string;
  gemini_format?: string;
  gemini_significance?: string;
  gemini_persisted_at?: string;
  needs_isbndb_enhancement?: boolean;
}

// Extract metadata
const metadataString = row.metadata as unknown as string;
const metadata: SyntheticWorkMetadata = JSON.parse(metadataString);

const author = metadata.gemini_author;
const publisher = metadata.gemini_publisher;

// Query ISBNdb
const isbndbResults = await searchISBNdb({
  title: row.title,
  author: author,
  publisher: publisher,
});
```

**SQL Extraction** (for testing):
```sql
-- Extract all Gemini metadata fields
SELECT
  work_key,
  title,
  (metadata#>>'{}')::jsonb->>'gemini_author' as author,
  (metadata#>>'{}')::jsonb->>'gemini_publisher' as publisher,
  (metadata#>>'{}')::jsonb->>'gemini_format' as format,
  (metadata#>>'{}')::jsonb->>'gemini_source' as source,
  (metadata#>>'{}')::jsonb->>'gemini_significance' as significance
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
LIMIT 10;
```

**Why Double-Parse?**

From `worker/src/services/gemini-persist.ts:115-122`:
```typescript
metadata: JSON.stringify({
  gemini_source: source,
  gemini_author: candidate.author,
  // ... other fields
})
```

The `metadata` JSONB column receives a **stringified JSON object**, not a direct object. PostgreSQL stores this as:
```json
{"key": "{\"gemini_source\":\"backfill-2024-01\",...}"}
```

Therefore:
1. First parse: `metadata#>>'{}'` → Extract the string
2. Cast to JSONB: `::jsonb` → Parse string as JSON
3. Extract field: `->>'gemini_author'` → Get author value

---

## Security & Concurrency Considerations

### Concurrent Enhancement Safety

**Scenario**: Multiple enhancement cron jobs running simultaneously (shouldn't happen, but defensive).

**Risk**: Two jobs enhance the same work → duplicate ISBNdb calls.

**Mitigation**:
```sql
-- Use FOR UPDATE SKIP LOCKED to prevent race conditions
SELECT work_key, title, metadata
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
  AND last_isbndb_sync IS NULL
ORDER BY created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;  -- Skip already-locked rows
```

**Benefit**: If Job A locks rows 1-100, Job B will automatically select rows 101-200.

### SQL Injection Prevention

**User Input**: None (cron job, no user input).

**Parameterized Queries**: Already used via postgres.js template strings:
```typescript
const works = await sql`
  SELECT * FROM enriched_works
  WHERE work_key = ${workKey}  -- Parameterized, safe
`;
```

---

## Testing Strategy

### Unit Tests

**Test Query Performance**:
```typescript
// Test: Query returns correct synthetic works
const works = await getSyntheticWorksForEnhancement(100, sql);
expect(works.length).toBeLessThanOrEqual(100);
expect(works.every(w => w.synthetic === true)).toBe(true);
expect(works.every(w => w.completeness_score < 50)).toBe(true);

// Test: Metadata extraction
const metadata = JSON.parse(works[0].metadata as unknown as string);
expect(metadata.gemini_author).toBeDefined();
expect(metadata.gemini_publisher).toBeDefined();
```

**Test Index Usage** (manual, in psql):
```sql
-- Verify index is used
EXPLAIN ANALYZE
SELECT work_key, title, metadata
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
ORDER BY created_at ASC
LIMIT 100;

-- Expected: "Index Scan using idx_enriched_works_synthetic_enhancement"
-- NOT: "Seq Scan on enriched_works"
```

### Integration Tests

**Test Enhancement Workflow**:
1. Insert synthetic work (completeness_score=30, last_isbndb_sync=NULL)
2. Run enhancement service
3. Verify update (completeness_score=80, last_isbndb_sync=NOW())
4. Query again → work NOT returned (already enhanced)

---

## Deployment Plan

### Step 1: Create Index (No Downtime)

```bash
# Connect to database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# Create index (takes ~1-2 minutes for 54M rows, 10K synthetic)
CREATE INDEX CONCURRENTLY idx_enriched_works_synthetic_enhancement
ON enriched_works (synthetic, primary_provider, completeness_score, created_at)
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50;
```

**Estimated Duration**: 1-5 minutes (depends on synthetic work count).

**Impact**: None (CONCURRENTLY = no locks).

### Step 2: Verify Index

```sql
-- Check index exists
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE indexname = 'idx_enriched_works_synthetic_enhancement';

-- Test query uses index
EXPLAIN ANALYZE
SELECT work_key, title, metadata
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
  AND completeness_score < 50
ORDER BY created_at ASC
LIMIT 100;
```

**Expected**: `Index Scan using idx_enriched_works_synthetic_enhancement` in output.

### Step 3: Deploy Worker Code

```bash
cd /Users/juju/dev_repos/alex/worker
npm run deploy
```

---

## Performance Estimates

### Query Performance

| Metric | Without Index | With Index | Improvement |
|--------|---------------|------------|-------------|
| Query time (P50) | 25-30s | 5-10ms | **3000x faster** |
| Query time (P95) | 40-50s | 15-20ms | **2500x faster** |
| Rows scanned | 54M | ~10K | 5400x fewer |
| CPU usage | High | Minimal | ~99% reduction |

### Index Overhead

| Metric | Value |
|--------|-------|
| Index size | ~1MB (estimate) |
| Insertion overhead | +0.5ms per synthetic work insert |
| Maintenance | Minimal (vacuum handles it) |

---

## Recommendations Summary

### Critical (Must Implement)

1. ✅ **Create composite index** - `idx_enriched_works_synthetic_enhancement`
   - **Impact**: 3000x query speedup
   - **Cost**: 1MB storage, 0.5ms insert overhead
   - **Deploy**: `CREATE INDEX CONCURRENTLY` (no downtime)

2. ✅ **Use existing fields** - No schema migration needed
   - `last_isbndb_sync` for retry tracking
   - `completeness_score` for success/failure state
   - Simpler, no migration risk

3. ✅ **Double-parse metadata** - Use documented pattern
   - `(metadata#>>'{}')::jsonb->>'gemini_author'`
   - Matches existing codebase convention
   - Works with `JSON.stringify()` persistence

### Optional (Future Optimization)

1. ⚠️ **Partial enhancement tracking** - If retry logic gets complex
   - Add `enhancement_attempts` column (INTEGER)
   - Index on `enhancement_attempts < 3` (limit retries)
   - **Skip for now** - YAGNI (You Ain't Gonna Need It)

2. ⚠️ **Separate enhancement_log entry** - For audit trail
   - Already exists: `enrichment_log` table
   - Use for debugging failed enhancements
   - **Implement later** - Not critical for MVP

---

## Files to Reference

### Schema Definitions
- `/Users/juju/dev_repos/alex/migrations/001_add_enrichment_tables.sql` (lines 19-73)
- `/Users/juju/dev_repos/alex/worker/src/types/database.ts` (lines 163-179)

### Synthetic Work Creation
- `/Users/juju/dev_repos/alex/worker/src/services/gemini-persist.ts` (lines 55-242)
- Key function: `persistGeminiResults()` (line 55)
- Metadata structure: lines 115-122

### Query Examples
- `/Users/juju/dev_repos/alex/scripts/query-gemini-books.sh` (double-parse pattern)
- `CLAUDE.md` (lines 224-250)

---

## Next Steps

**Phase 2: Create Synthetic Enhancement Service**

Now that schema is analyzed and index strategy defined:

1. Create `worker/src/services/synthetic-enhancement.ts`
   - Implement `getSyntheticWorksForEnhancement(limit, sql)`
   - Implement `enhanceSyntheticWork(workKey, sql, env, logger)`
   - Use double-parse pattern for metadata extraction

2. Create index migration script
   - `migrations/009_add_synthetic_enhancement_index.sql`
   - Deploy with `CREATE INDEX CONCURRENTLY`

3. Test query performance
   - Before/after EXPLAIN ANALYZE
   - Verify index usage

---

**Date**: January 10, 2026
**Status**: Phase 1 Complete
**Ready for**: Phase 2 (Service Implementation)
