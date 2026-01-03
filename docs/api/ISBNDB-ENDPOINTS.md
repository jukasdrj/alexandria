# ISBNdb API v2 Endpoints - Complete Documentation

Last Updated: 2025-12-10
Test Status: **All 10 endpoints verified working** ✅

## Overview

ISBNdb provides a comprehensive book metadata API with multiple endpoints for searching books, authors, publishers, and subjects. All endpoints have been tested and verified working with the Alexandria Worker.

## Authentication

All requests require an HTTP Authorization header:
```http
Authorization: YOUR_API_KEY
```

The API key is stored in Cloudflare Secrets Store and accessed via:
```javascript
const apiKey = await env.ISBNDB_API_KEY.get();
```

## Base URL

**Alexandria is on Premium plan** (upgraded Dec 10, 2025):
```
https://api.premium.isbndb.com
```

## Rate Limits & Pricing Tiers

| Plan | Price | Rate Limit | Batch Size | Daily Calls | Base URL |
|------|-------|------------|------------|-------------|----------|
| Basic | $14.95/mo | 1 req/sec | 100 ISBNs | ~7,500 | api2.isbndb.com |
| **Premium** ⭐ | $29.95/mo | **3 req/sec** | **1000 ISBNs** | ~15,000 | api.premium.isbndb.com |
| Pro | $74.95/mo | 5 req/sec | 1000 ISBNs | ~30,000 | api.pro.isbndb.com |
| Enterprise | Custom | 10 req/sec | 1000 ISBNs | Custom | api.enterprise.isbndb.com |

## How API Calls Are Counted (IMPORTANT!)

**Each API REQUEST = 1 call, regardless of results returned.**
- Fetching 100 books in one request = 1 call (NOT 100 calls)
- Batch POST for 1000 ISBNs = 1 call (NOT 1000 calls)
- This is **PER-REQUEST billing**, not per-result
- Daily calls **do NOT roll over** - unused quota expires

## Global Limits

- **Max 10,000 results** total regardless of pagination
- **6MB response size limit** - returns 500 error if exceeded

## Available Endpoints

### 1. Book Lookup by ISBN

**GET** `/book/{isbn}`

Fetch detailed book information by ISBN (10 or 13 digits).

**Example:**
```bash
curl "https://api2.isbndb.com/book/9780439064873" \
  -H "Authorization: YOUR_API_KEY"
```

**Response Fields:**
```json
{
  "book": {
    "title": "Harry Potter and the Chamber of Secrets",
    "title_long": "Harry Potter and the Chamber of Secrets (Book 2)",
    "isbn": "0439064872",
    "isbn13": "9780439064873",
    "authors": ["J. K. Rowling"],
    "publisher": "Scholastic Inc.",
    "language": "en",
    "pages": 341,
    "date_published": "1999",
    "synopsis": "Description text...",
    "image": "https://images.isbndb.com/covers/...",
    "edition": "Mass Market Paperback",
    "binding": "Paperback",
    "subjects": ["Fiction", "Fantasy", "Young Adult"]
  }
}
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/book/9780439064873"
```

**Performance:** ~300ms response time

---

### 2. Batch Books Lookup

**POST** `/books`

Fetch multiple books by ISBN in a single request. **This is the most efficient way to fetch book data for multiple ISBNs.**

**Plan Limits:**
- **Academic:** Up to 10 ISBNs per request
- **Basic:** Up to 100 ISBNs per request
- **Premium/Pro:** Up to 1,000 ISBNs per request ⭐ (Alexandria's current plan)

**Request Body:**
```
isbns=ISBN1,ISBN2,ISBN3
```

**Example:**
```bash
curl "https://api2.isbndb.com/books" \
  -H "Authorization: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d 'isbns=9780439064873,9781492666868,9781616555719'
```

**Response:**
```json
{
  "total": 3,
  "requested": 3,
  "data": [
    {
      "title": "Harry Potter and the Chamber of Secrets",
      "isbn": "0439064872",
      "isbn13": "9780439064873",
      "authors": ["J. K. Rowling"],
      "publisher": "Scholastic Inc.",
      "pages": 341,
      "image": "https://images.isbndb.com/covers/...",
      "synopsis": "...",
      "subjects": ["FANTASY FICTION", "WIZARDS_FICTION"]
    }
  ]
}
```

**Important Notes:**
- No pagination - returns all matched books in single response
- Only returns books found in database (missing ISBNs are omitted)
- Response size limit: 6MB (will return 500 error if exceeded)
- Does not include pricing information
- Much faster than individual `/book/{isbn}` calls (1 request vs N requests)

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/batch" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"isbns":["9780439064873","9781492666868"]}'
```

**Performance:** ~300-450ms for 2-50 ISBNs

---

### 3. Books Search

**GET** `/books/{query}`

Search books by keyword with pagination and filtering.

**Query Parameters:**
- `page` - Page number (default: 1)
- `pageSize` - Results per page (default: 20, max: 1000 for Premium+)
- `column` - Filter by column: `title`, `author`, `date_published`, `subject`
- `language` - Filter by ISO language code (e.g., `en`, `es`, `fr`)

**Examples:**
```bash
# Basic search
curl "https://api2.isbndb.com/books/harry%20potter?page=1&pageSize=20" \
  -H "Authorization: YOUR_API_KEY"

# Search with column filter
curl "https://api2.isbndb.com/books/python?column=title&pageSize=10" \
  -H "Authorization: YOUR_API_KEY"

# Search with language filter
curl "https://api2.isbndb.com/books/love?language=en&pageSize=20" \
  -H "Authorization: YOUR_API_KEY"
```

**Response:**
```json
{
  "total": 5234,
  "books": [
    {
      "title": "Solving PDEs in Python",
      "isbn": "3319524623",
      "isbn13": "9783319524627",
      "authors": ["Hans Petter Langtangen", "Anders Logg"],
      "publisher": "Springer",
      "image": "https://images.isbndb.com/covers/...",
      "date_published": "2017",
      "edition": "1st"
    }
  ]
}
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/books?q=python&pageSize=5"
```

**Performance:** ~300ms response time

---

### 3. Author Lookup

**GET** `/author/{name}`

Fetch author details and their books. Author name should be lowercase with underscores instead of spaces.

**Format:** `first_last` or `first_middle_last`

**Query Parameters:**
- `page` - Page number (default: 1)
- `pageSize` - Results per page (default: 20, max: 1000)
- `language` - Filter by ISO language code

**Pagination Note (IMPORTANT):**
The `/author/{name}` endpoint does **NOT return a `total` field**. To paginate correctly, check if the response contains a full page:
```javascript
const booksInResponse = data.books?.length || 0;
hasMore = booksInResponse === pageSize; // If full page, more may exist
```

**Example:**
```bash
curl "https://api.premium.isbndb.com/author/j.k._rowling?page=1&pageSize=100" \
  -H "Authorization: YOUR_API_KEY"
```

**Response:**
```json
{
  "author": "J.K. Rowling",
  "books": [
    {
      "title": "Harry Potter and the Philosopher's Stone",
      "isbn": "0747532699",
      "publisher": "Bloomsbury",
      "date_published": "1997"
    }
  ]
}
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/author/j.k._rowling"
```

**Performance:** ~260ms response time

---

### 4. Authors Search

**GET** `/authors/{query}`

Search authors by name keyword.

**Query Parameters:**
- `page` - Page number (default: 1)
- `pageSize` - Results per page (default: 20)

**Example:**
```bash
curl "https://api2.isbndb.com/authors/rowling?page=1&pageSize=20" \
  -H "Authorization: YOUR_API_KEY"
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/authors?q=rowling&pageSize=5"
```

**Performance:** ~410ms response time

---

### 5. Publisher Lookup

**GET** `/publisher/{name}`

Fetch publisher details and their catalog. Publisher name should be lowercase with underscores.

**Example:**
```bash
curl "https://api2.isbndb.com/publisher/scholastic" \
  -H "Authorization: YOUR_API_KEY"
```

**Response:**
```json
{
  "publisher": "Scholastic",
  "books": [
    {
      "title": "...",
      "isbn": "...",
      "authors": ["..."]
    }
  ]
}
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/publisher/scholastic"
```

**Performance:** ~340ms response time

---

### 6. Publishers Search

**GET** `/publishers/{query}`

Search publishers by name keyword.

**Query Parameters:**
- `page` - Page number (default: 1)
- `pageSize` - Results per page (default: 20)

**Example:**
```bash
curl "https://api2.isbndb.com/publishers/scholastic?page=1&pageSize=20" \
  -H "Authorization: YOUR_API_KEY"
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/publishers?q=scholastic&pageSize=5"
```

**Performance:** ~280ms response time

---

### 7. Subject Lookup

**GET** `/subject/{name}`

Fetch books by subject/category. Subject name should be lowercase with underscores.

**Example:**
```bash
curl "https://api2.isbndb.com/subject/fiction" \
  -H "Authorization: YOUR_API_KEY"
```

**Response:**
```json
{
  "subject": "Fiction",
  "books": [
    {
      "title": "...",
      "isbn": "...",
      "authors": ["..."]
    }
  ]
}
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/subject/fiction"
```

**Performance:** ~300ms response time

---

### 8. Subjects Search

**GET** `/subjects/{query}`

Search subjects by keyword.

**Query Parameters:**
- `page` - Page number (default: 1)
- `pageSize` - Results per page (default: 20)

**Example:**
```bash
curl "https://api2.isbndb.com/subjects/fantasy?page=1&pageSize=20" \
  -H "Authorization: YOUR_API_KEY"
```

**Test Endpoint:**
```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb/subjects?q=fantasy&pageSize=5"
```

**Performance:** ~295ms response time

---

## Alexandria Test Endpoints

The Alexandria Worker includes comprehensive testing endpoints for all ISBNdb functionality.

### Run All Tests

**GET** `/api/test/isbndb`

Runs all 10 ISBNdb endpoint tests and returns a summary.

```bash
curl "https://alexandria.ooheynerds.com/api/test/isbndb"
```

**Response:**
```json
{
  "total": 10,
  "passed": 10,
  "failed": 0,
  "results": [
    {
      "endpoint": "Book by ISBN-13",
      "success": true,
      "status": 200,
      "responseTime": 340,
      "data": { ... }
    }
  ]
}
```

### Individual Test Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/test/isbndb/book/:isbn` | Test book lookup |
| `GET /api/test/isbndb/books?q={query}` | Test books search |
| `GET /api/test/isbndb/author/:name` | Test author lookup |
| `GET /api/test/isbndb/authors?q={query}` | Test authors search |
| `GET /api/test/isbndb/publisher/:name` | Test publisher lookup |
| `GET /api/test/isbndb/subject/:name` | Test subject lookup |

---

## Integration in Alexandria

### Current Usage

ISBNdb is integrated into Alexandria's enrichment system as the **primary provider** for external book metadata:

**Files:**
- `worker/services/external-apis.ts` - Main integration
- `worker/services/cover-fetcher.js` - Cover image fetching
- `worker/services/isbndb-test.ts` - Testing utilities

**Provider Priority:**
1. ISBNdb (paid, most reliable, rich metadata)
2. Google Books (free, good coverage)
3. OpenLibrary (free, fallback)

### Example Usage

```typescript
import { resolveExternalISBN } from './services/external-apis.js';

// Fetch book data with cascading fallback
const bookData = await resolveExternalISBN('9780439064873', env);

// Returns:
{
  isbn: '9780439064873',
  title: 'Harry Potter and the Chamber of Secrets',
  authors: ['J. K. Rowling'],
  publisher: 'Scholastic Inc.',
  publicationDate: '1999',
  pageCount: 341,
  language: 'en',
  description: '...',
  coverUrls: {
    large: 'https://images.isbndb.com/covers/...',
    medium: '...',
    small: '...'
  },
  provider: 'isbndb'
}
```

---

## Batching and Bulk Operations

### Understanding ISBNdb Plans

Alexandria is on the **Premium paid plan** (upgraded Dec 10, 2025) with the following capabilities:

| Feature | Basic Plan | **Premium Plan** ⭐ | Pro Plan |
|---------|-----------|--------------|----------|
| Price | $14.95/mo | **$29.95/mo** | $74.95/mo |
| Rate Limit | 1 req/sec | **3 req/sec** | 5 req/sec |
| Batch Size (POST /books) | 100 ISBNs | **1,000 ISBNs** | 1,000 ISBNs |
| Daily Calls | ~7,500 | **~15,000** | ~30,000 |
| Base URL | api2.isbndb.com | **api.premium.isbndb.com** | api.pro.isbndb.com |

### When to Use Batch Endpoint

**Use POST /books when:**
- Fetching metadata for multiple ISBNs (2-100)
- Initial book import/enrichment
- Bulk catalog updates
- Processing ISBN lists from external sources

**Performance Benefits:**
```javascript
// ❌ BAD: 100 individual requests = ~100 seconds (with rate limiting)
for (const isbn of isbns) {
  await fetch(`/book/${isbn}`);
  await sleep(1000); // Rate limit
}

// ✅ GOOD: 1 batch request = ~0.5 seconds
await fetch('/books', {
  method: 'POST',
  body: `isbns=${isbns.join(',')}`
});
```

**Efficiency Gain:** 100x faster for batch operations!

### Batch Request Best Practices

1. **Optimal Batch Size:** 50-100 ISBNs per request
   - Balances response time and data volume
   - Stays well under 6MB response limit
   - Maximizes throughput

2. **Error Handling:**
   ```javascript
   const response = await fetch('/books', { method: 'POST', body: `isbns=${isbns.join(',')}` });
   const data = await response.json();

   // Check which ISBNs were found
   const found = data.data.map(book => book.isbn13);
   const missing = isbns.filter(isbn => !found.includes(isbn));

   console.log(`Found: ${found.length}, Missing: ${missing.length}`);
   ```

3. **Chunking Large Lists:**
   ```javascript
   // For > 1000 ISBNs, chunk into batches
   function chunkArray(array, size) {
     return Array.from({ length: Math.ceil(array.length / size) },
       (_, i) => array.slice(i * size, i * size + size)
     );
   }

   const chunks = chunkArray(allIsbns, 1000); // 1000 = Premium plan limit

   for (const chunk of chunks) {
     const result = await fetchBatch(chunk);
     // Process results...
     await sleep(350); // Rate limiting (3 req/sec on Premium)
   }
   ```

4. **Response Size Management:**
   - Monitor response sizes (6MB limit)
   - If hitting limit, reduce batch size to 50-75 ISBNs
   - Consider filtering out books with large synopses

### Integration Example

```typescript
// Efficient batch ISBN resolution for Alexandria (Premium plan)
async function batchResolveISBNs(isbns: string[], env: Env) {
  const apiKey = await env.ISBNDB_API_KEY.get();
  const chunks = chunkArray(isbns, 1000); // Premium plan limit
  const results = [];

  for (const chunk of chunks) {
    const response = await fetch('https://api.premium.isbndb.com/books', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: `isbns=${chunk.join(',')}`,
    });

    if (response.ok) {
      const data = await response.json();
      results.push(...data.data);
    }

    // Rate limiting for multi-chunk requests (3 req/sec on Premium)
    if (chunks.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }

  return results;
}
```

---

## Best Practices

### 1. Rate Limiting
- Implement client-side rate limiting (3 req/sec for Premium plan, 350ms delay)
- Use KV storage for distributed rate limiting across Worker isolates
- Alexandria's implementation: `worker/services/cover-fetcher.js:enforceISBNdbRateLimit()`

### 2. Caching
- Cache ISBNdb responses for 24 hours minimum
- Book metadata rarely changes
- Use KV or R2 for persistent caching

### 3. Error Handling
```typescript
// Always handle 404, 429, and 5xx responses
if (response.status === 404) {
  // Book not found - try next provider
  return null;
}
if (response.status === 429) {
  // Rate limited - back off
  await new Promise(resolve => setTimeout(resolve, 2000));
  return null;
}
```

### 4. ISBN Normalization
- Remove hyphens and spaces before lookup
- Support both ISBN-10 and ISBN-13
- Validate format: `/^[0-9]{9}[0-9X]$|^[0-9]{13}$/`

### 5. Batch Operations
- For bulk lookups, use `resolveExternalBatch()` with concurrency control
- Process in batches of 5 to avoid rate limits
- Example: `worker/services/external-apis.ts:resolveExternalBatch()`

---

## Common Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process data |
| 404 | Not found | Try next provider |
| 401 | Unauthorized | Check API key |
| 429 | Rate limited | Back off, retry after 1s |
| 500-503 | Server error | Retry with exponential backoff |

---

## API Limitations

### All Plans
- **6MB response size limit** (returns 500 if exceeded)
- **10,000 max results** total regardless of pagination
- **Daily calls do NOT roll over** - unused quota expires at midnight

### Basic Plan ($14.95/mo)
- 1 request/second
- ~7,500 daily calls
- 100 ISBNs per batch
- Default 20 results per page

### Premium Plan ($29.95/mo) ⭐ Alexandria's current plan
- 3 requests/second
- ~15,000 daily calls
- **1,000 ISBNs per batch**
- Up to 1,000 results per page

### Pro Plan ($74.95/mo)
- 5 requests/second
- ~30,000 daily calls
- 1,000 ISBNs per batch
- Priority support

---

## Performance Metrics

Based on live testing (2025-12-03):

| Endpoint | Avg Response Time | Success Rate |
|----------|-------------------|--------------|
| Book lookup | ~300ms | 100% |
| Books search | ~310ms | 100% |
| Author lookup | ~260ms | 100% |
| Authors search | ~410ms | 100% |
| Publisher lookup | ~340ms | 100% |
| Publishers search | ~280ms | 100% |
| Subject lookup | ~300ms | 100% |
| Subjects search | ~295ms | 100% |

**Overall Success Rate:** 100% (10/10 endpoints working)

---

## Enrichment Opportunities

ISBNdb provides rich metadata beyond basic book information. See **[ISBNDB-ENRICHMENT.md](./ISBNDB-ENRICHMENT.md)** for comprehensive documentation on:

- **High-quality cover images** (`image_original` vs `image`)
- **Subject tags** for content-based recommendations
- **Physical dimensions** (height, width, weight) for shipping/display
- **Related ISBNs** for format linking (ePub, audiobook, etc.)
- **Dewey Decimal** classification
- **MSRP pricing** (single book lookups only)

### Quick Wins

1. **Use `image_original` for covers** - Higher quality, better for R2 storage
2. **Extract subject tags** - Enable genre classification and recommendations
3. **Store dimensions** - Useful for shipping and physical book features

All enrichment data is available at **no additional API cost** when using existing endpoints.

## Additional Resources

- [Official ISBNdb Documentation](https://isbndb.com/isbndb-api-documentation-v2)
- [ISBNdb API Pricing](https://isbndb.com/isbn-database)
- **[ISBNdb Enrichment Guide](./ISBNDB-ENRICHMENT.md)** ⭐ NEW
- Alexandria Integration: `worker/services/external-apis.ts`
- Test Suite: `worker/services/isbndb-test.ts`

---

## Testing Commands

### Quick Test
```bash
# Test single book
curl "https://alexandria.ooheynerds.com/api/test/isbndb/book/9780439064873" | jq .

# Test all endpoints
curl "https://alexandria.ooheynerds.com/api/test/isbndb" | jq '.total, .passed, .failed'
```

### Production API
```bash
# Direct ISBNdb API call
curl "https://api2.isbndb.com/book/9780439064873" \
  -H "Authorization: $(wrangler secret get ISBNDB_API_KEY)"
```

---

**Note:** All endpoints are production-ready and actively used in Alexandria's enrichment system. The test endpoints provide real-time verification of ISBNdb API access and response formats.
