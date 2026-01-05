# Alexandria Harvesting Runbook

**Last Updated:** January 5, 2026

## Overview

This runbook provides repeatable procedures for harvesting book metadata using Alexandria's **direct sync endpoint approach** (Option B). These endpoints make simple HTTP calls that can be run manually, via cron jobs, or through GitHub Actions.

### Why Option B?

The direct sync approach is preferred over Cloudflare Workflows because:
- Simple HTTP calls that can be tested and debugged easily
- No 1000 subrequest limit issues
- Works reliably without complex state management
- Can be triggered manually or automated

---

## Table of Contents

1. [Available Endpoints](#available-endpoints)
2. [Harvesting Strategies](#harvesting-strategies)
3. [Quick Start Guide](#quick-start-guide)
4. [ISBNdb API Budget & Rate Limits](#isbndb-api-budget--rate-limits)
5. [Monitoring & Verification](#monitoring--verification)
6. [Automation Options](#automation-options)
7. [Troubleshooting](#troubleshooting)

---

## Available Endpoints

### 1. New Releases by Date Range

**Endpoint:** `POST /api/books/enrich-new-releases`

**Purpose:** Harvest books published in a specific date range from ISBNdb.

**Request:**
```json
{
  "start_month": "2025-01",
  "end_month": "2025-12",
  "max_pages_per_month": 20,
  "skip_existing": true,
  "subjects": ["fiction", "mystery"]  // Optional: filter by subjects
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "start_month": "2025-01",
    "end_month": "2025-12",
    "months_processed": 12,
    "total_books_found": 24000,
    "already_existed": 1200,
    "newly_enriched": 22800,
    "covers_queued": 18500,
    "failed": 0,
    "api_calls": 240,
    "duration_ms": 450000,
    "quota_status": {
      "used_today": 240,
      "remaining": 14760,
      "limit": 15000,
      "buffer_remaining": 12760
    }
  }
}
```

**Key Features:**
- Auto-skips ISBNs already in Alexandria (set `skip_existing: true`)
- Handles quota exhaustion gracefully (returns partial results)
- Rate-limited internally (350ms between API calls)
- Queues cover downloads automatically

**Use Cases:**
- Catching up on recent releases (e.g., all of 2025)
- Monthly maintenance to stay current
- Genre-specific harvesting (using subjects filter)

---

### 2. Author Bibliography Enrichment

**Endpoint:** `POST /api/authors/enrich-bibliography`

**Purpose:** Fetch and enrich an author's complete bibliography from ISBNdb.

**Request:**
```json
{
  "author_name": "Brandon Sanderson",
  "max_pages": 10,
  "skip_existing": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "author_name": "Brandon Sanderson",
    "books_found": 856,
    "already_in_alexandria": 654,
    "newly_enriched": 202,
    "covers_queued": 180,
    "pages_fetched": 9,
    "api_calls_made": 9,
    "duration_ms": 35000,
    "quota_status": {
      "used_today": 9,
      "remaining": 14991,
      "limit": 15000,
      "buffer_remaining": 12991
    }
  }
}
```

**Key Features:**
- Fetches up to 100 books per page from ISBNdb
- Creates works and links to authors automatically
- Enriches editions, works, and author records
- Queues covers for background processing

**Use Cases:**
- Expanding coverage for prolific authors
- Filling gaps in OpenLibrary data
- Enriching specific authors requested by users

---

### 3. Direct ISBN Batch (up to 1000)

**Endpoint:** `POST /api/enrich/batch-direct`

**Purpose:** Enrich up to 1000 ISBNs in a single request.

**Request:**
```json
{
  "isbns": ["9780439064873", "9780547928227", "..."],
  "source": "manual"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "requested": 1000,
    "successful": 987,
    "already_existed": 13,
    "failed": 0,
    "covers_queued": 856,
    "duration_ms": 125000
  }
}
```

**Key Features:**
- Most efficient: 1 API call for up to 1000 ISBNs
- Bypasses Cloudflare Queue limitations
- Ideal for bulk imports from external sources

**Use Cases:**
- User-submitted book lists
- Library catalog imports
- One-time large batch enrichments

---

### 4. ISBNdb Quota Status

**Endpoint:** `GET /api/quota/status`

**Purpose:** Check current ISBNdb API quota usage.

**Response:**
```json
{
  "success": true,
  "data": {
    "used_today": 2450,
    "remaining": 12550,
    "limit": 15000,
    "buffer_remaining": 10550,
    "percentage_used": 18.8,
    "can_make_calls": true,
    "reset_at": "2026-01-06T00:00:00.000Z",
    "safety_threshold": 2000
  }
}
```

**Always check quota before large harvesting operations!**

---

## Harvesting Strategies

### Strategy A: Monthly New Releases (Recommended for Maintenance)

**Goal:** Stay current with newly published books

**Approach:** Run monthly for the current or past month

```bash
#!/bin/bash
# harvest-current-month.sh

MONTH=$(date +%Y-%m)
echo "Harvesting new releases for $MONTH..."

curl -s "https://alexandria.ooheynerds.com/api/books/enrich-new-releases" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"start_month\": \"$MONTH\",
    \"end_month\": \"$MONTH\",
    \"max_pages_per_month\": 50,
    \"skip_existing\": true
  }" | jq '.data'
```

**Budget:**
- 50 pages/month × 1 month = 50 API calls
- ~5,000 books per month
- Can harvest 12 months in one day (600 API calls < 15,000 daily limit)

**Schedule:** Run on the 1st of each month via cron

---

### Strategy B: Catch-Up Harvest (Year-to-Date)

**Goal:** Backfill recent releases not in OpenLibrary dump

**Approach:** Harvest multiple months at once, respecting quota

```bash
#!/bin/bash
# harvest-catchup-2025.sh

# Harvest 2025 in 4 batches to stay under quota
QUARTERS=(
  "2025-01 2025-03"  # Q1
  "2025-04 2025-06"  # Q2
  "2025-07 2025-09"  # Q3
  "2025-10 2025-12"  # Q4
)

for quarter in "${QUARTERS[@]}"; do
  START=$(echo $quarter | awk '{print $1}')
  END=$(echo $quarter | awk '{print $2}')

  echo "Harvesting $START to $END..."

  curl -s "https://alexandria.ooheynerds.com/api/books/enrich-new-releases" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{
      \"start_month\": \"$START\",
      \"end_month\": \"$END\",
      \"max_pages_per_month\": 50,
      \"skip_existing\": true
    }" | jq '.data'

  echo "Waiting 60 seconds before next quarter..."
  sleep 60
done

echo "Catch-up harvest complete!"
```

**Budget:**
- 50 pages/month × 12 months = 600 API calls
- ~60,000 books per year
- Single day operation

---

### Strategy C: Author Expansion

**Goal:** Enrich specific authors' bibliographies

**Approach:** Use existing `bulk-author-harvest.js` script

```bash
# Process top 1000 authors (breadth-first, 1 page per author)
node scripts/bulk-author-harvest.js --tier top-1000

# Process single author
node scripts/bulk-author-harvest.js --author "Brandon Sanderson"

# Resume from checkpoint after interruption
node scripts/bulk-author-harvest.js --resume

# Dry run (no API calls)
node scripts/bulk-author-harvest.js --dry-run --tier top-100
```

**Budget:**
- 1 page per author = 1 API call
- 1000 authors = 1000 API calls
- ~100,000 books harvested

**Features:**
- Checkpoint saving for resume capability
- Automatic quota coordination with Worker
- Progress logging every 100 authors
- Rate-limited to 10 req/min (Worker limit)

**Script location:** `scripts/bulk-author-harvest.js`

---

### Strategy D: Subject-Focused Harvesting

**Goal:** Target specific genres or subjects

**Approach:** Use subjects filter with new releases endpoint

```bash
#!/bin/bash
# harvest-fiction-2025.sh

SUBJECTS=("fiction" "mystery" "romance" "science fiction" "fantasy" "thriller")

for subject in "${SUBJECTS[@]}"; do
  echo "Harvesting 2025 $subject books..."

  curl -s "https://alexandria.ooheynerds.com/api/books/enrich-new-releases" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{
      \"start_month\": \"2025-01\",
      \"end_month\": \"2025-12\",
      \"max_pages_per_month\": 20,
      \"skip_existing\": true,
      \"subjects\": [\"$subject\"]
    }" | jq '.data'

  sleep 30
done
```

**Budget:**
- 20 pages/month × 12 months × 6 subjects = 1,440 API calls
- Better coverage through multiple perspectives

---

## Quick Start Guide

### Prerequisites

1. **Verify Alexandria is online:**
```bash
curl https://alexandria.ooheynerds.com/health | jq
```

2. **Check ISBNdb quota:**
```bash
curl https://alexandria.ooheynerds.com/api/quota/status | jq
```

3. **Ensure you have sufficient quota remaining** (>500 calls recommended for testing)

---

### Test Run: Small Harvest

Start with a small test to verify everything works:

```bash
# Test: Harvest 1 page of January 2025 books
curl -X POST "https://alexandria.ooheynerds.com/api/books/enrich-new-releases" \
  -H "Content-Type: application/json" \
  -d '{
    "start_month": "2025-01",
    "end_month": "2025-01",
    "max_pages_per_month": 1,
    "skip_existing": true
  }' | jq
```

**Expected result:**
- `success: true`
- `months_processed: 1`
- `api_calls: 1`
- ~100 books found (1 page)

---

### Production Run: Full Month

Once validated, scale up to a full month:

```bash
# Harvest all of January 2025 (up to 5,000 books)
curl -X POST "https://alexandria.ooheynerds.com/api/books/enrich-new-releases" \
  -H "Content-Type: application/json" \
  -d '{
    "start_month": "2025-01",
    "end_month": "2025-01",
    "max_pages_per_month": 50,
    "skip_existing": true
  }' | jq
```

---

### Monitor Progress

While harvest runs, monitor in separate terminal:

```bash
# Watch quota usage
watch -n 10 'curl -s https://alexandria.ooheynerds.com/api/quota/status | jq'

# Watch Worker logs (requires wrangler auth)
cd worker/
npm run tail
```

---

## ISBNdb API Budget & Rate Limits

### Premium Plan Specs

| Metric | Value |
|--------|-------|
| **Monthly Cost** | $29.95 |
| **Rate Limit** | 3 req/sec |
| **Daily Quota** | ~15,000 calls |
| **Batch Size** | 1000 ISBNs per POST |
| **API Endpoint** | `api.premium.isbndb.com` |
| **Quota Reset** | Daily at midnight UTC |
| **Rollover** | None (resets to 15,000 each day) |

### Important Notes

1. **API calls counted PER REQUEST, not per result**
   - 1 batch of 1000 ISBNs = 1 call
   - 1 page of 100 books = 1 call

2. **Safety buffer implemented**
   - Actual limit: 15,000
   - Alexandria enforces: 13,000 (2,000 buffer)
   - Prevents overages from race conditions

3. **Internal rate limiting**
   - All endpoints enforce 350ms delay between ISBNdb calls
   - Worker-level rate limit: 10 req/min for heavy endpoints

4. **Quota coordination**
   - Centralized tracking via `QUOTA_KV` namespace
   - Fail-closed on KV errors (safer to stop than overage)
   - Pre-flight checks before large operations

---

## Monitoring & Verification

### Check Harvest Results

```sql
-- Recent enrichment activity (last 7 days)
SELECT
  DATE_TRUNC('day', created_at) as day,
  COUNT(*) as enriched_count
FROM enriched_editions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Books enriched by publication month
SELECT
  LEFT(publication_date, 7) as pub_month,
  COUNT(*) as count
FROM enriched_editions
WHERE publication_date LIKE '2025-%'
GROUP BY 1
ORDER BY 1;

-- Total enriched vs OpenLibrary
SELECT
  'OpenLibrary' as source,
  COUNT(*) as count
FROM editions
UNION ALL
SELECT
  'Enriched' as source,
  COUNT(*) as count
FROM enriched_editions;
```

### Check Database Growth

```bash
# SSH into Unraid and check PostgreSQL
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
  SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE tablename IN ('enriched_editions', 'enriched_works', 'enriched_authors')
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
\""
```

### Monitor Cover Queue

```bash
# Check cover processing status
curl https://alexandria.ooheynerds.com/api/stats | jq '.data.covers'

# Check R2 bucket storage
npx wrangler r2 object list bookstrack-covers-processed --limit 10
```

### Worker Logs

```bash
# Live tail (requires wrangler auth)
cd worker/
npm run tail

# Filter for harvesting activity
npm run tail | grep -i "enrich\|cover\|quota"
```

---

## Automation Options

### Option 1: Cron Job (Recommended for Server)

Add to crontab for automated monthly harvesting:

```cron
# Run on 1st of each month at 3 AM UTC
0 3 1 * * /path/to/harvest-current-month.sh >> /var/log/alexandria-harvest.log 2>&1
```

**Setup:**
```bash
# 1. Create script
cat > /usr/local/bin/harvest-current-month.sh << 'EOF'
#!/bin/bash
MONTH=$(date +%Y-%m)
curl -X POST "https://alexandria.ooheynerds.com/api/books/enrich-new-releases" \
  -H "Content-Type: application/json" \
  -d "{\"start_month\":\"$MONTH\",\"end_month\":\"$MONTH\",\"max_pages_per_month\":50,\"skip_existing\":true}" \
  | jq
EOF

# 2. Make executable
chmod +x /usr/local/bin/harvest-current-month.sh

# 3. Add to crontab
crontab -e
# Add line: 0 3 1 * * /usr/local/bin/harvest-current-month.sh >> /var/log/alexandria-harvest.log 2>&1
```

---

### Option 2: GitHub Actions (Future - Issue #100)

See [TODO.md](../../TODO.md) Phase 6 for planned CI/CD automation.

**Planned features:**
- Scheduled workflow runs
- Manual trigger via workflow_dispatch
- Quota pre-checks
- Slack/Discord notifications
- Artifact uploads (logs, checkpoints)

---

### Option 3: Manual Runs

For ad-hoc or one-time harvests:

```bash
# Save this as harvest-helper.sh
#!/bin/bash

echo "Alexandria Harvest Helper"
echo "========================="
echo ""
echo "1. Check quota status"
echo "2. Harvest current month"
echo "3. Harvest specific month"
echo "4. Harvest year-to-date 2025"
echo "5. Process top 1000 authors"
echo ""
read -p "Select option: " option

case $option in
  1)
    curl -s https://alexandria.ooheynerds.com/api/quota/status | jq
    ;;
  2)
    MONTH=$(date +%Y-%m)
    echo "Harvesting $MONTH..."
    curl -X POST https://alexandria.ooheynerds.com/api/books/enrich-new-releases \
      -H "Content-Type: application/json" \
      -d "{\"start_month\":\"$MONTH\",\"end_month\":\"$MONTH\",\"max_pages_per_month\":50,\"skip_existing\":true}" | jq
    ;;
  3)
    read -p "Enter month (YYYY-MM): " MONTH
    echo "Harvesting $MONTH..."
    curl -X POST https://alexandria.ooheynerds.com/api/books/enrich-new-releases \
      -H "Content-Type: application/json" \
      -d "{\"start_month\":\"$MONTH\",\"end_month\":\"$MONTH\",\"max_pages_per_month\":50,\"skip_existing\":true}" | jq
    ;;
  4)
    echo "Harvesting 2025-01 to 2025-12..."
    curl -X POST https://alexandria.ooheynerds.com/api/books/enrich-new-releases \
      -H "Content-Type: application/json" \
      -d '{"start_month":"2025-01","end_month":"2025-12","max_pages_per_month":50,"skip_existing":true}' | jq
    ;;
  5)
    echo "Processing top 1000 authors..."
    cd "$(git rev-parse --show-toplevel)"
    node scripts/bulk-author-harvest.js --tier top-1000
    ;;
  *)
    echo "Invalid option"
    ;;
esac
```

---

## Troubleshooting

### Issue: Quota Exhausted

**Symptom:** Response includes `quota_exhausted: true`

**Solution:**
```bash
# Check quota status
curl https://alexandria.ooheynerds.com/api/quota/status | jq

# Wait for daily reset at midnight UTC
date -u

# OR reduce max_pages_per_month in request
```

---

### Issue: Rate Limited (429 errors)

**Symptom:** API returns 429 status code

**Causes:**
- ISBNdb rate limit (3 req/sec) exceeded
- Alexandria Worker rate limit triggered

**Solution:**
- Endpoints enforce 350ms delays automatically
- For bulk operations, use `batch-direct` endpoint (1 call for 1000 ISBNs)
- Reduce concurrent requests

---

### Issue: Network Timeouts

**Symptom:** Request hangs or times out

**Solution:**
```bash
# Check Worker health
curl https://alexandria.ooheynerds.com/health

# Check tunnel status
./scripts/tunnel-status.sh

# Expected: 4 connections
ssh root@Tower.local "docker exec alexandria-tunnel cloudflared tunnel info"
```

---

### Issue: Books Not Appearing in Search

**Symptom:** Harvest succeeds but books not found in `/api/search/combined`

**Diagnosis:**
```sql
-- Check if ISBN exists in enriched_editions
SELECT * FROM enriched_editions WHERE isbn = '9780439064873';

-- Check if work was created
SELECT * FROM enriched_works WHERE work_key = '<work_key>';
```

**Common causes:**
1. Cover queue still processing (can take time)
2. Search cache needs clearing (24h TTL for ISBN, 1h for title/author)
3. Work not linked to edition properly

**Solution:**
- Wait for cover processing to complete
- Query `/api/stats` to verify enrichment counts
- Check Worker logs for errors: `npm run tail`

---

### Issue: Checkpoint Resume Not Working

**Symptom:** `bulk-author-harvest.js --resume` fails

**Solution:**
```bash
# Check if checkpoint file exists
ls -lh data/bulk-author-checkpoint.json

# View checkpoint contents
cat data/bulk-author-checkpoint.json | jq

# Start fresh (backup old checkpoint)
mv data/bulk-author-checkpoint.json data/bulk-author-checkpoint.backup.json
node scripts/bulk-author-harvest.js --tier top-1000
```

---

### Issue: Covers Not Downloading

**Symptom:** `covers_queued` shows high count but no covers in R2

**Diagnosis:**
```bash
# Check cover queue status
npm run tail | grep -i "cover"

# Check R2 bucket
npx wrangler r2 object list bookstrack-covers-processed --limit 100

# Check queue consumer logs
npx wrangler tail --format pretty | grep "CoverQueue"
```

**Common causes:**
1. Cover URLs expired (2-hour limit from Google Books)
2. Queue consumer not running
3. Network errors to provider

**Solution:**
- Covers are queued for background processing (non-blocking)
- Re-queue failed covers: Use cover harvest endpoint
- Check queue configuration in `wrangler.jsonc`

---

## Best Practices

### 1. Always Pre-Check Quota

```bash
# Before any large harvest
QUOTA=$(curl -s https://alexandria.ooheynerds.com/api/quota/status | jq -r '.data.remaining')
echo "Remaining quota: $QUOTA"

if [ $QUOTA -lt 500 ]; then
  echo "Insufficient quota remaining"
  exit 1
fi
```

### 2. Use skip_existing: true

Avoids re-enriching books already in Alexandria, saving API calls.

### 3. Start Small, Scale Up

- Test with `max_pages_per_month: 1` first
- Verify results in database
- Scale to 20-50 pages for production

### 4. Monitor During Large Runs

```bash
# Terminal 1: Run harvest
./harvest-catchup-2025.sh

# Terminal 2: Monitor quota
watch -n 30 'curl -s https://alexandria.ooheynerds.com/api/quota/status | jq'

# Terminal 3: Watch logs
cd worker/
npm run tail | grep -i "enrich"
```

### 5. Save Logs for Auditing

```bash
# Timestamp and save harvest output
./harvest-current-month.sh | tee "logs/harvest-$(date +%Y%m%d-%H%M%S).log"
```

### 6. Use Checkpoints for Long Runs

Author harvesting script auto-saves progress every 100 authors:
- Located at `data/bulk-author-checkpoint.json`
- Resume with `--resume` flag
- Contains full state (tier, offset, stats)

---

## Summary

Alexandria's harvesting system provides three main approaches:

1. **New Releases** - Stay current with recent publications
2. **Author Bibliographies** - Expand coverage for specific authors
3. **Direct Batch** - Bulk import from external sources

All endpoints:
- Coordinate quota usage centrally
- Handle rate limiting automatically
- Support resume capability where applicable
- Queue covers for background processing
- Return detailed operation statistics

For automation, use cron jobs or GitHub Actions (planned). For one-time operations, use the provided shell scripts or manual curl commands.

**Related Documentation:**
- [API-SEARCH-ENDPOINTS.md](../api/API-SEARCH-ENDPOINTS.md) - Search API details
- [ISBNDB-ENDPOINTS.md](../api/ISBNDB-ENDPOINTS.md) - ISBNdb integration
- [TODO.md](../../TODO.md) - Roadmap and future automation plans
- [CURRENT-STATUS.md](../CURRENT-STATUS.md) - Current system status

**Related Scripts:**
- `scripts/bulk-author-harvest.js` - Author bibliography harvesting
- `scripts/tunnel-status.sh` - Infrastructure health check
- `scripts/deploy-worker.sh` - Worker deployment with validation

---

**Issue:** #99
**Status:** Complete - Option B (Direct Sync Approach)
**Next Steps:** Implement GitHub Actions automation (#100)
