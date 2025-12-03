# Alexandria Search API Endpoints Documentation

Last Updated: 2025-12-03

## Overview

Alexandria provides comprehensive search capabilities across 54.8M book editions, 40.1M works, and 14.7M authors from the OpenLibrary database. All searches support pagination, validation, and intelligent caching.

---

## Base Information

- **Base URL**: `https://alexandria.ooheynerds.com`
- **Authentication**: None required (secured via Cloudflare Access)
- **Rate Limiting**: Managed by Cloudflare
- **Caching**: 24-hour cache for all search queries
- **Response Format**: JSON

---

## Search Endpoints

### 1. Main Search Endpoint

**Endpoint**: `GET /api/search`

**Description**: Universal search supporting ISBN, title, or author queries with Smart Resolution for ISBNs not in the database.

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `isbn` | string | conditional* | - | ISBN-10 or ISBN-13 (normalized, hyphens removed) |
| `title` | string | conditional* | - | Book title (case-insensitive partial match) |
| `author` | string | conditional* | - | Author name (case-insensitive partial match) |
| `limit` | number | optional | 20 | Results per page (max: 100) |
| `offset` | number | optional | 0 | Starting position for pagination |

*At least one of `isbn`, `title`, or `author` is required.

**Validation**:
- ISBN must be 10 or 13 digits (after normalization)
- Non-alphanumeric characters are stripped from ISBNs
- Missing all three search parameters returns 400 error
- Invalid ISBN format returns 400 error

**Features**:
1. **Smart Resolution** (ISBN only): If ISBN not found in local database, automatically:
   - Queries ISBNdb → Google Books → OpenLibrary
   - Enriches database with metadata
   - Returns enriched result immediately

2. **Cover URL Resolution**:
   - Checks Alexandria R2 cache first
   - Falls back to OpenLibrary covers
   - Returns `coverSource` field: `alexandria`, `external`, or `external-fallback`

3. **Join Optimization**:
   - ISBN queries use indexed `edition_isbns` table
   - Title/author queries use `DISTINCT ON` to avoid duplicates
   - All queries count totals in parallel with data fetch

**Response Structure**:
```json
{
  "query": {
    "isbn": "9780439064873",
    "title": null,
    "author": null
  },
  "query_duration_ms": 45,
  "results": [
    {
      "title": "Harry Potter and the Chamber of Secrets",
      "author": "J. K. Rowling",
      "isbn": "9780439064873",
      "coverUrl": "https://alexandria.ooheynerds.com/covers/9780439064873/large",
      "coverSource": "alexandria",
      "publish_date": "2000-09",
      "publishers": ["Scholastic"],
      "pages": "341",
      "work_title": "Harry Potter and the Chamber of Secrets",
      "openlibrary_edition": "https://openlibrary.org/books/OL17143778M",
      "openlibrary_work": "https://openlibrary.org/works/OL82537W"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 4,
    "hasMore": false,
    "returnedCount": 4
  }
}
```

**Examples**:

```bash
# ISBN search (exact match)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9780439064873'

# ISBN with hyphens (auto-normalized)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=978-0-439-06487-3'

# Title search (partial match)
curl 'https://alexandria.ooheynerds.com/api/search?title=harry%20potter&limit=10'

# Author search with pagination
curl 'https://alexandria.ooheynerds.com/api/search?author=rowling&limit=20&offset=40'

# Title search with pagination
curl 'https://alexandria.ooheynerds.com/api/search?title=python&limit=5&offset=10'
```

**Performance**:
- ISBN queries: ~10-50ms (indexed lookup)
- Title queries: ~50-200ms (ILIKE scan, consider pg_trgm for production)
- Author queries: ~100-300ms (joins across author_works → works → editions)

**Error Responses**:

```json
// Missing query parameter (400)
{
  "error": "Missing query parameter",
  "message": "Please provide one of: isbn, title, or author."
}

// Invalid ISBN format (400)
{
  "error": "Invalid ISBN format",
  "provided": "123"
}

// Database error (500)
{
  "error": "Database query failed",
  "message": "connection timeout"
}
```

---

### 2. Statistics Endpoint

**Endpoint**: `GET /api/stats`

**Description**: Returns database statistics and table counts.

**Query Parameters**: None

**Caching**: 24-hour cache

**Response**:
```json
{
  "editions": 54881444,
  "isbns": 49318664,
  "works": 40158110,
  "authors": 14717841,
  "query_duration_ms": 6250
}
```

**Example**:
```bash
curl 'https://alexandria.ooheynerds.com/api/stats'
```

**Performance**: ~6-10 seconds (counts 54M+ rows across 4 tables)

---

### 3. Health Check Endpoint

**Endpoint**: `GET /health`

**Description**: System health check with database connectivity and R2 binding status.

**Query Parameters**: None

**Response**:
```json
{
  "status": "ok",
  "database": "connected",
  "r2_covers": "bound",
  "hyperdrive_latency_ms": 18,
  "timestamp": "2025-12-03T20:02:15.123Z"
}
```

**Error Response** (503):
```json
{
  "status": "error",
  "database": "disconnected",
  "r2_covers": "bound",
  "message": "connection timeout"
}
```

**Example**:
```bash
curl 'https://alexandria.ooheynerds.com/health'
```

**Performance**: ~10-30ms

---

## Cover Image Endpoints

### 4. ISBN-based Cover Retrieval

**Endpoint**: `GET /covers/:isbn/:size`

**Description**: Serve cover image by ISBN with automatic fallback to OpenLibrary.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isbn` | string | yes | ISBN-10 or ISBN-13 |
| `size` | string | yes | `large`, `medium`, or `small` |

**Response**: Image binary (JPEG/PNG) or SVG placeholder

**Headers**:
- `Content-Type`: `image/jpeg`, `image/png`, or `image/svg+xml`
- `Cache-Control`: `public, max-age=31536000, immutable`
- `Access-Control-Allow-Origin`: `*`

**Examples**:
```bash
# Large cover
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/large'

# Medium cover
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/medium'

# Small cover
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/small'
```

**Fallback Chain**:
1. Alexandria R2 cache (bookstrack-covers-processed bucket)
2. OpenLibrary covers by ISBN
3. Placeholder SVG

---

### 5. Work-based Cover Processing

**Endpoint**: `POST /api/covers/process`

**Description**: Process and store cover image from provider URL for a work.

**Request Body**:
```json
{
  "work_key": "/works/OL45804W",
  "provider_url": "https://covers.openlibrary.org/b/id/8091323-L.jpg",
  "isbn": "9780439064873"
}
```

**Response**:
```json
{
  "success": true,
  "work_key": "/works/OL45804W",
  "hash": "abc123...",
  "stored_at": "covers/OL45804W/abc123/original"
}
```

**Whitelisted Domains**:
- `books.google.com`
- `covers.openlibrary.org`
- `images.isbndb.com`
- `images-na.ssl-images-amazon.com`
- `m.media-amazon.com`

**Example**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/process' \
  -H 'Content-Type: application/json' \
  -d '{
    "work_key": "/works/OL45804W",
    "provider_url": "https://covers.openlibrary.org/b/id/8091323-L.jpg",
    "isbn": "9780439064873"
  }'
```

---

### 6. ISBN-based Cover Processing

**Endpoint**: `POST /covers/:isbn/process`

**Description**: Trigger cover processing for an ISBN from multiple providers.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isbn` | string | yes | ISBN-10 or ISBN-13 |

**Response**:
```json
{
  "success": true,
  "isbn": "9780439064873",
  "provider": "openlibrary",
  "url": "https://alexandria.ooheynerds.com/covers/9780439064873/large"
}
```

**Example**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/covers/9780439064873/process'
```

---

### 7. Cover Status Check

**Endpoint**: `GET /covers/:isbn/status`

**Description**: Check if a cover exists in R2 cache.

**Response**:
```json
{
  "exists": true,
  "isbn": "9780439064873",
  "sizes": ["large", "medium", "small"]
}
```

**Example**:
```bash
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/status'
```

---

### 8. Batch Cover Processing

**Endpoint**: `POST /covers/batch`

**Description**: Process multiple ISBNs in a single request (max 10).

**Request Body**:
```json
{
  "isbns": ["9780439064873", "9781492666868", "9780545010221"]
}
```

**Response**:
```json
{
  "processed": 3,
  "results": [
    { "isbn": "9780439064873", "success": true },
    { "isbn": "9781492666868", "success": true },
    { "isbn": "9780545010221", "success": false, "error": "not found" }
  ]
}
```

**Example**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/covers/batch' \
  -H 'Content-Type: application/json' \
  -d '{"isbns": ["9780439064873", "9781492666868"]}'
```

---

## Enrichment Endpoints

### 9. Enrich Edition

**Endpoint**: `POST /api/enrich/edition`

**Description**: Store or update edition metadata in enriched_editions table.

**Request Body**:
```json
{
  "edition_key": "/books/OL17143778M",
  "isbn": "9780439064873",
  "title": "Harry Potter and the Chamber of Secrets",
  "authors": ["J. K. Rowling"],
  "publisher": "Scholastic",
  "publish_date": "2000-09",
  "pages": 341,
  "language": "en",
  "description": "Harry Potter's summer has included...",
  "coverUrls": {
    "large": "https://covers.openlibrary.org/b/id/8091323-L.jpg",
    "medium": "https://covers.openlibrary.org/b/id/8091323-M.jpg",
    "small": "https://covers.openlibrary.org/b/id/8091323-S.jpg"
  }
}
```

**Example**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/enrich/edition' \
  -H 'Content-Type: application/json' \
  -d @edition.json
```

---

### 10. Enrich Work

**Endpoint**: `POST /api/enrich/work`

**Description**: Store or update work metadata in enriched_works table.

**Request Body**:
```json
{
  "work_key": "/works/OL82537W",
  "title": "Harry Potter and the Chamber of Secrets",
  "authors": ["J. K. Rowling"],
  "description": "The second book in the Harry Potter series...",
  "first_publish_date": "1998"
}
```

---

### 11. Enrich Author

**Endpoint**: `POST /api/enrich/author`

**Description**: Store or update author biographical data in enriched_authors table.

**Request Body**:
```json
{
  "author_key": "/authors/OL23919A",
  "name": "J. K. Rowling",
  "bio": "British author, best known for the Harry Potter series...",
  "birth_date": "1965-07-31",
  "photo_url": "https://..."
}
```

---

### 12. Queue Enrichment Job

**Endpoint**: `POST /api/enrich/queue`

**Description**: Queue a background enrichment job for processing.

**Request Body**:
```json
{
  "isbn": "9780439064873",
  "priority": "normal"
}
```

---

### 13. Check Enrichment Status

**Endpoint**: `GET /api/enrich/status/:id`

**Description**: Check the status of a queued enrichment job.

**Response**:
```json
{
  "id": "job_123",
  "status": "completed",
  "processed_at": "2025-12-03T20:00:00Z"
}
```

---

## Smart Resolution Feature

### How It Works

When an ISBN search returns no results from the local OpenLibrary database, Smart Resolution automatically:

1. **Queries External APIs** (in order):
   - ISBNdb (preferred, high-quality metadata)
   - Google Books (fallback)
   - OpenLibrary (final fallback)

2. **Enriches Database**:
   - Stores metadata in `enriched_editions` table
   - Processes and caches cover images in R2
   - Links to OpenLibrary work if available

3. **Returns Result**:
   - Returns enriched data immediately
   - Subsequent queries hit local cache
   - No user-visible latency increase

### Configuration

Smart Resolution is enabled by default. Configure via environment:
```javascript
// Disable Smart Resolution
SMART_RESOLUTION_ENABLED=false

// Configure providers
SMART_RESOLUTION_PROVIDERS=isbndb,google,openlibrary
```

### Example Flow

```bash
# First query (ISBN not in OpenLibrary)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9781492666868'
# -> Triggers Smart Resolution
# -> Queries ISBNdb
# -> Stores in enriched_editions
# -> Returns result (~500-800ms)

# Second query (same ISBN)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9781492666868'
# -> Hits enriched_editions cache
# -> Returns immediately (~50ms)
```

---

## Database Schema

### Core Tables (OpenLibrary)

```sql
-- 54.8M book editions
editions (
  key TEXT PRIMARY KEY,
  type TEXT,
  revision INT,
  work_key TEXT,
  data JSONB
)

-- 49.3M ISBN entries (USE THIS FOR ISBN QUERIES!)
edition_isbns (
  edition_key TEXT,
  isbn TEXT,
  PRIMARY KEY (edition_key, isbn)
)
CREATE INDEX idx_edition_isbns_isbn ON edition_isbns(isbn);

-- 40.1M works
works (
  key TEXT PRIMARY KEY,
  type TEXT,
  revision INT,
  data JSONB
)

-- 14.7M authors
authors (
  key TEXT PRIMARY KEY,
  type TEXT,
  revision INT,
  data JSONB
)

-- 42.8M author-work relationships
author_works (
  author_key TEXT,
  work_key TEXT,
  PRIMARY KEY (author_key, work_key)
)
```

### Enrichment Tables

```sql
-- Enriched edition metadata (from external APIs)
enriched_editions (
  edition_key TEXT PRIMARY KEY,
  isbn TEXT,
  work_key TEXT,
  title TEXT,
  authors TEXT[],
  publisher TEXT,
  publish_date TEXT,
  pages INTEGER,
  language TEXT,
  description TEXT,
  cover_url_large TEXT,
  cover_url_medium TEXT,
  cover_url_small TEXT,
  provider TEXT,  -- 'isbndb', 'google', 'openlibrary'
  enriched_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)
CREATE INDEX idx_enriched_editions_isbn ON enriched_editions(isbn);
CREATE INDEX idx_enriched_editions_work_key ON enriched_editions(work_key);

-- Enriched work metadata
enriched_works (
  work_key TEXT PRIMARY KEY,
  title TEXT,
  authors TEXT[],
  description TEXT,
  first_publish_date TEXT,
  enriched_at TIMESTAMP DEFAULT NOW()
)

-- Enriched author biographical data
enriched_authors (
  author_key TEXT PRIMARY KEY,
  name TEXT,
  bio TEXT,
  birth_date TEXT,
  photo_url TEXT,
  enriched_at TIMESTAMP DEFAULT NOW()
)
```

---

## Performance Optimization

### Indexing Strategy

**Critical Indexes** (already exist):
```sql
-- ISBN lookups (most important!)
CREATE INDEX idx_edition_isbns_isbn ON edition_isbns(isbn);

-- Work relationships
CREATE INDEX idx_editions_work_key ON editions(work_key);
CREATE INDEX idx_author_works_work_key ON author_works(work_key);
CREATE INDEX idx_author_works_author_key ON author_works(author_key);
```

**Recommended for Title/Author Search** (consider for production):
```sql
-- pg_trgm for fuzzy text search
CREATE EXTENSION pg_trgm;

-- GIN index for ILIKE performance
CREATE INDEX idx_editions_title_trgm ON editions USING gin ((data->>'title') gin_trgm_ops);
CREATE INDEX idx_authors_name_trgm ON authors USING gin ((data->>'name') gin_trgm_ops);
```

### Caching Strategy

1. **HTTP Caching** (24 hours):
   - All `/api/search` queries cached at Cloudflare edge
   - `/api/stats` cached for 24 hours
   - Cover images cached with `immutable` directive

2. **R2 Cover Cache**:
   - Permanent storage in `bookstrack-covers-processed` bucket
   - Multiple sizes pre-generated (large, medium, small)
   - CDN acceleration via Cloudflare R2

3. **Database Enrichment Cache**:
   - Smart Resolution stores in `enriched_editions`
   - Subsequent queries hit enriched cache first
   - No repeated external API calls

### Query Optimization Tips

1. **ISBN searches are fastest** (~10-50ms):
   - Use `edition_isbns` table (indexed)
   - Normalize ISBN before query (strip hyphens)

2. **Title searches need indexes** (~50-200ms):
   - `ILIKE` scans are slow on 54M rows
   - Consider pg_trgm GIN indexes for production
   - Use `LIMIT` aggressively

3. **Author searches are slowest** (~100-300ms):
   - Requires joins across 3 tables (authors → author_works → works → editions)
   - Results are deduplicated with `DISTINCT ON`
   - Pagination helps manage large result sets

---

## Rate Limiting

Currently managed by Cloudflare's edge network. No explicit rate limits configured.

**Recommended Limits** (for public API):
- **Search endpoints**: 100 requests/minute per IP
- **Cover processing**: 10 requests/minute per IP
- **Batch operations**: 5 requests/minute per IP

---

## Error Handling

All endpoints return standard HTTP status codes:

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Query returned results |
| 400 | Bad Request | Invalid ISBN format, missing parameters |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Database connection failed |
| 503 | Service Unavailable | Health check failed |

**Error Response Format**:
```json
{
  "error": "Brief error description",
  "message": "Detailed error message with context",
  "provided": "Value that caused the error (if applicable)"
}
```

---

## CORS Configuration

All API endpoints support CORS:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## Testing Commands

### Search Endpoints
```bash
# ISBN search
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9780439064873' | jq .

# Title search
curl 'https://alexandria.ooheynerds.com/api/search?title=harry%20potter&limit=5' | jq .

# Author search
curl 'https://alexandria.ooheynerds.com/api/search?author=rowling&limit=5' | jq .

# Pagination test
curl 'https://alexandria.ooheynerds.com/api/search?title=python&limit=3&offset=10' | jq .

# Error test (invalid ISBN)
curl 'https://alexandria.ooheynerds.com/api/search?isbn=123' | jq .
```

### System Endpoints
```bash
# Health check
curl 'https://alexandria.ooheynerds.com/health' | jq .

# Database stats
curl 'https://alexandria.ooheynerds.com/api/stats' | jq .
```

### Cover Endpoints
```bash
# Get cover (redirects to image)
curl -L 'https://alexandria.ooheynerds.com/covers/9780439064873/large' -o cover.jpg

# Check cover status
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/status' | jq .

# Process cover
curl -X POST 'https://alexandria.ooheynerds.com/covers/9780439064873/process' | jq .
```

---

## See Also

- **ISBNdb Integration**: `docs/ISBNDB-ENDPOINTS.md`
- **ISBNdb Enrichment**: `docs/ISBNDB-ENRICHMENT.md`
- **Architecture**: `docs/ARCHITECTURE.md`
- **Project Guidance**: `CLAUDE.md`

---

## Summary

Alexandria provides a comprehensive book search API with:

✅ **3 search modes**: ISBN (exact), title (fuzzy), author (fuzzy)
✅ **Smart Resolution**: Auto-enrichment from ISBNdb/Google Books/OpenLibrary
✅ **Cover caching**: R2 storage with automatic fallback
✅ **54.8M editions**: Full OpenLibrary database
✅ **Fast queries**: Indexed ISBN lookups in ~10-50ms
✅ **Pagination**: Full offset/limit support with total counts
✅ **24-hour caching**: Edge caching for all queries

**Performance Benchmarks**:
- ISBN search: ~10-50ms (indexed)
- Title search: ~50-200ms (ILIKE scan)
- Author search: ~100-300ms (multi-table join)
- Stats query: ~6-10s (counts 54M rows)
- Cover retrieval: ~10-30ms (R2 cache hit)

All endpoints are production-ready and fully tested.
