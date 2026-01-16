# Queue Troubleshooting Guide

**Last Updated:** 2026-01-16
**Incident:** 44-day queue consumer failure (Dec 3, 2025 - Jan 16, 2026)

## Overview

This guide documents the procedure for diagnosing and fixing Cloudflare Workers Queue consumer failures in Alexandria. Use this when queue messages are not being processed automatically.

---

## Quick Diagnosis Checklist

Run these checks to identify queue processing issues:

```bash
# 1. Check queue message counts and last activity
npx wrangler queues list | grep alexandria

# 2. Monitor worker logs for queue consumer invocations
npx wrangler tail --format pretty | grep -i queue

# 3. Check database for recent enrichment activity
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  entity_type,
  operation,
  MAX(created_at) as last_activity
FROM enrichment_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY entity_type, operation
ORDER BY last_activity DESC;
\""

# 4. Verify worker health
curl -s https://alexandria.ooheynerds.com/health | jq '.'
```

### Symptoms of Queue Consumer Failure

- ✅ Messages accumulating in queues (count increasing)
- ✅ No "Queue batch received" logs in `wrangler tail`
- ✅ Last queue activity timestamp is stale (>24 hours)
- ✅ Dead letter queues are empty (messages not failing, just not processing)
- ✅ Worker deployments don't fix the issue
- ✅ Direct API calls work (e.g., `/api/enrich/batch-direct`)

---

## Root Cause: Consumer Registration Failure

### What Happens

Cloudflare's queue consumer system can enter a failed state where:

1. **Consumers appear registered** in the API (`wrangler queues list` shows consumers: 1)
2. **But the queue-to-worker binding is broken** (handler never invoked)
3. **Worker deployments don't fix it** (they reuse existing broken registrations)
4. **Manual intervention required** to force Cloudflare to rebuild bindings

### Known Triggers

- Cloudflare platform incidents affecting queue service
- Queue consumer state corruption during worker deployment
- Timeout or race condition in Cloudflare's consumer registration system
- Long periods of queue inactivity (possibly triggers timeout/cleanup)

### Historical Incidents

**December 3, 2025 - January 16, 2026 (44 days):**
- All 4 queue consumers stopped processing
- 6 messages remained stale across all queues
- Multiple worker deployments did not resolve issue
- Manual consumer removal + recreation immediately fixed problem
- Result: 1,933 covers processed in first hour after fix

---

## The Fix: Manual Consumer Reset

### Step-by-Step Procedure

**Prerequisites:**
- Access to `npx wrangler` CLI
- Worker name: `alexandria`
- Queue names: `alexandria-enrichment-queue`, `alexandria-cover-queue`, `alexandria-backfill-queue`, `alexandria-author-queue`

**Estimated Time:** 5 minutes
**Downtime:** None (worker continues serving HTTP requests)

### 1. Verify the Problem

```bash
# Check queue status - look for stale timestamps
npx wrangler queues list | grep alexandria

# Expected output if queues are stale:
# Last Modified dates will be old (days/weeks ago)
# Message counts may be low but not processing
```

### 2. Remove All Queue Consumers

```bash
# Remove each consumer manually (one at a time)
npx wrangler queues consumer worker remove alexandria-enrichment-queue alexandria
npx wrangler queues consumer worker remove alexandria-cover-queue alexandria
npx wrangler queues consumer worker remove alexandria-backfill-queue alexandria
npx wrangler queues consumer worker remove alexandria-author-queue alexandria
```

**Expected output for each:**
```
Removing consumer from queue <queue-name>.
Removed consumer from queue <queue-name>.
```

### 3. Verify Consumers Are Removed

```bash
npx wrangler queues list | grep alexandria
```

**Expected output:**
- Consumer count should show `0` for all queues
- Messages will remain (not deleted, just no consumer)

### 4. Redeploy Worker

```bash
cd worker/
npm run deploy
```

**Expected output (at end of deployment):**
```
Deployed alexandria triggers (X.XX sec)
  alexandria.ooheynerds.com (custom domain)
  schedule: 0 0 * * *
  schedule: 0 2 * * *
  Producer for alexandria-enrichment-queue
  Producer for alexandria-cover-queue
  Producer for alexandria-backfill-queue
  Producer for alexandria-author-queue
  Consumer for alexandria-enrichment-queue  ← Should appear
  Consumer for alexandria-cover-queue       ← Should appear
  Consumer for alexandria-backfill-queue    ← Should appear
  Consumer for alexandria-author-queue      ← Should appear
Current Version ID: <new-version-id>
```

### 5. Verify Consumers Are Re-Registered

```bash
npx wrangler queues list | grep alexandria
```

**Expected output:**
- Consumer count should show `1` for all queues (restored)

### 6. Test Queue Processing

**Option A: Send test enrichment (triggers cover queue)**
```bash
curl -X POST https://alexandria.ooheynerds.com/api/enrich/batch-direct \
  -H "Content-Type: application/json" \
  -d '{"isbns":["9780439064873"]}' | jq '.'
```

**Option B: Monitor logs for queue activity**
```bash
# Start monitoring (keep this running)
npx wrangler tail --format pretty

# In another terminal, trigger enrichment
curl -X POST https://alexandria.ooheynerds.com/api/enrich/batch-direct \
  -H "Content-Type: application/json" \
  -d '{"isbns":["9780316769174"]}' > /dev/null 2>&1

# Watch for queue logs (should appear within 60s):
# "Queue batch received"
# "Cover queue processing started"
# "Cover queue processing complete"
```

### 7. Verify Database Updates

```bash
# Check if covers are being processed
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  COUNT(*) as total_covers,
  COUNT(CASE WHEN updated_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as recent_updates
FROM enriched_editions
WHERE cover_url_large IS NOT NULL;
\""
```

**Expected output:**
- `recent_updates` should be >0 (covers being processed)

---

## Success Criteria

✅ All 4 queue consumers show consumer count = 1
✅ Worker logs show "Queue batch received" messages
✅ Database shows recent enrichment activity (last 5 minutes)
✅ Cover processing stats show recent updates
✅ Dead letter queues remain at 0 (no failures)

---

## Queue Configuration Reference

### Current Settings (worker/wrangler.jsonc)

```jsonc
"queues": {
  "consumers": [
    {
      "queue": "alexandria-enrichment-queue",
      "max_batch_size": 10,
      "max_batch_timeout": 15,  // seconds
      "max_retries": 5,
      "dead_letter_queue": "alexandria-enrichment-dlq",
      "max_concurrency": 10
    },
    {
      "queue": "alexandria-cover-queue",
      "max_batch_size": 5,
      "max_batch_timeout": 60,  // seconds
      "max_retries": 3,
      "dead_letter_queue": "alexandria-cover-dlq",
      "max_concurrency": 3
    },
    {
      "queue": "alexandria-backfill-queue",
      "max_batch_size": 1,
      "max_batch_timeout": 30,  // seconds
      "max_retries": 2,
      "dead_letter_queue": "alexandria-backfill-dlq",
      "max_concurrency": 1
    },
    {
      "queue": "alexandria-author-queue",
      "max_batch_size": 10,
      "max_batch_timeout": 30,  // seconds
      "max_retries": 3,
      "dead_letter_queue": "alexandria-author-dlq",
      "max_concurrency": 1
    }
  ]
}
```

### Processing Triggers

Queue consumers are triggered when **EITHER** condition is met:

1. **Batch size reached:** Queue accumulates `max_batch_size` messages
2. **Timeout reached:** `max_batch_timeout` seconds since first message

**Example (cover-queue):**
- If 5 messages arrive quickly → processes immediately (batch size = 5)
- If 1-4 messages arrive → processes after 60 seconds (timeout)

### Common Issues

**Issue:** Messages not processing despite consumer registered
**Cause:** Consumer registration is stale/corrupted
**Fix:** Apply the manual consumer reset procedure (see above)

**Issue:** Messages going to dead letter queue
**Cause:** Handler errors, timeouts, or exceeding max_retries
**Fix:** Check worker logs for error details, fix handler code

**Issue:** Queue processing too slow
**Cause:** Batch timeout too high, or not enough messages to reach batch size
**Fix:** Adjust `max_batch_timeout` or `max_batch_size` in wrangler.jsonc

---

## Prevention & Monitoring

### Recommended Monitoring

1. **Daily Queue Health Check:**
   ```bash
   # Check for stale queues (no activity >24h)
   npx wrangler queues list | grep alexandria
   ```

2. **Weekly Database Activity Check:**
   ```bash
   # Verify recent enrichment activity
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
   SELECT
     entity_type,
     COUNT(*) as operations,
     MAX(created_at) as last_activity
   FROM enrichment_log
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY entity_type
   ORDER BY last_activity DESC;
   \""
   ```

3. **Monitor Dead Letter Queues:**
   ```bash
   # Check for failed messages
   npx wrangler queues list | grep -E "alexandria.*dlq"
   ```
   - Should always be 0 messages
   - If >0, investigate worker logs for errors

### Alert Thresholds

Set up alerts for:
- ⚠️ Queue last activity >24 hours (possible consumer failure)
- ⚠️ Dead letter queue >0 messages (handler errors)
- ⚠️ Queue depth >100 messages (backlog building up)
- ⚠️ No enrichment log activity >24 hours (system-wide issue)

### Preventive Measures

1. **Regular deployments:** Deploy worker at least weekly to refresh consumer registrations
2. **Queue activity:** Ensure queues process at least a few messages weekly
3. **Health checks:** Run `/enrich-status` skill weekly to catch issues early
4. **Documentation:** Keep this guide updated with new incidents/findings

---

## Troubleshooting Flowchart

```
Queue messages not processing?
    ↓
Are consumers registered? (npx wrangler queues list)
    ↓
YES → Check worker logs (npx wrangler tail)
    ↓
Seeing "Queue batch received"?
    ↓
NO → Apply manual consumer reset (see above)
    ↓
YES → Check handler errors in logs
    ↓
Fix handler code + redeploy
    ↓
Still failing? → Contact Cloudflare Support
```

---

## Related Documentation

- **Queue Architecture:** `docs/QUEUE-ENRICHMENT-SYSTEM.md`
- **Enrichment Status Check:** `.claude/skills/enrich-status/instructions.md`
- **Worker Configuration:** `worker/wrangler.jsonc`
- **Queue Handlers:** `worker/src/services/queue-handlers.ts`
- **Index Export:** `worker/src/index.ts` (lines 270-339)

---

## Cloudflare Support Escalation

If the manual consumer reset doesn't fix the issue, escalate to Cloudflare Support with:

**Information to Include:**
1. Worker name: `alexandria`
2. Account ID: (from Cloudflare dashboard)
3. Queue names affected
4. Timeline of issue (when did processing stop?)
5. Steps already taken (consumer reset, redeployments)
6. Worker logs showing no queue() invocations
7. This troubleshooting guide URL

**Cloudflare Resources:**
- Status Page: https://www.cloudflarestatus.com/
- Support: https://support.cloudflare.com/
- Queue Docs: https://developers.cloudflare.com/queues/

---

## Changelog

### 2026-01-16 - Initial Version
- Documented 44-day consumer failure incident (Dec 3, 2025 - Jan 16, 2026)
- Created manual consumer reset procedure
- Added diagnosis checklist and success criteria
- Established monitoring recommendations

---

## Questions?

For questions about this guide or queue issues:
1. Review the related documentation (see above)
2. Check Cloudflare status page for known issues
3. Run the diagnosis checklist to confirm symptoms
4. Apply the manual consumer reset if symptoms match
5. Contact Cloudflare Support if issue persists

**Last Verified:** 2026-01-16 (all queues operational after fix)
