# Alexandria Current Status & Open Issues

**Last Updated:** January 3, 2026

## 🎯 Priority Overview

### P1 - HIGH Priority (Blockers)
1. **#108** - Debug bulk author harvest failures (17.5% timeout rate)

### P2 - MEDIUM Priority
2. **#111** - Run top-1000 author tier harvest (blocked by #108)
3. **#110** - Set up Wikidata enrichment cron job

### P3 - LOW Priority (Future Enhancements)
5. **#114** - Author deduplication and normalization
6. **#113** - Wikipedia + LLM fallback for authors without Wikidata
7. **#112** - VIAF/ISNI → Wikidata crosswalk for author expansion

### Infrastructure & Documentation
8. **#100** - GitHub Actions for automated harvesting
9. **#99** - Harvesting runbook documentation
10. **#90** - Cross-repo contract testing (Alexandria ↔ bendv3)

---

## ✅ Recently Completed

### #109: ISBNdb Quota Tracking (COMPLETED - Jan 3, 2026)

**Fixed critical quota tracking bugs:**
1. POST /api/harvest/covers was making ISBNdb calls without quota tracking
2. Enrichment queue handler not recording API usage
3. GET /api/quota/status using wrong KV namespace (CACHE vs QUOTA_KV)

**Root Cause:**
- bendv3 hourly cron calls /api/harvest/covers (24 calls/day)
- These calls were untracked, causing quota discrepancy
- User observed 10K ISBNs processed but quota showed 0 used

**Resolution:**
- ✅ Added QuotaManager to /api/harvest/covers endpoint
- ✅ Fixed quota.ts KV namespace (CACHE → QUOTA_KV)
- ✅ Added quota recording to enrichment queue handler
- ✅ All 475 tests passing
- ✅ Quota now correctly shows 992 calls used today

**Documentation:** `docs/operations/ISBNDB-QUOTA-INVESTIGATION-JAN3.md`

---

## 📊 P1: Critical Issues

### #108: Debug Bulk Author Harvest Failures 🔴

**Status:** OPEN
**Priority:** P1 - HIGH
**Created:** Jan 1, 2026

**Problem:**
Latest bulk author harvest run (Dec 31) had concerning metrics:
- Authors processed: 957 (not top-100!)
- Books found: 72,314
- Covers queued: 432
- **Failed: 203 authors (17.5% failure rate)** ⚠️
- **Enriched count: 0** ⚠️
- Duration: ~5 hours

**Critical Questions:**
1. Why 0 enriched? Script found 72K books but `enriched: 0` in checkpoint
2. Are books in database? Need to verify data was written to `enriched_editions`
3. Timeout issues: 203/1,160 authors timed out - too aggressive threshold?
4. Tier confusion: Why 957 authors for "top-100" tier?

**Investigation Steps:**
```bash
# 1. Check database for Dec 31 enrichment
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \
  'SELECT COUNT(*), MAX(updated_at) FROM enriched_editions WHERE updated_at > \'2025-12-31\'::date;'"

# 2. Review checkpoint file
cat data/bulk-author-checkpoint.json | jq '.stats'

# 3. Check script logic
grep -A 10 'enriched' scripts/bulk-author-harvest.js

# 4. Test single author
node scripts/bulk-author-harvest.js --author "Stephen King" --dry-run
```

**Potential Fixes:**
- [ ] Increase timeout from 30s to 60s for large bibliographies
- [ ] Add transaction commit logging
- [ ] Fix tier selection logic (top-100 should be 100, not 957)
- [ ] Better checkpoint granularity (every 10 authors, not end-of-run)
- [ ] Add retry logic for timeout errors

**Blocks:** #111 (top-1000 harvest)

---

## 📈 P2: Medium Priority

### #111: Run Top-1000 Author Tier Harvest

**Status:** OPEN (blocked by #108)
**Priority:** P2 - MEDIUM
**Created:** Jan 1, 2026

**Goal:** Harvest bibliographies for top 1,000 authors by edition count

**Scope:**
- Authors: 1,000 (ranked by edition count)
- Expected books: ~100,000 (100 books/author avg)
- Expected covers: ~50,000 (50% have cover URLs)
- ISBNdb quota: ~1,000-2,000 API calls

**Execution:**
```bash
# 1. Check ISBNdb quota
curl https://alexandria.ooheynerds.com/api/quota/status | jq

# 2. Run harvest
node scripts/bulk-author-harvest.js --tier top-1000

# 3. Monitor progress
watch -n 30 'cat data/bulk-author-checkpoint.json | jq ".stats"'
```

**Expected Timeline:**
- Author processing: ~2-3 hours
- Cover processing: ~45-60 minutes (with optimizations)
- Total: ~4 hours end-to-end

**Success Criteria:**
- [ ] 1,000 authors processed (>95% success rate)
- [ ] ~100,000 books enriched
- [ ] ~50,000 covers processed
- [ ] <5% timeout/failure rate

---

### #110: Set Up Wikidata Enrichment Cron Job

**Status:** OPEN
**Priority:** P2 - MEDIUM
**Created:** Jan 1, 2026

**Goal:** Automate daily Wikidata enrichment for authors with wikidata_id

**Implementation:**
```jsonc
// wrangler.jsonc addition
{
  "triggers": {
    "crons": ["0 3 * * *"]  // 3 AM UTC daily
  }
}
```

**Rate Limits:**
- Wikidata SPARQL: 1 request/second
- Batch size: 50 Q-IDs per SPARQL query
- Daily target: 1,000 authors/day = ~174 days for all 174K authors

**Success Criteria:**
- [ ] Cron job runs daily at 3 AM UTC
- [ ] 1,000 authors enriched per day
- [ ] No Wikidata rate limit violations (429 errors)
- [ ] Analytics tracking enrichment success/failure rates

**Related Files:**
- `docs/AUTHOR-DIVERSITY-ENRICHMENT-PLAN.md`
- `worker/src/routes/authors.ts`
- `worker/services/wikidata-client.ts`

---

## 🔧 Code TODOs

### Author Service: Occupations Column

**File:** `worker/src/services/author-service.ts:460`

```typescript
// TODO: Add occupations to UPDATE query when enriched_authors table has the column
```

**Context:** The `enriched_authors` table needs an `occupations` column added to support Wikidata occupation data.

**Action Needed:**
1. Create migration to add `occupations JSONB` column
2. Update `author-service.ts` UPDATE query to include occupations
3. Update Wikidata enrichment to populate occupations field

---

## 📋 TODO.md Status

### Phase 3: Performance & Search Optimization
- [x] Fix ILIKE performance (resolved - ILIKE works well)
- [x] Run ANALYZE on enriched tables
- [x] Add missing GIN trigram indexes
- [x] Switch search to enriched tables
- [x] Query result caching (KV)
- [x] Enhanced CDN caching headers
- [x] Optimized combined search endpoint
- [ ] Add KV caching for combined search endpoint
- [ ] Verify bendv3 integration

### Phase 4: Author Enrichment Expansion
- [x] Efficient `/api/authors/enrich-bibliography` endpoint
- [x] Scripts: `expand-author-bibliographies.js`, `e2e-author-enrichment-test.js`
- [ ] Run large-scale author expansion (blocked by #108)
- [ ] Verify cover queue processing (blocked by #109)
- [ ] Monitor enriched table growth
- [ ] Add author deduplication (#114)
- [ ] GitHub #82: Durable Object buffer (optional optimization)

### Phase 5: Advanced Features
- [ ] Combined search (`/api/search?q={query}`)
- [ ] Pagination support for search results
- [ ] Export results (CSV, JSON)
- [ ] Search analytics tracking
- [ ] Semantic search with embeddings

### Phase 6: Operations
- [ ] CI/CD pipeline (GitHub Actions) - #100
- [ ] Error monitoring/alerting
- [ ] Performance benchmarks
- [ ] Disaster recovery plan

---

## 🎯 Recommended Next Actions

### Immediate (This Week)

1. **Validate Queue Optimization (#109)**
   - Run `npm run tail` and monitor for 30 minutes
   - Check CPU time, batch success rate, throughput
   - Document results in issue

2. **Debug Harvest Failures (#108)**
   - Query database for Dec 31 enrichment count
   - Review checkpoint file and script logic
   - Test single author dry-run
   - Fix timeout threshold and tier logic

### Short-term (Next Week)

3. **Run Top-1000 Harvest (#111)**
   - After #108 is fixed
   - Monitor quota before starting
   - Use checkpoint/resume capability

4. **Set Up Wikidata Cron (#110)**
   - Add cron trigger to wrangler.jsonc
   - Implement scheduled handler
   - Deploy and verify daily runs

### Long-term (Next Month)

5. **Author Deduplication (#114)**
6. **GitHub Actions Automation (#100)**
7. **Cross-repo Contract Testing (#90)**

---

## 📊 Quick Status Check Commands

```bash
# Check ISBNdb quota
curl https://alexandria.ooheynerds.com/api/quota/status | jq

# Monitor Worker logs
npm run tail | grep -i "cover|enrich|quota"

# Check queue status
npx wrangler queues list | grep alexandria

# Database stats
curl https://alexandria.ooheynerds.com/api/stats | jq

# Check checkpoint
cat data/bulk-author-checkpoint.json | jq '.stats'
```

---

**Next Review:** After #108 and #109 are resolved
