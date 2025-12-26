# Alexandria Code Improvement Plan

Three targeted improvements to enhance code quality, maintainability, and type safety.

---

## Plan 1: Extract Handler Logic to Services

**Goal**: Reduce route file sizes from 500-979 lines to ~150-200 lines by moving business logic to service files.

### Current State
| File | Lines | Inline Handler Size |
|------|-------|---------------------|
| `routes/authors.ts` | 979 | 300+ lines per handler |
| `routes/enrich.ts` | 789 | 200+ lines per handler |
| `routes/books.ts` | 515 | 150+ lines per handler |
| `routes/covers.ts` | ~400 | 100+ lines per handler |

### Target Architecture
```
routes/authors.ts (150 lines)     →  services/author-service.ts (400 lines)
routes/enrich.ts (150 lines)      →  services/enrichment-service.ts (existing, extend)
routes/books.ts (150 lines)       →  services/books-service.ts (new, 300 lines)
```

### Step-by-Step Extraction

#### Step 1: Create `services/author-service.ts`
Extract from `routes/authors.ts`:

```typescript
// worker/src/services/author-service.ts
import type { Sql } from 'postgres';
import type { Env } from '../env.js';
import type { Logger } from '../../lib/logger.js';

interface AuthorServiceContext {
  sql: Sql;
  env: Env;
  logger: Logger;
}

// Extract from lines 290-357: topAuthorsRoute handler
export async function getTopAuthors(
  ctx: AuthorServiceContext,
  params: { offset: number; limit: number; nocache?: boolean }
) {
  const { sql, env, logger } = ctx;
  const cacheKey = `top_authors:${params.offset}:${params.limit}`;

  // Check cache (move logic from lines 299-308)
  if (!params.nocache) {
    const cached = await env.CACHE.get(cacheKey, 'json');
    if (cached) return { ...cached, cached: true };
  }

  // Query (move logic from lines 312-330)
  const authors = await sql`
    SELECT a.key as author_key, a.data->>'name' as author_name, COUNT(*)::int as work_count
    FROM authors a
    JOIN author_works aw ON aw.author_key = a.key
    WHERE a.data->>'name' IS NOT NULL
      AND LENGTH(a.data->>'name') > 3
      AND a.data->>'name' !~* '^(United States|Great Britain|Anonymous|...)'
    GROUP BY a.key, a.data->>'name'
    ORDER BY COUNT(*) DESC
    OFFSET ${params.offset} LIMIT ${params.limit}
  `;

  const result = {
    authors: authors.map(a => ({ author_key: a.author_key, author_name: a.author_name, work_count: a.work_count })),
    pagination: { offset: params.offset, limit: params.limit, returned: authors.length }
  };

  await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
  return { ...result, cached: false };
}

// Extract from lines 362-450: authorDetailsRoute handler
export async function getAuthorDetails(ctx: AuthorServiceContext, authorKey: string) { ... }

// Extract from lines 460-550: bibliographyRoute handler
export async function getAuthorBibliography(ctx: AuthorServiceContext, authorName: string, maxPages?: number) { ... }

// Extract from lines 560-750: enrichBibliographyRoute handler
export async function enrichAuthorBibliography(ctx: AuthorServiceContext, params: EnrichBibliographyParams) { ... }

// Extract from lines 760-900: enrichWikidataRoute handler
export async function enrichAuthorsWikidata(ctx: AuthorServiceContext, authorKeys: string[]) { ... }
```

#### Step 2: Slim Down `routes/authors.ts`

After extraction, routes become thin wrappers:

```typescript
// worker/src/routes/authors.ts (after refactor)
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import * as authorService from '../services/author-service.js';
// ... schema imports ...

const app = new OpenAPIHono<AppBindings>();

// Handler is now 10 lines instead of 70
app.openapi(topAuthorsRoute, async (c) => {
  const startTime = Date.now();
  const params = c.req.valid('query');
  const ctx = { sql: c.get('sql'), env: c.env, logger: c.get('logger') };

  try {
    const result = await authorService.getTopAuthors(ctx, params);
    return c.json({ ...result, query_duration_ms: Date.now() - startTime });
  } catch (error) {
    ctx.logger.error('Top authors query error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'Failed to query top authors' }, 500);
  }
});

// Similar pattern for other routes...
```

#### Step 3: Create `services/books-service.ts`
Extract from `routes/books.ts`:
- `searchISBNdb()` - lines 150-250
- `enrichNewReleases()` - lines 260-450

#### Step 4: Extend `services/enrichment-service.ts`
Move remaining inline logic from `routes/enrich.ts`:
- Batch processing loops
- Queue coordination logic

### Verification Checklist
- [ ] Each route file < 200 lines
- [ ] Each route handler < 20 lines
- [ ] All business logic in services
- [ ] Services are unit-testable (no Hono context dependency)
- [ ] Types properly exported

---

## Plan 2: Replace Console with Logger

**Goal**: Replace all 26 `console.*` calls with the structured Logger.

### Current State
```
worker/src/services/enrichment-service.ts   - 10 console calls
worker/src/services/enrich-handlers.ts      - 8 console calls
worker/src/services/cover-handlers.ts       - 4 console calls
worker/src/services/queue-handlers.ts       - 1 console call
worker/src/openapi.ts                       - 3 console calls
worker/src/index.ts                         - 1 console call (queue routing)
```

### Migration Strategy

#### Step 1: Update Services to Accept Logger

Services need logger passed in (they don't have Hono context):

```typescript
// BEFORE (enrichment-service.ts:230)
console.log(`[Enrichment] Queued cover for ${row.isbn}: ${coverUrl}`);

// AFTER
export async function enrichEdition(
  sql: Sql,
  edition: EnrichEditionRequest,
  env?: Env,
  logger?: Logger  // Add logger parameter
): Promise<EnrichmentData> {
  // ...
  logger?.info('Queued cover for enrichment', { isbn: row.isbn, coverUrl });
  // ...
}
```

#### Step 2: File-by-File Changes

**`services/enrichment-service.ts`** (10 changes):
| Line | Current | Replacement |
|------|---------|-------------|
| 230 | `console.log(\`[Enrichment] Queued cover...\`)` | `logger?.info('Queued cover', { isbn, coverUrl })` |
| 235 | `console.error(\`[Enrichment] Cover queue failed...\`)` | `logger?.error('Cover queue failed', { isbn, error })` |
| 270 | `console.error(\`[Enrichment] Webhook failed...\`)` | `logger?.error('Webhook failed', { isbn, error })` |
| 272 | `console.log(\`[Enrichment] Fired webhook...\`)` | `logger?.info('Webhook fired', { isbn })` |
| 283 | `console.error('enrichEdition database error:')` | `logger?.error('enrichEdition DB error', { error })` |
| 432 | `console.error('enrichWork database error:')` | `logger?.error('enrichWork DB error', { error })` |
| 534 | `console.error('enrichAuthor database error:')` | `logger?.error('enrichAuthor DB error', { error })` |
| 602 | `console.error('queueEnrichment database error:')` | `logger?.error('queueEnrichment DB error', { error })` |
| 639 | `console.error('getEnrichmentStatus database error:')` | `logger?.error('getEnrichmentStatus DB error', { error })` |
| 679 | `console.error('Failed to write enrichment_log:')` | `logger?.error('enrichment_log write failed', { error })` |

**`services/cover-handlers.ts`** (4 changes):
| Line | Current | Replacement |
|------|---------|-------------|
| 46 | `console.log(\`[CoverProcessor] Processing cover...\`)` | `logger.info('Processing cover', { isbn, provider_url })` |
| 50 | `console.log(...)` | `logger.debug('Downloaded image', { size, contentType })` |
| 76 | `console.log(\`[CoverProcessor] Uploaded to R2...\`)` | `logger.info('Uploaded to R2', { r2Key })` |
| 100 | `console.error('[CoverProcessor] Error:')` | `logger.error('Cover processing failed', { error })` |

**`services/enrich-handlers.ts`** (8 changes):
Similar pattern - add `logger` parameter and replace calls.

**`services/queue-handlers.ts`** (1 change):
```typescript
// Line 168
// BEFORE
console.error('[CoverQueue] Analytics write failed:', analyticsError);
// AFTER
logger.error('Analytics write failed', { error: analyticsError });
```

**`openapi.ts`** (3 changes):
```typescript
// These are build-time logs, can stay as console or use conditional:
if (process.env.NODE_ENV !== 'production') {
  console.log(`[OpenAPI] Router ${i} contributed ${pathCount} paths`);
}
```

**`index.ts`** (1 change):
```typescript
// Line 194 - queue routing error
// BEFORE
console.error(`Unknown queue: ${batch.queue}`);
// AFTER
const logger = Logger.forQueue(env, batch.queue, batch.messages.length);
logger.error('Unknown queue', { queue: batch.queue });
```

#### Step 3: Update Function Signatures

Add optional logger to all service functions that need logging:

```typescript
// Type for service context (reusable)
interface ServiceContext {
  sql: Sql;
  env: Env;
  logger?: Logger;
}

export async function enrichEdition(ctx: ServiceContext, edition: EnrichEditionRequest) {
  const { sql, env, logger } = ctx;
  // ...
}
```

### Verification
```bash
# Should return 0 matches after migration
grep -r "console\." worker/src/services/ | wc -l
```

---

## Plan 3: Eliminate `any` Types

**Goal**: Replace all 18 `any` types with proper typing.

### Current State
```
worker/src/routes/search.ts   - 6 uses (sql: any, results: any[], map callbacks)
worker/src/routes/authors.ts  - 2 uses (map callbacks)
worker/src/openapi.ts         - 1 use (mergedDoc: any)
```

### Step-by-Step Fixes

#### Step 1: Create Database Query Result Types

```typescript
// worker/src/services/types.ts (add these)

import type { Sql } from 'postgres';

// Generic query result type
export type QueryResult<T> = T[];

// Specific result types for common queries
export interface EditionSearchResult {
  title: string | null;
  isbn: string | null;
  publish_date: string | null;
  publishers: string | null;
  pages: number | null;
  work_title: string | null;
  edition_key: string;
  work_key: string | null;
  cover_url: string | null;
  authors: Array<{ name: string; key: string }>;
}

export interface AuthorResult {
  author_key: string;
  author_name: string;
  work_count: number;
}

export interface EnrichedEditionRow {
  isbn: string;
  title: string | null;
  work_key: string | null;
  // ... other fields
}
```

#### Step 2: Fix `routes/search.ts`

```typescript
// BEFORE (line 30)
async function fallbackISBNSearch(sql: any, isbn: string) {

// AFTER
import type { Sql } from 'postgres';
import type { EditionSearchResult } from '../services/types.js';

async function fallbackISBNSearch(sql: Sql, isbn: string): Promise<EditionSearchResult[]> {
```

```typescript
// BEFORE (line 66)
async function fallbackTitleSearch(sql: any, title: string, limit: number, offset: number) {

// AFTER
async function fallbackTitleSearch(
  sql: Sql,
  title: string,
  limit: number,
  offset: number
): Promise<{ total: number; results: EditionSearchResult[] }> {
```

```typescript
// BEFORE (line 114)
async function fallbackAuthorSearch(sql: any, author: string, limit: number, offset: number) {

// AFTER
async function fallbackAuthorSearch(
  sql: Sql,
  author: string,
  limit: number,
  offset: number
): Promise<{ total: number; results: EditionSearchResult[] }> {
```

```typescript
// BEFORE (line 250)
let results: any[] = [];

// AFTER
let results: EditionSearchResult[] = [];
```

```typescript
// BEFORE (line 482)
const authors = (Array.isArray(authorsRaw) ? authorsRaw : []).map((a: any) => ({

// AFTER
interface AuthorData { name?: string; key?: string }
const authors = (Array.isArray(authorsRaw) ? authorsRaw : []).map((a: AuthorData) => ({
```

#### Step 3: Fix `routes/authors.ts`

```typescript
// BEFORE (line 683)
const existingSet = new Set(existingResult.map((r: any) => r.isbn));

// AFTER
interface ISBNRow { isbn: string }
const existingSet = new Set(existingResult.map((r: ISBNRow) => r.isbn));
```

```typescript
// BEFORE (line 829)
const qids = authorsToEnrich.map((a: any) => a.wikidata_id);

// AFTER
interface AuthorWithWikidata { wikidata_id: string; author_key: string }
const qids = authorsToEnrich.map((a: AuthorWithWikidata) => a.wikidata_id);
```

#### Step 4: Fix `openapi.ts`

```typescript
// BEFORE (line 80)
const mergedDoc: any = {

// AFTER
import type { OpenAPIV3 } from 'openapi-types';

const mergedDoc: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: baseDoc.info,
  paths: {},
  components: { schemas: {} },
  // ...
};
```

### Summary of Type Additions

| File | Type to Add | Import From |
|------|-------------|-------------|
| `search.ts` | `Sql` | `postgres` |
| `search.ts` | `EditionSearchResult` | `../services/types.js` |
| `authors.ts` | `ISBNRow`, `AuthorWithWikidata` | Define locally or in types |
| `openapi.ts` | `OpenAPIV3.Document` | `openapi-types` (install) |

### Verification
```bash
# Should return 0 matches after fixes
grep -r ": any" worker/src/routes/ | wc -l

# Run type check
cd worker && npx tsc --noEmit
```

---

## Implementation Order

**Recommended sequence** (each can be done independently):

1. **Plan 3: Eliminate `any` types** (2-3 hours)
   - Lowest risk, highest immediate benefit
   - Improves IDE autocomplete immediately
   - No architectural changes

2. **Plan 2: Replace console with Logger** (2-3 hours)
   - Medium risk, medium benefit
   - Straightforward find-and-replace
   - Better observability

3. **Plan 1: Extract handlers to services** (1-2 days)
   - Highest risk, highest long-term benefit
   - Enables unit testing
   - Should be done after types are solid

---

## Testing Strategy

After each plan, verify:

```bash
# Type checking
cd worker && npx tsc --noEmit

# Lint
npm run lint

# Build
npm run build

# Local test
npm run dev
# Then: curl http://localhost:8787/health

# Deploy to staging (if available) or production
npm run deploy
npm run tail  # Watch for errors
```
