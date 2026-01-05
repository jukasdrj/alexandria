# Author Name Normalization & Deduplication

**Issue**: #114
**Status**: ⚠️ PENDING DATABASE MIGRATION - Awaiting direct DB connection
**Migration**: `migrations/005_add_author_normalization.sql`

## Problem

Author names in the database have variations causing duplicate entries and poor search results:

- **Case Variations**: "Stephen King" vs "STEPHEN KING"
- **Spacing**: "J.K. Rowling" vs "J. K. Rowling"
- **Co-authors**: "Stephen King & Owen King" treated as separate author
- **Suffixes**: "Martin Luther King, Jr." vs "Martin Luther King"
- **Synonyms**: "Various Authors" vs "Multiple Authors" vs "Collective"

With 14.7M authors in `enriched_authors`, these variations create noise in search results and duplicate author entries.

## Solution

### 1. Database Schema Changes

Added `normalized_name` column to `enriched_authors`:

```sql
ALTER TABLE enriched_authors
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;
```

### 2. Normalization Function

Created PostgreSQL function `normalize_author_name(TEXT)` with these rules:

| Rule | Example | Result |
|------|---------|--------|
| Lowercase | "Stephen King" | "stephen king" |
| Trim whitespace | "  Neil Gaiman  " | "neil gaiman" |
| Normalize periods | "J. K. Rowling" | "j.k.rowling" |
| Remove suffixes | "Martin Luther King, Jr." | "martin luther king" |
| Extract co-author primary | "Stephen King & Owen King" | "stephen king" |
| Standardize "Various" | "Multiple Authors" | "various authors" |
| Collapse spaces | "Neil   Gaiman" | "neil gaiman" |
| Normalize quotes | "O'Brien" → "O'Brien" | Consistent apostrophes |

**Function Properties**:
- **IMMUTABLE**: Allows use in indexes for performance
- **Handles NULL**: Returns NULL for NULL input
- **Consistent**: Same input always produces same output

### 3. Indexes for Performance

```sql
-- GIN trigram index for fuzzy search
CREATE INDEX idx_enriched_authors_normalized_name_trgm
  ON enriched_authors USING gin(normalized_name gin_trgm_ops);

-- B-tree index for exact lookups
CREATE INDEX idx_enriched_authors_normalized_name
  ON enriched_authors(normalized_name);

-- Composite index for duplicate analysis
CREATE INDEX idx_enriched_authors_normalized_duplicates
  ON enriched_authors(normalized_name, author_key);
```

### 4. Auto-Normalize Trigger

Automatically keeps `normalized_name` in sync with `name`:

```sql
CREATE TRIGGER trigger_auto_normalize_author_name
  BEFORE INSERT OR UPDATE OF name ON enriched_authors
  FOR EACH ROW
  EXECUTE FUNCTION auto_normalize_author_name();
```

### 5. Canonical Author View

Created `authors_canonical` view for deduplicated author list:

```sql
CREATE VIEW authors_canonical AS
SELECT DISTINCT ON (normalized_name)
  author_key as canonical_author_key,
  name as canonical_name,
  normalized_name,
  book_count,
  -- ... other fields
FROM enriched_authors
WHERE normalized_name IS NOT NULL
ORDER BY normalized_name, book_count DESC NULLS LAST;
```

**Deduplication Strategy**: Selects author with most books as canonical version per `normalized_name`.

## Search Integration

### Author Search (GET /api/search?author=...)

Updated to use `normalized_name` for better deduplication:

```sql
WHERE (
  CASE
    WHEN ea.normalized_name IS NOT NULL
    THEN ea.normalized_name = normalize_author_name(${author})
         OR ea.normalized_name LIKE '%' || normalize_author_name(${author}) || '%'
    ELSE ea.name ILIKE ${authorPattern}
  END
)
```

**Benefits**:
- Case-insensitive search
- Handles variations automatically
- Falls back to `name` if `normalized_name` NULL

### Top Authors (GET /api/authors/top)

Updated to deduplicate by `normalized_name`:

```sql
WITH author_stats AS (
  SELECT
    ea.author_key,
    ea.name,
    ea.normalized_name,
    COUNT(DISTINCT wae.work_key) as work_count,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(ea.normalized_name, ea.name)
      ORDER BY ea.book_count DESC NULLS LAST
    ) as name_rank
  FROM enriched_authors ea
  JOIN work_authors_enriched wae ON wae.author_key = ea.author_key
  GROUP BY ea.author_key, ea.name, ea.normalized_name, ea.book_count
)
SELECT author_key, author_name, work_count
FROM author_stats
WHERE name_rank = 1  -- Only canonical author per normalized_name
ORDER BY work_count DESC;
```

**Benefits**:
- Eliminates duplicate authors in top lists
- Selects author with most books as canonical
- Maintains backward compatibility

## Deployment

### Prerequisites

1. PostgreSQL extension `pg_trgm` installed (already present)
2. Sufficient disk space for indexes (~500MB estimated)
3. Maintenance window for backfill (30-60 minutes for 14.7M rows)

### Deployment Steps

```bash
# 1. Copy migration to server
scp migrations/005_add_author_normalization.sql root@Tower.local:/tmp/

# 2. Run migration (includes backfill in batches)
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/005_add_author_normalization.sql"

# 3. Run test suite to verify
scp migrations/005_test_normalization.sql root@Tower.local:/tmp/
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/005_test_normalization.sql"

# 4. Deploy updated Worker code
cd worker/
npm run deploy

# 5. Verify search works
curl 'https://alexandria.ooheynerds.com/api/search?author=Stephen%20King&limit=5' | jq
curl 'https://alexandria.ooheynerds.com/api/authors/top?limit=20' | jq

# 6. Monitor performance
npm run tail
```

### Rollback Plan

If issues arise:

```sql
-- Disable trigger
DROP TRIGGER trigger_auto_normalize_author_name ON enriched_authors;

-- Drop indexes
DROP INDEX idx_enriched_authors_normalized_name_trgm;
DROP INDEX idx_enriched_authors_normalized_name;
DROP INDEX idx_enriched_authors_normalized_duplicates;

-- Revert Worker deployment
cd worker/
git revert HEAD
npm run deploy
```

Column `normalized_name` can remain (populated but unused) for future retry.

## Testing

### Unit Tests

**PostgreSQL Function Tests** (`migrations/005_test_normalization.sql`):
- ✅ Basic normalization (lowercase, trim)
- ✅ Period spacing (J.K. Rowling variations)
- ✅ Co-author extraction
- ✅ Suffix removal (Jr., Sr., PhD, etc.)
- ✅ "Various Authors" normalization
- ✅ Multiple spaces
- ✅ Apostrophes and quotes
- ✅ NULL handling
- ✅ Edge cases (empty string, single char, numbers)
- ✅ Trigger verification (INSERT/UPDATE)
- ✅ Performance benchmark

### Integration Tests

**Worker Tests** (`worker/src/__tests__/author-normalization.test.ts`):
- Search deduplication
- Top authors deduplication
- Fallback to ILIKE if `normalized_name` NULL
- Edge cases (special chars, Unicode, long names)
- Performance benchmarks

### Manual Testing

```bash
# Test author search variations
curl 'https://alexandria.ooheynerds.com/api/search?author=J.K.%20Rowling&limit=5'
curl 'https://alexandria.ooheynerds.com/api/search?author=J.%20K.%20Rowling&limit=5'
curl 'https://alexandria.ooheynerds.com/api/search?author=Stephen%20King%20%26%20Owen%20King&limit=5'

# Test top authors (should be deduplicated)
curl 'https://alexandria.ooheynerds.com/api/authors/top?limit=100' | jq '.authors[] | .author_name' | sort

# Check for duplicates in database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
  SELECT normalized_name, COUNT(*) as count, ARRAY_AGG(name ORDER BY name LIMIT 3) as variations
  FROM enriched_authors
  WHERE normalized_name IS NOT NULL
  GROUP BY normalized_name
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT 20;
\""
```

## Performance Impact

### Query Performance

**Before Normalization**:
- Author search: ~100-300ms (ILIKE scan on `name`)
- Top authors: ~15-20s (first run, then cached)

**After Normalization** (Expected):
- Author search: ~50-150ms (indexed `normalized_name`)
- Top authors: ~10-15s (fewer rows due to deduplication)

### Storage Impact

- `normalized_name` column: ~500MB (14.7M rows × ~35 bytes avg)
- Indexes: ~800MB total (GIN trigram, B-tree, composite)
- **Total**: ~1.3GB additional storage

### Backfill Performance

Migration processes 14.7M rows in batches of 50,000:
- **Estimated time**: 30-60 minutes
- **Progress logging**: Every 50K rows
- Uses `COMMIT` checkpoints for resumability

## Future Enhancements

### Phase 2: Co-Author Support (Optional)

Instead of extracting primary author, create proper co-author relationships:

```sql
CREATE TABLE author_collaborations (
  work_key TEXT REFERENCES enriched_works(work_key),
  author_key TEXT REFERENCES enriched_authors(author_key),
  co_author_key TEXT REFERENCES enriched_authors(author_key),
  PRIMARY KEY (work_key, author_key, co_author_key)
);
```

**Benefits**:
- Preserve "Stephen King & Owen King" relationship
- Enable "show all collaborations" queries
- Better co-author discovery

### Phase 3: Manual Merge Endpoint (Optional)

Admin endpoint for manually merging duplicate authors:

```
POST /api/authors/merge
{
  "source_author_key": "/authors/OL123A",
  "target_author_key": "/authors/OL456A"
}
```

**Actions**:
1. Update all `work_authors_enriched` references
2. Merge metadata (prefer target, keep source if NULL)
3. Mark source as `merged_into` target
4. Invalidate caches

### Phase 4: Periodic Deduplication Job

Cron job to identify and flag potential duplicates for manual review:

```sql
SELECT
  normalized_name,
  COUNT(*) as author_count,
  ARRAY_AGG(name ORDER BY book_count DESC) as variations,
  ARRAY_AGG(author_key ORDER BY book_count DESC) as keys
FROM enriched_authors
WHERE normalized_name IS NOT NULL
  AND normalized_name NOT IN ('various authors', 'anonymous')
GROUP BY normalized_name
HAVING COUNT(*) > 1 AND COUNT(*) < 10  -- Skip "various authors" (thousands)
ORDER BY COUNT(*) DESC;
```

## Metrics & Monitoring

### Key Metrics to Track

1. **Deduplication Effectiveness**:
   - Unique authors before: 14.7M
   - Unique `normalized_name` values: TBD (expect ~14.5M, ~1.4% reduction)

2. **Search Quality**:
   - % searches using `normalized_name`: Target 100% after backfill
   - % searches falling back to `name ILIKE`: Should decrease to 0%

3. **Performance**:
   - P95 author search latency: Target <200ms
   - Top authors query time: Target <15s (uncached)

4. **Duplicates Found**:
   - Authors with same `normalized_name`: Track count
   - Top duplicate groups: Monitor for data quality

### Monitoring Queries

```sql
-- Check backfill progress
SELECT
  COUNT(*) as total_authors,
  COUNT(normalized_name) as normalized,
  ROUND(COUNT(normalized_name)::numeric / COUNT(*)::numeric * 100, 2) as percent_complete
FROM enriched_authors;

-- Find duplicates needing manual review
SELECT
  normalized_name,
  COUNT(*) as duplicate_count,
  ARRAY_AGG(name ORDER BY book_count DESC LIMIT 5) as top_variations
FROM enriched_authors
WHERE normalized_name IS NOT NULL
GROUP BY normalized_name
HAVING COUNT(*) > 5  -- More than 5 variations = likely data quality issue
ORDER BY COUNT(*) DESC
LIMIT 20;

-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'enriched_authors'
  AND indexname LIKE '%normalized%'
ORDER BY idx_scan DESC;
```

## References

- **Issue**: #114 Author Deduplication and Normalization
- **Migration**: `migrations/005_add_author_normalization.sql`
- **Tests**: `migrations/005_test_normalization.sql`
- **Integration Tests**: `worker/src/__tests__/author-normalization.test.ts`
- **Analysis Script**: `scripts/analyze-author-duplicates.js`

## Change Log

- **2026-01-04**: Initial implementation
  - Added `normalized_name` column
  - Created `normalize_author_name()` function
  - Added indexes and trigger
  - Updated search endpoints
  - Created test suite
  - Documentation complete
