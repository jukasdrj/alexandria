# Gemini Prompt A/B Testing - Implementation Complete

**Date**: 2026-01-07
**Status**: Ready for experiments

## What's Been Implemented

### 1. Database Schema ✅

Created three tables in PostgreSQL for experiment tracking:

- **`experiment_runs`**: Track each experiment with prompt text, model, year/month, dry_run flag
- **`experiment_results`**: Aggregated metrics (hit rate, dedup breakdown, costs, confidence levels)
- **`experiment_samples`**: Sample ISBNs for quality review (first 20 per experiment)

**Helper Views**:
- `experiment_summary`: Aggregated results by experiment name
- `top_performing_experiments`: Best performers ranked by hit rate

**Location**: `docs/experiments/experiment-tracking-schema.sql`

### 2. Dry-Run Mode ✅

Modified backfill endpoint to support dry-run testing:

**New Parameters**:
```typescript
{
  dry_run: boolean          // Skip ISBNdb enrichment, return only dedup analysis
  experiment_id: string     // Optional experiment identifier (e.g., "diversity-v1")
  prompt_override: string   // Optional custom prompt to test
}
```

**Behavior**:
- When `dry_run=true`:
  - Calls Gemini API (generates ISBNs)
  - Runs 3-tier deduplication (exact/related/fuzzy)
  - Skips ISBNdb enrichment (saves quota)
  - Skips month completion recording
  - Returns full dedup breakdown + Gemini stats

**Response Includes**:
```json
{
  "dry_run": true,
  "experiment_id": "baseline-test",
  "stats": {
    "total_isbns": 100,
    "valid_isbns": 95,
    "invalid_isbns": 5,
    "high_confidence": 80,
    "low_confidence": 15,
    "unknown_confidence": 5,
    "duplicate_exact": 45,
    "duplicate_related": 20,
    "duplicate_fuzzy": 15,
    "new_isbns": 20,
    ...
  }
}
```

### 3. Prompt Override Support ✅

Modified `generateCuratedBookList()` in `gemini-backfill.ts`:
- Accepts optional `promptOverride` parameter
- Uses override if provided, otherwise uses default `buildMonthlyPrompt()`
- Allows testing different prompts without code changes

### 4. Prompt Variants Documented ✅

Created 6 prompt variants for testing (`docs/experiments/PROMPT-VARIANTS.md`):

- **Variant A (Baseline)**: Current broad-coverage prompt
- **Variant B (Diversity-Emphasis)**: Non-English, indie publishers, regional presses
- **Variant C (Overlooked-Significance)**: Culturally significant non-bestsellers
- **Variant D (Genre-Rotation)**: Deep per-genre coverage
- **Variant E (Era-Contextualized)**: Decade-specific framing
- **Variant F (ISBN-Format-Aware)**: Explicit ISBN-10/13 guidance per era

## How to Run Experiments

### Test Dry-Run Mode

**Note**: Gemini API calls take 30-90 seconds. Use longer timeout:

```bash
curl --max-time 120 -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2015,
    "month": 3,
    "dry_run": true,
    "experiment_id": "baseline-test"
  }'
```

**Alternative**: Monitor via worker logs (doesn't timeout):
```bash
# In one terminal, start tailing
npx wrangler tail --format pretty

# In another terminal, trigger experiment
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{"year":2015,"month":3,"dry_run":true,"experiment_id":"baseline"}'
```

### Test with Custom Prompt

```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2015,
    "month": 3,
    "dry_run": true,
    "experiment_id": "diversity-v1",
    "prompt_override": "Generate 100 ISBNs of books from March 2015...[full prompt text]"
  }'
```

### Record Results to Database

After each experiment, manually insert results (or create helper script):

```sql
-- Insert experiment run
INSERT INTO experiment_runs (id, experiment_name, prompt_text, model, year, month, dry_run, created_at)
VALUES ('uuid-here', 'baseline-2015', 'prompt text...', 'gemini-2.5-flash', 2015, 3, true, NOW());

-- Insert results
INSERT INTO experiment_results (
  run_id, isbns_generated, valid_isbns, invalid_isbns,
  high_confidence_count, low_confidence_count, unknown_confidence_count,
  dedup_exact, dedup_related, dedup_fuzzy, new_isbns,
  enriched_count, covers_queued, gemini_calls, isbndb_calls, total_api_calls,
  duration_ms
) VALUES (
  'uuid-here', 100, 95, 5, 80, 15, 5, 45, 20, 15, 20, 0, 0, 1, 0, 1, 45000
);
```

## Recommended Experiment Sequence

### Phase 1: Baseline (2 runs)

```bash
# 1. June 2005 (early era)
curl -X POST ... -d '{"year":2005,"month":6,"dry_run":true,"experiment_id":"baseline-2005-06"}'

# 2. March 2015 (modern era)
curl -X POST ... -d '{"year":2015,"month":3,"dry_run":true,"experiment_id":"baseline-2015-03"}'
```

### Phase 2: Variants on June 2005 (5 runs)

Test all 5 variants (B-F) on same month for direct comparison.

### Phase 3: Variants on March 2015 (5 runs)

Test all 5 variants on modern era.

### Phase 4: Analysis

```sql
-- Compare all variants
SELECT * FROM experiment_summary
WHERE year IN (2005, 2015)
ORDER BY avg_hit_rate DESC;

-- Find top performers
SELECT * FROM top_performing_experiments LIMIT 10;
```

### Phase 5: Winner Selection

1. Highest hit rate (new_isbns / total)
2. Lowest exact dedup % (avoiding bestsellers)
3. Invalid ISBNs <15%
4. Cross-era consistency

### Phase 6: Quality Review

Manually review first 20 ISBNs from top 2 variants:
- Historical/cultural significance (1-5)
- Publisher diversity
- Language/geographic diversity

### Phase 7: Full Enrichment Validation

Test winner on 2 new months with `dry_run=false`:
```bash
curl -X POST ... -d '{"year":2010,"month":9,"experiment_id":"winner-validation"}'
```

## Cost Estimates

**Per Dry-Run Experiment**:
- Gemini API: ~$0.003 (500 input tokens + 8K output tokens)
- ISBNdb: 0 calls (dry-run skips enrichment)

**Total for 12 Dry-Runs**: ~$0.04

**Full Enrichment Validation** (2 runs):
- Gemini: ~$0.006
- ISBNdb: ~200 calls (for quality review)

## Success Criteria

**Minimum Success**:
- 15% avg hit rate on test months
- Quality score >3.5/5
- Winner generalizes to 2+ unseen months

**Stretch Goal**:
- 20%+ hit rate
- 5+ languages per sample
- Geographic diversity across publishers

## Next Steps

1. ✅ Infrastructure complete
2. ✅ Dry-run mode implemented
3. ✅ Prompt variants documented
4. ⏸️ **PAUSED**: Awaiting approval to run experiments
5. ⏱️ Run 12 dry-run experiments (baseline + 5 variants × 2 eras)
6. ⏱️ Analyze results and select winner
7. ⏱️ Quality review top 2 variants
8. ⏱️ Full enrichment validation
9. ⏱️ Deploy winning prompt to production

## Files Modified

- `worker/src/routes/harvest.ts` - Added dry_run, experiment_id, prompt_override params
- `worker/src/services/gemini-backfill.ts` - Added promptOverride parameter
- Database: Added 3 tables + 2 views for experiment tracking

## Files Created

- `docs/experiments/experiment-tracking-schema.sql`
- `docs/experiments/PROMPT-VARIANTS.md`
- `docs/experiments/IMPLEMENTATION-COMPLETE.md` (this file)

## Infrastructure Status

✅ Database tables created
✅ Worker deployed (Version: 95d92b23-dd72-4eff-8511-f5b43ac8fa0c)
✅ Dry-run mode functional
✅ Prompt override working
✅ Ready for experimentation

---

**Ready to proceed with experiments when approved.**
