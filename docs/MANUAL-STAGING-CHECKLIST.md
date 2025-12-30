# Manual Staging Checklist

This checklist verifies critical Alexandria functionality on staging/production before major deployments. Run this weekly or after significant changes to catch issues that automated tests might miss.

## Prerequisites

- [ ] Staging URL accessible: `https://alexandria.ooheynerds.com`
- [ ] Have `curl`, `jq` installed (or use a REST client like Postman/Insomnia)
- [ ] Check current quota: `curl https://alexandria.ooheynerds.com/api/quota/status | jq`

## Quick Validation (5 minutes)

### 1. Health & Infrastructure

```bash
# Health check
curl https://alexandria.ooheynerds.com/health | jq
# Expected: {"status": "healthy", "timestamp": "...", "database": "connected"}

# Database statistics
curl https://alexandria.ooheynerds.com/api/stats | jq
# Expected: 54M+ editions, 40M+ works, 14M+ authors

# Quota status
curl https://alexandria.ooheynerds.com/api/quota/status | jq
# Expected: used_today < 15000, can_make_calls: true
```

**Pass Criteria:**
- [ ] Health endpoint returns 200
- [ ] Database latency < 100ms
- [ ] Edition count > 54,000,000
- [ ] Quota system responding

### 2. Search API (Core Functionality)

```bash
# ISBN search (exact match)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9780439064873' | jq
# Expected: Harry Potter and the Chamber of Secrets

# Title search (fuzzy)
curl 'https://alexandria.ooheynerds.com/api/search?title=harry%20potter&limit=5' | jq
# Expected: Array of Harry Potter books

# Author search
curl 'https://alexandria.ooheynerds.com/api/search?author=rowling&limit=5' | jq
# Expected: Books by J.K. Rowling
```

**Pass Criteria:**
- [ ] ISBN search returns correct book
- [ ] Title search returns relevant results
- [ ] Author search returns author's books
- [ ] All response times < 500ms

### 3. Cover Processing

```bash
# Check cover status (should exist from previous enrichment)
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/status' | jq
# Expected: {"exists": true, "sizes": ["large", "medium", "small"]}

# Fetch cover image (verify it loads)
curl -I 'https://alexandria.ooheynerds.com/covers/9780439064873/large'
# Expected: 200 OK, Content-Type: image/webp

# Trigger cover processing for new ISBN
curl -X POST 'https://alexandria.ooheynerds.com/covers/9781492666868/process'
# Expected: {"success": true, "queued": true} OR {"success": true, "processed": true}
```

**Pass Criteria:**
- [ ] Cover status endpoint responds
- [ ] Cover images load successfully
- [ ] Cover processing trigger works
- [ ] WebP images served with correct headers

## Deep Validation (15 minutes)

### 4. Smart Resolution (ISBN Enrichment Chain)

```bash
# Search for ISBN NOT in OpenLibrary (should trigger Smart Resolution)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9781492666868' | jq
# Expected: Book metadata from ISBNdb → enriched in Alexandria
# Provider chain: ISBNdb → Google Books → OpenLibrary

# Verify enrichment happened
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9781492666868' | jq '.data.results[0].primary_provider'
# Expected: "isbndb" or "google_books"
```

**Pass Criteria:**
- [ ] Unknown ISBN triggers enrichment
- [ ] Metadata returned from external provider
- [ ] Data stored in `enriched_editions` table
- [ ] Cover URL queued for processing

### 5. Batch Enrichment

```bash
# Batch direct enrichment (10 ISBNs)
curl -X POST 'https://alexandria.ooheynerds.com/api/enrich/batch-direct' \
  -H 'Content-Type: application/json' \
  -d '{
    "isbns": [
      "9780439064873",
      "9781492666868",
      "9780134685991",
      "9781491950296",
      "9781449355739",
      "9780135957059",
      "9781617294136",
      "9781449373320",
      "9781491954249",
      "9780321573513"
    ],
    "source": "manual_test"
  }' | jq
# Expected: {"success": true, "enriched": N, "cached": M, "covers_queued": X}
```

**Pass Criteria:**
- [ ] Batch enrichment completes successfully
- [ ] Enriched count + cached count = total ISBNs
- [ ] Covers queued for background processing
- [ ] Quota incremented correctly

### 6. Queue Processing Verification

```bash
# Queue 100 ISBNs for background enrichment
curl -X POST 'https://alexandria.ooheynerds.com/api/enrich/queue' \
  -H 'Content-Type: application/json' \
  -d '{
    "isbns": ["9780439064873", "9781492666868", ...],
    "source": "queue_test"
  }' | jq
# Expected: {"success": true, "queued": 100}

# Wait 30-60 seconds for queue processing
sleep 60

# Verify enrichment completed (check one ISBN)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9780439064873' | jq
# Expected: Enriched metadata present
```

**Pass Criteria:**
- [ ] Queue accepts batch (max 100)
- [ ] Messages processed within 60 seconds
- [ ] Enriched data appears in database
- [ ] Failed messages go to DLQ (if any)

### 7. Author Bibliography Enrichment

```bash
# Enrich author bibliography from ISBNdb
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/enrich-bibliography' \
  -H 'Content-Type: application/json' \
  -d '{
    "author_name": "Brandon Sanderson",
    "max_books": 20
  }' | jq
# Expected: {"success": true, "books_found": N, "enriched": M, "covers_queued": X}

# Verify author's books are enriched
curl 'https://alexandria.ooheynerds.com/api/search?author=brandon%20sanderson&limit=10' | jq
# Expected: Array of Brandon Sanderson books with ISBNdb metadata
```

**Pass Criteria:**
- [ ] Bibliography enrichment completes
- [ ] Books appear in search results
- [ ] Cover URLs queued for processing
- [ ] Quota usage tracked

### 8. New Releases Harvesting

```bash
# Enrich new releases for a recent month
curl -X POST 'https://alexandria.ooheynerds.com/api/books/enrich-new-releases' \
  -H 'Content-Type: application/json' \
  -d '{
    "start_month": "2025-12",
    "end_month": "2025-12",
    "max_pages_per_month": 5,
    "skip_existing": true
  }' | jq
# Expected: {"success": true, "newly_enriched": N, "covers_queued": M, "api_calls": X}
```

**Pass Criteria:**
- [ ] New releases enrichment completes
- [ ] Books added to database
- [ ] Quota not exceeded
- [ ] Processing time reasonable (<60s)

### 9. Cover Queue Processing (Background)

```bash
# Queue cover processing for 10 ISBNs
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/queue' \
  -H 'Content-Type: application/json' \
  -d '{
    "items": [
      {"isbn": "9780439064873", "provider_url": "https://covers.openlibrary.org/b/isbn/9780439064873-L.jpg"},
      {"isbn": "9781492666868", "provider_url": "https://images.isbndb.com/covers/68/68/9781492666868.jpg"},
      ...
    ]
  }' | jq
# Expected: {"success": true, "queued": 10}

# Wait 2-3 minutes for queue processing (max_batch_size: 10, max_batch_timeout: 10s)
sleep 180

# Verify covers processed
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/status' | jq
# Expected: {"exists": true, "sizes": ["large", "medium", "small"]}

# Check cover images
curl -I 'https://alexandria.ooheynerds.com/covers/9780439064873/large'
curl -I 'https://alexandria.ooheynerds.com/covers/9780439064873/medium'
curl -I 'https://alexandria.ooheynerds.com/covers/9780439064873/small'
# Expected: All return 200 OK, Content-Type: image/webp
```

**Pass Criteria:**
- [ ] Cover queue accepts batch (max 100)
- [ ] Processing completes within 3 minutes
- [ ] All 3 sizes (large, medium, small) available
- [ ] WebP compression applied
- [ ] R2 URLs updated in `enriched_editions`

### 10. Quota Management

```bash
# Check quota before operation
curl 'https://alexandria.ooheynerds.com/api/quota/status' | jq
# Note: used_today value

# Perform batch enrichment (consumes 1 API call for 100 ISBNs)
curl -X POST 'https://alexandria.ooheynerds.com/api/enrich/batch-direct' \
  -H 'Content-Type: application/json' \
  -d '{"isbns": [...100 ISBNs...], "source": "quota_test"}' | jq

# Check quota after operation
curl 'https://alexandria.ooheynerds.com/api/quota/status' | jq
# Expected: used_today increased by 1
```

**Pass Criteria:**
- [ ] Quota tracking accurate
- [ ] Batch operations count as 1 API call
- [ ] Quota prevents operations when exhausted
- [ ] Quota resets at midnight UTC

## Error Scenarios (5 minutes)

### 11. Error Handling

```bash
# Invalid ISBN format
curl 'https://alexandria.ooheynerds.com/api/search?isbn=invalid' | jq
# Expected: 400/422, {"success": false, "error": "..."}

# ISBN not found in any provider
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9999999999999' | jq
# Expected: 404, {"success": false, "error": "ISBN not found"}

# Batch with invalid ISBNs
curl -X POST 'https://alexandria.ooheynerds.com/api/enrich/batch-direct' \
  -H 'Content-Type: application/json' \
  -d '{"isbns": ["invalid1", "invalid2"], "source": "error_test"}' | jq
# Expected: {"success": true, "failed": 2, "errors": [...]}

# Quota exhausted (if quota is low)
# (Skip if quota > 1000 remaining)
curl 'https://alexandria.ooheynerds.com/api/quota/status' | jq '.data.remaining'
# If < 100, test quota exhaustion:
curl -X POST 'https://alexandria.ooheynerds.com/api/enrich/batch-direct' \
  -H 'Content-Type: application/json' \
  -d '{"isbns": [...large batch...], "source": "quota_test"}' | jq
# Expected: 429, {"success": false, "error": "Quota exhausted"}
```

**Pass Criteria:**
- [ ] Invalid ISBNs return 400/422
- [ ] Not found returns 404
- [ ] Quota exhaustion returns 429
- [ ] Error messages are clear and actionable

## Performance Baselines

Record these metrics for trend analysis:

| Endpoint | Target | Actual | Pass/Fail |
|----------|--------|--------|-----------|
| GET /health | < 100ms | ___ms | ☐ |
| GET /api/stats | < 200ms | ___ms | ☐ |
| GET /api/search?isbn=... | < 100ms | ___ms | ☐ |
| GET /api/search?title=... | < 500ms | ___ms | ☐ |
| POST /api/enrich/batch-direct (10 ISBNs) | < 5s | ___s | ☐ |
| POST /api/covers/process | < 3s | ___s | ☐ |

## Known Issues & Workarounds

### Issue: ISBNdb JWT Expiry
- **Symptom**: Cover processing fails with 401/403 after 2 hours
- **Workaround**: Queue handler auto-retries with fresh URL from ISBNdb
- **Verification**: Check queue handler logs for "JWT expired, re-fetching"

### Issue: Queue Processing Delay
- **Symptom**: Queued items take >5 minutes to process
- **Expected**: Cover queue: 10s batches, Enrichment queue: 60s batches
- **Workaround**: Check queue status with `npx wrangler queues list | grep alexandria`

### Issue: Mock Drift (Unit Tests Pass, Staging Fails)
- **Symptom**: Tests pass but staging API returns different data
- **Root Cause**: Mocks don't match real ISBNdb/Google Books responses
- **Mitigation**: Run manual staging validation weekly to catch drift

## Sign-Off

- **Date**: ___________
- **Tester**: ___________
- **Deployment Version**: ___________
- **All Critical Tests Passed**: ☐ Yes ☐ No
- **Blockers Found**: ___________
- **Notes**: ___________

---

## Automation Notes

This checklist is **intentionally manual** for now. Future Phase 4 work may automate some tests with Playwright, but manual validation remains valuable for:

1. **Visual verification** (images load correctly, UI renders properly)
2. **Cross-provider validation** (ISBNdb → Google Books → OpenLibrary chain)
3. **Performance regression detection** (human intuition for "feels slow")
4. **Mock drift detection** (unit tests pass but real APIs changed)

**Recommended Cadence**:
- **Weekly**: Quick Validation (5 min)
- **Before Major Deployments**: Full Checklist (25 min)
- **After External API Changes**: Deep Validation + Error Scenarios (20 min)
