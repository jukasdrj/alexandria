# Author Works Backfill Guide - Issue #186

## Overview

Backfills missing `author_works` mappings for 75,508 ISBNdb works created before January 6, 2026 (when `linkWorkToAuthors()` was added to the enrichment queue handler).

**Problem**: Works show empty `authors` arrays in search results despite having valid book data.

**Solution**: Multi-provider external API resolution with graceful ISBNdb fallback.

---

## Current State (January 14, 2026)

### Coverage Statistics
- **Total enriched works**: 33,170,605
- **Works with authors**: 31,629,351 (95.35%)
- **Works missing authors**: **75,508** (2.28% of enriched works)
  - **1,670 works** (2.2%) have OpenLibrary edition IDs → direct lookup
  - **73,838 works** (97.8%) need title/ISBN resolution via external APIs

### Why This Happened
**January 6, 2026** - Issue #141 fixed work duplication bug by adding `linkWorkToAuthors()` to enrichment pipeline. All works created **before** this date lack author mappings.

### Example: Harry Potter
```bash
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873' | jq '.data.authors'
# Returns: [] ❌
# Expected: [{"name": "J.K. Rowling", ...}] ✅
```

---

## Architecture

### Hybrid Resolution Strategy

**ISBNdb Quota Exhausted** → Use free external APIs:

1. **OpenLibrary** (Direct - 1,670 works):
   - For works with `openlibrary_edition_id`
   - Fetch edition → Extract author references → Fetch author names
   - Rate limit: 100 req/5min (handled by 3s sleep)

2. **External API Cascading** (73,838 works):
   - Uses `MetadataEnrichmentOrchestrator`
   - Priority: OpenLibrary → Google Books → Archive.org → Wikidata
   - Each provider has 10s timeout
   - Graceful degradation (null on failure, continues to next)

3. **Database Update**:
   - Uses existing `linkWorkToAuthors()` utility
   - Creates `author_works` records
   - Creates `enriched_authors` if needed (fuzzy match 70% threshold)
   - Request-scoped cache prevents duplicate author creation

### Rate Limiting
- **3 seconds** between works (OpenLibrary: 100 req/5min = 20 req/min = 3s)
- **Safe for production** - won't exhaust free tier quotas

---

## Endpoint Specification

### POST /api/internal/backfill-author-works

**Authentication**: Requires `X-Cron-Secret` header matching `ALEXANDRIA_WEBHOOK_SECRET`

**Request Body**:
```json
{
  "batch_size": 100,      // Works per batch (1-1000)
  "dry_run": true,         // Preview without changes
  "skip_openlib_direct": false  // Skip OpenLibrary ID lookup
}
```

**Response**:
```json
{
  "works_processed": 100,
  "authors_linked": 142,
  "openlib_direct_hits": 3,
  "external_api_hits": 87,
  "failed": 10,
  "api_calls_used": {
    "openlib": 215,        // Direct + metadata calls
    "google_books": 45,
    "archive_org": 30,
    "wikidata": 12
  },
  "duration_ms": 312000,  // ~5 minutes for 100 works
  "dry_run": true,
  "errors": [
    {
      "isbn": "9798762979771",
      "work_key": "/works/isbndb-abc123",
      "error": "No authors found via any provider"
    }
  ]
}
```

---

## Testing (Required Before Production)

### Phase 1: Dry Run (5 works)
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/backfill-author-works' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"batch_size":5,"dry_run":true}' | jq
```

**Expected**:
- `works_processed: 5`
- `dry_run: true`
- `errors: []` (or minimal)

### Phase 2: Live Test (10 works)
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/backfill-author-works' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"batch_size":10,"dry_run":false}' | jq
```

**Validation**:
```sql
-- Check Harry Potter example (ISBN: 9780439064873)
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  e.isbn,
  e.title,
  aw.author_key,
  a.name
FROM enriched_editions e
JOIN author_works aw ON e.work_key = aw.work_key
JOIN enriched_authors a ON aw.author_key = a.author_key
WHERE e.isbn = '9780439064873';
\""

# Expected:
# isbn: 9780439064873
# title: "Harry Potter and the Chamber of Secrets"
# author_key: /authors/isbndb-xxxxx (or /authors/OL27695A if OpenLibrary direct)
# name: "J.K. Rowling" ✅
```

### Phase 3: Medium Batch (100 works)
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/backfill-author-works' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"batch_size":100,"dry_run":false}' | jq
```

**Monitor**:
- Success rate >80%
- API calls distributed across providers
- No rate limit errors

---

## Production Rollout

### Strategy: Gradual Batching

**Total Works**: 75,508
**Batch Size**: 100 works/run
**Rate**: 3 seconds/work = 5 minutes/batch
**Total Runs**: 756 runs
**Total Time**: ~63 hours (2.6 days continuous)

### Option 1: Daily Execution (RECOMMENDED)
```bash
# Run 10 batches/day (1,000 works)
# Complete in ~76 days
for i in {1..10}; do
  echo "Batch $i/10..."
  curl -X POST 'https://alexandria.ooheynerds.com/api/internal/backfill-author-works' \
    -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
    -H 'Content-Type: application/json' \
    -d '{"batch_size":100,"dry_run":false}' | jq '.works_processed, .authors_linked, .failed'

  # Wait 1 minute between batches
  sleep 60
done
```

**Benefits**:
- Spreads load across multiple days
- Easy to monitor and pause if issues
- Minimal impact on free API quotas

### Option 2: Accelerated Execution
```bash
# Run 50 batches/day (5,000 works)
# Complete in ~16 days
# Monitor OpenLibrary rate limits closely
```

### Option 3: Cron Automation
Add to Worker cron triggers (`wrangler.jsonc`):
```jsonc
{
  "crons": [
    "0 3 * * *"  // 3 AM UTC - Run 1,000 works/day
  ]
}
```

Update `worker/src/index.ts` to handle cron:
```typescript
// In scheduled() handler
if (cron === '0 3 * * *') {
  // Run 10 batches of 100 works each
  for (let i = 0; i < 10; i++) {
    await fetch('https://alexandria.ooheynerds.com/api/internal/backfill-author-works', {
      method: 'POST',
      headers: {
        'X-Cron-Secret': env.ALEXANDRIA_WEBHOOK_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch_size: 100, dry_run: false }),
    });

    // Wait 5 minutes between batches
    await new Promise(resolve => setTimeout(resolve, 300000));
  }
}
```

---

## Monitoring

### Check Progress
```sql
-- Count remaining works
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  COUNT(*) as total_missing_authors
FROM enriched_works ew
LEFT JOIN author_works aw ON ew.work_key = aw.work_key
WHERE ew.primary_provider = 'isbndb'
  AND aw.work_key IS NULL;
\""
```

### Check Success Rate
```sql
-- Compare before/after author coverage
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  COUNT(DISTINCT ew.work_key) as total_works,
  COUNT(DISTINCT aw.work_key) as works_with_authors,
  ROUND(100.0 * COUNT(DISTINCT aw.work_key) / COUNT(DISTINCT ew.work_key), 2) as coverage_pct
FROM enriched_works ew
LEFT JOIN author_works aw ON ew.work_key = aw.work_key
WHERE ew.primary_provider = 'isbndb';
\""
```

### Monitor API Usage
```bash
# Worker logs
npm run tail | grep -i "author backfill\|external api hit\|openlib direct"
```

---

## Expected Results

### Success Metrics
- **Resolution Rate**: 80-90% of works should find authors
- **OpenLibrary Direct**: ~1,670 works (2.2%)
- **External API**: ~60,000+ works (80%+ of total)
- **Failed**: ~10,000 works (13%) - No author data in any provider

### API Call Estimates
**Per 100 Works**:
- OpenLibrary: ~200-300 calls (direct + metadata)
- Google Books: ~30-50 calls (fallback)
- Archive.org: ~20-30 calls (fallback)
- Wikidata: ~10-20 calls (last resort)

**Total for 75,508 Works**:
- OpenLibrary: ~150,000-225,000 calls (distributed over 76 days = ~2,000-3,000/day)
- Well within free tier limits

### Cost
**$0** - All external APIs are free tier

---

## Troubleshooting

### Error: "No authors found via any provider"
**Cause**: Work genuinely lacks author data across all providers
**Action**: Acceptable - mark as authorless or manually investigate

### Error: Rate limit exceeded (OpenLibrary)
**Cause**: Too many requests in 5-minute window
**Action**: Increase sleep time between works (3s → 5s)

### Error: Timeout on Wikidata SPARQL
**Cause**: Wikidata queries can be slow
**Action**: Acceptable - orchestrator will try next provider

### High Failure Rate (>20%)
**Cause**: Provider API issues or data quality
**Action**: Pause backfill, investigate with dry_run=true

---

## Rollback

If backfill creates incorrect author mappings:

```sql
-- Delete author_works created during backfill window
DELETE FROM author_works
WHERE created_at > '2026-01-14'
  AND author_key LIKE '/authors/isbndb-%';

-- Also delete newly created authors if needed
DELETE FROM enriched_authors
WHERE created_at > '2026-01-14'
  AND author_key LIKE '/authors/isbndb-%'
  AND primary_provider = 'isbndb';
```

---

## Success Criteria

- [ ] 80%+ of 75,508 works have author mappings
- [ ] Harry Potter example (ISBN 9780439064873) returns authors array
- [ ] Search by author includes previously orphaned works
- [ ] Zero ISBNdb quota impact (all external APIs)
- [ ] Process is idempotent (safe to re-run)
- [ ] Author coverage: 95.35% → 98%+

---

## Files Modified

- **New Endpoint**: `worker/src/routes/backfill-author-works.ts`
- **Router Registration**: `worker/src/index.ts` (line 35, 156)
- **Deployment**: Version `a252ae55-a16e-43df-8201-605ff6e334e7`

---

**Last Updated**: January 14, 2026
**Issue**: #186
**Priority**: P2 - Medium
**Estimated Total Time**: 2.6 days continuous OR 76 days at 1,000 works/day
