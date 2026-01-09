# Free API Usage Review

**Date**: 2026-01-09
**Purpose**: Ensure responsible usage of Google Books and OpenLibrary APIs

## Current Usage Analysis

### Google Books API

**Call Sites**:
1. `services/cover-fetcher.ts` - `fetchGoogleBooksCover()` (line 265)
   - Called by: Cover queue (NEW priority: first attempt)
   - Purpose: Fetch cover image URLs
   - Max retries: 2

2. `services/external-apis.ts` - `fetchFromGoogleBooks()` (line 319)
   - Called by: `resolveExternalISBN()` fallback chain
   - Purpose: Fetch full book metadata
   - No retries

**Usage Pattern**:
- **MAJOR INCREASE EXPECTED**: Now first priority in cover queue (was third)
- Previously: ~100-500 calls/day (fallback only)
- After fix: ~3,000+ calls/day (primary cover source)
- API key: Configured (increases quota)

**Rate Limits** (Google Cloud Console):
- **Free tier (no key)**: 1,000 requests/day
- **With API key (our config)**: 2,000-10,000 requests/day (project-specific)
- **Burst limit**: ~10 queries per second

**✅ LIKELY OK**: API key configured, should handle 2,000-3,000/day

---

### OpenLibrary API

**Call Sites**:
1. `services/cover-fetcher.ts` - `fetchOpenLibraryCover()` (line 342)
   - Called by: Cover queue (second priority)
   - Purpose: Fetch cover image URLs via HEAD request
   - Max retries: 2
   - Method: HEAD (lightweight)

2. `services/external-apis.ts` - `fetchFromOpenLibrary()` (line 383)
   - Called by: `resolveExternalISBN()` fallback chain
   - Purpose: Fetch full book metadata
   - No retries

**Usage Pattern**:
- **MODERATE INCREASE EXPECTED**: Second priority in cover queue
- Previously: ~50-200 calls/day (fallback only)
- After fix: ~500-1,000 calls/day (when Google fails)
- User-Agent: Alexandria/2.0 (nerd@ooheynerds.com) ✅

**Rate Limits** (from OpenLibrary guidelines):
- **Guideline**: ~100 requests/minute (6,000/hour)
- **Best practice**: Include User-Agent with contact info ✅
- **Covers API**: CDN-backed, very tolerant
- **Books API**: More restrictive

**✅ LOW CONCERN**: Well within guidelines, using HEAD requests for covers

---

## Risk Assessment

### Google Books API - MEDIUM RISK ⚠️

**Current State**: API key configured (increases quota)
- Expected usage: 1,800-3,000 calls/day (primary cover source)
- Quota with key: 2,000-10,000/day (project-specific)
- **Assessment**: Should be OK if quota ≥2,000/day

**Symptoms to watch for**:
- HTTP 429 (Too Many Requests)
- HTTP 403 (Quota exceeded)
- Sudden drop in Google Books cover hits

**Mitigation if needed**:
1. **Check actual quota** in Google Cloud Console → APIs → Books API → Quotas
2. **Request increase** if <3,000/day
3. **Add rate limiting** (similar to ISBNdb) if quota tight
4. **Monitor first 48 hours** to establish baseline

---

### OpenLibrary API - LOW RISK ✅

**Current state**: Using responsibly
- Expected usage: 500-1,000 calls/day
- Guideline: 6,000/hour (144,000/day)
- **Headroom**: 99%+ margin

**Good practices already in place**:
- User-Agent with contact info
- HEAD requests for covers (CDN cached)
- No aggressive retry loops
- Respects API guidelines

---

## Call Volume Projections

### Cover Queue (Primary Driver)

**Scenario**: 3,000 covers processed per day

| Provider | Priority | Success Rate | Calls |
|----------|----------|--------------|-------|
| Google Books | 1st | ~60% | **1,800** |
| OpenLibrary | 2nd | ~30% | **900** |
| ISBNdb | 3rd | ~10% | **300** |
| Placeholder | - | 0% | 0 |

**Total**: 3,000 attempts → 1,800 Google + 900 OpenLibrary + 300 ISBNdb

### Metadata Enrichment (External APIs)

**Scenario**: 100 enrichments per day via `resolveExternalISBN()`

| Provider | Priority | Success Rate | Calls |
|----------|----------|--------------|-------|
| ISBNdb | 1st | ~70% | **70** (quota protected) |
| Google Books | 2nd | ~20% | **20** |
| OpenLibrary | 3rd | ~10% | **10** |

**Total**: ~100 calls across providers

---

## Recommendations

### Immediate Actions

1. **Verify Google Books quota** in Cloud Console
   - Check current quota: https://console.cloud.google.com/apis/api/books.googleapis.com/quotas
   - Confirm if ≥2,000/day or higher
   - If <2,000, request increase now

2. **Monitor first 48 hours** via Analytics Engine
   - Track 429/403 responses
   - Measure actual usage vs. quota
   - Watch cover queue success rates

3. **Add rate limiting IF needed** (if quota <3,000/day)
   - Similar to ISBNdb pattern
   - Track daily usage in KV
   - Fail gracefully → fallback to OpenLibrary

### Optional Enhancements

4. **Respect-Based Throttling**
   - Add 100ms delay between Google Books calls
   - Helps avoid burst limits
   - Shows good citizenship

5. **Cache Cover URLs Longer**
   - Current: Cache in R2 after download
   - Enhancement: Cache provider URLs in KV (7 days)
   - Reduces duplicate API calls

6. **Provider Health Checks**
   - Track success rates per provider
   - Auto-reorder if provider degraded
   - Example: If Google 429 rate >10%, demote priority

---

## Code Locations for Rate Limiting

If we need to add Google Books rate limiting:

```typescript
// services/cover-fetcher.ts - fetchGoogleBooksCover()
// Add similar quota check as ISBNdb:

const { QuotaManager } = await import('../src/services/quota-manager.js');
const { Logger } = await import('../lib/logger.js');

const logger = new Logger(env, { service: 'cover-fetcher' });
const quotaManager = new QuotaManager(env.GOOGLE_BOOKS_KV, logger); // New KV namespace

const quota = await quotaManager.checkQuota(1, true);
if (!quota.allowed) {
  console.warn('[GoogleBooks] Daily quota exhausted. Skipping ${normalizedISBN}');
  return null; // Graceful degradation: try OpenLibrary next
}
```

**Required**:
- New KV namespace: `GOOGLE_BOOKS_KV`
- New QuotaManager instance with 10,000/day limit
- Similar pattern to ISBNdb implementation

---

## Monitoring Checklist

- [ ] Check Google Cloud Console quota usage daily (first week)
- [ ] Monitor Analytics Engine for 429/403 responses
- [ ] Track cover queue success rates by provider
- [ ] Watch for sudden drops in Google Books hits
- [ ] Review OpenLibrary usage (should remain <1,000/day)

---

## Summary

**Google Books**: ⚠️ **MEDIUM RISK** - Should be OK with API key (2K+ quota)
**OpenLibrary**: ✅ **LOW RISK** - Well within guidelines

**Action Required**: Verify Google Books quota in Cloud Console, monitor usage

**Next Steps**:
1. Request Google Books quota increase (recommended)
2. Monitor for 24-48 hours
3. Implement rate limiting if quota not approved
4. Consider caching enhancements to reduce overall API usage
