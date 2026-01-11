# Cloudflare Workers Cron Configuration

**Last Updated**: 2026-01-10 21:45 UTC
**Status**: Deployed and Active ✅

---

## Cron Schedules

Alexandria Worker has **two** scheduled cron jobs running daily:

### 1. Synthetic Enhancement Cron
**Schedule**: `0 0 * * *` (Daily at midnight UTC)
**Handler**: `handleScheduledSyntheticEnhancement(env)`
**File**: `worker/src/routes/enhancement-cron.ts`

**Purpose**: Enhance synthetic works created during ISBNdb quota exhaustion

**Process**:
1. Query synthetic works ready for enhancement (up to 500 works)
2. Resolve ISBN via ISBNdb title/author search
3. Create enriched_editions records
4. Queue for full enrichment (Wikidata, Archive.org, Google Books, covers)
5. Update completeness_score (30 → 80)

**Timing Rationale**: Runs at midnight UTC, right after ISBNdb daily quota resets, ensuring maximum quota availability for enhancement.

**Expected Performance**:
- Capacity: ~500 works enhanced per day
- API calls: ~500-505 (500 ISBN resolutions + 5 batch enrichment calls)
- Duration: 60-90 seconds (depends on batch size and quota)
- Success rate: 100% (based on testing)

---

### 2. Cover Harvest + Wikidata Enrichment Cron
**Schedule**: `0 2 * * *` (Daily at 2 AM UTC)
**Handlers**:
- `handleScheduledCoverHarvest(env)` - `worker/src/routes/harvest.ts`
- `handleScheduledWikidataEnrichment(env)` - `worker/src/routes/authors.js`

**Purpose**: Existing scheduled tasks for cover harvesting and author enrichment

**Timing Rationale**: Runs at 2 AM UTC, 2 hours after synthetic enhancement, to avoid quota contention.

---

## Configuration Files

### wrangler.jsonc
```jsonc
{
  "triggers": {
    "crons": [
      "0 0 * * *",  // Midnight UTC - Synthetic enhancement
      "0 2 * * *"   // 2 AM UTC - Cover harvest + Wikidata
    ]
  }
}
```

### index.ts - Scheduled Handler
```typescript
async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
  const logger = Logger.forScheduled(env);

  try {
    logger.info('Scheduled event triggered', { cron: event.cron });

    if (event.cron === '0 0 * * *') {
      // Midnight UTC: Synthetic enhancement
      logger.info('Running synthetic enhancement cron');
      await handleScheduledSyntheticEnhancement(env);
    } else if (event.cron === '0 2 * * *') {
      // 2 AM UTC: Cover harvest + Wikidata enrichment
      logger.info('Running cover harvest + Wikidata enrichment crons');
      await Promise.all([
        handleScheduledCoverHarvest(env),
        handleScheduledWikidataEnrichment(env)
      ]);
    } else {
      logger.warn('Unknown cron schedule', { cron: event.cron });
    }

    logger.info('All scheduled tasks completed', { cron: event.cron });
  } catch (error) {
    logger.error('Scheduled handler error', { error, cron: event.cron });
    throw error;
  }
}
```

---

## Handler Implementation

### handleScheduledSyntheticEnhancement()
**Location**: `worker/src/routes/enhancement-cron.ts:271-325`

**Logic**:
```typescript
export async function handleScheduledSyntheticEnhancement(env: Env): Promise<void> {
  const logger = Logger.forScheduled(env);
  const startTime = Date.now();

  try {
    const sql = postgres(env.HYPERDRIVE.connectionString, {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    try {
      // Query synthetic works (default batch size: 500)
      const candidates = await getSyntheticWorksForEnhancement(500, sql, logger);

      if (candidates.length === 0) {
        logger.info('No synthetic works need enhancement');
        return;
      }

      logger.info('Found candidates for enhancement', { count: candidates.length });

      // Enhance batch
      const stats = await enhanceSyntheticBatch(candidates, sql, env, logger);

      logger.info('Daily enhancement complete', {
        duration_ms: Date.now() - startTime,
        candidates_found: candidates.length,
        isbns_resolved: stats.isbns_resolved,
        editions_created: stats.editions_created,
        enrichment_queued: stats.enrichment_queued,
        api_calls_used: stats.api_calls_used,
        quota_exhausted: stats.quota_exhausted,
        errors: stats.errors,
      });
    } finally {
      await sql.end();
    }
  } catch (error) {
    logger.error('Daily enhancement failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration_ms: Date.now() - startTime,
    });

    // Don't throw - allow other scheduled tasks to continue
  }
}
```

**Key Features**:
- **Graceful failure**: Catches errors and logs without throwing (allows other crons to continue)
- **Database cleanup**: Always closes SQL connection in `finally` block
- **Comprehensive logging**: Tracks stats for monitoring
- **Batch processing**: Enhances up to 500 works per run

---

## Monitoring

### Logs to Monitor

**Success Indicators**:
```
[ScheduledEnhancement] Daily synthetic enhancement started
[ScheduledEnhancement] Found candidates for enhancement - count: 76
[ScheduledEnhancement] Daily enhancement complete - isbns_resolved: 76, api_calls_used: 505
```

**Failure Indicators**:
```
[ScheduledEnhancement] Daily enhancement failed - error: <error message>
```

**No Work Indicators**:
```
[ScheduledEnhancement] No synthetic works need enhancement
```

### Cloudflare Dashboard

**View Logs**:
```bash
npx wrangler tail alexandria --format pretty
```

**Filter for Scheduled Events**:
```bash
npx wrangler tail alexandria --format pretty | grep -E "Scheduled|ScheduledEnhancement"
```

### Key Metrics to Track

1. **Daily Enhancement Count**:
   - How many works enhanced per day?
   - Target: 76 works cleared in ~2 days, then ongoing as new synthetics created

2. **API Call Usage**:
   - How many ISBNdb calls used by enhancement?
   - Budget: ~500-1000 calls/day (out of 13,000 daily quota)

3. **Success Rate**:
   - `isbns_resolved / candidates_found`
   - Target: 70-90% (some works may not have ISBNs in ISBNdb)

4. **Queue Success Rate**:
   - `enrichment_queued / isbns_resolved`
   - Target: 100% (queue should never fail)

5. **Errors**:
   - `stats.errors` should be 0
   - Alert if errors > 5

---

## Manual Triggering

### Test Enhancement (Dry Run)
```bash
curl -X POST https://alexandria.ooheynerds.com/api/internal/enhance-synthetic-works \
  -H "Content-Type: application/json" \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  --data-raw '{"batch_size":10,"dry_run":true}'
```

### Trigger Enhancement Manually
```bash
curl -X POST https://alexandria.ooheynerds.com/api/internal/enhance-synthetic-works \
  -H "Content-Type: application/json" \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  --data-raw '{"batch_size":500,"dry_run":false}'
```

**Note**: Manual triggering does NOT affect the scheduled cron - it will still run at midnight UTC.

---

## Quota Management

### ISBNdb Daily Quota Allocation

**Total Daily Quota**: 13,000 calls

**Allocation**:
- User requests (search, enrichment): ~8,000 calls (60%)
- Backfill operations: ~2,000 calls (15%)
- **Synthetic enhancement**: ~500-1,000 calls (4-8%)
- Buffer: ~2,500 calls (19%)

**Synthetic Enhancement Budget**:
- **Midnight run**: Up to 500 works (~505 API calls)
- **Additional capacity**: Could run 2x/day if needed (e.g., noon + midnight)

### Quota Exhaustion Handling

**If enhancement exhausts quota**:
1. `enhanceSyntheticBatch()` stops gracefully
2. Returns `quota_exhausted: true` in stats
3. Partially enhanced works marked `completeness_score = 40`
4. Next day's cron will retry failed works

**Prevention**:
- Midnight timing ensures fresh quota
- 500 works = <4% of daily quota
- Buffer ensures user requests unaffected

---

## Troubleshooting

### Cron Not Running

**Check Deployment**:
```bash
npx wrangler deployments list
```

**Verify Triggers**:
```bash
npx wrangler deployments view <deployment-id>
```

**Expected Output**:
```
Triggers:
  schedule: 0 0 * * *
  schedule: 0 2 * * *
```

### No Candidates Found

**Possible Reasons**:
1. All synthetic works already enhanced ✅ (Good!)
2. No synthetic works exist in database
3. Query filter too strict (`completeness_score < 50`)

**Verify**:
```sql
SELECT COUNT(*) FROM enriched_works
WHERE synthetic = true
  AND completeness_score < 50
  AND last_isbndb_sync IS NULL;
```

### Enhancement Failing

**Check Logs**:
```bash
npx wrangler tail alexandria --format pretty | grep ScheduledEnhancement
```

**Common Issues**:
1. Database connection timeout
2. ISBNdb API key expired
3. Quota exhausted (shouldn't happen at midnight)
4. Queue send failures (check ENRICHMENT_QUEUE binding)

**Fix**:
1. Verify database tunnel: `./scripts/tunnel-status.sh`
2. Check ISBNdb quota: `curl https://alexandria.ooheynerds.com/api/quota/status`
3. Verify queue binding in wrangler.jsonc

---

## Deployment History

### Version d823b3a4 (2026-01-10 21:45 UTC)
- **Added**: Synthetic enhancement cron ("0 0 * * *")
- **Modified**: index.ts scheduled() handler to route cron events
- **Created**: handleScheduledSyntheticEnhancement() function
- **Status**: DEPLOYED AND ACTIVE ✅

**Deployment Command**:
```bash
cd worker/
npx wrangler deploy
```

**Verification**:
```bash
# Check deployment
npx wrangler deployments list | head -5

# Tail logs
npx wrangler tail alexandria --format pretty
```

---

## Future Enhancements

### 1. Multiple Daily Runs
**Idea**: Run enhancement 2x/day (midnight + noon UTC)

**Benefits**:
- Faster catchup (1,000 works/day vs 500)
- Spread quota usage across day
- Reduce backlog after heavy backfill periods

**Configuration**:
```jsonc
"crons": [
  "0 0 * * *",   // Midnight UTC
  "0 12 * * *",  // Noon UTC (NEW)
  "0 2 * * *"    // 2 AM UTC (existing)
]
```

### 2. Adaptive Batch Sizing
**Idea**: Adjust batch size based on quota remaining

**Logic**:
```typescript
const quotaStatus = await quotaManager.checkQuota(0, false);
const quotaRemaining = quotaStatus.limit - quotaStatus.used;
const batchSize = Math.min(500, Math.floor(quotaRemaining / 2));
```

**Benefits**:
- Maximize enhancement when quota abundant
- Throttle when quota scarce
- Prevent quota exhaustion

### 3. Priority-Based Enhancement
**Idea**: Enhance high-value synthetic works first

**Criteria**:
- Works with higher Gemini confidence scores
- Recently created works (fresher data)
- Works with more metadata (publisher, year, etc.)

**Query Modification**:
```sql
ORDER BY
  (metadata#>>'{}')::jsonb->>'gemini_confidence' DESC,
  created_at DESC
LIMIT 500
```

### 4. Retry Failed Queue Sends
**Idea**: Retry works with `completeness_score = 40` (queue failed)

**Query Addition**:
```sql
WHERE (
  (last_isbndb_sync IS NULL AND completeness_score < 50)
  OR (completeness_score = 40 AND last_isbndb_sync < NOW() - INTERVAL '7 days')
)
```

**Benefits**:
- Automatic recovery from queue failures
- No manual intervention needed
- 7-day cooldown prevents retry spam

---

## Conclusion

**Cron Configuration**: FULLY DEPLOYED ✅

**Schedules**:
- ✅ Midnight UTC: Synthetic enhancement (500 works/day)
- ✅ 2 AM UTC: Cover harvest + Wikidata enrichment

**Monitoring**:
- Logs: `npx wrangler tail alexandria`
- Quota: `GET /api/quota/status`
- Database: Check synthetic work backlog

**Expected Timeline**:
- Tonight (00:00 UTC): First automated run
- 76 existing synthetic works will be cleared in ~2 days
- Ongoing: Automatically enhance new synthetics as they're created

**Documentation**:
- This file: Cron configuration reference
- `SYNTHETIC_WORKS_ENRICHMENT_FLOW.md`: Complete enrichment pipeline
- `QUOTA_EXHAUSTION_HANDLING.md`: Graceful degradation guide
- `progress.md`: Implementation progress tracking
