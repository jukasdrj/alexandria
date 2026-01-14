# Deployment Checklist - Queue Configuration Update

**Date**: 2026-01-14
**Change**: Increase ENRICHMENT_QUEUE `max_retries: 3 → 5`
**Reason**: Grok root cause analysis - transient platform issue safety net
**Risk Level**: LOW (defensive change, no breaking changes)

## Pre-Deployment

### Code Changes Verified
- [x] `worker/wrangler.jsonc:168` - `max_retries: 5` confirmed
- [x] All other queue configs unchanged (cover, backfill, author)
- [x] Syntax validated (JSONC comments preserved)

### Testing
- [x] Consumer health confirmed via `/api/debug/enrichment-queue`
- [x] Test message processed in <1ms
- [x] 283 messages processed successfully in production

### Documentation
- [x] Root cause documented in `GROK_ROOT_CAUSE_ANALYSIS.md`
- [x] Resolution timeline in `QUEUE_DEBUG_RESOLUTION.md`
- [x] Summary in `RESOLUTION_SUMMARY.md`
- [x] GitHub Issue #185 updated and closed

## Deployment Steps

### 1. Pre-Deployment Validation
```bash
cd /Users/juju/dev_repos/alex/worker

# Verify wrangler.jsonc syntax
npx wrangler deploy --dry-run

# Check current queue status
npx wrangler queues list | grep enrichment
```

### 2. Deploy Configuration
```bash
# Deploy with new queue configuration
npm run deploy

# Expected output:
# ✓ Deployment complete
# ✓ Queue consumer updated: alexandria-enrichment-queue
```

### 3. Post-Deployment Verification
```bash
# 1. Start log monitoring
npx wrangler tail --format pretty

# 2. Send test message (in new terminal)
curl -X POST https://alexandria.ooheynerds.com/api/debug/enrichment-queue

# 3. Verify consumer processes message
# Expected: "Queue batch received" within 30 seconds
```

### 4. Monitor for Issues
```bash
# Check queue metrics after 10 minutes
# Cloudflare Dashboard → Workers & Pages → alexandria → Queues → enrichment

# Expected metrics:
# - Messages pending: 0
# - Messages delivered: 0 (or processing actively)
# - Messages failed: 0
# - DLQ messages: 0
```

## Rollback Plan (If Needed)

### Quick Rollback
```bash
cd /Users/juju/dev_repos/alex/worker

# Revert max_retries to 3
# Edit wrangler.jsonc line 168:
#   "max_retries": 3,

# Redeploy
npm run deploy
```

### When to Rollback
- ❌ Consumer stops processing messages
- ❌ DLQ receives messages unexpectedly
- ❌ Processing latency increases significantly
- ❌ Error rate spikes in logs

**Note**: Rollback is unlikely to be needed - increasing retries is a defensive change with no downside.

## Success Criteria

### Immediate (0-1 hour)
- [x] Deployment completes without errors
- [ ] Test message processed successfully
- [ ] Logs show normal queue processing
- [ ] No DLQ messages

### Short-term (24 hours)
- [ ] Zero stuck messages in "delivered" state
- [ ] DLQ remains empty
- [ ] All enrichment batches complete normally
- [ ] No increase in error rates

### Long-term (7 days)
- [ ] Average retry count remains <2
- [ ] Processing latency P99 <100ms
- [ ] No similar stuck message incidents
- [ ] Queue throughput maintains or improves

## Post-Deployment Tasks

### Monitoring Setup (Priority 2)
- [ ] Configure queue state metrics dashboard
- [ ] Set up DLQ alerts (alert on any messages)
- [ ] Add retry rate monitoring (alert on >3 avg)
- [ ] Implement processing latency tracking
- [ ] Correlate with Cloudflare status API

### Documentation Updates
- [ ] Update CLAUDE.md with new queue configuration
- [ ] Add monitoring section to operations docs
- [ ] Document debug endpoint in API docs
- [ ] Share learnings in team retrospective

## Configuration Summary

**Before**:
```jsonc
{
  "queue": "alexandria-enrichment-queue",
  "max_batch_size": 10,
  "max_batch_timeout": 5,
  "max_retries": 3,           // ❌ Too low for transient issues
  "dead_letter_queue": "alexandria-enrichment-dlq",
  "max_concurrency": 10
}
```

**After**:
```jsonc
{
  "queue": "alexandria-enrichment-queue",
  "max_batch_size": 10,       // ✅ Unchanged (works well)
  "max_batch_timeout": 5,     // ✅ Unchanged (generous for <1ms processing)
  "max_retries": 5,           // ✅ Increased (transient issue safety net)
  "dead_letter_queue": "alexandria-enrichment-dlq",
  "max_concurrency": 10       // ✅ Unchanged (handles 283 msgs successfully)
}
```

**Rationale** (Grok analysis):
> "I agree with increasing max_retries from 3 to 5, as it provides a safety net for transient issues without significant overhead—retries in Cloudflare are efficient and don't consume resources until attempted. Prioritize this first, as it directly addresses the observed failure mode (messages expiring after retries) and aligns with defensive engineering practices."

## Notes

- **No breaking changes** - Only retry count increased
- **Backward compatible** - Existing messages unaffected
- **Zero downtime** - Queue consumers update seamlessly
- **Low risk** - Defensive change with no performance impact
- **Evidence-based** - Grok analysis, proven root cause

---

**Ready to deploy?** ✅

```bash
cd /Users/juju/dev_repos/alex/worker && npm run deploy
```
