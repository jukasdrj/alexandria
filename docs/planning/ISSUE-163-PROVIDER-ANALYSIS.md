# Issue #163: Subject/Genre Coverage - Provider Analysis

**Date**: January 12, 2026
**Status**: Phase 3A Strategy Revised
**Analysis By**: Claude (Alexandria AI)

## Executive Summary

**DISCOVERY**: Before jumping to Gemini AI ($112-175), we have 3 untapped subject sources already integrated in the Service Provider Framework that could achieve 78-82% coverage for **$0**.

## Current State

- **Coverage**: 59% (19.5M / 33.1M works)
- **Gap**: 13.6M works without subjects
- **Target**: 80% (26.5M works)
- **Root Cause**: OpenLibrary source data lacks subjects for 41% of works (verified by Grok-4 investigation)

## Provider Capability Analysis

### ✅ Already Integrated Providers

| Provider | Capability Interface | Subject Source | Current Usage |
|----------|---------------------|----------------|---------------|
| **Google Books** | `ISubjectProvider` ✅ | `categories` field | Metadata fetch only |
| **Archive.org** | `IMetadataProvider` | Library of Congress subjects | ISBNdb enrichment only |
| **Wikidata** | `IMetadataProvider` | P136 (genre) property | ISBN lookups only |
| **ISBNdb** | `IMetadataProvider` | `subjects` field | Primary enrichment |

### 🔍 Detailed Provider Analysis

#### 1. Google Books API

**Interface**: `ISubjectProvider`, `IMetadataProvider`, `ICoverProvider`, `IISBNResolver`

**Subject Fields**:
```typescript
volumeInfo: {
  categories?: string[];  // e.g., ["Fiction", "Mystery", "Thriller"]
}
```

**Current Status**:
- ✅ Implemented in framework: `worker/lib/external-services/providers/google-books-provider.ts`
- ✅ Returns subjects via `fetchMetadata()` and `fetchSubjects()`
- ❌ **NOT used for subject-only backfill** (only during full metadata enrichment)

**Rate Limits**:
- Free tier: 1,000 requests/day
- With API key: Unlimited (can request quota increase to 10K-100K/day)

**Estimated Coverage**:
- Google Books covers ~60-70% of modern books (2000+)
- 13.6M works × 60% = **8.16M works** (upper bound)
- Conservative estimate: **5-7M works** (+15-17% coverage)
- Result: **59% → 74-76% coverage**

**Cost**: $0 (free with API key)

**Time Estimate**:
- At 1,000 req/day: 13.6M ÷ 1,000 = 13,600 days (37 years) 😱
- At 10,000 req/day: 13.6M ÷ 10,000 = 1,360 days (3.7 years)
- At 100,000 req/day: 13.6M ÷ 100,000 = 136 days (4.5 months) ⭐

**Action Required**:
1. Request Google Books API quota increase to 10K-100K req/day
2. Implement subject-only backfill job (don't need full metadata)
3. Target: 13.6M works without subjects

---

#### 2. Archive.org Metadata API

**Interface**: `IMetadataProvider`

**Subject Fields**:
```typescript
metadata: {
  subject?: string | string[];  // Library of Congress classifications
}
```

**Current Status**:
- ✅ Implemented: `worker/services/archive-org.ts` (Phase 2, Jan 10, 2026)
- ✅ Returns subjects via `fetchArchiveOrgMetadata()`
- ✅ Already merged into `enriched_works.subject_tags` during enrichment
- ❌ **Only enriches during ISBNdb flow** (not retroactive for 13.6M gap)

**Rate Limits**:
- Free: 1 req/sec (86,400 req/day)

**Estimated Coverage**:
- Archive.org excels at pre-2000 books and public domain works
- 13.6M works × 25% (pre-2000 estimate) = **3.4M works** (upper bound)
- Conservative estimate: **2-4M works** (+6-9% coverage)
- Result: **59% → 65-68% coverage**

**Cost**: $0 (free)

**Time Estimate**:
- At 86,400 req/day: 13.6M ÷ 86,400 = 157 days (5.2 months)

**Action Required**:
1. Implement retroactive Archive.org subject backfill for 13.6M gap
2. Can run in parallel with Google Books backfill
3. Focus on pre-2000 books for best ROI

---

#### 3. Wikidata SPARQL

**Interface**: `IMetadataProvider`, `ICoverProvider`, `IISBNResolver`

**Subject Fields**:
```sparql
OPTIONAL { ?book wdt:P136 ?genre . }  # Genre property
```

**Current Status**:
- ✅ Implemented: `worker/lib/external-services/providers/wikidata-provider.ts`
- ✅ Returns subjects via `fetchMetadata()`
- ❌ **Only 48 works in gap have Wikidata IDs** (Phase 2 finding)

**Estimated Coverage**:
- Phase 2 investigation found minimal crosswalk availability
- 48 works out of 13.6M = **0.0004% of gap**
- Result: Negligible impact

**Cost**: $0 (free)

**Verdict**: ❌ Not worth pursuing as standalone strategy for this gap

---

#### 4. ISBNdb Premium (Baseline)

**Current Coverage**: 73.55% (55,383 / 75,296 enriched works)

**Why not use for gap?**
- 13.6M works × $0.03/call = **$408,000** (prohibitively expensive)
- These works likely lack ISBNs or aren't in ISBNdb catalog
- Most of the 13.6M gap is from OpenLibrary source with no ISBN crosswalk

**Verdict**: ❌ Too expensive for gap closure

---

## Recommended Strategy Comparison

### Option A: External Providers First (RECOMMENDED)

**Phase 3A - Google Books + Archive.org** (3-6 months, $0):
1. Request Google Books API quota increase to 100K req/day
2. Implement subject-only backfill job targeting 13.6M works
3. Run Archive.org backfill in parallel (1 req/sec, pre-2000 focus)
4. Expected: **59% → 78-82% coverage**

**Phase 3B - Gemini Long-Tail** (Optional, 1 day, $30-50):
- Only for remaining 2-3M works after provider exhaustion
- Expected: **78-82% → 85%+ coverage**

**Total Cost**: $0-50 (vs $112-175 Gemini-only)
**Total Time**: 3-6 months (vs 2-3 days)
**Data Quality**: Real authoritative subjects (vs AI-generated)

### Option B: Gemini AI Only (Original Plan)

**Phase 3 - Gemini Genre Inference** (2-3 days, $112-175):
- AI-generated subjects for full 13.6M gap
- Few-shot prompting with validation
- Expected: **59% → 80% coverage**

**Total Cost**: $112-175
**Total Time**: 2-3 days
**Data Quality**: AI-generated (hallucination risk)

### Option C: Hybrid Immediate

**Phase 3 - Gemini + Google Books** (Parallel, 1 week, $112-175):
- Start Gemini AI immediately for 13.6M works
- Request Google Books quota increase for future maintenance
- Use Google Books for incremental improvements

**Total Cost**: $112-175 upfront
**Total Time**: 2-3 days (AI), ongoing (Google Books)
**Data Quality**: Mixed (AI + authoritative)

---

## Cost-Benefit Analysis

| Strategy | Coverage Gain | Cost | Time | Data Source | Risk |
|----------|---------------|------|------|-------------|------|
| **Google Books only** | +15-17% (→74-76%) | $0 | 4-5 months | Authoritative | Quota approval |
| **Archive.org only** | +6-9% (→65-68%) | $0 | 5 months | Library of Congress | Slow |
| **Both providers** | +19-23% (→78-82%) | $0 | 3-6 months | Authoritative | Quota approval |
| **Gemini AI (full)** | +21% (→80%) | $112-175 | 2-3 days | AI-generated | Hallucinations |
| **Gemini AI (long-tail)** | +3-7% after providers | $30-50 | <1 day | AI-generated | Minimal |
| **Hybrid immediate** | +21% (→80%) | $112-175 | 2-3 days + ongoing | Mixed | None |

---

## Recommendation

**RECOMMENDED**: Option A - External Providers First

**Rationale**:
1. **$0 cost** vs $112-175 for Gemini
2. **Real authoritative data** (Google Books categories, Library of Congress subjects)
3. **No hallucination risk** - subjects are from validated sources
4. **Leverages existing framework** - GoogleBooksProvider already implements ISubjectProvider
5. **78-82% coverage** vs 80% target (nearly equivalent)
6. **Gemini as fallback** - Can use AI for remaining long-tail ($30-50 vs $112-175)

**Tradeoff**: Time (3-6 months vs 2-3 days)

**When to use Gemini immediately**:
- If Google Books API quota increase rejected
- If 2-3 day timeline is critical business requirement
- If willing to pay $112-175 for speed

---

## Implementation Plan - Option A

### Step 1: Request Google Books API Quota Increase

**Goal**: Increase from 1,000 req/day → 100,000 req/day

**Process**:
1. Navigate to Google Cloud Console → APIs & Services → Quotas
2. Search for "Books API - Queries per day"
3. Request quota increase to 100,000
4. Justification: "Academic/library project enriching 13.6M book records with authoritative subject classifications"

**Timeline**: 2-7 days for approval

### Step 2: Implement Google Books Subject Backfill

**Files to modify**:
- `worker/src/services/subject-backfill.ts` (new)
- `worker/src/routes/internal.ts` (add endpoint)
- `worker/wrangler.jsonc` (add cron schedule)

**Logic**:
1. Query `enriched_works` WHERE `subject_tags IS NULL OR array_length(subject_tags, 1) = 0`
2. Batch fetch subjects via `GoogleBooksProvider.fetchSubjects()`
3. Update `enriched_works.subject_tags` with results
4. Track progress in KV
5. Respect rate limits (100K/day)

**Cron Schedule**:
- Daily at 3 AM UTC (after cover harvest, before author enrichment)
- Process 100,000 works/day (completes in 136 days)

### Step 3: Implement Archive.org Subject Backfill

**Files to modify**:
- `worker/src/services/subject-backfill.ts` (extend)
- `worker/wrangler.jsonc` (separate cron)

**Logic**:
1. Query `enriched_works` WHERE `subject_tags IS NULL AND publication_date < '2000-01-01'`
2. Resolve ISBN → Archive.org identifier via search API
3. Fetch metadata via `fetchArchiveOrgMetadata()`
4. Extract `subject` array (Library of Congress classifications)
5. Update `enriched_works.subject_tags`

**Cron Schedule**:
- Daily at 4 AM UTC (sequential after Google Books)
- Process 86,400 works/day (completes in 157 days)

### Step 4: Monitoring & Validation

**Metrics to track**:
- Works enriched per day (Google Books, Archive.org)
- Subject count per work (avg, median, P95)
- API quota usage (Google Books)
- Coverage percentage (daily calculation)
- Error rate (invalid ISBNs, API failures)

**Dashboard Query**:
```sql
SELECT
  COUNT(*) as total_works,
  COUNT(subject_tags) FILTER (WHERE array_length(subject_tags, 1) > 0) as works_with_subjects,
  ROUND(100.0 * COUNT(subject_tags) FILTER (WHERE array_length(subject_tags, 1) > 0) / COUNT(*), 2) as coverage_pct
FROM enriched_works;
```

**Success Criteria**:
- Coverage ≥ 78% after 6 months
- Error rate < 2%
- API quota not exhausted

---

## Next Actions

**Awaiting User Decision**:
1. ✅ Approve Option A (External Providers First) - $0, 3-6 months
2. ⏸️ Use Option B (Gemini AI Only) - $112-175, 2-3 days
3. 🔄 Hybrid: Start Gemini now, add Google Books later

**If Option A approved**:
1. [ ] Request Google Books API quota increase (2-7 days)
2. [ ] Implement Google Books subject backfill service
3. [ ] Implement Archive.org subject backfill service
4. [ ] Add monitoring dashboard
5. [ ] Deploy to production with cron schedules

---

## References

- **Issue**: #163 (Subject/Genre Coverage Improvement)
- **Phase 1**: Index rebuild (COMPLETE - Jan 12)
- **Phase 2**: Root cause investigation (COMPLETE - Jan 12, Grok-4 analysis)
- **Framework**: Service Provider Framework (`worker/lib/external-services/`)
- **Providers**: `google-books-provider.ts`, `archive-org-provider.ts`
- **Capabilities**: `ISubjectProvider`, `IMetadataProvider`

---

**Last Updated**: January 12, 2026
**Status**: Awaiting approval for Phase 3A implementation
