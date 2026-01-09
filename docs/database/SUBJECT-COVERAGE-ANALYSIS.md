# Subject Coverage Analysis - Deep Dive

**Date**: 2026-01-09
**Context**: Investigating why only 36% of works have subjects and how to improve to 80%+

## Executive Summary

**Current State**: Only 36% of works (7.7M / 21.3M) have subject tags in enriched_works

**Root Causes Identified**:
1. **Missing Works**: enriched_works only has 53% of OpenLibrary works (21.3M / 40.2M)
2. **Unused Data**: OpenLibrary has subjects for 19.5M works (49%) but we're not enriching all of them
3. **Limited Sources**: Currently only using OpenLibrary + ISBNdb subjects

**Impact**:
- ~12M works with subjects in OpenLibrary that aren't in enriched_works
- Additional ~9M works without subjects anywhere (need external sources)

**Path to 80%+ Coverage**:
1. Enrich more works from OpenLibrary (53% → 80%+ of OL works)
2. Extract subjects from Google Books API
3. Use Gemini to infer genres from titles/descriptions
4. Normalize and deduplicate subject names

---

## Current Coverage Breakdown

### Overall Statistics

```
Total OpenLibrary works: 40,158,492
Total enriched works:    21,324,332 (53% of OL)

OL works with subjects:       19,507,046 (49% of OL total)
Enriched works with subjects:  7,717,302 (36% of enriched)
```

**The Gap**: 11,789,744 works have subjects in OpenLibrary but aren't in enriched_works!

### Coverage by Provider

| Provider | Total Works | With Subjects | Coverage % | Avg Subjects |
|----------|-------------|---------------|------------|--------------|
| **openlibrary** | 21,248,983 | 7,661,942 | 36.06% | 1.42 |
| **isbndb** | 75,273 | 55,360 | 73.55% | 2.42 |
| **gemini-backfill** | 76 | 0 | 0.00% | 0.00 |

**Key Finding**: ISBNdb provides much better subject coverage (73.55%) but represents tiny portion of data (0.35%)

---

## Root Cause Analysis

### Problem 1: Only Enriching 53% of OpenLibrary Works

**Evidence**:
```sql
-- OpenLibrary has 40.2M works
SELECT COUNT(*) FROM works;
-- Result: 40,158,492

-- Enriched works only has 21.3M
SELECT COUNT(*) FROM enriched_works;
-- Result: 21,324,332
```

**Why This Happens**:
- enriched_works is populated via enrichment pipeline (ISBNdb batch lookups)
- Only works with ISBNs get enriched
- Many OpenLibrary works lack ISBNs or aren't in ISBNdb database
- ~19M works (47%) never make it to enriched_works

**Impact on Subject Coverage**:
- OpenLibrary has 19.5M works with subjects
- We're only enriching 21.3M works total
- Missing ~12M works that have subjects in OpenLibrary source data

### Problem 2: Subject Data Sources

**Current Sources**:
1. **OpenLibrary** (`works.data->'subjects'`):
   - 19.5M works with subjects (49% coverage in OL)
   - Example: `["Fiction", "Mystery", "Detective stories"]`
   - Quality: Good, but inconsistent formatting
   - Availability: Already in our database!

2. **ISBNdb** (`subjects` field in API response):
   - 55,360 works with subjects (73% of ISBNdb works)
   - Example: `["Fiction", "Mystery & Detective", "General"]`
   - Quality: Structured, but sometimes generic
   - Availability: Requires API calls (quota limited)

3. **Google Books** (not currently extracted):
   - Has `categories` field in API response
   - Example: `["Fiction / Mystery & Detective"]`
   - Quality: Well-structured, genre taxonomy
   - Availability: 1,000 requests/day (limited)

4. **Gemini Backfill** (not extracting subjects):
   - Could infer genres from title/description
   - Example: Title "The Great Gatsby" → ["Fiction", "American Literature", "1920s", "Literary Fiction"]
   - Quality: AI-inferred, needs confidence scoring
   - Availability: Unlimited (we own the generation)

**Current Pipeline Flow**:
```
ISBN → ISBNdb API → enriched_editions
       ↓
    work_key → enriched_works (subjects from ISBNdb)
```

**Missing Flow**:
```
OpenLibrary works.data->'subjects' → NOT being extracted to enriched_works!
Google Books API categories → NOT being called
Gemini inferred genres → NOT being extracted
```

### Problem 3: Data Quality Issues

**Inconsistent Naming**:
- "Fiction" vs "Fiction, general" vs "Fiction / Mystery & Detective"
- "History" vs "History and criticism"
- Needs normalization/standardization

**Generic Tags** (from ISBNdb):
- "Arborist Merchandising Root" (merchandising artifact)
- "Self Service" (not a genre)
- Need filtering

**No Hierarchy**:
- "Fiction, romance, general" should map to Fiction → Romance
- No parent-child relationships
- Limits discoverability

---

## Detailed Analysis

### What's in OpenLibrary Source Data?

**Sample OpenLibrary work with subjects**:
```json
{
  "key": "/works/OL100009W",
  "subjects": [
    "Deborah Knott (Fictitious character)",
    "Open Library Staff Picks",
    "Women judges",
    "Fiction",
    "Potters",
    "Large type books",
    "Fiction, mystery & detective, women sleuths",
    "North carolina, fiction",
    "Knott, deborah (fictitious character), fiction",
    "Fiction, mystery & detective, general"
  ]
}
```

**Observations**:
- Mix of genres, character names, locations, formats
- Inconsistent casing and formatting
- Some are highly specific, others generic
- BUT: Data exists and is reasonably good quality!

### Subject Coverage in enriched_works

**Works WITH subjects in enriched_works are correctly populated**:
```sql
-- Check if subjects are being copied
SELECT
  w.key,
  w.data->'subjects' as ol_subjects,
  ew.subject_tags as enriched_subjects
FROM works w
JOIN enriched_works ew ON w.key = ew.work_key
WHERE w.data->'subjects' IS NOT NULL
LIMIT 1;
```

**Result**: ✅ Subjects ARE being copied when work is in enriched_works

**Problem**: Works WITHOUT ISBNs never get into enriched_works

---

## Path to 80%+ Coverage

### Quick Wins (Immediate - This Week)

#### 1. Backfill Subjects from OpenLibrary (HIGH PRIORITY)

**Target**: Add 12M works with subjects from OpenLibrary

**Approach**: One-time backfill script

```sql
-- Insert works from OpenLibrary that have subjects but aren't enriched
INSERT INTO enriched_works (
  work_key,
  title,
  subject_tags,
  primary_provider,
  created_at,
  updated_at
)
SELECT
  w.key,
  w.data->>'title',
  ARRAY(SELECT jsonb_array_elements_text(w.data->'subjects')),
  'openlibrary',
  NOW(),
  NOW()
FROM works w
LEFT JOIN enriched_works ew ON w.key = ew.work_key
WHERE w.data->'subjects' IS NOT NULL
  AND jsonb_array_length(w.data->'subjects') > 0
  AND ew.work_key IS NULL  -- Not already in enriched_works
ON CONFLICT (work_key) DO UPDATE SET
  subject_tags = EXCLUDED.subject_tags,
  updated_at = NOW();
```

**Expected Impact**: 36% → 60%+ coverage (add 12M works)

**Time**: 10-20 minutes to run, one-time operation

**Risk**: Low - just copying data that already exists

#### 2. Add GIN Index on subject_tags (DONE IN PHASE 2)

```sql
CREATE INDEX idx_enriched_works_subjects ON enriched_works USING GIN (subject_tags);
```

**Impact**: Fast subject queries (`WHERE 'Fiction' = ANY(subject_tags)`)

**Time**: 10-15 minutes

### Medium-Term (This Month)

#### 3. Extract Google Books Categories

**Modify enrichment pipeline** to call Google Books API and extract categories:

```typescript
// In enrichment-service.ts
async function enrichFromGoogleBooks(isbn: string): Promise<string[]> {
  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${API_KEY}`
  );
  const data = await response.json();

  if (data.items?.[0]?.volumeInfo?.categories) {
    return data.items[0].volumeInfo.categories;
  }
  return [];
}
```

**Expected Impact**: 60% → 70% coverage (Google Books has good category coverage)

**Quota Impact**: 1,000 calls/day limit (would take ~28,000 days for all works!)

**Solution**: Only call for high-priority works (new enrichments, user-requested)

#### 4. Infer Genres with Gemini

**For works without subjects**, use Gemini to infer from title/description:

```typescript
async function inferGenresWithGemini(title: string, description?: string): Promise<string[]> {
  const prompt = `Given this book:
Title: "${title}"
Description: "${description || 'N/A'}"

Infer 3-5 genre/subject tags. Return only the tags, comma-separated.
Example: Fiction, Mystery, Thriller, Crime`;

  const response = await gemini.generateContent(prompt);
  return response.text().split(',').map(s => s.trim());
}
```

**Expected Impact**: 70% → 80%+ coverage

**Cost**: Essentially free (we control Gemini usage)

**Confidence**: Add `ai_inferred: true` flag to track which subjects are AI-generated

### Long-Term (Next Quarter)

#### 5. Subject Normalization

Build normalization layer:

```typescript
const SUBJECT_NORMALIZATION = {
  'fiction, general': 'Fiction',
  'fiction, mystery & detective': 'Mystery',
  'fiction, romance, general': 'Romance',
  // ... hundreds more mappings
};
```

**Expected Impact**: Better query results, cleaner browsing

**Effort**: Significant (requires building comprehensive mapping)

#### 6. Genre Taxonomy

Build parent-child relationships:

```typescript
const GENRE_TAXONOMY = {
  'Fiction': {
    children: ['Mystery', 'Romance', 'Science Fiction', 'Fantasy', ...],
    parent: null
  },
  'Mystery': {
    children: ['Detective', 'Crime', 'Thriller', ...],
    parent: 'Fiction'
  }
};
```

**Expected Impact**: Hierarchical browsing, "show all fiction subgenres"

**Effort**: High (requires careful taxonomy design)

---

## Sequential Scans Investigation

### pg_stat_statements Status

**Installed**: ✅ Extension enabled
**Status**: Collecting data (needs time to accumulate queries)

**Next Steps**:
1. Let pg_stat_statements collect data for 24 hours
2. Run analysis query to find top sequential scan queries
3. Identify optimization opportunities

**Query to Run Later**:
```sql
SELECT
  substring(query, 1, 100) as query_snippet,
  calls,
  total_exec_time,
  mean_exec_time,
  shared_blks_hit,
  shared_blks_read,
  rows
FROM pg_stat_statements
WHERE query ILIKE '%seq scan%'
   OR shared_blks_read > 10000
ORDER BY total_exec_time DESC
LIMIT 20;
```

**Follow-up**: Check back in 24 hours for meaningful data

---

## Recommendations

### Priority 1: Immediate Action (This Session)

1. **Backfill OpenLibrary subjects** (10-20 min)
   - Impact: 36% → 60%+ coverage
   - Risk: Low
   - SQL provided above

2. **Create GIN index on subject_tags** (10 min)
   - Impact: Fast subject queries
   - Risk: None
   - Storage: ~500MB-1GB

### Priority 2: This Week

3. **Create mv_subject_stats** (30 min)
   - Impact: Subject browsing/stats
   - Documented in QUERY-OPTIMIZATION-OPPORTUNITIES.md

4. **Test subject queries** (30 min)
   - Verify GIN index performance
   - Build sample queries for API

### Priority 3: This Month

5. **Add Google Books category extraction** (4-8 hours)
   - Impact: 60% → 70% coverage
   - Requires pipeline modification
   - Quota-aware (1,000/day limit)

6. **Add Gemini genre inference** (4-8 hours)
   - Impact: 70% → 80%+ coverage
   - For works without any subjects
   - AI-generated with confidence flag

### Priority 4: Long-term

7. **Subject normalization layer** (2-4 weeks)
   - Standardize subject names
   - Remove junk subjects
   - Build comprehensive mappings

8. **Genre taxonomy** (4-8 weeks)
   - Parent-child relationships
   - Hierarchical browsing
   - API enhancements

---

## SQL Scripts for Immediate Use

### Backfill OpenLibrary Subjects

```sql
-- Count how many we'll add
SELECT COUNT(*) as works_to_add
FROM works w
LEFT JOIN enriched_works ew ON w.key = ew.work_key
WHERE w.data->'subjects' IS NOT NULL
  AND jsonb_array_length(w.data->'subjects') > 0
  AND ew.work_key IS NULL;

-- Insert them (takes 10-20 minutes)
INSERT INTO enriched_works (
  work_key,
  title,
  subject_tags,
  primary_provider,
  completeness_score,
  created_at,
  updated_at
)
SELECT
  w.key,
  w.data->>'title',
  ARRAY(SELECT jsonb_array_elements_text(w.data->'subjects')),
  'openlibrary',
  25,  -- Base completeness for title + subjects only
  NOW(),
  NOW()
FROM works w
LEFT JOIN enriched_works ew ON w.key = ew.work_key
WHERE w.data->'subjects' IS NOT NULL
  AND jsonb_array_length(w.data->'subjects') > 0
  AND ew.work_key IS NULL
ON CONFLICT (work_key) DO UPDATE SET
  subject_tags = CASE
    WHEN enriched_works.subject_tags IS NULL
    THEN EXCLUDED.subject_tags
    ELSE (
      SELECT array_agg(DISTINCT tag)
      FROM unnest(array_cat(enriched_works.subject_tags, EXCLUDED.subject_tags)) AS tag
    )
  END,
  updated_at = NOW();

-- Verify results
SELECT
  COUNT(*) as total_enriched_works,
  COUNT(CASE WHEN subject_tags IS NOT NULL AND array_length(subject_tags, 1) > 0 THEN 1 END) as with_subjects,
  ROUND(100.0 * COUNT(CASE WHEN subject_tags IS NOT NULL AND array_length(subject_tags, 1) > 0 THEN 1 END) / COUNT(*), 2) as coverage_pct
FROM enriched_works;
```

### Create GIN Index

```sql
-- Create index for fast subject queries (10-15 minutes)
CREATE INDEX CONCURRENTLY idx_enriched_works_subjects
ON enriched_works USING GIN (subject_tags);

-- Verify index works
EXPLAIN ANALYZE
SELECT * FROM enriched_works
WHERE 'Fiction' = ANY(subject_tags)
LIMIT 100;
-- Should see: Bitmap Index Scan using idx_enriched_works_subjects
```

---

## Expected Results After Immediate Actions

| Metric | Before | After Backfill | Target (Long-term) |
|--------|--------|----------------|-------------------|
| **Works with subjects** | 7.7M (36%) | ~19M (60%+) | 27M+ (80%+) |
| **Subject queries** | Slow (seq scan) | Fast (<1ms) | Fast |
| **Sources** | OL + ISBNdb | OL + ISBNdb | OL + ISBNdb + Google + Gemini |
| **Quality** | Inconsistent | Inconsistent | Normalized + Taxonomy |

---

## Conclusion

**Root Causes**:
1. Only enriching 53% of OpenLibrary works (missing 19M works)
2. OpenLibrary HAS subjects for 19.5M works but we're only using 7.7M
3. Not extracting subjects from Google Books or inferring with Gemini

**Quick Path to 60%+ Coverage**:
- Backfill from OpenLibrary (10-20 min, adds 12M works)
- Add GIN index (10 min, enables fast queries)
- ✅ Can be done TODAY

**Path to 80%+ Coverage**:
- Google Books category extraction (requires pipeline work)
- Gemini genre inference (for works without subjects)
- Subject normalization and taxonomy (long-term quality)

**Sequential Scans**:
- pg_stat_statements now collecting data
- Need 24 hours to accumulate meaningful query statistics
- Follow-up analysis coming soon

**Recommendation**: Start with backfill + GIN index (20-30 minutes, massive impact)
