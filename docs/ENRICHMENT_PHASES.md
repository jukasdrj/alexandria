# Alexandria Enrichment Pipeline - Phase Implementation Plan

**Created:** November 29, 2025  
**Status:** Planning  
**Goal:** Transform Alexandria from read-only OpenLibrary mirror to active book metadata enrichment hub

---

## Executive Summary

Alexandria currently serves 54M books from OpenLibrary but lacks:
1. Write capabilities (no way to add/update enriched data)
2. Background enrichment processing
3. Integration with premium providers (ISBNdb, Google Books) at the Alexandria level

This document outlines a phased approach to building the complete enrichment pipeline.

---

## Current Architecture

```
books-v3 (iOS) → bendv3 (Workers) → Alexandria (Workers) → Tower PostgreSQL
                      ↓
              [KV Cache Layer]  ← THIS IS REDUNDANT NOW
                      ↓
              [Google Books API]  ← Fallback when Alexandria misses
```

### What Exists

**Alexandria (alex repo):**
- ✅ Read endpoints: `/api/search`, `/api/isbn`, `/api/stats`
- ✅ PostgreSQL with 54M editions, 49.3M ISBNs
- ✅ Enrichment tables deployed (enriched_works, enriched_editions, enriched_authors)
- ✅ Enrichment infrastructure tables (enrichment_queue, enrichment_log)
- ✅ Hyperdrive connection pooling (sub-30ms queries)
- ❌ Write endpoints (NOT IMPLEMENTED)
- ❌ Queue processor (NOT IMPLEMENTED)
- ❌ ISBNdb/Google Books fetchers (NOT IMPLEMENTED)

**bendv3 (backend API):**
- ✅ alexandria-api.ts with ISBN lookup
- ✅ Circuit breaker for Alexandria
- ✅ KV cache layer (REDUNDANT - should be removed)
- ✅ Google Books/ISBNdb fetchers (should move to Alexandria)
- ❌ POST to Alexandria for enrichment (NOT IMPLEMENTED)

---

## Target Architecture

```
books-v3 (iOS) → bendv3 (Workers) → Alexandria (Workers) → Tower PostgreSQL
                      ↓                    ↓
              [User Data Only]      [Enrichment Cron]
                                          ↓
                                   [ISBNdb API]
                                   [Google Books API]
                                   [Wikidata API]
```

### Key Changes

1. **Alexandria becomes the enrichment hub** - All book metadata operations happen here
2. **bendv3 becomes thin orchestrator** - Just routes requests, stores user data
3. **No KV caching for book lookups** - PostgreSQL via Hyperdrive IS the cache
4. **Enrichment runs at Alexandria** - Cron jobs process queue, fetch from providers

---

## Phase 1: Alexandria Write Endpoints (2-3 hours)

### Objective
Enable Alexandria to accept and store enriched book data from external sources.

### Deliverables

1. **POST /api/enrich/edition** - Create/update enriched edition
   - Accepts: ISBN, work_key, metadata fields
   - Upserts to `enriched_editions` table
   - Links to `enriched_works` if work_key provided
   - Logs to `enrichment_log`

2. **POST /api/enrich/work** - Create/update enriched work
   - Accepts: work_key, title, description, subjects, etc.
   - Upserts to `enriched_works` table
   - Returns work_key for edition linking

3. **POST /api/enrich/author** - Create/update enriched author
   - Accepts: author_key, name, bio, birth_year, etc.
   - Upserts to `enriched_authors` table
   - Returns author_key for work linking

4. **POST /api/enrich/queue** - Queue item for background enrichment
   - Accepts: entity_type, entity_key, priority, providers_to_try
   - Inserts to `enrichment_queue` table
   - Returns queue job ID

5. **GET /api/enrich/status/:id** - Check enrichment job status
   - Returns job status, progress, errors

### Technical Considerations

- Authentication: Internal API key or Cloudflare Access service token
- Validation: Zod schemas for request bodies
- Transactions: Use PostgreSQL transactions for multi-table updates
- Idempotency: Upserts with ON CONFLICT for safe retries

### Files to Create/Modify

```
worker/src/routes/enrich.ts    # New route file for enrichment endpoints
worker/src/schemas/enrich.ts   # Zod validation schemas
worker/src/services/db.ts      # Database helper functions
```

---

## Phase 2: bendv3 Cache Simplification (1-2 hours)

### Objective
Remove redundant KV caching for Alexandria lookups. Alexandria's PostgreSQL IS the cache.

### Deliverables

1. **Simplify alexandria-api.ts**
   - Remove KV cache wrapper for ISBN lookups
   - Keep circuit breaker (still needed)
   - Direct fetch → normalize → return

2. **Add enrichment POST capability**
   - When Google Books fallback is used, POST result to Alexandria
   - Fire-and-forget with ctx.waitUntil()

3. **Update cache-service.js**
   - Keep for user data caching
   - Remove book metadata caching paths

4. **Audit wrangler.jsonc**
   - Identify which KV bindings are still needed
   - Document what each binding is for

### Code Changes

```typescript
// BEFORE (current alexandria-api.ts)
export async function searchAlexandriaByISBN(...) {
  const cache = createCacheService(kvNamespace, 'alex', env, ctx);
  const cached = await cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  // ... fetch from Alexandria
  await cache.put(cacheKey, JSON.stringify(result), hotTtl, coldTtl);
}

// AFTER (simplified)
export async function searchAlexandriaByISBN(...) {
  return withCircuitBreaker('alexandria', env, async () => {
    const response = await fetch(`${ALEXANDRIA_BASE_URL}/api/isbn?isbn=${isbn}`);
    return normalizeAlexandriaResponse(await response.json());
  });
}
```

---

## Phase 3: Alexandria Enrichment Processor (3-4 hours)

### Objective
Build background worker that processes enrichment_queue and fetches from ISBNdb/Google Books.

### Deliverables

1. **Cloudflare Cron Handler**
   - Runs every 15 minutes (or configurable)
   - Pulls N items from enrichment_queue (priority DESC, created_at ASC)
   - Processes each item through provider chain

2. **Provider Fetchers (at Alexandria level)**
   - ISBNdb client with rate limiting
   - Google Books client
   - Wikidata client (for author enrichment)

3. **Enrichment Orchestrator**
   - For each queue item:
     - Try providers in priority order
     - Merge results into enriched_* tables
     - Update quality scores
     - Log all operations to enrichment_log
     - Mark queue item completed/failed

4. **Quality Scoring Algorithm**
   - Calculate isbndb_quality (0-100)
   - Calculate completeness_score (0-100)
   - Track which providers contributed

### Cron Schedule Options

```jsonc
// wrangler.jsonc (Alexandria)
"triggers": {
  "crons": [
    "*/15 * * * *"  // Every 15 minutes - process enrichment queue
  ]
}
```

### Provider Priority

1. **ISBNdb** (highest quality, paid)
   - Detailed metadata, accurate ISBNs
   - Rate limited (1 req/sec)
   - Use for: page_count, publisher, publication_date, description

2. **Google Books** (good quality, free)
   - Cover images, descriptions
   - Categories/subjects
   - Use for: covers, subjects, fallback metadata

3. **Wikidata** (author enrichment)
   - Birth/death years, nationality
   - Gender, cultural region
   - Use for: author biographical data

4. **OpenLibrary API** (baseline)
   - Already have dump, but can fetch updates
   - Use for: linking work_key ↔ edition_key

---

## Phase 4: Warming Strategy Overhaul (2 hours)

### Objective
Repurpose bendv3's warming infrastructure or remove it entirely.

### Analysis of Current Warming

| Warming Type | Current Target | New Target | Action |
|--------------|----------------|------------|--------|
| Popular books | bendv3 KV | Alexandria | MOVE or REMOVE |
| Author bibliography | bendv3 KV | Alexandria | REMOVE (already indexed) |
| Analytics-driven | bendv3 KV | Alexandria | MOVE to enrichment_queue |

### Deliverables

1. **Audit current warming code**
   - What does `0 */6 * * *` actually do?
   - What does `0 * * * *` (hourly) do?
   - Are these still useful?

2. **Decision per warming type**
   - Option A: Move to Alexandria as enrichment_queue inserts
   - Option B: Remove entirely (PostgreSQL is already warm)
   - Option C: Keep for user-specific data only

3. **Update wrangler.jsonc (bendv3)**
   - Remove book-related crons
   - Keep user data crons

---

## Phase 5: OpenLibrary Update Strategy (4-6 hours)

### Objective
Keep Alexandria's OpenLibrary data current with new releases and edits.

### Options

1. **Monthly Full Dump Refresh**
   - Download new dump monthly
   - TRUNCATE and reload tables
   - Preserves enriched_* tables (different tables)
   - Pros: Simple, guaranteed fresh
   - Cons: Downtime, bandwidth

2. **Incremental Updates via API**
   - Use OpenLibrary's Recent Changes API
   - Poll for edits since last sync
   - Update only changed records
   - Pros: Real-time, minimal bandwidth
   - Cons: Complex, API rate limits

3. **Hybrid Approach (Recommended)**
   - Monthly full dump for base tables (editions, works, authors)
   - Daily incremental for enriched_* tables
   - Use OpenLibrary Recent Changes for new releases

### Implementation

```sql
-- Track last sync time
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Store last OpenLibrary sync timestamp
INSERT INTO sync_metadata (key, value) VALUES ('ol_last_sync', '2025-11-29T00:00:00Z');
```

---

## Success Metrics

### Phase 1 Complete When:
- [ ] Can POST new edition to Alexandria and verify in database
- [ ] Can queue item for enrichment and see it in enrichment_queue
- [ ] Enrichment log captures all operations

### Phase 2 Complete When:
- [ ] Alexandria ISBN lookup has NO KV cache overhead
- [ ] Google Books fallback POSTs results to Alexandria
- [ ] Latency unchanged or improved (target: <30ms p95)

### Phase 3 Complete When:
- [ ] Cron runs every 15 minutes and processes queue
- [ ] ISBNdb enrichment populates quality metadata
- [ ] enrichment_log shows successful provider calls

### Phase 4 Complete When:
- [ ] bendv3 warming code audited and documented
- [ ] Unnecessary warming removed
- [ ] Any remaining warming targets Alexandria

### Phase 5 Complete When:
- [ ] Strategy chosen and documented
- [ ] Sync script/cron implemented
- [ ] Can verify new OpenLibrary releases appear in Alexandria

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ISBNdb rate limits | High | Medium | Implement backoff, queue prioritization |
| Database bloat | Low | Low | enriched_* tables are separate from base |
| Hyperdrive connection limits | Low | High | Monitor, scale if needed |
| bendv3 regression | Medium | High | Feature flags, gradual rollout |

---

## Open Questions

1. **Authentication for write endpoints** - Service token? API key? Cloudflare Access?
2. **Enrichment priority algorithm** - How to prioritize what gets enriched first?
3. **Cost budgeting for ISBNdb** - How many enrichments per month?
4. **bendv3 D1 migration** - Pause entirely? It's storing book data that should be in Alexandria.

---

## Next Steps

1. ✅ Document phase plan (this file)
2. 🔄 Generate detailed implementation plan with Grok
3. ⏳ Implement Phase 1 (write endpoints)
4. ⏳ Implement Phase 2 (simplify bendv3)
5. ⏳ Implement Phase 3 (enrichment processor)

---

**Last Updated:** November 29, 2025
