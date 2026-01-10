# Open API Integrations Guide

**Last Updated**: 2026-01-10
**Issue**: #159
**Status**: Phase 1-5 Complete, Production Ready (Phase 2: Archive.org Metadata added)

## Overview

Alexandria integrates three free, open APIs to reduce dependence on paid services and enable author diversity tracking:

1. **Archive.org** - Cover images + full metadata (especially pre-2000 books)
2. **Wikipedia** - Author biographies (diversity tracking)
3. **Wikidata** - Book metadata and author enrichment

All three APIs are:
- ✅ Free and unlimited (within respectful rate limits)
- ✅ Open data (no licensing restrictions)
- ✅ Community-maintained (sustainable long-term)
- ✅ Ethical (support via donations encouraged)

---

## Architecture

### Service Layer

Each API has a dedicated service module:

| Service | Location | Purpose |
|---------|----------|---------|
| **Archive.org** | `worker/services/archive-org.ts` | Cover images + full metadata (descriptions, subjects, authors, ISBNs, OpenLibrary IDs) |
| **Wikipedia** | `worker/services/wikipedia.ts` | Author biographies and portraits |
| **Wikidata** | `worker/services/wikidata.ts` | Book metadata and SPARQL queries |

### Shared Utilities

Common functionality in `worker/lib/open-api-utils.ts`:
- **KV-backed rate limiting** (distributed across Worker isolates)
- **Response caching** (configurable TTLs)
- **User-Agent construction** (with donation links)
- **Cache key builders** (consistent patterns)

### Type Definitions

Complete TypeScript interfaces in `worker/types/open-apis.ts`:
- API response structures for all three providers
- Service integration types (enrichment requests/results)
- SPARQL property constants for Wikidata
- Type guards for runtime validation

---

## Cover Image Priority Chain

Alexandria fetches covers from multiple providers with intelligent fallback:

```
1. Google Books     (good quality, free with API key, 1000/day quota)
2. OpenLibrary      (free, reliable, no quota)
3. Archive.org      (free, excellent for pre-2000 books)
4. Wikidata         (free, Wikimedia Commons, structured data)
5. ISBNdb           (highest quality, paid, quota-protected)
6. Placeholder      (fallback when no cover found)
```

**Why this order?**
- Google Books first (best quality, but quota-limited)
- Free sources next (OpenLibrary, Archive.org, Wikidata)
- ISBNdb last (paid, preserve quota for metadata enrichment)

**Implementation**: `worker/services/cover-fetcher.ts` - `fetchBestCover()`

---

## API Details

### Archive.org

**Endpoints**:
- Search: `https://archive.org/advancedsearch.php?q=isbn:{isbn}&output=json`
- Metadata: `https://archive.org/metadata/{identifier}`
- Image Service: `https://archive.org/services/img/{identifier}`

**Strategy**: Two-step lookup (shared between covers and metadata)
1. ISBN → identifier (search API)
2. identifier → cover URL or metadata (metadata API or image service)

**Functions**:
- `fetchArchiveOrgCover()` - Cover images with quality detection
- `fetchArchiveOrgMetadata()` - Full book metadata (Phase 2, Jan 2026)

**Cover Features**:
- Smart file pattern matching (cover.jp2, _0000.jp2, cover.jpg)
- Quality detection (high/medium/low based on file size/format)
- Dual strategy: Direct image service + metadata API fallback

**Metadata Features** (Phase 2):
- **Descriptions**: Rich, multi-paragraph descriptions (superior to ISBNdb)
- **Subjects**: Library of Congress classifications and subject headings
- **Authors**: Creator names (string or array)
- **Publication**: Publisher, publication date, language, LCCN
- **ISBNs**: Alternate ISBNs (merged with existing data)
- **OpenLibrary IDs**: Authoritative edition and work IDs for crosswalking

**Integration**: Archive.org metadata is fetched in parallel with Wikidata during enrichment:
- **Description Priority**: Archive.org > ISBNdb (richer content)
- **Subject Merging**: Archive.org subjects merged with ISBNdb + Wikidata genres (normalized, deduplicated)
- **OpenLibrary IDs**: Archive.org is primary source (most authoritative)
- **Contributors Tracking**: All providers tracked in `contributors` array for audit trail

**Rate Limit**: 1 req/sec (KV-backed, respectful delay)
**Cache TTL**: 7 days (covers/metadata may update)
**User-Agent**: `Alexandria/2.3.0 (nerd@ooheynerds.com; Book metadata enrichment; Donate: https://archive.org/donate)`

**Best For**: Pre-2000 books, public domain works, historical texts, rich descriptions

### Wikipedia

**Endpoint**: `https://en.wikipedia.org/w/api.php`

**Strategy**: ID-based lookup (eliminates fuzzy matching)
1. Get author from `enriched_authors` by `author_key`
2. Extract Wikidata Q-ID from `enriched_authors.wikidata_id` or `authors.data->'remote_ids'->>'wikidata'`
3. If Wikidata Q-ID exists → Use Wikidata API to get exact Wikipedia page title
4. If no Q-ID → Fall back to name-based search with conservative disambiguation
5. Fetch Wikipedia page details (extracts, images, categories)

**Features**:
- ID-based lookup for 174K+ authors with Wikidata IDs (exact matching)
- Conservative disambiguation for name-based fallback
- Structured data extraction (birth year, nationality, death year)
- Confidence scoring (0-100 based on data completeness)
- Native JSONB storage (no stringified JSON anti-pattern)

**Rate Limit**: 1 req/sec (KV-backed, respectful to Wikipedia)
**Cache TTL**: 30 days (biographies rarely change)
**User-Agent**: `Alexandria/2.3.0 (nerd@ooheynerds.com; Author biographies; Donate: https://donate.wikimedia.org)`

**Database Schema**:
```sql
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS biography_data JSONB;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikidata_id TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikipedia_page_title TEXT;
```

**Best For**: Notable authors, diversity tracking, author portraits

### Wikidata

**Endpoints**:
- SPARQL: `https://query.wikidata.org/sparql`
- Entity API: `https://www.wikidata.org/w/api.php`

**SPARQL Queries**:
1. **ISBN Lookup** - P212 (ISBN-13), P957 (ISBN-10) → Book entity
2. **Author Bibliography** - P50 (author) → All works by author
3. **Author Metadata** - Complete author profile (gender, citizenship, movements, awards)

**Features**:
- Structured book metadata (title, authors, genres, subjects, publication date)
- Cover images from Wikimedia Commons (P18 property)
- Author bibliography (up to 100 most recent works)
- Comprehensive author enrichment (literary movements, awards, notable works)
- SPARQL query builders for complex queries

**Rate Limit**: 2 req/sec (500ms delay, KV-backed)
**Cache TTL**: 30 days (metadata stable)
**User-Agent**: `Alexandria/2.3.0 (nerd@ooheynerds.com; Book metadata enrichment; Donate: https://donate.wikimedia.org)`

**Wikidata Properties Used**:
- P212: ISBN-13
- P957: ISBN-10
- P50: Author
- P18: Image (cover, portrait)
- P577: Publication date
- P136: Genre
- P921: Main subject
- P21: Gender
- P27: Citizenship
- P569/P570: Birth/death dates
- P135: Literary movement
- P166: Award received
- P800: Notable work

**Best For**: Notable books, structured metadata, author diversity data, cross-referencing

---

## Usage Examples

### Fetch Cover Image

```typescript
import { fetchArchiveOrgCover } from './services/archive-org.js';
import { fetchWikidataCover } from './services/wikidata.js';

// Archive.org
const archiveCover = await fetchArchiveOrgCover('9780747532743', env);
if (archiveCover) {
  console.log(`Found via Archive.org: ${archiveCover.url}`);
}

// Wikidata
const wikidataCover = await fetchWikidataCover('9780747532743', env, logger);
if (wikidataCover) {
  console.log(`Found via Wikidata: ${wikidataCover.url}`);
  console.log(`Quality: ${wikidataCover.quality}`);
}
```

### Fetch Archive.org Metadata

```typescript
import { fetchArchiveOrgMetadata } from './services/archive-org.js';

// Fetch full metadata (Phase 2)
const metadata = await fetchArchiveOrgMetadata('9780060935467', env);

if (metadata) {
  console.log(`Identifier: ${metadata.identifier}`);
  console.log(`Title: ${metadata.title}`);
  console.log(`Creator: ${metadata.creator}`);
  console.log(`Publisher: ${metadata.publisher} (${metadata.date})`);

  // Rich, multi-paragraph descriptions
  if (metadata.description) {
    console.log(`Description: ${metadata.description.join('\n\n')}`);
  }

  // Library of Congress subjects
  if (metadata.subject) {
    console.log(`Subjects: ${metadata.subject.join(', ')}`);
  }

  // OpenLibrary crosswalk IDs (authoritative)
  console.log(`OpenLibrary Edition: ${metadata.openlibrary_edition}`);
  console.log(`OpenLibrary Work: ${metadata.openlibrary_work}`);

  // Alternate ISBNs
  if (metadata.isbn) {
    console.log(`ISBNs: ${metadata.isbn.join(', ')}`);
  }
}
```

### Fetch Author Biography

```typescript
import { fetchAuthorBiography } from './services/wikipedia.js';

const bio = await fetchAuthorBiography(
  sql,           // Database connection
  '/authors/OL23919A',  // Author key (J.K. Rowling)
  env,
  logger
);

if (bio) {
  console.log(`Name: ${bio.article_title}`);
  console.log(`Born: ${bio.birth_year}`);
  console.log(`Nationality: ${bio.nationality?.join(', ')}`);
  console.log(`Extract: ${bio.extract.substring(0, 200)}...`);
  console.log(`Wikidata: ${bio.wikidata_qid}`);
  console.log(`Confidence: ${bio.confidence}`);
}
```

### Fetch Book Metadata

```typescript
import { fetchBookByISBN } from './services/wikidata.js';

const book = await fetchBookByISBN('9780747532743', env, logger);

if (book) {
  console.log(`Q-ID: ${book.qid}`);
  console.log(`Title: ${book.title}`);
  console.log(`Authors: ${book.author_names?.join(', ')}`);
  console.log(`Publication: ${book.publication_date}`);
  console.log(`Genres: ${book.genre_names?.join(', ')}`);
  console.log(`Subjects: ${book.subject_names?.join(', ')}`);
  console.log(`Cover: ${book.image_url}`);
  console.log(`Confidence: ${book.confidence}`);
}
```

### Fetch Author Bibliography

```typescript
import { fetchAuthorBibliography } from './services/wikidata.js';

const works = await fetchAuthorBibliography('Q34660', env, logger); // J.K. Rowling

console.log(`Found ${works.length} works by this author:`);
works.forEach(work => {
  console.log(`- ${work.work_title} (${work.publication_date})`);
  console.log(`  ISBNs: ${work.isbn13?.join(', ') || 'N/A'}`);
  console.log(`  Genres: ${work.genre?.join(', ') || 'N/A'}`);
});
```

---

## Rate Limiting

All Open APIs use **KV-backed rate limiting** for distributed safety:

| API | Rate Limit | Min Delay | KV Key Pattern |
|-----|------------|-----------|----------------|
| Archive.org | 1 req/sec | 1000ms | `rate_limit:archive.org` |
| Wikipedia | 1 req/sec | 1000ms | `rate_limit:wikipedia` |
| Wikidata | 2 req/sec | 500ms | `rate_limit:wikidata` |

**Why KV-backed?**
- Cloudflare Workers run in distributed isolates globally
- In-memory state doesn't work (each isolate thinks it's first)
- KV provides shared state across all Worker instances
- Graceful degradation: If KV fails, logs warning and continues

**Implementation**: `worker/lib/open-api-utils.ts` - `enforceRateLimit()`

**Pattern** (from ISBNdb):
```typescript
export async function enforceRateLimit(
  kv: KVNamespace,
  kvKey: string,
  minDelayMs: number,
  logger?: Logger
): Promise<void> {
  const now = Date.now();
  const lastRequestStr = await kv.get(kvKey);
  const lastRequest = lastRequestStr ? parseInt(lastRequestStr, 10) : 0;
  const timeSinceLastRequest = now - lastRequest;

  if (timeSinceLastRequest < minDelayMs) {
    const waitTime = minDelayMs - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  await kv.put(kvKey, Date.now().toString(), { expirationTtl: 60 });
}
```

---

## Caching Strategy

All API responses are cached in Cloudflare KV with provider-specific TTLs:

| API | Cache TTL | Reason |
|-----|-----------|--------|
| Archive.org | 7 days | Covers may update (better scans) |
| Wikipedia | 30 days | Biographies rarely change |
| Wikidata | 30 days | Metadata stable |

**Cache Key Patterns**:
- Archive.org: `archive.org:cover:{isbn}`
- Wikipedia: `wikipedia:bio:{author_key}`
- Wikidata Book: `wikidata:book:{isbn}`
- Wikidata Author: `wikidata:author:{qid}`
- Wikidata Bibliography: `wikidata:biblio:{qid}`

**Cache Helpers**:
```typescript
// Get cached response
const cached = await getCachedResponse<WikidataBookMetadata>(
  env.CACHE,
  'wikidata:book:9780747532743',
  logger
);

// Store cached response
await setCachedResponse(
  env.CACHE,
  'wikidata:book:9780747532743',
  bookData,
  CACHE_TTLS['wikidata'],  // 30 days
  logger
);
```

---

## Error Handling

All Open API services follow Alexandria's error handling pattern:

**Pattern**: Return `null` on failure, never throw

```typescript
export async function fetchBookByISBN(
  isbn: string,
  env: Env,
  logger?: Logger
): Promise<WikidataBookMetadata | null> {
  try {
    // Validate input
    const normalized = normalizeISBN(isbn);
    if (!normalized) {
      logger?.warn('Invalid ISBN', { isbn });
      return null;
    }

    // Check cache
    const cached = await getCachedResponse(...);
    if (cached) return cached;

    // Enforce rate limit
    await enforceRateLimit(...);

    // Execute query
    const response = await fetchWithRetry(...);
    if (!response.ok) {
      logger?.warn('Query failed', { status: response.status });
      return null;
    }

    // Parse and cache
    const data = await response.json();
    await setCachedResponse(...);

    return data;

  } catch (error) {
    logger?.warn('Unexpected error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
```

**Benefits**:
- Graceful degradation (failures don't break enrichment)
- Caller can try next provider in chain
- Errors logged with context for debugging
- No uncaught exceptions

---

## User-Agent Best Practices

All Open API requests include a respectful User-Agent with:
1. **Project name and version** - Identifies our application
2. **Contact email** - Allows API operators to reach us
3. **Purpose** - Explains how we use the API
4. **Donation link** - Shows support for the service

**Format**: `Alexandria/{version} ({contact}; {purpose}; Donate: {donation_url})`

**Examples**:
- Archive.org: `Alexandria/2.3.0 (nerd@ooheynerds.com; Cover images; Donate: https://archive.org/donate)`
- Wikipedia: `Alexandria/2.3.0 (nerd@ooheynerds.com; Author biographies; Donate: https://donate.wikimedia.org)`
- Wikidata: `Alexandria/2.3.0 (nerd@ooheynerds.com; Book metadata enrichment; Donate: https://donate.wikimedia.org)`

**Implementation**:
```typescript
export function buildUserAgent(provider: Provider, purpose: string): string {
  const donationUrl = DONATION_URLS[provider];
  return `Alexandria/${ALEXANDRIA_VERSION} (${CONTACT_EMAIL}; ${purpose}; Donate: ${donationUrl})`;
}
```

---

## Monitoring

### Success Rates

Track success rates by provider to understand coverage:

```typescript
// Archive.org
const archiveCover = await fetchArchiveOrgCover(isbn, env);
if (archiveCover) {
  // Log success
  console.log('[Archive.org] Cover found', { isbn });
} else {
  // Log miss
  console.log('[Archive.org] Cover not found', { isbn });
}
```

### Cache Hit Rates

Monitor cache effectiveness:

```typescript
const cached = await getCachedResponse(env.CACHE, cacheKey, logger);
if (cached) {
  logger.debug('Cache hit', { cacheKey });
  // Track cache hits
} else {
  logger.debug('Cache miss', { cacheKey });
  // Track cache misses
}
```

### Rate Limit Compliance

Rate limiting automatically logs when delays occur:

```typescript
await enforceRateLimit(env.CACHE, kvKey, minDelayMs, logger);
// Logs: "Rate limit: waiting 500ms" if needed
```

---

## Troubleshooting

### Cover Not Found

**Problem**: `fetchBestCover()` returns placeholder
**Diagnosis**:
1. Check if ISBN is valid: `normalizeISBN(isbn)` returns non-null
2. Test each provider manually:
   ```typescript
   const google = await fetchGoogleBooksCover(isbn, env);
   const openlibrary = await fetchOpenLibraryCover(isbn);
   const archive = await fetchArchiveOrgCover(isbn, env);
   const wikidata = await fetchWikidataCover(isbn, env, logger);
   const isbndb = await fetchISBNdbCover(isbn, env);
   ```
3. Check Worker logs for warnings
4. Verify book exists in provider databases (especially for obscure books)

**Solution**: Some books legitimately have no covers available

### Biography Not Found

**Problem**: `fetchAuthorBiography()` returns null
**Diagnosis**:
1. Check if author has Wikidata Q-ID: `enriched_authors.wikidata_id`
2. Verify Wikipedia article exists (try manual search)
3. Check disambiguation: Name may be ambiguous (e.g., "John Smith")
4. Review confidence scoring in logs

**Solution**:
- For notable authors with Q-IDs: Should work (174K+ authors)
- For non-notable authors: Expected to return null
- For ambiguous names: Conservative strategy returns null (prevents false matches)

### Wikidata Query Slow

**Problem**: SPARQL query takes >5 seconds
**Diagnosis**:
1. Check query complexity (multiple optional joins)
2. Verify rate limiting is working (not hammering endpoint)
3. Test query directly: https://query.wikidata.org/

**Solution**:
- Wikidata SPARQL endpoint can be slow (community-maintained)
- Caching helps (30-day TTL)
- Consider reducing optional fields in query

### Rate Limit Errors

**Problem**: Getting 429 Too Many Requests
**Diagnosis**:
1. Check KV is working: `await env.CACHE.get('test')`
2. Verify rate limit delays: Add logging to `enforceRateLimit()`
3. Check for parallel requests (should be sequential with delays)

**Solution**:
- Ensure KV-backed rate limiting is enabled
- Increase delays if needed (currently very conservative)
- Check for bugs causing rapid sequential calls

---

## Best Practices

### 1. Always Use KV-Backed Rate Limiting

❌ **Wrong**: In-memory state
```typescript
private lastRequestTime = 0; // Doesn't work in distributed Workers
```

✅ **Right**: KV-backed state
```typescript
await enforceRateLimit(env.CACHE, kvKey, minDelayMs, logger);
```

### 2. Cache Aggressively

Open APIs are slow (~200-500ms per request). Cache everything:

```typescript
// Check cache first
const cached = await getCachedResponse(...);
if (cached) return cached;

// Fetch from API
const data = await fetchFromAPI(...);

// Cache result
await setCachedResponse(..., data, ttlSeconds, logger);
```

### 3. Fail Gracefully

Never let API failures break enrichment:

```typescript
export async function enrichBook(isbn: string): Promise<void> {
  // Try Wikidata
  const wikidataData = await fetchBookByISBN(isbn, env, logger);
  if (wikidataData) {
    // Use Wikidata metadata
  }

  // Try other sources (don't give up if one fails)
  const archiveCover = await fetchArchiveOrgCover(isbn, env);
  if (archiveCover) {
    // Use Archive.org cover
  }

  // Continue enrichment even if both fail
}
```

### 4. Log Context

Include useful context in all logs:

```typescript
logger.warn('Wikidata query failed', {
  isbn,
  status: response.status,
  error: errorText.substring(0, 200)
});
```

### 5. Respect Donation Links

Include donation links in User-Agent (we use these services for free):

```typescript
buildUserAgent('wikipedia', 'Author biographies')
// Returns: "Alexandria/2.3.0 (...; Donate: https://donate.wikimedia.org)"
```

---

## Future Enhancements

### Phase 5 Remaining
- [ ] Donation tracking system (log monthly usage)
- [ ] Donation recommendation report

### Phase 6 Remaining
- [ ] Unit tests with mocked API responses
- [ ] Integration tests with real APIs
- [ ] Success rate analytics
- [ ] Performance monitoring

### Long-Term
- [ ] Multilingual Wikipedia support (other language editions)
- [ ] Wikidata conflict resolution (multiple ISBNs for same work)
- [ ] Author batch enrichment (bulk Wikidata queries)
- [ ] Cover quality scoring (ML-based image analysis)

---

## Related Documentation

- **Rate Limits**: `docs/operations/RATE-LIMITS.md`
- **Donation Tracking**: `docs/operations/DONATION-TRACKING.md`
- **Cover Fetcher**: `worker/services/cover-fetcher.ts`
- **CLAUDE.md**: Main project documentation

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/jukasdrj/alexandria/issues
- Issue #159: Open API Integration tracking

For API operator support:
- Archive.org: https://archive.org/about/contact.php
- Wikipedia: https://en.wikipedia.org/wiki/Wikipedia:Contact_us
- Wikidata: https://www.wikidata.org/wiki/Wikidata:Contact
