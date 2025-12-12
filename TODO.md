# Alexandria Development Roadmap

Current status and next steps for development.

---

## 🚨 CRITICAL: Active Work

### Bulk Author Harvesting (ACTIVE)
**Status:** Top-100 complete, ready for larger tiers
**Priority:** HIGH

**Completed (December 11, 2025):**
1. ✅ Multi-model consensus on harvesting strategy (gemini-2.5-pro, grok-4-1)
2. ✅ `GET /api/authors/top` endpoint (queries by work count, cached 24h)
3. ✅ `scripts/bulk-author-harvest.js` with checkpoint/resume support
4. ✅ Top-100 tier: 98 authors processed, 9,655 books, 4,918 covers queued
5. ✅ Fixed memory limit errors: reduced batch size 50→10, increased concurrency 3→5
6. ✅ jSquash WebP cover processing working (50-80% compression on large images)

**Issues Created:**
- #84: Skip WebP conversion for small images (negative compression on <5KB images)

**Top-100 Results:**
- Authors processed: 98/100 (2 failed due to ISBNdb 400 errors)
- Books found: 9,655 (all already existed in enriched_editions)
- Covers queued: 4,918 (processing in background)
- Cache hits: 5 (previously enriched authors)

**Next Steps:**
1. [ ] Wait for cover queue to drain (~2 hours)
2. [ ] Run `--tier top-1000` (1,000 authors)
3. [ ] Monitor for memory/CPU limit errors
4. [ ] Fix #84 (WebP small image optimization)

### Post-Migration Optimization (COMPLETE)
**Status:** Done
**Priority:** LOW

**Completed Migrations (December 5, 2025):**
1. ✅ enriched_works: 21.25M records (12:30 PM)
2. ✅ enriched_editions: 28.58M records (4:08 PM)
3. ✅ enriched_authors: 8.15M records (8:12 PM)

### Issue #35: ILIKE Performance - RESOLVED ✅
**Priority:** LOW (was HIGH)  
**Status:** Benchmarked and verified - ILIKE is actually performant!

**Benchmark Results (December 3, 2025):**
```
ILIKE '%harry potter%':     250ms ✅ (uses GIN index)
Similarity operator (%):  48,556ms ❌ (too fuzzy, returns 1M+ candidates)
```

**Key Findings:**
1. GIN trigram indexes ALREADY exist on base tables:
   - `ix_editions_title` - GIN trigram on `data->>'title'`
   - `ix_editions_subtitle` - GIN trigram on `data->>'subtitle'`  
   - `ix_authors_name` - GIN trigram on `data->>'name'`

2. ILIKE with wildcards (`%term%`) properly uses these indexes
3. The similarity operator (`%`) is too fuzzy and causes full table scans
4. Current 250ms performance is acceptable for production

**Recommendation:** Keep ILIKE, add pagination for large result sets

**Optional Future Improvements:**
- Query enriched_works/enriched_editions first (already have GIN indexes)
- Add result caching in KV for popular searches
- Consider full-text search (tsvector) for complex queries

---

## Completed Phases

### Phase 1: Infrastructure (COMPLETE)
- [x] Cloudflare Tunnel on Unraid
- [x] DNS (alexandria-db.ooheynerds.com)
- [x] Worker deployment (alexandria.ooheynerds.com)
- [x] Tunnel connectivity (4 active connections)
- [x] Documentation and deployment scripts

### Phase 2: Database Integration (COMPLETE)
- [x] SSL on PostgreSQL
- [x] Cloudflare Access + Service Token
- [x] Hyperdrive connection pooling
- [x] ISBN/Title/Author search endpoints
- [x] Interactive dashboard at `/`

### Phase 2.5: Cover Image Processing (COMPLETE)
- [x] R2 bucket `bookstrack-covers-processed`
- [x] Work-based cover processing (`POST /api/covers/process`)
- [x] ISBN-based cover processing (`POST /covers/:isbn/process`)
- [x] Cover serving endpoints with size variants
- [x] Domain whitelist security
- [x] Multi-provider fetching (OpenLibrary, ISBNdb, Google Books)

### Phase 2.6: Write/Enrichment Endpoints (COMPLETE)
- [x] `POST /api/enrich/edition` - Store edition metadata
- [x] `POST /api/enrich/work` - Store work metadata
- [x] `POST /api/enrich/author` - Store author metadata
- [x] `POST /api/enrich/queue` - Queue background enrichment
- [x] `GET /api/enrich/status/:id` - Check job status
- [x] Quality scoring and conflict detection

### Phase 2.7: Enrichment Table Schema (COMPLETE)
- [x] 6 tables deployed (enriched_works, enriched_editions, enriched_authors, work_authors_enriched, enrichment_queue, enrichment_log)
- [x] 19 performance indexes (GIN trigram, B-tree)
- [x] 3 auto-update triggers
- [x] FK constraints (editions→works)

### Phase 2.8: Enrichment Data Migration (COMPLETE ✅)
- [x] Works migration: 21.25M rows (Dec 5, 12:30 PM)
- [x] Editions migration: 28.58M rows (Dec 5, 4:08 PM)
- [x] Authors migration: 8.15M rows (Dec 5, 8:12 PM)
- [x] All migrations filtered to ISBN-13 only

**Migration Stats:**
- Works: 83.6% basic, 11.8% with subjects, 2.6% with descriptions
- Editions: 49.6% full metadata, 48.2% good, 1.8% minimal
- Authors: 7.8% with birth years, 0.35% with bios

### Phase 2.9: ISBNdb Premium & Batch Direct (COMPLETE ✅ - Dec 10, 2025)
- [x] Upgraded ISBNdb plan from Basic to Premium
  - Rate limit: 3 req/sec (was 1 req/sec)
  - Batch size: 1000 ISBNs (was 100 ISBNs)
  - Endpoint: `api.premium.isbndb.com` (was `api2.isbndb.com`)
- [x] Added `/api/enrich/batch-direct` endpoint
  - Bypasses Cloudflare Queue's 100-message batch limit
  - Direct call to ISBNdb batch API for 10x efficiency
  - Accepts up to 1000 ISBNs per request
- [x] Fixed author bibliography pagination
  - ISBNdb `/author/{name}` does NOT return `total` field
  - Fixed logic: check if response has full page (100 books) to detect more pages
  - Tested: Callie Hart returns 167 books (2 pages), was incorrectly returning 100
- [x] Updated bibliography endpoint to use Premium endpoint
- [x] Reduced rate limit delay from 1100ms to 350ms

**GitHub Issue Created:**
- #82: "Add Durable Object buffer for queue-based ISBN enrichment" (Phase 2.10, future work)

### Phase 2.10: Efficient Author Enrichment (COMPLETE ✅ - Dec 10, 2025)
- [x] Added `/api/authors/enrich-bibliography` endpoint (most efficient!)
  - Fetches author bibliography AND enriches database in ONE step
  - No double-fetch: uses book data directly from ISBNdb response
  - Caches results in KV for 24 hours (repeat queries = 0 API calls)
  - Only queues cover downloads (unavoidable)
- [x] Updated `expand-author-bibliographies.js` to use new endpoint
  - Single API call per author (was: fetch + separate batch enrichment)
  - Stops gracefully on quota exhaustion (403)
  - Reduced rate limit delay from 2s to 1.5s
- [x] Fixed duplicate `/api/isbns/check` endpoint (was defined twice)
- [x] Documented ISBNdb billing model correctly

**ISBNdb API Billing Clarification:**
- Each API **REQUEST** = 1 call (NOT per-result!)
- Fetching 100 books = 1 call, batch of 1000 ISBNs = 1 call
- Premium plan: ~15,000 daily calls, resets every 24h, does NOT roll over
- Default `/author` pageSize is 20 (can request up to 1000)
- Max 10,000 results total regardless of pagination
- 6MB response size limit (returns 500 if exceeded)

---

## Phase 3: Performance & Search Optimization

- [x] **#35 Fix ILIKE performance** - RESOLVED (ILIKE + GIN indexes work well)
- [x] Run ANALYZE on all enriched tables (Dec 6, 2025)
- [x] Added missing GIN trigram indexes (works.title, works.subtitle)
- [x] Switch search to query enriched tables (Dec 6, 2025)
  - ISBN: Direct lookup on enriched_editions (sub-ms performance)
  - Title: GIN trigram index on enriched_editions.title (~500ms with JOINs)
  - Author: GIN trigram index on enriched_authors.name
  - All queries now return pre-cached cover URLs from enriched tables
- [x] **#39 Add query result caching (KV)** - COMPLETE (Dec 6, 2025)
  - ISBN queries: 24h TTL (exact matches, static data)
  - Title/Author queries: 1h TTL (fuzzy matches)
  - Cache keys: Unique per query type + value + pagination
  - Response includes `cache_hit`, `cached_at`, `cache_age_seconds`, `cache_ttl`
  - Non-blocking cache writes using `waitUntil()`
  - Verified working: Cache hits return instantly without DB query
- [x] **#40 Rate limiting per IP** - CLOSED (Out of scope)
  - API is behind Cloudflare Access (IP whitelist: 47.187.18.143/32)
  - Only accessible from home IP - no public rate limiting needed
  - Future: If opening to public, implement with KV-based rate limiter
- [x] **Enhanced CDN caching headers** (Dec 8, 2025)
  - Added CDN-Cache-Control with stale-while-revalidate=600
  - Added Vary: Accept-Encoding for proper cache separation
  - Applied to /api/search and /api/search/combined endpoints
- [x] **Optimized combined search endpoint** (Dec 8, 2025)
  - Migrated from base JSONB tables to enriched tables
  - ISBN: ~530ms (down from base table queries)
  - Author: ~12s with GIN trigram indexes
  - Pre-cached cover URLs, no async resolution needed
  - See: docs/PERFORMANCE-OPTIMIZATION-DEC8.md
- [x] **CRITICAL FIX: ILIKE vs pg_trgm similarity** (Dec 8, 2025)
  - Identified pg_trgm `%` operator causing 18-36s queries (6.5M rows removed by recheck)
  - Switched all title/author searches to ILIKE pattern matching
  - Performance improvements:
    - Title search: **37x faster** (27.5s → 741ms)
    - Author search: **2.4x faster** (1.5s → 602ms)
    - Combined search: **28x faster** (36s → 1.3s)
  - ILIKE still uses GIN trigram indexes efficiently
  - See: docs/QUERY-OPTIMIZATION-ILIKE-FIX.md
- [ ] Add KV caching for combined search endpoint
- [ ] Verify bendv3 integration

## Phase 4: Author Enrichment Expansion (IN PROGRESS)

**Goal:** Populate Alexandria with rich metadata for all books by known authors.

### Efficient Workflow (Updated Dec 10, 2025)
1. Call `/api/authors/enrich-bibliography` with author name
2. Endpoint fetches bibliography from ISBNdb AND enriches database in ONE step
3. KV cache prevents repeat API calls for same author (24h TTL)
4. Cover images automatically queued during enrichment

**Old workflow (deprecated):**
~~1. Get bibliography → 2. Filter ISBNs → 3. Batch enrich (separate API call)~~

### Current Scripts
- `scripts/expand-author-bibliographies.js` - Bulk author enrichment with checkpointing
  - Now uses efficient `/api/authors/enrich-bibliography` endpoint
  - Stops gracefully on quota exhaustion
- `scripts/e2e-author-enrichment-test.js` - E2E test for full pipeline

### Author CSV Files Available
- `docs/csv_examples/combined_library_expanded.csv` - Original library (519 authors)
- `docs/csv_examples/bestselling_authors_2015_2024.csv` - Fiction bestsellers (197 authors)
- `docs/csv_examples/bestselling_nonfiction_authors.csv` - Nonfiction bestsellers (199 authors)

### Remaining Tasks
- [ ] **Run large-scale author expansion** - Process authors from CSV library
  - Script supports checkpointing for resume after interruption
  - Checkpoint file: `data/author-expansion-checkpoint.json`
  - Wait for ISBNdb quota reset (daily at midnight or billing cycle)
- [ ] **Verify cover queue processing** - Ensure covers are downloaded after enrichment
- [ ] **Monitor enriched table growth** - Track new editions, works, authors added
- [ ] **Add author deduplication** - Handle "Stephen King" vs "Stephen King & Owen King"
- [ ] **GitHub #82: Durable Object buffer** - Optional optimization for queue batching

### Efficiency Notes (Updated)
- **New efficient endpoint**: 1 API call per author does BOTH fetch + enrich
- No separate batch enrichment call needed anymore
- KV caching: Repeat author queries = 0 API calls for 24 hours
- Cover queue: Async processing, no rate limit on our side
- **Example**: 50 authors = ~75 API calls (avg 1.5 pages/author), directly enriches all books

### ISBNdb Quota Planning
- Premium plan: ~15,000 daily calls
- Each author: 1-10 API calls (depends on bibliography size, 100 books/page)
- Estimate: Can process ~1,500-10,000 authors per day depending on bibliography sizes
- Quota resets daily (does NOT roll over)

### Data Quality Considerations
- ISBNdb author search may return co-authored works (filter if needed)
- Some ISBNs may not have cover images available
- Related ISBNs field can help find alternate editions

## Phase 5: Advanced Features

- [ ] Combined search (`/api/search?q={query}`)
- [ ] Pagination support for search results
- [ ] Export results (CSV, JSON)
- [ ] Search analytics tracking
- [ ] Semantic search with embeddings

## Phase 6: Operations

- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Error monitoring/alerting
- [ ] Performance benchmarks
- [ ] Disaster recovery plan

---

## Current API Endpoints

**Search:**
- `GET /api/search?isbn={isbn}` - ISBN lookup
- `GET /api/search?title={title}` - Title search (ILIKE)
- `GET /api/search?author={author}` - Author search (ILIKE)
- `GET /api/stats` - Database statistics

**Covers (Work-based):**
- `POST /api/covers/process` - Process cover from provider URL
- `GET /api/covers/:work_key/:size` - Serve cover (large/medium/small)

**Covers (ISBN-based):**
- `POST /covers/:isbn/process` - Trigger cover processing
- `GET /covers/:isbn/:size` - Serve cover image
- `GET /covers/:isbn/status` - Check cover exists
- `POST /covers/batch` - Batch process (max 10)

**Enrichment:**
- `POST /api/enrich/edition` - Store edition
- `POST /api/enrich/work` - Store work
- `POST /api/enrich/author` - Store author
- `POST /api/enrich/queue` - Queue job (max 100 ISBNs)
- `POST /api/enrich/batch-direct` - Direct batch enrichment (up to 1000 ISBNs) ⭐ NEW
- `GET /api/enrich/status/:id` - Job status

**Author Bibliography:**
- `POST /api/authors/bibliography` - Get author's books from ISBNdb (fetch only)
- `POST /api/authors/enrich-bibliography` - Fetch + enrich in ONE call ⭐ **RECOMMENDED**

**System:**
- `GET /health` - Health check
- `GET /openapi.json` - OpenAPI spec

---

## Quick Commands

```bash
# Development
cd worker/ && npm run dev

# Deploy
npm run deploy

# Logs
npm run tail

# Database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# Check migration progress
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT pid, state, NOW() - query_start AS elapsed
FROM pg_stat_activity WHERE query LIKE '%INSERT INTO enriched%';
\""

# Infrastructure check
./scripts/tunnel-status.sh
./scripts/db-check.sh
```

---

**Last Updated:** December 10, 2025 (ISBNdb billing clarification, efficient enrich-bibliography endpoint)
