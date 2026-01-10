---
name: queue-optimization
description: Optimize Cloudflare Queue performance, batch sizes, and concurrency settings
user-invocable: true
context: fork
agent: cloudflare-workers-optimizer
model: sonnet
skills:
  - planning-with-files
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
hooks:
  Start:
    - type: command
      command: echo "⚡ Queue optimization workflow starting..."
  Stop:
    - type: command
      command: echo "⚡ Queue optimization complete - validate with queue-status"
---

# Queue Optimization Skill

**Purpose:** Systematically optimize Cloudflare Queue performance, throughput, and cost-efficiency
**Agent:** cloudflare-workers-optimizer (auto-loaded)
**Context:** Runs in forked sub-agent for isolation
**Auto-loads:** planning-with-files for structured execution
**Updated:** January 10, 2026

## When to Use

**Required for queue performance issues:**
- Slow processing throughput
- Queue backlog growing
- High CPU time consumption
- Frequent timeouts or retries
- Cost optimization for paid plan
- Batch size tuning
- Concurrency adjustments

**Trigger phrases:**
- "The enrichment queue is backing up"
- "Cover processing is too slow"
- "Optimize queue performance"
- "Tune batch sizes for queues"
- "Queue handlers are timing out"

## Workflow

This skill automatically:
1. **Loads cloudflare-workers-optimizer agent** for Workers expertise
2. **Activates planning-with-files** for structured analysis
3. **Profiles current queue performance** via analytics
4. **Identifies bottlenecks** (batch size, concurrency, handler logic)
5. **Tests optimizations** with gradual rollouts
6. **Validates improvements** with metrics

## Queue Architecture Overview

Alexandria uses 4 Cloudflare Queues:

```
ENRICHMENT_QUEUE (alexandria-enrichment-queue)
├── Batch: 100 messages
├── Concurrency: 1 consumer
└── Handler: processEnrichmentQueue()

COVER_QUEUE (alexandria-cover-queue)
├── Batch: 5 messages
├── Concurrency: 3 consumers
└── Handler: processCoverQueue()

BACKFILL_QUEUE (alexandria-backfill-queue)
├── Batch: 1 message
├── Concurrency: 1 consumer
└── Handler: processBackfillQueue()

AUTHOR_QUEUE (alexandria-author-queue)
├── Batch: 10 messages
├── Concurrency: 1 consumer
└── Handler: processAuthorQueue()
```

**Configuration:** `worker/wrangler.jsonc`
**Handlers:** `worker/src/services/queue-handlers.ts`
**Routing:** `worker/src/index.ts` - `queue()` handler

## Optimization Checklist

### Phase 1: Performance Analysis
- [ ] Check queue analytics (Cloudflare dashboard)
- [ ] Review queue-status output (backlog, processing rate)
- [ ] Profile handler execution time
- [ ] Identify bottlenecks (I/O, CPU, external API)
- [ ] Check error/retry rates
- [ ] Analyze cost per message

### Phase 2: Configuration Tuning
- [ ] Adjust batch size (higher = better throughput, lower latency)
- [ ] Tune concurrency (more consumers = faster, higher cost)
- [ ] Optimize handler logic
- [ ] Add caching where applicable
- [ ] Implement batch operations
- [ ] Reduce external API calls

### Phase 3: Testing & Validation
- [ ] Test locally with npm run dev
- [ ] Deploy to production
- [ ] Monitor queue-status for improvements
- [ ] Check error rates
- [ ] Validate cost impact
- [ ] Measure throughput gains

### Phase 4: Documentation
- [ ] Update wrangler.jsonc comments
- [ ] Document optimization decisions
- [ ] Update CLAUDE.md patterns
- [ ] Add performance benchmarks

## Optimization Patterns

### Pattern 1: Batch Size Tuning

**Decision Matrix:**

| Queue Type | Recommended Batch | Rationale |
|------------|-------------------|-----------|
| Fast I/O (DB writes) | 50-100 | High throughput, low latency |
| Slow I/O (cover downloads) | 5-10 | Avoid timeouts, controlled concurrency |
| Single operations | 1 | Orchestration, long-running tasks |
| Mixed workload | 20-50 | Balance throughput and latency |

**Example: Enrichment Queue**
```jsonc
// worker/wrangler.jsonc
{
  "queues": {
    "consumers": [
      {
        "queue": "alexandria-enrichment-queue",
        "max_batch_size": 100,        // High throughput for DB writes
        "max_batch_timeout": 30,      // 30s to accumulate messages
        "max_retries": 3,              // Retry failed batches
        "dead_letter_queue": "alexandria-dlq"
      }
    ]
  }
}
```

**When to increase batch size:**
- Handler processes messages independently
- Low per-message latency (<100ms)
- High message volume
- Cost optimization (fewer invocations)

**When to decrease batch size:**
- High per-message latency (>1s)
- Risk of timeouts
- Need low latency (real-time processing)
- Complex error handling requirements

### Pattern 2: Concurrency Optimization

**Decision Matrix:**

| Concurrency | Use Case | Trade-offs |
|-------------|----------|------------|
| 1 | Sequential processing, order matters | Low cost, predictable |
| 2-3 | Balanced throughput, moderate load | Good cost/performance |
| 5+ | High throughput, independent operations | Higher cost, race conditions |

**Example: Cover Queue (3 concurrent consumers)**
```jsonc
{
  "queues": {
    "consumers": [
      {
        "queue": "alexandria-cover-queue",
        "max_batch_size": 5,
        "max_concurrency": 3,  // 3 parallel consumers
        "max_retries": 2
      }
    ]
  }
}
```

**When to increase concurrency:**
- Queue backlog growing
- Handler has significant I/O wait time
- Messages are independent (no ordering requirements)
- Paid Workers plan (unmetered concurrency)

**When to keep concurrency low:**
- Sequential processing required
- External API rate limits
- Risk of race conditions
- Cost sensitivity

### Pattern 3: Handler Logic Optimization

**Inefficient Handler:**
```typescript
// BAD: Sequential processing in batch
async function processCoverQueue(batch: MessageBatch<CoverMessage>) {
  for (const message of batch.messages) {
    const coverUrl = await fetchCover(message.body.isbn);
    const processed = await processCover(coverUrl);
    await saveCover(processed);
    message.ack();
  }
}
```

**Optimized Handler:**
```typescript
// GOOD: Parallel processing with Promise.all
async function processCoverQueue(batch: MessageBatch<CoverMessage>) {
  const results = await Promise.allSettled(
    batch.messages.map(async (message) => {
      try {
        const coverUrl = await fetchCover(message.body.isbn);
        const processed = await processCover(coverUrl);
        await saveCover(processed);
        message.ack();
      } catch (error) {
        logger.error('Cover processing failed', { error, isbn: message.body.isbn });
        message.retry(); // Will retry up to max_retries
      }
    })
  );

  // Log batch summary
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  logger.info('Cover batch processed', { succeeded, failed, total: batch.messages.length });
}
```

**Key optimizations:**
- Use `Promise.allSettled()` for parallel execution
- Individual message ack/retry (not batch-level)
- Comprehensive error handling
- Batch-level logging for monitoring

### Pattern 4: Database Batch Operations

**Inefficient: N+1 queries**
```typescript
// BAD: One query per message
for (const message of batch.messages) {
  await sql`INSERT INTO enriched_editions (isbn, ...) VALUES (${message.body.isbn}, ...)`;
}
```

**Optimized: Bulk insert**
```typescript
// GOOD: Single batch insert
const values = batch.messages.map(msg => ({
  isbn: msg.body.isbn,
  title: msg.body.title,
  // ...other fields
}));

await sql`
  INSERT INTO enriched_editions (isbn, title, ...)
  SELECT * FROM json_populate_recordset(null::enriched_editions, ${JSON.stringify(values)})
  ON CONFLICT (isbn) DO UPDATE SET
    title = EXCLUDED.title,
    updated_at = NOW()
`;
```

**Performance gain:** 100 individual INSERTs → 1 bulk INSERT
- Latency: ~1000ms → ~50ms (20x faster)
- Cost: 100 DB round-trips → 1 round-trip

### Pattern 5: Caching Strategy

**Add KV caching for repeated data:**
```typescript
async function processEnrichmentQueue(batch: MessageBatch<EnrichmentMessage>, env: Env) {
  const cache = new Map<string, any>();

  // Pre-fetch work metadata for all ISBNs in batch
  const workIds = batch.messages.map(m => m.body.work_id).filter(Boolean);
  const uniqueWorkIds = [...new Set(workIds)];

  const cachedWorks = await Promise.all(
    uniqueWorkIds.map(async (workId) => {
      const cached = await env.CACHE.get(`work:${workId}`);
      return cached ? JSON.parse(cached) : null;
    })
  );

  cachedWorks.forEach((work, idx) => {
    if (work) cache.set(uniqueWorkIds[idx], work);
  });

  // Process with cache
  await Promise.allSettled(
    batch.messages.map(async (message) => {
      const work = cache.get(message.body.work_id) || await fetchWork(message.body.work_id);
      // ... rest of processing
    })
  );
}
```

### Pattern 6: Timeout Management

**Handle long-running operations:**
```typescript
async function processWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
    ),
  ]);
}

// Usage in handler
try {
  const result = await processWithTimeout(
    () => fetchAndProcessCover(isbn),
    5000 // 5s timeout per cover
  );
  message.ack();
} catch (error) {
  if (error.message === 'Operation timeout') {
    logger.warn('Cover processing timeout', { isbn });
    message.retry(); // Will retry with exponential backoff
  } else {
    throw error;
  }
}
```

## Performance Benchmarks

### Current Performance (as of Jan 2026)

**Enrichment Queue:**
- Throughput: ~500 ISBNs/minute
- Latency: ~120ms per ISBN (including DB write)
- Batch size: 100 messages
- Concurrency: 1 consumer
- Cost: ~$0.002 per 1000 messages

**Cover Queue:**
- Throughput: ~60 covers/minute (3 concurrent consumers)
- Latency: ~1.2s per cover (download + process)
- Batch size: 5 messages
- Concurrency: 3 consumers
- Cost: ~$0.005 per 1000 messages

**Backfill Queue:**
- Throughput: ~20 operations/hour
- Latency: ~3 minutes per operation (Gemini + ISBNdb + dedup)
- Batch size: 1 message (orchestration)
- Concurrency: 1 consumer
- Cost: ~$0.05 per operation (external API costs)

## Monitoring & Analytics

### Check Queue Status

```bash
# Real-time queue metrics
./scripts/queue-status.sh

# Sample output:
# ENRICHMENT_QUEUE:
#   Messages in queue: 1,234
#   Processing rate: 450/min
#   Estimated completion: 3 minutes
#   Error rate: 0.2%
```

### Cloudflare Dashboard Metrics

**Navigate to:** Workers & Pages → alexandria → Queues

**Key metrics:**
- Messages produced/consumed over time
- Processing latency (P50, P95, P99)
- Error rate and retry counts
- Consumer invocations
- CPU time per message

### Analytics Queries

```sql
-- Queue processing performance
SELECT
  blob1 as queue_name,
  AVG(double1) as avg_latency_ms,
  COUNT(*) as total_messages,
  SUM(CASE WHEN blob2 = 'error' THEN 1 ELSE 0 END) as errors
FROM queue_analytics
WHERE timestamp >= NOW() - INTERVAL '1 hour'
GROUP BY queue_name
ORDER BY queue_name;
```

## Troubleshooting Common Issues

### Issue 1: Queue Backlog Growing

**Symptoms:**
- Message count increasing over time
- Processing rate < production rate
- High latency

**Diagnosis:**
```bash
./scripts/queue-status.sh  # Check backlog size
npm run tail | grep 'Queue processing'  # Check handler performance
```

**Solutions:**
1. Increase batch size (if handler can handle it)
2. Increase concurrency (if messages are independent)
3. Optimize handler logic (parallel processing, caching)
4. Scale external dependencies (upgrade ISBNdb plan, add more Hyperdrive connections)

### Issue 2: High Error Rate

**Symptoms:**
- Many retries in logs
- Messages going to DLQ
- Inconsistent processing

**Diagnosis:**
```bash
npm run tail | grep 'ERROR'  # Check error logs
npx wrangler queues consumer dead-letter-queue alexandria-dlq  # Check DLQ
```

**Solutions:**
1. Add error handling for known failure modes
2. Implement exponential backoff for external APIs
3. Add circuit breakers for flaky dependencies
4. Validate message schema before processing
5. Add timeout handling

### Issue 3: High CPU Time / Cost

**Symptoms:**
- High CPU time per message
- Increased costs
- Timeouts on complex operations

**Diagnosis:**
```bash
# Check CPU time in Cloudflare dashboard
# Workers & Pages → alexandria → Analytics → CPU Time
```

**Solutions:**
1. Profile handler logic (identify hot paths)
2. Move expensive operations out of handler (offload to another queue)
3. Reduce batch size (lower CPU per invocation)
4. Cache expensive computations
5. Optimize algorithms (use indexed lookups vs full scans)

## Cost Optimization

### Paid Workers Plan Benefits

**Queue processing with paid plan:**
- ✅ Unlimited queue messages (free tier: 1M/month)
- ✅ Extended CPU time (50ms → 300s per invocation)
- ✅ Higher concurrency (no limits)
- ✅ Lower latency (global distribution)

**Cost breakdown:**
- Queue operations: $0.40 per million messages
- Worker invocations: $0.15 per million requests
- CPU time: Included in paid plan (up to 300s)

**Optimization strategies:**
1. Increase batch size to reduce invocations
2. Use concurrency to maximize throughput
3. Batch database operations (reduce round-trips)
4. Cache frequently accessed data (KV/R2)

## Best Practices Summary

1. **Profile before optimizing** - Use queue-status and analytics
2. **Batch aggressively** - Higher batch = better throughput
3. **Process in parallel** - Use Promise.allSettled() in handlers
4. **Cache intelligently** - Pre-fetch common data
5. **Handle errors gracefully** - Individual message ack/retry
6. **Monitor continuously** - Set up alerts for backlog growth
7. **Test incrementally** - Gradual rollout of changes
8. **Document decisions** - Update wrangler.jsonc with rationale
9. **Cost-aware tuning** - Balance performance and cost
10. **Fail fast** - Use timeouts to prevent stuck messages

## Files to Modify

**Configuration:**
- `worker/wrangler.jsonc` - Queue settings (batch size, concurrency)

**Handlers:**
- `worker/src/services/queue-handlers.ts` - Handler logic

**Analytics:**
- `worker/lib/analytics.ts` - Performance tracking

**Documentation:**
- `CLAUDE.md` - Update queue architecture notes
- `docs/operations/QUEUE-PERFORMANCE.md` - Add benchmarks

---

**Last Updated:** January 10, 2026
**Maintained By:** Alexandria AI Team
**Related Skills:** planning-with-files, cloudflare-workers-optimizer agent
**Related Commands:** /queue-status, /enrich-status
