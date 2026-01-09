# Task Plan: Investigate ISBNdb Quota Leak

## Goal
Identify source of 15,000 daily ISBNdb API calls causing quota exhaustion (visible in usage graph with massive spikes 2025-12-31 through 2026-01-03).

## Context
- Premium plan: 15,000 calls/daily (no rollover)
- Graph shows multiple days hitting ~15K calls
- Alexandria shows only 2,103 calls used today
- Need to check both `alexandria` and `bendv3` repos

## Phases

### Phase 1: Map All ISBNdb Call Sites in Alexandria [complete]
**Status:** complete
**Files to check:**
- `worker/src/services/isbndb.ts` - Main ISBNdb client
- `worker/src/routes/*` - All API endpoints
- `worker/src/services/queue-handlers.ts` - Queue processors
- `worker/src/services/*-backfill.ts` - Backfill services

**Questions:**
- Where are ISBNdb calls made?
- Are there retry loops?
- Any unbounded batch operations?

### Phase 2: Check Quota Enforcement [complete]
**Status:** complete
**Finding:** Quota manager tracks calls but queue handlers don't enforce limits
**Check:**
- Is quota checking actually blocking calls?
- Can calls bypass the quota system?
- Are there race conditions in quota tracking?

### Phase 3: Analyze Recent Activity Logs [complete]
**Status:** complete
**Finding:**
- Dec 31: 3,021 enrichments (all ISBNdb)
- Jan 4: 1,913 enrichments (all ISBNdb)
- Each enrichment = 1 ISBNdb API call for ISBN resolution
**Check:**
- Worker logs from Dec 31 - Jan 3
- Analytics Engine data for ISBNdb calls
- Any bulk operations during spike period?

### Phase 4: Check bendv3 Repo [complete]
**Status:** complete
**Finding:** No direct ISBNdb integration in bendv3 - only references from imported alexandria-worker package

### Phase 5: Investigate Cloudflare Systems for Missing 10K Calls [in_progress]
**Status:** in_progress
**Approach:**
1. Check Analytics Engine for ISBNdb request patterns
2. Query queue metrics for batch sizes and message counts
3. Check worker logs for retry patterns and failure rates
4. Review KV storage for quota tracking anomalies
5. Check worker invocation metrics for concurrency patterns

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| - | - | - |

## CRITICAL REASSESSMENT - PHASE 2

**Findings so far**:
- Cover queue: ~3,021 calls (Dec 31) + ~1,913 calls (Jan 4) = ~4,934 calls
- Hybrid backfill ISBN resolution: Additional calls (unmeasured)
- **STILL MISSING**: ~10K calls per day to explain 15K daily exhaustion

**User feedback**: Keep digging - these findings don't account for everything

**New search areas**:
1. Check for retry loops in cover fetcher (fetchWithRetry with 3 retries?)
2. Check if JWT expiry recovery is looping (line 134 in queue-handlers)
3. Look for scheduled jobs or cron triggers
4. Check bendv3 for cover requests that trigger Alexandria
5. Check Analytics for actual ISBNdb request patterns
6. Look for webhook/callback loops

**New hypothesis**: Either:
- Quota tracker is completely broken (not recording most calls)
- There's a much larger call volume source we haven't found yet
- Multiple processes/sources calling ISBNdb without going through tracker

## Decisions Made
| Decision | Rationale | Phase |
|----------|-----------|-------|
| Need to audit ALL ISBNdb fetch calls | Tracker mismatch indicates missing tracking | Phase 5 |
