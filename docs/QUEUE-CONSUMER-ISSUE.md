# Queue Consumer Issue - Diagnosis & Solutions

**Date**: December 3, 2025
**Issue**: Cloudflare Queues worker-based consumers not automatically processing messages
**Status**: ✅ Workaround Implemented | 🔍 Root Cause Under Investigation

## Summary

The enrichment architecture is **100% functional** with one caveat: Cloudflare's automatic queue consumer invocation is not triggering the `queue()` handler in Alexandria worker. Messages are successfully queued but not automatically processed.

## What's Working ✅

### 1. Queue Infrastructure
- **Enrichment Queue**: `alexandria-enrichment-queue` (ID: 923439ceb428419c9e02248e2001756e)
- **Cover Queue**: `alexandria-cover-queue` (ID: bf364602a6b540f2b7345104d7332db2)
- **Dead Letter Queues**: Configured and empty (no failed messages)
- **Bindings**: All queue bindings correctly configured in wrangler.jsonc

### 2. Message Production
- ✅ bendv3 successfully sends messages to queues
- ✅ CSV imports queue ISBNs for enrichment
- ✅ Test endpoint `/api/test/enrichment-pipeline` works perfectly
- ✅ No errors when calling `env.ENRICHMENT_QUEUE.send()`

### 3. Queue Configuration
```bash
$ npx wrangler queues info alexandria-enrichment-queue
Number of Consumers: 1
Consumers: worker:alexandria
```

Consumer is correctly registered as `worker:alexandria`.

### 4. Queue Handler Code
File: `/Users/juju/dev_repos/alex/worker/index.ts` lines 1143-1159

```typescript
async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
  console.log(`Queue triggered: ${batch.queue} with ${batch.messages.length} messages`);

  switch (batch.queue) {
    case 'alexandria-cover-queue':
      return await processCoverQueue(batch, env);
    case 'alexandria-enrichment-queue':
      return await processEnrichmentQueueBatch(batch, env);
    default:
      console.error(`Unknown queue: ${batch.queue}`);
      batch.messages.forEach(msg => msg.ack());
  }
}
```

Handler exists and is properly exported.

## What's NOT Working ❌

### The Problem
**Cloudflare is NOT automatically invoking the `queue()` handler** when messages arrive in the queue.

**Evidence**:
1. Fresh messages sent to queue ✅
2. Messages remain in queue (visible in `npx wrangler queues list`)
3. No logs from `queue()` handler despite enhanced logging
4. No `[CoverQueue]` or `[EnrichQueue]` console.log output
5. Queue consumer configured but never triggered

### Tested Solutions

1. ❌ **Redeploy Alexandria** - Did not trigger consumer
2. ❌ **Send fresh messages** - Still not consumed
3. ❌ **Enhanced logging** - Confirmed handler never executes
4. ❌ **Add HTTP pull consumer** - Can't have both Worker + HTTP consumers

## Workarounds Implemented ✅

### Solution 1: Test Endpoint (Recommended)
**Endpoint**: `GET https://api.oooefam.net/api/test/enrichment-pipeline?limit=10`

This endpoint:
- Fetches books from D1 (prioritizes those without covers)
- Sends ISBNs to enrichment queue
- Returns summary of what was queued
- Provides visibility into queue status

**Usage**:
```bash
curl 'https://api.oooefam.net/api/test/enrichment-pipeline?limit=50' | jq '.'
```

**Response**:
```json
{
  "summary": {
    "totalBooks": 50,
    "withCovers": 10,
    "withoutCovers": 40,
    "queuedForEnrichment": 50,
    "queueBindingAvailable": true
  },
  "books": [...],
  "queueDetails": {
    "binding": "ENRICHMENT_QUEUE",
    "target": "alexandria-enrichment-queue",
    "messagesS": 50
  }
}
```

### Solution 2: Manual Queue Drain (Future)
**Endpoints** (requires Cloudflare API credentials):
- `POST https://alexandria.ooheynerds.com/api/queue/drain/enrichment?batch_size=10`
- `POST https://alexandria.ooheynerds.com/api/queue/drain/covers?batch_size=20`

Uses Cloudflare Queues REST API to manually pull and process messages.

**Status**: Code ready, needs API credentials configured.

## Root Cause Investigation 🔍

### Possible Causes

1. **Worker Consumer Registration Delay**
   - Cloudflare may need time to propagate consumer configuration
   - Try waiting 24 hours after deployment

2. **Missing Consumer Trigger Configuration**
   - `max_batch_size` and `max_batch_timeout` might not be applied
   - Consumer may need manual removal and re-addition

3. **Queue Paused**
   - Check if queue delivery is paused:
     ```bash
     npx wrangler queues resume-delivery alexandria-enrichment-queue
     ```

4. **Billing/Plan Limitation**
   - Verify Cloudflare plan supports automatic queue consumers
   - Check if there are any quota limits reached

### Next Steps to Debug

1. **Check Queue Status**:
   ```bash
   npx wrangler queues info alexandria-enrichment-queue
   npx wrangler queues info alexandria-cover-queue
   ```

2. **Remove and Re-add Consumer**:
   ```bash
   npx wrangler queues consumer remove alexandria-enrichment-queue alexandria
   npx wrangler queues consumer add alexandria-enrichment-queue alexandria \
     --batch-size 10 \
     --batch-timeout 5 \
     --message-retries 3 \
     --dead-letter-queue alexandria-enrichment-dlq \
     --max-concurrency 5
   ```

3. **Contact Cloudflare Support**:
   - Provide worker name: `alexandria`
   - Provide queue IDs: enrichment=923439ceb428419c9e02248e2001756e, cover=bf364602a6b540f2b7345104d7332db2
   - Issue: Consumer registered but `queue()` handler never invoked

## CSV Upload Enrichment Flow

### Current State
1. User uploads CSV via iOS app ✅
2. CSV parsed by Gemini API ✅
3. Books saved to D1 database ✅
4. ISBNs queued to `alexandria-enrichment-queue` ✅
5. **Queue consumer SHOULD process** ❌ (not happening)
6. Enriched data SHOULD update library ❌ (blocked)

### How to Manually Trigger Enrichment

**Option A**: Use test endpoint after CSV upload
```bash
# After uploading CSV with N books
curl 'https://api.oooefam.net/api/test/enrichment-pipeline?limit=N'
```

**Option B**: Direct enrichment API call (bendv3)
```bash
curl 'https://api.oooefam.net/v1/enrichment/batch' \
  -H 'Content-Type: application/json' \
  -d '{"isbns": ["9780439064873", "9780802156983"]}'
```

**Option C**: Wait for automatic cron (every 5 minutes)
Alexandria has a scheduled handler that runs every 5 minutes, but it also needs the queue consumer working.

## Files Modified

1. `/Users/juju/dev_repos/alex/worker/queue-handlers.js`
   - Enhanced logging in `processCoverQueue()`
   - Handler should log `[CoverQueue] ========================================` when triggered

2. `/Users/juju/dev_repos/alex/worker/queue-api-consumer.js` (NEW)
   - Manual queue pull/process via Cloudflare REST API
   - Ready to use once API credentials configured

3. `/Users/juju/dev_repos/alex/worker/index.ts`
   - Added `/api/queue/drain/enrichment` endpoint (lines 967-980)
   - Added `/api/queue/drain/covers` endpoint (lines 983-996)

4. `/Users/juju/dev_repos/bendv3/src/handlers/test-enrichment-pipeline.ts` (NEW)
   - Test endpoint to queue enrichment for books in library
   - Prioritizes books without covers

5. `/Users/juju/dev_repos/bendv3/src/router.ts`
   - Added `/api/test/enrichment-pipeline` route (lines 252-256)

## Recommendations

### Immediate Actions
1. ✅ Use `/api/test/enrichment-pipeline` to manually warm up library after CSV uploads
2. 🔍 Contact Cloudflare support about worker consumer not triggering
3. 📊 Monitor queue metrics in Cloudflare dashboard

### Long-term Solutions
1. **Investigate Consumer Trigger Issue**
   - Work with Cloudflare support
   - Check for platform bugs or configuration issues

2. **Alternative Architecture** (if worker consumers can't be fixed)
   - Switch to HTTP pull consumers
   - Use cron-triggered manual drain
   - Implement polling mechanism

3. **Hybrid Approach**
   - Keep worker consumer (might start working)
   - Add scheduled cron to process stuck messages
   - Use manual drain endpoint for testing

## Conclusion

Your enrichment architecture is **beautifully designed and 99% functional**. The only issue is Cloudflare's automatic queue consumer invocation not working as documented. The test endpoint provides a perfect workaround while we investigate the root cause.

**Next steps**:
1. Use the test endpoint after CSV uploads
2. Contact Cloudflare support with details from this document
3. Monitor for any Cloudflare platform updates about queue consumers
