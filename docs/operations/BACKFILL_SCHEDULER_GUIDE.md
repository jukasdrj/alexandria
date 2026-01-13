# Backfill Scheduler - Operations Guide

## Overview

Systematic month-by-month backfill scheduler for populating Alexandria's database with historically significant books (2000-2024) using AI-driven generation and multi-source ISBN resolution.

**Status**: Built (Jan 13, 2026) - Ready for testing and deployment

## Architecture

### Components

1. **Database Schema** (`migrations/013_backfill_log_table.sql`)
   - `backfill_log` table tracks month completion status
   - Metrics: books_generated, isbns_resolved, resolution_rate, isbns_queued
   - API call tracking: gemini_calls, xai_calls, isbndb_calls
   - Error handling: retry_count, error_message, last_retry_at
   - Indexes optimized for scheduler queries

2. **Scheduler API** (`worker/src/routes/backfill-scheduler.ts`)
   - `POST /api/internal/schedule-backfill` - Trigger batch processing
   - `GET /api/internal/backfill-stats` - View progress statistics
   - `POST /api/internal/seed-backfill-queue` - One-time queue initialization
   - Protected by `X-Cron-Secret` header authentication

3. **Backfill Worker** (`worker/src/services/async-backfill.ts`)
   - Updated to write state to `backfill_log` table
   - Tracks processing → completed/failed/retry state transitions
   - Records metrics after each job completion
   - Automatic retry logic (max 5 attempts)

### Workflow

```
Cron Trigger → POST /api/internal/schedule-backfill
  ↓
Query backfill_log for pending months (recent-first: 2024 → 2000)
  ↓
For each month in batch:
  - Update status to 'processing'
  - Trigger POST /api/harvest/backfill
  - Job runs via BACKFILL_QUEUE
    - Gemini generates 20 books
    - ISBNdb resolves ISBNs
    - Enrich via ENRICHMENT_QUEUE
  - Update backfill_log with final stats
  ↓
Response: batch summary + execution stats
```

## Setup

### 1. Apply Database Migration

```bash
# SSH into database server
ssh root@Tower.local

# Apply migration
docker exec postgres psql -U openlibrary -d openlibrary -f /path/to/013_backfill_log_table.sql

# Verify table created
docker exec postgres psql -U openlibrary -d openlibrary -c "\d backfill_log"
```

### 2. Seed Backfill Queue (One-Time)

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/seed-backfill-queue' \
  -H 'X-Cron-Secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "year_start": 2000,
    "year_end": 2024
  }'
```

**Expected Response:**
```json
{
  "months_seeded": 300,
  "message": "Successfully seeded 300 months (2000-2024)"
}
```

### 3. Deploy Worker

```bash
cd worker/
npm run deploy
```

## Usage

### Dry Run (Testing)

Test scheduler logic without executing backfill:

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H 'X-Cron-Secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "batch_size": 5,
    "dry_run": true
  }'
```

**Response:**
```json
{
  "dry_run": true,
  "batch_size": 5,
  "months_selected": 5,
  "months": [
    { "year": 2024, "month": 12, "status": "pending" },
    { "year": 2024, "month": 11, "status": "pending" },
    ...
  ],
  "total_pending": 300,
  "total_processing": 0,
  "total_completed": 0,
  "total_failed": 0
}
```

### Live Execution

Execute backfill for N months:

```bash
# Phase 1: Start conservative (5 months/day)
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H 'X-Cron-Secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "batch_size": 5,
    "dry_run": false
  }'

# Phase 2: Scale up (10-15 months/day)
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H 'X-Cron-Secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "batch_size": 15,
    "dry_run": false
  }'
```

**Response:**
```json
{
  "dry_run": false,
  "batch_size": 5,
  "months_selected": 5,
  "months": [...],
  "total_pending": 295,
  "total_processing": 5,
  "total_completed": 0,
  "total_failed": 0,
  "execution_summary": {
    "triggered": 5,
    "skipped": 0,
    "errors": 0
  }
}
```

### Check Progress

View aggregated statistics:

```bash
curl 'https://alexandria.ooheynerds.com/api/internal/backfill-stats' \
  -H 'X-Cron-Secret: YOUR_SECRET'
```

**Response:**
```json
{
  "total_months": 300,
  "by_status": {
    "pending": 285,
    "processing": 5,
    "completed": 10,
    "failed": 0,
    "retry": 0
  },
  "progress": {
    "total_books_generated": 200,
    "total_isbns_resolved": 190,
    "overall_resolution_rate": 95.0,
    "total_isbns_queued": 180
  },
  "recent_activity": [
    {
      "year": 2024,
      "month": 12,
      "status": "completed",
      "books_generated": 20,
      "isbns_resolved": 19,
      "resolution_rate": 95.0
    },
    ...
  ]
}
```

### Retry Failed Months

Include failed months (with retry_count < 5) in batch:

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H 'X-Cron-Secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "batch_size": 10,
    "force_retry": true,
    "dry_run": false
  }'
```

## Cron Configuration

### Recommended Schedule

**Option A: Daily Execution (Conservative)**
```
# Every day at 3 AM UTC (after synthetic enhancement at midnight)
0 3 * * * curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H 'X-Cron-Secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data-raw '{"batch_size": 10}'
```

**Option B: Twice Daily (Aggressive)**
```
# Every 12 hours at 3 AM and 3 PM UTC
0 3,15 * * * curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H 'X-Cron-Secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data-raw '{"batch_size": 10}'
```

### Cloudflare Cron Trigger

Add to `wrangler.jsonc`:

```jsonc
{
  "triggers": {
    "crons": [
      "0 3 * * *"  // Daily at 3 AM UTC
    ]
  }
}
```

Then add handler in `worker/src/index.ts`:

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = Logger.forScheduled(env);

    try {
      const response = await fetch('https://alexandria.ooheynerds.com/api/internal/schedule-backfill', {
        method: 'POST',
        headers: {
          'X-Cron-Secret': env.ALEXANDRIA_WEBHOOK_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batch_size: 10 }),
      });

      if (!response.ok) {
        logger.error('Backfill scheduler failed', { status: response.status });
      } else {
        logger.info('Backfill scheduler executed successfully');
      }
    } catch (error) {
      logger.error('Backfill scheduler error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
```

## Monitoring

### Key Metrics

**Success Metrics:**
- ISBN resolution rate: >90% (target: 95%)
- Books generated per day: >200 (40 books × 5+ months)
- ISBNdb quota usage: <50% daily capacity
- Processing success rate: >95% (completed vs failed)

**Alert Thresholds:**
- Resolution rate drops below 85%
- More than 5 failed months without retry
- ISBNdb quota exceeds 6500 calls/day
- Queue backlog exceeds 100 ISBNs

### Database Queries

**Active Jobs:**
```sql
SELECT year, month, status, started_at, retry_count
FROM backfill_log
WHERE status = 'processing'
ORDER BY started_at DESC;
```

**Failed Months:**
```sql
SELECT year, month, error_message, retry_count, last_retry_at
FROM backfill_log
WHERE status = 'failed' OR (status = 'retry' AND retry_count >= 3)
ORDER BY year DESC, month DESC;
```

**Progress by Year:**
```sql
SELECT
  year,
  COUNT(*) AS total_months,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE status = 'pending') AS pending,
  ROUND(AVG(resolution_rate), 2) AS avg_resolution_rate
FROM backfill_log
GROUP BY year
ORDER BY year DESC;
```

## Troubleshooting

### Issue: Scheduler Returns 0 Months Selected

**Cause**: All months in year_range already completed or processing

**Solution**: Check backfill_stats to verify remaining pending months:
```bash
curl 'https://alexandria.ooheynerds.com/api/internal/backfill-stats' \
  -H 'X-Cron-Secret: YOUR_SECRET'
```

### Issue: High Failure Rate

**Cause**: AI provider timeouts, ISBNdb quota exhausted, or network issues

**Solution**:
1. Check Worker logs: `npx wrangler tail alexandria --format pretty`
2. Verify quota: `curl https://alexandria.ooheynerds.com/api/quota/status`
3. Retry failed months with force_retry: `{"batch_size": 5, "force_retry": true}`

### Issue: Low ISBN Resolution Rate (<85%)

**Cause**: AI generating obscure/incorrect titles, or prompt mismatch

**Solution**:
1. Review failed resolutions in logs
2. Consider switching prompt variant (contemporary-notable for 2020+)
3. Check ISBNdb API status

### Issue: Jobs Stuck in 'processing' Status

**Cause**: Worker crash or queue consumer failure

**Solution**:
1. Check BACKFILL_QUEUE depth: `npx wrangler queues list`
2. Manually mark as 'retry' for re-processing:
```sql
UPDATE backfill_log
SET status = 'retry', retry_count = retry_count + 1
WHERE status = 'processing' AND started_at < NOW() - INTERVAL '1 hour';
```

## Performance Expectations

### Phase 1: Validation (Week 1)
- Cadence: 5 months/day
- Books/day: ~200 (40 × 5)
- ISBNdb calls/day: ~200 (1% quota)
- Completion: 2024 months in ~2 days

### Phase 2: Aggressive Scale (Week 2-4)
- Cadence: 10-15 months/day
- Books/day: ~400-600
- ISBNdb calls/day: ~400-600 (3-5% quota)
- Completion: 2020-2024 (60 months) in ~5 days

### Phase 3: Historical Backfill (Month 2+)
- Cadence: 10-20 months/day
- Books/day: ~400-800
- ISBNdb calls/day: ~400-800 (3-6% quota)
- Completion: 2000-2020 (240 months) in ~15-25 days

**Total Estimated Time**: 30-45 days for full 2000-2024 coverage

## Cost Estimate

**API Costs** (300 months × 40 books/month):
- Gemini: 300 calls × $0.000015 = **$0.0045**
- ISBNdb: ~12,000 calls (included in Premium plan) = **$0**

**Total: ~$0.01 for complete 2000-2024 backfill**

## Next Steps

1. ✅ Apply database migration (`013_backfill_log_table.sql`)
2. ✅ Deploy worker with scheduler endpoints
3. ⏳ Seed backfill queue (`/api/internal/seed-backfill-queue`)
4. ⏳ Test with dry run (5 months)
5. ⏳ Execute Phase 1 (5 months/day validation)
6. ⏳ Monitor metrics and adjust cadence
7. ⏳ Scale to Phase 2 (10-15 months/day)
8. ⏳ Configure cron for automated execution

## References

- **Consensus Analysis**: Multi-model recommendation for backfill strategy
- **AI Provider Debugging**: `docs/AI_PROVIDER_DEBUGGING_SESSION.md`
- **Backfill Architecture**: `worker/src/services/async-backfill.ts`
- **Scheduler Endpoints**: `worker/src/routes/backfill-scheduler.ts`
