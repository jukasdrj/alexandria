# Issue #150: Dry-Run Validation Plan - Execution Guide

**Status**: Ready for Phase 1
**Date**: 2026-01-07
**Issue**: https://github.com/jukasdrj/alexandria/issues/150

## Overview

This guide walks through executing the A/B testing experiments defined in issue #150 to validate the Gemini backfill system before production deployment.

## Prerequisites

✅ Gemini API Key configured in Cloudflare Secrets
✅ Worker deployed with experiment parameters support
✅ #149 Worker OOM fix deployed
✅ Prompt variants documented (`PROMPT-VARIANTS.md`)

## API Endpoint

**POST** `https://alexandria.ooheynerds.com/api/harvest/backfill`

### Request Parameters

```json
{
  "year": 2025,                    // Required: Year to test (2005-2030)
  "month": 1,                      // Required: Month to test (1-12)
  "dry_run": true,                 // Set true for experiments (no DB updates)
  "experiment_id": "exp-001-baseline",  // Track experiment
  "batch_size": 20,                // Number of books to generate (default: 20)
  "prompt_override": null,         // null = baseline, or variant name
  "model_override": null,          // null = gemini-2.5-flash
  "max_quota": 100                 // Quota budget limit (prevents overruns)
}
```

### Response (202 Accepted)

```json
{
  "success": true,
  "job_id": "uuid-here",
  "year": 2025,
  "month": 1,
  "status": "queued",
  "message": "Dry-run experiment queued. No database updates will be made.",
  "status_url": "/api/harvest/backfill/status/uuid-here",
  "experiment_id": "exp-001-baseline",
  "dry_run": true
}
```

## Phase 1: Baseline Validation (6 Experiments)

Test all 6 prompt variants with January 2025 using `gemini-2.5-flash`:

### Experiment 1: Baseline (Control)

```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2025,
    "month": 1,
    "dry_run": true,
    "experiment_id": "exp-001-baseline",
    "max_quota": 100
  }'
```

**Expected metrics:**
- Valid ISBNs: 85-95%
- New ISBN %: 10-20%
- Gemini calls: 1
- ISBNdb calls: 0 (dry-run)

### Experiment 2: Enriched Context

```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2025,
    "month": 1,
    "dry_run": true,
    "experiment_id": "exp-002-enriched",
    "prompt_override": "enriched-context",
    "max_quota": 100
  }'
```

### Experiment 3: Structured Output Focus

```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2025,
    "month": 1,
    "dry_run": true,
    "experiment_id": "exp-003-structured",
    "prompt_override": "structured-output",
    "max_quota": 100
  }'
```

### Experiment 4: Confidence Calibrated

```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2025,
    "month": 1,
    "dry_run": true,
    "experiment_id": "exp-004-confidence",
    "prompt_override": "confidence-calibrated",
    "max_quota": 100
  }'
```

### Experiment 5: Conservative

```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2025,
    "month": 1,
    "dry_run": true,
    "experiment_id": "exp-005-conservative",
    "prompt_override": "conservative",
    "max_quota": 100
  }'
```

### Experiment 6: Aggressive

```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2025,
    "month": 1,
    "dry_run": true,
    "experiment_id": "exp-006-aggressive",
    "prompt_override": "aggressive",
    "max_quota": 100
  }'
```

## Monitoring Experiments

### Check Job Status

```bash
# Get job ID from the 202 response, then poll status
curl https://alexandria.ooheynerds.com/api/harvest/backfill/status/<job_id> | jq
```

**Status response:**

```json
{
  "job_id": "uuid",
  "year": 2025,
  "month": 1,
  "status": "complete",
  "progress": "Experiment complete",
  "stats": {
    "gemini_books_generated": 20,
    "valid_isbns": 19,
    "invalid_isbns": 1,
    "exact_dedup_matches": 8,
    "related_dedup_matches": 4,
    "fuzzy_dedup_matches": 3,
    "new_isbns": 4,
    "new_isbn_percentage": 21.05,
    "gemini_calls": 1,
    "isbndb_calls": 0,
    "total_api_calls": 1,
    "quota_used": 1
  },
  "experiment_id": "exp-001-baseline",
  "dry_run": true,
  "prompt_variant": "baseline",
  "model_used": "gemini-2.5-flash",
  "created_at": "2026-01-07T20:00:00.000Z",
  "completed_at": "2026-01-07T20:01:30.000Z",
  "duration_ms": 90000
}
```

### Live Monitoring

```bash
# Terminal 1: Watch logs
cd /Users/juju/dev_repos/alex/worker
npm run tail

# Terminal 2: Run experiments
# (use curl commands above)
```

## Recording Results

### Results Table Template

| Exp ID | Prompt | Model | Valid ISBNs | New % | ISBNdb Hit % | Quota Used | Winner? |
|--------|--------|-------|-------------|-------|--------------|------------|---------|
| exp-001 | Baseline | 2.5-flash | ? | ? | N/A (dry-run) | ? | ? |
| exp-002 | Enriched | 2.5-flash | ? | ? | N/A (dry-run) | ? | ? |
| exp-003 | Structured | 2.5-flash | ? | ? | N/A (dry-run) | ? | ? |
| exp-004 | Confidence | 2.5-flash | ? | ? | N/A (dry-run) | ? | ? |
| exp-005 | Conservative | 2.5-flash | ? | ? | N/A (dry-run) | ? | ? |
| exp-006 | Aggressive | 2.5-flash | ? | ? | N/A (dry-run) | ? | ? |

### Key Metrics to Record

From each status response, record:

1. **Generation Quality**
   - `valid_isbns` / (`valid_isbns` + `invalid_isbns`) = **Valid ISBN %**

2. **Discovery Rate**
   - `new_isbns` / (`valid_isbns`) = **New ISBN %** (PRIMARY METRIC)

3. **Deduplication Breakdown**
   - `exact_dedup_matches` - Already in enriched_editions
   - `related_dedup_matches` - In related_isbns jsonb field
   - `fuzzy_dedup_matches` - Title similarity match

4. **Efficiency**
   - `quota_used` - API calls consumed
   - `duration_ms` - Processing time

## Success Criteria

### Minimum Requirements
- ✅ **>15% new ISBNs discovered**
- ✅ **<10% invalid ISBNs** (checksum failures)
- ✅ **Accurate quota tracking** (no overruns)

### Target Goals
- 🎯 **>20% new ISBNs** (1 in 5 books is new)
- 🎯 **<5% invalid ISBNs**
- 🎯 **Fast processing** (<120s per experiment)

## Phase 2: Model Comparison (3 Experiments)

**After Phase 1 completes**, test the best-performing prompt with all 3 models:

```bash
# Test with gemini-2.5-flash (baseline)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "month": 12,
    "dry_run": true,
    "experiment_id": "exp-007-flash-best",
    "prompt_override": "[best-variant-from-phase-1]",
    "max_quota": 200
  }'

# Test with gemini-3-flash-preview
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "month": 12,
    "dry_run": true,
    "experiment_id": "exp-008-flash3-best",
    "prompt_override": "[best-variant-from-phase-1]",
    "model_override": "gemini-3-flash-preview",
    "max_quota": 200
  }'

# Test with gemini-3-pro-preview
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "month": 12,
    "dry_run": true,
    "experiment_id": "exp-009-pro3-best",
    "prompt_override": "[best-variant-from-phase-1]",
    "model_override": "gemini-3-pro-preview",
    "max_quota": 200
  }'
```

## Phase 3: Historical Range (3 Experiments)

Test best model + prompt across different time periods:

```bash
# Old era (2010)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2010,
    "month": 6,
    "dry_run": true,
    "experiment_id": "exp-010-old",
    "prompt_override": "[best-variant]",
    "model_override": "[best-model]",
    "max_quota": 300
  }'

# Mid era (2017)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2017,
    "month": 3,
    "dry_run": true,
    "experiment_id": "exp-011-mid",
    "prompt_override": "[best-variant]",
    "model_override": "[best-model]",
    "max_quota": 300
  }'

# Recent era (2023)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2023,
    "month": 9,
    "dry_run": true,
    "experiment_id": "exp-012-recent",
    "prompt_override": "[best-variant]",
    "model_override": "[best-model]",
    "max_quota": 300
  }'
```

## Troubleshooting

### Experiment Stuck in "processing"

```bash
# Check worker logs
npm run tail | grep -E "(Backfill|Experiment|Error)"

# Check quota status
curl https://alexandria.ooheynerds.com/api/quota/status | jq
```

### Invalid ISBNs >10%

- Switch to "conservative" prompt variant
- Use `model_override: "gemini-3-pro-preview"` for better accuracy

### Low New ISBN % (<15%)

- Try "diversity-emphasis" or "overlooked-significance" variants
- Test different time periods (older books may have less coverage)

## Next Steps

After all experiments complete:

1. **Analyze Results** - Fill in the results table in issue #150
2. **Select Winner** - Best prompt + model combination
3. **Update Code** - Set winner as default in `gemini-backfill.ts`
4. **Enable Production** - Remove `dry_run: true`, start historical backfill
5. **Monitor** - Track production metrics for 2 weeks

## Reference

- **Issue #150**: https://github.com/jukasdrj/alexandria/issues/150
- **Prompt Variants**: `docs/experiments/PROMPT-VARIANTS.md`
- **API Docs**: `docs/api/API-SEARCH-ENDPOINTS.md`
- **Model Configuration**: `worker/src/services/gemini-backfill.ts:76-86`

---

**Cost Estimate**: ~$0.10-0.20 for all 12 experiments (Gemini API only, ISBNdb not called in dry-run)

**Timeline**: ~2-3 hours (including monitoring and recording results)

**Ready to start?** Begin with Phase 1, Experiment 1 (Baseline).
