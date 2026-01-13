# Backfill Scheduler Testing Guide

**Date**: 2026-01-13
**Status**: ✅ Timestamp fix deployed, secret authentication working

---

## Current Status

### ✅ What's Working

1. **Timestamp bug fixed**: `completed_at` logic corrected in `async-backfill.ts`
2. **Database reset**: All 300 months in `'pending'` status
3. **Secret authentication**: `ALEXANDRIA_WEBHOOK_SECRET` is working (confirmed by logs)
4. **Worker deployed**: Version ID `1ca2b161-df68-4eae-83b2-7fe291af5cf2`

### ⚠️ What's Pending

1. **Secret value unknown**: The `ALEXANDRIA_WEBHOOK_SECRET` exists and validates, but the value isn't documented
2. **No test run completed**: Dry runs tested but no actual backfill processing verified yet

---

## How to Test the Backfill Scheduler

### 1. Get the Webhook Secret

The secret exists in Cloudflare Worker Secrets. To use it:

**Option A: Check Cloudflare Dashboard**
1. Go to Workers & Pages → alexandria → Settings → Variables and Secrets
2. Find `ALEXANDRIA_WEBHOOK_SECRET`
3. Note the value (or regenerate if needed)

**Option B: Use Existing Value**
The logs show a successful POST to `/api/internal/schedule-backfill` at 3:55:52 PM, meaning someone already has the correct secret value.

### 2. Dry Run Test (Safe)

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H "X-Cron-Secret: YOUR_SECRET_HERE" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "batch_size": 2,
    "year_range": {"start": 2023, "end": 2023},
    "dry_run": true
  }' | jq .
```

**Expected Response**:
```json
{
  "dry_run": true,
  "batch_size": 2,
  "months_selected": 2,
  "months": [
    {"year": 2023, "month": 12, "status": "pending"},
    {"year": 2023, "month": 11, "status": "pending"}
  ],
  "total_pending": 300,
  "total_processing": 0,
  "total_completed": 0,
  "total_failed": 0
}
```

### 3. Small Live Test (1-2 Months)

Once dry run succeeds, test with actual processing:

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H "X-Cron-Secret: YOUR_SECRET_HERE" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "batch_size": 2,
    "year_range": {"start": 2023, "end": 2023},
    "dry_run": false
  }' | jq .
```

**Monitor Progress**:
```bash
# Check backfill_log status
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  status,
  COUNT(*) as count,
  MAX(started_at) as last_started,
  MAX(completed_at) as last_completed
FROM backfill_log
GROUP BY status;
\""

# Watch Worker logs
npm run tail
```

### 4. Verify Results

After 5-10 minutes, check completion:

```sql
-- Check specific months processed
SELECT
  year,
  month,
  status,
  books_generated,
  isbns_resolved,
  resolution_rate,
  retry_count,
  error_message,
  started_at,
  completed_at
FROM backfill_log
WHERE year = 2023 AND month IN (11, 12)
ORDER BY month DESC;

-- Check overall progress
SELECT
  status,
  COUNT(*) as months,
  SUM(books_generated) as total_books,
  SUM(isbns_resolved) as total_isbns,
  ROUND(AVG(CASE WHEN resolution_rate > 0 THEN resolution_rate END)::numeric, 2) as avg_resolution
FROM backfill_log
GROUP BY status;
```

---

## Expected Performance (2023 Data)

Based on production recommendations:

- **Books generated per month**: ~20 (after deduplication)
- **ISBN resolution rate**: 90-95% (2023 has good ISBNdb coverage)
- **Processing time per month**: 30-60 seconds
- **ISBNdb calls per month**: ~20-40 calls (~0.3% of daily quota)

**For 2 months**:
- Total books: ~40
- Total ISBNs: ~36-38
- ISBNdb quota used: ~40-80 calls (0.6% of 13K daily limit)
- Time: 1-2 minutes

---

## Troubleshooting

### Issue: "Unauthorized: Invalid or missing X-Cron-Secret"

**Cause**: Incorrect secret value
**Fix**: Get correct value from Cloudflare dashboard

### Issue: Dry run works but no months processed

**Possible causes**:
1. `dry_run: true` flag still set (check request body)
2. All months already completed (check `SELECT COUNT(*) FROM backfill_log WHERE status = 'pending'`)
3. Year range doesn't match pending months

### Issue: Months stuck in "processing" status

**Cause**: Queue consumer crash or timeout
**Fix**:
```sql
-- Reset stuck processing entries (after 1 hour)
UPDATE backfill_log
SET status = 'pending', retry_count = retry_count + 1
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '1 hour';
```

### Issue: High failure rate on retries

**Cause**: Could be various (quota exhaustion, API timeouts, constraint violations)
**Fix**: Check `error_message` column:
```sql
SELECT year, month, error_message, retry_count
FROM backfill_log
WHERE status IN ('failed', 'retry')
ORDER BY year DESC, month DESC;
```

---

## Production Rollout Plan

Once testing confirms the fix works:

### Phase 1: Validation (Days 1-2)
- Schedule 5 months/day from 2023
- Target: Verify 90%+ ISBN resolution
- Monitor for any retry/failure patterns

### Phase 2: Recent Years (Days 3-21)
- Increase to 10-15 months/day
- Process 2020-2023 (48 months)
- Expected: 3-4 days for full coverage

### Phase 3: Historical (Days 22-42)
- Process 15-20 months/day
- Cover 2000-2019 (240 months)
- Expected: 12-16 days for full coverage

**Total timeline**: 20-25 days for complete 300-month backfill

---

## Monitoring Checklist

Daily checks during rollout:

- [ ] Check completion rate: `SELECT status, COUNT(*) FROM backfill_log GROUP BY status`
- [ ] Verify resolution rates: `SELECT AVG(resolution_rate) FROM backfill_log WHERE status = 'completed'`
- [ ] Monitor ISBNdb quota: `curl https://alexandria.ooheynerds.com/api/quota/status | jq .data.percentage_used`
- [ ] Check for failures: `SELECT COUNT(*) FROM backfill_log WHERE status = 'failed'`
- [ ] Review stuck processing: `SELECT COUNT(*) FROM backfill_log WHERE status = 'processing' AND started_at < NOW() - INTERVAL '1 hour'`

---

## Secret Management Recommendation

**For better security**, migrate `ALEXANDRIA_WEBHOOK_SECRET` from Worker Secrets to Secrets Store:

1. Get current value from dashboard
2. Add to Secrets Store (same as other API keys)
3. Update `wrangler.jsonc`:
   ```json
   {
     "binding": "ALEXANDRIA_WEBHOOK_SECRET",
     "store_id": "b0562ac16fde468c8af12717a6c88400",
     "secret_name": "ALEXANDRIA_WEBHOOK_SECRET"
   }
   ```
4. Redeploy worker
5. Delete old Worker Secret

This aligns with how other secrets (ISBNDB, GEMINI, XAI) are managed.

---

## References

- **Fix Documentation**: `docs/fixes/BACKFILL_TIMESTAMP_FIX_2026-01-13.md`
- **Scheduler Code**: `worker/src/routes/backfill-scheduler.ts`
- **Queue Consumer**: `worker/src/services/async-backfill.ts`
- **Migration**: `worker/migrations/014_reset_failed_backfill_entries.sql`
