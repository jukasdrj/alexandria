# Findings: Open API Integration Research

**Last Updated**: 2026-01-09

---

## Existing Alexandria Patterns

### Utility Modules Analysis

**`lib/fetch-utils.ts`**:
- `fetchWithRetry()` - Retry logic with exponential backoff
- Timeout support
- Error handling patterns
- ✅ **REUSE**: Perfect for all new API integrations

**`lib/logger.ts`**:
- Structured logging
- Context-aware logs
- Performance tracking
- ✅ **REUSE**: Use for all API calls

**`lib/isbn-utils.ts`**:
- ISBN normalization
- Checksum validation
- ✅ **REUSE**: For Archive.org/Wikidata ISBN lookups

### Service Module Patterns

**`services/cover-fetcher.ts`**:
- Provider abstraction (fetchGoogleBooksCover, fetchOpenLibraryCover)
- Fallback chain in `fetchBestCover()`
- CoverResult interface standardization
- ✅ **PATTERN**: Follow for Archive.org integration

**`services/external-apis.ts`**:
- Private functions for each provider
- Public `resolveExternalISBN()` orchestrates fallback
- Consistent error handling (return null on failure)
- ✅ **PATTERN**: Follow for Wikipedia/Wikidata

**`services/quota-manager.ts`**:
- Centralized quota tracking
- KV-backed usage storage
- `checkQuota()` and `recordApiCall()`
- ❌ **DON'T REUSE**: Open APIs don't need quota tracking (use rate limiting instead)

### Database Schema Patterns

**Existing enrichment tables**:
- `enriched_works`: `metadata JSONB` column
- `enriched_editions`: `cover_data JSONB`, `external_ids JSONB`
- `enriched_authors`: Currently minimal

**Pattern discovered**:
- JSONB columns for flexible provider data
- Source tracking in `primary_provider` field
- Timestamps: `last_synced`, `created_at`
- ✅ **FOLLOW**: Add `biography_data JSONB` to `enriched_authors`

---

## API Best Practices Research

### Archive.org Guidelines

**Documented Best Practices** (from https://archive.org/about/terms.php):
1. Identify yourself in User-Agent
2. Rate limit to 1 request per second or less
3. Cache responses (avoid duplicate requests)
4. Include contact information

**API Endpoints**:
- Metadata: `https://archive.org/metadata/{identifier}`
- Search: `https://archive.org/advancedsearch.php?q=isbn:{isbn}&output=json`
- Image: `https://archive.org/services/img/{identifier}`

**Rate Limit**: No hard limit, but "be reasonable" (1 req/sec recommended)

**Discovery**:
- ISBN search returns identifier
- Identifier → metadata returns full record
- Covers at: `https://archive.org/services/img/{identifier}`

---

### Wikipedia API Guidelines

**Best Practices** (from https://www.mediawiki.org/wiki/API:Etiquette):
1. User-Agent MUST include contact info
2. Rate limit: No hard limit, but respect server
3. Recommended: Max 200 req/sec (we'll use 1 req/sec)
4. Use compression (Accept-Encoding: gzip)
5. Cache responses (avoid duplicate requests)

**API Endpoints**:
- Main API: `https://en.wikipedia.org/w/api.php`
- Action: `query` with `prop=extracts|pageimages`
- Format: JSON

**Author Disambiguation**:
- Use `prop=categories` to check for "births" category
- Use `prop=pageprops` to check for disambiguation pages
- Fallback: Present multiple options to user

**Example Query**:
```
https://en.wikipedia.org/w/api.php?
  action=query
  &titles=J._K._Rowling
  &prop=extracts|pageimages|categories
  &exintro=1
  &explaintext=1
  &format=json
```

---

### Wikidata Guidelines

**Best Practices** (from https://www.wikidata.org/wiki/Wikidata:Bot_policy):
1. User-Agent MUST include contact info
2. Rate limit: Max 60 req/min for bots
3. Use SPARQL endpoint for complex queries
4. Cache entity data (changes infrequently)

**SPARQL Endpoint**:
- URL: `https://query.wikidata.org/sparql`
- Format: JSON
- Rate limit: 60 req/min (we'll use 2 req/sec max)

**Property IDs** (Important):
- P212: ISBN-13
- P957: ISBN-10
- P50: Author
- P18: Image
- P577: Publication date
- P136: Genre
- P921: Main subject

**Discovery**:
- ISBN → Wikidata uses P212 property
- Author → Works uses P50 property
- Rich structured data available

---

## Caching Strategy Analysis

### Where to Cache?

**Option 1: Cloudflare KV** (Recommended)
- **Pros**: Persistent, global edge cache, fast reads
- **Cons**: Write latency (eventual consistency)
- **Best for**: Author biographies, Wikidata entities (changes rarely)
- **TTL**: 30 days for bios, 7 days for covers

**Option 2: In-Memory Cache**
- **Pros**: Zero latency, simple
- **Cons**: Lost on deployment, not shared across isolates
- **Best for**: Nothing (Cloudflare Workers have no persistent memory)

**Option 3: Database**
- **Pros**: Persistent, queryable
- **Cons**: Slower than KV, query overhead
- **Best for**: Final enriched data storage (not API response cache)

**Decision**: Use KV for API response caching, Database for final enriched data

### Cache Keys

```typescript
// Author biography
`wikipedia:bio:${normalizedAuthorName}` → WikipediaBio

// Archive.org cover
`archive:cover:${isbn}` → CoverResult

// Wikidata entity
`wikidata:entity:${isbn}` → WikidataEntity
```

---

## Rate Limiting Strategy

### Different from Quota Management

**Quota Management** (ISBNdb):
- Tracks daily usage
- Hard limits (15K/day)
- Fail-closed when exhausted

**Rate Limiting** (Open APIs):
- Delays between requests
- Respectful spacing (not enforced by API)
- No daily limits
- Fail-open (just slower)

### Implementation Pattern (CORRECTED - KV-Backed)

**CRITICAL**: In-memory rate limiting does NOT work in Cloudflare Workers distributed environment!
**SOLUTION**: Use KV-backed rate limiting (same pattern as ISBNdb in cover-fetcher.ts lines 84-105)

```typescript
// lib/open-api-utils.ts
/**
 * Enforce rate limit using KV for distributed state
 * Pattern: Same as enforceISBNdbRateLimit in cover-fetcher.ts
 */
export async function enforceRateLimit(
  kv: KVNamespace,
  kvKey: string,
  minDelayMs: number
): Promise<void> {
  const now = Date.now();

  try {
    const lastRequestStr = await kv.get(kvKey);
    const lastRequest = lastRequestStr ? parseInt(lastRequestStr) : 0;
    const timeSinceLastRequest = now - lastRequest;

    if (timeSinceLastRequest < minDelayMs) {
      const waitTime = minDelayMs - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Update KV with current timestamp (60s TTL)
    await kv.put(kvKey, Date.now().toString(), { expirationTtl: 60 });
  } catch (error) {
    console.warn('KV rate limiting unavailable, proceeding without:', (error as Error).message);
  }
}
```

**KV Keys**:
- Archive.org: `rate_limit:archive_org:last_request`
- Wikipedia: `rate_limit:wikipedia:last_request`
- Wikidata: `rate_limit:wikidata:last_request`

**Rate Limits**:
- Archive.org: 1 req/sec (1000ms min delay)
- Wikipedia: 1 req/sec (1000ms min delay)
- Wikidata: 2 req/sec (500ms min delay)

**Binding**: Reuse existing `CACHE` KV namespace (no new KV needed)

---

## Author Name Normalization

### Challenge: Author names are messy

**Examples**:
- "J.K. Rowling"
- "Rowling, J. K."
- "Joanne Rowling"
- "J. K. Rowling"

**Wikipedia requires exact article title**

### Solution: Fuzzy Matching + API

1. **Try exact match first** (API search)
2. **Try variations**:
   - Remove punctuation
   - Swap "Last, First" → "First Last"
   - Add common prefixes/suffixes
3. **Use Wikipedia search API**:
   - `action=opensearch&search={author}`
   - Returns matching article titles
4. **Verify result is a person**:
   - Check for "births" category
   - Check for birth year in extract

---

## Diversity Tracking Data Needs

### What's needed from author bios?

**Demographics** (for diversity tracking):
- Nationality/Ethnicity (text extraction)
- Gender (may need external service or manual curation)
- Birth year (structured from Wikipedia)
- Languages written in (from Wikidata)
- Awards/Recognition (from Wikidata)

**Wikipedia provides**:
- Nationality (often in first paragraph)
- Birth year (from categories/infobox)
- Biography prose (for extraction)

**Wikidata provides**:
- Structured nationality (P27)
- Gender (P21) - but binary, may not reflect reality
- Birth date (P569)
- Ethnic group (P172)
- Languages (P1412)

**Decision**: Store raw Wikipedia extract + structured Wikidata fields, let frontend extract diversity metadata

---

## Error Handling Patterns

### Observed Alexandria Pattern

```typescript
try {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Provider: API error ${response.status}`);
    return null;
  }
  // ... process data ...
  return result;
} catch (error) {
  console.error('Provider fetch error:', (error as Error).message);
  return null;
}
```

**Key principles**:
- Return null on failure (not throw)
- Log errors with context
- Graceful degradation
- ✅ **FOLLOW**: Use for all new integrations

---

## Module Organization

### Proposed Structure

```
worker/
├── services/
│   ├── archive-org.ts       # NEW: Archive.org client
│   ├── wikipedia.ts          # NEW: Wikipedia client
│   ├── wikidata.ts           # NEW: Wikidata SPARQL client
│   ├── cover-fetcher.ts      # MODIFY: Add Archive.org priority
│   └── external-apis.ts      # NO CHANGE
├── lib/
│   ├── open-api-utils.ts     # NEW: Shared utilities
│   ├── sparql-utils.ts       # NEW: SPARQL query builders
│   └── fetch-utils.ts        # EXISTING: Reuse
├── types/
│   └── open-apis.ts          # NEW: Shared TypeScript interfaces
└── src/
    ├── routes/
    │   └── authors.ts         # MODIFY: Add /biography endpoint
    └── services/
        └── queue-handlers.ts  # MODIFY: Add author bio processing
```

---

## Testing Strategy

### Unit Tests

- Mock API responses (MSW)
- Test error handling
- Test rate limiting
- Test caching

### Integration Tests

- Use real APIs (with rate limiting)
- Test end-to-end workflows
- Test disambiguation handling
- Test fallback chains

### Manual Testing Checklist

- [ ] Archive.org: Old book (ISBN: 9780060929879 - Lord of the Rings 1954)
- [ ] Archive.org: Modern book (ISBN: 9780545010221 - Harry Potter)
- [ ] Wikipedia: Well-known author (J.K. Rowling)
- [ ] Wikipedia: Disambiguation (John Smith)
- [ ] Wikipedia: Non-notable author (Unknown Author)
- [ ] Wikidata: Notable book (ISBN: 9780747532699 - Harry Potter)
- [ ] Wikidata: Author bibliography (Stephen King)

---

## Key Discoveries

1. **Archive.org covers are identifier-based**, not ISBN-direct
   - Need 2-step lookup: ISBN → identifier → cover
   - Can batch identifiers for efficiency

2. **Wikipedia disambiguation is complex**
   - Can't reliably auto-resolve author names
   - Best approach: Search API + category verification

3. **Wikidata SPARQL is powerful but complex**
   - Worth investment for long-term value
   - Can replace ISBNdb for notable authors/books

4. **Rate limiting ≠ Quota management**
   - Open APIs need respectful delays, not quota tracking
   - KV not needed for rate limits (in-memory sufficient)

5. **User-Agent is critical for all open APIs**
   - Must include contact info
   - Should include donation links
   - Non-negotiable requirement

---

## Next Steps

1. ✅ Create planning files (task_plan.md, findings.md)
2. Start Phase 1: Create shared utilities
3. Implement Archive.org (quick win)
4. Implement Wikipedia (author bios)
5. Implement Wikidata (advanced, later)
