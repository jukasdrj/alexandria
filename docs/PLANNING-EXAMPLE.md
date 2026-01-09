# Planning-with-Files - Example Walkthrough

**This is a DEMONSTRATION of the planning-with-files skill**
**For actual use, create these files in the Alexandria repo root (not docs/)**

---

## Scenario: "Add support for LibraryThing API"

This example shows what the planning files would look like for a real Alexandria task.

---

## File 1: task_plan.md

```markdown
# Task: Add LibraryThing API Support

**Created:** January 9, 2026, 14:30 UTC
**Estimated Duration:** 3-4 hours
**Complexity:** Medium (new provider integration)

## Context

Alexandria currently supports:
- OpenLibrary (primary, 54M+ books)
- ISBNdb (covers, metadata enrichment)
- Google Books (fallback metadata)
- Gemini (AI backfill)

Adding LibraryThing provides:
- Additional metadata source (fallback chain)
- User-generated tags and reviews
- Better subject classification
- Free tier: 1000 req/day (no API key needed)

## Steps

### Research Phase (30 min)
- [x] Review LibraryThing API docs (https://www.librarything.com/services/)
- [x] Test API endpoints in Postman/curl
- [x] Document rate limits, auth requirements
- [x] Check existing provider pattern (google-books-client.ts)
- [ ] Identify where to add in enrichment chain

### Implementation Phase (2 hours)
- [ ] Create `worker/src/services/external-apis/librarything-client.ts`
- [ ] Add LibraryThing normalizer (`worker/src/services/normalizers/librarything.ts`)
- [ ] Add circuit breaker for LibraryThing provider
- [ ] Update `worker/src/services/enrichment.ts` provider chain
- [ ] Add LibraryThing to `AppBindings` type (env.ts)

### Testing Phase (30 min)
- [ ] Unit test: LibraryThing client (mock API responses)
- [ ] Unit test: Normalizer (schema transformation)
- [ ] Integration test: Full enrichment with LibraryThing
- [ ] E2E test: Fallback chain (ISBNdb → LibraryThing)

### Documentation Phase (30 min)
- [ ] Update CLAUDE.md with LibraryThing details
- [ ] Add API endpoint docs
- [ ] Update enrichment flow diagram

## Risks

### Risk 1: Rate Limits
- **Concern:** 1000 req/day is low for batch operations
- **Mitigation:**
  - Place LibraryThing AFTER ISBNdb in fallback chain
  - Add aggressive caching (7d TTL)
  - Track quota in KV (like ISBNdb)
  - Only call for books not found in primary sources

### Risk 2: Schema Differences
- **Concern:** LibraryThing may have incompatible metadata schema
- **Mitigation:**
  - Normalizer handles schema transformation
  - Test with diverse ISBNs (fiction, non-fiction, academic)
  - Validate against our canonical schema

### Risk 3: API Reliability
- **Concern:** Unknown uptime/performance
- **Mitigation:**
  - Circuit breaker protects other providers
  - Comprehensive error handling
  - Fallback to next provider on failure

## Testing Strategy

### Unit Tests (`worker/src/services/external-apis/librarything-client.test.ts`)
- LibraryThing API client methods
- Error handling (404, 429, 500)
- Response parsing
- Rate limit tracking

### Integration Tests
- Full enrichment flow with LibraryThing
- Fallback chain behavior
- Circuit breaker integration
- Cache integration

### E2E Tests
- ISBN lookup with LibraryThing as primary source
- Fallback when LibraryThing fails
- Quota enforcement

## Rollout Plan

### Phase 1: Development (Local)
- Implement all code
- Run full test suite
- Manual testing with diverse ISBNs

### Phase 2: Staging (Canary)
- Deploy to staging environment
- Test with production-like data
- Monitor error rates, latency
- Validate circuit breaker behavior

### Phase 3: Production (Gradual)
- Deploy to production
- Monitor QUERY_ANALYTICS for LibraryThing calls
- Watch for circuit breaker triggers
- Validate fallback chain works correctly

## Success Criteria

- [ ] LibraryThing client returns valid metadata for 90%+ ISBNs
- [ ] Normalizer passes all schema validation tests
- [ ] Circuit breaker triggers correctly on failures
- [ ] Enrichment latency <2s P95 with LibraryThing
- [ ] No regressions in existing provider performance
- [ ] Documentation updated and accurate

## Monitoring

**Key metrics to watch:**
- `QUERY_ANALYTICS`: LibraryThing API calls, latency, errors
- Circuit breaker state changes (KV storage)
- Enrichment success rate (before/after)
- Fallback chain usage distribution

## Rollback Plan

If LibraryThing causes issues:
1. Remove from provider chain in `enrichment.ts`
2. Deploy updated Worker
3. Validate enrichment works without LibraryThing
4. Investigate root cause offline
```

---

## File 2: findings.md

```markdown
# Findings: LibraryThing API Integration

**Task:** Add LibraryThing API support
**Started:** January 9, 2026, 14:30 UTC

---

## Current Implementation

### Provider Chain (worker/src/services/enrichment.ts:45-82)
Current fallback order:
1. OpenLibrary (Hyperdrive, local DB)
2. ISBNdb (Premium API, 3 req/sec)
3. Google Books (Free tier, 1000 req/day)
4. Gemini (AI backfill for missing books)

### Circuit Breaker (worker/src/middleware/circuit-breaker.ts)
- Per-provider state tracking in KV
- 5 failures → OPEN, 60s cooldown, 2 successes → CLOSED
- Existing providers: `isbndb`, `google-books`, `gemini-backfill`

### Normalizers (worker/src/services/normalizers/)
- `isbndb.ts` - ISBNdb schema → canonical
- `google-books.ts` - Google Books schema → canonical
- `openlibrary.ts` - OpenLibrary schema → canonical

---

## Research Notes

### 2026-01-09 14:35 - LibraryThing API Analysis

**API Endpoints:**
- `https://www.librarything.com/services/rest/1.1/?method=librarything.ck.getwork&isbn={isbn}`
- Authentication: Optional API key (free tier 1000 req/day without key)
- Rate limit: 1 req/sec (documented), 1000 req/day (free tier)
- Response format: XML (ugh) or JSON (via `&apikey={key}`)

**Response Schema (JSON):**
```json
{
  "ltml": {
    "item": {
      "author": "J.K. Rowling",
      "commonknowledge": {
        "fieldList": {
          "field": [
            {"name": "blurb", "value": "..."},
            {"name": "awards", "value": "..."}
          ]
        }
      }
    }
  }
}
```

**Key fields:**
- `ltml.item.author` - Author name
- `ltml.item.url` - Work URL
- `ltml.item.commonknowledge.fieldList.field[]` - Array of metadata fields

**Useful metadata:**
- Awards, series info, character names, subject tags
- User reviews (separate endpoint)
- Similar books (recommendations)

### 2026-01-09 14:50 - Rate Limit Strategy

**Decision:** Place LibraryThing LAST in fallback chain
- Rationale: 1000 req/day is restrictive, only use when other sources fail
- Updated fallback order:
  1. OpenLibrary (local, unlimited)
  2. ISBNdb (3 req/sec, ~259K req/day)
  3. Google Books (1000 req/day)
  4. LibraryThing (1000 req/day, slower response)
  5. Gemini (AI backfill for missing books)

**Quota tracking:** Implement KV-based quota like ISBNdb (QUOTA_KV namespace)

### 2026-01-09 15:05 - Schema Mapping

**Normalizer strategy:**
```typescript
export function normalizeLibraryThingResponse(data: LibraryThingResponse): CanonicalBook {
  const item = data.ltml?.item
  if (!item) throw new Error('Invalid LibraryThing response')

  // Extract common knowledge fields
  const fields = item.commonknowledge?.fieldList?.field || []
  const blurb = fields.find(f => f.name === 'blurb')?.value
  const awards = fields.filter(f => f.name === 'awards').map(f => f.value)

  return {
    isbn: extractISBN(item),
    title: item.title,
    author: item.author,
    description: blurb || null,
    awards: awards.length > 0 ? awards : null,
    // ... rest of canonical schema
  }
}
```

---

## Decisions Made

### 2026-01-09 14:40 - Use JSON Response Format
**Decision:** Request JSON instead of XML from LibraryThing
**Rationale:**
- Easier parsing in TypeScript
- Aligns with other provider responses
- Avoids XML parsing dependencies

**Implementation:**
- Add `&apikey={key}` to requests (forces JSON)
- For free tier (no key), accept XML and parse with basic regex (fallback)

### 2026-01-09 14:55 - Circuit Breaker Configuration
**Decision:** Use same circuit breaker config as other providers
**Rationale:**
- Proven configuration (5 failures, 60s cooldown)
- Consistent behavior across providers
- Easy to tune if needed

**Config:**
```typescript
const LIBRARYTHING_CIRCUIT_CONFIG = {
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 60000,
  stateExpirationTtl: 300
}
```

### 2026-01-09 15:10 - Caching Strategy
**Decision:** 7-day cache TTL for LibraryThing responses
**Rationale:**
- Awards and metadata rarely change
- Reduces API calls (conserve 1000 req/day quota)
- Longer than ISBNdb (24h) due to rate limit constraints

---

## Blockers/Questions

- [x] **Q:** Does LibraryThing support batch ISBN lookup?
  - **A:** No, one ISBN per request (unlike ISBNdb)
  - **Impact:** Must throttle individual requests (1 req/sec)

- [x] **Q:** How to handle XML responses on free tier?
  - **A:** Accept XML for free tier, parse with lightweight XML-to-JSON library
  - **Library:** Use `fast-xml-parser` (compatible with Workers runtime)

- [ ] **Q:** Should we add LibraryThing API key as secret?
  - **Status:** Pending decision - free tier may be sufficient initially
  - **Action:** Start without key, add if quota issues arise

---

## Performance Notes

### 2026-01-09 15:20 - API Latency Testing

Tested with sample ISBNs:
- ISBN: 9780439708180 (Harry Potter) - 450ms response time
- ISBN: 9780061120084 (To Kill a Mockingbird) - 520ms response time
- ISBN: 9780743273565 (Great Gatsby) - 380ms response time

**Average latency:** ~450ms (slower than ISBNdb ~200ms, Google Books ~300ms)

**Decision:** Acceptable for fallback provider (not on critical path)

---

## Next Steps

1. Implement LibraryThing client with circuit breaker
2. Create normalizer with XML/JSON handling
3. Add to enrichment chain (last position)
4. Write comprehensive tests
5. Deploy to staging and validate

---

**Last Updated:** January 9, 2026, 15:25 UTC
```

---

## File 3: progress.md

```markdown
# Progress: LibraryThing API Integration

**Task:** Add LibraryThing API support to Alexandria
**Started:** January 9, 2026, 14:30 UTC
**Last Updated:** January 9, 2026, 16:45 UTC
**Status:** ✅ Completed
**Completion:** 100%

---

## Summary

Successfully integrated LibraryThing as fallback metadata provider. All tests passing, deployed to production with zero issues.

---

## Completed Steps

### Research Phase ✅
- [x] **Review LibraryThing API docs** (14:35-14:40)
  - Identified JSON response format (with API key)
  - Documented rate limits: 1 req/sec, 1000 req/day
  - Tested sample ISBNs in curl

- [x] **Test API endpoints** (14:40-14:50)
  - Harry Potter: 450ms, valid response
  - Classic literature: Similar latency
  - Error handling: 404 for invalid ISBNs

- [x] **Document rate limits** (14:50-14:55)
  - Added quota tracking design to findings.md
  - Decided on KV-based quota (like ISBNdb)

- [x] **Check existing provider pattern** (14:55-15:00)
  - Reviewed google-books-client.ts
  - Noted circuit breaker integration points

- [x] **Identify enrichment chain position** (15:00-15:05)
  - Decided: Last position (before Gemini)
  - Rationale: Low quota, use only when others fail

### Implementation Phase ✅
- [x] **Create LibraryThing client** (15:05-15:30)
  - File: `worker/src/services/external-apis/librarything-client.ts`
  - Methods: `getBookByISBN()`, `parseResponse()`
  - Error handling: 404, 429, 500, timeout

- [x] **Add normalizer** (15:30-15:50)
  - File: `worker/src/services/normalizers/librarything.ts`
  - Handles XML and JSON responses
  - Extracts awards, blurb, series info

- [x] **Add circuit breaker** (15:50-16:00)
  - Updated `worker/src/middleware/circuit-breaker.ts`
  - Added 'librarything' provider
  - Config: 5 failures, 60s cooldown

- [x] **Update enrichment chain** (16:00-16:10)
  - Modified `worker/src/services/enrichment.ts`
  - Added LibraryThing before Gemini fallback
  - Tested fallback order

- [x] **Add type definitions** (16:10-16:15)
  - Updated `worker/src/env.ts` with LibraryThing types
  - Added to AppBindings

### Testing Phase ✅
- [x] **Unit tests - Client** (16:15-16:25)
  - Test file: `librarything-client.test.ts`
  - Coverage: API methods, error handling
  - Result: 15/15 tests passing

- [x] **Unit tests - Normalizer** (16:25-16:30)
  - Test file: `librarything-normalizer.test.ts`
  - Coverage: XML/JSON parsing, schema validation
  - Result: 12/12 tests passing

- [x] **Integration tests** (16:30-16:35)
  - Test: Full enrichment with LibraryThing
  - Test: Fallback chain (ISBNdb → LibraryThing)
  - Result: All passing

- [x] **E2E tests** (16:35-16:40)
  - Test: ISBN lookup with LibraryThing primary
  - Test: Circuit breaker triggers correctly
  - Result: All passing

### Documentation Phase ✅
- [x] **Update CLAUDE.md** (16:40-16:42)
  - Added LibraryThing to provider list
  - Documented rate limits, fallback position

- [x] **Add API endpoint docs** (16:42-16:44)
  - Updated `docs/api/ENRICHMENT-ENDPOINTS.md`
  - Added LibraryThing response schema

- [x] **Update enrichment flow diagram** (16:44-16:45)
  - Updated `docs/diagrams/enrichment-flow.md`
  - Shows LibraryThing in fallback chain

---

## Deployment

### Staging Deployment ✅
- **Deployed:** January 9, 2026, 16:50 UTC
- **Result:** All health checks passing
- **Validation:** Tested with 50 sample ISBNs
- **Performance:** P95 latency <2s (target met)

### Production Deployment ✅
- **Deployed:** January 9, 2026, 17:00 UTC
- **Result:** Zero errors in first hour
- **Monitoring:** QUERY_ANALYTICS shows LibraryThing in fallback chain
- **Circuit breaker:** No triggers (healthy)

---

## Metrics (First 24 Hours)

- **LibraryThing API calls:** 127
- **Success rate:** 94.5%
- **Average latency:** 465ms
- **Circuit breaker triggers:** 0
- **Quota usage:** 127/1000 (12.7%)
- **Fallback usage:** LibraryThing used when ISBNdb + Google Books both fail

---

## Lessons Learned

1. **XML parsing complexity** - Fast-xml-parser works well in Workers
2. **Rate limiting** - Placing LibraryThing last in chain conserves quota
3. **Circuit breaker** - Standard config works well for all providers
4. **Caching** - 7-day TTL significantly reduces API calls

---

## Next Action

✅ Task complete - monitoring in production
```

---

## How This Demonstrates the Skill

### Key Patterns Shown:

1. **task_plan.md Structure**
   - Context explains WHY the task matters
   - Steps broken into phases (Research → Implementation → Testing → Documentation)
   - Risks identified upfront with mitigation strategies
   - Clear success criteria and rollout plan

2. **findings.md Evolution**
   - Timestamped research notes (shows progression)
   - Decisions documented with rationale
   - Blockers tracked and resolved
   - Performance data captured

3. **progress.md Tracking**
   - Real-time status updates
   - Checkboxes show completed vs pending
   - Deployment and metrics sections
   - Lessons learned captured

### What Alexandria Claude Should Learn:

1. **Create ALL THREE files immediately** when recognizing a complex task
2. **Update frequently** - especially progress.md (after each major step)
3. **Document decisions** - future you (or another AI) will appreciate it
4. **Track blockers** - don't let them get lost in conversation history
5. **Measure outcomes** - metrics validate the work was successful

---

**This is just an EXAMPLE - actual planning files go in repo root, not docs/**

For real use, invoke the skill by creating these files when you start a complex task.

---

**Created:** January 9, 2026
**Purpose:** Demonstrate planning-with-files skill to Alexandria Claude Code
**Pattern source:** BooksTrack (proven in production)
