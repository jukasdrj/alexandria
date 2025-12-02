# Wrangler Configuration Migration: TOML → JSONC

**Date**: 2025-12-01
**Status**: ✅ COMPLETE

## Summary

Migrated Alexandria Worker configuration from `wrangler.toml` to `wrangler.jsonc` format, with optimizations for the Cloudflare Workers **Paid Plan**.

## Changes

### Configuration Format
- **Before**: `worker/wrangler.toml` (TOML format)
- **After**: `worker/wrangler.jsonc` (JSON with comments)
- **Backup**: `worker/wrangler.toml.backup`

### New Features Added (Paid Plan Optimizations)

#### 1. **Extended CPU Limits**
```jsonc
"limits": {
  "cpu_ms": 300000  // 5 minutes (vs 50ms free tier)
}
```
- Enables complex database queries
- Allows heavy image processing
- Better for multi-step enrichment workflows

#### 2. **Smart Placement**
```jsonc
"placement": {
  "mode": "smart"
}
```
- Automatically places Worker closer to origin (Unraid server)
- Reduces latency for database queries
- Optimizes for tunnel connection

#### 3. **Full Observability**
```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 1.0
}
```
- 100% log sampling (vs limited on free tier)
- Complete request tracing
- Better debugging and monitoring

#### 4. **Multiple Analytics Engine Datasets**
```jsonc
"analytics_engine_datasets": [
  { "binding": "ANALYTICS", "dataset": "alexandria_performance" },
  { "binding": "QUERY_ANALYTICS", "dataset": "alexandria_queries" },
  { "binding": "COVER_ANALYTICS", "dataset": "alexandria_covers" }
]
```
- Separate metrics for different aspects
- Better query performance analysis
- Cover processing tracking

#### 5. **Queue-Based Background Processing**
```jsonc
"queues": {
  "producers": [{
    "binding": "ENRICHMENT_QUEUE",
    "queue": "alexandria-enrichment-queue"
  }],
  "consumers": [{
    "queue": "alexandria-enrichment-queue",
    "max_batch_size": 10,
    "max_batch_timeout": 30,
    "max_retries": 3,
    "dead_letter_queue": "alexandria-enrichment-dlq",
    "max_concurrency": 5
  }]
}
```
- Asynchronous cover processing
- Metadata enrichment without blocking requests
- Automatic retries with DLQ

#### 6. **Enhanced Environment Variables**
```jsonc
"vars": {
  "DB_MAX_CONNECTIONS": "20",
  "CACHE_TTL_LONG": "86400",
  "ENABLE_QUERY_CACHE": "true",
  "ENABLE_PERFORMANCE_LOGGING": "true",
  // ... many more optimizations
}
```

### Compatibility Updates

#### Updated to `nodejs_compat_v2`
```jsonc
"compatibility_flags": ["nodejs_compat_v2"]
```
- Better Node.js compatibility
- Improved postgres library support
- Future-proof for new Node.js features

### Migration Benefits

1. **Schema Validation**: IDE autocomplete with `$schema`
2. **Better Comments**: JSONC allows inline documentation
3. **Type Safety**: JSON structure is more explicit
4. **Industry Standard**: JSON is Cloudflare's recommended format
5. **Paid Plan Features**: All new features require paid plan

## Verification

Tested configuration with dry-run:
```bash
cd worker/
npx wrangler deploy --dry-run
```

All bindings verified:
- ✅ Hyperdrive (PostgreSQL)
- ✅ KV Namespace (CACHE)
- ✅ R2 Bucket (COVER_IMAGES)
- ✅ Secrets Store (ISBNDB_API_KEY, GOOGLE_BOOKS_API_KEY)
- ✅ Analytics Engine (3 datasets)
- ✅ Queues (ENRICHMENT_QUEUE)

## Rollback (if needed)

To revert to the old configuration:
```bash
cd worker/
mv wrangler.toml.backup wrangler.toml
rm wrangler.jsonc
```

## Next Steps

1. **Deploy to production**:
   ```bash
   npm run deploy
   ```

2. **Monitor observability**:
   - Check Cloudflare dashboard for logs
   - Verify 100% sampling rate
   - Review Analytics Engine datasets

3. **Test queue processing**:
   - Submit enrichment jobs
   - Verify queue consumers processing
   - Check DLQ for failed jobs

4. **Optimize based on metrics**:
   - Use query analytics to identify slow queries
   - Adjust cache TTLs based on hit rates
   - Fine-tune queue concurrency

## Documentation Updates

Updated files:
- ✅ `CLAUDE.md` - Configuration section with wrangler.jsonc examples
- ✅ `CLAUDE.md` - Bindings reference updated to JSON format
- ✅ `worker/wrangler.jsonc` - New configuration with full comments

## Notes

- The `"//"` comment warnings in wrangler output are expected and harmless
- All existing bindings retained with same IDs/names
- No changes to Worker code required
- Queue and Analytics Engine datasets will be created on first deploy

## Cost Implications

Paid Plan features used:
- Extended CPU limits (300s)
- Smart placement
- Full observability (100% sampling)
- Multiple Analytics Engine datasets
- Queue processing

**Ensure Cloudflare account is on Workers Paid Plan before deploying.**
