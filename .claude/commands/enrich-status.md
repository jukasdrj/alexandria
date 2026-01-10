---
description: Comprehensive status check for queues, enrichment, backfill, and covers
user-invocable: true
model: haiku
context: main
allowed-tools:
  - Bash(ssh root@Tower.local *)
  - Bash(curl *)
  - Bash(cd worker && npx wrangler *)
  - Bash(echo *)
---

Check comprehensive status of Alexandria's queue and enrichment systems including enriched tables, queue health, backfill progress, cover harvest, and author enrichment.

## Steps

### 1. Check Enriched Table Status

```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  'enriched_editions' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN updated_at > NOW() - INTERVAL '1 hour' THEN 1 END) as updated_1h,
  COUNT(CASE WHEN updated_at > NOW() - INTERVAL '24 hours' THEN 1 END) as updated_24h,
  COUNT(CASE WHEN cover_url_large IS NOT NULL THEN 1 END) as has_covers
FROM enriched_editions
UNION ALL
SELECT
  'enriched_works',
  COUNT(*),
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END),
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END),
  NULL
FROM enriched_works
UNION ALL
SELECT
  'enriched_authors',
  COUNT(*),
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END),
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END),
  COUNT(CASE WHEN bio IS NOT NULL AND bio != '' THEN 1 END)
FROM enriched_authors;
\""
```

### 2. Check Enrichment Activity (Last 7 Days)

```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  entity_type,
  operation,
  provider,
  COUNT(*) as operations,
  COUNT(CASE WHEN success THEN 1 END) as successful,
  COUNT(CASE WHEN NOT success THEN 1 END) as failed,
  MAX(created_at) as last_activity,
  ROUND(AVG(response_time_ms)) as avg_ms
FROM enrichment_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY entity_type, operation, provider
ORDER BY MAX(created_at) DESC
LIMIT 20;
\""
```

### 3. Check Queue Status (API)

```bash
echo "=== Queue Status from API ===" && \
curl -s -m 10 "https://alexandria.ooheynerds.com/health" | jq '{status: .data.status, database: .data.database, latency: .meta.latencyMs}' && \
echo -e "\n=== Backfill Progress ===" && \
curl -s -m 15 "https://alexandria.ooheynerds.com/api/harvest/backfill/status" | jq '{summary: .summary, next_target: .next_target, incomplete_years: (.incomplete_years | length)}' && \
echo -e "\n=== ISBNdb Quota ===" && \
curl -s -m 10 "https://alexandria.ooheynerds.com/api/quota/status" | jq '{used, remaining, percentage_used, can_make_calls}'
```

### 4. Check Queue Status (Wrangler CLI)

```bash
cd worker && npx wrangler queues list 2>&1 | grep -E "(alexandria|Queue)" | head -10
```

### 5. Check Author Enrichment Status

```bash
curl -s -m 10 "https://alexandria.ooheynerds.com/api/authors/enrich-status" | jq .
```

### 6. Check Recent Enriched Books (Sample)

```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  isbn,
  title,
  primary_provider,
  created_at,
  CASE WHEN cover_url_large IS NOT NULL THEN 'yes' ELSE 'no' END as has_cover
FROM enriched_editions
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 10;
\""
```

### 7. Check Cover Statistics

```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  COUNT(*) as total_editions,
  COUNT(CASE WHEN cover_url_large IS NOT NULL THEN 1 END) as with_covers,
  ROUND(100.0 * COUNT(CASE WHEN cover_url_large IS NOT NULL THEN 1 END) / COUNT(*), 2) as coverage_pct,
  COUNT(CASE WHEN cover_url_large IS NOT NULL AND updated_at > NOW() - INTERVAL '24 hours' THEN 1 END) as covers_added_24h
FROM enriched_editions;
\""
```

## Report Format

Generate a comprehensive status report with:

### Database Status
- **Enriched Tables**: Row counts for editions, works, authors
- **Recent Activity**: 1h and 24h activity counts
- **Coverage Stats**: Cover availability, author biographies

### Queue Health
- **Worker Health**: API response, database connectivity
- **Queue Status**: Message counts for all 3 queues
- **Queue Consumers**: Active consumer count

### Enrichment Activity (7 Days)
- **Total Operations**: Breakdown by entity type (edition/work/author)
- **Success Rate**: Calculate percentage
- **Providers**: ISBNdb, OpenLibrary, etc.
- **Performance**: Average response times

### Backfill Progress
- **Years Status**: Completed vs incomplete
- **Books Enriched**: Total count from backfill
- **Next Target**: Upcoming year/month
- **Quota Usage**: API calls consumed

### Cover Harvest
- **Total Coverage**: Percentage of editions with covers
- **Recent Activity**: Covers added in last 24h
- **Storage**: R2 bucket status

### Author Enrichment
- **Wikidata Coverage**: Authors with IDs
- **Biography Coverage**: Authors with bios
- **Pending Enrichment**: Count waiting for Wikidata

### ISBNdb Quota
- **Used**: Current usage
- **Remaining**: Available calls
- **Percentage**: Usage percentage
- **Status**: Can make calls (yes/no)

### Recent Books Sample
- List 5-10 recently enriched books with:
  - ISBN, title, provider
  - Creation date
  - Cover availability

### Issues & Warnings
- Highlight any:
  - Failed operations (>0%)
  - Quota concerns (>80%)
  - Stale data (no activity >24h)
  - Dead letter queue messages
  - Performance degradation

### Summary
- Overall system health: ✅ Operational / ⚠️ Degraded / ❌ Down
- Key metrics summary
- Recommendations (if any)

**Note**:
- enriched_editions uses `updated_at` for tracking activity (upsert pattern)
- enriched_works and enriched_authors use `created_at`
- Cover harvest is async - check both database and API status
