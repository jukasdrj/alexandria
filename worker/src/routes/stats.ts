import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';
import {
  createSuccessSchema,
  ErrorResponseSchema,
  createSuccessResponse,
  createErrorResponse,
  ErrorCode,
} from '../schemas/response.js';

// =================================================================================
// Stats Data Schemas
// =================================================================================

const EnrichedTableStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  last_1h: z.number().int().nonnegative(),
  last_24h: z.number().int().nonnegative(),
}).openapi('EnrichedTableStats');

const StatsDataSchema = z.object({
  // OpenLibrary core tables
  editions: z.number().int().nonnegative(),
  isbns: z.number().int().nonnegative(),
  works: z.number().int().nonnegative(),
  authors: z.number().int().nonnegative(),
  covers: z.number().int().nonnegative(),
  // Enriched tables with recent activity
  enriched: z.object({
    editions: EnrichedTableStatsSchema,
    works: EnrichedTableStatsSchema,
    authors: EnrichedTableStatsSchema,
  }),
}).openapi('StatsData');

// Success response with envelope
const StatsSuccessSchema = createSuccessSchema(StatsDataSchema, 'StatsSuccess');

// =================================================================================
// Stats Route Definition
// =================================================================================

const statsRoute = createRoute({
  method: 'get',
  path: '/api/stats',
  tags: ['System'],
  summary: 'Database statistics',
  description: 'Returns comprehensive database statistics including OpenLibrary core tables, enriched tables with recent activity counts, and R2 cover counts. Response is cached for 5 minutes.',
  responses: {
    200: {
      description: 'Database statistics retrieved successfully',
      content: {
        'application/json': {
          schema: StatsSuccessSchema,
        },
      },
      headers: z.object({
        'cache-control': z.string().openapi({
          example: 'public, max-age=300',
        }),
      }),
    },
    500: {
      description: 'Database query failed',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handler
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(statsRoute, async (c) => {
  try {
    const sql = c.get('sql');

    // OpenLibrary core tables + enriched tables + covers in parallel
    const [editions, isbns, works, authors, enrichedStats, coverCount] = await Promise.all([
      sql`SELECT count(*) FROM editions`.then(r => r[0].count),
      sql`SELECT count(*) FROM edition_isbns`.then(r => r[0].count),
      sql`SELECT count(*) FROM works`.then(r => r[0].count),
      sql`SELECT count(*) FROM authors`.then(r => r[0].count),
      // Enriched tables with recent activity counts
      sql`
        SELECT
          (SELECT COUNT(*) FROM enriched_editions) as enriched_editions,
          (SELECT COUNT(*) FROM enriched_editions WHERE updated_at > NOW() - INTERVAL '1 hour') as enriched_editions_1h,
          (SELECT COUNT(*) FROM enriched_editions WHERE updated_at > NOW() - INTERVAL '24 hours') as enriched_editions_24h,
          (SELECT COUNT(*) FROM enriched_works) as enriched_works,
          (SELECT COUNT(*) FROM enriched_works WHERE created_at > NOW() - INTERVAL '1 hour') as enriched_works_1h,
          (SELECT COUNT(*) FROM enriched_works WHERE created_at > NOW() - INTERVAL '24 hours') as enriched_works_24h,
          (SELECT COUNT(*) FROM enriched_authors) as enriched_authors,
          (SELECT COUNT(*) FROM enriched_authors WHERE created_at > NOW() - INTERVAL '1 hour') as enriched_authors_1h,
          (SELECT COUNT(*) FROM enriched_authors WHERE created_at > NOW() - INTERVAL '24 hours') as enriched_authors_24h
      `.then(r => r[0]),
      // Cover count from database (faster than R2 pagination)
      sql`SELECT COUNT(*) FROM enriched_editions WHERE cover_url_large IS NOT NULL`.then(r => r[0].count),
    ]);

    const statsData = {
      // OpenLibrary core tables
      editions: parseInt(editions, 10),
      isbns: parseInt(isbns, 10),
      works: parseInt(works, 10),
      authors: parseInt(authors, 10),
      covers: parseInt(coverCount, 10),
      // Enriched tables with recent activity
      enriched: {
        editions: {
          total: parseInt(enrichedStats.enriched_editions, 10),
          last_1h: parseInt(enrichedStats.enriched_editions_1h, 10),
          last_24h: parseInt(enrichedStats.enriched_editions_24h, 10),
        },
        works: {
          total: parseInt(enrichedStats.enriched_works, 10),
          last_1h: parseInt(enrichedStats.enriched_works_1h, 10),
          last_24h: parseInt(enrichedStats.enriched_works_24h, 10),
        },
        authors: {
          total: parseInt(enrichedStats.enriched_authors, 10),
          last_1h: parseInt(enrichedStats.enriched_authors_1h, 10),
          last_24h: parseInt(enrichedStats.enriched_authors_24h, 10),
        },
      },
    };

    return createSuccessResponse(c, statsData, 200, {
      'cache-control': 'public, max-age=300',
    });
  } catch (e) {
    const logger = c.get('logger');
    logger.error('Stats query error', { error: e instanceof Error ? e.message : 'Unknown' });

    return createErrorResponse(
      c,
      ErrorCode.DATABASE_ERROR,
      'Failed to retrieve database statistics',
      { details: e instanceof Error ? e.message : 'Unknown error' }
    );
  }
});

export default app;
