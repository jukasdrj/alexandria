# Alexandria Test Suite Improvement Plan

**Date:** December 30, 2025
**Consensus Confidence:** 8.5/10 (High)
**Models Consulted:** Gemini 2.5 Flash, Grok 4.1 Fast

---

## Executive Summary

Alexandria currently has **59/60 tests passing (98.3%)** with strong coverage of quota management but critical gaps in API routes, enrichment pipeline, and queue handlers. This plan outlines a 4-phase approach to achieve 85% test coverage with a focus on user-facing functionality and sustainable testing practices for a solo developer.

**Current Coverage:**
- ✅ **Excellent:** Quota Manager (53 tests)
- ❌ **Missing:** API routes, enrichment pipeline, queue handlers, cover processing
- ⚠️ **Broken:** Legacy tests with import path issues

---

## Consensus Findings

### Complete Agreement (Both Models)

1. **Fix Legacy Tests Immediately** - Quick wins to reach 100% passing
2. **API Routes = Top Priority** - Highest user-facing risk
3. **Use Miniflare for Workers Runtime** - Industry standard for Cloudflare Workers
4. **Aggressive External API Mocking** - MSW for ISBNdb, Google Books, OpenLibrary
5. **Integration Tests > E2E** - Solo developer sustainability

### Strategic Differences

| Aspect | Gemini 2.5 Flash | Grok 4.1 Fast |
|--------|------------------|---------------|
| Focus | Long-term maintainability, data integrity | Immediate user-facing risk |
| Coverage | Comprehensive (>90%) | Pragmatic (85%) |
| Ratio | Flexible phased | 60% integration, 30% unit, 10% E2E |
| Timeline | Manageable sprints | 1 week + 2-4 weeks critical gaps |

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1) ✨

**Priority:** CRITICAL | **Effort:** Low | **Impact:** High

#### Objectives
- [ ] Fix legacy test import paths
- [ ] Migrate tests to TypeScript
- [ ] Achieve 100% passing test suite
- [ ] Install testing dependencies

#### Tasks

**1.1 Migrate enrichment-service.test.js**
```bash
# Move and convert
tests/enrichment-service.test.js → src/services/__tests__/enrichment-service.test.ts
```

**Issues to Fix:**
- Import path: `../enrichment-service.js` → `../enrichment-service.js` (relative from new location)
- ESM compatibility
- TypeScript types

**1.2 Migrate index.test.js**
```bash
# Move and convert
tests/index.test.js → src/__tests__/routes.test.ts
```

**Issues to Fix:**
- Health endpoint assertion failure
- Import paths for route handlers
- Mock setup for Hono context

**1.3 Install Testing Dependencies**
```bash
cd worker
npm install --save-dev @miniflare/vitest msw @hono/testing
```

**Success Criteria:**
- ✅ All tests passing (60/60)
- ✅ No import errors
- ✅ Tests run in TypeScript with proper types

---

### Phase 2: Critical Paths (Weeks 2-4) 🎯

**Priority:** HIGH | **Effort:** Medium | **Impact:** Very High

#### 2.1 API Route Integration Tests

**Routes to Test:**
- [ ] `GET /api/search` (ISBN, title, author queries)
- [ ] `POST /api/enrich/batch-direct`
- [ ] `POST /covers/:isbn/process`
- [ ] `GET /api/quota/status`
- [ ] `POST /api/authors/enrich-bibliography`
- [ ] `GET /health`
- [ ] `GET /api/stats`

**Testing Pattern:**
```typescript
// Example: src/__tests__/api/search.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

describe('Search API', () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should search by ISBN', async () => {
    const resp = await worker.fetch('/api/search?isbn=9780439064873');
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.success).toBe(true);
    expect(data.data[0].isbn).toBe('9780439064873');
  });

  it('should validate zod schema', async () => {
    const resp = await worker.fetch('/api/search?isbn=invalid');
    expect(resp.status).toBe(400);
  });
});
```

#### 2.2 External API Mocking (MSW)

**Setup MSW Handlers:**
```typescript
// src/__tests__/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  // ISBNdb Premium API
  http.get('https://api.premium.isbndb.com/book/:isbn', ({ params }) => {
    return HttpResponse.json({
      book: {
        isbn: params.isbn,
        title: 'Mock Book Title',
        authors: ['Mock Author'],
        image: 'https://example.com/cover.jpg',
      },
    });
  }),

  // ISBNdb Batch Endpoint
  http.post('https://api.premium.isbndb.com/books', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      books: body.isbns.map((isbn: string) => ({
        isbn,
        title: `Mock Book ${isbn}`,
      })),
    });
  }),

  // Google Books API
  http.get('https://www.googleapis.com/books/v1/volumes', () => {
    return HttpResponse.json({
      items: [{
        volumeInfo: {
          title: 'Mock Google Book',
          authors: ['Mock Author'],
        },
      }],
    });
  }),

  // OpenLibrary API
  http.get('https://openlibrary.org/api/books', () => {
    return HttpResponse.json({
      'ISBN:9780439064873': {
        title: 'Mock OpenLibrary Book',
      },
    });
  }),
];
```

**Test Setup:**
```typescript
// src/__tests__/setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Success Criteria:**
- ✅ All user-facing API routes tested
- ✅ External APIs mocked with MSW
- ✅ Schema validation tests (zod-openapi)
- ✅ Error handling tests (4xx, 5xx)

---

### Phase 3: Core Business Logic (Weeks 5-6) 🧠

**Priority:** MEDIUM-HIGH | **Effort:** High | **Impact:** High

#### 3.1 Smart Resolution Chain

**Test Coverage:**
```typescript
// src/services/__tests__/smart-resolution.test.ts
describe('Smart Resolution Pipeline', () => {
  it('should try ISBNdb → Google Books → OpenLibrary', async () => {
    // Mock ISBNdb failure
    server.use(
      http.get('https://api.premium.isbndb.com/book/:isbn', () => {
        return new HttpResponse(null, { status: 404 });
      })
    );

    const result = await smartResolveISBN('9780439064873');

    expect(result.provider).toBe('google_books'); // Fallback
  });

  it('should merge data from multiple providers', async () => {
    const result = await smartResolveISBN('9780439064873');

    expect(result.title).toBeDefined();
    expect(result.authors).toBeDefined();
    expect(result.cover_url).toBeDefined();
  });
});
```

#### 3.2 Database Operations

**Test Coverage:**
```typescript
// src/services/__tests__/enrichment-service.test.ts
describe('Database Enrichment', () => {
  let mockSql: any;

  beforeEach(() => {
    mockSql = vi.fn((strings, ...values) => Promise.resolve([]));
  });

  it('should calculate quality improvement', async () => {
    mockSql
      .mockResolvedValueOnce([{ isbndb_quality: 5 }]) // existing
      .mockResolvedValueOnce([{ isbn: '9780439064873', isbndb_quality: 10 }]); // new

    const result = await enrichEdition(mockSql, {
      isbn: '9780439064873',
      primary_provider: 'isbndb',
    });

    expect(result.quality_improvement).toBe(5);
  });
});
```

#### 3.3 Queue Handlers

**Test Coverage:**
```typescript
// src/services/__tests__/queue-handlers.test.ts
describe('Queue Handlers', () => {
  it('should process cover queue batch', async () => {
    const batch = {
      queue: 'alexandria-cover-queue',
      messages: [
        {
          id: '1',
          body: { isbn: '9780439064873', provider_url: 'https://example.com/cover.jpg' },
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ],
    };

    await processCoverQueue(batch, mockEnv);

    expect(batch.messages[0].ack).toHaveBeenCalled();
  });
});
```

**Success Criteria:**
- ✅ Smart resolution fallback logic tested
- ✅ Database quality score calculations verified
- ✅ Queue batch processing tested
- ✅ Retry and DLQ logic validated

---

### Phase 4: Polish (Weeks 7-8) ✨

**Priority:** MEDIUM | **Effort:** Medium | **Impact:** Medium

#### 4.1 Cover Processing Pipeline

- [ ] Image download tests
- [ ] WebP conversion tests (jSquash WASM)
- [ ] R2 storage upload tests
- [ ] Size variant generation (large, medium, small)

#### 4.2 OpenAPI Validation

- [ ] Schema correctness tests
- [ ] Response format validation
- [ ] Error response schemas

#### 4.3 Error Handling Edge Cases

- [ ] Network timeouts
- [ ] Database connection failures
- [ ] Queue message malformation
- [ ] R2 storage failures

#### 4.4 Cron Job Handlers

- [ ] Scheduled harvest tests
- [ ] Quota enforcement in cron jobs
- [ ] Cron error handling

**Success Criteria:**
- ✅ 85% coverage on src/ directory
- ✅ All critical paths tested
- ✅ CI/CD coverage gates enforced

---

## Tooling Configuration

### package.json Updates

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:unit": "vitest run src/**/__tests__/**/*.test.ts"
  },
  "devDependencies": {
    "@miniflare/vitest": "^3.0.0",
    "msw": "^2.0.0",
    "@hono/testing": "^1.0.0",
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0"
  }
}
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'miniflare',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,js}'],
      exclude: [
        'src/__tests__/**',
        'src/**/__tests__/**',
        'src/types/**',
        'src/schemas/**',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
```

---

## Critical Risks & Mitigations

### 1. Mock Drift 🔴

**Risk:** Mocks diverge from real API behavior, tests pass but production fails.

**Mitigation:**
- Document expected API responses in `tests/fixtures/api-responses/`
- Periodic manual contract tests against real APIs (monthly)
- Use TypeScript types for API responses
- Version control mock data with API version comments

**Action Items:**
- [ ] Create `tests/fixtures/` directory structure
- [ ] Document ISBNdb API response format
- [ ] Document Google Books API response format
- [ ] Document OpenLibrary API response format

### 2. Concurrent Test Flakiness 🟡

**Risk:** Race conditions in quota tests, KV operations causing intermittent failures.

**Mitigation:**
- Use `beforeEach` to reset state completely
- Isolate tests (no shared state)
- Add test-specific KV namespaces
- Use `vi.useFakeTimers()` for time-dependent tests

**Action Items:**
- [ ] Review quota tests for race conditions
- [ ] Add proper cleanup in `afterEach` hooks
- [ ] Document flaky test resolution patterns

### 3. Over-Mocking 🟡

**Risk:** Tests pass but production fails (industry cautionary tale: Goodreads clones).

**Mitigation:**
- One E2E smoke test per critical path
- Integration tests with real Workers runtime (Miniflare)
- Contract tests for external APIs
- Regular manual QA of critical flows

**Action Items:**
- [ ] Define critical paths requiring E2E coverage
- [ ] Create smoke test suite
- [ ] Document manual QA checklist

### 4. Maintenance Burden 🟢

**Risk:** Tests become outdated as code evolves, creating false confidence.

**Mitigation:**
- 10% of dev time allocated to test maintenance
- CI/CD coverage thresholds prevent regressions
- Test failure = blocked deployment
- Regular test review during refactoring

**Action Items:**
- [ ] Set up GitHub Actions CI/CD
- [ ] Configure coverage gates (85% minimum)
- [ ] Create test maintenance schedule

---

## Success Metrics

### Phase 1 (Week 1)
- ✅ 100% passing test suite (60/60 tests)
- ✅ Zero import errors
- ✅ All tests in TypeScript

### Phase 2 (Weeks 2-4)
- ✅ API route tests for all user-facing endpoints
- ✅ MSW mocks for all external APIs
- ✅ Schema validation tests (zod-openapi)

### Phase 3 (Weeks 5-6)
- ✅ Smart resolution pipeline fully tested
- ✅ Database operations verified
- ✅ Queue handlers tested

### Phase 4 (Weeks 7-8)
- ✅ 85% coverage on src/ directory
- ✅ CI/CD pipeline with coverage gates
- ✅ Zero known critical gaps

### Long-term
- ✅ 20-30% velocity improvement via regression prevention
- ✅ Fewer production bugs
- ✅ Faster refactoring confidence

---

## Testing Strategy Summary

**Testing Ratio:** 60% integration, 30% unit, 10% E2E

**Coverage Target:** 85% on `src/` directory

**Tooling Stack:**
- Vitest (test runner)
- Miniflare (Workers runtime simulation)
- MSW (HTTP mocking)
- Hono Testing Utilities (route testing)

**Priority Order:**
1. Fix legacy tests (Week 1)
2. API route integration tests (Weeks 2-4)
3. Core business logic (Weeks 5-6)
4. Polish and coverage gaps (Weeks 7-8)

---

## References

**Consensus Models:**
- Gemini 2.5 Flash (8/10 confidence, "for" stance)
- Grok 4.1 Fast (9/10 confidence, "neutral" stance)

**Industry Best Practices:**
- Cloudflare Workers examples (Miniflare + Vitest)
- Hono framework testing patterns
- MSW for external API mocking
- 70% unit/integration, 20% contract, 10% E2E ratio

**Cautionary Notes:**
- Over-mocking risks (Goodreads clone case study)
- Mock drift in enrichment services
- Flakiness in concurrent operations

---

## Next Actions

### Immediate (This Week)
1. ✅ Write this plan to `TEST_IMPROVEMENT_PLAN.md`
2. ⏳ Migrate `tests/enrichment-service.test.js` to TypeScript
3. ⏳ Migrate `tests/index.test.js` to TypeScript
4. ⏳ Install testing dependencies
5. ⏳ Verify 100% passing test suite

### Next Sprint (Weeks 2-4)
1. Set up MSW mocks for external APIs
2. Write API route integration tests
3. Configure Miniflare for Workers testing
4. Achieve >80% coverage on routes

### Long-term
1. Build out core business logic tests
2. Add E2E smoke tests
3. Configure CI/CD with coverage gates
4. Regular test maintenance (10% dev time)

---

**Document Status:** ✅ Complete
**Last Updated:** December 30, 2025
**Next Review:** After Phase 1 completion
