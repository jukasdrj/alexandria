# ISBNdb Quota Investigation - January 3, 2026

## Issue Report

**Reported**: User observed 10,000 ISBNdb API calls consumed today
**Quota System**: Showed 0 calls used (discrepancy)
**Investigation**: Identified quota tracking bug and usage source

---

## Root Cause: Untracked API Calls

### Quota Tracking Bug

**Location**: `worker/src/routes/enrich.ts:687-800` (POST /api/harvest/covers)

**Problem**: The `/api/harvest/covers` endpoint makes ISBNdb batch calls but **does NOT record them in quota manager**.

```typescript
// Line 733 - Makes ISBNdb API call
const batchData = await fetchISBNdbBatch(isbns, c.env);

// Missing: await quotaManager.recordApiCall(1);
```

**Impact**:
- ISBNdb calls are made but not tracked
- Quota KV shows 0 used (actual usage unknown)
- No quota enforcement for this endpoint
- Risk of exceeding 15K daily limit without warning

### Actual Usage Source

**bendv3 Hourly Cron Job** (confirmed running):

```typescript
// bendv3/src/index.ts:80-86
case '0 * * * *': // Every hour at :00
  console.log('[Cron] Running hourly cache warming job')
  await handleScheduledCacheWarming(env, ctx)

  console.log('[Cron] Running hourly cover harvest')
  await handleScheduledHarvest(env)  // ← Calls Alexandria /api/harvest/covers
  break
```

**Flow**:
1. bendv3 cron runs hourly (24 times/day)
2. Calls Alexandria `POST /api/harvest/covers` with `batch_size: 1000`
3. Alexandria calls ISBNdb batch endpoint (1 API call per request)
4. Processes 1000 ISBNs per hour = 24,000 ISBNs/day
5. **Uses 24 API calls/day** (well within 15K quota)

**Today's usage**: ~10 hours × 1 call/hour = **10 API calls**

---

## Other Untracked Endpoints

### Critical Missing Quota Tracking

Grepped for all `fetchISBNdbBatch` calls - found these endpoints **also not tracking quota**:

1. **POST /api/harvest/covers** (enrich.ts:733)
   - Used by bendv3 hourly cron
   - **HIGH PRIORITY FIX**

2. **Scheduled cover harvest** (harvest.ts:150)
   - Standalone cron function
   - Currently NOT configured (no triggers in wrangler.jsonc)
   - Would run every 5 minutes if enabled
   - **Records quota** (line 153: `await quotaManager.recordApiCall(1)`)
   - ✅ **Already fixed**

3. **Enrichment queue handler** (queue-handlers.ts:380)
   - Processes enrichment queue messages
   - **NOT tracking quota**
   - **MEDIUM PRIORITY FIX**

---

## Endpoints WITH Correct Quota Tracking

These endpoints properly use quota manager:

1. ✅ **POST /api/enrich/batch-direct** (enrich.ts)
   - Uses `withQuotaGuard()` wrapper
   - Checks quota before API call
   - Records usage after success

2. ✅ **POST /api/authors/enrich-bibliography** (authors.ts)
   - Uses `quotaManager.checkQuota()` before call
   - Records with `quotaManager.recordApiCall()`

3. ✅ **POST /api/books/enrich-new-releases** (books.ts)
   - Checks quota before batch
   - Records each API call

4. ✅ **Scheduled cover harvest handler** (harvest.ts:handleScheduledCoverHarvest)
   - Checks quota with `shouldAllowOperation('cron', 1)`
   - Records with `recordApiCall(1)`

---

## Required Fixes

### HIGH PRIORITY: Fix /api/harvest/covers

**File**: `worker/src/routes/enrich.ts:687-800`

**Add quota tracking**:
```typescript
// After line 693
const quotaManager = new QuotaManager(c.env.QUOTA_KV);

// Before line 733 - Check quota
const quotaCheck = await quotaManager.checkQuota(1, true);
if (!quotaCheck.allowed) {
  return c.json({
    error: 'ISBNdb quota exhausted',
    quota_status: quotaCheck.status
  }, 429);
}

// After line 733 - Record usage
await quotaManager.recordApiCall(1);
```

### MEDIUM PRIORITY: Fix Enrichment Queue

**File**: `worker/src/services/queue-handlers.ts:315-488`

**Add quota recording**:
```typescript
// After line 380
const quotaManager = new QuotaManager(env.QUOTA_KV);

// After line 388 - Record the API call
await quotaManager.recordApiCall(1);
```

**Note**: Queue consumers can't reject messages based on quota (messages already in queue). Should record for tracking only.

---

## Verification Steps

### 1. Check Actual ISBNdb Usage

- Log into ISBNdb Premium dashboard: https://isbndb.com/apidocs/v2
- Check "API Usage" section for today's actual calls
- Compare with our quota KV tracking (once fixed)

### 2. Test Quota Tracking

```bash
# After deploying fixes, test quota increment
curl -X POST 'https://alexandria.ooheynerds.com/api/harvest/covers' \
  -H 'Content-Type: application/json' \
  -d '{"batch_size": 10, "queue_covers": false}'

# Check quota increased
curl 'https://alexandria.ooheynerds.com/api/quota/status' | jq
```

### 3. Monitor bendv3 Cron

```bash
# Check bendv3 logs for hourly harvest
cd /Users/juju/dev_repos/bendv3
npm run tail | grep -i "harvest"
```

---

## Quota Management Recommendations

### Current State
- **Daily Quota**: 15,000 API calls (ISBNdb Premium)
- **bendv3 Usage**: 24 calls/day (hourly harvest, 1000 ISBNs each)
- **Remaining**: ~14,976 calls/day for other operations
- **No risk** with current usage pattern

### Optimize Usage
1. **bendv3 hourly harvest**: Could reduce to every 2-4 hours (save 12-18 calls/day)
2. **Bulk operations**: Use `/api/enrich/batch-direct` for large harvests (already quota-protected)
3. **Author expansion**: Limit to 100 calls/day max (plenty of headroom)

### Monitoring
After fixes deployed:
```bash
# Daily quota check (add to crontab)
0 */4 * * * curl -s https://alexandria.ooheynerds.com/api/quota/status | \
  jq -r '"Quota: \(.data.used_today)/\(.data.limit) (\(.data.remaining) remaining)"'
```

---

## Implementation Priority

1. **URGENT**: Fix `/api/harvest/covers` quota tracking
   - Most used endpoint (24x/day via bendv3)
   - Currently blind to usage

2. **HIGH**: Add tests for quota tracking
   - Ensure all ISBNdb-calling endpoints track quota
   - Add integration test for bendv3 harvest flow

3. **MEDIUM**: Fix enrichment queue quota recording
   - Lower priority (queue is quota-checked before queueing)
   - But should still track for accurate metrics

4. **LOW**: Consider hourly limit warnings
   - Alert if >1000 calls/hour consumed
   - Dashboard showing quota burn rate

---

## Quota Safety Measures

### Existing Protections
✅ Direct endpoints check quota before API calls
✅ Quota resets daily at midnight UTC
✅ Quota manager fail-closed (KV errors deny access)
✅ Operation-specific rules (cron needs 2x buffer)

### Missing Protections (Post-Fix)
- ❌ Harvest endpoint not checking quota
- ❌ Queue handler not recording usage
- ❌ No hourly rate limit monitoring
- ❌ No quota exhaustion alerts

---

**Status**: Investigation complete, fixes identified, ready for implementation
**Next Steps**:
1. Fix /api/harvest/covers quota tracking
2. Fix queue-handlers quota recording
3. Deploy and verify quota tracking works
4. Compare KV quota with ISBNdb dashboard
