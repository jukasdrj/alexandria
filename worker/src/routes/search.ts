import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  SearchQuerySchema,
  SearchResponseSchema,
  SearchErrorSchema,
} from '../schemas/search.js';
import {
  generateCacheKey,
  getCachedResults,
  setCachedResults,
  isCacheEnabled,
  getCacheTTL,
} from '../../cache-utils.js';
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
          schema: SearchResponseSchema,
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
    return c.json({
      error: 'Missing query parameter',
      message: 'Please provide one of: isbn, title, or author.'
    }, 400);
  }

  const logger = c.get('logger');
  const sql = c.get('sql');
  const start = Date.now();

  logger.debug('Search request received', { isbn, title, author, limit, offset, nocache });

  // Determine query type and generate cache key
  const queryType = isbn ? 'isbn' : title ? 'title' : 'author';
  const queryValue = isbn || title || author || '';
  const cacheKey = generateCacheKey(queryType, queryValue, limit, offset);

  // Try to get cached results (skip if nocache=true)
  let cached = null;
  let cacheHit = false;
  if (isCacheEnabled(c.env) && !nocache) {
    cached = await getCachedResults(c.env.CACHE, cacheKey);
    if (cached) {
      cacheHit = true;
      logger.info('Cache hit', { queryType, cacheKey });
      // Return cached results with cache metadata
      // Note: query_duration_ms shows the ORIGINAL query time when cache was populated
      // This helps users understand the performance benefit of caching
      const cacheAgeSeconds = Math.floor((Date.now() - new Date(cached.cached_at).getTime()) / 1000);
      return c.json({
        ...cached,
        cache_hit: true,
        cache_age_seconds: cacheAgeSeconds,
        // Add original_query_duration_ms for clarity, keep query_duration_ms for backwards compat
        original_query_duration_ms: cached.query_duration_ms,
      });
    }
  }

  try {
    let results: any[] = [];
    let total = 0;

    if (isbn) {
      // ISBN validation is now handled by SearchQuerySchema in types.ts
      // OPTIMIZED: Query enriched_editions table with indexed ISBN
      // Performance: Direct primary key lookup (sub-millisecond)
      // NOTE: Skip COUNT query for ISBN - it's always 0 or 1 result (unique key)
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
        LEFT JOIN enriched_works ew ON ew.work_key = ee.work_key
        LEFT JOIN work_authors_enriched wae ON wae.work_key = ee.work_key
        LEFT JOIN enriched_authors ea ON ea.author_key = wae.author_key
        WHERE ee.isbn = ${isbn}
        GROUP BY ee.isbn, ee.title, ee.publication_date, ee.publisher, ee.page_count,
                 ew.title, ee.edition_key, ee.work_key, ee.cover_url_large,
                 ee.cover_url_medium, ee.cover_url_small
        LIMIT 1
      `;

      // ISBN is unique, so total = result count (0 or 1)
      results = dataResult;
      total = results.length;

      // =====================================================================
      // 🧠 SMART RESOLUTION: Auto-fetch from external APIs on cache miss
      // =====================================================================
      // If ISBN search found nothing AND smart resolution is enabled,
      // fetch from external providers and store in Alexandria DB
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
      // Performance: ~60-75ms with GIN trigram index (vs 18+ seconds with similarity operator)
      // ILIKE pattern matching is precise and leverages the GIN index efficiently
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
      // Performance: Skip COUNT query (expensive 3-way join), fetch data + 1 extra for hasMore detection
      // ILIKE pattern matching uses GIN trigram index efficiently
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
      // Estimate total: if hasMore, we don't know exact count; use offset + results + 1
      // This is intentionally an estimate for performance reasons
      total = hasMoreResults ? offset + limit + 1 : offset + results.length;
    }

    const queryDuration = Date.now() - start;

    // Log query performance
    logger.query(queryType, queryDuration, {
      result_count: results.length,
      cache_hit: false
    });

    // Format results - enriched tables already have cover URLs
    const formattedResults = results.map((row) => {
      // Use pre-cached cover URLs from enriched_editions (already in R2 or external)
      const coverUrl = row.cover_url_large || row.cover_url_medium || row.cover_url_small || null;

      // Parse authors array from JSON aggregation (handles both JSON objects and pre-parsed arrays)
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
        coverSource: coverUrl ? 'enriched-cached' : null,
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

    const response = {
      query: { isbn, title, author },
      query_duration_ms: queryDuration,
      results: formattedResults,
      pagination: {
        limit,
        offset,
        total,
        hasMore,
        returnedCount: formattedResults.length,
        // Author queries use estimated totals for performance (skip expensive COUNT)
        ...(author && { totalEstimated: true })
      },
      cache_hit: false,
    };

    // Store in cache for future requests (async, non-blocking)
    if (isCacheEnabled(c.env)) {
      const ttl = getCacheTTL(queryType, c.env);
      c.executionCtx.waitUntil(
        setCachedResults(c.env.CACHE, cacheKey, response, ttl)
      );
    }

    // Enhanced CDN caching with stale-while-revalidate for better performance
    const ttl = getCacheTTL(queryType, c.env);
    return c.json(response, 200, {
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
    return c.json({
      error: 'Database query failed',
      message: e instanceof Error ? e.message : 'Unknown error'
    }, 500);
  }
});

export default app;
