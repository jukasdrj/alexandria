# Grok (x.ai) Refusal Behavior Analysis

**Date:** 2026-01-13
**Context:** Phase 1 backfill validation (2020-09 processing)
**Issue:** Grok declined to generate books for September 2020

---

## The Refusal

During Phase 1 backfill testing, Grok (x.ai) returned an explicit refusal instead of generating 20 books:

```json
{
  "error": "Unable to generate a list of exactly 20 notable books verifiably published in September 2020 that meet the strict contemporary acclaim criteria without fabricating data. Verified sources (NYT bestsellers, Publishers Weekly, award lists) confirm fewer than 20 such releases. Examples include 'The Searcher' by Tana French (Viking, 10/6 hardcover, NYT bestseller), but not precisely September. Suggest broadening criteria."
}
```

### What Happened

1. **Request:** Generate 20 notable books from September 2020 using `contemporary-notable` prompt
2. **Gemini Response:** Generated 20 books successfully (25s processing time)
3. **Grok Response:** Refused after 1.95s, citing inability to verify 20 books

---

## Why This Happened

### Grok's Conservative Approach

Grok is programmed to **prioritize factual accuracy** over completeness. When asked for exactly 20 books, it:

1. Searches verified sources (NYT bestsellers, Publishers Weekly, award lists)
2. Finds fewer than 20 books that meet strict criteria for September 2020
3. **Refuses to fabricate** data to reach the count
4. Provides a thoughtful explanation with an example

### The Prompt Requirement

The `contemporary-notable` prompt includes:

```
Generate a curated list of exactly 20 notable books published in September 2020.
Focus on releases that were recognized, acclaimed, or commercially successful
AT THE TIME OF PUBLICATION based on verifiable contemporary sources.
```

**Strict criteria:**
- NYT Bestsellers from that month/quarter
- Award shortlists/finalists announced around that time
- High critical acclaim from major outlets

### The Reality Check

Grok is **correct** - September 2020 likely had fewer than 20 books meeting all criteria:
- Mid-pandemic publishing slowdown
- Delayed book releases
- Reduced award ceremonies
- Lower review volumes

---

## Comparison: Grok vs Gemini

| Aspect | Grok (x.ai) | Gemini (Google) |
|--------|-------------|-----------------|
| **Philosophy** | Conservative, refuses to hallucinate | Compliant, generates requested count |
| **Response Time** | 1.95s (failed fast) | 25s (completed) |
| **Data Quality** | High confidence in what it returns | Variable confidence (ISBN resolution validates) |
| **Transparency** | Explicit refusal with reasoning | Generates without caveat |
| **Production Use** | Better for factual accuracy | Better for comprehensive coverage |

### The Trade-off

**Grok's Refusal:**
- ✅ Prevents hallucinated/fabricated books
- ✅ Provides transparent reasoning
- ❌ Reduces backfill coverage
- ❌ Requires manual prompt adjustment

**Gemini's Compliance:**
- ✅ Achieves requested book count
- ✅ 96.25% ISBN resolution validates most books
- ❌ May include less-notable books to reach count
- ❌ Less transparent about confidence

---

## Code Fix Applied

**File:** `worker/lib/external-services/providers/xai-provider.ts`

**Before:**
```typescript
const parsed = JSON.parse(sanitized);

if (Array.isArray(parsed)) {
  books = parsed;
} else if (parsed.books && Array.isArray(parsed.books)) {
  books = parsed.books;
} else {
  logger.error('Unexpected x.ai response format', { content });
  return [];
}
```

**After:**
```typescript
const parsed = JSON.parse(sanitized);

// Check if Grok refused to generate (deliberate error response)
if (parsed.error) {
  logger.warn('x.ai declined to generate books', {
    reason: parsed.error,
    prompt_summary: prompt.substring(0, 100) + '...',
  });
  return [];
}

if (Array.isArray(parsed)) {
  books = parsed;
} else if (parsed.books && Array.isArray(parsed.books)) {
  books = parsed.books;
} else {
  logger.error('Unexpected x.ai response format', { content });
  return [];
}
```

**Change:**
- Now logs refusals as `warn` (deliberate) instead of `error` (unexpected)
- Captures the refusal reason for debugging
- Gracefully returns empty array (triggers fallback to Gemini-only)

---

## Recommendations

### For Production Backfill

**Current Strategy (Concurrent):**
- ✅ Keep running Gemini + Grok concurrently
- ✅ Grok's refusals don't block Gemini
- ✅ When Grok succeeds, deduplication provides diversity
- ✅ When Grok refuses, Gemini provides coverage

**No changes needed** - The system already handles this gracefully via concurrent execution.

### For Future Prompts

If we want Grok to participate more, consider:

**Option 1: Flexible count**
```
Generate up to 20 notable books from September 2020, but only include books
you can verify from contemporary sources. It's acceptable to return fewer
than 20 if that's more accurate.
```

**Option 2: Broader criteria**
```
Generate 20 notable books from September-October 2020 (2-month window)
to account for publishing date variations.
```

**Option 3: Lower threshold**
```
Generate 10 notable books from September 2020 (Grok may accept this)
```

### For Model Selection

**Use Gemini for:**
- Historical months (2000-2019) where verification is harder
- Comprehensive coverage requirements
- Cost-sensitive operations

**Use Grok for:**
- Recent years (2020+) where verification is critical
- Quality over quantity requirements
- Fact-checking Gemini's output

---

## Impact on Phase 1 Results

**2020-09 Backfill:**
- Grok: 0 books (refused)
- Gemini: 20 books (succeeded)
- **Final result:** 20 books generated, 0 duplicates removed

**System Behavior:**
✅ Concurrent execution meant Gemini's success was sufficient
✅ Deduplication handled the single-provider scenario correctly
✅ Zero data loss from Grok's refusal

---

## Conclusion

Grok's refusal is **not a bug** - it's a feature reflecting different AI model philosophies:

- **Grok:** "I won't make up data to satisfy your request"
- **Gemini:** "I'll generate what you asked for and let ISBN resolution validate it"

Both approaches are valid. The concurrent execution strategy captures the **best of both worlds**:
- Grok's refusals don't block progress
- Grok's successes add verified diversity
- Gemini provides comprehensive baseline coverage

**No system changes required** - This is working as designed.
