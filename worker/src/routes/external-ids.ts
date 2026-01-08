import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import { Logger } from '../../lib/logger.js';
import {
  ExternalIdParamSchema,
  ResolveParamSchema,
  ResolveQuerySchema,
  GetExternalIdsResponseSchema,
  ResolveResponseSchema,
  ExternalIdErrorSchema,
} from '../schemas/external-ids.js';
import {
  getExternalIds,
  findByExternalId,
  backfillExternalIdsFromArrays,
} from '../services/external-id-utils.js';
import type { ArrayExternalIds } from '../services/types.js';

// =================================================================================
// Route Definitions
// =================================================================================

const getExternalIdsRoute = createRoute({
  method: 'get',
  path: '/api/external-ids/{entity_type}/{key}',
  tags: ['External IDs'],
  summary: 'Get external IDs for an entity',
  description:
    'Retrieves all external provider IDs (Amazon ASIN, Goodreads ID, etc.) for a given entity. ' +
    'Queries crosswalk table first (0.75ms). If empty and entity is edition, lazy-backfills from ' +
    'array columns (one-time 10-15ms). Subsequent queries hit crosswalk.',
  request: {
    params: ExternalIdParamSchema,
  },
  responses: {
    200: {
      description: 'External IDs found (may be empty array)',
      content: {
        'application/json': {
          schema: GetExternalIdsResponseSchema,
        },
      },
    },
    500: {
      description: 'Query failed',
      content: {
        'application/json': {
          schema: ExternalIdErrorSchema,
        },
      },
    },
  },
});

const resolveExternalIdRoute = createRoute({
  method: 'get',
  path: '/api/resolve/{provider}/{id}',
  tags: ['External IDs'],
  summary: 'Resolve external ID to internal key',
  description:
    'Reverse lookup: Find our internal key (ISBN, work key, author key) from an external provider ID. ' +
    'Example: amazon/B000FC1MCS → 9780439064873',
  request: {
    params: ResolveParamSchema,
    query: ResolveQuerySchema,
  },
  responses: {
    200: {
      description: 'Entity found',
      content: {
        'application/json': {
          schema: ResolveResponseSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ExternalIdErrorSchema,
        },
      },
    },
    500: {
      description: 'Query failed',
      content: {
        'application/json': {
          schema: ExternalIdErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(getExternalIdsRoute, async (c) => {
  const { entity_type, key } = c.req.valid('param');
  const sql = c.get('sql');
  const logger = c.get('logger');
  const startTime = Date.now();

  try {
    // Try crosswalk first
    let ids = await getExternalIds(sql, entity_type, key);
    let backfilled = false;
    let source: 'crosswalk' | 'array_backfill' = 'crosswalk';

    // Lazy backfill from arrays if empty and entity_type=edition
    if (ids.length === 0 && entity_type === 'edition') {
      logger.info('Lazy backfilling external IDs', { isbn: key, entity_type });

      // Query enriched_editions for array columns
      const edition = await sql<ArrayExternalIds[]>`
        SELECT
          amazon_asins,
          google_books_volume_ids,
          goodreads_edition_ids,
          librarything_ids
        FROM enriched_editions
        WHERE isbn = ${key}
      `;

      if (edition.length > 0 && edition[0]) {
        // Backfill crosswalk from array columns
        await backfillExternalIdsFromArrays(sql, key, edition[0], logger);
        backfilled = true;
        source = 'array_backfill';

        // Re-query crosswalk
        ids = await getExternalIds(sql, entity_type, key);
      }
    }

    const latency = Date.now() - startTime;

    // Track analytics
    await c.env.ANALYTICS?.writeDataPoint({
      blobs: ['external_id_lookup', entity_type, key, source],
      doubles: [latency, backfilled ? 1 : 0, ids.length],
      indexes: [entity_type],
    });

    logger.info('External ID lookup', {
      entity_type,
      key,
      source,
      backfilled,
      result_count: ids.length,
      latency_ms: latency,
    });

    return c.json({
      success: true,
      data: ids.map((id) => ({
        provider: id.provider,
        provider_id: id.provider_id,
        confidence: id.confidence,
        created_at: id.created_at?.toISOString(),
      })),
      meta: {
        source,
        backfilled,
        latency_ms: latency,
      },
    });
  } catch (error) {
    logger.error('External ID lookup failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      entity_type,
      key,
    });

    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'External ID lookup failed',
      },
      500
    );
  }
});

app.openapi(resolveExternalIdRoute, async (c) => {
  const { provider, id } = c.req.valid('param');
  const { type } = c.req.valid('query');
  const sql = c.get('sql');
  const logger = c.get('logger');
  const startTime = Date.now();

  try {
    // Try crosswalk first (returns both our_key and confidence in one query)
    let result = await findByExternalId(sql, type, provider, id);

    // Lazy backfill fallback for editions (consistent with getExternalIds)
    if (!result && type === 'edition') {
      logger.info('Resolve: lazy backfilling external IDs', { provider, id });

      // Query enriched_editions for array columns to find potential ISBN
      // We need to search across array columns to find which ISBN has this external ID
      const editions = await sql<Array<{ isbn: string } & ArrayExternalIds>>`
        SELECT
          isbn,
          amazon_asins,
          google_books_volume_ids,
          goodreads_edition_ids,
          librarything_ids
        FROM enriched_editions
        WHERE
          (${provider} = 'amazon' AND ${id} = ANY(amazon_asins))
          OR (${provider} = 'google-books' AND ${id} = ANY(google_books_volume_ids))
          OR (${provider} = 'goodreads' AND ${id} = ANY(goodreads_edition_ids))
          OR (${provider} = 'librarything' AND ${id} = ANY(librarything_ids))
        LIMIT 1
      `;

      if (editions.length > 0 && editions[0]) {
        const isbn = editions[0].isbn;
        // Backfill crosswalk from array columns
        await backfillExternalIdsFromArrays(sql, isbn, editions[0], logger);

        // Re-query crosswalk
        result = await findByExternalId(sql, type, provider, id);
      }
    }

    if (!result) {
      logger.info('External ID not found', { provider, id, type });
      return c.json(
        {
          success: false,
          error: 'Not found',
        },
        404
      );
    }

    const latency = Date.now() - startTime;

    // Track analytics
    await c.env.ANALYTICS?.writeDataPoint({
      blobs: ['external_id_resolve', type, provider, id],
      doubles: [latency, 1], // 1 = found
      indexes: [provider],
    });

    logger.info('External ID resolved', {
      provider,
      provider_id: id,
      type,
      our_key: result.our_key,
      confidence: result.confidence,
      latency_ms: latency,
    });

    return c.json({
      success: true,
      data: {
        key: result.our_key,
        entity_type: type,
        confidence: result.confidence,
      },
    });
  } catch (error) {
    logger.error('External ID resolution failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      provider,
      id,
      type,
    });

    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'External ID resolution failed',
      },
      500
    );
  }
});

export default app;
