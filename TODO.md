# Alexandria Development Roadmap

Current status and next steps for development.

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

---

## Current API Endpoints

**Search:**
- `GET /api/search?isbn={isbn}` - ISBN lookup
- `GET /api/search?title={title}` - Title search
- `GET /api/search?author={author}` - Author search
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

## Phase 3: Performance & Search Optimization

- [ ] Add pg_trgm extension for fuzzy text search
- [ ] Create GIN indexes for title/author search
- [ ] Add query result caching (KV)
- [ ] Implement rate limiting per IP
- [ ] Monitor and optimize slow queries
- [ ] Add CDN caching headers

## Phase 4: Advanced Features

- [ ] Combined search (`/api/search?q={query}`)
- [ ] Pagination support for search results
- [ ] Export results (CSV, JSON)
- [ ] Search analytics tracking

## Phase 5: Operations

- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Error monitoring/alerting
- [ ] Performance benchmarks
- [ ] Disaster recovery plan

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

# Infrastructure check
./scripts/tunnel-status.sh
./scripts/db-check.sh
```
