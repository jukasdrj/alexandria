# Alexandria API Integration Guide

This guide shows how to integrate with Alexandria's TypeScript-enabled API from other services like **bendv3**.

## Quick Start

**Status**: Types are ready for export. Package will be published to npm as `alexandria-worker` once testing is complete.

### Installation (Coming Soon)

```bash
npm install alexandria-worker
```

**For now**, you can:
1. Use the API directly via `fetch()` (see examples below)
2. Copy `types.ts` from this repo for TypeScript support
3. Wait for npm package publication (coming soon)

### Basic Usage

```typescript
import type {
  SearchQuery,
  SearchResult,
  BookResult,
  HealthCheck,
  DatabaseStats,
  CoverProcessResult,
  EnrichmentResult,
  ENDPOINTS,
  API_ROUTES
} from 'alexandria-worker/types';

// Type-safe API client
const client = {
  baseUrl: 'https://alexandria.ooheynerds.com',

  async search(query: SearchQuery): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (query.isbn) params.set('isbn', query.isbn);
    if (query.title) params.set('title', query.title);
    if (query.author) params.set('author', query.author);
    if (query.limit) params.set('limit', query.limit.toString());

    const response = await fetch(`${this.baseUrl}/api/search?${params}`);
    return response.json();
  },

  async health(): Promise<HealthCheck> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  },

  async stats(): Promise<DatabaseStats> {
    const response = await fetch(`${this.baseUrl}/api/stats`);
    return response.json();
  }
};

// Usage
const results = await client.search({ isbn: '9780439064873' });
results.results.forEach((book: BookResult) => {
  console.log(`${book.title} by ${book.author}`);
  console.log(`Cover: ${book.coverUrl} (${book.coverSource})`);
});
```

## API Endpoints

### Combined Search (New in v2.1.0) ⭐

**Endpoint**: `GET /api/search/combined`

**Query Parameters**:
- `q` (string, required): Search query (ISBN or text)
- `limit` (number): Max results (default: 10, max: 100)
- `offset` (number): Pagination offset (default: 0)

**Response Type**: `CombinedSearchResult`

**Features**:
- Intelligent ISBN vs text detection
- Fast ISBN lookups (~60ms)
- Parallel title + author search (~1-2s)
- Automatic deduplication
- Full pagination support

```typescript
interface CombinedSearchResult {
  query: string;
  search_type: 'isbn' | 'text';
  query_duration_ms: number;
  results: BookResult[];
  pagination: PaginationMetadata;
}

interface PaginationMetadata {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  returnedCount: number;
  totalEstimated?: boolean;  // true for text searches
}
```

**Examples**:
```typescript
// Search by ISBN (auto-detected)
const isbnResults = await client.searchCombined({ q: '9780439064873' });

// Search by title or author (auto-detected)
const textResults = await client.searchCombined({ q: 'Harry Potter', limit: 20 });

// Pagination
const page2 = await client.searchCombined({
  q: 'Tolkien',
  limit: 10,
  offset: 10
});
```

### Search Books (Legacy)

**Endpoint**: `GET /api/search`

**Query Parameters**: All optional (provide at least one)
- `isbn` (string): ISBN-10 or ISBN-13
- `title` (string): Partial title match
- `author` (string): Partial author name match
- `limit` (number): Max results (default: 10, max: 100)
- `offset` (number): Pagination offset (default: 0, **new in v2.1.0**)

**Response Type**: `SearchResult`

```typescript
interface SearchResult {
  query: {
    isbn?: string;
    title?: string;
    author?: string;
  };
  query_duration_ms: number;
  count?: number;  // Deprecated - use pagination.total
  results: BookResult[];
  pagination: PaginationMetadata;  // New in v2.1.0
}

interface BookResult {
  type?: 'edition' | 'work' | 'author';  // New in v2.1.0
  title: string;
  author: string | null;
  isbn: string | null;
  coverUrl: string | null;
  coverSource: 'r2' | 'external' | 'external-fallback' | null;
  publish_date: string | null;
  publishers: string[] | null;
  pages: string | null;
  work_title: string | null;
  openlibrary_edition: string | null;
  openlibrary_work: string | null;
  openlibrary_author?: string | null;  // New in v2.1.0
}

interface PaginationMetadata {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  returnedCount: number;
  totalEstimated?: boolean;
}
```

**Example**:
```typescript
// Search by ISBN
const isbn = await client.search({ isbn: '9780439064873' });

// Search by title
const title = await client.search({ title: 'Harry Potter', limit: 20 });

// Search by author
const author = await client.search({ author: 'J.K. Rowling' });
```

### Health Check

**Endpoint**: `GET /health`

**Response Type**: `HealthCheck`

```typescript
interface HealthCheck {
  status: 'ok' | 'error';
  database: 'connected' | 'disconnected';
  r2_covers: 'bound' | 'not_configured';
  hyperdrive_latency_ms?: number;
  timestamp: string;
  message?: string;
}
```

### Database Statistics

**Endpoint**: `GET /api/stats`

**Response Type**: `DatabaseStats`

```typescript
interface DatabaseStats {
  editions: number;      // 54.8M+
  isbns: number;         // 49.3M+
  works: number;         // 40.1M+
  authors: number;       // 14.7M+
  query_duration_ms: number;
}
```

### Cover Images

#### Process Cover (Work-based)

**Endpoint**: `POST /api/covers/process`

**Request Type**: `ProcessCover`

```typescript
interface ProcessCover {
  work_key: string;        // e.g., '/works/OL45804W'
  provider_url: string;    // Must be from allowed domains
  isbn?: string;           // Optional, for logging
}
```

**Allowed Cover Domains**:
- `books.google.com`
- `covers.openlibrary.org`
- `images.isbndb.com`
- `images-na.ssl-images-amazon.com`
- `m.media-amazon.com`

**Response Type**: `CoverProcessResult`

```typescript
interface CoverProcessResult {
  status: 'processed' | 'already_exists' | 'no_cover' | 'error';
  isbn: string;
  provider?: string;
  metadata?: CoverMetadata;
  message?: string;
  error?: string;
}
```

#### Serve Cover (Work-based)

**Endpoint**: `GET /api/covers/:work_key/:size`

**Path Parameters**:
- `work_key`: OpenLibrary work key (without `/works/` prefix)
- `size`: `large` | `medium` | `small`

**Returns**: Cover image (JPEG/PNG) or redirect to placeholder

#### Legacy ISBN-based Cover Endpoints

**Endpoint**: `GET /covers/:isbn/:size`
- Returns cover image by ISBN
- Sizes: `small` | `medium` | `large` | `original`

**Endpoint**: `GET /covers/:isbn/status`
- Returns cover metadata and existence status

**Endpoint**: `POST /covers/:isbn/process`
- Triggers cover processing from providers
- Query param: `?force=true` to reprocess

**Endpoint**: `POST /covers/batch`
- Process up to 10 ISBNs at once
- Request body: `{ isbns: string[] }`

### Enrichment Endpoints

#### Enrich Edition

**Endpoint**: `POST /api/enrich/edition`

**Request Type**: `EnrichEdition`

```typescript
interface EnrichEdition {
  isbn: string;
  title?: string;
  subtitle?: string;
  publisher?: string;
  publication_date?: string;
  page_count?: number;
  format?: string;
  language?: string;
  primary_provider: 'isbndb' | 'google-books' | 'openlibrary' | 'user-correction';
  cover_urls?: {
    large?: string;
    medium?: string;
    small?: string;
  };
  cover_source?: string;
  work_key?: string;
  openlibrary_edition_id?: string;
  amazon_asins?: string[];
  google_books_volume_ids?: string[];
  goodreads_edition_ids?: string[];
  alternate_isbns?: string[];
}
```

#### Enrich Work

**Endpoint**: `POST /api/enrich/work`

**Request Type**: `EnrichWork`

```typescript
interface EnrichWork {
  work_key: string;
  title: string;
  subtitle?: string;
  description?: string;
  original_language?: string;
  first_publication_year?: number;
  subject_tags?: string[];
  primary_provider: 'isbndb' | 'google-books' | 'openlibrary';
  cover_urls?: {
    large?: string;
    medium?: string;
    small?: string;
  };
  cover_source?: string;
  openlibrary_work_id?: string;
  goodreads_work_ids?: string[];
  amazon_asins?: string[];
  google_books_volume_ids?: string[];
}
```

#### Enrich Author

**Endpoint**: `POST /api/enrich/author`

**Request Type**: `EnrichAuthor`

```typescript
interface EnrichAuthor {
  author_key: string;
  name: string;
  gender?: string;
  nationality?: string;
  birth_year?: number;
  death_year?: number;
  bio?: string;
  bio_source?: string;
  author_photo_url?: string;
  primary_provider: 'isbndb' | 'openlibrary' | 'wikidata';
  openlibrary_author_id?: string;
  goodreads_author_ids?: string[];
  wikidata_id?: string;
}
```

#### Queue Background Enrichment

**Endpoint**: `POST /api/enrich/queue`

**Request Type**: `QueueEnrichment`

```typescript
interface QueueEnrichment {
  entity_type: 'work' | 'edition' | 'author';
  entity_key: string;
  providers_to_try: string[];
  priority?: number;  // 1-10, default: 5
}
```

**Response Type**: `EnrichmentQueueResult`

```typescript
interface EnrichmentQueueResult {
  status: 'queued';
  job_id: string;
  entity_type: 'work' | 'edition' | 'author';
  entity_key: string;
  priority: number;
  message: string;
}
```

#### Check Enrichment Status

**Endpoint**: `GET /api/enrich/status/:id`

**Response Type**: `EnrichmentJobStatus`

```typescript
interface EnrichmentJobStatus {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  entity_type: 'work' | 'edition' | 'author';
  entity_key: string;
  created_at: string;
  updated_at: string;
  result?: unknown;
  error?: string;
}
```

## Runtime Validation with Zod

Alexandria uses Zod for runtime validation. All request schemas are exported:

```typescript
import {
  SearchQuerySchema,
  ProcessCoverSchema,
  EnrichEditionSchema,
  z
} from 'alexandria-worker/types';

// Validate data before sending
const searchQuery = SearchQuerySchema.parse({
  isbn: '9780439064873',
  limit: '10'
});

// Safe parse with error handling
const result = ProcessCoverSchema.safeParse({
  work_key: '/works/OL45804W',
  provider_url: 'https://covers.openlibrary.org/b/id/8091323-L.jpg'
});

if (!result.success) {
  console.error('Validation errors:', result.error.format());
} else {
  // result.data is typed and validated
  await fetch('/api/covers/process', {
    method: 'POST',
    body: JSON.stringify(result.data)
  });
}
```

## Error Handling

All endpoints return consistent error responses:

```typescript
interface ErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
}
```

**Common HTTP Status Codes**:
- `200` - Success
- `201` - Created (for POST requests)
- `400` - Bad Request (validation error)
- `403` - Forbidden (domain not allowed for covers)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable (database down)

**Example Error Handling**:
```typescript
try {
  const response = await fetch('https://alexandria.ooheynerds.com/api/search?isbn=invalid');

  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    console.error(`Error ${response.status}:`, error.message);
    throw new Error(error.error);
  }

  const data: SearchResult = await response.json();
  return data;
} catch (error) {
  console.error('Request failed:', error);
  throw error;
}
```

## bendv3 Integration Example

Here's a complete example for integrating Alexandria into bendv3:

```typescript
// bendv3/services/alexandria.ts
import type {
  SearchQuery,
  SearchResult,
  BookResult,
  ProcessCover,
  CoverProcessResult,
  ENDPOINTS
} from 'alexandria-worker/types';

export class AlexandriaService {
  private baseUrl = 'https://alexandria.ooheynerds.com';

  constructor(baseUrl?: string) {
    if (baseUrl) this.baseUrl = baseUrl;
  }

  /**
   * Search for books by ISBN, title, or author
   */
  async searchBooks(query: SearchQuery): Promise<BookResult[]> {
    const params = new URLSearchParams();
    if (query.isbn) params.set('isbn', query.isbn);
    if (query.title) params.set('title', query.title);
    if (query.author) params.set('author', query.author);
    if (query.limit) params.set('limit', query.limit.toString());

    const response = await fetch(`${this.baseUrl}${ENDPOINTS.SEARCH}?${params}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Alexandria API error: ${error.message}`);
    }

    const data: SearchResult = await response.json();
    return data.results;
  }

  /**
   * Get book by ISBN with full metadata
   */
  async getBookByISBN(isbn: string): Promise<BookResult | null> {
    const results = await this.searchBooks({ isbn, limit: 1 });
    return results[0] || null;
  }

  /**
   * Process and store cover image
   */
  async processCover(data: ProcessCover): Promise<CoverProcessResult> {
    const response = await fetch(`${this.baseUrl}${ENDPOINTS.COVER_PROCESS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Cover processing failed: ${error.message}`);
    }

    return response.json();
  }

  /**
   * Get cover URL for a work
   */
  getCoverUrl(workKey: string, size: 'large' | 'medium' | 'small' = 'medium'): string {
    // Remove /works/ prefix if present
    const key = workKey.replace(/^\/works\//, '');
    return `${this.baseUrl}/api/covers/${key}/${size}`;
  }

  /**
   * Check if API is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}${ENDPOINTS.HEALTH}`);
      const health = await response.json();
      return health.status === 'ok' && health.database === 'connected';
    } catch {
      return false;
    }
  }
}

// Usage in bendv3
const alexandria = new AlexandriaService();

// Feature flag check
if (features.isEnabled('alexandria-integration')) {
  const book = await alexandria.getBookByISBN('9780439064873');
  if (book) {
    console.log(`Found: ${book.title} by ${book.author}`);
    console.log(`Cover: ${book.coverUrl}`);
  }
}
```

## Feature Flag Activation (bendv3)

**Current Status**: Ready for integration once npm package is published.

```typescript
// bendv3/config/features.ts
export const features = {
  'alexandria-integration': {
    enabled: process.env.ENABLE_ALEXANDRIA === 'true',
    description: 'Type-safe Alexandria API integration',
    endpoints: {
      production: 'https://alexandria.ooheynerds.com',
      development: 'http://localhost:8787'
    }
  }
};
```

**Integration Steps**:
1. ✅ Alexandria exports TypeScript types
2. ⏳ Publish `alexandria-worker` to npm
3. Install package in bendv3
4. Import types and implement service (see example above)
5. Add feature flag to config
6. Enable flag: `ENABLE_ALEXANDRIA=true`
7. Deploy - instant activation!

## Performance Considerations

### Caching
- All `GET /api/search` responses are cached for 24 hours
- Cover images are cached with `immutable` directive
- Health checks are not cached

### Rate Limiting
**Note**: Rate limiting is not yet implemented. Consider adding client-side throttling:

```typescript
import { RateLimiter } from 'limiter';

class ThrottledAlexandriaService extends AlexandriaService {
  private limiter = new RateLimiter({
    tokensPerInterval: 100,
    interval: 'minute'
  });

  async searchBooks(query: SearchQuery): Promise<BookResult[]> {
    await this.limiter.removeTokens(1);
    return super.searchBooks(query);
  }
}
```

### Connection Pooling
Alexandria uses Cloudflare Hyperdrive for automatic connection pooling. Clients don't need to manage connections.

## OpenAPI Specification

Full OpenAPI 3.0 spec available at:
```
GET https://alexandria.ooheynerds.com/openapi.json
```

## Support

- **GitHub Issues**: https://github.com/jukasdrj/alexandria/issues
- **Production API**: https://alexandria.ooheynerds.com
- **Worker Domain**: alexandria.ooheynerds.com
- **Database**: 54M+ editions, 49M+ ISBNs, 40M+ works, 14M+ authors

## Analytics & Monitoring (New in v2.8.0)

Alexandria now includes comprehensive provider analytics. Import analytics utilities:

```typescript
import { trackProviderRequest, trackOrchestratorFallback } from 'alexandria-worker/lib/external-services/analytics';
```

See `docs/operations/PROVIDER-ANALYTICS.md` for dashboard queries and monitoring setup.

---

## Change Log

### v2.8.0 - Provider Analytics & Monitoring (January 14, 2026)
- ✅ **Provider Analytics System** - Comprehensive tracking for all 8 external service providers
- ✅ **Non-blocking instrumentation** - Analytics use `ctx.waitUntil()` pattern (zero user impact)
- ✅ **ServiceHttpClient integration** - Automatic latency, success rate, and cache hit tracking
- ✅ **Orchestrator fallback tracking** - Complete success/failure chain analysis
- ✅ **Operational dashboard** - 15+ ready-to-use GraphQL queries for monitoring
- ✅ **Cost management** - Provider cost tracking and alert configuration

### v2.1.0 - Combined Search & Pagination (December 3, 2025)
- ✅ **New `/api/search/combined` endpoint** - Intelligent ISBN vs text search
- ✅ **Pagination support** - All search endpoints now support `offset` parameter
- ✅ **Enhanced response types** - Added `PaginationMetadata` with `hasMore` flag
- ✅ **BookResult enhancements** - Added `type` and `openlibrary_author` fields
- ✅ **Performance optimized** - Parallel COUNT queries for accurate totals
- ⚠️ **Breaking change**: `SearchResult` now includes `pagination` object instead of just `count`

### v2.0.0 - TypeScript Migration (November 2025)
- ✅ Full TypeScript support with exported types
- ✅ Zod runtime validation on all endpoints
- ✅ Type-safe API client patterns
- ✅ Comprehensive type definitions for external integration
- ✅ Zero breaking changes to existing API

### v1.6.0 - Enrichment API
- Edition, work, and author enrichment endpoints
- Quality scoring and conflict detection
- Background queue processing

### v1.5.0 - Cover Processing
- R2-based cover storage and serving
- Multi-provider cover fetching
- Work-based and ISBN-based endpoints

### v1.0.0 - Database Integration
- Hyperdrive connection pooling
- ISBN, title, and author search
- Interactive dashboard
- OpenAPI specification
