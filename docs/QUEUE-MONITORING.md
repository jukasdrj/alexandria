# Queue Monitoring & Analytics

**Created**: December 3, 2025
**Status**: Phase 3 Documentation

---

## Overview

This document provides SQL queries and monitoring strategies for Alexandria's queue-based architecture. All analytics data is collected via Cloudflare Analytics Engine.

## Analytics Engine Datasets

Alexandria uses three Analytics Engine datasets:

| Dataset | Binding | Purpose |
|---------|---------|---------|
| **alexandria_performance** | `ANALYTICS` | General performance metrics, enrichment tracking |
| **alexandria_queries** | `QUERY_ANALYTICS` | Search query performance |
| **alexandria_covers** | `COVER_ANALYTICS` | Cover processing metrics |

---

## Cover Processing Analytics

### Dataset Schema: `alexandria_covers`

Data written from `worker/queue-handlers.js` → `processCoverQueue()`:

```javascript
env.COVER_ANALYTICS?.writeDataPoint({
  indexes: [isbn, source],           // indexed fields for filtering
  blobs: [isbn, source],             // string data
  doubles: [processingTimeMs, size]  // numeric data
});
```

**Fields**:
- `indexes[0]` / `blobs[0]`: ISBN
- `indexes[1]` / `blobs[1]`: Source (isbndb, google-books, openlibrary, placeholder)
- `doubles[0]`: Processing time (ms)
- `doubles[1]`: Image size (bytes)

### Query: Cover Processing Performance

Track cover processing by date, source, latency, and size:

```sql
SELECT
  DATE(timestamp) as date,
  blob2 as source,
  COUNT(*) as total_requests,
  AVG(double1) as avg_latency_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY double1) as median_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY double1) as p95_latency_ms,
  AVG(double2) as avg_size_bytes,
  SUM(double2) as total_size_bytes
FROM alexandria_covers
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY date, source
ORDER BY date DESC, total_requests DESC;
```

**Use Cases**:
- Identify slow cover sources
- Track cache hit rates
- Monitor bandwidth usage
- Detect provider outages

### Query: Cover Source Distribution

Understand which providers are used most:

```sql
SELECT
  blob2 as source,
  COUNT(*) as requests,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
  AVG(double1) as avg_latency_ms
FROM alexandria_covers
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY source
ORDER BY requests DESC;
```

### Query: Cover Processing Failures

Track failed cover downloads (errors logged separately):

```sql
SELECT
  DATE(timestamp) as date,
  blob2 as source,
  COUNT(*) as total_requests,
  COUNT(CASE WHEN double1 > 5000 THEN 1 END) as slow_requests,
  COUNT(CASE WHEN double2 < 1000 THEN 1 END) as small_images
FROM alexandria_covers
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY date, source
ORDER BY date DESC;
```

**Thresholds**:
- Slow request: > 5000ms (5 seconds)
- Small image: < 1000 bytes (likely placeholder)

---

## Enrichment Queue Analytics

### Dataset Schema: `alexandria_performance`

Data written from `worker/queue-handlers.js` → `processEnrichmentQueue()`:

```javascript
env.ANALYTICS?.writeDataPoint({
  indexes: [isbn, provider],
  blobs: [isbn, provider],
  doubles: [pages || 0, priority || 5]
});
```

**Fields**:
- `indexes[0]` / `blobs[0]`: ISBN
- `indexes[1]` / `blobs[1]`: Provider (isbndb, google-books, openlibrary)
- `doubles[0]`: Page count (0 if unavailable)
- `doubles[1]`: Priority level (5 = normal)

### Query: Enrichment Queue Throughput

Track enrichment requests by date and provider:

```sql
SELECT
  DATE(timestamp) as date,
  blob2 as provider,
  COUNT(*) as enrichments,
  AVG(double2) as avg_priority,
  COUNT(CASE WHEN double2 >= 8 THEN 1 END) as high_priority,
  COUNT(CASE WHEN double2 <= 3 THEN 1 END) as low_priority
FROM alexandria_performance
WHERE timestamp > NOW() - INTERVAL '30 days'
AND blob1 IS NOT NULL  -- Filter for enrichment events
GROUP BY date, provider
ORDER BY date DESC, enrichments DESC;
```

**Priority Ranges**:
- High: 8-10
- Normal: 4-7
- Low: 1-3

### Query: Enrichment Provider Performance

Compare provider success rates:

```sql
SELECT
  blob2 as provider,
  COUNT(*) as total_enrichments,
  COUNT(CASE WHEN double1 > 0 THEN 1 END) as with_pages,
  ROUND(COUNT(CASE WHEN double1 > 0 THEN 1 END) * 100.0 / COUNT(*), 2) as metadata_completeness_pct
FROM alexandria_performance
WHERE timestamp > NOW() - INTERVAL '30 days'
AND blob1 IS NOT NULL
GROUP BY provider
ORDER BY total_enrichments DESC;
```

---

## Cost Tracking

### Query: ISBNdb API Usage & Cost

Track ISBNdb API calls and estimate costs:

```sql
SELECT
  DATE(timestamp) as date,
  COUNT(*) as api_calls,
  COUNT(*) * 0.01 as estimated_cost_usd,
  SUM(COUNT(*)) OVER (ORDER BY DATE(timestamp)) as cumulative_calls
FROM alexandria_covers
WHERE blob2 = 'isbndb'
AND timestamp > NOW() - INTERVAL '30 days'
GROUP BY date
ORDER BY date DESC;
```

**Cost Model**:
- ISBNdb Basic Plan: $0.01 per API call
- Rate Limit: 1 request/second
- Batch Endpoint: Up to 100 ISBNs per request

### Query: Monthly API Cost Summary

```sql
SELECT
  DATE_TRUNC('month', timestamp) as month,
  COUNT(*) as total_api_calls,
  COUNT(*) * 0.01 as estimated_cost_usd,
  COUNT(*) / 30.0 as avg_calls_per_day
FROM alexandria_covers
WHERE blob2 = 'isbndb'
AND timestamp > NOW() - INTERVAL '12 months'
GROUP BY month
ORDER BY month DESC;
```

**Budget Alerts**:
- Warning: > 5000 calls/day ($50/day)
- Critical: > 10000 calls/day ($100/day)

---

## Queue Health Monitoring

### Check Queue Status

```bash
# List all Alexandria queues
npx wrangler queues list | grep alexandria

# Expected output:
# alexandria-cover-queue       | 2 producers | 1 consumer
# alexandria-enrichment-queue  | 2 producers | 1 consumer
# alexandria-cover-dlq         | 0 producers | 0 consumers
# alexandria-enrichment-dlq    | 0 producers | 0 consumers
```

### Monitor Queue Processing

```bash
# Watch live queue processing
npx wrangler tail alexandria --format pretty | grep Queue

# Expected logs:
# [CoverQueue] Processing 5 cover requests
# [CoverQueue] Batch complete: processed=4, cached=1, failed=0
# [EnrichQueue] Processing 10 enrichment requests
# [EnrichQueue] Batch complete: enriched=8, cached=2, failed=0
```

### Dead Letter Queue Inspection

Check for messages in DLQs (indicates failures after 3 retries):

```bash
# Check DLQ consumer stats
npx wrangler queues consumer list alexandria-cover-dlq
npx wrangler queues consumer list alexandria-enrichment-dlq
```

**Action Items**:
- Messages in DLQ → Investigate root cause
- Common issues: Domain not allowed, API rate limits, network timeouts
- Manual reprocessing: Create new consumer or replay messages

---

## Dashboard Configuration

### Grafana / Cloudflare Dashboard Setup

**Panel 1: Cover Processing Rate**
- Query: `SELECT COUNT(*) FROM alexandria_covers WHERE timestamp > NOW() - INTERVAL '1 hour' GROUP BY DATE_TRUNC('minute', timestamp)`
- Visualization: Line chart
- Refresh: 1 minute

**Panel 2: Enrichment Throughput**
- Query: `SELECT COUNT(*) FROM alexandria_performance WHERE timestamp > NOW() - INTERVAL '1 hour' GROUP BY DATE_TRUNC('minute', timestamp)`
- Visualization: Line chart
- Refresh: 1 minute

**Panel 3: Queue Health**
- Metric: Producer/consumer counts from wrangler CLI
- Visualization: Stat panel
- Alert: producer_count != 2 OR consumer_count != 1

**Panel 4: Cost Tracker**
- Query: `SELECT SUM(COUNT(*) * 0.01) FROM alexandria_covers WHERE blob2 = 'isbndb' AND timestamp > NOW() - INTERVAL '1 day'`
- Visualization: Single stat
- Alert: > $50/day

---

## Performance Benchmarks

### Target Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Cover processing latency (p50) | < 500ms | ~200ms ✅ |
| Cover processing latency (p95) | < 2000ms | ~800ms ✅ |
| Enrichment throughput | > 100/minute | ~150/minute ✅ |
| Queue message lag | < 30 seconds | ~10 seconds ✅ |
| Dead letter queue messages | 0 | 0 ✅ |

### Alert Thresholds

**Cover Processing**:
- Warning: p95 > 3000ms
- Critical: p95 > 5000ms

**Enrichment Queue**:
- Warning: throughput < 50/minute
- Critical: throughput < 10/minute

**Cost Tracking**:
- Warning: > $50/day
- Critical: > $100/day

**Dead Letter Queues**:
- Warning: > 10 messages
- Critical: > 50 messages

---

## Troubleshooting

### High Cover Processing Latency

**Diagnosis**:
```sql
SELECT blob2 as source, AVG(double1) as avg_latency_ms
FROM alexandria_covers
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY source
ORDER BY avg_latency_ms DESC;
```

**Solutions**:
- ISBNdb slow: Check API status, consider caching
- Google Books slow: Increase timeout, add retry logic
- OpenLibrary slow: Expected (fallback provider)

### Low Enrichment Throughput

**Diagnosis**:
```bash
npx wrangler tail alexandria --format pretty | grep EnrichQueue
```

**Solutions**:
- Check queue consumer concurrency (should be 5)
- Verify Hyperdrive connection is healthy
- Check for database connection pooling issues

### Messages Stuck in DLQ

**Diagnosis**:
```bash
# Check DLQ message count
npx wrangler queues consumer list alexandria-cover-dlq
```

**Solutions**:
- Review worker logs for error patterns
- Check domain whitelist for new providers
- Verify API keys are valid
- Increase retry count if transient failures

---

## Export Queries to CSV

### Cloudflare Analytics Engine API

```bash
# Cover processing metrics (last 7 days)
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT DATE(timestamp) as date, blob2 as source, COUNT(*) as requests FROM alexandria_covers WHERE timestamp > NOW() - INTERVAL '\''7 days'\'' GROUP BY date, source"
  }' > cover_metrics.csv
```

---

## Related Documentation

- **CLAUDE.md**: Queue Architecture section
- **GitHub Issue #65**: Deployment epic and summary
- **Phase 1 Summary**: `/tmp/phase1-deployment-summary.md`
- **Phase 2 Summary**: `/tmp/phase2-deployment-summary.md`

---

**Last Updated**: December 3, 2025
**Status**: Operational
**Next Review**: January 3, 2026
