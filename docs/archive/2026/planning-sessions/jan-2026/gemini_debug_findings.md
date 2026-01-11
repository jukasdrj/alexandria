# Debug Findings: Gemini Backfill Quota Exhaustion Issue

## 🔴 ACTUAL ROOT CAUSE (Revised)

### The Real Problem

**Issue**: Backfill fails when ISBNdb quota is exhausted, despite having 4 other external API services available for fallback.

**Expected Behavior**: Backfill should work WITHOUT ISBNdb by using:
1. Wikidata (SPARQL queries)
2. Archive.org (pre-2000 books)
3. Google Books (free tier)
4. Wikipedia (author data)

**Current Behavior**: Backfill appears to depend on ISBNdb for ISBN resolution, blocking the entire workflow when quota exhausted.

## Evidence

1. ✅ ISBNdb quota status: `"used_today": 2275` (near limit)
2. ✅ User confirms: "ISBNdb is maxed out again already for the day"
3. ✅ Gemini API works (test endpoint succeeds)
4. ✅ 4 external APIs available but not being used as fallback

## Code Analysis Needed

### Files to Investigate

1. **worker/src/services/hybrid-backfill.ts**
   - Does it require ISBNdb for ISBN resolution?
   - Can it fall back to other APIs?

2. **worker/src/services/isbn-resolution.ts**
   - Is this ISBNdb-only?
   - Should integrate with Open APIs

3. **worker/src/services/wikidata.ts**
   - Has `fetchBookByISBN()` - can resolve metadata
   - Should be used as fallback

4. **worker/src/services/archive-org.ts**
   - Can provide cover URLs and metadata

5. **worker/src/services/wikipedia.ts**
   - Author biographies with Wikidata lookup

## Hypothesis

The backfill workflow is structured as:
1. Gemini → Generate book metadata (title, author) ✅ WORKS
2. ISBNdb → Resolve ISBN from title/author ❌ FAILS when quota exhausted
3. STOP → No fallback to other APIs

**Should be**:
1. Gemini → Generate book metadata ✅
2. Try ISBNdb for ISBN ⚠️ May fail
3. **Fallback to Wikidata SPARQL** (search by title/author)
4. **Fallback to Google Books** (search by title/author)
5. **Fallback to OpenLibrary** (search API)
6. Create synthetic work if all fail (already implemented)

## Code Analysis Results

### hybrid-backfill.ts Analysis

**Line 138-142: THE PROBLEM**
```typescript
const apiKey = await env.ISBNDB_API_KEY.get();
if (!apiKey) {
  throw new Error('ISBNDB_API_KEY not configured');
}
```

**Issues Found**:
1. ❌ No quota check before calling ISBNdb
2. ❌ No fallback if ISBNdb quota exhausted
3. ✅ DOES save candidates without ISBNs (line 164-190)
4. ✅ Logs when ISBN not resolved (line 184-190)

**Current Flow**:
1. Gemini → Generate metadata ✅
2. ISBNdb → Resolve ISBN (NO QUOTA CHECK)
3. Save candidates (with or without ISBN) ✅
4. Return to caller

**Problem**: ISBNdb is called even when quota exhausted, wasting API calls and not using available alternatives (Wikidata, Google Books, Archive.org).

### What Happens When ISBNdb Quota Exhausted

From `isbn-resolution.ts` (Line 153 in hybrid-backfill):
- `batchResolveISBNs()` is called
- Each book makes 1 ISBNdb API call
- If quota exhausted → Returns empty ISBN (`isbn: null`)
- Candidate saved as "synthetic work" (no ISBN)

**THIS IS WASTEFUL**:
- Makes 20 ISBNdb calls even when quota is 0
- Doesn't try Wikidata/Google Books
- Creates synthetic works unnecessarily

### isbn-resolution.ts Analysis

**Lines 423-430: Quota Check EXISTS**
```typescript
const quotaCheck = quotaManager ? async (): Promise<boolean> => {
  if (quotaExhausted) return false;
  const result = await quotaManager.checkQuota(1, true);
  if (!result.allowed) {
    quotaExhausted = true;
    return false;
  }
  return true;
} : undefined;
```

**What Happens When Quota Exhausted**:
1. ✅ Quota check returns `false`
2. ✅ ISBNdb API call SKIPPED
3. ✅ Returns `{isbn: null, confidence: 'not_found'}`
4. ❌ **NO FALLBACK TO OTHER APIs**

### async-backfill.ts Analysis

**Lines 229-284: Quota Manager Provided**
- ✅ quotaManager IS passed to hybrid workflow
- ✅ Checks `isbndb_daily_calls` in KV
- ✅ Limit set to 13,000 (safety buffer)
- ✅ Gracefully stops when exhausted

## 🎯 ROOT CAUSE CONFIRMED

**The system works as designed, but the design is INCOMPLETE:**

1. ✅ Quota check works (stops wasting ISBNdb calls)
2. ✅ Saves Gemini data as synthetic work (preserves AI results)
3. ❌ **MISSING**: Fallback to Wikidata/Google Books/Archive.org/Wikipedia before creating synthetic work

**Current Flow**:
```
Gemini → ISBNdb (quota check) → FAIL → Synthetic Work
```

**Desired Flow**:
```
Gemini → ISBNdb (quota check) → FAIL
  → Try Wikidata SPARQL → FAIL
  → Try Google Books Search → FAIL
  → Try OpenLibrary Search → FAIL
  → Last Resort: Synthetic Work
```

## Solution Design

### New Service: `multi-api-isbn-resolver.ts`

**Cascading Fallback Chain**:
```typescript
export async function resolveISBNMultiSource(
  metadata: BookMetadata,
  env: Env,
  logger: Logger,
  quotaManager?: QuotaManager
): Promise<ISBNResolutionResult> {

  // 1. Try ISBNdb (if quota available)
  if (quotaManager) {
    const quotaCheck = await quotaManager.checkQuota(1, false);
    if (quotaCheck.allowed) {
      const result = await resolveViaISBNdb(metadata, env, logger, quotaManager);
      if (result.isbn) return result;
    }
  }

  // 2. Try Wikidata SPARQL (free, no quota)
  const wikidataResult = await resolveViaWikidata(metadata, env, logger);
  if (wikidataResult.isbn) return wikidataResult;

  // 3. Try Google Books (free tier)
  const googleResult = await resolveViaGoogleBooks(metadata, env, logger);
  if (googleResult.isbn) return googleResult;

  // 4. Try OpenLibrary Search
  const openLibResult = await resolveViaOpenLibrary(metadata, logger);
  if (openLibResult.isbn) return openLibResult;

  // 5. Last resort: Not found
  return { isbn: null, confidence: 'not_found', source: 'none' };
}
```

## Open API Search Capabilities Analysis

### Wikidata Service (`worker/services/wikidata.ts`)

**ISBN Lookup (Line 321)**: ✅ `fetchBookByISBN(isbn, env, logger)`
- Searches by ISBN-13 (P212) or ISBN-10 (P957)
- Returns: title, authors, genres, subjects, cover image, publication date
- SPARQL query with comprehensive metadata
- **NO title/author search function currently**

**What's Available**:
- ✅ ISBN → Book metadata (SPARQL)
- ✅ Author Q-ID → Bibliography (SPARQL)
- ✅ Author Q-ID → Full metadata (SPARQL)
- ❌ Title/Author → ISBN search (NOT IMPLEMENTED)

**Potential Solution**: Could add SPARQL query for title/author search:
```sparql
SELECT ?book ?isbn13 ?isbn10
WHERE {
  ?book wdt:P1476 ?title .
  ?book wdt:P50 ?author .
  ?author rdfs:label ?authorLabel .
  FILTER(CONTAINS(LCASE(?title), LCASE("search title")))
  FILTER(CONTAINS(LCASE(?authorLabel), LCASE("author name")))
  OPTIONAL { ?book wdt:P212 ?isbn13 . }
  OPTIONAL { ?book wdt:P957 ?isbn10 . }
}
```

### Google Books Service (`worker/services/google-books.ts`)

**ISBN Lookup (Line 175)**: ✅ `fetchGoogleBooksMetadata(isbn, env, logger)`
- API: `GET /volumes?q=isbn:{isbn}`
- Returns: title, authors, categories, publisher, description
- **NO title/author search function currently**

**What's Available**:
- ✅ ISBN → Book metadata (REST API)
- ✅ Category extraction helpers
- ✅ Batch category extraction
- ❌ Title/Author → ISBN search (NOT IMPLEMENTED)

**Potential Solution**: Google Books API supports text search:
```
GET /volumes?q=intitle:{title}+inauthor:{author}
```
Then extract ISBN from `volumeInfo.industryIdentifiers`

### Archive.org Service (`worker/services/archive-org.ts`)

**ISBN Lookup (Line 575)**: ✅ `fetchArchiveOrgCover(isbn, env)`
**Metadata Lookup (Line 418)**: ✅ `fetchArchiveOrgMetadata(isbn, env, logger)`
- Uses Advanced Search API: `isbn:{isbn}`
- Returns: cover URL, metadata, OpenLibrary crosswalk
- **HAS search capability** (Line 150: `searchArchiveOrgByISBN`)

**What's Available**:
- ✅ ISBN → Cover + Metadata (Advanced Search API)
- ✅ Search infrastructure exists (can be adapted)
- ❌ Title/Author → ISBN search (NOT IMPLEMENTED, but Advanced Search API supports it)

**Potential Solution**: Archive.org Advanced Search supports complex queries:
```
https://archive.org/advancedsearch.php?q=title:{title} AND creator:{author}&output=json
```

## 🎯 CRITICAL FINDING

**None of the Open API services have title/author → ISBN search implemented.**

All services focus on ISBN → metadata enrichment, but the backfill workflow needs the OPPOSITE:
- **Current**: ISBN → metadata (for enrichment after ISBNdb resolves ISBN)
- **Needed**: Title/Author → ISBN (when ISBNdb quota exhausted)

## Solution Design Options

### Option A: Implement Search Functions (RECOMMENDED)

Add title/author search to each service:
1. **Google Books** (easiest, best API)
   - `searchGoogleBooksByTitleAuthor(title, author, env, logger)`
   - API already supports: `GET /volumes?q=intitle:{title}+inauthor:{author}`
   - Extract ISBN from `volumeInfo.industryIdentifiers`

2. **Archive.org** (second choice, good for pre-2000 books)
   - `searchArchiveOrgByTitleAuthor(title, author, env, logger)`
   - Advanced Search API: `title:{title} AND creator:{author}`
   - Already has `searchArchiveOrgByISBN()` infrastructure

3. **Wikidata** (third choice, slower SPARQL queries)
   - `searchWikidataByTitleAuthor(title, author, env, logger)`
   - SPARQL query with fuzzy title matching
   - May have lower coverage for recent books

### Option B: OpenLibrary Search API (ALTERNATIVE)

Use OpenLibrary's free Search API:
- Endpoint: `https://openlibrary.org/search.json?title={title}&author={author}`
- Returns: ISBNs, OpenLibrary IDs, metadata
- Free, no quota, good coverage
- **NOT currently integrated in Alexandria**

## 🎯 EXPERT ANALYSIS RESULTS (Gemini 2.5 Pro)

### Critical Refinement: Two-Step Validation Required

**Problem**: Simply taking the first ISBN from a search API is unreliable and will introduce data corruption.

**Example**: Searching "The Shining" by "Stephen King" might return:
- Multiple editions (hardcover, paperback, audiobook)
- Translations (Spanish, French, Japanese)
- Completely unrelated works with similar titles

**Solution**: Each resolver must perform **Search → Validate** loop:

1. **Search**: Call provider's search API with `title` and `author`
2. **Validate**: For each ISBN returned:
   - Fetch that ISBN's full metadata via second API call
   - Compare fetched title/author with original query
   - Use string similarity algorithm (Levenshtein distance)
   - Accept match only if similarity > threshold (e.g., 0.7 = 70%)

**Impact on Performance**:
- Doubles API calls for each successful lookup
- Original estimate: 60-80 seconds for 20 books (3-4 sec/book)
- **Revised estimate**: 100-120 seconds for 20 books with validation (5-6 sec/book)
- Still acceptable for backfill system

### Refined Implementation Architecture

**1. Universal Resolver Interface** (`worker/src/services/book-resolution/interfaces.ts`):
```typescript
interface IBookResolver {
  /**
   * Searches for a book by title and author and returns a validated ISBN.
   * Implementation must include a validation step to ensure the result matches the query.
   * Returns null if no definitive match is found.
   */
  resolve(title: string, author: string): Promise<string | null>;
}
```

**2. Resolver Classes** (one per service):
- `IsbnDbResolver` (existing, wrapped with interface)
- `GoogleBooksResolver` (new - Search → Validate)
- `OpenLibraryResolver` (new - Search → Validate)
- `ArchiveOrgResolver` (new - Search → Validate)
- `WikidataResolver` (new - Search → Validate via SPARQL)

**3. Orchestrator** (`worker/src/services/book-resolution/resolution-orchestrator.ts`):
```typescript
class ResolutionOrchestrator {
  private resolvers: IBookResolver[];

  constructor() {
    this.resolvers = [
      new IsbnDbResolver(),
      new GoogleBooksResolver(),
      new OpenLibraryResolver(),
      new ArchiveOrgResolver(),
      new WikidataResolver(),
    ];
  }

  async findIsbn(title: string, author: string): Promise<string | null> {
    for (const resolver of this.resolvers) {
      try {
        const isbn = await this.executeWithTimeout(
          () => resolver.resolve(title, author),
          15000 // 15-second timeout per resolver
        );

        if (isbn) {
          console.log(`Resolved via ${resolver.constructor.name}`);
          return isbn;
        }
      } catch (error) {
        console.error(`Resolver ${resolver.constructor.name} failed`, error);
        // Continue to next resolver
      }
    }
    return null;
  }

  private async executeWithTimeout<T>(promiseFn: () => Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promiseFn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), ms)
      ),
    ]);
  }
}
```

**4. Observability**: Log which resolver succeeds for each book
- Track success rate per resolver
- Tune fallback chain order based on real data
- Identify when to re-order for better performance

### Updated Implementation Plan

**Phase 1: Core Resolver Classes** (~4 hours with validation)
1. `GoogleBooksResolver` - Search → Validate → Return ISBN
2. `OpenLibraryResolver` - Search → Validate → Return ISBN
3. `ArchiveOrgResolver` - Search → Validate → Return ISBN
4. `WikidataResolver` - SPARQL Search → Validate → Return ISBN

**Phase 2: Orchestrator** (~2 hours)
- `ResolutionOrchestrator` with timeout logic
- Logging and observability
- Error handling and graceful degradation

**Phase 3: Integration** (~1 hour)
- Modify `isbn-resolution.ts` to use orchestrator
- Preserve ISBNdb quota checking
- Add source tracking

**Phase 4: Testing** (~3 hours with validation tests)
- Unit tests for each resolver (Search + Validate)
- Integration tests with quota exhausted
- Performance benchmarks
- Validation accuracy tests

**Total Estimate**: 10 hours → **12 hours** (with validation complexity)

### Files to Create/Modify (Revised)

**NEW FILES**:
- `worker/src/services/book-resolution/interfaces.ts` (~50 LOC)
- `worker/src/services/book-resolution/resolution-orchestrator.ts` (~150 LOC)
- `worker/src/services/book-resolution/resolvers/isbndb-resolver.ts` (~100 LOC)
- `worker/src/services/book-resolution/resolvers/google-books-resolver.ts` (~200 LOC)
- `worker/src/services/book-resolution/resolvers/open-library-resolver.ts` (~200 LOC)
- `worker/src/services/book-resolution/resolvers/archive-org-resolver.ts` (~150 LOC)
- `worker/src/services/book-resolution/resolvers/wikidata-resolver.ts` (~200 LOC)
- `worker/services/open-library.ts` (~150 LOC - base search functions)

**MODIFIED FILES**:
- `worker/src/services/isbn-resolution.ts` (~50 LOC changes)
- `worker/services/google-books.ts` (~50 LOC - add search function)
- `worker/services/archive-org.ts` (~50 LOC - add search function)
- `worker/services/wikidata.ts` (~100 LOC - add SPARQL search)

**Total**: ~1,450 LOC (more modular, better tested)

### Success Metrics (Revised with Validation)

- ✅ Backfill works with ISBNdb quota exhausted
- ✅ ISBN resolution success rate **>60%** (conservative with validation)
- ✅ Synthetic work creation reduced by **60%+**
- ✅ Avg time per book **<6 seconds** (20 books in 120 seconds)
- ✅ **Validation accuracy >95%** (no false positive ISBNs)
- ✅ Zero data corruption from incorrect ISBN matches

## Next Steps

1. ✅ Read hybrid-backfill.ts - COMPLETE
2. ✅ Read isbn-resolution.ts - COMPLETE (quota handling exists)
3. ✅ Check if Wikidata search-by-title exists - COMPLETE (NO)
4. ✅ Check if Google Books search-by-title exists - COMPLETE (NO)
5. ✅ Expert analysis complete - VALIDATED
6. [ ] **USER DECISION NEEDED**: Approve refined architecture with Search → Validate pattern
7. [ ] Implement resolver classes with validation
8. [ ] Implement orchestrator with timeouts
9. [ ] Test with ISBNdb quota exhausted
