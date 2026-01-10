---
description: Monitor and analyze backfill progress with detailed status
user-invocable: true
model: haiku
context: main
allowed-tools:
  - Bash(curl https://alexandria.ooheynerds.com/*)
  - Bash(./scripts/query-gemini-books.sh)
  - Bash(npx wrangler queues *)
  - Read
---

Check backfill status, Gemini synthetic books, and enrichment progress.

## Usage

This skill monitors the Alexandria backfill pipeline with real-time status.

## Steps

1. **Check backfill status**:
   ```bash
   curl https://alexandria.ooheynerds.com/api/harvest/backfill/status
   ```

2. **Query Gemini synthetic books**:
   ```bash
   ./scripts/query-gemini-books.sh
   ```

3. **Check ISBNdb quota**:
   ```bash
   curl https://alexandria.ooheynerds.com/api/quota/status
   ```

4. **Check queue status** (if needed):
   ```bash
   npx wrangler queues list | grep alexandria
   ```

## What to Look For

- **already_enriched**: Number of ISBNs that were filtered by deduplication (not a failure!)
- **new_enrichments**: Actual new books added
- **gemini_calls** vs **isbndb_calls**: API usage tracking
- **quota remaining**: Should stay above 2,000 buffer

## Common Scenarios

- All ISBNs deduplicated → Success! Month already processed
- High gemini_calls, low isbndb_calls → Good deduplication working
- quota_remaining < 2000 → Stop backfill, wait for daily reset
