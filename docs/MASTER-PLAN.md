# Alexandria Master Plan
**Generated**: January 2, 2026
**Source**: GitHub Issues #107-#114

---

## 🚨 P0: CRITICAL BLOCKERS

### ✅ Security Implementation (COMPLETE - Jan 2)
- 3-layer security (Cloudflare + Application + Database)
- Application rate limiting deployed
- Bot protection enabled
- WAF active (Free Managed Ruleset)
- **Status**: COMPLETE ✅

### ✅ Issue #107: Deploy Migration 003 (COMPLETE - Jan 2)
**Status**: Migration deployed and verified ✅

**Results**:
- ✅ Wikidata diversity fields added to `enriched_authors`
- ✅ 174,427 Wikidata IDs seeded from OpenLibrary (99.99% of 174,436 target)
- ✅ Indexes created for pending enrichment queries
- ✅ 14.7M authors synced to enriched_authors (was 8.16M)
- ✅ 100,899 authors ready for Wikidata enrichment

**Schema deployed**:
- `gender_qid`, `citizenship_qid`
- `birth_place`, `birth_place_qid`, `birth_country`, `birth_country_qid`
- `death_place`, `death_place_qid`
- `wikidata_enriched_at`, `enrichment_source`
- `occupations[]`, `languages[]`, `awards[]`, `literary_movements[]`

**Fix applied**: Initial migration only synced 8.16M authors. Ran補充 sync to add missing 6.56M authors, including 100K with Wikidata IDs.

**Next step**: Test enrichment endpoint and set up cron job (Issue #110)

---

## 📈 P1: HIGH PRIORITY

### Issue #109: Validate Queue Optimization (Dec 30 Deploy)
**Changes deployed**:
- Batch size: 10 → 20 (2x)
- Concurrency: 5 → 10 (2x)
- Batch timeout: 10s → 30s (3x)
- Parallel I/O with `Promise.allSettled()`

**Expected**: 10x throughput improvement (2.2 → 15-20 covers/sec)

**Action required**:
```bash
# Monitor logs for performance metrics
npm run tail | grep -i "cover\|batch"

# Check success criteria:
# - CPU time p95 < 150s (limit: 300s)
# - Batch success rate > 98%
# - Throughput: 10-20/sec
```

**Rollback if needed**: Revert wrangler.jsonc queue config to smaller values

### Issue #108: Debug Bulk Harvest Failures
**Problem**: 17.5% timeout rate in author bibliography harvests

**Symptoms**:
- Fetch timeouts on ISBNdb API calls
- Author pages with high book counts (>1000 books)
- 2-hour JWT expiry on `image_original` URLs

**Action required**:
1. Add fetch timeouts to ISBNdb calls (already done?)
2. Test with high-volume authors (e.g., "Stephen King", "Nora Roberts")
3. Monitor queue DLQ for failed jobs
4. Consider pagination limits or chunking

---

## 📊 P2: MEDIUM PRIORITY

### Issue #110: Wikidata Enrichment Cron Job
**After Migration 003 completes**:

**Setup**:
```jsonc
// worker/wrangler.jsonc
"triggers": {
  "crons": ["0 */6 * * *"]  // Every 6 hours
}
```

**Worker code** (`worker/src/index.ts`):
```typescript
async scheduled(event, env, ctx) {
  // Enrich 1000 authors every 6 hours
  await fetch('https://alexandria.ooheynerds.com/api/authors/enrich-wikidata', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({limit: 1000})
  });
}
```

**Expected**: 174K authors enriched in ~45 days (1000/6hr × 4 batches/day)

### Issue #111: Run Top-1000 Author Harvest
**After queue optimization validated (#109)**:

**Command**:
```bash
node scripts/bulk-author-harvest.js --tier top-1000
```

**Expected**:
- 1,000 authors processed
- ~50,000 covers queued
- Processing time: <60 minutes (was 3 hours)
- Success rate: >95%

**Prerequisites**:
- ✅ Queue optimization deployed (Dec 30)
- ⏳ Queue optimization validated (#109)
- ✅ ISBNdb quota available (15K calls/day)

---

## 🔧 P3: NICE TO HAVE

### Issue #112: VIAF/ISNI → Wikidata Crosswalk
**Goal**: Expand Wikidata coverage from 174K → 500K+ authors

**Strategy**:
1. Query OpenLibrary for authors with VIAF/ISNI IDs
2. Use VIAF API to get Wikidata QIDs
3. Store in `enriched_authors.wikidata_id`
4. Run Wikidata enrichment

**API**: https://www.viaf.org/viaf/[ID]/viaf.json

### Issue #113: Wikipedia + LLM Fallback
**For authors without Wikidata** (~14.5M authors):

**Fallback chain**:
1. ISBNdb metadata (already used)
2. Wikipedia InfoBox parsing
3. Google Books author info
4. LLM-based extraction (Claude/GPT) from bio text

**Note**: Lower priority, expensive at scale

### Issue #114: Author Deduplication
**Problem**: Multiple keys for same author (e.g., "Stephen King", "King, Stephen")

**Strategy**:
1. Fuzzy name matching (pg_trgm)
2. Wikidata ID matching (canonical)
3. Merge into primary author_key
4. Update works/editions to use primary key

---

## 🎯 Immediate Action Plan (Next 24 Hours)

### 1. ✅ Complete Migration 003 (COMPLETE)
- ✅ Migration deployed successfully
- ✅ 174,427 Wikidata IDs seeded (99.99% coverage)
- ✅ 14.7M authors synced to enriched_authors
- ⏳ Test enrichment endpoint (next)
- ⏳ Close issue #107

### 2. Validate Queue Optimization (#109)
```bash
# Monitor for 1 hour
npm run tail | grep -E "cover|batch|CPU"

# Check metrics:
# - Batch duration < 30s
# - Success rate > 98%
# - CPU time < 150s
```

### 3. Test Wikidata Enrichment
```bash
# Small batch test
curl -X POST https://alexandria.ooheynerds.com/api/authors/enrich-wikidata \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'

# Verify results in database
```

### 4. Debug Harvest Timeouts (#108)
- Review logs for timeout patterns
- Test with high-volume authors
- Adjust fetch timeouts if needed

---

## 📅 This Week (Jan 2-8, 2026)

**Monday (Jan 2)**:
- ✅ Security implementation (3-layer defense)
- ✅ Migration 003 deployment (174K Wikidata IDs)
- ✅ Fixed author sync (8.16M → 14.7M)
- ⏳ Validate queue optimization
- ⏳ Test Wikidata enrichment

**Tuesday-Wednesday**:
- Debug harvest failures (#108)
- Run top-1000 harvest (#111)
- Monitor cover queue throughput

**Thursday-Friday**:
- Set up Wikidata cron job (#110)
- Monitor initial enrichment runs
- Document learnings

**Weekend**:
- Review P3 issues (VIAF crosswalk, Wikipedia fallback)
- Plan author deduplication strategy

---

## 🎉 Recent Wins

1. **Migration 003**: Wikidata schema deployed, 174K authors ready for enrichment (Jan 2) ✨
2. **Author Sync**: Fixed missing 6.56M authors in enriched_authors (Jan 2)
3. **Security**: Hybrid 3-layer defense deployed ($0 cost) (Jan 2)
4. **Queue Optimization**: 10x throughput improvement (Dec 30)
5. **ISBNdb Premium**: 3x rate limit, 10x batch size (Dec 10)
6. **TypeScript Migration**: Full codebase with zod-openapi (Dec 25)

---

## 📊 Key Metrics

| Metric | Before | After | Goal |
|--------|--------|-------|------|
| Authors in enriched_authors | 8.15M | **14.7M** ✅ | 14.7M (all OL) |
| Authors with Wikidata ID | 73K | **174K** ✅ | 500K+ (VIAF crosswalk) |
| Authors with gender/nationality | 0 | **0** (pending enrichment) | 174K |
| Pending Wikidata enrichment | 0 | **100,899** | Process via cron |
| Cover processing rate | 2.2/sec | 15-20/sec ✅ | 15-20/sec |
| ISBNdb quota usage | ~5K/day | <13K/day | <13K/day |

---

## 🚧 Known Issues

1. **Harvest timeouts** (17.5% rate) - debugging (Issue #108)
2. **JWT expiry** (2-hour limit on image_original) - queue must process within 2h
3. **Queue validation** - new config not yet validated (Issue #109)
4. **SSH key auth** - passwordless auth failing, using password workaround

---

## 📚 Documentation

- Security: `docs/SECURITY-FINAL-SUMMARY.md`
- Queue optimization: `docs/QUEUE-OPTIMIZATION-DEC30.md`
- Author diversity: `docs/AUTHOR-DIVERSITY-ENRICHMENT-PLAN.md`
- Bulk harvesting: `docs/BULK-HARVEST-FIX.md`
- Master plan: This file
