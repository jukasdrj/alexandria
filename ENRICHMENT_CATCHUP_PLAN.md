# Alexandria Enrichment Catchup Plan

**Date:** December 2, 2025  
**Status:** Infrastructure Ready, Data Migration Pending

---

## Current State

### ✅ Fully Operational (No Technical Hurdles)

| Component | Status | Details |
|-----------|--------|---------|
| **Worker** | ✅ Live | `alexandria.ooheynerds.com` |
| **Database** | ✅ Connected | Hyperdrive ~218ms to PostgreSQL |
| **R2 Covers** | ✅ Bound | `bookstrack-covers-processed` |
| **Enrichment Tables** | ✅ Deployed | 6 tables, 19 indexes, 3 triggers |
| **Write Endpoints** | ✅ Working | `/api/enrich/edition,work,author,queue` |
| **Queue Consumer** | ✅ Running | Cron every 5 min |
| **API Keys** | ✅ Configured | ISBNdb + Google Books in Secrets Store |

### Current Enrichment Data

```
enriched_editions:  166 records ✅ (from Google Books)
enriched_works:       0 records ⏳
enriched_authors:     0 records ⏳
enrichment_queue:     1 record  (completed - Harry Potter test)
```

### Base OpenLibrary Tables (Source Data)

```
editions:      54.8M records
edition_isbns: 49.3M records  
works:         40.1M records
authors:       14.7M records
```

---

## The Gap: From 54.8M to Enriched

The base OpenLibrary tables have the data, but the **enriched_** tables are nearly empty. The enrichment pipeline is *ready* but hasn't been fed.

---

## Two Strategies for Catchup

### Strategy A: Bulk Migration (Faster, Simpler)

Copy existing OpenLibrary data directly into enriched tables:

```sql
-- Example: Migrate editions with ISBNs to enriched_editions
INSERT INTO enriched_editions (isbn, title, work_key, openlibrary_edition_id, primary_provider, contributors, completeness_score, isbndb_quality)
SELECT 
  ei.isbn,
  e.data->>'title',
  e.work_key,
  REPLACE(e.key, '/books/', ''),
  'openlibrary',
  ARRAY['openlibrary'],
  25,  -- Low completeness (OpenLibrary data is sparse)
  0    -- Not yet enriched by ISBNdb
FROM edition_isbns ei
JOIN editions e ON e.key = ei.edition_key
WHERE ei.isbn IS NOT NULL
  AND LENGTH(ei.isbn) = 13
ON CONFLICT (isbn) DO NOTHING;
```

**Pros:**
- Fast, immediate coverage
- All 49M ISBNs available instantly
- No API costs

**Cons:**
- Low quality scores (OpenLibrary data is spotty)
- Missing publisher, page counts, descriptions
- Requires background enrichment later

---

### Strategy B: Demand-Driven Enrichment (Slower, Higher Quality)

Only enrich books as users look them up:

1. User looks up ISBN → not in enriched_editions
2. Search base tables → return result
3. Queue background enrichment job → ISBNdb/Google Books
4. Next lookup → returns enriched data

**Pros:**
- High quality data from day one
- Pay-as-you-go (only enrich what's needed)
- No wasted API calls

**Cons:**
- First lookup has no enrichment
- Cold start for every new ISBN
- Slower to build coverage

---

## Recommended Approach: Hybrid

### Phase 1: Bulk Seed (Immediate)

Migrate 49M ISBNs from OpenLibrary → enriched_editions with minimal metadata:

```sql
-- Run on Tower via SSH
INSERT INTO enriched_editions (
  isbn, 
  title, 
  work_key, 
  openlibrary_edition_id,
  primary_provider, 
  contributors,
  completeness_score,
  isbndb_quality,
  created_at,
  updated_at
)
SELECT 
  ei.isbn,
  e.data->>'title',
  e.work_key,
  REPLACE(e.key, '/books/', ''),
  'openlibrary',
  ARRAY['openlibrary'],
  25,
  0,
  NOW(),
  NOW()
FROM edition_isbns ei
JOIN editions e ON e.key = ei.edition_key
WHERE ei.isbn IS NOT NULL
  AND LENGTH(ei.isbn) = 13
ON CONFLICT (isbn) DO NOTHING;
```

**Expected result:** ~49M records with basic title/work_key

### Phase 2: Priority Queue Seeding

Seed enrichment_queue with high-value ISBNs:

1. **NYT Bestsellers** (last 5 years) - ~500 ISBNs
2. **Goodreads Top 1000** - ~1000 ISBNs  
3. **Amazon Top 100 per category** - ~2000 ISBNs
4. **User lookup history** (from bendv3 logs) - Variable

```sql
-- Example: Queue NYT bestsellers for ISBNdb enrichment
INSERT INTO enrichment_queue (id, entity_type, entity_key, providers_to_try, priority, status, created_at)
SELECT 
  gen_random_uuid(),
  'edition',
  isbn,
  ARRAY['isbndb', 'google-books'],
  9,  -- High priority
  'pending',
  NOW()
FROM (VALUES 
  ('9780735211292'),  -- Atomic Habits
  ('9780525559474'),  -- The Midnight Library
  ('9780593230572'),  -- Lessons in Chemistry
  -- ... more bestsellers
) AS bestsellers(isbn)
ON CONFLICT DO NOTHING;
```

### Phase 3: Background Enrichment (Ongoing)

The existing cron (every 5 min) processes 10 jobs per run:
- 10 jobs × 12 runs/hour × 24 hours = **2,880 enrichments/day**
- ISBNdb rate limit: 1 req/sec = **86,400/day max**

Current config is conservative. Can increase batch size for faster enrichment.

### Phase 4: On-Demand Enrichment

When bendv3 looks up an ISBN:
1. Check enriched_editions first
2. If `isbndb_quality < 70`, queue background enrichment
3. Return current data immediately
4. Future lookups get enriched data

---

## Migration Scripts

### Script 1: Bulk Edition Migration

```bash
# migrations/003_seed_enriched_editions.sql
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary" << 'EOF'
-- Seed enriched_editions from OpenLibrary base tables
-- Expected: ~49M rows, runtime: 30-60 minutes

BEGIN;

INSERT INTO enriched_editions (
  isbn, 
  title,
  subtitle,
  work_key, 
  edition_key,
  openlibrary_edition_id,
  publisher,
  publication_date,
  page_count,
  language,
  primary_provider, 
  contributors,
  completeness_score,
  isbndb_quality,
  created_at,
  updated_at
)
SELECT 
  ei.isbn,
  e.data->>'title',
  e.data->>'subtitle',
  e.work_key,
  e.key,
  REPLACE(e.key, '/books/', ''),
  (e.data->'publishers'->>0),
  e.data->>'publish_date',
  (e.data->>'number_of_pages')::integer,
  e.data->>'languages',
  'openlibrary',
  ARRAY['openlibrary'],
  -- Calculate basic completeness
  CASE 
    WHEN e.data->>'title' IS NOT NULL 
     AND e.data->'publishers'->>0 IS NOT NULL 
     AND e.data->>'number_of_pages' IS NOT NULL THEN 50
    WHEN e.data->>'title' IS NOT NULL 
     AND e.data->'publishers'->>0 IS NOT NULL THEN 35
    WHEN e.data->>'title' IS NOT NULL THEN 25
    ELSE 10
  END,
  0,  -- Not ISBNdb enriched yet
  NOW(),
  NOW()
FROM edition_isbns ei
JOIN editions e ON e.key = ei.edition_key
WHERE ei.isbn IS NOT NULL
  AND LENGTH(ei.isbn) = 13
ON CONFLICT (isbn) DO NOTHING;

-- Log result
SELECT 'Migrated ' || COUNT(*) || ' editions' FROM enriched_editions;

COMMIT;
EOF
```

### Script 2: Bulk Work Migration

```bash
# migrations/004_seed_enriched_works.sql
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary" << 'EOF'
BEGIN;

INSERT INTO enriched_works (
  work_key,
  title,
  description,
  subject_tags,
  openlibrary_work_id,
  primary_provider,
  contributors,
  completeness_score,
  created_at,
  updated_at
)
SELECT 
  w.key,
  w.data->>'title',
  CASE 
    WHEN jsonb_typeof(w.data->'description') = 'string' THEN w.data->>'description'
    WHEN jsonb_typeof(w.data->'description') = 'object' THEN w.data->'description'->>'value'
    ELSE NULL
  END,
  ARRAY(SELECT jsonb_array_elements_text(w.data->'subjects') LIMIT 20),
  REPLACE(w.key, '/works/', ''),
  'openlibrary',
  ARRAY['openlibrary'],
  CASE 
    WHEN w.data->>'title' IS NOT NULL AND w.data->'description' IS NOT NULL THEN 50
    WHEN w.data->>'title' IS NOT NULL THEN 30
    ELSE 10
  END,
  NOW(),
  NOW()
FROM works w
WHERE w.key IS NOT NULL
ON CONFLICT (work_key) DO NOTHING;

SELECT 'Migrated ' || COUNT(*) || ' works' FROM enriched_works;

COMMIT;
EOF
```

### Script 3: Bulk Author Migration

```bash
# migrations/005_seed_enriched_authors.sql
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary" << 'EOF'
BEGIN;

INSERT INTO enriched_authors (
  author_key,
  name,
  bio,
  birth_year,
  death_year,
  openlibrary_author_id,
  primary_provider,
  contributors,
  created_at,
  updated_at
)
SELECT 
  a.key,
  a.data->>'name',
  CASE 
    WHEN jsonb_typeof(a.data->'bio') = 'string' THEN a.data->>'bio'
    WHEN jsonb_typeof(a.data->'bio') = 'object' THEN a.data->'bio'->>'value'
    ELSE NULL
  END,
  (REGEXP_MATCH(a.data->>'birth_date', '\d{4}'))[1]::integer,
  (REGEXP_MATCH(a.data->>'death_date', '\d{4}'))[1]::integer,
  REPLACE(a.key, '/authors/', ''),
  'openlibrary',
  ARRAY['openlibrary'],
  NOW(),
  NOW()
FROM authors a
WHERE a.key IS NOT NULL
  AND a.data->>'name' IS NOT NULL
ON CONFLICT (author_key) DO NOTHING;

SELECT 'Migrated ' || COUNT(*) || ' authors' FROM enriched_authors;

COMMIT;
EOF
```

---

## Performance Considerations

### Bulk Migration Runtime Estimates

| Table | Source Rows | Estimated Time |
|-------|-------------|----------------|
| enriched_editions | ~49M | 30-60 min |
| enriched_works | ~40M | 20-40 min |
| enriched_authors | ~14M | 10-20 min |

### Index Strategy

The enrichment tables already have indexes from migration 001:
- GIN on title (fuzzy search)
- B-tree on work_key, isbn
- Partial indexes on quality scores

After bulk migration, run:
```sql
ANALYZE enriched_editions;
ANALYZE enriched_works;
ANALYZE enriched_authors;
```

---

## Next Steps

1. **[ ] Run bulk edition migration** - 49M ISBNs with basic metadata
2. **[ ] Run bulk work migration** - 40M works with titles/descriptions
3. **[ ] Run bulk author migration** - 14M authors with names/bios
4. **[ ] Seed priority queue** - Bestsellers, popular books
5. **[ ] Verify bendv3 integration** - Ensure queries hit enriched_editions first
6. **[ ] Monitor cron enrichment** - Watch queue processing logs
7. **[ ] Add pg_trgm for fuzzy search** - Faster title/author matching

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Enriched coverage | 100% of ISBNs | `SELECT COUNT(*) FROM enriched_editions` |
| High-quality editions | 10K+ with isbndb_quality > 70 | Priority enrichment |
| Query latency | <30ms p95 | Alexandria logs |
| Queue throughput | 2,880/day | Cron monitoring |

---

**Last Updated:** December 2, 2025
