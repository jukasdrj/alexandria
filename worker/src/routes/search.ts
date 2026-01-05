import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import type { SqlClient, EditionSearchResult, DatabaseRow } from '../types/database.js';
import {
  SearchQuerySchema,
  SearchSuccessSchema,
  SearchErrorSchema,
} from '../schemas/search.js';
import {
  createSuccessResponse,
  createErrorResponse,
  ErrorCode,
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
// OpenLibrary Fallback Queries
// =================================================================================

/**
 * Fallback to OpenLibrary core tables when enriched tables return no results.
 * This ensures the 54M+ OpenLibrary editions are searchable, not just enriched ones.
 */
async function fallbackISBNSearch(sql: SqlClient, isbn: string): Promise<EditionSearchResult[]> {
  return sql`
    SELECT
      e.data->>'title' AS title,
      ei.isbn,
      e.data->>'publish_date' AS publish_date,
      e.data->>'publishers' AS publishers,
      (e.data->>'number_of_pages')::int AS pages,
      w.data->>'title' AS work_title,
      e.key AS edition_key,
      e.work_key,
      (CASE 
        WHEN e.data->'covers' IS NOT NULL AND jsonb_array_length(e.data->'covers') > 0 
        THEN 'https://covers.openlibrary.org/b/id/' || (e.data->'covers'->>0) || '-L.jpg' 
        ELSE NULL 
      END) AS cover_url,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'name', a.data->>'name',
            'key', a.key
          )
        ) FILTER (WHERE a.key IS NOT NULL),
        '[]'::json
      ) AS authors
    FROM edition_isbns ei
    JOIN editions e ON e.key = ei.edition_key
    LEFT JOIN works w ON w.key = e.work_key
    LEFT JOIN author_works aw ON aw.work_key = w.key
    LEFT JOIN authors a ON a.key = aw.author_key
    WHERE ei.isbn = ${isbn}
    GROUP BY e.key, ei.isbn, e.data, w.data, e.work_key
    LIMIT 1
  `;
}

async function fallbackTitleSearch(sql: SqlClient, title: string, limit: number, offset: number): Promise<{ total: number; results: EditionSearchResult[] }> {
  const titlePattern = `%${title}%`;

  const [countResult, dataResult] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS total
      FROM editions e
      WHERE e.data->>'title' ILIKE ${titlePattern}
    `,
    sql`
      SELECT
        e.data->>'title' AS title,
        (SELECT ei.isbn FROM edition_isbns ei WHERE ei.edition_key = e.key LIMIT 1) AS isbn,
        e.data->>'publish_date' AS publish_date,
        e.data->>'publishers' AS publishers,
        (e.data->>'number_of_pages')::int AS pages,
        w.data->>'title' AS work_title,
        e.key AS edition_key,
        e.work_key,
        (CASE 
          WHEN e.data->'covers' IS NOT NULL AND jsonb_array_length(e.data->'covers') > 0 
          THEN 'https://covers.openlibrary.org/b/id/' || (e.data->'covers'->>0) || '-L.jpg' 
          ELSE NULL 
        END) AS cover_url,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'name', a.data->>'name',
              'key', a.key
            )
          ) FILTER (WHERE a.key IS NOT NULL),
          '[]'::json
        ) AS authors
      FROM editions e
      LEFT JOIN works w ON w.key = e.work_key
      LEFT JOIN author_works aw ON aw.work_key = w.key
      LEFT JOIN authors a ON a.key = aw.author_key
      WHERE e.data->>'title' ILIKE ${titlePattern}
      GROUP BY e.key, e.data, w.data, e.work_key
      ORDER BY e.data->>'title'
      LIMIT ${limit}
      OFFSET ${offset}
    `
  ]);

  return { total: countResult[0]?.total || 0, results: dataResult };
}

async function fallbackAuthorSearch(sql: SqlClient, author: string, limit: number, offset: number): Promise<EditionSearchResult[]> {
  const authorPattern = `%${author}%`;

  const dataResult = await sql`
    WITH matching_editions AS (
      SELECT DISTINCT e.key AS edition_key
      FROM authors a
      JOIN author_works aw ON aw.author_key = a.key
      JOIN editions e ON e.work_key = aw.work_key
      WHERE a.data->>'name' ILIKE ${authorPattern}
      LIMIT ${limit + 1}
      OFFSET ${offset}
    )
    SELECT
      e.data->>'title' AS title,
      (SELECT ei.isbn FROM edition_isbns ei WHERE ei.edition_key = e.key LIMIT 1) AS isbn,
      e.data->>'publish_date' AS publish_date,
      e.data->>'publishers' AS publishers,
      (e.data->>'number_of_pages')::int AS pages,
      w.data->>'title' AS work_title,
      e.key AS edition_key,
      e.work_key,
      (CASE 
        WHEN e.data->'covers' IS NOT NULL AND jsonb_array_length(e.data->'covers') > 0 
        THEN 'https://covers.openlibrary.org/b/id/' || (e.data->'covers'->>0) || '-L.jpg' 
        ELSE NULL 
      END) AS cover_url,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'name', all_authors.data->>'name',
            'key', all_authors.key
          )
        ) FILTER (WHERE all_authors.key IS NOT NULL),
        '[]'::json
      ) AS authors
    FROM matching_editions me
    JOIN editions e ON e.key = me.edition_key
    LEFT JOIN works w ON w.key = e.work_key
    LEFT JOIN author_works all_aw ON all_aw.work_key = w.key
    LEFT JOIN authors all_authors ON all_authors.key = all_aw.author_key
    GROUP BY e.key, e.data, w.data, e.work_key
    ORDER BY e.data->>'title'
  `;

  return dataResult;
}

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

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
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
    let results: EditionSearchResult[] = [];
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
                'key', ea.author_key,
                'gender', ea.gender,
                'nationality', ea.nationality,
                'birth_year', ea.birth_year,
                'death_year', ea.death_year,
                'bio', ea.bio,
                'wikidata_id', ea.wikidata_id,
                'image', ea.author_photo_url
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

      results = dataResult as unknown as EditionSearchResult[];
      total = results.length;

      // Smart Resolution: Auto-fetch from external APIs on cache miss
      if (results.length === 0 && shouldResolveExternally(isbn, c.env)) {
        logger.info('Smart resolution triggered for ISBN', { isbn });

        const enrichedResult = await smartResolveISBN(isbn, sql, c.env, logger);

        if (enrichedResult) {
          logger.info('Smart resolution successful', { isbn });
          // Map SmartResolveResult to EditionSearchResult format
          results = [{
            edition_key: enrichedResult.openlibrary_edition?.replace('https://openlibrary.org', '') || '',
            isbn: enrichedResult.isbn,
            title: enrichedResult.title,
            author_names: enrichedResult.author ? [enrichedResult.author] : [],
            publish_date: enrichedResult.publish_date || undefined,
            publishers: enrichedResult.publishers?.join(', ') || undefined,
            pages: enrichedResult.pages || undefined,
            coverUrl: enrichedResult.coverUrl || undefined,
            work_title: enrichedResult.work_title
          }];
          total = 1;
        } else {
          logger.warn('Smart resolution failed - no external data found', { isbn });
        }
      }

      // Fallback to OpenLibrary core tables if still no results
      if (results.length === 0) {
        logger.info('Falling back to OpenLibrary core tables for ISBN', { isbn });
        const fallbackResults = await fallbackISBNSearch(sql as SqlClient, isbn);
        if (fallbackResults.length > 0) {
          logger.info('OpenLibrary fallback found result', { isbn });
          results = fallbackResults;
          total = 1;
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
            ee.cover_url_large,
            ee.cover_url_medium,
            ee.cover_url_small,
            ee.binding,
            ee.related_isbns,
            COALESCE(
              json_agg(
                json_build_object(
                  'name', ea.name,
                  'key', ea.author_key,
                  'gender', ea.gender,
                  'nationality', ea.nationality,
                  'birth_year', ea.birth_year,
                  'death_year', ea.death_year,
                  'bio', ea.bio,
                  'wikidata_id', ea.wikidata_id,
                  'image', ea.author_photo_url
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
                   ee.cover_url_medium, ee.cover_url_small, ee.binding, ee.related_isbns
          ORDER BY ee.title
          LIMIT ${limit}
          OFFSET ${offset}
        `
      ]);

      total = countResult[0]?.total || 0;
      results = dataResult as unknown as EditionSearchResult[];

      // Fallback to OpenLibrary core tables if no enriched results
      if (results.length === 0) {
        logger.info('Falling back to OpenLibrary core tables for title search', { title });
        const fallback = await fallbackTitleSearch(sql as SqlClient, title, limit, offset);
        if (fallback.results.length > 0) {
          logger.info('OpenLibrary fallback found results', { title, count: fallback.results.length });
          results = fallback.results;
          total = fallback.total;
        }
      }

    } else if (author) {
      // OPTIMIZED: Query enriched_authors with normalized_name for deduplication
      // Fallback to ILIKE on name if normalized_name not available
      const authorPattern = `%${author}%`;

      // Fetch limit+1 to check if more results exist without expensive COUNT
      const dataResult = await sql`
        WITH matching_editions AS (
          SELECT DISTINCT ee.isbn
          FROM enriched_authors ea
          JOIN work_authors_enriched wae ON wae.author_key = ea.author_key
          JOIN enriched_editions ee ON ee.work_key = wae.work_key
          WHERE (
            -- Use normalized_name for better deduplication if available
            CASE
              WHEN ea.normalized_name IS NOT NULL
              THEN ea.normalized_name = normalize_author_name(${author})
                   OR ea.normalized_name LIKE '%' || normalize_author_name(${author}) || '%'
              ELSE ea.name ILIKE ${authorPattern}
            END
          )
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
          ee.binding,
          ee.related_isbns,
          COALESCE(
            json_agg(
              json_build_object(
                'name', all_authors.name,
                'key', all_authors.author_key,
                'gender', all_authors.gender,
                'nationality', all_authors.nationality,
                'birth_year', all_authors.birth_year,
                'death_year', all_authors.death_year,
                'bio', all_authors.bio,
                'wikidata_id', all_authors.wikidata_id,
                'image', all_authors.author_photo_url
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
                 ee.cover_url_medium, ee.cover_url_small, ee.binding, ee.related_isbns
        ORDER BY ee.title
      `;

      // hasMore = got more than requested (the +1 extra row)
      const hasMoreResults = dataResult.length > limit;
      results = (hasMoreResults ? dataResult.slice(0, limit) : dataResult) as unknown as EditionSearchResult[];
      total = hasMoreResults ? offset + limit + 1 : offset + results.length;

      // Fallback to OpenLibrary core tables if no enriched results
      if (results.length === 0) {
        logger.info('Falling back to OpenLibrary core tables for author search', { author });
        const fallbackData = await fallbackAuthorSearch(sql as SqlClient, author, limit, offset);
        if (fallbackData.length > 0) {
          const fallbackHasMore = fallbackData.length > limit;
          results = fallbackHasMore ? fallbackData.slice(0, limit) : fallbackData;
          total = fallbackHasMore ? offset + limit + 1 : offset + results.length;
          logger.info('OpenLibrary fallback found results', { author, count: results.length });
        }
      }
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
      const coverUrl = row.cover_url_large || row.cover_url_medium || row.cover_url_small || row.cover_url || row.coverUrl || null;
      const authorsRaw = row.authors || [];
      const authors = (Array.isArray(authorsRaw) ? authorsRaw : [])
        .filter((a): a is DatabaseRow => typeof a === 'object' && a !== null)
        .map((a: DatabaseRow) => ({
        name: a.name,
        key: a.key,
        openlibrary: a.key ? `https://openlibrary.org${a.key}` : null,
        gender: a.gender,
        nationality: a.nationality,
        birth_year: a.birth_year,
        death_year: a.death_year,
        bio: a.bio,
        wikidata_id: a.wikidata_id,
        image: a.image,
      }));

      // Generate coverUrls object if ISBN is available
      const coverUrls = row.isbn ? {
        large: `https://alexandria.ooheynerds.com/covers/${row.isbn}/large`,
        medium: `https://alexandria.ooheynerds.com/covers/${row.isbn}/medium`,
        small: `https://alexandria.ooheynerds.com/covers/${row.isbn}/small`,
      } : null;

      return {
        title: row.title,
        authors,
        isbn: row.isbn,
        coverUrl,          // Legacy: direct URL
        coverUrls,         // Modern: size-specific URLs
        coverSource: coverUrl ? 'enriched-cached' as const : null,
        publish_date: row.publish_date,
        publishers: row.publishers,
        pages: row.pages,
        work_title: row.work_title,
        openlibrary_edition: row.edition_key ? `https://openlibrary.org${row.edition_key}` : null,

        openlibrary_work: row.work_key ? `https://openlibrary.org${row.work_key}` : null,
        binding: row.binding || null,
        related_isbns: row.related_isbns || null,
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
