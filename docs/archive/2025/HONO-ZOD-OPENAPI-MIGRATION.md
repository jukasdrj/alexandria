# Alexandria: Hono Zod-OpenAPI Migration Plan

**Status**: Phase 1 Complete | Phase 2 In Progress
**Last Updated**: December 13, 2025
**Migration Target**: `@hono/zod-openapi` with auto-generated OpenAPI spec

---

## Overview

Migrating Alexandria from basic Hono + `@hono/zod-validator` to full `@hono/zod-openapi` pattern, matching bendv3's architecture.

### Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| Routing | Plain `app.get()`, `app.post()` | `createRoute()` with schemas |
| Validation | `zValidator()` middleware | Built into route definitions |
| OpenAPI spec | Manual `openapi.ts` | Auto-generated from routes |
| Route structure | All in `index.ts` (~2000 lines) | Modular `src/routes/*.ts` |
| Type inference | Manual typing | Inferred from schemas |

---

## Phase 1: Foundation ✅ COMPLETE

### Completed Tasks

- [x] Add `@hono/zod-openapi` dependency
- [x] Create `src/` directory structure
- [x] Create `src/env.ts` - Environment types + AppBindings
- [x] Create `src/openapi.ts` - OpenAPI spec factory
- [x] Create `src/schemas/common.ts` - Shared Zod schemas
- [x] Create `src/routes/health.ts` - First migrated route (template)
- [x] Create `src/index.ts` - New entry point
- [x] Update `wrangler.jsonc` → `main: "src/index.ts"`
- [x] Verify wrangler compiles (dry-run successful)
- [x] Code review with grok

### Files Created

```
worker/src/
├── env.ts           # Environment types + AppBindings
├── openapi.ts       # OpenAPI spec factory
├── index.ts         # New entry point
├── routes/
│   └── health.ts    # Template route
└── schemas/
    └── common.ts    # Shared schemas
```

---

## Phase 1.5: Critical Fixes ✅ COMPLETE

All issues identified during code review have been resolved.

### 1. Database Connection Cleanup (CRITICAL) ✅

**File**: `src/index.ts:96-107`
**Fixed**: Added cleanup middleware after all routes to close DB connection after each request.

### 2. Logger Type Definition (HIGH) ✅

**File**: `src/env.ts:59-72`
**Fixed**: Added proper `Logger` interface with `info`, `warn`, `error`, `debug` methods. Updated Variables type.

### 3. Response Timing Header (MEDIUM) ✅

**File**: `src/index.ts:63-68`
**Fixed**: Added timing middleware that sets `X-Response-Time` header on all responses.

### 4. Schema Deduplication (MEDIUM) ✅

**File**: `src/schemas/common.ts`
**Fixed**: Added `.openapi()` tags to all schemas: `ErrorResponse`, `SuccessResponse`, `HealthResponse`, `PaginationQuery`, `PaginationResponse`, `ISBN`.

### 5. Use Structured Logger (LOW) ✅

**File**: `src/routes/health.ts:78`
**Fixed**: Replaced `console.error()` with `c.get('logger').error()` for structured logging.

---

## Outstanding Issues (from Code Reviews)

Issues found during migration that should be addressed before final deployment:

### From Batch 1 Review (Grok)

| Severity | File | Issue | Fix |
|----------|------|-------|-----|
| 🟢 LOW | `src/routes/enrich.ts` | Named export instead of default | Change to `export default enrichRoutes;` |
| 🟢 LOW | `src/routes/enrich.ts:304,472` | Inline handlers bypass Zod validation | Use `c.req.valid('json')` instead of `c.req.json()` |
| 🟢 LOW | `src/schemas/search.ts:9` | Uses transform-with-throw for ISBN | Replace with `.refine()` |
| 🟢 LOW | `src/index.ts:31` | CORS exposes X-Response-Time but set after CORS | Remove from exposeHeaders or reorder middleware |
| 🟢 LOW | `src/index.ts:109` | DB cleanup swallows errors silently | Add `logger.warn()` in catch block |
| 🟢 LOW | `src/schemas/common.ts` | Some schemas unused (duplicated in route files) | Clean up or consolidate |

**Status**: Deferred to Phase 3 cleanup - all are LOW severity and don't affect functionality.

### From Batch 2 Review (Grok)

| Severity | File | Issue | Fix |
|----------|------|-------|-----|
| 🟡 MEDIUM | `src/routes/covers.ts:185-186` | `c.req.json()` bypasses Zod validation | Use `c.req.valid('json')` instead |
| 🟢 LOW | `src/schemas/covers.ts:94,112` | Internal schemas lack `.openapi()` tags | Add `.openapi('CoverURLs')` and `.openapi('CoverMetadata')` |
| 🟢 LOW | `src/routes/covers.ts:181` | Inline handler pattern | Extract to external handler function |
| 🟢 LOW | `src/schemas/covers.ts:203` | ErrorResponseSchema duplicated | Import from `schemas/common.ts` instead |

**Status**: ✅ MEDIUM severity item FIXED (`c.req.valid('json')` applied). LOW items deferred to Phase 3.

---

## Phase 2: Route Migration

### Migration Order (simplest → complex)

Routes should be migrated in this order to build momentum and isolate issues:

| # | Route | Complexity | Dependencies |
|---|-------|------------|--------------|
| 1 | `GET /api/stats` | Low | DB queries only |
| 2 | `GET /api/search` | Medium | Query params, pagination, multiple search modes |
| 3 | `POST /api/enrich/edition` | Medium | Body validation, DB writes |
| 4 | `POST /api/enrich/work` | Medium | Body validation, DB writes |
| 5 | `POST /api/enrich/author` | Medium | Body validation, DB writes |
| 6 | `POST /api/enrich/queue` | Medium | Body validation, queue producer |
| 7 | `POST /api/enrich/batch-direct` | Medium | Body validation, ISBNdb batch |
| 8 | `GET /api/enrich/status/:id` | Low | Path params |
| 9 | `POST /api/covers/process` | Medium | Body validation, R2 |
| 10 | `GET /api/covers/:work_key/:size` | Medium | Path params, R2 serving |
| 11 | `GET /covers/:isbn/:size` | Medium | Legacy, path params |
| 12 | `POST /covers/:isbn/process` | Medium | Legacy, path params |
| 13 | `POST /covers/batch` | Medium | Body validation |
| 14 | `GET /covers/:isbn/status` | Low | Path params |
| 15 | `POST /api/authors/bibliography` | Medium | Body validation, ISBNdb |
| 16 | `POST /api/authors/enrich-bibliography` | High | Complex orchestration |
| 17 | `/api/test/*` endpoints | Low | Test utilities |

### Route File Structure

```
worker/src/routes/
├── health.ts        ✅ Complete
├── stats.ts         # GET /api/stats
├── search.ts        # GET /api/search
├── enrich.ts        # All /api/enrich/* endpoints
├── covers.ts        # All /api/covers/* endpoints
├── covers-legacy.ts # Legacy /covers/:isbn/* endpoints
├── authors.ts       # /api/authors/* endpoints
└── test.ts          # /api/test/* endpoints
```

### Schema File Structure

```
worker/src/schemas/
├── common.ts        ✅ Complete (needs .openapi() tags)
├── search.ts        # Search query/response schemas
├── enrich.ts        # Enrichment schemas
├── covers.ts        # Cover processing schemas
└── authors.ts       # Author bibliography schemas
```

### Route Template

Use this pattern for all new routes:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';

// Schema with .openapi() for spec generation
const ResponseSchema = z.object({
  // ...fields
}).openapi('ResponseName');

// Route definition
const myRoute = createRoute({
  method: 'get',
  path: '/api/example',
  tags: ['TagName'],
  summary: 'Short description',
  description: 'Detailed description',
  request: {
    query: QuerySchema,  // optional
    body: {              // optional
      content: { 'application/json': { schema: BodySchema } }
    }
  },
  responses: {
    200: {
      description: 'Success',
      content: { 'application/json': { schema: ResponseSchema } }
    },
    // ... error responses
  },
});

const app = new OpenAPIHono<AppBindings>();

app.openapi(myRoute, async (c) => {
  const logger = c.get('logger');
  const sql = c.get('sql');
  // ... handler logic
});

export default app;
```

---

## Phase 3: Cleanup & Finalization

### Tasks

- [ ] Remove old `worker/index.ts` (after all routes migrated)
- [ ] Remove old `worker/openapi.ts` (manual spec)
- [ ] Remove `@hono/zod-validator` dependency (no longer needed)
- [ ] Update `worker/types.ts` exports if needed
- [ ] Update CLAUDE.md with new file structure
- [ ] Run full test suite
- [ ] Deploy and verify production

### Validation Checklist

- [ ] All endpoints return correct responses
- [ ] OpenAPI spec at `/openapi.json` is complete
- [ ] All schemas appear in spec with proper names
- [ ] Type inference works in all handlers
- [ ] No TypeScript errors
- [ ] Queue handlers still work
- [ ] Cron handlers still work

---

## Testing Strategy

### Per-Route Testing

After migrating each route:

1. **Type check**: `npx tsc --noEmit`
2. **Local test**: `npm run dev` + curl endpoints
3. **OpenAPI check**: Verify route appears in `/openapi.json`
4. **Dry-run deploy**: `npx wrangler deploy --dry-run`

### Integration Testing

After Phase 2 complete:

1. **Full deploy**: `npm run deploy`
2. **Health check**: `curl https://alexandria.ooheynerds.com/health`
3. **OpenAPI spec**: Verify all routes documented
4. **Queue test**: Trigger enrichment/cover processing
5. **Search test**: ISBN, title, author searches

---

## Rollback Plan

If issues arise:

1. Revert `wrangler.jsonc` → `main: "index.ts"`
2. Deploy: `npm run deploy`
3. Old entry point still exists and is functional

The old `worker/index.ts` remains untouched until Phase 3, providing a safe rollback path.

---

## Dependencies

```json
{
  "dependencies": {
    "@hono/zod-openapi": "^0.14.5",  // NEW
    "@hono/zod-validator": "^0.7.5", // Remove in Phase 3
    "hono": "^4.10.7",
    "zod": "^4.1.13"
  }
}
```

---

## Notes

- **Hyperdrive + postgres.js**: Single connection per request (`max: 1`) is correct pattern for Workers
- **Queue handlers**: Imported from parent directory during migration, move to src/ in Phase 3
- **Error handler**: Existing `middleware/error-handler.js` works with OpenAPIHono
- **Dashboard**: Root `/` route serves HTML dashboard, not part of OpenAPI spec
