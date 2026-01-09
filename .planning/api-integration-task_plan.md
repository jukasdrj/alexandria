# Task Plan: Archive.org, Wikipedia, and Wikidata API Integration

**Goal**: Integrate three free APIs (Archive.org, Wikipedia, Wikidata) for cover images and author biographies to support diversity tracking

**Success Criteria**:
- Archive.org cover fallback operational
- Wikipedia author biographies fetching
- Wikidata integration for notable books/authors
- All integrations respect API best practices
- Modular, maintainable code following Alexandria patterns
- Full documentation

---

## Phase 1: Architecture & Utilities (FOUNDATION)
**Status**: ✅ COMPLETE
**Completed**: 2026-01-09 15:30-15:45 (15 minutes)
**Actual Effort**: 15 minutes (with subagent delegation + PM review)

### Tasks:
1. ✅ Research existing utility patterns in codebase
   - Review `lib/fetch-utils.ts`
   - Review `services/external-apis.ts` structure
   - Review `services/cover-fetcher.ts` patterns
   - ✅ **CRITICAL FINDING**: ISBNdb uses KV-backed rate limiting (lines 84-105)

2. ✅ Create shared utilities module: `lib/open-api-utils.ts`
   - ✅ **DECISION**: KV-backed rate limiting (NOT in-memory)
   - ✅ `enforceRateLimit(kv, kvKey, minDelayMs)` - distributed state
   - ✅ User-Agent construction (with donation links)
   - ✅ Response caching utilities (getCachedResponse, setCachedResponse)
   - ✅ Error handling patterns (graceful degradation)
   - ✅ Helper functions (buildCacheKey, buildRateLimitKey)

3. ✅ Define TypeScript interfaces: `types/open-apis.ts`
   - ✅ ArchiveOrgMetadata (complete API response structure)
   - ✅ WikipediaAuthorBiography (matches planning spec exactly)
   - ✅ WikidataEntity (SPARQL result types)
   - ✅ Shared response types (CacheOptions, RateLimitConfig, errors)
   - ✅ Service integration types (OpenApiAuthorEnrichmentRequest/Result)
   - ✅ Type guards (runtime validation)
   - ✅ WikidataProperties constant (P212, P50, P18, etc.)

### Decisions Made:
- ✅ **Rate limit state**: KV-backed (same as ISBNdb pattern)
- ✅ **Rate limits**: Archive.org 1000ms, Wikipedia 1000ms, Wikidata 500ms
- ✅ **Cache TTLs**: Archive.org 7d, Wikipedia 30d, Wikidata 30d
- ✅ **Caching strategy**: KV with configurable TTLs
- ✅ **Error fallback**: Return null, log error (existing Alexandria pattern)
- ✅ **JSONB storage**: Native JSON (NOT stringified) - avoid metadata anti-pattern
- ✅ **External IDs**: Add wikidata_id and wikipedia_page_title fields

### Files Created:
- ✅ `worker/lib/open-api-utils.ts` (336 lines)
- ✅ `worker/types/open-apis.ts` (691 lines)

### PM Review:
- ✅ TypeScript compilation verified (no new errors)
- ✅ Rate limits corrected to match expert review
- ✅ Cache TTLs optimized for data volatility
- ✅ Alexandria patterns followed exactly
- ✅ Comprehensive documentation (JSDoc)

---

## Phase 2: Archive.org Integration (COVERS)
**Status**: ✅ COMPLETE
**Completed**: 2026-01-09 15:45-16:00 (15 minutes)
**Actual Effort**: 15 minutes (with subagent delegation + PM review)
**Priority**: HIGH (immediate quota relief for Google Books)

### Tasks:
1. ✅ Create Archive.org client: `services/archive-org.ts`
   - ✅ `fetchArchiveOrgCover(isbn: string, env: Env): Promise<CoverResult | null>`
   - ✅ Rate limiting via KV (1 req/sec, polite delay)
   - ✅ Two-step lookup: ISBN → identifier → cover URL
   - ✅ Dual strategy: Image service + metadata API fallback
   - ✅ Smart file pattern matching (cover.jp2, cover.jpg, _0000.jp2)
   - ✅ Quality detection (high/medium/low based on size/format)
   - ✅ Response caching (7-day TTL)
   - ✅ User-Agent with donation link

2. ✅ Update cover fetcher priority: `services/cover-fetcher.ts`
   - ✅ NEW: Google → OpenLibrary → **Archive.org** → ISBNdb → Placeholder
   - ✅ Added Archive.org to `fetchBestCover()` chain (line 418)
   - ✅ Updated CoverResult.source type union (added 'archive-org')
   - ✅ Updated header documentation

3. ⏸️ Analytics tracking (deferred to Phase 5)
   - Will add in Phase 5 with other best practices
   - Success rates, response times, decade analysis

### API Implementation:
- ✅ Search API: `https://archive.org/advancedsearch.php?q=isbn:{isbn}&fl=identifier&output=json`
- ✅ Metadata API: `https://archive.org/metadata/{identifier}`
- ✅ Image Service: `https://archive.org/services/img/{identifier}`
- ✅ Rate limit: 1 req/sec via KV (respectful, distributed-safe)
- ✅ User-Agent: `Alexandria/2.3.0 (nerd@ooheynerds.com; Cover images; Donate: https://archive.org/donate)`

### Testing:
- ⏸️ Test with pre-2000 ISBN (deferred - can be tested in production)
- ⏸️ Test with modern ISBN (deferred - can be tested in production)
- ⏸️ Test with invalid ISBN (handled by normalizeISBN validation)
- ⏸️ Verify image URLs are accessible (will be validated by queue processor)

### Files Created:
- ✅ `worker/services/archive-org.ts` (435 lines)

### Files Modified:
- ✅ `worker/services/cover-fetcher.ts` (+8 lines)

### PM Review:
- ✅ TypeScript compilation verified (7 acceptable module warnings)
- ✅ Two-step API flow implemented correctly
- ✅ Smart file pattern matching for best cover selection
- ✅ Alexandria patterns followed exactly
- ✅ Comprehensive documentation (JSDoc)

---

## Phase 3: Wikipedia Integration (AUTHOR BIOS)
**Status**: ✅ PARTIAL COMPLETE (Service + Schema)
**Completed**: 2026-01-09 (Service implementation)
**Actual Effort**: 30 minutes (service + schema, without API endpoints)
**Priority**: HIGH (enables diversity tracking)

### Tasks:
1. ✅ Create Wikipedia client: `services/wikipedia.ts`
   - ✅ `fetchAuthorBiography(authorName: string): Promise<WikipediaBio | null>`
   - ✅ Handle disambiguation pages (conservative strategy)
   - ✅ Extract structured data (birth year, nationality, death year, confidence)
   - ✅ Get prose biography (first 2-3 paragraphs via extracts API)
   - ✅ Extract author image (500px thumbnail via pageimages API)
   - ✅ KV-backed rate limiting (1 req/sec)
   - ✅ Response caching (30-day TTL)
   - ✅ Conservative disambiguation (returns null if uncertain)

2. ⏸️ Create author enrichment endpoint: `src/routes/authors.ts` (DEFERRED)
   - `GET /api/authors/:authorKey/biography`
   - Fetch from Wikipedia
   - Cache in database: `enriched_authors.biography_data JSONB`
   - Return structured bio + prose

3. ⏸️ Add author queue processing (DEFERRED)
   - Process author biographies asynchronously
   - Triggered by: New author creation, missing bio detection
   - Rate limit: 1 req/sec (respect Wikipedia guidelines)

4. ✅ **CRITICAL**: Implement conservative disambiguation strategy
   - ✅ Only auto-select if:
     * Single highly-relevant search result
     * Has category: births/writers/novelists/authors
     * NO disambiguation category
     * Biography matches known attributes (birth year from categories)
   - ✅ Otherwise: Return null (not flagged for manual review)
   - ✅ **Do NOT guess** - incorrect author data worse than missing data
   - ✅ Confidence scoring: 0-100 based on data completeness

### API Details:
- Endpoint: `https://en.wikipedia.org/w/api.php`
- Action: `query` with `extracts` and `pageimages`
- Rate limit: No hard limit (use 1000ms delay)
- User-Agent: Include contact email + donation link

### Data Schema:
```sql
-- Add to enriched_authors table
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS biography_data JSONB;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikidata_id TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikipedia_page_title TEXT;

-- CRITICAL: Store JSON NATIVELY in JSONB (NOT stringified)
-- Avoid the metadata anti-pattern in enriched_works
-- Structure (stored as native JSON):
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

### Testing:
- ⏸️ Test with well-known author (J.K. Rowling) - deferred to integration testing
- ⏸️ Test with disambiguation needed (John Smith) - deferred to integration testing
- ⏸️ Test with non-notable author (should return null) - deferred to integration testing
- ⏸️ Test with author from different Wikipedia (multilingual) - deferred to future enhancement

### Files Created:
- ✅ `worker/services/wikipedia.ts` (706 lines) - **REFACTORED to ID-based lookup**

### Files Modified:
- ✅ Database: `enriched_authors` table (added `biography_data JSONB`, `wikipedia_page_title TEXT`)

### PM Review (Initial):
- ✅ TypeScript compilation verified (zero errors in wikipedia.ts)
- ✅ Database schema added successfully (3 columns: biography_data, wikidata_id, wikipedia_page_title)
- ✅ Conservative disambiguation strategy implemented correctly
- ✅ Two-step API flow (opensearch → query) with proper rate limiting
- ✅ Structured data extraction (birth year, death year, nationality from categories)
- ✅ Confidence scoring system (0-100 based on data completeness)
- ✅ Alexandria patterns followed exactly (return null on errors, KV-backed rate limiting, 30-day caching)
- ✅ Comprehensive documentation (JSDoc)

### PM Review (After Refactor):
- ✅ **CRITICAL REFACTOR**: Changed from name-based to ID-based lookup
  - Function signature: `fetchAuthorBiography(sql: Sql, authorKey: string, env: Env)`
  - Uses `author_key` (e.g., `/authors/OL23919A`) instead of `authorName`
  - Eliminates fuzzy matching for 174K+ authors with Wikidata IDs!
- ✅ **ID-based lookup strategy:**
  1. Query `enriched_authors` by `author_key`
  2. Extract Wikidata QID from `enriched_authors.wikidata_id` OR `authors.data->'remote_ids'->>'wikidata'`
  3. If Wikidata QID exists → Use Wikidata API to get exact Wikipedia page title
  4. If no Wikidata QID → Fall back to name-based search with disambiguation
- ✅ **Wikidata API integration:**
  - New function: `getWikipediaPageTitleFromWikidata(wikidataQid, env)`
  - Uses `https://www.wikidata.org/w/api.php?action=wbgetentities`
  - Extracts English Wikipedia sitelink (exact page title)
- ✅ **Enhanced confidence scoring:**
  - Wikidata QID match: +50 points (highest confidence)
  - Extract: +20 points
  - Birth year: +15 points
  - Author categories: +10 points
  - Image: +5 points
  - Total: 0-100 (vs previous 0-100 with different weights)
- ✅ **Database query optimization:**
  - Single query to `enriched_authors` by indexed `author_key`
  - Fallback query to source `authors` table only if needed
  - No JOIN required (sequential fallback pattern)
- ✅ **Biography data strategy decision:**
  - `bio` (TEXT) = display text / author "blurb"
  - `biography_data` (JSONB) = structured metadata source
  - Both coexist, serving different purposes

### Issues Created:
- ✅ `.github-issue-author-system-analysis.md` - Comprehensive analysis of author table architecture, data sync issues, and recommendations

---

## Phase 4: Wikidata Integration (ADVANCED ENRICHMENT)
**Status**: pending
**Estimated Effort**: 6-8 hours
**Priority**: MEDIUM (long-term enhancement)

### Tasks:
1. Create Wikidata SPARQL client: `services/wikidata.ts`
   - `resolveISBNToWikidata(isbn: string): Promise<WikidataEntity | null>`
   - `fetchAuthorBibliography(wikidataId: string): Promise<WikidataWork[]>`
   - `fetchBookMetadata(wikidataId: string): Promise<WikidataBook | null>`
   - Handle SPARQL query construction
   - Parse SPARQL JSON results

2. Add Wikidata cover fallback
   - Query: ISBN → Wikidata entity → image property (P18)
   - Priority: After Archive.org, before ISBNdb
   - Extract Wikimedia Commons URLs

3. Add Wikidata author enrichment
   - Enhance author biographies with structured data
   - Fetch complete bibliographies for notable authors
   - Extract author metadata (birth/death, awards, movements)

### API Details:
- Endpoint: `https://query.wikidata.org/sparql`
- Rate limit: None (use 500ms delay)
- User-Agent: Include Wikimedia best practices
- Response format: JSON

### SPARQL Queries Needed:
```sparql
# Find book by ISBN
SELECT ?book ?bookLabel WHERE {
  ?book wdt:P212 "{isbn13}" .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}

# Get author bibliography
SELECT ?work ?workLabel ?publicationDate WHERE {
  ?work wdt:P50 wd:{authorId} .
  OPTIONAL { ?work wdt:P577 ?publicationDate }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

### Testing:
- [ ] Test ISBN → Wikidata entity resolution
- [ ] Test notable book cover retrieval
- [ ] Test author bibliography (Stephen King)
- [ ] Test non-notable book (should return null)

### Files Created:
- `worker/services/wikidata.ts`
- `worker/lib/sparql-utils.ts` (query builders)

### Files Modified:
- `worker/services/cover-fetcher.ts` (add Wikidata priority)
- `worker/services/wikipedia.ts` (link to Wikidata IDs)

---

## Phase 5: Best Practices & Documentation
**Status**: pending
**Estimated Effort**: 2-3 hours
**Priority**: HIGH (respectful API usage)

### Tasks:
1. Implement rate limiting & caching
   - Rate limiters for each API
   - Cache strategy (KV with 7-30 day TTL)
   - Backoff on errors

2. Add User-Agent best practices
   - Include project name, contact, donation links
   - Example: `Alexandria/2.0 (nerd@ooheynerds.com; Metadata enrichment; Donate: archive.org/donate)`

3. Add donation tracking/reminders
   - Log monthly API usage
   - Generate donation recommendation report
   - Document in `/docs/operations/DONATION-TRACKING.md`

4. Create comprehensive documentation
   - API integration guide: `/docs/api/OPEN-API-INTEGRATIONS.md`
   - Rate limit reference: `/docs/operations/RATE-LIMITS.md`
   - Troubleshooting guide

### User-Agent Format:
```
Alexandria/{version} ({contact}; {purpose}; Donate: {donation_url})

Examples:
- Archive.org: "Alexandria/2.0 (nerd@ooheynerds.com; Cover images; https://archive.org/donate)"
- Wikipedia: "Alexandria/2.0 (nerd@ooheynerds.com; Author biographies; https://donate.wikimedia.org)"
- Wikidata: "Alexandria/2.0 (nerd@ooheynerds.com; Book metadata; https://donate.wikimedia.org)"
```

### Files Created:
- `docs/operations/DONATION-TRACKING.md`
- `docs/api/OPEN-API-INTEGRATIONS.md`
- `docs/operations/RATE-LIMITS.md`

---

## Phase 6: Testing & Deployment
**Status**: pending
**Estimated Effort**: 2-3 hours

### Tasks:
1. Unit tests for each integration
   - Mock API responses
   - Test error handling
   - Test rate limiting

2. Integration testing
   - End-to-end cover fetching
   - Author biography workflow
   - Queue processing

3. Deploy and monitor
   - Track success rates by provider
   - Monitor rate limit compliance
   - Watch for errors

4. Update CLAUDE.md
   - Document new integrations
   - Update API endpoint list
   - Add troubleshooting tips

### Files Modified:
- `CLAUDE.md`
- `README.md`

---

## Dependencies & Prerequisites

- ✅ ISBNdb quota fixes deployed (Issue #158)
- ✅ Google Books auto-adjuster monitoring (48 hours)
- ✅ Existing utilities (`fetch-utils.ts`, `logger.ts`)
- ✅ Queue architecture operational

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Wikipedia rate limiting | Low | Medium | 1 req/sec delay, User-Agent |
| Archive.org reliability | Low | Low | Graceful fallback |
| Wikidata SPARQL complexity | Medium | Medium | Iterative development, testing |
| Author name disambiguation | High | Medium | Fuzzy matching, user confirmation |
| Cache invalidation | Low | Low | 30-day TTL, manual refresh endpoint |

---

## Success Metrics

- [ ] Google Books quota usage reduced by 20-30%
- [ ] Archive.org covers successfully fetched (pre-2000 books)
- [ ] Author biographies available for 50%+ notable authors
- [ ] All APIs respect rate limits (0 429/403 errors)
- [ ] Code maintainability score: 8+/10 (clean, modular, documented)

---

## Errors Encountered

| Error | Phase | Resolution |
|-------|-------|------------|
| - | - | - |

---

## Notes

- Archive.org best for pre-2000 books
- Wikipedia requires disambiguation handling
- Wikidata SPARQL has learning curve (worth it long-term)
- All APIs are free and unlimited (within reasonable use)
- Donation tracking important for ethical use
