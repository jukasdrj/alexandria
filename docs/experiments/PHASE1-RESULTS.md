# Phase 1 Experiment Results - June 2024

**Date**: January 7, 2026
**Model**: gemini-2.5-flash (default)
**Test Month**: June 2024
**Mode**: Dry-run (no database updates)

## Results Table

| Exp ID | Prompt Variant | Books Generated | ISBNs Resolved | Resolution % | Gemini Calls | ISBNdb Calls | Total Calls | Duration |
|--------|---------------|-----------------|----------------|--------------|--------------|--------------|-------------|----------|
| exp-001 | **Baseline** ✅ | 20 | 18 | **90%** | 1 | 20 | 21 | 46.3s |
| exp-002 | Enriched Context | 0 | 0 | 0% | 1 | 0 | 1 | 5.8s |
| exp-003 | Structured Output | 0 | 0 | 0% | 1 | 0 | 1 | 3.6s |
| exp-004 | Confidence Calibrated | 3 | 3 | **100%** | 1 | 3 | 4 | 8.1s |
| exp-005 | Conservative | 0 | 0 | 0% | 1 | 0 | 1 | 8.1s |
| exp-006 | Aggressive ✅ | 4 | 4 | **100%** | 1 | 4 | 5 | 10.8s |

## Analysis

### 🏆 Winners

**1. Baseline (exp-001)** - CLEAR WINNER
- 20 books generated, 18 resolved (90% success rate)
- Highest throughput
- Best balance of quantity and quality

**2. Aggressive (exp-006)** - Runner-up
- 4 books generated, 4 resolved (100% success rate)
- Lower volume but perfect accuracy
- May be useful for high-confidence-only scenarios

**3. Confidence Calibrated (exp-004)** - Honorable mention
- 3 books generated, 3 resolved (100% success rate)
- Similar to aggressive but even more conservative

### ⚠️ Failures

**Prompt Override Issues**: exp-002, exp-003, exp-005 generated **0 books**

This indicates the `prompt_override` parameter values don't match actual prompt variants in the system. These experiments failed because:
- The system expected actual prompt text, not variant names
- Need to check `docs/experiments/PROMPT-VARIANTS.md` for correct prompt text
- Or implement prompt variant registry in code

## Key Findings

### What Worked
✅ **Baseline prompt** - 90% resolution rate, 20 books
✅ **Gemini → ISBNdb hybrid workflow** - Successfully resolves ISBNs
✅ **Dry-run mode** - All experiments completed without database writes
✅ **Experiment tracking** - Full metrics captured

### What Didn't Work
❌ **Prompt override mechanism** - Needs actual prompt text, not variant names
❌ **Several prompt variants** - Generated 0 books (likely prompt formatting issues)

### Performance
- **Fastest**: exp-003 (3.6s) - but generated 0 books
- **Slowest**: exp-001 (46.3s) - but generated 20 books
- **API efficiency**: Baseline used 21 calls for 18 successful ISBNs

## Recommendations

### Immediate Actions
1. **Fix prompt override mechanism**:
   - Option A: Implement prompt variant registry (map names → full prompts)
   - Option B: Document that users must provide full prompt text

2. **Re-run failed experiments** with correct prompts

3. **Use baseline for production** - Clear winner with 90% success rate

### For Production Deployment
- ✅ Use **baseline prompt** (current default)
- ✅ Use **gemini-2.5-flash** model
- ✅ Target months: 2024 and earlier (better ISBNdb coverage)
- ⏭️ Skip prompt variants until override mechanism is fixed

## Next Steps

**Phase 2: Model Comparison** (BLOCKED)
- Need to fix prompt override first
- Then test gemini-3-flash-preview vs gemini-2.5-flash

**Phase 3: Historical Range** (READY)
- Can proceed with baseline prompt across different years
- Test 2010, 2017, 2023 with baseline

## Cost Summary

- **Total Gemini calls**: 6 (1 per experiment)
- **Total ISBNdb calls**: 27 (only for successful generations)
- **Estimated cost**: ~$0.05 (Gemini API only, ISBNdb in quota)
- **Success rate**: 1 out of 6 variants worked properly

---

**Conclusion**: Baseline prompt is production-ready with 90% ISBN resolution. Other variants need investigation.
