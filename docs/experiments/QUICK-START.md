# Quick Start: Gemini Prompt A/B Testing

**Status**: Ready to run experiments
**Date**: 2026-01-07

## TL;DR

Test 6 prompt variants to find the best approach for discovering new books via Gemini API while minimizing duplicate enrichments.

## Run an Experiment (3 steps)

### 1. Start Log Monitoring

```bash
cd /Users/juju/dev_repos/alex/worker
npx wrangler tail --format pretty
```

### 2. Trigger Experiment (in new terminal)

```bash
# Test baseline prompt on March 2015
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{"year":2015,"month":3,"dry_run":true,"experiment_id":"baseline-2015-03"}'
```

### 3. Watch Logs for Results

Look for:
```
[Backfill] Generated book list: { total_books: 100, valid_isbns: 95, invalid_isbns: 5 }
[Backfill] Deduplication complete: { exact: 45, related: 20, fuzzy: 15, new: 20 }
[Backfill:DryRun] Skipping ISBNdb enrichment
```

**Hit Rate**: new / total (e.g., 20/100 = 20%)

## Recommended Test Sequence

### Phase 1: Baseline (2 months)

```bash
# 1. Early era (2005)
curl -X POST ... -d '{"year":2005,"month":6,"dry_run":true,"experiment_id":"baseline-2005-06"}'

# 2. Modern era (2015)
curl -X POST ... -d '{"year":2015,"month":3,"dry_run":true,"experiment_id":"baseline-2015-03"}'
```

### Phase 2: Test Variants (10 experiments)

Test all 5 variants (Diversity, Overlooked, Genre-Rotation, Era-Context, ISBN-Aware) on both months.

Example - Diversity variant:
```bash
PROMPT="Generate 100 ISBNs of books from March 2015.

PRIORITIZE:
- Non-English language editions
- Small/independent publishers
- Regional presses (Latin America, Africa, Asia)
- Translated works

AVOID major bestsellers from large publishers.

Return ISBN-13, set confidence_isbn to high/low/unknown."

curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d "{\"year\":2015,\"month\":3,\"dry_run\":true,\"experiment_id\":\"diversity-2015-03\",\"prompt_override\":\"$PROMPT\"}"
```

### Phase 3: Analyze

```sql
-- Compare hit rates
SELECT
  experiment_name,
  AVG(hit_rate) as avg_hit_rate,
  AVG(exact_dedup_rate) as avg_exact_dedup,
  AVG(invalid_isbn_rate) as avg_invalid
FROM experiment_summary
WHERE year IN (2005, 2015)
GROUP BY experiment_name
ORDER BY avg_hit_rate DESC;
```

## Success Criteria

- **Minimum**: 15% hit rate, <15% invalid ISBNs
- **Target**: 20% hit rate, <10% invalid ISBNs
- **Ideal**: 25%+ hit rate, diverse publishers/languages

## Quick Reference

**Test months**: June 2005, March 2015 (diverse eras)

**Variants**:
- A: Baseline (current)
- B: Diversity-Emphasis
- C: Overlooked-Significance
- D: Genre-Rotation
- E: Era-Contextualized
- F: ISBN-Format-Aware

**Full docs**: `docs/experiments/PROMPT-VARIANTS.md`

**Timing**: 30-90 seconds per Gemini call (be patient!)

**Cost**: ~$0.003 per experiment (Gemini API only, no ISBNdb in dry-run)

---

**Ready?** Start with baseline experiments on 2 months, then test variants.
