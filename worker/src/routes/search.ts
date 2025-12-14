import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  SearchQuerySchema,
  SearchSuccessSchema,
  SearchErrorSchema,
  SearchDataSchema,
} from '../schemas/search.js';
import {
  createSuccessResponse,
  createErrorResponse,
  ErrorCode,
  buildMeta,
} from '../schemas/response.js';
import {
  generateCacheKey,
  getCachedResults,
  setCachedResults,
  isCacheEnabled,
  getCacheTTL,
} from '../../lib/cache-utils.js';
import { smartResolveISBN, shouldResolveExternally } from '../../services/smart-enrich.js';

// =================================================================================
// Search Route Definition
// =================================================================================

const searchRoute = createRoute({
  method: 'get',
  path: '/api/search',
  tags: ['Search'],
  summary: 'Search for books',
  description: 'Search for books by ISBN, title, or author. Supports Smart Resolution for ISBNs not found in the database.',
  request: {
    query: SearchQuerySchema,
  },
  responses: {
    200: {
      description: 'Search results',
      content: {
        'application/json': {
          schema: SearchSuccessSchema,
        },
      },
    },
    400: {
      description: 'Invalid request parameters',
      content: {
        'application/json': {
          schema: SearchErrorSchema,
        },
      },
    },
    500: {
      description: 'Database query failed',
      content: {
        'application/json': {
          schema: SearchErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handler
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(searchRoute, async (c) => {
  const { isbn: rawIsbn, title, author, nocache, limit, offset } = c.req.valid('query');
  const isbn = rawIsbn?.replace(/[^0-9X]/gi, '').toUpperCase();

  if (!isbn && !title && !author) {
    return createErrorResponse(
      c,
      ErrorCode.MISSING_PARAMETER,
      'Please provide one of: isbn, title, or author.'
    );
  }

  const logger = c.get('logger');
  const sql = c.get('sql');

  logger.debug('Search request received', { isbn, title, author, limit, offset, nocache });

  // Determine query type and generate cache key
  const queryType = isbn ? 'isbn' : title ? 'title' : 'author';
  const queryValue = isbn || title || author || '';
  const cacheKey = generateCacheKey(queryType, queryValue, limit, offset);

  // Try to get cached results (skip if nocache=true)
  if (isCacheEnabled(c.env) && !nocache) {
    const cached = await getCachedResults(c.env.CACHE, cacheKey);
    if (cached) {
      logger.info('Cache hit', { queryType, cacheKey });
      const cacheAgeSeconds = Math.floor((Date.now() - new Date(cached.cached_at).getTime()) / 1000);

      // Return cached results with envelope
      return createSuccessResponse(c, {
        query: cached.query,
        results: cached.results,
        pagination: cached.pagination,
        cache_hit: true,
        cache_age_seconds: cacheAgeSeconds,
      });
    }
  }

  try {
    let results: any[] = [];
    let total = 0;

    if (isbn) {
      // OPTIMIZED: Query enriched_editions table with indexed ISBN
      const dataResult = await sql`
        SELECT
          ee.title,
          ee.isbn,
          ee.publication_date AS publish_date,
          ee.publisher AS publishers,
          ee.page_count AS pages,
          ew.title AS work_title,
          ee.edition_key,
          ee.work_key,
          ee.cover_url_large,
          ee.cover_url_medium,
          ee.cover_url_small,
          COALESCE(
            json_agg(
              json_build_object(
                'name', ea.name,
                'key', ea.author_key
              )
              ORDER BY wae.author_order
            ) FILTER (WHERE ea.author_key IS NOT NULL),
            '[]'::json
          ) AS authors
        FROM enriched_editions ee
        LEFT JOIN enriched_works ew ON ew.key = ee.work_key
        LEFT JOIN work_authors_enriched wae ON wae.work_key = ee.work_key
        LEFT JOIN enriched_authors ea ON ea.author_key = wae.author_key
        WHERE ee.isbn = ${isbn}
        GROUP BY ee.isbn, ee.title, ee.publication_date, ee.publisher, ee.page_count,
                 ew.title, ee.edition_key, ee.work_key, ee.cover_url_large,
                 ee.cover_url_medium, ee.cover_url_small
        LIMIT 1
      `;

      results = dataResult;
      total = results.length;

      // Smart Resolution: Auto-fetch from external APIs on cache miss
      if (results.length === 0 && shouldResolveExternally(isbn, c.env)) {
        logger.info('Smart resolution triggered for ISBN', { isbn });

        const enrichedResult = await smartResolveISBN(isbn, sql, c.env);

        if (enrichedResult) {
          logger.info('Smart resolution successful', { isbn });
          results = [enrichedResult];
          total = 1;
        } else {
          logger.warn('Smart resolution failed - no external data found', { isbn });
        }
      }

    } else if (title) {
      // OPTIMIZED: Query enriched_editions with ILIKE for fast partial match
      const titlePattern = `%${title}%`;
      const [countResult, dataResult] = await Promise.all([
        sql`
          SELECT COUNT(*)::int AS total
          FROM enriched_editions
          WHERE title ILIKE ${titlePattern}
        `,
        sql`
          SELECT
            ee.title,
            ee.isbn,
            ee.publication_date AS publish_date,
            ee.publisher AS publishers,
            ee.page_count AS pages,
            ew.title AS work_title,
            ee.edition_key,
            ee.work_key,
            ee.cover_url_large,
            ee.cover_url_medium,
            ee.cover_url_small,
            COALESCE(
              json_agg(
                json_build_object(
                  'name', ea.name,
                  'key', ea.author_key
                )
                ORDER BY wae.author_order
              ) FILTER (WHERE ea.author_key IS NOT NULL),
              '[]'::json
            ) AS authors
          FROM enriched_editions ee
          LEFT JOIN enriched_works ew ON ew.work_key = ee.work_key
          LEFT JOIN work_authors_enriched wae ON wae.work_key = ee.work_key
          LEFT JOIN enriched_authors ea ON ea.author_key = wae.author_key
          WHERE ee.title ILIKE ${titlePattern}
          GROUP BY ee.isbn, ee.title, ee.publication_date, ee.publisher, ee.page_count,
                   ew.title, ee.edition_key, ee.work_key, ee.cover_url_large,
                   ee.cover_url_medium, ee.cover_url_small
          ORDER BY ee.title
          LIMIT ${limit}
          OFFSET ${offset}
        `
      ]);

      total = countResult[0]?.total || 0;
      results = dataResult;

    } else if (author) {
      // OPTIMIZED: Query enriched_authors with ILIKE for fast partial match
      const authorPattern = `%${author}%`;

      // Fetch limit+1 to check if more results exist without expensive COUNT
      const dataResult = await sql`
        WITH matching_editions AS (
          SELECT DISTINCT ee.isbn
          FROM enriched_authors ea
          JOIN work_authors_enriched wae ON wae.author_key = ea.author_key
          JOIN enriched_editions ee ON ee.work_key = wae.work_key
          WHERE ea.name ILIKE ${authorPattern}
          LIMIT ${limit + 1}
          OFFSET ${offset}
        )
        SELECT
          ee.title,
          ee.isbn,
          ee.publication_date AS publish_date,
          ee.publisher AS publishers,
          ee.page_count AS pages,
          ew.title AS work_title,
          ee.edition_key,
          ee.work_key,
          ee.cover_url_large,
          ee.cover_url_medium,
          ee.cover_url_small,
          COALESCE(
            json_agg(
              json_build_object(
                'name', all_authors.name,
                'key', all_authors.author_key
              )
              ORDER BY all_wae.author_order
            ) FILTER (WHERE all_authors.author_key IS NOT NULL),
            '[]'::json
          ) AS authors
        FROM matching_editions me
        JOIN enriched_editions ee ON ee.isbn = me.isbn
        LEFT JOIN enriched_works ew ON ew.work_key = ee.work_key
        LEFT JOIN work_authors_enriched all_wae ON all_wae.work_key = ee.work_key
        LEFT JOIN enriched_authors all_authors ON all_authors.author_key = all_wae.author_key
        GROUP BY ee.isbn, ee.title, ee.publication_date, ee.publisher, ee.page_count,
                 ew.title, ee.edition_key, ee.work_key, ee.cover_url_large,
                 ee.cover_url_medium, ee.cover_url_small
        ORDER BY ee.title
      `;

      // hasMore = got more than requested (the +1 extra row)
      const hasMoreResults = dataResult.length > limit;
      results = hasMoreResults ? dataResult.slice(0, limit) : dataResult;
      total = hasMoreResults ? offset + limit + 1 : offset + results.length;
    }

    // Log query performance
    const startTime = c.get('startTime') as number;
    const queryDuration = Date.now() - startTime;
    logger.query(queryType, queryDuration, {
      result_count: results.length,
      cache_hit: false
    });

    // Format results
    const formattedResults = results.map((row) => {
      const coverUrl = row.cover_url_large || row.cover_url_medium || row.cover_url_small || null;
      const authorsRaw = row.authors || [];
      const authors = (Array.isArray(authorsRaw) ? authorsRaw : []).map((a: { name: string; key: string }) => ({
        name: a.name,
        key: a.key,
        openlibrary: a.key ? `https://openlibrary.org${a.key}` : null,
      }));

      return {
        title: row.title,
        authors,
        isbn: row.isbn,
        coverUrl,
        coverSource: coverUrl ? 'enriched-cached' as const : null,
        publish_date: row.publish_date,
        publishers: row.publishers,
        pages: row.pages,
        work_title: row.work_title,
        openlibrary_edition: row.edition_key ? `https://openlibrary.org${row.edition_key}` : null,
        openlibrary_work: row.work_key ? `https://openlibrary.org${row.work_key}` : null,
      };
    });

    // Calculate pagination metadata
    const hasMore = offset + results.length < total;

    const searchData = {
      query: { isbn, title, author },
      results: formattedResults,
      pagination: {
        limit,
        offset,
        total,
        hasMore,
        returnedCount: formattedResults.length,
        ...(author && { totalEstimated: true })
      },
      cache_hit: false,
    };

    // Store in cache for future requests (async, non-blocking)
    if (isCacheEnabled(c.env)) {
      const ttl = getCacheTTL(queryType, c.env);
      c.executionCtx.waitUntil(
        setCachedResults(c.env.CACHE, cacheKey, { ...searchData, cached_at: new Date().toISOString() }, ttl)
      );
    }

    // Enhanced CDN caching
    const ttl = getCacheTTL(queryType, c.env);
    return createSuccessResponse(c, searchData, 200, {
      'Cache-Control': `public, max-age=${ttl}`,
      'CDN-Cache-Control': `public, max-age=${ttl}, stale-while-revalidate=600`,
      'Vary': 'Accept-Encoding'
    });

  } catch (e) {
    logger.error('Search query failed', {
      error: e instanceof Error ? e.message : String(e),
      queryType,
      isbn,
      title,
      author
    });

    return createErrorResponse(
      c,
      ErrorCode.DATABASE_ERROR,
      'Database query failed',
      { details: e instanceof Error ? e.message : 'Unknown error' }
    );
  }
});

export default app;
