# Author Just-in-Time (JIT) Enrichment

**Status**: ✅ Implemented (Phase 1)
**Date**: 2026-01-07
**Version**: 1.0

## Overview

Just-in-Time (JIT) author enrichment automatically enriches author metadata when users view or search for authors, maximizing the value of every API call while protecting the book enrichment pipeline.

## Architecture

### Flow Diagram

```
User Views Author Details (GET /api/authors/:key)
  ↓
Track View (update last_viewed_at, view_count, heat_score)
  ↓
Check if Enrichment Needed (needsEnrichment function)
  ↓
Send to AUTHOR_QUEUE (fire-and-forget, priority: medium)
  ↓
Queue Handler (processAuthorQueue)
  ├─ Check Quota Circuit Breakers (85%, 70%)
  ├─ Deduplicate Authors in Batch
  ├─ Fetch from Wikidata (batch API)
  └─ Update enriched_authors table
```

## Key Components

### 1. Database Schema

**New Columns** (`enriched_authors` table):
- `last_viewed_at`: Timestamp of most recent view
- `view_count`: Total view count
- `heat_score`: Priority score = `(view_count * 10) + (book_count * 0.5) + recency_boost`
- `last_enrichment_attempt_at`: Last enrichment attempt time
- `enrichment_attempt_count`: Prevents infinite retries on bad data

**Indexes**:
- `idx_authors_needing_enrichment`: Optimized for finding high-priority authors
- `idx_authors_by_view_count`: View tracking queries

### 2. Queue Configuration

**wrangler.jsonc**:
```json
{
  "queue": "alexandria-author-queue",
  "max_batch_size": 10,
  "max_batch_timeout": 30,
  "max_retries": 3,
  "max_concurrency": 1
}
```

### 3. Enrichment Criteria

An author needs enrichment if:
1. Has Wikidata ID (required)
2. Never been enriched OR last enrichment >90 days ago
3. Not attempted in last 24 hours (prevents retry storms)
4. Attempt count <5 (max retries for bad data)

**Implementation**: `needsEnrichment()` in `worker/src/services/author-service.ts:177`

### 4. Quota Circuit Breakers

Protects book enrichment pipeline from author enrichment consuming quota:

| Threshold | Action | Rationale |
|-----------|--------|-----------|
| **85%** | Halt ALL author enrichment | Book pipeline critical |
| **70%** | Halt low/medium priority only | Allow urgent JIT requests |

**Implementation**: `processAuthorQueue()` in `worker/src/services/queue-handlers.ts:574`

## Usage

### Automatic Triggering

JIT enrichment triggers automatically when:
- User views author details: `GET /api/authors/:key`
- Author has Wikidata ID but needs enrichment

No manual intervention required.

### Manual Triggering

For background/batch enrichment (Phase 2), future endpoints can directly send to `AUTHOR_QUEUE`:

```typescript
await env.AUTHOR_QUEUE.send({
  type: 'JIT_ENRICH',
  priority: 'high', // 'high' | 'medium' | 'low'
  author_key: '/authors/OL7234434A',
  wikidata_id: 'Q1234',
  triggered_by: 'manual'
});
```

## Monitoring

### Analytics Tracking

Metrics tracked via `ANALYTICS` binding:
- `processed`: Authors successfully enriched
- `enriched`: Authors with data from Wikidata
- `failed`: Enrichment errors
- `quota_blocked`: Requests blocked by circuit breakers
- `quota_percentage`: Current ISBNdb quota usage

### Query Analytics

```sql
-- Check enrichment coverage
SELECT
  COUNT(*) as total_authors,
  COUNT(last_viewed_at) as viewed_authors,
  COUNT(CASE WHEN wikidata_enriched_at IS NOT NULL THEN 1 END) as enriched,
  ROUND(AVG(heat_score), 2) as avg_heat_score,
  MAX(view_count) as max_views
FROM enriched_authors
WHERE wikidata_id IS NOT NULL;

-- Top viewed authors needing enrichment
SELECT
  author_key,
  name,
  view_count,
  heat_score,
  last_viewed_at,
  wikidata_enriched_at
FROM enriched_authors
WHERE wikidata_id IS NOT NULL
  AND (wikidata_enriched_at IS NULL OR wikidata_enriched_at < NOW() - INTERVAL '90 days')
ORDER BY heat_score DESC
LIMIT 100;
```

### Logs

Key log events:
- `[AuthorDetails] Triggering JIT enrichment` - View triggered enrichment
- `[AuthorQueue] Circuit breaker at 85% quota` - Quota protection active
- `[AuthorQueue] Author enriched` - Successful enrichment

## Performance

### Expected Metrics

Based on consensus analysis:

**Month 1** (JIT only):
- Target: 1,000 authors enriched
- Coverage: ~40% of viewed authors
- Quota usage: <2% daily quota (~260 calls)

**Month 3** (JIT + selective background):
- Target: 10,000 authors
- Coverage: ~60-70% of viewed authors
- Quota usage: <5% daily quota (~650 calls)

### Quota Management

**Daily Allocation**:
- 11,000 calls: Book enrichment (85%)
- 1,500 calls: Author JIT (11%)
- 500 calls: Reserved/background (4%)

Circuit breakers enforce these limits automatically.

## Limitations

### Current Limitations

1. **Wikidata-only**: Only enriches authors with existing Wikidata IDs
2. **No ISBNdb calls**: Bibliography expansion NOT automatic (by design)
3. **View-triggered only**: No background enrichment in Phase 1
4. **90-day refresh**: Enrichment staleness threshold

### Not Implemented (Future Phases)

- **Phase 2**: Selective background enrichment for high-value authors
- **Phase 3**: Auto-bibliography trigger (when Wikidata ID obtained)
- **Phase 4**: Search-triggered enrichment
- **Phase 5**: Coverage dashboard

## Comparison to Manual Enrichment

| Aspect | Manual (old) | JIT (new) |
|--------|-------------|-----------|
| **Trigger** | User must call `/api/authors/enrich-wikidata` | Automatic on view |
| **Coverage** | 1.2% (174K/14.7M) | Grows with usage |
| **Value** | Random authors | Only viewed authors |
| **Quota** | No protection | 85%/70% circuit breakers |
| **Staleness** | Never refreshes | 90-day refresh |
| **User Experience** | Requires manual action | Transparent |

## Testing

### Unit Tests

Location: `worker/src/services/__tests__/author-service.test.ts`

Key test cases:
- `needsEnrichment()` logic
- Heat score calculation
- View tracking updates
- Circuit breaker thresholds

### Integration Testing

1. **View an author without enrichment**:
```bash
curl https://alexandria.ooheynerds.com/api/authors/OL7234434A
# Check logs for: [AuthorDetails] Triggering JIT enrichment
```

2. **Check queue processing**:
```bash
npx wrangler tail alexandria --format pretty | grep AuthorQueue
```

3. **Verify database update**:
```sql
SELECT
  author_key,
  last_viewed_at,
  view_count,
  wikidata_enriched_at,
  enrichment_source
FROM enriched_authors
WHERE author_key = '/authors/OL7234434A';
```

## Migration Path

### From No Enrichment → JIT

1. Apply database migration (completed 2026-01-07)
2. Deploy worker with author queue handler
3. Monitor logs for JIT triggers
4. Observe coverage growth organically

### Future: JIT → JIT + Background

1. Add scheduled background enrichment (Phase 2)
2. Populate queue with top 100K authors (by heat score)
3. Process at max 500 calls/day
4. Monitor quota usage closely

## Troubleshooting

### Common Issues

**Issue**: Queue messages being retried constantly
- **Cause**: Author has bad Wikidata ID or network issues
- **Solution**: Check `enrichment_attempt_count` - max retries is 5

**Issue**: Enrichment not triggering on view
- **Cause**: Author missing Wikidata ID or already enriched
- **Solution**: Verify `needsEnrichment()` criteria

**Issue**: Circuit breaker blocking all requests
- **Cause**: ISBNdb quota at 85%
- **Solution**: Wait for midnight UTC quota reset

### Debug Commands

```bash
# Check queue depth
npx wrangler queues list | grep alexandria-author-queue

# Tail queue processing
npx wrangler tail alexandria --format pretty | grep '\[AuthorQueue\]'

# Check quota status
curl https://alexandria.ooheynerds.com/api/quota/status

# View enrichment stats
curl https://alexandria.ooheynerds.com/api/authors/enrich-status
```

## Files Changed

**New Files**:
- `migrations/003_add_author_jit_tracking.sql`
- `docs/features/AUTHOR-JIT-ENRICHMENT.md`

**Modified Files**:
- `worker/wrangler.jsonc` - Added AUTHOR_QUEUE binding
- `worker/src/env.ts` - Added AUTHOR_QUEUE type
- `worker/src/routes/authors.ts` - Added JIT trigger on view
- `worker/src/services/author-service.ts` - Added tracking & enrichment logic
- `worker/src/services/queue-handlers.ts` - Added processAuthorQueue handler
- `worker/src/index.ts` - Wired up author queue routing

## References

- [Consensus Analysis](../archive/consensus-2026-01-07-author-enrichment.md)
- [Author Enrichment Status](../CURRENT-STATUS.md#2-author-biography-enrichment)
- [API Documentation](../api/AUTHORS-ENDPOINTS.md)
- [Quota Management](../../CLAUDE.md#isbndb-quota-management)

## Changelog

**2026-01-07** - Phase 1 Implementation
- Added JIT enrichment trigger on author views
- Implemented quota circuit breakers (85%, 70%)
- Added view tracking (last_viewed_at, view_count, heat_score)
- Created author queue handler with Wikidata integration
- Applied database migration with new tracking columns
- Added analytics tracking for enrichment metrics
