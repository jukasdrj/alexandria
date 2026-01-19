# Alexandria Search API Endpoints Documentation

**Version**: v2.8.0
**Last Updated**: 2026-01-14

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

### 1. Combined Search Endpoint (Recommended) 🆕

**Endpoint**: `GET /api/search/combined`

**Description**: Unified search endpoint with automatic query type detection. Intelligently detects whether the query is an ISBN, author name, or book title and routes to the appropriate search logic. This is the **recommended endpoint** for most use cases due to its simplicity and intelligent caching.

**Auto-Detection Logic**:
1. **ISBN Detection** (Priority 1): Matches 10 or 13 digit patterns (e.g., `9780439064873`, `978-0-439-06487-3`, `043906487X`)
2. **Author Detection** (Priority 2): Matches 2-4 word capitalized names (e.g., `J. K. Rowling`, `Stephen King`) with exact match validation against database
3. **Title Search** (Fallback): All other queries use fuzzy title search with PostgreSQL trigram similarity

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | yes | - | Search query (1-200 characters) - automatically detects ISBN, author, or title |
| `limit` | number | optional | 10 | Results per page (max: 100) |
| `offset` | number | optional | 0 | Starting position for pagination |
| `nocache` | boolean | optional | false | Bypass cache (for testing) |

**Caching Strategy**:
- **ISBN searches**: Cached for 24 hours (editions rarely change)
- **Author searches**: Cached for 1 hour (new works added occasionally)
- **Title searches**: Cached for 1 hour (content updates)
- Cache key includes: query type, normalized query, limit, and offset

**Response Structure**:
```json
{
  "success": true,
  "data": {
    "query": {
      "original": "harry potter",
      "detected_type": "title",
      "normalized": "harry potter",
      "confidence": "medium"
    },
    "results": [
      {
        "title": "Harry Potter and the Philosopher's Stone",
        "authors": [
          {
            "name": "J. K. Rowling",
            "key": "/authors/OL23919A",
            "openlibrary": "https://openlibrary.org/authors/OL23919A",
            "gender": "female",
            "nationality": "British",
            "birth_year": 1965,
            "wikidata_id": "Q34660"
          }
        ],
        "isbn": "9780439064873",
        "coverUrl": "https://covers.openlibrary.org/b/id/10521270-L.jpg",
        "coverSource": "external",
        "publish_date": "1999",
        "publishers": "Scholastic",
        "pages": 309,
        "work_title": "Harry Potter and the Philosopher's Stone",
        "openlibrary_edition": "https://openlibrary.org/books/OL26331930M",
        "openlibrary_work": "https://openlibrary.org/works/OL82563W",
        "binding": "Paperback"
      }
    ],
    "pagination": {
      "limit": 10,
      "offset": 0,
      "total": 47,
      "hasMore": true,
      "returnedCount": 10
    },
    "metadata": {
      "cache_hit": false,
      "response_time_ms": 142,
      "source": "database"
    }
  },
  "meta": {
    "requestId": "cf-abc123",
    "timestamp": "2026-01-04T22:15:30.123Z"
  }
}
```

**Examples**:

```bash
# ISBN search (auto-detected)
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873'
# → Returns: detected_type: "isbn", confidence: "high"

# Author search (auto-detected)
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=J.%20K.%20Rowling'
# → Returns: detected_type: "author", confidence: "high"

# Title search (fallback)
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=harry%20potter'
# → Returns: detected_type: "title", confidence: "medium"

# Pagination
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=fantasy&limit=20&offset=40'
# → Returns results 41-60

# Bypass cache (for testing)
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873&nocache=true'
```

**Performance**:
- Query type detection overhead: <20ms
- ISBN detection: <1ms (regex pattern matching)
- Author detection: <10ms (indexed database lookup)
- Total response time varies by search type and cache status

**Error Responses**:

```json
// 400 Bad Request - Empty query
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Query must not be empty"
  }
}

// 400 Bad Request - Query too long
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Query too long (max 200 characters)"
  }
}

// 500 Internal Server Error
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Search failed: Database connection error"
  }
}
```

---

### 2. Main Search Endpoint

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
      "authors": [
        {
          "name": "J. K. Rowling",
          "key": "/authors/OL23919A",
          "openlibrary": "https://openlibrary.org/authors/OL23919A"
        }
      ],
      "isbn": "9780439064873",
      "coverUrl": "https://alexandria.ooheynerds.com/covers/9780439064873/large",
      "coverSource": "enriched-cached",
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

**Note on Authors Field**: The `authors` field is an array of author objects, supporting books with multiple authors. Each author object includes:
- `name`: The author's display name
- `key`: OpenLibrary author key (e.g., `/authors/OL23919A`)
- `openlibrary`: Full OpenLibrary URL for the author

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


### 6. Cover Status Check

**Endpoint**: `GET /api/covers/status/{isbn}`

**Description**: Check if a cover exists in R2 storage and get metadata.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isbn` | string | yes | ISBN-10 or ISBN-13 |

**Response** (Cover Exists):
```json
{
  "exists": true,
  "isbn": "9780439064873",
  "format": "webp",
  "sizes": {
    "large": 45678,
    "medium": 23456,
    "small": 12345
  },
  "uploaded": "2026-01-15T12:00:00.000Z",
  "urls": {
    "large": "/covers/9780439064873/large",
    "medium": "/covers/9780439064873/medium",
    "small": "/covers/9780439064873/small"
  }
}
```

**Response** (Cover Not Found):
```json
{
  "exists": false,
  "isbn": "9780439064873"
}
```

**Example**:
```bash
curl 'https://alexandria.ooheynerds.com/api/covers/status/9780439064873'
```

**Performance**: ~50-100ms

---

### 7. Queue Cover Processing

**Endpoint**: `POST /api/covers/queue`

**Description**: Queue multiple covers for background processing (max 100). Replaces legacy batch endpoint.

**Request Body**:
```json
{
  "books": [
    {
      "isbn": "9780439064873",
      "work_key": "/works/OL45804W",
      "priority": "normal",
      "title": "Harry Potter",
      "author": "J.K. Rowling"
    }
  ]
}
```

**Response**:
```json
{
  "queued": 1,
  "failed": 0,
  "errors": []
}
```

**Example**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/queue' \
  -H 'Content-Type: application/json' \
  -d '{"books": [{"isbn": "9780439064873"}]}'
```

---

## Enrichment Endpoints

### 8. Enrich Edition

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

### 9. Enrich Work

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

### 10. Enrich Author

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

### 11. Queue Enrichment Job

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

### 12. Check Enrichment Status

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

## Batch & Bulk Operations

### 13. Direct Batch Enrichment

**Endpoint**: `POST /api/enrich/batch-direct`

**Description**: Directly enriches up to 1000 ISBNs in a single request, bypassing the queue for maximum efficiency. This endpoint calls the ISBNdb Premium batch API.

**Request Body**:
```json
{
  "isbns": ["9780439064873", "9781492666868", "9780545010221"],
  "source": "batch-direct"
}
```

**Response**:
```json
{
    "requested": 3,
    "found": 3,
    "enriched": 3,
    "failed": 0,
    "not_found": 0,
    "covers_queued": 3,
    "errors": [],
    "api_calls": 1,
    "duration_ms": 1521
}
```

### 14. Batch Enrichment Queuing

**Endpoint**: `POST /api/enrich/queue/batch`

**Description**: Queues up to 100 books for background enrichment. This is suitable for less urgent processing.

**Request Body**:
```json
{
  "books": [
    { "isbn": "9780439064873", "priority": "high" },
    { "isbn": "9780545010221" }
  ]
}
```

**Response**:
```json
{
  "queued": 2,
  "failed": 0,
  "errors": []
}
```

### 15. Top Authors

**Endpoint**: `GET /api/authors/top`

**Description**: Retrieves the top authors by work count. This is useful for bulk data harvesting and is cached for 24 hours.

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | optional | 100 | Results per page (max: 1000) |
| `offset` | number | optional | 0 | Starting position for pagination |

**Response**:
```json
{
  "authors": [
    {
      "author_key": "/authors/OL34184A",
      "author_name": "Agatha Christie",
      "work_count": 2316
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 1,
    "returned": 1
  },
  "cached": false,
  "query_duration_ms": 19876
}
```

---

## Author Endpoints

### 16. Author Details

**Endpoint**: `GET /api/authors/:key`

**Description**: Retrieves comprehensive author details including biographical information and Wikidata diversity data (gender, nationality, birth/death information).

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | Author key (with or without `/authors/` prefix) |

**Accepts both formats**:
- `OL23919A` (short form)
- `/authors/OL23919A` (full form)

**Response**:
```json
{
  "author_key": "/authors/OL23919A",
  "name": "J. K. Rowling",
  "gender": "female",
  "gender_qid": "Q6581072",
  "nationality": "United Kingdom",
  "citizenship_qid": "Q145",
  "birth_year": 1965,
  "death_year": null,
  "birth_place": "Yate",
  "birth_place_qid": "Q1008225",
  "birth_country": "United Kingdom",
  "birth_country_qid": "Q145",
  "death_place": null,
  "death_place_qid": null,
  "bio": "British author, best known for the Harry Potter series...",
  "bio_source": "wikidata",
  "wikidata_id": "Q34660",
  "openlibrary_author_id": "/authors/OL23919A",
  "goodreads_author_ids": ["1077326"],
  "wikidata_enriched_at": "2025-12-12T10:30:00Z",
  "query_duration_ms": 12
}
```

**Examples**:
```bash
# Using short form
curl 'https://alexandria.ooheynerds.com/api/authors/OL23919A' | jq .

# Using full form (URL-encoded)
curl 'https://alexandria.ooheynerds.com/api/authors/%2Fauthors%2FOL23919A' | jq .
```

**Error Response** (404):
```json
{
  "error": "Author not found",
  "author_key": "/authors/OL23919A"
}
```

**Performance**: ~10-30ms

**Fields Explanation**:
- **Diversity fields**: Gender, nationality, birth/death locations from Wikidata
- **QID fields**: Wikidata entity IDs for programmatic access
- **bio_source**: Indicates data source (wikidata, openlibrary, etc.)
- **wikidata_enriched_at**: Timestamp of last Wikidata enrichment

---

### 17. Enrich Authors with Wikidata

**Endpoint**: `POST /api/authors/enrich-wikidata`

**Description**: Batch enriches authors with Wikidata diversity and biographical data. Queries Wikidata SPARQL endpoint and updates enriched_authors table.

**Request Body**:
```json
{
  "limit": 100,
  "force_refresh": false
}
```

**Parameters**:
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | optional | 100 | Authors to enrich per request (max: 500) |
| `force_refresh` | boolean | optional | false | Re-enrich already enriched authors |

**Behavior**:
- Only enriches authors with existing `wikidata_id`
- Skips authors already enriched (unless `force_refresh: true`)
- Prioritizes authors with partial data over empty records
- Processes in batches to respect Wikidata rate limits

**Response**:
```json
{
  "processed": 100,
  "enriched": 87,
  "already_enriched": 13,
  "failed": 0,
  "errors": [],
  "duration_ms": 3521,
  "wikidata_calls": 2
}
```

**Example**:
```bash
# Enrich 100 authors
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/enrich-wikidata' \
  -H 'Content-Type: application/json' \
  -d '{"limit": 100}'

# Force refresh of already-enriched authors
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/enrich-wikidata' \
  -H 'Content-Type: application/json' \
  -d '{"limit": 50, "force_refresh": true}'
```

**Performance**: ~3-5 seconds for 100 authors (depends on Wikidata response time)

**Wikidata Fields Retrieved**:
- Gender (P21)
- Nationality/Citizenship (P27)
- Birth date (P569) and place (P19)
- Death date (P570) and place (P20)
- Biography/description
- External identifiers (Goodreads, etc.)

**Rate Limiting**: Respects Wikidata SPARQL rate limits by batching queries

---

### 18. Author Enrichment Status

**Endpoint**: `GET /api/authors/enrich-status`

**Description**: Returns statistics on author enrichment progress, showing how many authors have Wikidata data and diversity fields populated.

**Query Parameters**: None

**Response**:
```json
{
  "total_authors": 15423,
  "has_wikidata_id": 8934,
  "wikidata_enriched": 7821,
  "pending_enrichment": 1113,
  "diversity_fields": {
    "has_gender": 6543,
    "has_nationality": 5234,
    "has_birth_place": 4876
  }
}
```

**Example**:
```bash
curl 'https://alexandria.ooheynerds.com/api/authors/enrich-status' | jq .
```

**Performance**: ~50-200ms (depends on table size)

**Fields Explanation**:
- **total_authors**: Total authors in enriched_authors table
- **has_wikidata_id**: Authors with Wikidata ID linked
- **wikidata_enriched**: Authors with completed Wikidata enrichment
- **pending_enrichment**: Authors with Wikidata ID but not yet enriched
- **diversity_fields**: Count of authors with specific diversity data populated

**Use Cases**:
- Monitoring enrichment progress
- Identifying gaps in author data
- Planning batch enrichment jobs

---

## Advanced Cover Endpoints

### 19. Work-based Cover Retrieval

**Endpoint**: `GET /api/covers/:work_key/:size`

**Description**: Serves cover images by OpenLibrary work key instead of ISBN. Automatically finds and serves the cover associated with the work, with on-the-fly resizing.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `work_key` | string | yes | OpenLibrary work key (without `/works/` prefix) |
| `size` | string | yes | `large`, `medium`, or `small` |

**Response**: Image binary (JPEG/PNG) or redirect to placeholder

**Headers**:
- `Content-Type`: `image/jpeg`, `image/png`, or `image/webp`
- `Cache-Control`: `public, max-age=31536000, immutable`
- `Access-Control-Allow-Origin`: `*`

**Examples**:
```bash
# Large cover for Harry Potter work
curl 'https://alexandria.ooheynerds.com/api/covers/OL82537W/large' -o cover.jpg

# Medium cover
curl 'https://alexandria.ooheynerds.com/api/covers/OL82537W/medium' -o cover.jpg

# Small thumbnail
curl 'https://alexandria.ooheynerds.com/api/covers/OL82537W/small' -o cover.jpg
```

**Fallback Behavior**:
1. Check R2 for stored cover under `covers/{work_key}/{hash}/original`
2. If not found, redirect to placeholder SVG

**Performance**: ~20-50ms (R2 cache hit)

**Size Specifications**:
- **large**: 800px max dimension
- **medium**: 400px max dimension
- **small**: 200px max dimension

**Note**: This endpoint complements the ISBN-based cover endpoints (`/covers/:isbn/:size`) and is preferred when you have the work key but not a specific ISBN.

---

### 20. Batch Cover Queueing

**Endpoint**: `POST /api/covers/queue`

**Description**: Queues multiple cover processing jobs for background processing. Unlike direct processing, this endpoint queues covers to be processed asynchronously by the alexandria-cover-queue.

**Request Body**:
```json
{
  "books": [
    {
      "isbn": "9780439064873",
      "work_key": "/works/OL82537W",
      "priority": "high",
      "source": "user_request",
      "title": "Harry Potter and the Chamber of Secrets",
      "author": "J. K. Rowling"
    },
    {
      "isbn": "9781492666868",
      "priority": "normal"
    }
  ]
}
```

**Parameters per book**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isbn` | string | yes | ISBN-10 or ISBN-13 |
| `work_key` | string | optional | OpenLibrary work key |
| `priority` | string | optional | `high`, `normal`, or `low` (default: `normal`) |
| `source` | string | optional | Source identifier (default: `unknown`) |
| `title` | string | optional | Book title (for logging) |
| `author` | string | optional | Author name (for logging) |

**Validation**:
- Books array is required
- Maximum 100 books per request
- Invalid ISBNs are reported in failed array

**Response**:
```json
{
  "queued": 2,
  "failed": 0,
  "results": {
    "queued": ["9780439064873", "9781492666868"],
    "failed": []
  }
}
```

**Error Response** (partial failure):
```json
{
  "queued": 1,
  "failed": 1,
  "results": {
    "queued": ["9780439064873"],
    "failed": [
      {
        "isbn": "invalid123",
        "error": "Invalid ISBN format"
      }
    ]
  }
}
```

**Example**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/queue' \
  -H 'Content-Type: application/json' \
  -d '{
    "books": [
      {
        "isbn": "9780439064873",
        "priority": "high",
        "source": "bulk_import"
      },
      {
        "isbn": "9781492666868"
      }
    ]
  }'
```

**Performance**: ~50-100ms (queuing only, processing happens in background)

**Use Cases**:
- Bulk cover processing for imports
- Background cover fetching after enrichment
- Non-blocking cover acquisition

**Queue Processing**:
- Queued covers are processed by alexandria-cover-queue consumer
- Queue configuration: max_batch_size=20, max_retries=3
- Failed jobs move to alexandria-cover-dlq after 3 retries
- Processing includes download, validation, and storage in R2

**Difference from `/covers/batch`**:
- `/covers/batch`: Synchronous processing, max 10 ISBNs, immediate response
- `/api/covers/queue`: Asynchronous queuing, max 100 ISBNs, background processing

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

# Work-based cover retrieval
curl 'https://alexandria.ooheynerds.com/api/covers/OL82537W/large' -o cover.jpg

# Queue batch covers
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/queue' \
  -H 'Content-Type: application/json' \
  -d '{"books": [{"isbn": "9780439064873", "priority": "high"}]}' | jq .
```

### Author Endpoints
```bash
# Get author details (short form)
curl 'https://alexandria.ooheynerds.com/api/authors/OL23919A' | jq .

# Get author details (full form, URL-encoded)
curl 'https://alexandria.ooheynerds.com/api/authors/%2Fauthors%2FOL23919A' | jq .

# Enrich authors with Wikidata
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/enrich-wikidata' \
  -H 'Content-Type: application/json' \
  -d '{"limit": 100}' | jq .

# Check enrichment status
curl 'https://alexandria.ooheynerds.com/api/authors/enrich-status' | jq .
```

---

## Admin & Monitoring Endpoints

These endpoints provide administrative functionality and debugging capabilities for the Alexandria system.

### 21. Interactive Dashboard

**Endpoint**: `GET /`

**Description**: Root endpoint that returns an interactive HTML dashboard with system statistics, quick links to documentation, and endpoint testing interface.

**Response**: HTML page (not JSON)

**Features**:
- Real-time database statistics
- Quick links to all API endpoints
- OpenAPI/Swagger documentation link
- System health status
- R2 storage statistics

**Example**:
```bash
# Open in browser
open https://alexandria.ooheynerds.com/

# Or fetch HTML
curl 'https://alexandria.ooheynerds.com/'
```

**Cache**: 1-hour cache (`max-age=3600`)

---

## API Limits Reference

Alexandria enforces the following limits on batch operations to ensure system stability and fair resource usage:

| Endpoint | Limit | Enforcement | Notes |
|----------|-------|-------------|-------|
| `POST /api/enrich/queue/batch` | 100 books max | Returns 400 if exceeded | Background queue processing |
| `POST /covers/batch` | 10 ISBNs max | Zod schema validation | Synchronous cover processing |
| `POST /api/covers/queue` | 100 books max | Returns 400 if exceeded | Background cover queue |
| `POST /api/enrich/batch-direct` | 1000 ISBNs max | Returns 400 if exceeded | Direct ISBNdb Premium batch call |

**Rationale**:

- **Queue limits (100)**: Cloudflare Queues has a hard limit of 100 messages per batch (`max_batch_size`)
- **ISBNdb limits (1000)**: ISBNdb Premium supports up to 1000 ISBNs per batch API call
- **Synchronous limits (10)**: Lower limits for synchronous operations to prevent Worker CPU timeout

**Best Practices**:

1. **Use `/api/enrich/batch-direct` for bulk operations** (up to 1000 ISBNs) - Most efficient for large imports
2. **Use queue endpoints for background processing** (up to 100 per request) - Non-blocking, reliable
3. **Use synchronous endpoints for small batches** (up to 10) - Immediate results, good for user-facing operations

**Example Error Response** (400):
```json
{
  "error": "Too many ISBNs (max 1000)"
}
```

---

## See Also

- **ISBNdb Integration**: `ISBNDB-ENDPOINTS.md`
- **ISBNdb Enrichment**: `ISBNDB-ENRICHMENT.md`
- **Architecture**: `../infrastructure/INFRASTRUCTURE.md`
- **Project Guidance**: `../../CLAUDE.md`

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
✅ **Admin endpoints**: Queue management, R2 inspection, interactive dashboard
✅ **Batch limits**: Up to 1000 ISBNs for direct batch enrichment

**Performance Benchmarks**:
- ISBN search: ~10-50ms (indexed)
- Title search: ~50-200ms (ILIKE scan)
- Author search: ~100-300ms (multi-table join)
- Stats query: ~6-10s (counts 54M rows)
- Cover retrieval: ~10-30ms (R2 cache hit)

All endpoints are production-ready and fully tested.
