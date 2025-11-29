# Alexandria Integration: Path 1 Implementation Guide

**Goal:** Make Alexandria the primary book data provider in bendv3  
**Time:** 2-3 hours  
**Risk:** Very low (fallback to existing providers)

---

## What Alexandria Does

**Alexandria = ONLY Book Metadata Enrichment**

✅ What it stores:
- Book works, editions, authors
- Cover images, descriptions, ISBNs
- External IDs (Goodreads, Amazon, etc.)

❌ What it does NOT store:
- User data (reading lists, progress, ratings)
- Social features (friends, recommendations)
- AI/ML (recommendation engine, analytics)

Those live in:
- **bendv3**: User data (D1/KV), AI/ML (Workers AI)
- **books-v3**: Local user data (SwiftData), UI/UX

---

## Architecture

```
books-v3 (iOS)
    ↓
bendv3 (Workers)
    ↓
Alexandria (Workers) → Tower PostgreSQL
    ↓
OpenLibrary dump (54M books)
ISBNdb API (quality enrichment)
Google Books API (fallback)
```

---

## Step-by-Step Implementation

### Step 1: Alexandria Normalizer ✅ DONE

**File:** `/Users/juju/dev_repos/bendv3/src/services/normalizers/alexandria.ts`

Already created! Just needs testing.

---

### Step 2: Create Alexandria API Service (2 hours)

**File to create:** `/Users/juju/dev_repos/bendv3/src/services/alexandria-api.ts`

```typescript
import type { WorkDTO, EditionDTO, AuthorDTO } from "../types/canonical.js";
import { normalizeAlexandriaToWork, normalizeAlexandriaToEdition, normalizeAlexandriaToAuthor } from "./normalizers/alexandria.js";
import { withCircuitBreaker } from "./circuit-breaker.js";
import { createCacheService } from "./cache-service.js";
import { getCacheTTL } from "../config/cache-ttl.js";

const ALEXANDRIA_BASE_URL = "https://alexandria.ooheynerds.com";

export interface AlexandriaEnv {
  CACHE?: KVNamespace;
  CACHE_HOT_TTL?: string;
  CACHE_COLD_TTL?: string;
}

export interface NormalizedResponse {
  works: WorkDTO[];
  editions: EditionDTO[];
  authors: AuthorDTO[];
}

export async function searchAlexandriaByISBN(
  isbn: string,
  env: AlexandriaEnv,
  ctx?: ExecutionContext,
): Promise<NormalizedResponse | null> {
  const kvNamespace = env.CACHE;
  
  if (!kvNamespace || !ctx) {
    return withCircuitBreaker('alexandria', env, () => 
      searchAlexandriaByISBN_Uncached(isbn)
    );
  }

  const cache = createCacheService(kvNamespace, 'alex', env, ctx);
  const cacheKey = `isbn:${isbn.replace(/-/g, '')}`;
  const cached = await cache.get(cacheKey);

  if (cached) {
    console.log(`📦 Cache HIT: Alexandria ISBN ${isbn}`);
    try {
      return JSON.parse(cached);
    } catch (error) {
      console.error(`❌ Cache parse error:`, error);
    }
  }

  console.log(`🌐 Fetching ISBN ${isbn} from Alexandria`);
  const result = await withCircuitBreaker('alexandria', env, () => 
    searchAlexandriaByISBN_Uncached(isbn)
  );

  if (result && result.works.length > 0) {
    const hotTtl = getCacheTTL('hot', env);
    const coldTtl = getCacheTTL('cold', env);
    await cache.put(cacheKey, JSON.stringify(result), hotTtl, coldTtl);
  }

  return result;
}

async function searchAlexandriaByISBN_Uncached(isbn: string): Promise<NormalizedResponse | null> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(
      `${ALEXANDRIA_BASE_URL}/api/search?isbn=${encodeURIComponent(isbn)}`,
      {
        headers: {
          "Accept": "application/json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Alexandria API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
      return null;
    }

    const works: WorkDTO[] = [];
    const editions: EditionDTO[] = [];
    const authorsMap = new Map<string, AuthorDTO>();

    for (const result of data.results) {
      const work = normalizeAlexandriaToWork(result);
      const edition = normalizeAlexandriaToEdition(result);
      
      if (result.author) {
        const author = normalizeAlexandriaToAuthor(result.author);
        if (!authorsMap.has(author.name)) {
          authorsMap.set(author.name, author);
        }
        (work as any).authors = [author];
      }

      works.push(work);
      editions.push(edition);
    }

    console.log(`✅ Alexandria: ${isbn} (${Date.now() - startTime}ms)`);

    return {
      works,
      editions,
      authors: Array.from(authorsMap.values()),
    };
  } catch (error) {
    console.error(`❌ Alexandria error for ISBN ${isbn}:`, error);
    throw error;
  }
}
```

---

### Step 3: Add to Circuit Breaker (15 min)

**File:** `/Users/juju/dev_repos/bendv3/src/services/circuit-breaker.ts`

Add `'alexandria'` to Provider type:

```typescript
export type Provider = 
  | 'google-books'
  | 'openlibrary'
  | 'isbndb'
  | 'alexandria'  // ← Add this
  | 'wikidata';
```

---

### Step 4: Update Provider Enum (5 min)

**File:** `/Users/juju/dev_repos/bendv3/src/types/enums.ts`

```typescript
export type DataProvider = 
  | "alexandria"    // ← Add as priority #1
  | "google-books" 
  | "openlibrary" 
  | "isbndb"
  | "wikidata";
```

---

### Step 5: Make Alexandria Primary (30 min)

**File:** `/Users/juju/dev_repos/bendv3/src/services/external-apis.ts`

Add import:
```typescript
import { searchAlexandriaByISBN } from './alexandria-api.js';
```

Update `searchByISBN`:
```typescript
export async function searchByISBN(isbn: string, env: ExternalAPIEnv, ctx?: ExecutionContext) {
  const startTime = Date.now();
  
  // 1. Try Alexandria first
  try {
    const result = await searchAlexandriaByISBN(isbn, env, ctx);
    if (result && result.works.length > 0) {
      console.log(`✅ ISBN ${isbn} from Alexandria (${Date.now() - startTime}ms)`);
      
      if (env.GOOGLE_BOOKS_ANALYTICS) {
        env.GOOGLE_BOOKS_ANALYTICS.writeDataPoint({
          blobs: ['isbn_lookup', 'alexandria', 'success'],
          doubles: [Date.now() - startTime],
          indexes: [isbn]
        });
      }
      
      return result;
    }
  } catch (error) {
    console.warn(`⚠️ Alexandria failed, trying fallback:`, error);
  }

  // 2. Fallback to Google Books
  try {
    const result = await searchGoogleBooksByISBN(isbn, env, ctx);
    if (result && result.works.length > 0) {
      console.log(`✅ ISBN ${isbn} from Google Books (fallback)`);
      return result;
    }
  } catch (error) {
    console.warn(`⚠️ Google Books failed:`, error);
  }

  // 3. Last resort: OpenLibrary
  const result = await searchOpenLibraryByISBN(isbn, env, ctx);
  if (result && result.works.length > 0) {
    console.log(`✅ ISBN ${isbn} from OpenLibrary (fallback)`);
    return result;
  }

  return null;
}
```

---

## Testing

```bash
# 1. Test Alexandria directly
curl "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873"

# 2. Test via bendv3 (after deployment)
curl "https://api.oooefam.net/api/v2/book/isbn/9780439064873"

# Check response has primaryProvider: "alexandria"

# 3. Check logs
npx wrangler tail
```

---

## Success Metrics

- [ ] 80%+ ISBN lookups served by Alexandria
- [ ] <30ms p95 latency for Alexandria hits  
- [ ] Fallback to Google Books works for missing ISBNs
- [ ] Provider metadata shows "alexandria"
- [ ] Cover images load correctly

---

## Database Deployment (5 min)

Before implementing the code, deploy the database schema:

```bash
# Copy migration to Unraid
scp /Users/juju/dev_repos/alex/migrations/001_add_enrichment_tables.sql root@Tower.local:/tmp/

# Run migration
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/001_add_enrichment_tables.sql"

# Verify tables created
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c '\dt enriched*'"
```

---

## Cost Savings

**Before (Google Books API):**
- ~$50-200/month for 10K-50K queries

**After (Alexandria):**
- ~$5/month (Cloudflare Workers)
- Unlimited queries
- **90%+ cost savings!**

---

**Total Time:** 2-3 hours  
**Next:** Deploy migration, implement Path 1 in bendv3 🚀
