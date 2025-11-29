# Alexandria Integration Roadmap

**Created**: November 28, 2025
**Purpose**: Integrate Alexandria (local OpenLibrary dump) with BooksTrack backend as a FREE alternative to OpenLibrary's public API.

---

## 🎯 Strategic Vision

Alexandria provides a **self-hosted, free, fast** book data source with:
- **54.8M editions** / **49.3M ISBNs** / **40.1M works** / **14.7M authors**
- No rate limits (your infrastructure)
- Sub-100ms response times via Cloudflare edge
- Full control over data and indexes
- Potential for custom enrichment

**Goal**: Use Alexandria as the PRIMARY provider for ISBN lookups in bendv3, with fallback to Google Books and remote OpenLibrary when needed.

---

## 📊 Current State

### Alexandria (This Repo)
- ✅ Phase 1: Infrastructure (Tunnel + Worker)
- ✅ Phase 2: ISBN lookup API (`/api/isbn?isbn=XXX`)
- ⏳ Phase 3: Title/Author search (NOT YET IMPLEMENTED)
- ⏳ Phase 4: Full REST API

### bendv3 Integration Status
- ❌ Not yet integrated
- Current providers: Google Books, OpenLibrary (remote), ISBNdb

---

## 🚀 Phase 1: Expand Alexandria API (Priority: HIGH)

### 1.1 Add Title Search Endpoint
```
GET /api/search?title={title}&limit={n}
```

**Implementation**:
```sql
SELECT DISTINCT
    w.data->>'title' AS title,
    a.data->>'name' AS author,
    e.data->>'cover' AS cover,
    w.key AS work_key,
    e.key AS edition_key
FROM works w
JOIN editions e ON e.work_key = w.key
LEFT JOIN author_works aw ON aw.work_key = w.key
LEFT JOIN authors a ON aw.author_key = a.key
WHERE w.data->>'title' ILIKE '%{title}%'
LIMIT {n}
```

**Required Indexes** (run in psql):
```sql
-- Create trigram extension for ILIKE performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on title for fast text search
CREATE INDEX CONCURRENTLY idx_works_title_trgm 
ON works USING GIN ((data->>'title') gin_trgm_ops);
```

### 1.2 Add Author Search Endpoint
```
GET /api/search?author={author}&limit={n}
```

**Implementation**: Similar to title search with index on authors table.

### 1.3 Add Combined Search Endpoint
```
GET /api/search?q={query}&limit={n}
```

Searches across title, author, and ISBN simultaneously.

### 1.4 Match bendv3 Response Format

Update Alexandria responses to match bendv3's `NormalizedResponse` structure:
```javascript
{
  works: [
    {
      title: "...",
      subjectTags: [],
      coverImageURL: "...",
      openLibraryWorkID: "OL...",
      // ... other WorkDTO fields
    }
  ],
  editions: [
    {
      isbn: "...",
      isbns: [...],
      title: "...",
      // ... other EditionDTO fields  
    }
  ],
  authors: [
    {
      name: "...",
      gender: "Unknown"
    }
  ]
}
```

---

## 🔧 Phase 2: bendv3 Integration (See bendv3 TODO)

After Alexandria API is expanded, bendv3 will:
1. Add Alexandria as a new provider
2. Prioritize Alexandria for ISBN lookups
3. Use Alexandria as fallback for title/author search

---

## 📦 Phase 3: Data Sync Strategy

### Option A: Monthly Dump Updates (Recommended)
OpenLibrary releases monthly data dumps.

**Workflow**:
1. Download new dump from OpenLibrary
2. Import into staging PostgreSQL
3. Run diff against current data
4. Apply incremental updates to production
5. Update indexes

**Script Location**: `scripts/sync-openlibrary.sh`

### Option B: Real-time API Sync (Complex)
- Listen for changes via OpenLibrary's Recent Changes API
- Apply incremental updates in real-time
- More complex but keeps data fresh

### Option C: Hybrid Approach
- Monthly dumps for bulk data
- Real-time sync for high-priority books (recently searched)

---

## 📝 Implementation Tasks

### Week 1: Title/Author Search
- [ ] Add pg_trgm extension to PostgreSQL
- [ ] Create GIN indexes for text search
- [ ] Implement `/api/search` endpoint
- [ ] Add pagination support
- [ ] Test search performance with EXPLAIN ANALYZE
- [ ] Update OpenAPI spec

### Week 2: Response Format Alignment
- [ ] Create Alexandria-specific normalizer
- [ ] Map Alexandria fields to bendv3 DTOs
- [ ] Handle missing fields gracefully
- [ ] Add cover image URL generation
- [ ] Test with bendv3 test suite

### Week 3: Performance Optimization
- [ ] Add response caching headers
- [ ] Implement query result caching
- [ ] Add rate limiting (optional)
- [ ] Monitor query performance
- [ ] Optimize slow queries

### Week 4: Data Sync Pipeline
- [ ] Create dump download script
- [ ] Create incremental update script
- [ ] Document sync process
- [ ] Set up monthly cron job
- [ ] Create monitoring alerts

---

## 🔍 Database Enhancement Ideas

### Additional Indexes for Performance
```sql
-- ISBN-13 to ISBN-10 conversion index
CREATE INDEX idx_edition_isbns_isbn10 ON edition_isbns (substring(isbn, 4, 9));

-- Author name search
CREATE INDEX idx_authors_name_trgm ON authors USING GIN ((data->>'name') gin_trgm_ops);

-- Publication year for filtering
CREATE INDEX idx_works_first_pub_year ON works ((data->>'first_publish_year'));

-- Subject/genre search
CREATE INDEX idx_works_subjects_gin ON works USING GIN ((data->'subjects'));
```

### Custom Tables for BooksTrack
```sql
-- Local enrichment cache (for data not in OpenLibrary)
CREATE TABLE local_enrichment (
    isbn VARCHAR(13) PRIMARY KEY,
    cover_url TEXT,
    page_count INTEGER,
    publisher TEXT,
    enriched_at TIMESTAMP DEFAULT NOW()
);

-- Search popularity tracking
CREATE TABLE search_analytics (
    query_type VARCHAR(20),
    query_value TEXT,
    search_count INTEGER DEFAULT 1,
    last_searched TIMESTAMP DEFAULT NOW()
);
```

---

## 📚 Resources

- OpenLibrary Data Dumps: https://openlibrary.org/developers/dumps
- OpenLibrary API Docs: https://openlibrary.org/dev/docs/api
- bendv3 API Contract: `/Users/juju/dev_repos/bendv3/docs/API_CONTRACT.md`
- bendv3 Normalizers: `/Users/juju/dev_repos/bendv3/src/services/normalizers/`

---

## ✅ Success Criteria

- [ ] Alexandria handles 90%+ of ISBN lookups (no external API calls)
- [ ] Title/author search returns results in <500ms
- [ ] Data freshness within 30 days of OpenLibrary
- [ ] Zero cost for book data API calls
- [ ] Reduced dependency on external APIs

---

**Next Steps**: Start with 1.1 (Title Search Endpoint) - this is the highest value addition for bendv3 integration.
