# Issue #186 Testing Instructions

## Quick Start

I've created a helper script to test the author backfill endpoint. You need to provide the `ALEXANDRIA_WEBHOOK_SECRET` which is stored securely in Cloudflare.

### Step 1: Retrieve the Webhook Secret

The secret is stored in Cloudflare Workers but not retrievable via CLI. You'll need to either:

**Option A: Check your secure password manager or notes**
- You set this secret when you first configured the Worker
- It should be stored alongside other Alexandria credentials

**Option B: Create a new test secret**
```bash
# Generate a new secure secret
NEW_SECRET=$(openssl rand -base64 32)
echo "New webhook secret: $NEW_SECRET"

# Update Cloudflare Workers secret
cd worker
echo "$NEW_SECRET" | npx wrangler secret put ALEXANDRIA_WEBHOOK_SECRET

# Export for testing
export ALEXANDRIA_WEBHOOK_SECRET="$NEW_SECRET"
```

### Step 2: Run Dry Run Test (5 works)

```bash
# Set the secret (use your actual secret)
export ALEXANDRIA_WEBHOOK_SECRET="your-secret-here"

# Run dry run test
./scripts/test-author-backfill.sh 5 true
```

**Expected Output**:
```
════════════════════════════════════════════════════════════════
  Alexandria Author Backfill Test (Issue #186)
════════════════════════════════════════════════════════════════

✓ Webhook secret configured
→ API URL: https://alexandria.ooheynerds.com
→ Batch size: 5 works
→ Dry run: true

Sending request...

✓ Request successful (HTTP 200)

════════════════════════════════════════════════════════════════
  Results
════════════════════════════════════════════════════════════════

{
  "works_processed": 5,
  "authors_linked": 7,
  "openlib_direct_hits": 0,
  "external_api_hits": 4,
  "failed": 1,
  "api_calls_used": {
    "openlib": 12,
    "google_books": 3,
    "archive_org": 0,
    "wikidata": 0
  },
  "duration_ms": 18234,
  "dry_run": true,
  "errors": [
    {
      "isbn": "9798762979771",
      "work_key": "/works/isbndb-abc123",
      "error": "No authors found via any provider"
    }
  ]
}

════════════════════════════════════════════════════════════════
  Summary
════════════════════════════════════════════════════════════════

Works Processed:      5
Authors Linked:       7
OpenLibrary Direct:   0
External API Hits:    4
Failed:               1
Duration:             18.23 seconds

Success Rate:         80.0%

ℹ This was a DRY RUN - no database changes were made

To run a live test with 10 works:
  ./scripts/test-author-backfill.sh 10 false

✓ Test complete!
```

### Step 3: Run Live Test (10 works)

**After validating dry run results:**

```bash
# Run live test (will update database)
./scripts/test-author-backfill.sh 10 false
```

### Step 4: Validate Results

Check if Harry Potter now has authors:

```bash
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873' | jq '.data.authors'
```

**Expected Before Backfill**:
```json
[]
```

**Expected After Backfill**:
```json
[
  {
    "name": "J.K. Rowling",
    "author_key": "/authors/OL27695A",
    "openlibrary": "https://openlibrary.org/authors/OL27695A",
    ...
  }
]
```

---

## Alternative: Manual Testing with curl

If you prefer to test manually without the script:

```bash
# Set your secret
export ALEXANDRIA_WEBHOOK_SECRET="your-secret-here"

# Dry run test
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/backfill-author-works' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"batch_size":5,"dry_run":true}' | jq

# Live test
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/backfill-author-works' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"batch_size":10,"dry_run":false}' | jq
```

---

## Troubleshooting

### Error: "Unauthorized: Invalid or missing X-Cron-Secret"

**Cause**: The `ALEXANDRIA_WEBHOOK_SECRET` environment variable is not set or doesn't match the Cloudflare Workers secret.

**Solution**:
1. Check if the variable is set: `echo $ALEXANDRIA_WEBHOOK_SECRET`
2. Verify you're using the correct secret from your secure storage
3. If needed, create a new secret (see Option B above)

### Error: "No authors found via any provider"

**Cause**: Some works genuinely lack author data across all providers.

**Action**: This is expected for ~10-20% of works. Not a bug.

### High Failure Rate (>30%)

**Cause**: Possible API issues or rate limiting.

**Action**:
1. Check Worker logs: `npm run tail | grep "author backfill"`
2. Wait 5 minutes and retry
3. If persistent, create a GitHub issue

---

## Next Steps After Testing

Once you've validated the first 10 works successfully:

1. **Monitor Progress**:
   ```bash
   # Check remaining works
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
   SELECT COUNT(*) as remaining
   FROM enriched_works ew
   LEFT JOIN author_works aw ON ew.work_key = aw.work_key
   WHERE ew.primary_provider = 'isbndb' AND aw.work_key IS NULL;
   \""
   ```

2. **Start Production Backfill**:
   - See `docs/operations/AUTHOR-BACKFILL-GUIDE.md` for full rollout strategies
   - Recommended: 1,000 works/day (10 batches × 100 works)
   - Duration: 76 days

3. **Track Coverage Improvement**:
   ```sql
   SELECT
     ROUND(100.0 * COUNT(DISTINCT aw.work_key) / COUNT(DISTINCT ew.work_key), 2) as coverage_pct
   FROM enriched_works ew
   LEFT JOIN author_works aw ON ew.work_key = aw.work_key
   WHERE ew.primary_provider = 'isbndb';
   ```

---

**Implementation Complete**: January 14, 2026
**Deployment Version**: a252ae55-a16e-43df-8201-605ff6e334e7
**Documentation**: `docs/operations/AUTHOR-BACKFILL-GUIDE.md`
