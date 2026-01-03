# Alexandria OpenLibrary-First Implementation Plan

**Created**: 2026-01-01
**Status**: Ready for execution
**Priority**: P0 (Critical - blocks frontend Issue #185)

## Executive Summary

This plan restructures Alexandria's Smart Resolution pipeline to prioritize **OpenLibrary-first** (leveraging our native OL database), fixes critical infrastructure issues (#107, #108), and enables Issue #185 goals (genre expansion, better metadata quality).

### Key Insight
**Alexandria IS OpenLibrary** (54.8M editions). We should check our own database FIRST before hitting external APIs. Current flow wastes ISBNdb quota on books we already have.

---

## Table of Contents

1. [Immediate Fixes (P0/P1)](#phase-0-immediate-fixes-p0p1)
2. [Architecture Redesign](#phase-1-architecture-redesign-openlibrary-first)
3. [Genre Expansion](#phase-2-genre-expansion)
4. [Testing & Validation](#phase-3-testing--validation)
5. [Long-term Enhancements](#phase-4-long-term-enhancements)

---

## Phase 0: Immediate Fixes (P0/P1)

**Duration**: 1 day
**Blocking**: Yes - must complete before other work

### Task 0.1: Deploy Migration 003 (P0 - Issue #107)
**Why**: Unblocks Wikidata diversity enrichment for 174K authors
**Time**: 30 minutes

```bash
# 1. Deploy migration
scp migrations/003_seed_wikidata_author_enrichment.sql root@Tower.local:/tmp/
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/003_seed_wikidata_author_enrichment.sql"

# 2. Verify columns exist
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \
  '\\d enriched_authors' | grep -E '(gender_qid|citizenship_qid|birth_place)'"

# 3. Verify data ready
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \
  'SELECT COUNT(*) FROM enriched_authors WHERE wikidata_id IS NOT NULL;'"
# Expected: 174,436 authors
```

**Success Criteria**:
- ✅ All diversity columns present in `enriched_authors`
- ✅ 174,436 authors with `wikidata_id` populated
- ✅ Endpoint `POST /api/authors/enrich-wikidata` returns 200 (not 500)

---

### Task 0.2: Debug Bulk Author Harvest (P1 - Issue #108)
**Why**: 17.5% timeout rate + "0 enriched" anomaly needs root cause analysis
**Time**: 3-4 hours

#### Investigation Steps

```bash
# 1. Check if books were actually written to database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \
  \"SELECT
    COUNT(*) as total_enriched,
    COUNT(DISTINCT primary_provider) as providers,
    MAX(updated_at) as latest_update
  FROM enriched_editions
  WHERE updated_at > '2025-12-31'::date;\""

# 2. Analyze checkpoint stats
cat data/bulk-author-checkpoint.json | jq '.stats'
# Check: failed_authors array, stats.enriched vs stats.books_found

# 3. Test single high-value author
node scripts/bulk-author-harvest.js --author "Brandon Sanderson" --dry-run
# Watch for timeout patterns, API latency

# 4. Check Worker logs for enrichment errors
npm run tail | grep -E '(enrich-bibliography|enriched_editions|TIMEOUT)'
```

#### Root Cause Hypotheses

1. **"0 enriched" despite 72K books found**:
   - Possible: Checkpoint writes stats before enrichment completes
   - Possible: Enrichment service silently failing (no transaction commit)
   - Verify: Check `enriched_editions.updated_at` for Dec 31 timestamps

2. **17.5% timeout rate (203/1,160 authors)**:
   - Current timeout: 30s for `/api/authors/enrich-bibliography`
   - Large authors (e.g., "Stephen King" with 1000+ books) need more time
   - ISBNdb batch endpoint can return 6MB responses (slow)

3. **Tier confusion (957 authors for "top-100")**:
   - Check: `--tier top-100` flag parsing
   - Possible: Query returns top-100 *per some partition* instead of global top-100

#### Fixes

**File**: `scripts/bulk-author-harvest.js`

```javascript
// FIX 1: Increase timeout for large bibliographies
const timeout = authorEditionCount > 500 ? 90000 : 60000; // 90s for prolific authors, 60s default
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeout);

// FIX 2: Add checkpoint granularity (every 10 authors)
if (processedCount % 10 === 0) {
  checkpointManager.saveCheckpoint(); // Don't wait until end of run!
}

// FIX 3: Verify tier selection query
const tierQuery = tier === 'top-100'
  ? 'SELECT name FROM enriched_authors ORDER BY edition_count DESC LIMIT 100'
  : tier === 'top-1000'
  ? 'SELECT name FROM enriched_authors ORDER BY edition_count DESC LIMIT 1000'
  : /* ... */;

// FIX 4: Log enrichment completion (not just API success)
console.log(`✓ Enriched ${author.name}: ${response.stats.newly_enriched} editions written to DB`);
stats.enriched += response.stats.newly_enriched; // Track actual DB writes, not API "success"
```

**Success Criteria**:
- ✅ Timeout rate < 5% on test run (100 authors)
- ✅ `stats.enriched` matches actual DB inserts
- ✅ Tier selection returns correct author count (100, 1000, etc.)
- ✅ Checkpoint saves every 10 authors (not just end-of-run)

---

### Task 0.3: Validate Queue Optimization (P1 - Issue #109)
**Why**: Verify Dec 30 deploy improvements (10x throughput claim)
**Time**: 1 hour

```bash
# 1. Check Analytics Engine for queue metrics
# (Requires Cloudflare dashboard access or Wrangler analytics query)

# 2. Test cover queue throughput
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/queue' \
  -H 'Content-Type: application/json' \
  -d '{"isbns": ["9780439064873", "9781492666868", ...], "count": 100}'

# Time to process 100 covers (should be ~2 minutes with max_batch_size=10, max_concurrency=5)

# 3. Check queue status
npm run tail | grep -E '(CoverQueue|EnrichQueue)' | tail -50
# Look for: "Batch complete: processed=X, cached=Y, failed=Z"
```

**Success Criteria**:
- ✅ Cover queue processes 100 ISBNs in < 3 minutes
- ✅ Batch sizes consistently = 10 (max setting)
- ✅ No DLQ messages (dead letter queue should be empty)

---

## Phase 1: Architecture Redesign (OpenLibrary-First)

**Duration**: 3-4 days
**Goal**: Prioritize Alexandria's native OL database before external APIs

### Current Flow (WASTEFUL)

```
/api/search (ISBN)
  → Check enriched_editions (cache)
  → MISS: smartResolveISBN()
      → ISBNdb ($$$ paid API)
      → Google Books
      → OpenLibrary API
      → Store in DB
```

**Problem**: We query ISBNdb for books **we already have in editions table**!

### Proposed Flow (OPENLIBRARY-FIRST)

```
/api/search (ISBN)
  → Check enriched_editions (cache) ← FAST: indexed, 28.6M works
  → MISS: Check edition_isbns + editions (core OL) ← FAST: 49.3M indexed ISBNs
  → FOUND: Enrich from OL data (Work + Edition details)
  → STILL MISSING: smartResolveISBN()
      → OpenLibrary API (check for recent additions)
      → ISBNdb ($$$ paid, best metadata)
      → Google Books (free fallback)
      → Store in DB
```

**Benefits**:
1. **99% hit rate** on enriched_editions (already populated)
2. **Save ISBNdb quota** for truly missing books (not in OL dump)
3. **Native Work IDs** from OL (not synthetic like Google Books)
4. **Better genre data** from OL subjects field

---

### Task 1.1: Add OpenLibrary Database Resolver

**File**: `worker/services/openlibrary-db-resolver.ts` (NEW)

```typescript
/**
 * OpenLibrary Database Resolver
 *
 * Resolves ISBNs using Alexandria's native OpenLibrary database.
 * This is the FIRST step in Smart Resolution (before external APIs).
 */

import type { Sql } from 'postgres';
import type { Logger } from '../lib/logger.js';

export interface OLDatabaseResult {
  isbn: string;
  edition_key: string;
  work_key: string;
  title: string;
  subtitle?: string;
  authors: Array<{ key: string; name: string }>;
  publisher?: string;
  publish_date?: string;
  page_count?: number;
  language?: string;
  description?: string;
  subjects?: string[];  // CRITICAL for genre mapping!
  cover_id?: number;
  found_in_core: boolean; // True if from editions table (not enriched)
}

/**
 * Step 1: Check enriched_editions (cache layer)
 */
async function checkEnrichedEditions(
  sql: Sql,
  isbn: string,
  logger: Logger
): Promise<OLDatabaseResult | null> {
  const results = await sql`
    SELECT
      ee.isbn,
      ee.openlibrary_edition_id as edition_key,
      ee.work_key,
      ee.title,
      ee.subtitle,
      ee.publisher,
      ee.publication_date as publish_date,
      ee.page_count,
      ee.language,
      ee.subjects,
      ee.cover_urls
    FROM enriched_editions ee
    WHERE ee.isbn = ${isbn}
    LIMIT 1
  `;

  if (results.length === 0) return null;

  const row = results[0];

  // Fetch authors via enriched_authors join
  const authors = await sql`
    SELECT a.author_key, a.name
    FROM enriched_authors a
    JOIN author_works aw ON aw.author_key = a.author_key
    WHERE aw.work_key = ${row.work_key}
  `;

  logger.info(`[OL-DB] ✓ Found ISBN ${isbn} in enriched_editions`);

  return {
    isbn,
    edition_key: row.edition_key,
    work_key: row.work_key,
    title: row.title,
    subtitle: row.subtitle,
    authors: authors.map(a => ({ key: a.author_key, name: a.name })),
    publisher: row.publisher,
    publish_date: row.publish_date,
    page_count: row.page_count,
    language: row.language,
    subjects: row.subjects || [],
    found_in_core: false,
  };
}

/**
 * Step 2: Check core OpenLibrary tables (editions + works)
 * This is the GOLD MINE - 49.3M ISBNs we already have!
 */
async function checkCoreEditions(
  sql: Sql,
  isbn: string,
  logger: Logger
): Promise<OLDatabaseResult | null> {
  // Query edition_isbns → editions → works → authors
  const results = await sql`
    SELECT
      ei.isbn,
      e.key as edition_key,
      e.work_key,
      e.data->>'title' as title,
      e.data->>'subtitle' as subtitle,
      e.data->'publishers'->0 as publisher,
      e.data->>'publish_date' as publish_date,
      (e.data->>'number_of_pages')::int as page_count,
      e.data->'languages'->0->>'key' as language,
      e.data->'covers'->0 as cover_id,
      w.data->>'description' as description,
      w.data->'subjects' as subjects
    FROM edition_isbns ei
    JOIN editions e ON e.key = ei.edition_key
    LEFT JOIN works w ON w.key = e.work_key
    WHERE ei.isbn = ${isbn}
    LIMIT 1
  `;

  if (results.length === 0) return null;

  const row = results[0];

  // Fetch authors
  const authors = await sql`
    SELECT a.key, a.data->>'name' as name
    FROM author_works aw
    JOIN authors a ON a.key = aw.author_key
    WHERE aw.work_key = ${row.work_key}
  `;

  logger.info(`[OL-DB] ✓ Found ISBN ${isbn} in core editions (NATIVE OPENLIBRARY DATA)`);

  return {
    isbn,
    edition_key: row.edition_key,
    work_key: row.work_key,
    title: row.title,
    subtitle: row.subtitle,
    authors: authors.map(a => ({ key: a.key, name: a.name })),
    publisher: row.publisher,
    publish_date: row.publish_date,
    page_count: row.page_count,
    language: row.language,
    description: row.description,
    subjects: row.subjects || [],
    cover_id: row.cover_id ? parseInt(row.cover_id) : undefined,
    found_in_core: true, // Flag to trigger enrichment
  };
}

/**
 * Main resolver: checks enriched → core editions
 */
export async function resolveFromOLDatabase(
  sql: Sql,
  isbn: string,
  logger: Logger
): Promise<OLDatabaseResult | null> {
  // Try enriched cache first (fastest)
  const enriched = await checkEnrichedEditions(sql, isbn, logger);
  if (enriched) return enriched;

  // Fallback to core OpenLibrary tables (still local, still fast!)
  const core = await checkCoreEditions(sql, isbn, logger);
  if (core) return core;

  logger.info(`[OL-DB] ✗ ISBN ${isbn} not found in local database`);
  return null;
}
```

---

### Task 1.2: Create OpenLibrary API Client

**File**: `worker/services/openlibrary-api-client.ts` (NEW)

This fetches from OpenLibrary.org API for books **not in our database dump** (e.g., published after our last import).

```typescript
/**
 * OpenLibrary API Client
 *
 * Fetches Work and Edition data from OpenLibrary.org API.
 * Use this when ISBN is NOT in Alexandria's database dump.
 *
 * Rate Limit: 100 req/5min (soft limit, undocumented)
 * Recommended: 350ms delay between requests
 */

import type { Env } from '../src/env.js';

export interface OLWork {
  key: string;           // /works/OL45804W
  title: string;
  subtitle?: string;
  description?: string | { value: string };
  subjects?: string[];   // ["Fantasy", "Young adult fiction", ...]
  covers?: number[];
  first_publish_date?: string;
  authors?: Array<{ author: { key: string }; type: { key: string } }>;
}

export interface OLEdition {
  key: string;           // /books/OL7353617M
  title: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  languages?: Array<{ key: string }>;
  isbn_10?: string[];
  isbn_13?: string[];
  covers?: number[];
  works?: Array<{ key: string }>;
}

export interface OLAuthor {
  key: string;
  name: string;
  bio?: string | { value: string };
  birth_date?: string;
  death_date?: string;
  wikipedia?: string;
}

/**
 * Fetch Work by OpenLibrary ID
 */
export async function fetchOLWork(workKey: string, env: Env): Promise<OLWork | null> {
  try {
    const url = `https://openlibrary.org${workKey}.json`;
    const userAgent = env.USER_AGENT || 'Alexandria/2.0 (nerd@ooheynerds.com)';

    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`OpenLibrary API returned ${response.status} for ${workKey}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`OL API error (Work):`, error);
    return null;
  }
}

/**
 * Fetch Edition by OpenLibrary ID
 */
export async function fetchOLEdition(editionKey: string, env: Env): Promise<OLEdition | null> {
  try {
    const url = `https://openlibrary.org${editionKey}.json`;
    const userAgent = env.USER_AGENT || 'Alexandria/2.0 (nerd@ooheynerds.com)';

    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`OpenLibrary API returned ${response.status} for ${editionKey}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`OL API error (Edition):`, error);
    return null;
  }
}

/**
 * Search OpenLibrary by ISBN (uses Books API)
 */
export async function searchOLByISBN(isbn: string, env: Env): Promise<{ edition: OLEdition; work?: OLWork } | null> {
  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=details`;
    const userAgent = env.USER_AGENT || 'Alexandria/2.0 (nerd@ooheynerds.com)';

    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const bookData = data[`ISBN:${isbn}`];
    if (!bookData?.details) return null;

    const edition = bookData.details;
    const workKey = edition.works?.[0]?.key;

    // Fetch Work details if available
    let work: OLWork | null = null;
    if (workKey) {
      work = await fetchOLWork(workKey, env);
    }

    return { edition, work: work || undefined };
  } catch (error) {
    console.error(`OL API error (ISBN search):`, error);
    return null;
  }
}

/**
 * Rate limiter: ensures 350ms delay between OL API calls
 */
let lastOLApiCall = 0;
export async function rateLimitOL() {
  const now = Date.now();
  const elapsed = now - lastOLApiCall;
  const minDelay = 350; // ms

  if (elapsed < minDelay) {
    await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
  }

  lastOLApiCall = Date.now();
}
```

---

### Task 1.3: Restructure Smart Resolution Chain

**File**: `worker/services/external-apis.ts` (MODIFY)

Change priority from **ISBNdb → Google → OL** to **OL API → ISBNdb → Google**.

```typescript
/**
 * Resolves book metadata from external providers with cascading fallback.
 *
 * NEW Priority (OpenLibrary-first):
 * 1. OpenLibrary API (check for recent additions not in our dump)
 * 2. ISBNdb (paid, best metadata quality)
 * 3. Google Books (free fallback)
 *
 * @param isbn - The ISBN to resolve (10 or 13 digits)
 * @param env - Worker environment with API keys
 * @returns Book data from the first successful provider, or null if all fail
 */
export async function resolveExternalISBN(isbn: string, env: Env): Promise<ExternalBookData | null> {
  console.log(`[External APIs] Resolving ISBN: ${isbn}`);

  if (!validateISBN(isbn)) {
    console.warn(`[External APIs] Invalid ISBN format: ${isbn}`);
    return null;
  }

  // NEW: Try OpenLibrary API first (we might not have this in our dump)
  const openLibraryData = await fetchFromOpenLibrary(isbn, env);
  if (openLibraryData) {
    console.log(`[External APIs] ✓ Resolved from OpenLibrary API (recent addition)`);
    return openLibraryData;
  }

  // Then try ISBNdb (paid, most reliable for new/obscure books)
  const isbndbData = await fetchFromISBNdb(isbn, env);
  if (isbndbData) {
    console.log(`[External APIs] ✓ Resolved from ISBNdb`);
    return isbndbData;
  }

  // Final fallback to Google Books
  const googleData = await fetchFromGoogleBooks(isbn, env);
  if (googleData) {
    console.log(`[External APIs] ✓ Resolved from Google Books`);
    return googleData;
  }

  console.warn(`[External APIs] ✗ No data found for ISBN ${isbn}`);
  return null;
}
```

---

### Task 1.4: Update Smart Enrichment to Use OL Database First

**File**: `worker/services/smart-enrich.ts` (MODIFY)

```typescript
import { resolveFromOLDatabase } from './openlibrary-db-resolver.js';
import { searchOLByISBN, rateLimitOL } from './openlibrary-api-client.js';

/**
 * Smart resolution with automatic database enrichment.
 *
 * NEW Flow:
 * 1. Check enriched_editions (cache)
 * 2. Check core OpenLibrary tables (edition_isbns + editions + works)
 * 3. If found in core but not enriched: enrich from OL data
 * 4. If still not found: try OL API (recent books)
 * 5. If still not found: try ISBNdb → Google Books
 * 6. Store and return
 */
export async function smartResolveISBN(
  isbn: string,
  sql: Sql,
  env: Env,
  logger: Logger
): Promise<SmartResolveResult | null> {
  console.log(`[Smart Resolve] Starting resolution for ISBN: ${isbn}`);

  // Step 0: Check cache for "not found" results
  const cacheKey = `isbn_not_found:${isbn}`;
  const cachedNotFound = await env.CACHE.get(cacheKey);
  if (cachedNotFound) {
    console.log(`[Smart Resolve] ISBN ${isbn} previously failed, skipping`);
    return null;
  }

  // NEW Step 1: Check Alexandria's native OpenLibrary database
  const olDbResult = await resolveFromOLDatabase(sql, isbn, logger);

  if (olDbResult) {
    // Found in our database! Check if it needs enrichment
    if (olDbResult.found_in_core) {
      // Found in core editions but NOT in enriched_editions
      // → Enrich it now for future queries
      logger.info(`[Smart Resolve] Enriching from core OL data: ${isbn}`);

      await enrichEdition(sql, {
        isbn: olDbResult.isbn,
        title: olDbResult.title,
        subtitle: olDbResult.subtitle,
        publisher: olDbResult.publisher,
        publication_date: olDbResult.publish_date,
        page_count: olDbResult.page_count,
        language: olDbResult.language,
        primary_provider: 'openlibrary-core',
        cover_urls: olDbResult.cover_id ? {
          large: `https://covers.openlibrary.org/b/id/${olDbResult.cover_id}-L.jpg`,
          medium: `https://covers.openlibrary.org/b/id/${olDbResult.cover_id}-M.jpg`,
          small: `https://covers.openlibrary.org/b/id/${olDbResult.cover_id}-S.jpg`,
        } : undefined,
        cover_source: 'openlibrary',
        work_key: olDbResult.work_key,
        openlibrary_edition_id: olDbResult.edition_key,
        subjects: olDbResult.subjects,
      }, logger);

      await enrichWork(sql, {
        work_key: olDbResult.work_key,
        title: olDbResult.title,
        subtitle: olDbResult.subtitle,
        description: olDbResult.description,
        subject_tags: olDbResult.subjects,
        primary_provider: 'openlibrary-core',
        openlibrary_work_id: olDbResult.work_key,
      }, logger);
    }

    // Return formatted result
    return {
      title: olDbResult.title,
      author: olDbResult.authors[0]?.name || null,
      isbn: olDbResult.isbn,
      coverUrl: olDbResult.cover_id
        ? `https://covers.openlibrary.org/b/id/${olDbResult.cover_id}-L.jpg`
        : null,
      coverSource: 'openlibrary',
      publish_date: olDbResult.publish_date || null,
      publishers: olDbResult.publisher ? [olDbResult.publisher] : null,
      pages: olDbResult.page_count || null,
      work_title: olDbResult.title,
      openlibrary_edition: `https://openlibrary.org${olDbResult.edition_key}`,
      openlibrary_work: `https://openlibrary.org${olDbResult.work_key}`,
      _enriched: olDbResult.found_in_core, // True if we just enriched it
      _provider: 'openlibrary-core',
    };
  }

  // Step 2: Try OpenLibrary API (for books published after our dump)
  await rateLimitOL(); // Respect 350ms rate limit
  const olApiResult = await searchOLByISBN(isbn, env);

  if (olApiResult) {
    logger.info(`[Smart Resolve] ✓ Found in OpenLibrary API (recent addition)`);

    // Store in database (convert OL API format → ExternalBookData format)
    const externalData: ExternalBookData = {
      isbn,
      title: olApiResult.edition.title,
      subtitle: olApiResult.edition.subtitle,
      authors: olApiResult.work?.authors?.map(a => a.author.key) || [],
      publisher: olApiResult.edition.publishers?.[0],
      publicationDate: olApiResult.edition.publish_date,
      pageCount: olApiResult.edition.number_of_pages,
      language: olApiResult.edition.languages?.[0]?.key,
      description: typeof olApiResult.work?.description === 'string'
        ? olApiResult.work.description
        : olApiResult.work?.description?.value,
      subjects: olApiResult.work?.subjects,
      coverUrls: olApiResult.edition.covers?.[0] ? {
        large: `https://covers.openlibrary.org/b/id/${olApiResult.edition.covers[0]}-L.jpg`,
        medium: `https://covers.openlibrary.org/b/id/${olApiResult.edition.covers[0]}-M.jpg`,
        small: `https://covers.openlibrary.org/b/id/${olApiResult.edition.covers[0]}-S.jpg`,
      } : undefined,
      workKey: olApiResult.work?.key,
      editionKey: olApiResult.edition.key,
      provider: 'openlibrary',
    };

    await storeExternalBookData(sql, externalData, logger);

    return {
      title: externalData.title,
      author: externalData.authors[0] || null,
      isbn: externalData.isbn,
      coverUrl: externalData.coverUrls?.large || null,
      coverSource: 'openlibrary',
      publish_date: externalData.publicationDate || null,
      publishers: externalData.publisher ? [externalData.publisher] : null,
      pages: externalData.pageCount || null,
      work_title: externalData.title,
      openlibrary_edition: `https://openlibrary.org${externalData.editionKey}`,
      openlibrary_work: externalData.workKey
        ? `https://openlibrary.org${externalData.workKey}`
        : null,
      _enriched: true,
      _provider: 'openlibrary',
    };
  }

  // Step 3: Fallback to ISBNdb → Google Books (existing logic)
  const externalData = await resolveExternalISBN(isbn, env);

  if (!externalData) {
    await env.CACHE.put(cacheKey, 'true', {
      expirationTtl: parseInt(env.CACHE_TTL_LONG)
    });
    console.warn(`[Smart Resolve] No data found for ISBN ${isbn}`);
    return null;
  }

  // Store and return (existing logic continues...)
  // ... rest of function unchanged
}
```

---

## Phase 2: Genre Expansion

**Duration**: 2-3 days
**Goal**: Support Issue #185's 110+ genre taxonomy

### Task 2.1: Create Migration 004 - Genre Schema

**File**: `migrations/004_add_hierarchical_genres.sql` (NEW)

```sql
-- Migration 004: Add hierarchical genre support
-- Created: 2026-01-01

BEGIN;

-- Add genres JSONB column to enriched_works
ALTER TABLE enriched_works
  ADD COLUMN IF NOT EXISTS genres JSONB DEFAULT '[]'::jsonb;

-- Add genre hierarchy lookup table (optional - for performance)
CREATE TABLE IF NOT EXISTS genre_hierarchy (
  canonical_genre TEXT PRIMARY KEY,
  parent_genre TEXT,
  level INT DEFAULT 0,
  bisac_code TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed canonical genres (to be populated by bendv3 or manual insert)
-- This is just the schema - data comes from bendv3's genre-normalizer

-- Add index for genre searches (GIN index for JSONB array contains)
CREATE INDEX IF NOT EXISTS idx_enriched_works_genres
  ON enriched_works USING gin(genres);

-- Add genre source tracking to enriched_editions
ALTER TABLE enriched_editions
  ADD COLUMN IF NOT EXISTS genre_sources JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN enriched_works.genres IS 'Hierarchical genres: ["LitRPG", "Progression Fantasy", "Fantasy"]';
COMMENT ON COLUMN enriched_editions.genre_sources IS 'Provider → genres mapping: {"isbndb": [...], "openlibrary": [...]}';

COMMIT;
```

---

### Task 2.2: Create Genre Mapping Endpoint

**File**: `worker/src/routes/genres.ts` (NEW)

```typescript
/**
 * Genre API Endpoints
 *
 * Provides canonical genre data and mappings for bendv3 consumption.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';

const app = new OpenAPIHono<AppBindings>();

// GET /api/genres - List all canonical genres
const listGenresRoute = createRoute({
  method: 'get',
  path: '/api/genres',
  tags: ['Genres'],
  summary: 'List all canonical genres with hierarchy',
  responses: {
    200: {
      description: 'Genre list with hierarchy',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              canonical_genres: z.array(z.string()),
              hierarchy: z.record(z.string(), z.array(z.string())),
              total: z.number(),
            }),
          }),
        },
      },
    },
  },
});

app.openapi(listGenresRoute, async (c) => {
  const sql = c.get('sql');

  // Fetch from genre_hierarchy table
  const genres = await sql`
    SELECT canonical_genre, parent_genre, level
    FROM genre_hierarchy
    ORDER BY level ASC, canonical_genre ASC
  `;

  // Build hierarchy map: genre → [parent, grandparent, ...]
  const hierarchy: Record<string, string[]> = {};
  const canonicalList: string[] = [];

  for (const genre of genres) {
    canonicalList.push(genre.canonical_genre);

    if (genre.parent_genre) {
      // Recursively build ancestry
      const ancestry = [genre.parent_genre];
      let current = genre.parent_genre;

      // Limit to 3 levels to prevent infinite loops
      for (let i = 0; i < 3; i++) {
        const parent = genres.find(g => g.canonical_genre === current);
        if (parent?.parent_genre) {
          ancestry.push(parent.parent_genre);
          current = parent.parent_genre;
        } else {
          break;
        }
      }

      hierarchy[genre.canonical_genre] = ancestry;
    }
  }

  return c.json({
    success: true,
    data: {
      canonical_genres: canonicalList,
      hierarchy,
      total: canonicalList.length,
    },
  });
});

// GET /api/genres/map - Map provider genre to canonical
const mapGenreRoute = createRoute({
  method: 'get',
  path: '/api/genres/map',
  tags: ['Genres'],
  summary: 'Map provider-specific genre to canonical genre',
  request: {
    query: z.object({
      provider: z.enum(['openlibrary', 'isbndb', 'google']),
      genre: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Mapped canonical genres',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              provider: z.string(),
              source_genre: z.string(),
              canonical_genres: z.array(z.string()),
            }),
          }),
        },
      },
    },
  },
});

app.openapi(mapGenreRoute, async (c) => {
  const { provider, genre } = c.req.valid('query');

  // Simple hardcoded mappings for now
  // TODO: Move to database table or JSON file
  const mappings: Record<string, Record<string, string[]>> = {
    openlibrary: {
      'Science fiction': ['Science Fiction'],
      'Fantasy': ['Fantasy'],
      'Young adult fiction': ['Young Adult', 'Fiction'],
      'Dystopian fiction': ['Dystopian', 'Science Fiction'],
      // ... (expand as needed)
    },
    isbndb: {
      'Fiction / Science Fiction / General': ['Science Fiction'],
      'Fiction / Fantasy / Epic': ['Epic Fantasy', 'Fantasy'],
      'Fiction / LitRPG': ['LitRPG', 'Progression Fantasy', 'Fantasy'],
      // ... (expand as needed)
    },
  };

  const canonical = mappings[provider]?.[genre] || [genre];

  return c.json({
    success: true,
    data: {
      provider,
      source_genre: genre,
      canonical_genres: canonical,
    },
  });
});

export default app;
```

---

### Task 2.3: Update Enrichment to Store Genres

**File**: `worker/src/services/enrichment-service.ts` (MODIFY)

```typescript
// Add genre extraction to enrichWork function

export async function enrichWork(
  sql: Sql,
  data: {
    work_key: string;
    title: string;
    subtitle?: string;
    description?: string;
    subject_tags?: string[]; // <-- Use this for genre mapping!
    // ... other fields
  },
  logger?: Logger
): Promise<void> {
  // Map subject_tags to canonical genres
  const genres = mapSubjectsToGenres(data.subject_tags || []);

  await sql`
    INSERT INTO enriched_works (
      work_key, title, subtitle, description,
      subject_tags, genres, /* ... */
    )
    VALUES (
      ${data.work_key}, ${data.title}, ${data.subtitle}, ${data.description},
      ${JSON.stringify(data.subject_tags)}::jsonb,
      ${JSON.stringify(genres)}::jsonb,
      /* ... */
    )
    ON CONFLICT (work_key) DO UPDATE SET
      genres = enriched_works.genres || ${JSON.stringify(genres)}::jsonb,
      /* ... */
  `;
}

/**
 * Map OpenLibrary subjects to canonical genres
 * Uses simple keyword matching for now (can be improved with ML)
 */
function mapSubjectsToGenres(subjects: string[]): string[] {
  const genreKeywords: Record<string, string[]> = {
    'LitRPG': ['litrpg', 'lit rpg', 'game lit'],
    'Progression Fantasy': ['progression', 'cultivation', 'xianxia'],
    'Epic Fantasy': ['epic fantasy', 'high fantasy'],
    'Urban Fantasy': ['urban fantasy', 'contemporary fantasy'],
    'Science Fiction': ['science fiction', 'sci-fi', 'scifi'],
    'Cyberpunk': ['cyberpunk', 'cyber punk'],
    'Dystopian': ['dystopian', 'dystopia'],
    // ... expand to 110+ genres
  };

  const matchedGenres = new Set<string>();

  for (const subject of subjects) {
    const lower = subject.toLowerCase();
    for (const [genre, keywords] of Object.entries(genreKeywords)) {
      if (keywords.some(kw => lower.includes(kw))) {
        matchedGenres.add(genre);
      }
    }
  }

  return Array.from(matchedGenres);
}
```

---

## Phase 3: Testing & Validation

**Duration**: 2 days

### Task 3.1: Test OpenLibrary-First Resolution

```bash
# Test 1: ISBN in enriched_editions (should return instantly)
curl "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873" | jq '.duration_ms'
# Expected: < 50ms

# Test 2: ISBN in core editions but not enriched (should enrich on-the-fly)
curl "https://alexandria.ooheynerds.com/api/search?isbn=SOME_CORE_ISBN" | jq '._enriched'
# Expected: true

# Test 3: ISBN not in database (should hit OL API → ISBNdb)
curl "https://alexandria.ooheynerds.com/api/search?isbn=9781234567890" | jq '._provider'
# Expected: "openlibrary" or "isbndb"

# Test 4: Verify ISBNdb quota saved
# Before: Check quota usage
curl "https://alexandria.ooheynerds.com/api/quota/status" | jq '.data.used_today'
# Make 100 requests for books in core DB
for i in {1..100}; do
  curl -s "https://alexandria.ooheynerds.com/api/search?isbn=${CORE_ISBN[$i]}" > /dev/null
done
# After: Quota should be UNCHANGED (no ISBNdb calls for core books!)
curl "https://alexandria.ooheynerds.com/api/quota/status" | jq '.data.used_today'
```

---

### Task 3.2: Test Genre Expansion

```bash
# Deploy migration 004
scp migrations/004_add_hierarchical_genres.sql root@Tower.local:/tmp/
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/004_add_hierarchical_genres.sql"

# Test genre endpoint
curl "https://alexandria.ooheynerds.com/api/genres" | jq '.data.total'
# Expected: > 100 genres

# Test genre mapping
curl "https://alexandria.ooheynerds.com/api/genres/map?provider=openlibrary&genre=Science%20fiction" | jq '.data.canonical_genres'
# Expected: ["Science Fiction"]

# Verify enriched_works has genres
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \
  \"SELECT work_key, genres FROM enriched_works WHERE genres IS NOT NULL LIMIT 5;\""
```

---

### Task 3.3: End-to-End Workflow Test

Use existing `scripts/e2e-workflow-test.js` with updated expectations:

```javascript
// Test OL-first resolution
const isbn = '9780439064873'; // Harry Potter (definitely in core DB)

const response = await fetch(`https://alexandria.ooheynerds.com/api/search?isbn=${isbn}`);
const data = await response.json();

assert(data._provider === 'openlibrary-core', 'Should resolve from core OL database');
assert(data._enriched === false, 'Should be found in enriched_editions (cache hit)');
assert(data.duration_ms < 100, 'Core DB lookup should be < 100ms');

// Test genre presence
const work = await fetch(`https://alexandria.ooheynerds.com/api/works/${data.openlibrary_work}`);
const workData = await work.json();

assert(workData.genres.length > 0, 'Work should have genres');
assert(workData.genres.includes('Fantasy'), 'Harry Potter should be tagged as Fantasy');
```

---

## Phase 4: Long-term Enhancements

**After Issue #185 is complete** (not blocking):

### 4.1: Author Deduplication (#114)
- Use OL author keys as canonical IDs
- Merge duplicate authors with different UUIDs
- Link to VIAF/ISNI identifiers

### 4.2: Wikipedia + LLM Fallback (#113)
- For authors without Wikidata, scrape Wikipedia
- Use LLM to extract structured data (birth date, nationality, etc.)
- Store in `enriched_authors.ai_extracted` JSONB field

### 4.3: VIAF/ISNI Crosswalk (#112)
- Fetch VIAF/ISNI IDs for authors
- Map to Wikidata for richer biographical data
- Enable "author universe" graph queries

### 4.4: Contract Testing (#90)
- Automated tests for Alexandria ↔ bendv3 contracts
- Ensure WorkDTO/EditionDTO/AuthorDTO schemas match
- GitHub Actions for pre-deploy validation

---

## Success Metrics

### Performance
- ✅ 95%+ cache hit rate on enriched_editions (vs current ~60%)
- ✅ ISBNdb quota usage reduced by 80% (from ~5K/day to ~1K/day)
- ✅ Average search latency < 100ms (vs current ~200ms)

### Data Quality
- ✅ 110+ genres in `enriched_works.genres` (vs current 30)
- ✅ Native OL Work IDs for 99% of books (vs synthetic UUIDs)
- ✅ Genre coverage: 85%+ works have ≥1 genre (vs current ~40%)

### Reliability
- ✅ Harvest timeout rate < 5% (vs current 17.5%)
- ✅ Zero "enriched=0" anomalies in checkpoints
- ✅ Queue throughput stable at 10 covers/batch

---

## Timeline

| Phase | Duration | Blocking |
|-------|----------|----------|
| **Phase 0: Immediate Fixes** | 1 day | ✅ YES |
| **Phase 1: OL-First Architecture** | 3-4 days | ✅ YES |
| **Phase 2: Genre Expansion** | 2-3 days | ⚠️ Parallel with Phase 1 |
| **Phase 3: Testing** | 2 days | ✅ YES |
| **Phase 4: Long-term** | N/A | ❌ NO (post-#185) |

**Total Duration**: ~10-14 days (including testing)

---

## Approval Required

Before starting implementation, confirm:

- [ ] Architecture change approved (OL-first vs ISBNdb-first)
- [ ] Migration 003 deployed (Wikidata schema)
- [ ] Harvest debugging prioritized (17.5% timeout rate)
- [ ] Genre expansion scope agreed (110+ genres vs 30)

**Next Step**: Deploy Migration 003 (#107) to unblock Phase 0.
