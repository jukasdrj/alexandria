# Alexandria Development Roadmap

Current status and next steps for development.

---

## 🚨 CRITICAL: Active Work

### Enrichment Migration (IN PROGRESS)
**Status:** Phase 1 Running (Works Migration)  
**Started:** December 3, 2025 at 10:46 AM CST  
**See:** `MIGRATION_STATUS.md` for details

**Order Required (FK Constraints):**
1. ✅ enriched_works (40M) - Running now
2. ⏳ enriched_editions (30M) - After works complete
3. ⏳ enriched_authors (14M) - Parallel with editions

### Issue #35: ILIKE Performance (BLOCKING)
**Priority:** HIGH - Blocks Phase 3  
**Problem:** Current title/author search uses ILIKE which doesn't scale  
**Impact:** Searches can timeout on 54M rows

**Current Code (worker/index.ts:520-550):**
```sql
WHERE e.data->>'title' ILIKE '%' + title + '%'
WHERE a.data->>'name' ILIKE '%' + author + '%'
```

**Solution:** Use pg_trgm GIN indexes (already enabled)

**Fix Steps:**
1. Create GIN indexes on base tables:
```sql
-- On editions table (54M rows)
CREATE INDEX CONCURRENTLY idx_editions_title_trgm 
ON editions USING gin ((data->>'title') gin_trgm_ops);

-- On authors table (14M rows)  
CREATE INDEX CONCURRENTLY idx_authors_name_trgm
ON authors USING gin ((data->>'name') gin_trgm_ops);
```

2. Update queries to use trigram similarity:
```sql
-- Instead of ILIKE, use % operator (requires pg_trgm)
WHERE e.data->>'title' % 'search term'  -- Similarity match
-- Or use word_similarity for phrase matching
WHERE word_similarity('search term', e.data->>'title') > 0.3
```

3. Alternatively, query enriched tables (after migration):
```sql
-- enriched_works already has GIN trigram index
SELECT * FROM enriched_works 
WHERE title % 'harry potter'
ORDER BY similarity(title, 'harry potter') DESC
LIMIT 10;
```

**Estimated Time:** 2-3 hours (index creation on 54M rows takes ~30 min)

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

---

## Phase 3: Performance & Search Optimization

- [ ] **#35 Fix ILIKE performance** (see above - BLOCKING)
- [ ] Add GIN indexes to base tables (editions, authors)
- [ ] Switch search to query enriched tables first
- [ ] Add query result caching (KV)
- [ ] Implement rate limiting per IP
- [ ] Monitor and optimize slow queries
- [ ] Add CDN caching headers

## Phase 4: Enrichment Data Migration

- [ ] Complete works migration (40M rows)
- [ ] Complete editions migration (30M rows)
- [ ] Complete authors migration (14M rows)
- [ ] Run ANALYZE on all enriched tables
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

**Last Updated:** December 3, 2025
