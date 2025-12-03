import postgres from 'postgres';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { cache } from 'hono/cache';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { handleEnrichEdition, handleEnrichWork, handleEnrichAuthor, handleQueueEnrichment, handleGetEnrichmentStatus } from './enrich-handlers.js';
import { processCoverImage, processCoverBatch, coverExists, getCoverMetadata, getPlaceholderCover } from './services/image-processor.js';
import { resolveCoverUrl, extractOpenLibraryCover } from './services/cover-resolver.js';
import { handleProcessCover, handleServeCover } from './cover-handlers.js';
import { processEnrichmentQueue } from './queue-consumer.js';
import { processCoverQueue, processEnrichmentQueue as processEnrichmentQueueBatch } from './queue-handlers.js';
import { errorHandler } from './middleware/error-handler.js';
import type { Env, Variables } from './env.d.js';
import { openAPISpec } from './openapi.js';
import { getDashboardHTML } from './dashboard.js';
import { smartResolveISBN, shouldResolveExternally } from './services/smart-enrich.js';
import {
  testAllISBNdbEndpoints,
  testISBNdbBook,
  testISBNdbBooksSearch,
  testISBNdbAuthor,
  testISBNdbAuthorsSearch,
  testISBNdbPublisher,
  testISBNdbSubject,
  testISBNdbBatchBooks
} from './services/isbndb-test.js';

// =================================================================================
// Configuration & Initialization
// =================================================================================

// =================================================================================
// Zod Validation Schemas for RPC Type Safety
// =================================================================================
// NOTE: All schemas align with OpenAPI spec required fields (see openAPISpec below)
// - EnrichEdition: required ['isbn', 'primary_provider']
// - EnrichWork: required ['work_key', 'title', 'primary_provider']
// - EnrichAuthor: required ['author_key', 'name', 'primary_provider']
// - QueueEnrichment: required ['entity_type', 'entity_key', 'providers_to_try']

// Search endpoint query parameters with pagination
const SearchQuerySchema = z.object({
  isbn: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  limit: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 10;
    // Default 10, min 1, max 100
    return Math.max(1, Math.min(100, parsed));
  }),
  offset: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 0;
    // Default 0, min 0
    return Math.max(0, parsed);
  }),
});

// Combined search query parameters (issue #41)
const CombinedSearchQuerySchema = z.object({
  q: z.string().min(1, 'Query parameter "q" is required'),
  limit: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 10;
    return Math.max(1, Math.min(100, parsed));
  }),
  offset: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 0;
    return Math.max(0, parsed);
  }),
});

// Cover batch processing
const CoverBatchSchema = z.object({
  isbns: z.array(z.string()).min(1).max(10),
});

// Process cover from provider URL
const ProcessCoverSchema = z.object({
  work_key: z.string(),
  provider_url: z.string().url(),
  isbn: z.string().optional(),
});

// Enrich edition schema
const EnrichEditionSchema = z.object({
  isbn: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  publisher: z.string().optional(),
  publication_date: z.string().optional(),
  page_count: z.number().optional(),
  format: z.string().optional(),
  language: z.string().optional(),
  primary_provider: z.enum(['isbndb', 'google-books', 'openlibrary', 'user-correction']),
  cover_urls: z.object({
    large: z.string().optional(),
    medium: z.string().optional(),
    small: z.string().optional(),
  }).optional(),
  cover_source: z.string().optional(),
  work_key: z.string().optional(),
  openlibrary_edition_id: z.string().optional(),
  amazon_asins: z.array(z.string()).optional(),
  google_books_volume_ids: z.array(z.string()).optional(),
  goodreads_edition_ids: z.array(z.string()).optional(),
  alternate_isbns: z.array(z.string()).optional(),
});

// Enrich work schema
const EnrichWorkSchema = z.object({
  work_key: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  original_language: z.string().optional(),
  first_publication_year: z.number().optional(),
  subject_tags: z.array(z.string()).optional(),
  primary_provider: z.enum(['isbndb', 'google-books', 'openlibrary']),
  cover_urls: z.object({
    large: z.string().optional(),
    medium: z.string().optional(),
    small: z.string().optional(),
  }).optional(),
  cover_source: z.string().optional(),
  openlibrary_work_id: z.string().optional(),
  goodreads_work_ids: z.array(z.string()).optional(),
  amazon_asins: z.array(z.string()).optional(),
  google_books_volume_ids: z.array(z.string()).optional(),
});

// Enrich author schema
const EnrichAuthorSchema = z.object({
  author_key: z.string(),
  name: z.string(),
  gender: z.string().optional(),
  nationality: z.string().optional(),
  birth_year: z.number().optional(),
  death_year: z.number().optional(),
  bio: z.string().optional(),
  bio_source: z.string().optional(),
  author_photo_url: z.string().optional(),
  primary_provider: z.enum(['isbndb', 'openlibrary', 'wikidata']),
  openlibrary_author_id: z.string().optional(),
  goodreads_author_ids: z.array(z.string()).optional(),
  wikidata_id: z.string().optional(),
});

// Queue enrichment schema
const QueueEnrichmentSchema = z.object({
  entity_type: z.enum(['work', 'edition', 'author']),
  entity_key: z.string(),
  providers_to_try: z.array(z.string()),
  priority: z.number().min(1).max(10).default(5),
});

// Instantiate the Hono app with typed environment and variables
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// =================================================================================
// Middleware
// =================================================================================

// Global middleware
app.use('*', cors());
app.use('*', secureHeaders());

// Global error handler - consistent JSON responses for bendv3 integration
app.onError(errorHandler);

// Database initialization middleware
app.use('*', async (c, next) => {
  // Create a fresh postgres client for each request to avoid I/O context issues
  const sql = postgres(c.env.HYPERDRIVE.connectionString, {
    max: 1,  // Single connection per request, Hyperdrive handles pooling
    fetch_types: false,
    prepare: false
  });
  c.set('sql', sql);
  c.set('startTime', Date.now());
  await next();
});

// =================================================================================
// Route Handlers
// =================================================================================

// GET / -> Serve the interactive dashboard
app.get('/', (c) => {
  return c.html(getDashboardHTML(), 200, {
    'cache-control': 'public, max-age=3600',
  });
});

// GET /openapi.json
app.get('/openapi.json', (c) => {
  return c.json(openAPISpec, 200, {
    'cache-control': 'public, max-age=3600'
  });
});

// GET /health -> System health check
app.get('/health', async (c) => {
  try {
    const sql = c.get('sql');
    const start = Date.now();
    await sql`SELECT 1`;
    const latency = Date.now() - start;
    
    // Check R2 binding
    const r2Status = c.env.COVER_IMAGES ? 'bound' : 'not_configured';
    
    return c.json({
      status: 'ok',
      database: 'connected',
      r2_covers: r2Status,
      hyperdrive_latency_ms: latency,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Health check DB error:', e);
    return c.json({
      status: 'error',
      database: 'disconnected',
      r2_covers: c.env.COVER_IMAGES ? 'bound' : 'not_configured',
      message: e instanceof Error ? e.message : 'Unknown error'
    }, 503);
  }
});

// GET /api/stats -> Get database statistics
app.get('/api/stats',
  cache({ cacheName: 'alexandria-cache', cacheControl: 'public, max-age=86400' }),
  async (c) => {
    try {
      const sql = c.get('sql');
      const start = Date.now();
      const [editions, isbns, works, authors] = await Promise.all([
        sql`SELECT count(*) FROM editions`.then(r => r[0].count),
        sql`SELECT count(*) FROM edition_isbns`.then(r => r[0].count),
        sql`SELECT count(*) FROM works`.then(r => r[0].count),
        sql`SELECT count(*) FROM authors`.then(r => r[0].count),
      ]);
      const queryDuration = Date.now() - start;

      const stats = {
        editions: parseInt(editions, 10),
        isbns: parseInt(isbns, 10),
        works: parseInt(works, 10),
        authors: parseInt(authors, 10),
        query_duration_ms: queryDuration,
      };

      return c.json(stats, 200, {
        'cache-control': 'public, max-age=86400'
      });
    } catch (e) {
      console.error('Stats query error:', e);
      return c.json({
        error: 'Database query failed',
        message: e instanceof Error ? e.message : 'Unknown error'
      }, 500);
    }
  }
);

// POST /api/enrich/edition -> Store or update edition metadata
app.post('/api/enrich/edition', handleEnrichEdition);

// POST /api/enrich/work -> Store or update work metadata
app.post('/api/enrich/work', handleEnrichWork);

// POST /api/enrich/author -> Store or update author biographical data
app.post('/api/enrich/author', handleEnrichAuthor);

// POST /api/enrich/queue -> Queue background enrichment job
app.post('/api/enrich/queue', handleQueueEnrichment);

// GET /api/enrich/status/:id -> Check enrichment job status
app.get('/api/enrich/status/:id', handleGetEnrichmentStatus);

// GET /api/search -> Main search endpoint (with Zod validation for RPC type safety)
app.get('/api/search',
  zValidator('query', SearchQuerySchema),
  cache({ cacheName: 'alexandria-cache', cacheControl: 'public, max-age=86400' }),
  async (c) => {
    const { isbn: rawIsbn, title, author, limit, offset } = c.req.valid('query');
    const isbn = rawIsbn?.replace(/[^0-9X]/gi, '').toUpperCase();

    if (!isbn && !title && !author) {
      return c.json({
        error: 'Missing query parameter',
        message: 'Please provide one of: isbn, title, or author.'
      }, 400);
    }

    const sql = c.get('sql');
    const start = Date.now();
    try {
      let results: any[] = [];
      let total = 0;

      if (isbn) {
        if (isbn.length !== 10 && isbn.length !== 13) {
          return c.json({
            error: 'Invalid ISBN format',
            provided: c.req.query('isbn')
          }, 400);
        }

        // ISBN queries should be exact - count and fetch in parallel
        const [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(DISTINCT e.key)::int AS total
            FROM editions e
            JOIN edition_isbns ei ON ei.edition_key = e.key
            WHERE ei.isbn = ${isbn}
          `,
          sql`
            SELECT
              e.data->>'title' AS title,
              a.data->>'name' AS author,
              ei.isbn,
              e.data->>'publish_date' AS publish_date,
              e.data->>'publishers' AS publishers,
              e.data->>'number_of_pages' AS pages,
              w.data->>'title' AS work_title,
              e.key AS edition_key,
              w.key AS work_key,
              (e.data->'covers'->0)::text AS cover_id
            FROM editions e
            JOIN edition_isbns ei ON ei.edition_key = e.key
            LEFT JOIN works w ON w.key = e.work_key
            LEFT JOIN author_works aw ON aw.work_key = w.key
            LEFT JOIN authors a ON aw.author_key = a.key
            WHERE ei.isbn = ${isbn}
            LIMIT ${limit}
            OFFSET ${offset}
          `
        ]);

        total = countResult[0]?.total || 0;
        results = dataResult;

        // =====================================================================
        // 🧠 SMART RESOLUTION: Auto-fetch from external APIs on cache miss
        // =====================================================================
        // If ISBN search found nothing AND smart resolution is enabled,
        // fetch from external providers and store in Alexandria DB
        if (results.length === 0 && shouldResolveExternally(isbn, c.env)) {
          console.log(`[Smart Resolve] Cache miss for ISBN ${isbn}, resolving externally...`);

          const enrichedResult = await smartResolveISBN(isbn, sql, c.env);

          if (enrichedResult) {
            console.log(`[Smart Resolve] ✓ Successfully enriched ISBN ${isbn}`);
            results = [enrichedResult];
            total = 1;
          } else {
            console.log(`[Smart Resolve] ✗ No external data found for ISBN ${isbn}`);
          }
        }

      } else if (title) {
        // For title searches, use a subquery with DISTINCT to get accurate counts
        // NOTE: ILIKE can be slow. For production, consider pg_trgm with GIN/GIST indexes.
        const [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(*)::int AS total
            FROM (
              SELECT DISTINCT e.key
              FROM editions e
              WHERE e.data->>'title' ILIKE ${'%' + title + '%'}
            ) AS unique_editions
          `,
          sql`
            SELECT DISTINCT ON (e.key)
              e.data->>'title' AS title,
              a.data->>'name' AS author,
              ei.isbn,
              e.data->>'publish_date' AS publish_date,
              e.data->>'publishers' AS publishers,
              e.data->>'number_of_pages' AS pages,
              w.data->>'title' AS work_title,
              e.key AS edition_key,
              w.key AS work_key,
              (e.data->'covers'->0)::text AS cover_id
            FROM editions e
            LEFT JOIN edition_isbns ei ON ei.edition_key = e.key
            LEFT JOIN works w ON w.key = e.work_key
            LEFT JOIN author_works aw ON aw.work_key = w.key
            LEFT JOIN authors a ON aw.author_key = a.key
            WHERE e.data->>'title' ILIKE ${'%' + title + '%'}
            ORDER BY e.key
            LIMIT ${limit}
            OFFSET ${offset}
          `
        ]);

        total = countResult[0]?.total || 0;
        results = dataResult;

      } else if (author) {
        // For author searches, count unique editions
        const [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(*)::int AS total
            FROM (
              SELECT DISTINCT e.key
              FROM authors a
              JOIN author_works aw ON aw.author_key = a.key
              JOIN works w ON w.key = aw.work_key
              JOIN editions e ON e.work_key = w.key
              WHERE a.data->>'name' ILIKE ${'%' + author + '%'}
            ) AS unique_editions
          `,
          sql`
            SELECT DISTINCT ON (e.key)
              e.data->>'title' AS title,
              a.data->>'name' AS author,
              ei.isbn,
              e.data->>'publish_date' AS publish_date,
              e.data->>'publishers' AS publishers,
              e.data->>'number_of_pages' AS pages,
              w.data->>'title' AS work_title,
              e.key AS edition_key,
              w.key AS work_key,
              (e.data->'covers'->0)::text AS cover_id
            FROM authors a
            JOIN author_works aw ON aw.author_key = a.key
            JOIN works w ON w.key = aw.work_key
            JOIN editions e ON e.work_key = w.key
            LEFT JOIN edition_isbns ei ON ei.edition_key = e.key
            WHERE a.data->>'name' ILIKE ${'%' + author + '%'}
            ORDER BY e.key
            LIMIT ${limit}
            OFFSET ${offset}
          `
        ]);

        total = countResult[0]?.total || 0;
        results = dataResult;
      }

      const queryDuration = Date.now() - start;

      // Resolve cover URLs with lazy-loading (R2 cache or external)
      const formattedResults = await Promise.all(results.map(async (row) => {
        // Build external OpenLibrary cover URL from cover_id
        let externalCoverUrl = null;
        if (row.cover_id) {
          const coverId = row.cover_id.replace(/"/g, ''); // Remove JSON quotes
          if (coverId && coverId !== 'null') {
            externalCoverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
          }
        }
        
        // Resolve cover URL (Alexandria R2 if cached, external if not)
        let coverUrl = null;
        let coverSource = null;
        if (row.isbn) {
          try {
            const coverResult = await resolveCoverUrl(row.isbn, externalCoverUrl, c.env, c.executionCtx);
            coverUrl = coverResult.url;
            coverSource = coverResult.source;
          } catch (e) {
            console.error(`Cover resolve failed for ${row.isbn}:`, e instanceof Error ? e.message : String(e));
            coverUrl = externalCoverUrl; // Fallback
            coverSource = 'external-fallback';
          }
        }
        
        return {
          title: row.title,
          author: row.author,
          isbn: row.isbn,
          coverUrl,
          coverSource,
          publish_date: row.publish_date,
          publishers: row.publishers ? JSON.parse(row.publishers) : null,
          pages: row.pages,
          work_title: row.work_title,
          openlibrary_edition: row.edition_key ? `https://openlibrary.org${row.edition_key}` : null,
          openlibrary_work: row.work_key ? `https://openlibrary.org${row.work_key}` : null,
        };
      }));

      // Calculate pagination metadata
      const hasMore = offset + results.length < total;

      return c.json({
        query: { isbn, title, author },
        query_duration_ms: queryDuration,
        results: formattedResults,
        pagination: {
          limit,
          offset,
          total,
          hasMore,
          returnedCount: formattedResults.length
        }
      }, 200, {
        'cache-control': 'public, max-age=86400'
      });

    } catch (e) {
      console.error('Search query error:', e);
      return c.json({
        error: 'Database query failed',
        message: e instanceof Error ? e.message : 'Unknown error'
      }, 500);
    }
  }
);

// GET /api/search/combined -> Combined search endpoint (issue #41)
// Intelligently searches across ISBN, title, and author based on query pattern
app.get('/api/search/combined',
  zValidator('query', CombinedSearchQuerySchema),
  cache({ cacheName: 'alexandria-cache', cacheControl: 'public, max-age=86400' }),
  async (c) => {
    const { q: rawQuery, limit, offset } = c.req.valid('query');

    // Sanitize and normalize query
    const query = rawQuery.trim();

    // Detect if query looks like an ISBN (10 or 13 digits, possibly with X)
    const isbnPattern = /^[0-9X\-\s]{10,17}$/i;
    const isISBNLike = isbnPattern.test(query);

    const sql = c.get('sql');
    const start = Date.now();

    try {
      let results: any[] = [];
      let total = 0;
      let searchType: string;

      if (isISBNLike) {
        // Normalize ISBN (remove hyphens, spaces, uppercase)
        const isbn = query.replace(/[^0-9X]/gi, '').toUpperCase();

        // Validate ISBN length
        if (isbn.length !== 10 && isbn.length !== 13) {
          return c.json({
            error: 'Invalid ISBN format',
            message: 'ISBN must be 10 or 13 characters',
            provided: query
          }, 400);
        }

        searchType = 'isbn';

        // Search by ISBN with count (indexed, fast lookup)
        const [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(DISTINCT e.key)::int AS total
            FROM editions e
            JOIN edition_isbns ei ON ei.edition_key = e.key
            WHERE ei.isbn = ${isbn}
          `,
          sql`
            SELECT
              e.data->>'title' AS title,
              a.data->>'name' AS author,
              ei.isbn,
              e.data->>'publish_date' AS publish_date,
              e.data->>'publishers' AS publishers,
              e.data->>'number_of_pages' AS pages,
              w.data->>'title' AS work_title,
              e.key AS edition_key,
              w.key AS work_key,
              a.key AS author_key,
              (e.data->'covers'->0)::text AS cover_id,
              'edition' AS result_type
            FROM editions e
            JOIN edition_isbns ei ON ei.edition_key = e.key
            LEFT JOIN works w ON w.key = e.work_key
            LEFT JOIN author_works aw ON aw.work_key = w.key
            LEFT JOIN authors a ON aw.author_key = a.key
            WHERE ei.isbn = ${isbn}
            LIMIT ${limit}
            OFFSET ${offset}
          `
        ]);

        total = countResult[0]?.total || 0;
        results = dataResult;

        // =====================================================================
        // 🧠 SMART RESOLUTION: Auto-fetch from external APIs on cache miss
        // =====================================================================
        // If ISBN search found nothing, try external providers
        if (results.length === 0 && shouldResolveExternally(isbn, c.env)) {
          console.log(`[Smart Resolve] Cache miss for ISBN ${isbn}, resolving externally...`);

          const enrichedResult = await smartResolveISBN(isbn, sql, c.env);

          if (enrichedResult) {
            console.log(`[Smart Resolve] ✓ Successfully enriched ISBN ${isbn}`);
            // Add result_type and author_key for combined search format
            results = [{
              ...enrichedResult,
              result_type: 'edition',
              author_key: null,
            }];
            total = 1;
          } else {
            console.log(`[Smart Resolve] ✗ No external data found for ISBN ${isbn}`);
          }
        }

      } else {
        // Text search: search both titles and authors simultaneously
        searchType = 'text';

        // Search pattern for ILIKE (uses GIN trigram indexes)
        const searchPattern = `%${query}%`;

        // For text searches, we need to get total count of unique editions
        // across both title and author searches. This is complex, so we'll
        // fetch more results and dedupe, then provide estimated total.
        // Note: For exact totals, we'd need a UNION query with COUNT which is expensive.

        // Parallel search: titles and authors
        const [titleCountResult, authorCountResult, titleResults, authorResults] = await Promise.all([
          // Count title matches
          sql`
            SELECT COUNT(*)::int AS total
            FROM (
              SELECT DISTINCT e.key
              FROM editions e
              WHERE e.data->>'title' ILIKE ${searchPattern}
            ) AS unique_editions
          `,
          // Count author matches
          sql`
            SELECT COUNT(*)::int AS total
            FROM (
              SELECT DISTINCT e.key
              FROM authors a
              JOIN author_works aw ON aw.author_key = a.key
              JOIN works w ON w.key = aw.work_key
              JOIN editions e ON e.work_key = w.key
              WHERE a.data->>'name' ILIKE ${searchPattern}
            ) AS unique_editions
          `,
          // Search editions by title
          sql`
            SELECT DISTINCT ON (e.key)
              e.data->>'title' AS title,
              a.data->>'name' AS author,
              ei.isbn,
              e.data->>'publish_date' AS publish_date,
              e.data->>'publishers' AS publishers,
              e.data->>'number_of_pages' AS pages,
              w.data->>'title' AS work_title,
              e.key AS edition_key,
              w.key AS work_key,
              a.key AS author_key,
              (e.data->'covers'->0)::text AS cover_id,
              'edition' AS result_type
            FROM editions e
            LEFT JOIN edition_isbns ei ON ei.edition_key = e.key
            LEFT JOIN works w ON w.key = e.work_key
            LEFT JOIN author_works aw ON aw.work_key = w.key
            LEFT JOIN authors a ON aw.author_key = a.key
            WHERE e.data->>'title' ILIKE ${searchPattern}
            ORDER BY e.key
            LIMIT ${limit + 50}
            OFFSET ${offset}
          `,
          // Search authors by name
          sql`
            SELECT DISTINCT ON (e.key)
              e.data->>'title' AS title,
              a.data->>'name' AS author,
              ei.isbn,
              e.data->>'publish_date' AS publish_date,
              e.data->>'publishers' AS publishers,
              e.data->>'number_of_pages' AS pages,
              w.data->>'title' AS work_title,
              e.key AS edition_key,
              w.key AS work_key,
              a.key AS author_key,
              (e.data->'covers'->0)::text AS cover_id,
              'edition' AS result_type
            FROM authors a
            JOIN author_works aw ON aw.author_key = a.key
            JOIN works w ON w.key = aw.work_key
            JOIN editions e ON e.work_key = w.key
            LEFT JOIN edition_isbns ei ON ei.edition_key = e.key
            WHERE a.data->>'name' ILIKE ${searchPattern}
            ORDER BY e.key
            LIMIT ${limit + 50}
            OFFSET ${offset}
          `
        ]);

        // Combine and deduplicate results (by edition_key)
        const combinedMap = new Map();
        [...titleResults, ...authorResults].forEach(row => {
          if (row.edition_key && !combinedMap.has(row.edition_key)) {
            combinedMap.set(row.edition_key, row);
          }
        });

        results = Array.from(combinedMap.values()).slice(0, limit);

        // Total is approximated as sum of both counts (may have overlap, but good estimate)
        // For precise total, we'd need UNION which is more expensive
        const titleTotal = titleCountResult[0]?.total || 0;
        const authorTotal = authorCountResult[0]?.total || 0;
        total = titleTotal + authorTotal; // Estimated (may count some editions twice)
      }

      const queryDuration = Date.now() - start;

      if (results.length === 0) {
        return c.json({
          error: 'Not Found',
          query: query,
          search_type: searchType,
          message: 'No results found'
        }, 404);
      }

      // Resolve cover URLs with lazy-loading (R2 cache or external)
      const formattedResults = await Promise.all(results.map(async (row) => {
        // Build external OpenLibrary cover URL from cover_id
        let externalCoverUrl = null;
        if (row.cover_id) {
          const coverId = row.cover_id.replace(/"/g, ''); // Remove JSON quotes
          if (coverId && coverId !== 'null') {
            externalCoverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
          }
        }

        // Resolve cover URL (Alexandria R2 if cached, external if not)
        let coverUrl = null;
        let coverSource = null;
        if (row.isbn) {
          try {
            const coverResult = await resolveCoverUrl(row.isbn, externalCoverUrl, c.env, c.executionCtx);
            coverUrl = coverResult.url;
            coverSource = coverResult.source;
          } catch (e) {
            console.error(`Cover resolve failed for ${row.isbn}:`, e instanceof Error ? e.message : String(e));
            coverUrl = externalCoverUrl; // Fallback
            coverSource = 'external-fallback';
          }
        }

        return {
          type: row.result_type,
          title: row.title,
          author: row.author,
          isbn: row.isbn,
          coverUrl,
          coverSource,
          publish_date: row.publish_date,
          publishers: row.publishers ? JSON.parse(row.publishers) : null,
          pages: row.pages,
          work_title: row.work_title,
          openlibrary_edition: row.edition_key ? `https://openlibrary.org${row.edition_key}` : null,
          openlibrary_work: row.work_key ? `https://openlibrary.org${row.work_key}` : null,
          openlibrary_author: row.author_key ? `https://openlibrary.org${row.author_key}` : null,
        };
      }));

      // Calculate pagination metadata
      const hasMore = offset + results.length < total;

      return c.json({
        query: query,
        search_type: searchType,
        query_duration_ms: queryDuration,
        results: formattedResults,
        pagination: {
          limit,
          offset,
          total,
          hasMore,
          returnedCount: formattedResults.length,
          // Note for text searches: total is estimated (sum of title + author matches, may have overlap)
          ...(searchType === 'text' && { totalEstimated: true })
        }
      }, 200, {
        'cache-control': 'public, max-age=86400'
      });

    } catch (e) {
      console.error('Combined search query error:', e);
      return c.json({
        error: 'Database query failed',
        message: e instanceof Error ? e.message : 'Unknown error'
      }, 500);
    }
  }
);

// =================================================================================
// Cover Image Routes (Work-based - bookstrack-covers-processed bucket)
// =================================================================================

// POST /api/covers/process - Process cover image from provider URL (with Zod validation)
app.post('/api/covers/process',
  zValidator('json', ProcessCoverSchema),
  handleProcessCover
);

// GET /api/covers/:work_key/:size - Serve processed cover by work key
app.get('/api/covers/:work_key/:size', handleServeCover);

// =================================================================================
// Cover Image Routes (ISBN-based - legacy)
// =================================================================================

// GET /covers/:isbn/:size - Serve cover image from R2
// MVP: Currently serves original for all sizes. On-demand resizing via CF Images
// can be added later, or pre-generated sizes stored in R2.
app.get('/covers/:isbn/:size', async (c) => {
  const { isbn, size } = c.req.param();

  // Validate size parameter (accepted for future compatibility)
  const validSizes = ['small', 'medium', 'large', 'original'];
  if (!validSizes.includes(size)) {
    return c.json({
      error: 'Invalid size',
      message: 'Size must be one of: small, medium, large, original'
    }, 400);
  }

  // Normalize ISBN
  const normalizedISBN = isbn.replace(/[-\s]/g, '');
  if (!/^[0-9]{10,13}X?$/i.test(normalizedISBN)) {
    return c.json({ error: 'Invalid ISBN format' }, 400);
  }

  try {
    // MVP: We only store original - try common extensions
    // Future: Add pre-generated sizes or use CF Image Resizing
    const extensions = ['jpg', 'png', 'webp'];
    let object = null;

    for (const ext of extensions) {
      const key = `isbn/${normalizedISBN}/original.${ext}`;
      object = await c.env.COVER_IMAGES.get(key);
      if (object) break;
    }

    if (!object) {
      // Redirect to placeholder if not found
      return c.redirect(getPlaceholderCover(), 302);
    }

    // Return image with caching headers
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('CDN-Cache-Control', 'max-age=31536000');
    // Note: size parameter currently ignored - serving original for all requests

    return new Response(object.body, { headers });

  } catch (error) {
    console.error(`Error serving cover for ${normalizedISBN}:`, error);
    return c.redirect(getPlaceholderCover(), 302);
  }
});

// GET /covers/:isbn/status - Check if cover exists
app.get('/covers/:isbn/status', async (c) => {
  const { isbn } = c.req.param();
  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  if (!/^[0-9]{10,13}X?$/i.test(normalizedISBN)) {
    return c.json({ error: 'Invalid ISBN format' }, 400);
  }

  try {
    const metadata = await getCoverMetadata(c.env, normalizedISBN);

    if (!metadata) {
      return c.json({
        exists: false,
        isbn: normalizedISBN
      });
    }

    return c.json({
      exists: true,
      isbn: normalizedISBN,
      ...metadata,
      urls: {
        original: `/covers/${normalizedISBN}/original`,
        large: `/covers/${normalizedISBN}/large`,
        medium: `/covers/${normalizedISBN}/medium`,
        small: `/covers/${normalizedISBN}/small`
      }
    });

  } catch (error) {
    console.error(`Error checking cover status for ${normalizedISBN}:`, error);
    return c.json({ error: 'Failed to check cover status' }, 500);
  }
});

// POST /covers/:isbn/process - Trigger cover processing
app.post('/covers/:isbn/process', async (c) => {
  const { isbn } = c.req.param();
  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  if (!/^[0-9]{10,13}X?$/i.test(normalizedISBN)) {
    return c.json({ error: 'Invalid ISBN format' }, 400);
  }

  // Check for force flag in query params
  const force = c.req.query('force') === 'true';

  try {
    const result = await processCoverImage(normalizedISBN, c.env, { force });

    const statusCode = (result as any).status === 'processed' ? 201 :
                       (result as any).status === 'already_exists' ? 200 :
                       (result as any).status === 'no_cover' ? 404 : 500;

    return c.json(result, statusCode);

  } catch (error) {
    console.error(`Error processing cover for ${normalizedISBN}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      status: 'error',
      isbn: normalizedISBN,
      error: message
    }, 500);
  }
});

// POST /covers/batch - Process multiple covers (with Zod validation for RPC type safety)
app.post('/covers/batch',
  zValidator('json', CoverBatchSchema),
  async (c) => {
    const { isbns } = c.req.valid('json');

    try {
      const result = await processCoverBatch(isbns, c.env);
      return c.json(result);

    } catch (error) {
      console.error('Batch processing error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({
        error: 'Batch processing failed',
        message
      }, 500);
    }
  }
);

// =================================================================================
// ISBNdb API Testing Endpoints (Development/Verification)
// =================================================================================

// GET /api/test/isbndb - Test all ISBNdb endpoints
app.get('/api/test/isbndb', async (c) => {
  try {
    const results = await testAllISBNdbEndpoints(c.env);
    const summary = {
      total: results.length,
      passed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
    return c.json(summary);
  } catch (error) {
    console.error('ISBNdb test error:', error);
    return c.json({
      error: 'Test suite failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/test/isbndb/book/:isbn - Test book lookup
app.get('/api/test/isbndb/book/:isbn', async (c) => {
  const isbn = c.req.param('isbn');
  try {
    const result = await testISBNdbBook(isbn, c.env);
    return c.json(result);
  } catch (error) {
    console.error('ISBNdb book test error:', error);
    return c.json({
      error: 'Book test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/test/isbndb/books - Test books search
app.get('/api/test/isbndb/books', async (c) => {
  const query = c.req.query('q') || 'harry potter';
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '5');
  const column = c.req.query('column');

  try {
    const result = await testISBNdbBooksSearch(query, { page, pageSize, column }, c.env);
    return c.json(result);
  } catch (error) {
    console.error('ISBNdb books search test error:', error);
    return c.json({
      error: 'Books search test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/test/isbndb/author/:name - Test author lookup
app.get('/api/test/isbndb/author/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const result = await testISBNdbAuthor(name, c.env);
    return c.json(result);
  } catch (error) {
    console.error('ISBNdb author test error:', error);
    return c.json({
      error: 'Author test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/test/isbndb/authors - Test authors search
app.get('/api/test/isbndb/authors', async (c) => {
  const query = c.req.query('q') || 'rowling';
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '5');

  try {
    const result = await testISBNdbAuthorsSearch(query, { page, pageSize }, c.env);
    return c.json(result);
  } catch (error) {
    console.error('ISBNdb authors search test error:', error);
    return c.json({
      error: 'Authors search test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/test/isbndb/publisher/:name - Test publisher lookup
app.get('/api/test/isbndb/publisher/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const result = await testISBNdbPublisher(name, c.env);
    return c.json(result);
  } catch (error) {
    console.error('ISBNdb publisher test error:', error);
    return c.json({
      error: 'Publisher test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/test/isbndb/subject/:name - Test subject lookup
app.get('/api/test/isbndb/subject/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const result = await testISBNdbSubject(name, c.env);
    return c.json(result);
  } catch (error) {
    console.error('ISBNdb subject test error:', error);
    return c.json({
      error: 'Subject test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// POST /api/test/isbndb/batch - Test batch books lookup (POST /books)
app.post('/api/test/isbndb/batch', async (c) => {
  try {
    const body = await c.req.json();
    const isbns = body.isbns || [];

    if (!Array.isArray(isbns) || isbns.length === 0) {
      return c.json({
        error: 'Invalid request',
        message: 'Must provide array of ISBNs in request body'
      }, 400);
    }

    if (isbns.length > 100) {
      return c.json({
        error: 'Too many ISBNs',
        message: 'Basic plan allows up to 100 ISBNs per batch request'
      }, 400);
    }

    const result = await testISBNdbBatchBooks(isbns, c.env);
    return c.json(result);
  } catch (error) {
    console.error('ISBNdb batch test error:', error);
    return c.json({
      error: 'Batch test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// =================================================================================
// Worker Entrypoint
// =================================================================================

// Export the type for Hono RPC type safety (consumed by bendv3)
// This allows strict type checking across service boundaries
export type AlexandriaAppType = typeof app;

export default {
  // HTTP request handler (Hono app)
  fetch: app.fetch,

  // Scheduled handler for cron triggers (enrichment queue consumer)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`Cron triggered at ${new Date().toISOString()}`);

    // Use waitUntil to ensure the queue processing completes
    ctx.waitUntil(
      processEnrichmentQueue(env)
        .then(results => {
          console.log(`Queue processing complete:`, JSON.stringify(results));
        })
        .catch(error => {
          console.error(`Queue processing failed:`, error);
        })
    );
  },

  // Queue consumer handler - routes messages based on queue name
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    console.log(`Queue triggered: ${batch.queue} with ${batch.messages.length} messages`);

    // Route to appropriate handler based on queue name
    switch (batch.queue) {
      case 'alexandria-cover-queue':
        return await processCoverQueue(batch, env);

      case 'alexandria-enrichment-queue':
        return await processEnrichmentQueueBatch(batch, env);

      default:
        console.error(`Unknown queue: ${batch.queue}`);
        // Ack all messages to prevent infinite retry
        batch.messages.forEach(msg => msg.ack());
    }
  }
};


// =================================================================================
// Dashboard HTML Template
// =================================================================================

