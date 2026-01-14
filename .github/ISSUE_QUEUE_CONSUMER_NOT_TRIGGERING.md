# Queue Consumers Not Processing Messages

## Issue Summary

Both enrichment and cover queue consumers are failing to process messages despite:
- Queue bindings configured correctly in `wrangler.jsonc`
- Handler functions exist and are wired in `index.ts`
- Messages successfully sent to queues
- Historical evidence of queues working (last enrichment: Jan 12 at 8:50 PM)

**Impact:** 283 ISBNs queued from 2020 backfill were never processed, leaving books stuck at baseline completeness scores.

**Workaround:** Bypassing queues with `/api/enrich/batch-direct` successfully enriched 49/51 ISBNs.

---

## Evidence

### 1. Queue Status (Current)

```bash
$ npx wrangler queues list | grep "enrichment\|cover"
alexandria-enrichment-queue  │ 2 messages | 1 backlog
alexandria-cover-queue       │ 2 messages | 1 backlog
```

**Expected:** 0 messages (all processed)
**Actual:** Only 2 messages remain from 283 originally queued

### 2. Historical Queue Activity

**Enrichment queue last worked:**
```sql
SELECT * FROM enrichment_log ORDER BY created_at DESC LIMIT 1;
-- Latest: 2026-01-12 20:50:05 (4.5 hours BEFORE backfill started)
```

**Cover queue last worked:**
```
Queue alexandria-cover-queue (5 messages) @ 2026-01-13 21:02:49
"Cover queue processing started (jSquash WebP)"
-- Logs show activity at 9:02 PM (AFTER enrichment queue stopped)
```

**Conclusion:** Enrichment queue stopped working sometime between Jan 12 8:50 PM and Jan 13 8:17 PM (backfill start).

### 3. Queue Configuration

**From `wrangler.jsonc`:**
```jsonc
{
  "queue": "alexandria-enrichment-queue",
  "max_batch_size": 10,
  "max_batch_timeout": 5,
  "max_retries": 3,
  "dead_letter_queue": "alexandria-enrichment-dlq",
  "max_concurrency": 10  // Recently increased from 1
}
```

**Verified in deployment:**
```
Deployed alexandria triggers (5.21 sec)
  Consumer for alexandria-enrichment-queue ✅
  Consumer for alexandria-cover-queue ✅
```

### 4. Handler Wiring

**File: `worker/src/index.ts:284-285`**
```typescript
case 'alexandria-enrichment-queue':
  return await processEnrichmentQueue(batch as MessageBatch<EnrichmentQueueMessage>, env);
```

**Handler exists:** `worker/src/services/queue-handlers.ts:387`
```typescript
export async function processEnrichmentQueue(
  batch: MessageBatch<EnrichmentQueueMessage>,
  env: Env
): Promise<EnrichmentQueueResults> {
  // DEBUG: Log IMMEDIATELY to verify handler is called
  console.log('[ENRICHMENT-DEBUG] Consumer started', { ... });
  // ... (handler code)
}
```

### 5. Debug Logging Results

**Deployed debug logging on Jan 14 at 3:18 AM UTC:**
- Added `console.log('[ENRICHMENT-DEBUG] Consumer started')` at handler entry
- Wrapped entire handler in try-catch to capture silent failures
- Increased `max_concurrency` from 1 to 10

**Result after 3+ hours of monitoring:**
```bash
$ npm run tail | grep -i "enrichment\|ENRICHMENT-DEBUG"
# No output - handler never invoked
```

### 6. Message Disappearance

**Backfill sent 283 ISBNs to queue:**
```sql
SELECT SUM(isbns_queued) FROM backfill_log WHERE year = 2020;
-- Result: 283
```

**Queue currently has only 2 messages:**
- 281 messages disappeared
- Not in dead letter queue (0 messages)
- No enrichment_log entries created

**Hypothesis:** Messages exceeded `max_retries: 3` and either:
1. Expired due to long exponential backoff delays
2. Failed silently without logging to DLQ
3. Were processed but failed to commit/ack

---

## What We've Tried

### ✅ Configuration Changes
- [x] Increased `max_concurrency` from 1 to 10
- [x] Verified queue bindings in deployment
- [x] Confirmed no quota issues (ISBNdb: 2,602 / 13,000 used)

### ✅ Debug Logging
- [x] Added console.log at handler entry point
- [x] Wrapped handler in try-catch for error detection
- [x] Monitored worker logs for 3+ hours
- **Result:** No logs emitted (handler never called)

### ✅ Manual Testing
- [x] Health endpoint works (`/health` returns 200)
- [x] Cover queue worked recently (Jan 13 at 9:02 PM)
- [x] Database connectivity confirmed (Hyperdrive latency: 60ms)

### ✅ Workaround Validation
- [x] Bypassed queue with `/api/enrich/batch-direct`
- [x] Successfully enriched 49/51 ISBNs (96% success)
- [x] Created 98 enrichment_log entries
- **Conclusion:** Handler logic works when invoked directly

---

## Root Cause Hypotheses

### A. Queue Consumer Binding Issue
**Probability:** Medium
**Evidence:**
- Consumer listed in deployment output
- But no logs indicate consumer ever triggered
- Cover queue works, enrichment queue doesn't (inconsistent)

**Test:**
```bash
# Check if consumer is actually registered
npx wrangler queues consumer worker list alexandria-enrichment-queue
# (Note: This command may not exist in current wrangler version)
```

### B. Message Format Mismatch
**Probability:** Medium
**Evidence:**
- Messages sent via `env.ENRICHMENT_QUEUE.send({ isbns, source, priority })`
- Handler expects `MessageBatch<EnrichmentQueueMessage>`
- Type mismatch could cause silent rejection

**Test:**
- Inspect actual queue message structure
- Compare against `EnrichmentQueueMessage` type definition

### C. Silent Handler Failure Before Debug Logging
**Probability:** Low
**Evidence:**
- Debug logging added at TOP of handler (line 1)
- No logs emitted means handler never entered
- Try-catch should have caught any errors

**Counter-evidence:**
- If handler was called and failed, we'd see the debug log before the error

### D. Exponential Backoff Retry Delays
**Probability:** High
**Evidence:**
- Messages tried to process, failed 3 times
- Entered long retry delays (hours/days)
- Eventually expired from queue

**Why this explains the symptoms:**
- 281 messages disappeared (expired after max retries)
- 2 messages remain (still in retry cycle)
- No DLQ messages (haven't reached final retry yet)

### E. Queue Concurrency Limit
**Probability:** Low (Already Fixed)
**Evidence:**
- Was set to `max_concurrency: 1`
- Might have blocked processing if first message stuck
- Changed to 10, but no improvement observed

---

## Recommended Investigation Steps

### 1. Message Inspection (High Priority)
**Goal:** Understand actual queue message structure

```bash
# Try to consume one message manually
npx wrangler queues consumer worker add alexandria-enrichment-queue alexandria --debug

# Or inspect via dashboard
# Cloudflare Dashboard → Workers & Pages → alexandria → Queues → alexandria-enrichment-queue
```

**Look for:**
- Message body structure
- Timestamp (when sent)
- Retry count
- Error metadata

### 2. Consumer Trigger Verification (High Priority)
**Goal:** Confirm consumer binding is active

**Steps:**
1. Create test endpoint that manually sends a message
2. Monitor logs in real-time
3. Check if handler is invoked

**Test endpoint:**
```typescript
app.post('/api/test/queue-trigger', async (c) => {
  await c.env.ENRICHMENT_QUEUE.send({
    isbns: ['9780439064873'],
    source: 'manual-test',
    priority: 'high'
  });
  return c.json({ success: true, message: 'Test message sent' });
});
```

### 3. Compare Cover Queue (Medium Priority)
**Goal:** Understand why cover queue works but enrichment doesn't

**Differences to investigate:**
- Handler structure (cover vs enrichment)
- Message format
- Batch size (5 vs 10)
- Processing time (jSquash takes ~1.3s per cover)

### 4. Cloudflare Dashboard Inspection (Medium Priority)
**Goal:** Check queue metrics and consumer status

**Check:**
- Queue consumer metrics (invocations, errors, duration)
- Worker analytics (queue handler execution count)
- Error logs (if any)

### 5. Retry Behavior Analysis (Low Priority)
**Goal:** Understand exponential backoff timing

**Calculate retry schedule:**
- Retry 1: Immediate
- Retry 2: ~1 minute delay
- Retry 3: ~5 minute delay
- After max_retries: Message should move to DLQ

**Why DLQ is empty:**
- Messages may have been purged after expiration
- Or retry cycle still in progress (unlikely after 7+ hours)

---

## Temporary Workaround

**Use `/api/enrich/batch-direct` for bulk enrichment:**

```bash
# Create JSON file with ISBNs
cat > isbns.json << 'EOF'
["9780439064873", "9780545010221"]
EOF

# Send to batch-direct endpoint
curl -X POST https://alexandria.ooheynerds.com/api/enrich/batch-direct \
  -H "Content-Type: application/json" \
  -d "{\"isbns\": $(cat isbns.json), \"source\": \"manual-enrichment\"}"
```

**Advantages:**
- ✅ Bypasses stuck queue
- ✅ Processes up to 1000 ISBNs in single API call
- ✅ Only uses 1 ISBNdb quota (batch API)
- ✅ Proven to work (49/51 success rate)

**Disadvantages:**
- ❌ Doesn't fix root cause
- ❌ Requires manual triggering
- ❌ Can't be used for async workflows (e.g., backfill cron)

---

## Action Items

- [ ] **P0:** Inspect actual queue message structure via dashboard
- [ ] **P0:** Create test endpoint to manually trigger queue message
- [ ] **P1:** Check Cloudflare dashboard for consumer metrics/errors
- [ ] **P1:** Compare cover queue handler vs enrichment queue handler
- [ ] **P2:** Add more granular logging throughout handler (not just at entry)
- [ ] **P2:** Test with single message instead of batch
- [ ] **P3:** Research Cloudflare Queue retry behavior and exponential backoff timing
- [ ] **P3:** Consider implementing direct cover processing endpoint (like batch-direct)

---

## Related Files

**Queue Configuration:**
- `worker/wrangler.jsonc:140-197` - Queue bindings and consumer settings

**Queue Handlers:**
- `worker/src/services/queue-handlers.ts:387-862` - Enrichment queue handler
- `worker/src/services/queue-handlers.ts:174-385` - Cover queue handler

**Queue Routing:**
- `worker/src/index.ts:280-305` - Queue message routing

**Message Sending:**
- `worker/src/services/async-backfill.ts:461-466` - Backfill sends to enrichment queue
- `worker/src/services/enrichment-service.ts` - Various enrichment functions queue covers

**Type Definitions:**
- `worker/src/types/queue.ts` - Queue message interfaces

---

## Timeline

- **Jan 12, 8:50 PM UTC:** Last successful enrichment (169,574 total enrichments)
- **Jan 13, 8:17 PM UTC:** Backfill queues 283 ISBNs to enrichment queue
- **Jan 13, 9:02 PM UTC:** Cover queue processing observed (working)
- **Jan 14, 3:18 AM UTC:** Deployed debug logging + increased concurrency
- **Jan 14, 6:00 AM UTC:** Confirmed no handler invocations after 3 hours
- **Jan 14, 6:25 AM UTC:** Bypassed queue with batch-direct (49/51 enriched)

---

## Success Metrics

**Queue is considered "fixed" when:**
1. Messages sent to enrichment queue are processed within 5 minutes
2. `enrichment_log` entries created for each processed ISBN
3. `completeness_score` upgraded from 30 → 58+ after enrichment
4. No messages remain in queue after processing
5. Debug logs show `[ENRICHMENT-DEBUG] Consumer started` when messages arrive

**Testing procedure:**
```bash
# 1. Send test message
curl -X POST 'https://alexandria.ooheynerds.com/api/test/queue-trigger'

# 2. Monitor logs (should see debug output within 30 seconds)
npm run tail | grep ENRICHMENT-DEBUG

# 3. Check enrichment_log
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \
  'SELECT COUNT(*) FROM enrichment_log WHERE created_at >= NOW() - INTERVAL \"1 minute\";'"

# 4. Verify queue is empty
npx wrangler queues list | grep enrichment-queue
```

---

## Additional Context

**System Environment:**
- Platform: Cloudflare Workers (Paid Plan)
- Worker CPU Limit: 300s
- Database: PostgreSQL via Hyperdrive + Cloudflare Tunnel
- Queue Implementation: Cloudflare Queues (producer + consumer)

**Recent Changes:**
- Increased enrichment queue `max_concurrency` from 1 → 10
- Added debug logging at handler entry point
- No changes to handler logic or message format

**Known Working Components:**
- ✅ Worker responds to HTTP requests
- ✅ Database connectivity (Hyperdrive: 60ms latency)
- ✅ ISBNdb API (quota healthy: 2,605 / 13,000)
- ✅ Cover queue consumer (worked on Jan 13)
- ✅ Enrichment handler logic (works when called via batch-direct)

**Broken Components:**
- ❌ Enrichment queue consumer trigger
- ❌ Cover queue consumer trigger (same symptoms)
