# Prompt Override Mechanism Fix

**Date**: January 11, 2026
**Issue**: Phase 1 experiments (4/6) failed due to prompt override expecting full prompt text instead of variant names
**Status**: ✅ RESOLVED

## Problem

The original implementation of `prompt_override` in `gemini-backfill.ts` expected **full prompt text** to be passed, but the experiments were sending **variant names** like `"enriched-context"`, `"structured-output"`, etc.

### Impact

```bash
# What we sent (WRONG):
"prompt_override": "enriched-context"

# What the code expected (CORRECT):
"prompt_override": "You are a specialized bibliographic archivist. Generate..."
```

**Result**: 4 out of 6 Phase 1 experiments generated 0 books because invalid short names were passed to Gemini as prompts.

## Solution

Implemented a **prompt variant registry** that maps variant names to prompt builder functions, with backward compatibility for full prompt strings.

### Changes Made

1. **Added `PROMPT_VARIANTS` registry** (`gemini-backfill.ts:235-242`)
   - Maps variant names to builder functions
   - Supports all 6 documented variants from `PROMPT-VARIANTS.md`

2. **Created prompt builder functions** (`gemini-backfill.ts:336-521`)
   - `buildDiversityPrompt()` - Variant B
   - `buildOverlookedPrompt()` - Variant C
   - `buildGenrePrompt()` - Variant D
   - `buildEraPrompt()` - Variant E
   - `buildISBNFormatPrompt()` - Variant F

3. **Added `resolvePrompt()` helper** (`gemini-backfill.ts:769-797`)
   - Checks if input is a registered variant name
   - Falls back to treating input as full prompt text
   - Backward compatible with existing usage

4. **Updated tests** (`gemini-backfill.test.ts:125-191`)
   - 4 new tests validating variant registry
   - Tests variant name resolution
   - Tests prompt content differences
   - Tests era-specific prompt adaptation

## Supported Variants

Now you can use **either** variant names **or** full prompt text:

```bash
# Variant name (NEW - recommended)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "month": 6,
    "dry_run": true,
    "prompt_override": "diversity-emphasis"
  }'

# Full prompt text (ORIGINAL - still works)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "month": 6,
    "dry_run": true,
    "prompt_override": "Generate a curated list of..."
  }'
```

### Available Variant Names

1. **`baseline`** - Default (broad coverage: bestsellers, awards, debuts)
2. **`diversity-emphasis`** - Non-English, indie publishers, regional presses
3. **`overlooked-significance`** - Culturally significant but not bestsellers
4. **`genre-rotation`** - Deep per-genre coverage (currently Fiction)
5. **`era-contextualized`** - Adapts based on decade context
6. **`isbn-format-aware`** - Year-appropriate ISBN format guidance

## Testing

### Unit Tests

```bash
npm test -- --run src/services/__tests__/gemini-backfill.test.ts
```

**Results**: 20/20 tests passing (4 new tests added)

### Integration Test (Recommended)

Re-run Phase 1 experiments with fixed variant names:

```bash
# Experiment 2: Diversity Emphasis (was failing)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "month": 6,
    "dry_run": true,
    "experiment_id": "exp-002-diversity-fixed",
    "prompt_override": "diversity-emphasis",
    "max_quota": 100
  }'
```

**Expected**: 20 books generated (instead of 0)

## Deployment

**Version**: `ade1771f-4986-4a34-a5b8-8d926592cff3`
**Deployed**: January 11, 2026
**Worker Startup Time**: 108ms
**Upload Size**: 2177.09 KiB (gzip: 560.79 KiB)

## Next Steps

### Option A: Re-run Phase 1 (Recommended)

Now that variant names work correctly, re-run all 6 Phase 1 experiments to get complete comparison data:

```bash
# All variants will now work correctly
for variant in baseline diversity-emphasis overlooked-significance genre-rotation era-contextualized isbn-format-aware; do
  curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
    -H "Content-Type: application/json" \
    -d "{\"year\": 2024, \"month\": 6, \"dry_run\": true, \"experiment_id\": \"exp-rerun-$variant\", \"prompt_override\": \"$variant\", \"max_quota\": 100}"
  sleep 10
done
```

### Option B: Proceed with Baseline (Already Validated)

The baseline prompt already achieved 90% ISBN resolution. You can skip re-testing and proceed directly to production backfill.

## Benefits

1. ✅ **Easier A/B testing** - Use short variant names instead of copy/pasting prompts
2. ✅ **Type safety** - TypeScript autocomplete for variant names
3. ✅ **Consistency** - All variants defined in one place
4. ✅ **Backward compatible** - Existing full-prompt usage still works
5. ✅ **Extensible** - Easy to add new variants to the registry

## Technical Debt Resolved

This fix resolves the technical debt identified in the Phase 1 summary report (Issue #150). The prompt override mechanism now works as originally intended in the experiment design.

---

**Files Modified**:
- `worker/src/services/gemini-backfill.ts` - Added registry + variant builders
- `worker/src/services/__tests__/gemini-backfill.test.ts` - Added 4 new tests

**Issue Reference**: #150 (Dry-Run Validation Plan)
**Documentation**: `docs/experiments/PROMPT-VARIANTS.md`
