# Issue #155: Hybrid External ID Integration Plan

**Status:** P2 (Medium) - Amazon API Ready
**Approach:** Lazy population via API endpoints (not enrichment pipeline)
**Timeline:** 8-12 hours implementation

---

## Overview

Instead of migrating the entire enrichment pipeline, implement Resolution APIs with lazy crosswalk population. This provides immediate value for external integrations while keeping the proven enrichment pipeline untouched.

## Architecture

```
User Request
    ↓
GET /api/external-ids/edition/9780439064873
    ↓
Query crosswalk table
    ↓
    ├─ Found? → Return IDs (fast: 0.75ms)
    ↓
    └─ Not found? → Fallback to array columns
                  → Lazy-write to crosswalk (one-time backfill)
                  → Return IDs

Enrichment Pipeline → Arrays ONLY (unchanged, zero disruption)
```

## Implementation (8-12 hours)

### Phase 1: API Endpoints (4-6 hours)

**File:** `worker/src/routes/external-ids.ts`

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';

const app = new OpenAPIHono<AppBindings>();

// Schema definitions
const ExternalIdSchema = z.object({
  provider: z.string(),
  provider_id: z.string(),
  confidence: z.number(),
  created_at: z.string(),
}).openapi('ExternalId');

const GetExternalIdsRoute = createRoute({
  method: 'get',
  path: '/api/external-ids/{entity_type}/{key}',
  tags: ['External IDs'],
  request: {
    params: z.object({
      entity_type: z.enum(['edition', 'work', 'author']),
      key: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'External IDs found',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(ExternalIdSchema),
            meta: z.object({
              source: z.enum(['crosswalk', 'array_backfill']),
              backfilled: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

app.openapi(GetExternalIdsRoute, async (c) => {
  const { entity_type, key } = c.req.valid('param');
  const sql = c.get('sql');
  const logger = c.get('logger');

  // Try crosswalk first
  let ids = await sql`
    SELECT provider, provider_id, confidence, created_at
    FROM external_id_mappings
    WHERE entity_type = ${entity_type}
      AND our_key = ${key}
    ORDER BY provider, confidence DESC
  `;

  let backfilled = false;

  if (ids.length === 0 && entity_type === 'edition') {
    // Lazy backfill from arrays
    logger.info('Lazy backfilling external IDs', { isbn: key });

    const edition = await sql`
      SELECT amazon_asins, google_books_volume_ids,
             goodreads_edition_ids, librarything_ids
      FROM enriched_editions
      WHERE isbn = ${key}
    `;

    if (edition.length > 0) {
      await backfillExternalIdsFromArrays(sql, key, edition[0]);
      backfilled = true;

      // Re-query crosswalk
      ids = await sql`
        SELECT provider, provider_id, confidence, created_at
        FROM external_id_mappings
        WHERE entity_type = 'edition' AND our_key = ${key}
      `;
    }
  }

  return c.json({
    success: true,
    data: ids,
    meta: {
      source: backfilled ? 'array_backfill' : 'crosswalk',
      backfilled,
    },
  });
});

// Reverse lookup
const ResolveRoute = createRoute({
  method: 'get',
  path: '/api/resolve/{provider}/{id}',
  tags: ['External IDs'],
  request: {
    params: z.object({
      provider: z.string(),
      id: z.string(),
    }),
    query: z.object({
      type: z.enum(['edition', 'work', 'author']).optional().default('edition'),
    }),
  },
  responses: {
    200: {
      description: 'Entity found',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              key: z.string(),
              entity_type: z.string(),
              confidence: z.number(),
            }),
          }),
        },
      },
    },
    404: {
      description: 'Not found',
    },
  },
});

app.openapi(ResolveRoute, async (c) => {
  const { provider, id } = c.req.valid('param');
  const { type } = c.req.valid('query');
  const sql = c.get('sql');

  const result = await sql`
    SELECT our_key, confidence
    FROM external_id_mappings
    WHERE entity_type = ${type}
      AND provider = ${provider}
      AND provider_id = ${id}
    ORDER BY confidence DESC
    LIMIT 1
  `;

  if (result.length === 0) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  return c.json({
    success: true,
    data: {
      key: result[0].our_key,
      entity_type: type,
      confidence: result[0].confidence,
    },
  });
});

export default app;
```

### Phase 2: Lazy Backfill Logic (4-6 hours)

**File:** `worker/src/services/external-id-utils.ts`

```typescript
import type { Sql } from 'postgres';

interface ArrayExternalIds {
  amazon_asins?: string[];
  google_books_volume_ids?: string[];
  goodreads_edition_ids?: string[];
  librarything_ids?: string[];
}

/**
 * Backfill crosswalk from array columns (lazy, one-time per ISBN)
 */
export async function backfillExternalIdsFromArrays(
  sql: Sql,
  isbn: string,
  edition: ArrayExternalIds
): Promise<void> {
  const mappings: Array<{
    provider: string;
    provider_id: string;
    confidence: number;
    source: string;
  }> = [];

  // Amazon ASINs
  if (edition.amazon_asins?.length) {
    for (const asin of edition.amazon_asins) {
      mappings.push({
        provider: 'amazon',
        provider_id: asin,
        confidence: 90,
        source: 'array-backfill',
      });
    }
  }

  // Google Books
  if (edition.google_books_volume_ids?.length) {
    for (const volId of edition.google_books_volume_ids) {
      mappings.push({
        provider: 'google-books',
        provider_id: volId,
        confidence: 85,
        source: 'array-backfill',
      });
    }
  }

  // Goodreads
  if (edition.goodreads_edition_ids?.length) {
    for (const grId of edition.goodreads_edition_ids) {
      mappings.push({
        provider: 'goodreads',
        provider_id: grId,
        confidence: 80,
        source: 'array-backfill',
      });
    }
  }

  // LibraryThing
  if (edition.librarything_ids?.length) {
    for (const ltId of edition.librarything_ids) {
      mappings.push({
        provider: 'librarything',
        provider_id: ltId,
        confidence: 75,
        source: 'array-backfill',
      });
    }
  }

  // Batch insert into crosswalk
  if (mappings.length > 0) {
    await sql`
      INSERT INTO external_id_mappings (
        entity_type, our_key, provider, provider_id,
        confidence, mapping_source, mapping_method
      )
      SELECT 'edition', ${isbn}, provider, provider_id,
             confidence, source, 'lazy-backfill'
      FROM json_to_recordset(${JSON.stringify(mappings)}) AS t(
        provider TEXT,
        provider_id TEXT,
        confidence INT,
        source TEXT
      )
      ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING
    `;
  }
}

/**
 * Get all external IDs for an entity (with lazy backfill)
 */
export async function getExternalIds(
  sql: Sql,
  entity_type: string,
  our_key: string
): Promise<ExternalId[]> {
  return sql`
    SELECT provider, provider_id, confidence, created_at
    FROM external_id_mappings
    WHERE entity_type = ${entity_type}
      AND our_key = ${our_key}
    ORDER BY provider, confidence DESC
  `;
}

/**
 * Find entity by external ID (reverse lookup)
 */
export async function findByExternalId(
  sql: Sql,
  entity_type: string,
  provider: string,
  provider_id: string
): Promise<string | null> {
  const result = await sql`
    SELECT our_key, confidence
    FROM external_id_mappings
    WHERE entity_type = ${entity_type}
      AND provider = ${provider}
      AND provider_id = ${provider_id}
    ORDER BY confidence DESC
    LIMIT 1
  `;
  return result[0]?.our_key || null;
}

interface ExternalId {
  provider: string;
  provider_id: string;
  confidence: number;
  created_at: Date;
}
```

### Phase 3: Integration (1-2 hours)

**File:** `worker/src/index.ts`

```typescript
// Add to route mounting
import externalIdRoutes from './routes/external-ids.js';
app.route('/', externalIdRoutes);
```

**File:** `worker/src/openapi.ts`

Update OpenAPI spec generation to include new routes.

---

## Testing

### Unit Tests

```typescript
// worker/src/__tests__/external-ids.test.ts
describe('External ID Resolution', () => {
  it('should query crosswalk first', async () => {
    // Test direct crosswalk query
  });

  it('should lazy-backfill from arrays when crosswalk empty', async () => {
    // Test fallback + backfill logic
  });

  it('should handle reverse lookup', async () => {
    // Test /api/resolve/:provider/:id
  });
});
```

### Manual Testing

```bash
# Test crosswalk query (already populated)
curl https://alexandria.ooheynerds.com/api/external-ids/edition/9780439064873

# Test lazy backfill (new ISBN)
curl https://alexandria.ooheynerds.com/api/external-ids/edition/9781234567890

# Test reverse lookup
curl https://alexandria.ooheynerds.com/api/resolve/goodreads/2089208?type=edition
```

---

## Monitoring

### Metrics to Track

```typescript
// Add to Analytics Engine
await env.ANALYTICS.writeDataPoint({
  blobs: ['external_id_lookup', isbn, source], // source: 'crosswalk' | 'array_backfill'
  doubles: [latency_ms, backfilled ? 1 : 0],
  indexes: [provider],
});
```

### KPIs
- **Crosswalk hit rate**: % of lookups from crosswalk vs array backfill
- **Backfill count**: How many ISBNs backfilled per day
- **API usage**: Requests to Resolution APIs
- **Latency**: P50/P95/P99 for both paths

---

## When to Reconsider Full Migration

**Upgrade to P1 full migration if:**

1. ✅ **Amazon API Approved**
   - Need consistent crosswalk population for all enrichments
   - Can't rely on lazy backfill for Amazon's data

2. ✅ **High API Usage** (>10K requests/day)
   - Lazy backfill becomes overhead
   - Better to populate proactively during enrichment

3. ✅ **Array Performance Degrades**
   - Currently 0.75ms is fine
   - Monitor for slowdowns as data grows

4. ✅ **Multiple External Integrations**
   - If 3+ partners depend on Resolution APIs
   - Indicates crosswalk is core infrastructure

**At that point, implement full dual-write strategy from consensus analysis.**

---

## Benefits of Hybrid Approach

✅ **Zero Risk**: Enrichment pipeline untouched (proven 21K/day throughput)
✅ **Fast Implementation**: 8-12 hours vs 16-24 hours for full migration
✅ **Immediate Value**: Resolution APIs available now
✅ **Amazon Ready**: Infrastructure in place when needed
✅ **Organic Growth**: Crosswalk populated by usage patterns
✅ **Reversible**: No complex rollback needed

---

## Cost-Benefit Analysis

| Aspect | Full Migration | Hybrid Approach |
|--------|---------------|-----------------|
| Dev time | 16-24 hours | 8-12 hours |
| Risk | Medium (transaction changes) | Low (no enrichment changes) |
| Enrichment disruption | Dual-write overhead | Zero |
| API readiness | Immediate | Immediate |
| Crosswalk completeness | 100% over time | Grows with usage |
| Amazon API ready | Yes | Yes |
| Rollback complexity | High (feature flags) | Low (just disable APIs) |

**Verdict:** Hybrid wins on pragmatism. Full migration only justified when API usage proves demand.

---

**Next Steps:**
1. Implement Phase 1 & 2 (8-12 hours)
2. Deploy to production
3. Monitor API usage and crosswalk growth
4. Re-evaluate priority when Amazon API decision arrives
