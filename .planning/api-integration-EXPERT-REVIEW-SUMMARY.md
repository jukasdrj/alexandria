# Expert Review Summary - Open API Integration Plan

**Reviewer**: Gemini 2.5 Flash (via PAL MCP)
**Date**: 2026-01-09
**Status**: ✅ ALL CRITICAL ISSUES RESOLVED

---

## 🚨 Critical Issue: Rate Limiting Strategy

### Problem
The original plan proposed in-memory rate limiting for open APIs:
```typescript
// WRONG - Won't work in distributed Workers
private lastRequestTime: number = 0; // In-memory state
```

**Why it fails**: Cloudflare Workers run in distributed isolates globally. Each isolate thinks it's the first to make a request, causing bursts that violate rate limits.

### Solution
Use KV-backed rate limiting (same pattern as ISBNdb):
```typescript
// CORRECT - Distributed state via KV
export async function enforceRateLimit(
  kv: KVNamespace,
  kvKey: string,
  minDelayMs: number
): Promise<void> {
  const lastRequestStr = await kv.get(kvKey);
  // ... implement delay if needed ...
  await kv.put(kvKey, Date.now().toString(), { expirationTtl: 60 });
}
```

**Pattern Source**: `worker/services/cover-fetcher.ts` lines 84-105 (`enforceISBNdbRateLimit`)

**Status**: ✅ Fixed in both findings.md and task_plan.md

---

## ⚠️ Other Important Issues

### 1. JSONB Storage Anti-Pattern

**Problem**: Existing `enriched_works.metadata` stores stringified JSON inside JSONB:
```sql
-- WRONG - Defeats JSONB advantages
(metadata#>>'{}')::jsonb  -- Double parsing required
```

**Solution**: Store native JSON in new `biography_data` column:
```sql
-- CORRECT - Native JSON storage
ALTER TABLE enriched_authors ADD COLUMN biography_data JSONB;
-- No stringification needed
```

**Status**: ✅ Documented in schema definition

---

### 2. Author Disambiguation Strategy

**Problem**: Automatic author name matching risks false positives (e.g., "John Smith").

**Solution**: Conservative auto-selection criteria:
- ✅ Single highly-relevant search result
- ✅ Has category: births/writers/novelists/authors
- ✅ NO disambiguation category
- ✅ Biography matches known attributes (birth year)
- ❌ Otherwise: Flag for manual review or leave null

**Principle**: Incorrect author data is worse than missing data.

**Status**: ✅ Added to Phase 3 implementation tasks

---

### 3. External ID Storage

**Problem**: Plan didn't specify where to store Wikidata QIDs and Wikipedia page titles.

**Solution**: Add fields to `enriched_authors`:
```sql
ALTER TABLE enriched_authors ADD COLUMN wikidata_id TEXT;
ALTER TABLE enriched_authors ADD COLUMN wikipedia_page_title TEXT;
```

**Benefits**:
- Avoids redundant API calls
- Enables cross-referencing across providers
- Facilitates future Wikidata queries

**Status**: ✅ Added to schema definition

---

## ✅ Positive Feedback

The expert review praised several aspects:

1. **Modular Architecture**: Service-per-API pattern is sound
2. **No Anti-Patterns**: Structure aligns with existing Alexandria patterns
3. **User-Agent Strategy**: Ethical approach with contact + donation links
4. **Caching Strategy**: KV + TTL is appropriate for use case
5. **Error Handling**: Return null pattern is robust for external APIs
6. **Priority Order**: Archive.org → Wikipedia → Wikidata is logical
7. **Module Boundaries**: Clear separation of concerns

---

## 📋 Updated Implementation Details

### Rate Limiting (CORRECTED)

| API | Rate Limit | Min Delay | KV Key |
|-----|------------|-----------|--------|
| Archive.org | 1 req/sec | 1000ms | `rate_limit:archive_org:last_request` |
| Wikipedia | 1 req/sec | 1000ms | `rate_limit:wikipedia:last_request` |
| Wikidata | 2 req/sec | 500ms | `rate_limit:wikidata:last_request` |

**Binding**: Reuse existing `CACHE` KV namespace (no new KV needed)

### Database Schema (CORRECTED)

```sql
-- Add to enriched_authors table
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS biography_data JSONB;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikidata_id TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikipedia_page_title TEXT;

-- biography_data structure (stored as NATIVE JSON):
{
  "source": "wikipedia",
  "article_title": "J. K. Rowling",
  "extract": "Joanne Rowling...",
  "birth_year": 1965,
  "nationality": ["British"],
  "image_url": "https://...",
  "fetched_at": "2026-01-09T...",
  "wikipedia_url": "https://en.wikipedia.org/wiki/...",
  "wikidata_qid": "Q34660"
}
```

---

## 🎯 Implementation Checklist

### Phase 1: Architecture & Utilities
- [x] Research existing patterns ✅
- [x] Identify KV-backed rate limiting pattern ✅
- [ ] Create `lib/open-api-utils.ts` with `enforceRateLimit()`
- [ ] Create `types/open-apis.ts` with TypeScript interfaces
- [ ] User-Agent construction utilities

### Phase 2: Archive.org
- [ ] Create `services/archive-org.ts`
- [ ] Implement KV-backed rate limiting (1 req/sec)
- [ ] Update `cover-fetcher.ts` priority chain
- [ ] Test with pre-2000 and modern ISBNs

### Phase 3: Wikipedia
- [ ] Create `services/wikipedia.ts`
- [ ] Implement conservative disambiguation
- [ ] Add schema migrations (biography_data, wikidata_id, wikipedia_page_title)
- [ ] Create author biography endpoint
- [ ] Test with well-known, ambiguous, and non-notable authors

### Phase 4: Wikidata
- [ ] Create `services/wikidata.ts` with SPARQL
- [ ] Create `lib/sparql-utils.ts`
- [ ] Store wikidata_id for cross-referencing
- [ ] Validate SPARQL results with Zod schemas

### Phase 5: Best Practices
- [ ] User-Agent with donation links for all APIs
- [ ] Donation tracking documentation
- [ ] Rate limit monitoring

### Phase 6: Testing & Deployment
- [ ] Unit tests with mocked responses
- [ ] Integration tests with real APIs
- [ ] Deploy and monitor
- [ ] Update CLAUDE.md

---

## 🔒 Risk Mitigation

| Risk | Original | Fixed |
|------|----------|-------|
| Rate limit violations | ⚠️ In-memory state | ✅ KV-backed distributed state |
| JSONB performance | ⚠️ Stringified JSON | ✅ Native JSON storage |
| False author matches | ⚠️ Automatic selection | ✅ Conservative criteria |
| Missing external IDs | ⚠️ No storage plan | ✅ Dedicated columns |

---

## 🚀 Ready to Proceed

**All critical issues have been addressed.** The plan is now:
- ✅ Architecturally sound
- ✅ Follows distributed system best practices
- ✅ Aligns with existing Alexandria patterns
- ✅ Includes proper error handling and fallbacks
- ✅ Respects external API guidelines

**Next step**: Begin Phase 1 implementation (shared utilities).
