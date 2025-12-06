# Alexandria Development Roadmap

Current status and next steps for development.

---

## 🚨 CRITICAL: Active Work

### Post-Migration Optimization (NEXT)
**Status:** Ready to begin
**Priority:** HIGH

**Completed Migrations (December 5, 2025):**
1. ✅ enriched_works: 21.25M records (12:30 PM)
2. ✅ enriched_editions: 28.58M records (4:08 PM)
3. ✅ enriched_authors: 8.15M records (8:12 PM)

**Next Steps:**
1. Run ANALYZE on all enriched tables
2. Switch search endpoints to query enriched tables
3. Add KV caching for popular searches (#39)
4. Implement rate limiting (#40)

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
- [ ] Implement rate limiting per IP - Issue #40
- [ ] Monitor and optimize slow queries
- [ ] Add CDN caching headers
- [ ] Verify bendv3 integration

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
- `GET /api/search?title={title}` - Title search (ILIKE - slow!)
- `GET /api/search?author={author}` - Author search (ILIKE - slow!)
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
- `POST /api/enrich/queue` - Queue job
- `GET /api/enrich/status/:id` - Job status

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

**Last Updated:** December 6, 2025
