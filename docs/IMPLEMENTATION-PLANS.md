# Alexandria Implementation Plans

Detailed plans for three code improvements based on codebase analysis.

---

## Current State Analysis

**Route File Sizes (Total: 4,637 lines)**:
- `authors.ts`: 979 lines (largest)
- `enrich.ts`: 789 lines
- `search.ts`: 564 lines
- `books.ts`: 515 lines
- `covers-legacy.ts`: 495 lines

**Console Usage**: 49 files with `console.*` calls
**Type Issues**: 8 `any` type usages across 3 files

---

## Plan 1: Extract Handler Logic to Services

**Goal**: Reduce route files to ~150-200 lines by moving business logic to services

### Priority Files (Biggest Impact)

#### 1.1 Extract from `authors.ts` (979 lines → ~200 lines)

**Target**: Create `author-service.ts` with 5 extracted handlers

```typescript
// NEW: worker/src/services/author-service.ts
export class AuthorService {
  constructor(private sql: any, private env: Env, private logger: Logger) {}

  async getTopAuthors(limit: number, offset: number) {
    // Extract ~200 lines of business logic from topAuthorsRoute handler
  }

  async getAuthorDetails(authorKey: string) {
    // Extract ~150 lines from authorDetailsRoute handler
  }

  async getAuthorBibliography(authorName: string, pageSize: number) {
    // Extract ~300 lines from bibliographyRoute handler
  }

  async enrichBibliography(authorName: string, maxPages: number) {
    // Extract ~200 lines from enrichBibliographyRoute handler
  }

  async enrichWikidata(limit: number) {
    // Extract ~100 lines from enrichWikidataRoute handler
  }
}
```

**Route becomes thin wrapper**:
```typescript
// AFTER: routes/authors.ts becomes ~200 lines
app.openapi(topAuthorsRoute, async (c) => {
  const params = c.req.valid('query');
  const service = new AuthorService(c.get('sql'), c.env, c.get('logger'));
  const result = await service.getTopAuthors(params.limit, params.offset);
  return c.json(result);
});
```

#### 1.2 Extract from `enrich.ts` (789 lines → ~300 lines)

**Target**: Extend existing `enrichment-service.ts` with new methods

```typescript
// EXTEND: worker/src/services/enrichment-service.ts
export class EnrichmentService {
  // ... existing methods

  async directBatchEnrichment(isbns: string[], source: string) {
    // Extract ~300 lines from enrichBatchDirectRoute handler
  }

  async queueEnrichment(isbns: string[], priority: string) {
    // Extract ~200 lines from enrichQueueRoute handler
  }
}
```

#### 1.3 Extract from `books.ts` (515 lines → ~200 lines)

**Target**: Create `books-service.ts`

```typescript
// NEW: worker/src/services/books-service.ts
export class BooksService {
  async searchISBNdb(query: string, column: string, maxPages: number) {
    // Extract ~200 lines from searchRoute handler
  }

  async enrichNewReleases(startMonth: string, endMonth: string, options: any) {
    // Extract ~250 lines from enrichNewReleasesRoute handler
  }
}
```

### Implementation Steps

1. **Create service files** with extracted business logic
2. **Update route handlers** to be thin wrappers (~10-15 lines each)
3. **Update imports** and dependencies
4. **Test each extraction** individually
5. **Run full test suite** after each file

### Verification

- Route files reduced to ~150-200 lines each
- All handlers become 10-15 line wrappers
- Business logic isolated and unit-testable
- No functional changes to API behavior

---

## Plan 2: Replace Console with Structured Logger

**Goal**: Replace 26+ `console.*` calls with structured Logger

### Priority Files (Most Console Usage)

#### 2.1 Main Service Files

| File | Console Calls | Replacement Strategy |
|------|---------------|----------------------|
| `enrichment-service.ts` | ~10 calls | Add logger parameter to methods |
| `enrich-handlers.ts` | ~8 calls | Use logger from context |
| `cover-handlers.ts` | ~4 calls | Use logger from context |
| `queue-handlers.ts` | ~3 calls | Use Logger.forQueue() |

#### 2.2 Example Transformation

**Before**:
```typescript
// enrichment-service.ts
console.log('Starting ISBNdb batch enrichment', { count: isbns.length });
console.error('ISBNdb enrichment failed', error);
```

**After**:
```typescript
// enrichment-service.ts
export async function enrichISBNsBatch(isbns: string[], env: Env, logger: Logger) {
  logger.info('Starting ISBNdb batch enrichment', { count: isbns.length });
  logger.error('ISBNdb enrichment failed', { error: error.message });
}
```

### Implementation Steps

1. **Update service function signatures** to accept logger parameter
2. **Replace console calls** with appropriate log levels:
   - `console.log` → `logger.info`
   - `console.error` → `logger.error`
   - `console.warn` → `logger.warn`
3. **Update all callers** to pass logger instance
4. **Test logging output** in development

### File-by-File Plan

#### Services (8 files)
- `enrichment-service.ts`: Add logger param to 6 functions
- `enrich-handlers.ts`: Use `c.get('logger')` in 4 handlers
- `cover-handlers.ts`: Use `c.get('logger')` in 3 handlers
- `queue-handlers.ts`: Use `Logger.forQueue()` in batch handlers

#### Routes (3 files)
- `harvest.ts`: Replace 8 console calls with `logger.*`
- `openapi.ts`: Replace 3 console calls in error handlers

### Verification

- Zero `console.*` calls in worker/src/ directory
- All logging uses structured Logger with context
- Log output includes requestId/batchId for tracing
- Performance/query analytics preserved

---

## Plan 3: Eliminate 'Any' Types

**Goal**: Replace 8 `any` type usages with proper TypeScript types

### Current Any Usage (8 total)

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `routes/search.ts` | Multiple | `sql: any` | `sql: SqlClient` |
| `routes/authors.ts` | 2 places | Various any | Proper interfaces |
| `openapi.ts` | 1 place | OpenAPI any | `OpenAPIV3.Document` |

### 3.1 Create Missing Types

```typescript
// NEW: worker/src/types/database.ts
export interface SqlClient {
  // Type the postgres client properly
  <T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>;
  end(): Promise<void>;
}

export interface EditionSearchResult {
  isbn: string;
  title: string;
  authors: string[];
  publication_date?: string;
  cover_url_large?: string;
}

export interface AuthorSearchResult {
  author_key: string;
  name: string;
  work_count: number;
  edition_count: number;
}

export interface WorkSearchResult {
  work_key: string;
  title: string;
  author_names: string[];
  first_publish_year?: number;
  editions_count: number;
}
```

### 3.2 File-by-File Replacements

#### `routes/search.ts` (5 any usages)
```typescript
// Before
async function fallbackISBNSearch(sql: any, isbn: string)

// After
async function fallbackISBNSearch(sql: SqlClient, isbn: string): Promise<EditionSearchResult[]>
```

#### `routes/authors.ts` (2 any usages)
```typescript
// Before
const authorData: any = results[0];

// After
const authorData: AuthorSearchResult = results[0];
```

#### `openapi.ts` (1 any usage)
```typescript
// Before
const doc: any = app.getOpenAPI31Document();

// After
import type { OpenAPIV3 } from 'openapi-types';
const doc: OpenAPIV3.Document = app.getOpenAPI31Document();
```

### 3.3 Add OpenAPI Types Dependency

```bash
npm install --save-dev openapi-types
```

### Implementation Steps

1. **Create type definitions** in `worker/src/types/`
2. **Install openapi-types** for OpenAPI typing
3. **Replace any usages** file by file
4. **Update function signatures** with proper return types
5. **Run TypeScript compiler** to catch any errors
6. **Test with strict type checking** enabled

### Verification

- Zero `any` types in worker/src/ directory
- Full TypeScript type safety
- Better IDE autocomplete and error detection
- No runtime behavior changes

---

## Recommended Implementation Order

### Phase 1: Low-Risk Quick Wins (1-2 hours)
1. **Plan 3** (Eliminate any types)
   - Zero architectural changes
   - Immediate IDE improvements
   - Makes subsequent plans safer

### Phase 2: Observability (2-3 hours)
2. **Plan 2** (Console → Logger)
   - Better production observability
   - Structured logging for debugging
   - Minimal risk to functionality

### Phase 3: Architecture (1-2 days)
3. **Plan 1** (Extract handlers)
   - Enables unit testing
   - Improves maintainability
   - Higher complexity but biggest benefit

### Testing Strategy

**After each plan**:
- `npm run lint` - Check TypeScript/ESLint
- `npm run build` - Verify compilation
- `npm run test` - Run any existing tests
- Manual smoke test of key endpoints

**Final validation**:
- Deploy to staging environment
- Test critical user journeys
- Monitor logs for errors
- Performance regression testing

---

## Success Criteria

### Plan 1 Success
- ✅ Route files ≤ 200 lines each
- ✅ Handlers are 10-15 line wrappers
- ✅ Business logic in testable services
- ✅ No API behavior changes

### Plan 2 Success
- ✅ Zero console.* calls in src/
- ✅ Structured logging with context
- ✅ Request/batch tracing enabled
- ✅ Analytics integration preserved

### Plan 3 Success
- ✅ Zero any types in src/
- ✅ Full TypeScript type safety
- ✅ Better IDE developer experience
- ✅ No runtime regressions

### Overall Success
- ✅ Code quality improved significantly
- ✅ Maintenance burden reduced
- ✅ Testing capabilities enabled
- ✅ Developer experience enhanced