# ISBNdb Automated Cron Jobs - Disabled 2026-01-19

**Date**: 2026-01-19
**Action**: Disabled all automated ISBNdb API calls via Cloudflare Workers cron triggers
**Reason**: Preserve ISBNdb quota - stop automated consumption

---

## Summary of Changes

All automated cron jobs that consume ISBNdb quota have been disabled by commenting out the cron triggers in `worker/wrangler.jsonc`.

### Before (Active Crons)
```jsonc
"triggers": {
  "crons": [
    "0 0 * * *",  // Midnight UTC - Synthetic enhancement
    "0 2 * * *"   // 2 AM UTC - Cover harvest + Wikidata enrichment
  ]
}
```

### After (Disabled Crons)
```jsonc
"triggers": {
  "crons": [
    // DISABLED 2026-01-19: Stop automated ISBNdb calls to preserve quota
    // "0 0 * * *",  // Synthetic enhancement (ISBNdb)
    // "0 2 * * *"   // Cover harvest (ISBNdb) + Wikidata enrichment
  ]
}
```

---

## Disabled Cron Jobs

### 1. Synthetic Enhancement Cron (`0 0 * * *`)
**Handler**: `handleScheduledSyntheticEnhancement()` in `worker/src/routes/enhancement-cron.ts:271`

**ISBNdb Usage**: ~500 API calls per day
- Resolves ISBNs via ISBNdb title/author search
- Enhances synthetic works created during quota exhaustion
- Upgrades completeness_score from 30 → 80

**Manual Alternative**:
```bash
curl -X POST https://alexandria.ooheynerds.com/api/internal/enhance-synthetic-works \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  --data-raw '{"batch_size":500,"dry_run":false}'
```

### 2. Cover Harvest Cron (`0 2 * * *`)
**Handler**: `handleScheduledCoverHarvest()` in `worker/src/routes/harvest.ts:341`

**ISBNdb Usage**: Variable (depends on batch size)
- Harvests book metadata from ISBNdb
- Downloads cover images
- Populates enriched_editions table

**Note**: This cron also ran `handleScheduledWikidataEnrichment()` which does NOT use ISBNdb (free Wikidata API only). However, both were disabled together since they ran in the same cron schedule.

---

## Files Modified

1. **worker/wrangler.jsonc** - Commented out cron triggers
2. **docs/operations/CRON_CONFIGURATION.md** - Updated status to DISABLED
3. **CLAUDE.md** - Updated Synthetic Works Enhancement section to reflect disabled cron
4. **This file** - Created summary documentation

---

## Verification

**No Automated ISBNdb Calls**: With empty crons array, Cloudflare Workers will not trigger any scheduled events. All ISBNdb calls are now manual-only via:
- Direct API endpoint calls (POST /api/enrich/*, POST /api/harvest/*, etc.)
- Manual webhook triggers (POST /api/internal/enhance-synthetic-works)
- Queue consumer handlers (triggered by manual queue sends only)

**Queue Consumers Still Active**: Queue consumers are NOT disabled - they only process messages when:
1. User manually triggers enrichment (POST /api/enrich/batch-direct)
2. Manual webhook calls (POST /api/internal/enhance-synthetic-works)
3. Manual backfill operations (POST /api/harvest/backfill)

No automated background processes will send messages to queues now that crons are disabled.

---

## How to Re-Enable (If Needed)

1. **Uncomment cron triggers** in `worker/wrangler.jsonc`:
```jsonc
"triggers": {
  "crons": [
    "0 0 * * *",  // Midnight UTC - Synthetic enhancement
    "0 2 * * *"   // 2 AM UTC - Cover harvest + Wikidata enrichment
  ]
}
```

2. **Deploy to Cloudflare**:
```bash
cd worker/
npx wrangler deploy
```

3. **Verify deployment**:
```bash
npx wrangler deployments list
npx wrangler deployments view <deployment-id>
```

Expected output should show:
```
Triggers:
  schedule: 0 0 * * *
  schedule: 0 2 * * *
```

4. **Update documentation** - Remove "DISABLED" notices from:
   - `docs/operations/CRON_CONFIGURATION.md`
   - `CLAUDE.md`

---

## Impact Assessment

### Immediate Impact
- ✅ **Zero automated ISBNdb quota consumption** - All quota preserved for manual operations
- ✅ **No data loss** - All handlers are still functional, just not triggered automatically
- ✅ **Manual operations unaffected** - Webhooks and direct API calls still work

### Long-Term Impact
- ⚠️ **Synthetic works won't auto-enhance** - 76 existing synthetic works will remain at completeness_score=30 until manually enhanced
- ⚠️ **No automatic cover harvesting** - New books won't get covers automatically
- ⚠️ **Wikidata enrichment stopped** - Author biographies won't be enriched automatically (even though Wikidata is free, it was tied to the same cron schedule)

### Recommendations
1. **Monitor synthetic works backlog** - Manually trigger enhancement when needed
2. **Consider re-enabling Wikidata cron separately** - It's free and doesn't consume ISBNdb quota
3. **Evaluate quota needs** - If ISBNdb quota is replenished, re-enable crons in priority order:
   - Priority 1: Synthetic enhancement (clears backlog)
   - Priority 2: Cover harvest (improves user experience)

---

## Related Documentation

- **Complete cron configuration**: `docs/operations/CRON_CONFIGURATION.md`
- **Synthetic enhancement flow**: `docs/features/SYNTHETIC_WORKS_ENRICHMENT_FLOW.md`
- **Quota management**: `docs/operations/QUOTA_EXHAUSTION_HANDLING.md`
- **Project overview**: `CLAUDE.md`
