import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  TopAuthorsQuerySchema,
  AuthorKeyParamSchema,
  BibliographyRequestSchema,
  EnrichBibliographyRequestSchema,
  EnrichWikidataRequestSchema,
  TopAuthorsResponseSchema,
  AuthorDetailsSchema,
  BibliographyResponseSchema,
  EnrichBibliographyResponseSchema,
  EnrichWikidataResponseSchema,
  EnrichStatusResponseSchema,
  AuthorErrorSchema,
} from '../schemas/authors.js';
import {
  getTopAuthors,
  getAuthorDetails,
  getAuthorBibliography,
  enrichAuthorBibliography,
  enrichWikidataAuthors,
  getEnrichmentStatus,
} from '../services/author-service.js';

// =================================================================================
// Route Definitions
// =================================================================================

const topAuthorsRoute = createRoute({
  method: 'get',
  path: '/api/authors/top',
  tags: ['Authors'],
  summary: 'Get top authors by work count',
  description: 'Returns top authors sorted by number of works. Excludes institutional/corporate authors. Results are cached for 24 hours.',
  request: {
    query: TopAuthorsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of top authors',
      content: {
        'application/json': {
          schema: TopAuthorsResponseSchema,
        },
      },
    },
    500: {
      description: 'Database query failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const authorDetailsRoute = createRoute({
  method: 'get',
  path: '/api/authors/:key',
  tags: ['Authors'],
  summary: 'Get author details by key',
  description: 'Get detailed author information including diversity data from Wikidata. Supports both formats: "OL7234434A" and "/authors/OL7234434A".',
  request: {
    params: AuthorKeyParamSchema,
  },
  responses: {
    200: {
      description: 'Author details',
      content: {
        'application/json': {
          schema: AuthorDetailsSchema,
        },
      },
    },
    404: {
      description: 'Author not found',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    500: {
      description: 'Database query failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const bibliographyRoute = createRoute({
  method: 'post',
  path: '/api/authors/bibliography',
  tags: ['Authors'],
  summary: 'Get author bibliography from ISBNdb',
  description: 'Fetch author bibliography from ISBNdb API. Returns list of books with ISBNs. Uses ISBNdb Premium endpoint (3 req/sec).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BibliographyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Author bibliography retrieved',
      content: {
        'application/json': {
          schema: BibliographyResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    429: {
      description: 'Rate limited by ISBNdb',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    500: {
      description: 'API error',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const enrichBibliographyRoute = createRoute({
  method: 'post',
  path: '/api/authors/enrich-bibliography',
  tags: ['Authors'],
  summary: 'Fetch and enrich author bibliography',
  description: 'Fetch author bibliography from ISBNdb AND directly enrich Alexandria database with metadata. 50-90% more efficient than separate fetch + enrich. Queues cover downloads for background processing.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichBibliographyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Bibliography fetched and enriched',
      content: {
        'application/json': {
          schema: EnrichBibliographyResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    429: {
      description: 'Rate limited by ISBNdb',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    500: {
      description: 'Enrichment failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const enrichWikidataRoute = createRoute({
  method: 'post',
  path: '/api/authors/enrich-wikidata',
  tags: ['Authors'],
  summary: 'Enrich authors from Wikidata',
  description: 'Enrich author diversity data (gender, nationality, birth/death info) from Wikidata. Processes authors that have wikidata_id but not yet enriched.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichWikidataRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Authors enriched from Wikidata',
      content: {
        'application/json': {
          schema: EnrichWikidataResponseSchema,
        },
      },
    },
    500: {
      description: 'Enrichment failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const enrichStatusRoute = createRoute({
  method: 'get',
  path: '/api/authors/enrich-status',
  tags: ['Authors'],
  summary: 'Get enrichment queue status',
  description: 'Get statistics on author enrichment progress: total authors, Wikidata coverage, diversity field coverage.',
  responses: {
    200: {
      description: 'Enrichment status',
      content: {
        'application/json': {
          schema: EnrichStatusResponseSchema,
        },
      },
    },
    500: {
      description: 'Status check failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

// GET /api/authors/top
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(topAuthorsRoute, async (c) => {
  const startTime = Date.now();

  try {
    const sql = c.get('sql');
    const params = c.req.valid('query');

    const result = await getTopAuthors({ sql, env: c.env }, params);

    return c.json({
      ...result,
      cached: false,
      query_duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    c.get('logger')?.error('Top authors query error', {
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to query top authors', message }, 500);
  }
});

// GET /api/authors/:key
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(authorDetailsRoute, async (c) => {
  const startTime = Date.now();

  try {
    const sql = c.get('sql');
    const params = c.req.valid('param');

    const result = await getAuthorDetails({ sql, env: c.env }, params);

    if (!result.success) {
      return c.json({
        error: result.error || 'Author not found',
        author_key: result.author_key
      }, 404);
    }

    return c.json({
      ...result.data,
      query_duration_ms: Date.now() - startTime
    });
  } catch (error) {
    c.get('logger')?.error('Author details error', { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to fetch author details', message }, 500);
  }
});

// POST /api/authors/bibliography
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(bibliographyRoute, async (c) => {
  try {
    const sql = c.get('sql');
    const logger = c.get('logger');
    const params = c.req.valid('json');

    const result = await getAuthorBibliography({ sql, env: c.env, logger }, params);

    if (!result.success) {
      const statusCode = result.error?.includes('Rate limited') ? 429 : 500;
      return c.json({ error: result.error }, statusCode);
    }

    return c.json(result.data);
  } catch (error) {
    c.get('logger')?.error('Author bibliography error', { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to fetch author bibliography', message }, 500);
  }
});

// POST /api/authors/enrich-bibliography
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(enrichBibliographyRoute, async (c) => {
  const startTime = Date.now();

  try {
    const sql = c.get('sql');
    const logger = c.get('logger');
    const params = c.req.valid('json');

    const result = await enrichAuthorBibliography({ sql, env: c.env, logger }, params);

    // Check if result is cached
    if (result.cached) {
      return c.json({
        ...result,
        duration_ms: Date.now() - startTime
      });
    }

    // Check for quota exhaustion
    if (result.quota_exhausted) {
      return c.json(result, 429);
    }

    return c.json(result);

  } catch (error) {
    c.get('logger')?.error('[EnrichBibliography] Error', { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      error: 'Failed to enrich author bibliography',
      message,
      quota_status: null,
      duration_ms: Date.now() - startTime
    }, 500);
  }
});

// POST /api/authors/enrich-wikidata
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(enrichWikidataRoute, async (c) => {
  const sql = c.get('sql');
  const logger = c.get('logger');

  try {
    const params = c.req.valid('json');
    const result = await enrichWikidataAuthors({ sql, env: c.env, logger }, params);

    if (!result.success) {
      return c.json({
        error: result.error || 'Enrichment failed',
        message: result.message
      }, 500);
    }

    return c.json(result.data);

  } catch (error) {
    logger?.error('Wikidata enrichment error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Enrichment failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/authors/enrich-status
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(enrichStatusRoute, async (c) => {
  const sql = c.get('sql');
  const logger = c.get('logger');

  try {
    const result = await getEnrichmentStatus({ sql, env: c.env, logger });

    if (!result.success) {
      return c.json({
        error: result.error || 'Status check failed',
        message: result.message
      }, 500);
    }

    return c.json(result.data);

  } catch (error) {
    logger?.error('Enrichment status error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Status check failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app;
