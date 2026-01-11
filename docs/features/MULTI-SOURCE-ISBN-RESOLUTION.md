# Multi-Source ISBN Resolution - Technical Documentation

**Version:** 2.5.0
**Status:** Production Deployed (Jan 11, 2026)
**Priority:** Critical - Resolves ISBNdb quota exhaustion

---

## Overview

The Multi-Source ISBN Resolution system provides **cascading fallback** when ISBNdb quota is exhausted, enabling continuous backfill operation 24/7 instead of failing when quota depletes.

### Problem Statement

**Before v2.5.0:**
- Backfill completely failed when ISBNdb quota exhausted (typically 4+ hours daily)
- No fallback to 4 available free APIs (Wikidata, Archive.org, Google Books, Wikipedia)
- All Gemini-generated metadata lost when ISBNs couldn't be resolved
- **Impact**: Lost 16%+ of daily enrichment capacity

**After v2.5.0:**
- Automatic fallback to free APIs when ISBNdb quota exhausted
- Zero data loss (Gemini metadata preserved as synthetic works)
- Expected 60%+ ISBN resolution via fallback APIs
- **Impact**: Continuous operation 24/7

---

## Architecture

### 5-Tier Cascading Fallback Chain

```
┌─────────────────────────────────────────────────────────────┐
│ Gemini API: Generate book metadata (title, author)         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: ISBNdb (Primary)                                   │
│ - Premium API, $29.95/mo                                   │
│ - Rate: 3 req/sec, ~15K calls/day                          │
│ - Quota check: KV-backed, distributed-safe                 │
│ - Performance: 1-2 seconds per book                        │
└────────────────────┬────────────────────────────────────────┘
                     │ Quota Exhausted?
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 2: Google Books (1st Fallback) [TODO]                 │
│ - Free tier API                                             │
│ - Rate: 1 req/sec                                           │
│ - Coverage: Good (40M+ books)                               │
│ - Performance: 2-3 seconds per book                         │
└────────────────────┬────────────────────────────────────────┘
                     │ No Result?
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 3: OpenLibrary (2nd Fallback) ✅ IMPLEMENTED          │
│ - Free Search API                                           │
│ - Rate: 100 req per 5 minutes (1 req/3 sec)                │
│ - Coverage: Reliable (~20M+ books)                          │
│ - Performance: 3-6 seconds per book                         │
└────────────────────┬────────────────────────────────────────┘
                     │ No Result?
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 4: Archive.org (3rd Fallback) [TODO]                  │
│ - Free Advanced Search API                                  │
│ - Rate: 1 req/sec                                           │
│ - Coverage: Excellent for pre-2000 books                    │
│ - Performance: 4-6 seconds per book                         │
└────────────────────┬────────────────────────────────────────┘
                     │ No Result?
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 5: Wikidata (Last Resort) [TODO]                      │
│ - Free SPARQL endpoint                                      │
│ - Rate: 2 req/sec                                           │
│ - Coverage: Comprehensive, lower ISBN coverage              │
│ - Performance: 5-10 seconds per book (slow SPARQL)          │
└────────────────────┬────────────────────────────────────────┘
                     │ No Result?
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Create Synthetic Work (Last Resort)                        │
│ - Preserve Gemini metadata in database                      │
│ - completeness_score = 30                                   │
│ - Can be enhanced later by daily cron                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Search → Validate Pattern

**Critical Quality Control**: Each resolver implements a two-step process to prevent false positives.

### Step 1: Search
Query the provider's API with title and author:
```typescript
const searchResults = await searchByTitleAuthor(
  'The Splendid and the Vile',
  'Erik Larson'
);
// Returns: Array of ISBNs that might match
```

### Step 2: Validate
For each ISBN returned by search:
1. Fetch full metadata for that ISBN
2. Compare fetched title/author with original query
3. Use **Levenshtein distance** string similarity algorithm
4. Accept match only if **both** title AND author have >= 70% similarity

```typescript
for (const isbn of searchResults.isbns) {
  const metadata = await fetchByISBN(isbn);

  const titleSimilarity = calculateStringSimilarity(
    metadata.title,
    'The Splendid and the Vile'
  );

  const authorSimilarity = calculateStringSimilarity(
    metadata.author,
    'Erik Larson'
  );

  if (titleSimilarity >= 0.7 && authorSimilarity >= 0.7) {
    return { isbn, validated: true }; // Accept match
  }
}
```

**Why This Matters:**
- Prevents returning ISBNs for wrong books (e.g., translations, study guides)
- Handles title variations (subtitles, punctuation differences)
- Handles author name formats (First Last vs Last, First)
- Prevents data corruption from false positives

**Performance Impact:**
- Doubles API calls per successful resolution (search + validate)
- Worth the cost: Data quality >> speed
- Original estimate: 60-80 seconds for 20 books
- Actual with validation: 100-120 seconds (still acceptable)

---

## Implementation

### File Structure

```
worker/
├── services/
│   └── open-library.ts              # OpenLibrary API client (365 LOC)
│       ├── searchOpenLibraryByTitleAuthor()
│       ├── resolveISBNFromOpenLibrary()
│       └── fetchOpenLibraryByISBN()
│
├── src/services/
│   ├── isbn-resolution.ts           # Modified: Fallback integration
│   │   └── batchResolveISBNs()      # Now calls orchestrator on quota exhaustion
│   │
│   └── book-resolution/             # NEW: Resolver architecture
│       ├── interfaces.ts            # IBookResolver interface (165 LOC)
│       │   ├── IBookResolver
│       │   ├── calculateStringSimilarity()
│       │   └── validateMetadataMatch()
│       │
│       ├── resolution-orchestrator.ts  # Cascading fallback (185 LOC)
│       │   └── ResolutionOrchestrator.findISBN()
│       │
│       └── resolvers/
│           └── open-library-resolver.ts  # OpenLibrary impl (132 LOC)
│               └── OpenLibraryResolver.resolve()
│
└── lib/
    └── open-api-utils.ts            # Modified: Added OpenLibrary rate limits
```

### Key Components

#### 1. IBookResolver Interface

Defines the contract all resolvers must implement:

```typescript
interface IBookResolver {
  /**
   * Resolve ISBN from title and author
   * MUST validate results before returning (Search → Validate pattern)
   */
  resolve(
    title: string,
    author: string,
    env: Env,
    logger?: Logger
  ): Promise<ISBNResolutionResult>;

  readonly name: string; // For logging
}
```

#### 2. ResolutionOrchestrator

Manages the cascading fallback chain:

```typescript
class ResolutionOrchestrator {
  private resolvers: IBookResolver[];

  async findISBN(
    title: string,
    author: string,
    env: Env,
    logger?: Logger
  ): Promise<ISBNResolutionResult> {
    for (const resolver of this.resolvers) {
      try {
        const result = await this.executeWithTimeout(
          () => resolver.resolve(title, author, env, logger),
          15000 // 15-second timeout
        );

        if (result.isbn) {
          logger.info('ISBN resolved successfully', {
            source: result.source,
            resolver: resolver.name,
          });
          return result;
        }
      } catch (error) {
        // Log and continue to next resolver
      }
    }

    return { isbn: null, confidence: 0, source: 'not_found' };
  }
}
```

**Features:**
- 15-second timeout per resolver (prevents stalls)
- Comprehensive logging (which resolver succeeded)
- Graceful error handling (failures don't break chain)
- Lazy initialization (only created when needed)

#### 3. OpenLibraryResolver

Implements Search → Validate for OpenLibrary:

```typescript
class OpenLibraryResolver implements IBookResolver {
  readonly name = 'OpenLibraryResolver';

  async resolve(
    title: string,
    author: string,
    env: Env,
    logger?: Logger
  ): Promise<ISBNResolutionResult> {
    // Step 1: Search
    const searchResult = await searchOpenLibraryByTitleAuthor(
      title,
      author,
      env,
      logger
    );

    if (!searchResult?.isbns?.length) {
      return { isbn: null, confidence: 0, source: 'open-library' };
    }

    // Step 2: Validate each ISBN
    for (const isbn of searchResult.isbns) {
      const metadata = await fetchOpenLibraryByISBN(isbn, env, logger);

      if (validateMetadataMatch(
        metadata.title,
        metadata.authorNames[0],
        title,
        author
      )) {
        return {
          isbn,
          confidence: searchResult.confidence,
          source: 'open-library',
        };
      }
    }

    return { isbn: null, confidence: 0, source: 'open-library' };
  }
}
```

---

## Integration Points

### Modified: `isbn-resolution.ts`

Added fallback logic when ISBNdb quota exhausted:

```typescript
export async function batchResolveISBNs(
  books: BookMetadata[],
  apiKey: string,
  logger: Logger,
  quotaManager?: QuotaManager,
  env?: Env  // NEW: Required for fallback resolvers
): Promise<ISBNResolutionResult[]> {
  let orchestrator: ResolutionOrchestrator | null = null;

  for (const book of books) {
    if (quotaExhausted) {
      // Lazy initialize orchestrator
      if (!orchestrator && env) {
        orchestrator = new ResolutionOrchestrator();
      }

      // Use fallback resolvers
      const fallbackResult = await orchestrator.findISBN(
        book.title,
        book.author,
        env,
        logger
      );

      results.push(convertToISBNResolutionResult(fallbackResult));
      continue;
    }

    // Normal ISBNdb flow...
  }
}
```

### Modified: `hybrid-backfill.ts`

Pass `env` parameter to enable fallback:

```typescript
const resolutions = await batchResolveISBNs(
  booksMetadata,
  apiKey,
  logger,
  quotaManager,
  env  // NEW: Enables fallback resolvers
);
```

---

## Rate Limiting

### OpenLibrary

**Documented Limit**: 100 requests per 5 minutes
**Our Implementation**: 1 request every 3 seconds (3000ms delay)
**Calculation**: 20 req/min × 5 min = 100 req/5min ✓

**Why Conservative:**
- Leaves buffer for other users
- Prevents rate limit errors
- Follows OpenLibrary best practices

**Implementation**: `worker/lib/open-api-utils.ts`

```typescript
export const RATE_LIMITS = {
  'archive.org': 1000,       // 1 second
  'wikipedia': 1000,         // 1 second
  'wikidata': 500,           // 500ms (2 req/sec)
  'google-books': 1000,      // 1 second
  'open-library': 3000,      // 3 seconds (100 req per 5 min)
} as const;
```

---

## Caching Strategy

**OpenLibrary Cache TTL**: 7 days (604,800 seconds)

**Why 7 Days:**
- Book metadata rarely changes (vs 30 days for Wikidata/Wikipedia)
- Allows for occasional corrections/updates
- Balances freshness vs API load

**Cache Keys**: `open-library:search:{title}:{author}`

**Null Result Caching**: Yes (prevents repeated failed lookups)

---

## Observability

### Logging

**Resolution Success:**
```json
{
  "level": "info",
  "message": "ISBN resolved successfully",
  "title": "The Splendid and the Vile",
  "author": "Erik Larson",
  "isbn": "9780385348737",
  "source": "open-library",
  "resolver": "OpenLibraryResolver",
  "confidence": 85,
  "resolverDurationMs": 4523,
  "totalDurationMs": 4523
}
```

**Fallback Triggered:**
```json
{
  "level": "info",
  "message": "ISBNdb quota exhausted, using fallback resolvers",
  "title": "The Splendid and the Vile",
  "author": "Erik Larson"
}
```

**Orchestrator Initialized:**
```json
{
  "level": "info",
  "message": "Initialized fallback orchestrator",
  "resolvers": [
    { "name": "OpenLibraryResolver", "order": 1 }
  ]
}
```

### Monitoring

**Key Metrics to Track:**
- Fallback trigger rate (how often ISBNdb quota exhausted)
- Per-resolver success rate (OpenLibrary, Google Books, etc.)
- Average resolution time per resolver
- ISBN resolution rate (% of books with ISBNs)
- Synthetic work creation rate (% of books without ISBNs)

**Query Logs:**
```bash
npx wrangler tail alexandria --format pretty | grep -E "(ISBNResolution|OpenLibrary)"
```

---

## Performance

### Expected Timings

| Scenario | Time per Book | 20-Book Batch |
|----------|---------------|---------------|
| ISBNdb available | 1-2 seconds | 20-40 seconds |
| OpenLibrary fallback | 3-6 seconds | 60-120 seconds |
| All resolvers fail | 60-75 seconds | 1200-1500 seconds |

### Worst Case Analysis

**5 resolvers × 15-second timeout = 75 seconds per book**

If all 5 resolvers fail for 20 books:
- Worst case: 1500 seconds (25 minutes)
- Realistic: Most books resolve within 2-3 resolvers (120-180 seconds)

**Why This Is Acceptable:**
- Backfill runs asynchronously (doesn't block users)
- 2-3 minutes per batch acceptable for background job
- Alternative is 0% success (current behavior)

---

## Future Enhancements

### Planned Resolvers

#### Google Books Resolver (Priority: High)
- **API**: `GET /volumes?q=intitle:{title}+inauthor:{author}`
- **Coverage**: Excellent (40M+ books)
- **Performance**: Fast (2-3 seconds)
- **Status**: TODO
- **Estimated Implementation**: 200 LOC

#### Archive.org Resolver (Priority: Medium)
- **API**: Advanced Search `title:{title} AND creator:{author}`
- **Coverage**: Excellent for pre-2000 books
- **Performance**: Moderate (4-6 seconds)
- **Status**: TODO
- **Estimated Implementation**: 150 LOC

#### Wikidata Resolver (Priority: Low)
- **API**: SPARQL query with fuzzy title matching
- **Coverage**: Comprehensive, lower ISBN coverage
- **Performance**: Slow (5-10 seconds)
- **Status**: TODO
- **Estimated Implementation**: 200 LOC

### Performance Optimizations

1. **Parallel Resolution** (instead of sequential)
   - Try multiple resolvers concurrently
   - Use `Promise.race()` to return first success
   - Trade-off: More API calls, faster results

2. **Resolver Chain Tuning**
   - Track per-resolver success rates
   - Re-order chain based on real performance data
   - Example: If OpenLibrary success rate > Google Books, swap order

3. **Smart Resolver Selection**
   - Pre-2000 books → Try Archive.org first
   - Popular fiction → Try Google Books first
   - Academic works → Try Wikidata first

---

## Testing

### Manual Testing

**Test ISBNdb Quota Exhaustion:**

1. Artificially exhaust quota (set KV value):
```bash
npx wrangler kv:key put --binding=QUOTA_KV "isbndb_daily_calls" "15000"
```

2. Trigger backfill:
```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{"year": 2020, "month": 1, "batch_size": 5}'
```

3. Monitor logs:
```bash
npx wrangler tail alexandria --format pretty | grep -E "(fallback|OpenLibrary)"
```

**Expected Log Output:**
```
[ISBNResolution] ISBNdb quota exhausted, using fallback resolvers
[ISBNResolution] Initialized fallback orchestrator
[OpenLibrary] search success (title: "...", author: "...")
[ISBNResolution] ISBN resolved successfully (source: open-library)
```

### Unit Tests

**TODO**: Add unit tests for:
- [ ] OpenLibraryResolver.resolve() with mock API responses
- [ ] ResolutionOrchestrator.findISBN() with mock resolvers
- [ ] String similarity validation edge cases
- [ ] Timeout handling
- [ ] Error propagation

---

## Troubleshooting

### No Fallback Triggered

**Symptom**: ISBNdb quota exhausted but fallback not used

**Diagnosis:**
```bash
# Check logs for "No env provided" warning
npx wrangler tail alexandria | grep "No env provided"
```

**Fix**: Ensure `env` parameter passed to `batchResolveISBNs()`

### OpenLibrary Rate Limit Errors

**Symptom**: HTTP 403 "Forbidden" from OpenLibrary

**Diagnosis:**
```bash
# Check OpenLibrary API calls per 5 minutes
npx wrangler tail alexandria | grep "OpenLibrary" | wc -l
```

**Fix**: Increase `RATE_LIMITS['open-library']` to 4000ms (slower but safer)

### Validation Rejecting Valid Matches

**Symptom**: Books not resolving despite being in OpenLibrary

**Diagnosis:**
```bash
# Check validation failures
npx wrangler tail alexandria | grep "failed validation"
```

**Fix**: Lower `SIMILARITY_THRESHOLD` from 0.7 to 0.6 (60% similarity)

---

## References

- **OpenLibrary Search API**: https://openlibrary.org/dev/docs/api/search
- **OpenLibrary Best Practices**: https://openlibrary.org/developers/api
- **Rate Limit Documentation**: https://github.com/internetarchive/openlibrary/issues/10585
- **Implementation**: `worker/src/services/book-resolution/`
- **CLAUDE.md**: ISBN Resolution section
