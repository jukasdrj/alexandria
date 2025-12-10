# Alexandria Development Roadmap

Current status and next steps for development.

---

## 🚨 CRITICAL: Active Work

### Author Enrichment Expansion (ACTIVE)
**Status:** Ready to scale
**Priority:** HIGH

**Completed (December 10, 2025):**
1. ✅ ISBNdb Premium upgrade (3x rate, 10x batch)
2. ✅ `/api/enrich/batch-direct` endpoint (bypasses queue limits)
3. ✅ Fixed bibliography pagination (ISBNdb doesn't return `total`)
4. ✅ Callie Hart test: 167 books → 82 enriched, 1 API call

**Next Steps:**
1. Run author expansion script on full library CSV
2. Monitor cover queue processing
3. Verify enriched data quality in database
4. Consider Durable Object buffer (GitHub #82) if queue bottlenecks appear

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

### Workflow
1. Get author bibliography from ISBNdb (`/api/authors/bibliography`)
2. Filter to new ISBNs not already in enriched_editions
3. Call batch-direct endpoint to enrich all ISBNs in one ISBNdb API call
4. Cover images automatically queued during enrichment

### Current Scripts
- `scripts/expand-author-bibliographies.js` - Bulk author enrichment with checkpointing
- `scripts/e2e-author-enrichment-test.js` - E2E test for full pipeline

### Remaining Tasks
- [ ] **Run large-scale author expansion** - Process authors from CSV library
  - Script supports checkpointing for resume after interruption
  - Checkpoint file: `data/author-expansion-checkpoint.json`
- [ ] **Verify cover queue processing** - Ensure covers are downloaded after enrichment
- [ ] **Monitor enriched table growth** - Track new editions, works, authors added
- [ ] **Add author deduplication** - Handle "Stephen King" vs "Stephen King & Owen King"
- [ ] **GitHub #82: Durable Object buffer** - Optional optimization for queue batching

### Efficiency Notes
- Bibliography API: 1 call per author (paginated, 100 books/page)
- Enrichment: 1 API call per 1000 ISBNs (batch-direct endpoint)
- Example: 50 authors × ~80 books/author = 4000 ISBNs = 4 ISBNdb batch calls
- Cover queue: Async processing, no rate limit on our side

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
- `POST /api/authors/bibliography` - Get author's books from ISBNdb ⭐ NEW

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

**Last Updated:** December 10, 2025
