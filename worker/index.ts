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
import { Logger } from './lib/logger.js';
import { getDashboardHTML } from './dashboard.js';
import { smartResolveISBN, shouldResolveExternally } from './services/smart-enrich.js';
import { fetchISBNdbBatch } from './services/batch-isbndb.js';
import { enrichEdition, enrichWork } from './enrichment-service.js';
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
import {
  generateCacheKey,
  getCachedResults,
  setCachedResults,
  getCacheTTL,
  isCacheEnabled
} from './cache-utils.js';

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

// Request ID middleware - attach unique ID for log tracing (issue #72)
app.use('*', async (c, next) => {
  // Use Cloudflare Ray ID if available, otherwise generate UUID
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);

  // Create request-scoped logger
  const logger = Logger.forRequest(c.env, c.req.raw);
  c.set('logger', logger);

  await next();
});

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
  cache({ cacheName: 'alexandria-cache', cacheControl: 'public, max-age=300' }), // 5 min cache for fresher stats
  async (c) => {
    try {
      const sql = c.get('sql');
      const start = Date.now();

      // OpenLibrary core tables + enriched tables in parallel
      const [editions, isbns, works, authors, enrichedStats] = await Promise.all([
        sql`SELECT count(*) FROM editions`.then(r => r[0].count),
        sql`SELECT count(*) FROM edition_isbns`.then(r => r[0].count),
        sql`SELECT count(*) FROM works`.then(r => r[0].count),
        sql`SELECT count(*) FROM authors`.then(r => r[0].count),
        // Enriched tables with recent activity counts
        // Note: enriched_editions uses updated_at (upsert behavior), others use created_at
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
      ]);
      const queryDuration = Date.now() - start;

      // Count covers in R2 bucket
      let coverCount = 0;
      try {
        const bucket = c.env.COVER_IMAGES;
        let cursor: string | undefined;
        do {
          const list = await bucket.list({ cursor, limit: 1000 });
          coverCount += list.objects.length;
          cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);
      } catch (e) {
        console.error('Error counting covers:', e);
      }

      const stats = {
        // OpenLibrary core tables
        editions: parseInt(editions, 10),
        isbns: parseInt(isbns, 10),
        works: parseInt(works, 10),
        authors: parseInt(authors, 10),
        covers: coverCount,
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
        query_duration_ms: queryDuration,
      };

      return c.json(stats, 200, {
        'cache-control': 'public, max-age=300'
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

// POST /api/isbns/check -> Check which ISBNs exist in enriched_editions
app.post('/api/isbns/check', async (c) => {
  try {
    const body = await c.req.json();
    const { isbns } = body;

    if (!Array.isArray(isbns) || isbns.length === 0) {
      return c.json({ error: 'Invalid request: isbns array required' }, 400);
    }

    if (isbns.length > 1000) {
      return c.json({ error: 'Too many ISBNs (max 1000)' }, 400);
    }

    const sql = c.get('sql');
    const start = Date.now();

    // Query enriched_editions for ISBNs
    // Check both primary ISBN and alternate_isbns array
    const results = await sql`
      SELECT isbn, alternate_isbns
      FROM enriched_editions
      WHERE isbn IN ${sql(isbns)}
         OR EXISTS (
           SELECT 1 FROM unnest(alternate_isbns) AS alt_isbn
           WHERE alt_isbn IN ${sql(isbns)}
         )
    `;

    // Collect all matching ISBNs
    const existingSet = new Set();
    const requestedSet = new Set(isbns);

    for (const row of results) {
      // Check primary ISBN
      if (requestedSet.has(row.isbn)) {
        existingSet.add(row.isbn);
      }
      // Check alternate ISBNs
      if (row.alternate_isbns) {
        for (const isbn of row.alternate_isbns) {
          if (requestedSet.has(isbn)) {
            existingSet.add(isbn);
          }
        }
      }
    }

    const existingISBNs = Array.from(existingSet);
    const queryDuration = Date.now() - start;

    return c.json({
      existing: existingISBNs,
      count: existingISBNs.length,
      total_checked: isbns.length,
      query_duration_ms: queryDuration
    });
  } catch (error) {
    console.error('ISBN check error:', error);
    return c.json({
      error: 'ISBN check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// POST /api/enrich/edition -> Store or update edition metadata
app.post('/api/enrich/edition', handleEnrichEdition);

// POST /api/enrich/work -> Store or update work metadata
app.post('/api/enrich/work', handleEnrichWork);

// POST /api/enrich/author -> Store or update author biographical data
app.post('/api/enrich/author', handleEnrichAuthor);

// POST /api/enrich/queue -> Queue background enrichment job (single item)
app.post('/api/enrich/queue', handleQueueEnrichment);

// POST /api/enrich/queue/batch -> Queue batch enrichment jobs
app.post('/api/enrich/queue/batch', async (c) => {
  try {
    const body = await c.req.json();
    const { books } = body;

    // Validate input
    if (!Array.isArray(books) || books.length === 0) {
      return c.json({ error: 'books array required' }, 400);
    }

    if (books.length > 100) {
      return c.json({ error: 'Max 100 books per request' }, 400);
    }

    const queued: string[] = [];
    const failed: Array<{ isbn: string; error: string }> = [];

    for (const book of books) {
      const { isbn, priority = 'normal', source = 'unknown', title, author } = book;

      // Validate ISBN
      const normalizedISBN = isbn?.replace(/[^0-9X]/gi, '').toUpperCase();
      if (!normalizedISBN || (normalizedISBN.length !== 10 && normalizedISBN.length !== 13)) {
        failed.push({ isbn: isbn || 'undefined', error: 'Invalid ISBN format' });
        continue;
      }

      try {
        // Queue enrichment processing
        await c.env.ENRICHMENT_QUEUE.send({
          isbn: normalizedISBN,
          entity_type: 'edition',
          entity_key: normalizedISBN,  // Use ISBN as entity key for editions
          providers_to_try: ['isbndb', 'google-books', 'openlibrary'],
          priority,
          source,
          title,
          author,
          queued_at: new Date().toISOString()
        });

        queued.push(normalizedISBN);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ isbn: normalizedISBN, error: message });
      }
    }

    return c.json({
      queued: queued.length,
      failed: failed.length,
      errors: failed
    });
  } catch (error) {
    console.error('Enrichment queue error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      error: 'Queue operation failed',
      message
    }, 500);
  }
});

// GET /api/enrich/status/:id -> Check enrichment job status
app.get('/api/enrich/status/:id', handleGetEnrichmentStatus);

// POST /api/enrich/batch-direct -> Direct batch enrichment (bypasses queue for 10x efficiency)
// Accepts up to 1000 ISBNs, calls ISBNdb Premium batch API directly
app.post('/api/enrich/batch-direct', async (c) => {
  const startTime = Date.now();

  try {
    const body = await c.req.json();
    const { isbns, source = 'batch-direct' } = body;

    // Validate input
    if (!Array.isArray(isbns) || isbns.length === 0) {
      return c.json({ error: 'isbns array required' }, 400);
    }

    if (isbns.length > 1000) {
      return c.json({ error: 'Max 1000 ISBNs per request (ISBNdb Premium limit)' }, 400);
    }

    // Normalize ISBNs
    const normalizedISBNs = isbns
      .map((isbn: string) => isbn?.replace(/[^0-9X]/gi, '').toUpperCase())
      .filter((isbn: string) => isbn && (isbn.length === 10 || isbn.length === 13));

    if (normalizedISBNs.length === 0) {
      return c.json({ error: 'No valid ISBNs provided' }, 400);
    }

    console.log(`[Batch Direct] Processing ${normalizedISBNs.length} ISBNs (source: ${source})`);

    // Fetch all ISBNs in a single ISBNdb API call (10x efficiency!)
    const batchStartTime = Date.now();
    const enrichmentData = await fetchISBNdbBatch(normalizedISBNs, c.env);
    const batchDuration = Date.now() - batchStartTime;

    console.log(`[Batch Direct] ISBNdb returned ${enrichmentData.size}/${normalizedISBNs.length} books in ${batchDuration}ms`);

    // Get database connection
    const sql = c.get('sql');

    // Store results in enriched tables
    const results = {
      requested: normalizedISBNs.length,
      found: enrichmentData.size,
      enriched: 0,
      failed: 0,
      not_found: normalizedISBNs.length - enrichmentData.size,
      covers_queued: 0,
      errors: [] as Array<{ isbn: string; error: string }>,
      api_calls: 1, // Single batch call!
      duration_ms: 0
    };

    for (const [isbn, externalData] of enrichmentData) {
      try {
        // Generate a work key for grouping editions
        const workKey = `/works/isbndb-${crypto.randomUUID().slice(0, 8)}`;

        // First, create the enriched_work so FK constraint is satisfied
        await enrichWork(sql, {
          work_key: workKey,
          title: externalData.title,
          description: externalData.description,
          subject_tags: externalData.subjects,
          primary_provider: 'isbndb',
        });

        // Then enrich the edition (stores metadata + cover URLs)
        await enrichEdition(sql, {
          isbn,
          title: externalData.title,
          subtitle: externalData.subtitle,
          publisher: externalData.publisher,
          publication_date: externalData.publicationDate,
          page_count: externalData.pageCount,
          format: externalData.binding,
          language: externalData.language,
          primary_provider: 'isbndb',
          cover_urls: externalData.coverUrls,
          cover_source: 'isbndb',
          work_key: workKey,
          subjects: externalData.subjects,
          dewey_decimal: externalData.deweyDecimal,
          binding: externalData.binding,
          related_isbns: externalData.relatedISBNs,
        }, c.env);

        results.enriched++;

        // Queue cover download if we have a cover URL
        if (externalData.coverUrls?.original || externalData.coverUrls?.large) {
          try {
            await c.env.COVER_QUEUE.send({
              isbn,
              work_key: workKey,
              provider_url: externalData.coverUrls.original || externalData.coverUrls.large,
              priority: 'normal',
              source
            });
            results.covers_queued++;
          } catch (queueError) {
            // Don't fail enrichment if cover queue fails
            console.warn(`[Batch Direct] Failed to queue cover for ${isbn}:`, queueError);
          }
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.failed++;
        results.errors.push({ isbn, error: message });
      }
    }

    results.duration_ms = Date.now() - startTime;

    console.log(`[Batch Direct] Complete: ${results.enriched} enriched, ${results.failed} failed, ${results.not_found} not found in ${results.duration_ms}ms`);

    return c.json(results);

  } catch (error) {
    console.error('[Batch Direct] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      error: 'Batch enrichment failed',
      message,
      duration_ms: Date.now() - startTime
    }, 500);
  }
});

// POST /api/authors/bibliography -> Get author bibliography from ISBNdb
app.post('/api/authors/bibliography', async (c) => {
  try {
    const body = await c.req.json();
    const { author_name, max_pages = 10 } = body;

    if (!author_name || typeof author_name !== 'string') {
      return c.json({ error: 'author_name required' }, 400);
    }

    const apiKey = await c.env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      return c.json({ error: 'ISBNdb API key not configured' }, 500);
    }

    const pageSize = 100;
    const books: Array<{isbn: string; title: string; author: string; publisher?: string; date_published?: string}> = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= max_pages) {
      // Use Premium endpoint for 3x throughput (3 req/sec vs 1 req/sec)
      const response = await fetch(
        `https://api.premium.isbndb.com/author/${encodeURIComponent(author_name)}?page=${page}&pageSize=${pageSize}`,
        {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 404) {
        // Author not found
        break;
      }

      if (response.status === 429) {
        return c.json({ error: 'Rate limited by ISBNdb' }, 429);
      }

      if (!response.ok) {
        return c.json({ error: `ISBNdb API error: ${response.status}` }, response.status);
      }

      const data = await response.json();

      // Debug: log the pagination info from ISBNdb
      console.log(`[Bibliography] Page ${page}: total=${data.total}, books_in_response=${data.books?.length || 0}`);

      if (data.books && Array.isArray(data.books)) {
        for (const book of data.books) {
          const isbn = book.isbn13 || book.isbn;
          if (isbn) {
            books.push({
              isbn,
              title: book.title || 'Unknown',
              author: book.authors?.[0] || author_name,
              publisher: book.publisher,
              date_published: book.date_published
            });
          }
        }
      }

      // ISBNdb pagination: if we got a full page, there might be more
      // Also check data.total if available
      const booksInResponse = data.books?.length || 0;
      const total = data.total || 0;

      // Continue if: we got a full page OR total indicates more pages exist
      hasMore = booksInResponse === pageSize || (total > 0 && books.length < total);

      console.log(`[Bibliography] After page ${page}: collected=${books.length}, hasMore=${hasMore}`);

      page++;

      // Rate limit between pagination requests (ISBNdb Premium: 3 req/sec)
      if (hasMore && page <= max_pages) {
        await new Promise(resolve => setTimeout(resolve, 350)); // 350ms delay for 3 req/sec
      }
    }

    return c.json({
      author: author_name,
      books_found: books.length,
      pages_fetched: page - 1,
      books
    });
  } catch (error) {
    console.error('Author bibliography error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to fetch author bibliography', message }, 500);
  }
});

// POST /api/authors/enrich-bibliography -> Fetch author bibliography AND directly enrich (no re-fetch!)
// This is 50-90% more efficient than bibliography → queue → batch-fetch
// ISBNdb author endpoint returns full book metadata, so we enrich directly from that response
app.post('/api/authors/enrich-bibliography', async (c) => {
  const startTime = Date.now();

  try {
    const body = await c.req.json();
    const { author_name, max_pages = 10, skip_existing = true } = body;

    if (!author_name || typeof author_name !== 'string') {
      return c.json({ error: 'author_name required' }, 400);
    }

    const apiKey = await c.env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      return c.json({ error: 'ISBNdb API key not configured' }, 500);
    }

    // Check KV cache for this author (avoid redundant API calls)
    const cacheKey = `author_bibliography:${author_name.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = await c.env.CACHE.get(cacheKey, 'json');

    if (cached) {
      console.log(`[EnrichBibliography] Cache hit for "${author_name}"`);
      return c.json({
        ...cached,
        cached: true,
        duration_ms: Date.now() - startTime
      });
    }

    const sql = c.get('sql');
    const pageSize = 100;

    // Track results
    const results = {
      author: author_name,
      books_found: 0,
      already_existed: 0,
      enriched: 0,
      covers_queued: 0,
      failed: 0,
      pages_fetched: 0,
      api_calls: 0,  // Track ISBNdb API calls
      errors: [] as Array<{ isbn: string; error: string }>,
      duration_ms: 0
    };

    // Collect all books from ISBNdb author endpoint (with full metadata!)
    const allBooks: Array<{
      isbn: string;
      title: string;
      authors: string[];
      publisher?: string;
      date_published?: string;
      pages?: number;
      language?: string;
      synopsis?: string;
      image?: string;
      subjects?: string[];
      binding?: string;
    }> = [];

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= max_pages) {
      const response = await fetch(
        `https://api.premium.isbndb.com/author/${encodeURIComponent(author_name)}?page=${page}&pageSize=${pageSize}`,
        {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      results.api_calls++;

      if (response.status === 404) {
        break;
      }

      if (response.status === 429) {
        return c.json({ error: 'Rate limited by ISBNdb', partial_results: results }, 429);
      }

      if (!response.ok) {
        return c.json({ error: `ISBNdb API error: ${response.status}`, partial_results: results }, response.status);
      }

      const data = await response.json();
      results.pages_fetched = page;

      if (data.books && Array.isArray(data.books)) {
        for (const book of data.books) {
          const isbn = book.isbn13 || book.isbn;
          if (isbn) {
            allBooks.push({
              isbn,
              title: book.title || 'Unknown',
              authors: book.authors || [author_name],
              publisher: book.publisher,
              date_published: book.date_published,
              pages: book.pages,
              language: book.language,
              synopsis: book.synopsis,
              image: book.image,
              subjects: book.subjects,
              binding: book.binding
            });
          }
        }
      }

      const booksInResponse = data.books?.length || 0;
      const total = data.total || 0;
      hasMore = booksInResponse === pageSize || (total > 0 && allBooks.length < total);

      page++;

      // Rate limit between pagination requests (ISBNdb Premium: 3 req/sec)
      if (hasMore && page <= max_pages) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    results.books_found = allBooks.length;
    console.log(`[EnrichBibliography] Found ${allBooks.length} books for "${author_name}" in ${results.api_calls} API calls`);

    if (allBooks.length === 0) {
      // Cache empty result to avoid repeated lookups
      await c.env.CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: 86400 });
      results.duration_ms = Date.now() - startTime;
      return c.json(results);
    }

    // Check which ISBNs already exist (if skip_existing is true)
    let isbnsToEnrich = allBooks;

    if (skip_existing) {
      const allISBNs = allBooks.map(b => b.isbn);
      const existingResult = await sql`
        SELECT isbn FROM enriched_editions
        WHERE isbn IN ${sql(allISBNs)}
      `;
      const existingSet = new Set(existingResult.map((r: any) => r.isbn));
      results.already_existed = existingSet.size;

      isbnsToEnrich = allBooks.filter(b => !existingSet.has(b.isbn));
      console.log(`[EnrichBibliography] ${existingSet.size} already exist, ${isbnsToEnrich.length} to enrich`);
    }

    // DIRECTLY enrich from the data we already have (NO re-fetch from ISBNdb!)
    for (const book of isbnsToEnrich) {
      try {
        // Generate a work key for grouping editions
        const workKey = `/works/isbndb-${crypto.randomUUID().slice(0, 8)}`;

        // Create enriched_work
        await enrichWork(sql, {
          work_key: workKey,
          title: book.title,
          description: book.synopsis,
          subject_tags: book.subjects,
          primary_provider: 'isbndb',
        });

        // Create enriched_edition with all the metadata we already have
        await enrichEdition(sql, {
          isbn: book.isbn,
          title: book.title,
          publisher: book.publisher,
          publication_date: book.date_published,
          page_count: book.pages,
          language: book.language,
          primary_provider: 'isbndb',
          cover_urls: book.image ? { large: book.image, medium: book.image, small: book.image } : undefined,
          cover_source: book.image ? 'isbndb' : undefined,
          work_key: workKey,
          subjects: book.subjects,
          binding: book.binding,
        }, c.env);

        results.enriched++;

        // Queue ONLY cover download (not ISBN re-fetch!)
        if (book.image) {
          try {
            await c.env.COVER_QUEUE.send({
              isbn: book.isbn,
              work_key: workKey,
              provider_url: book.image,
              priority: 'normal',
              source: 'author_bibliography'
            });
            results.covers_queued++;
          } catch (queueError) {
            // Don't fail enrichment if cover queue fails
            console.warn(`[EnrichBibliography] Cover queue failed for ${book.isbn}:`, queueError);
          }
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.failed++;
        results.errors.push({ isbn: book.isbn, error: message });
      }
    }

    results.duration_ms = Date.now() - startTime;

    // Cache successful result (24 hours)
    const cacheResult = { ...results, errors: [] }; // Don't cache individual errors
    await c.env.CACHE.put(cacheKey, JSON.stringify(cacheResult), { expirationTtl: 86400 });

    console.log(`[EnrichBibliography] Complete for "${author_name}": ${results.enriched} enriched, ${results.already_existed} existed, ${results.failed} failed in ${results.duration_ms}ms`);

    return c.json(results);

  } catch (error) {
    console.error('[EnrichBibliography] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      error: 'Failed to enrich author bibliography',
      message,
      duration_ms: Date.now() - startTime
    }, 500);
  }
});

// NOTE: /api/isbns/check is defined above at line 341 with better query logic
// (checking both primary ISBN and alternate_isbns array)

// POST /api/covers/queue -> Queue cover processing jobs (batch)
app.post('/api/covers/queue', async (c) => {
  try {
    const body = await c.req.json();
    const { books } = body;

    // Validate input
    if (!Array.isArray(books) || books.length === 0) {
      return c.json({ error: 'books array required' }, 400);
    }

    if (books.length > 100) {
      return c.json({ error: 'Max 100 books per request' }, 400);
    }

    const queued: string[] = [];
    const failed: Array<{ isbn: string; error: string }> = [];

    for (const book of books) {
      const { isbn, work_key, priority = 'normal', source = 'unknown', title, author } = book;

      // Validate ISBN
      const normalizedISBN = isbn?.replace(/[^0-9X]/gi, '').toUpperCase();
      if (!normalizedISBN || (normalizedISBN.length !== 10 && normalizedISBN.length !== 13)) {
        failed.push({ isbn: isbn || 'undefined', error: 'Invalid ISBN format' });
        continue;
      }

      try {
        // Queue cover processing
        await c.env.COVER_QUEUE.send({
          isbn: normalizedISBN,
          work_key,
          priority,
          source,
          title,
          author,
          queued_at: new Date().toISOString()
        });

        queued.push(normalizedISBN);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ isbn: normalizedISBN, error: message });
      }
    }

    return c.json({
      queued: queued.length,
      failed: failed.length,
      errors: failed
    });
  } catch (error) {
    console.error('Cover queue error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      error: 'Queue operation failed',
      message
    }, 500);
  }
});

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

    const logger = c.get('logger');
    const sql = c.get('sql');
    const start = Date.now();

    logger.debug('Search request received', { isbn, title, author, limit, offset });

    // Determine query type and generate cache key
    const queryType = isbn ? 'isbn' : title ? 'title' : 'author';
    const queryValue = isbn || title || author || '';
    const cacheKey = generateCacheKey(queryType, queryValue, limit, offset);

    // Try to get cached results
    let cached = null;
    let cacheHit = false;
    if (isCacheEnabled(c.env)) {
      cached = await getCachedResults(c.env.CACHE, cacheKey);
      if (cached) {
        cacheHit = true;
        logger.info('Cache hit', { queryType, cacheKey });
        // Return cached results with cache metadata
        return c.json({
          ...cached,
          cache_hit: true,
          cache_age_seconds: Math.floor((Date.now() - new Date(cached.cached_at).getTime()) / 1000),
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
        const [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(*)::int AS total
            FROM enriched_editions
            WHERE isbn = ${isbn}
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
            WHERE ee.isbn = ${isbn}
            GROUP BY ee.isbn, ee.title, ee.publication_date, ee.publisher, ee.page_count,
                     ew.title, ee.edition_key, ee.work_key, ee.cover_url_large,
                     ee.cover_url_medium, ee.cover_url_small
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
        // Performance: Sub-second with GIN trigram index (vs slower similarity operator)
        // ILIKE pattern matching is precise and efficient
        const authorPattern = `%${author}%`;
        const [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(DISTINCT ee.isbn)::int AS total
            FROM enriched_authors ea
            JOIN work_authors_enriched wae ON wae.author_key = ea.author_key
            JOIN enriched_editions ee ON ee.work_key = wae.work_key
            WHERE ea.name ILIKE ${authorPattern}
          `,
          sql`
            WITH matching_editions AS (
              SELECT DISTINCT ee.isbn
              FROM enriched_authors ea
              JOIN work_authors_enriched wae ON wae.author_key = ea.author_key
              JOIN enriched_editions ee ON ee.work_key = wae.work_key
              WHERE ea.name ILIKE ${authorPattern}
              LIMIT ${limit}
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
          `
        ]);

        total = countResult[0]?.total || 0;
        results = dataResult;
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
          returnedCount: formattedResults.length
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

        // OPTIMIZED: Use enriched_editions for faster ISBN lookup
        const [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(*)::int AS total
            FROM enriched_editions
            WHERE isbn = ${isbn}
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
              ee.cover_url_large AS cover_url,
              'edition' AS result_type,
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
                     ew.title, ee.edition_key, ee.work_key, ee.cover_url_large
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
            // Add result_type and authors array for combined search format
            results = [{
              ...enrichedResult,
              result_type: 'edition',
              authors: enrichedResult.author ? [{ name: enrichedResult.author, key: null }] : [],
            }];
            total = 1;
          } else {
            console.log(`[Smart Resolve] ✗ No external data found for ISBN ${isbn}`);
          }
        }

      } else {
        // Text search: search both titles and authors simultaneously
        searchType = 'text';

        // OPTIMIZED: Use enriched tables with ILIKE for fast partial matching
        // ILIKE is much faster than similarity operator (60ms vs 18s) and still uses GIN trigram index
        const queryPattern = `%${query}%`;

        // Parallel search: titles and authors
        const [titleCountResult, authorCountResult, titleResults, authorResults] = await Promise.all([
          // Count title matches (enriched_editions with GIN index)
          sql`
            SELECT COUNT(*)::int AS total
            FROM enriched_editions
            WHERE title ILIKE ${queryPattern}
          `,
          // Count author matches (enriched_authors with GIN index)
          sql`
            SELECT COUNT(DISTINCT ee.isbn)::int AS total
            FROM enriched_authors ea
            JOIN work_authors_enriched wae ON wae.author_key = ea.author_key
            JOIN enriched_editions ee ON ee.work_key = wae.work_key
            WHERE ea.name ILIKE ${queryPattern}
          `,
          // Search editions by title (using enriched tables) with all authors per work
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
              ee.cover_url_large AS cover_url,
              'edition' AS result_type,
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
            WHERE ee.title ILIKE ${queryPattern}
            GROUP BY ee.isbn, ee.title, ee.publication_date, ee.publisher, ee.page_count,
                     ew.title, ee.edition_key, ee.work_key, ee.cover_url_large
            ORDER BY ee.title
            LIMIT ${limit + 50}
            OFFSET ${offset}
          `,
          // Search authors by name (using enriched tables) with all authors per work
          sql`
            WITH matching_editions AS (
              SELECT DISTINCT ee.isbn
              FROM enriched_authors ea
              JOIN work_authors_enriched wae ON wae.author_key = ea.author_key
              JOIN enriched_editions ee ON ee.work_key = wae.work_key
              WHERE ea.name ILIKE ${queryPattern}
              LIMIT ${limit + 50}
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
              ee.cover_url_large AS cover_url,
              'edition' AS result_type,
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
                     ew.title, ee.edition_key, ee.work_key, ee.cover_url_large
            ORDER BY ee.title
          `
        ]);

        // Combine and deduplicate results (by ISBN)
        const combinedMap = new Map();
        [...titleResults, ...authorResults].forEach(row => {
          if (row.isbn && !combinedMap.has(row.isbn)) {
            combinedMap.set(row.isbn, row);
          }
        });

        results = Array.from(combinedMap.values()).slice(0, limit);

        // Total is approximated as sum of both counts (may have overlap, but good estimate)
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

      // Format results - enriched tables already have cover URLs pre-cached
      const formattedResults = results.map((row) => {
        // Use pre-cached cover URL from enriched_editions (faster, no async resolution needed)
        const coverUrl = row.cover_url || null;

        // Parse authors array from JSON aggregation (handles both JSON objects and pre-parsed arrays)
        const authorsRaw = row.authors || [];
        const authors = (Array.isArray(authorsRaw) ? authorsRaw : []).map((a: { name: string; key: string }) => ({
          name: a.name,
          key: a.key,
          openlibrary: a.key ? `https://openlibrary.org${a.key}` : null,
        }));

        return {
          type: row.result_type,
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

      // Enhanced CDN caching headers for combined search
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
        'Cache-Control': 'public, max-age=3600',
        'CDN-Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
        'Vary': 'Accept-Encoding'
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
  // ISBN-10: 9 digits + optional X, or ISBN-13: 13 digits
  if (!/^(?:[0-9]{9}X|[0-9]{10,13})$/i.test(normalizedISBN)) {
    return c.json({ error: 'Invalid ISBN format' }, 400);
  }

  try {
    // STRATEGY 1: Check KV cache for ISBN→R2 key mapping
    // This cache is populated when covers are processed
    const cacheKey = `cover_key:${normalizedISBN}`;
    let r2Key = await c.env.CACHE.get(cacheKey);
    let object = null;

    if (r2Key) {
      console.log(`[CoverServe] Found cached R2 key for ISBN ${normalizedISBN}: ${r2Key}`);
      object = await c.env.COVER_IMAGES.get(r2Key);

      // If cached key is stale (object deleted), remove from cache
      if (!object) {
        console.log(`[CoverServe] Cached R2 key is stale, removing from cache`);
        await c.env.CACHE.delete(cacheKey);
        r2Key = null;
      }
    }

    // STRATEGY 2: Try legacy ISBN-based storage (isbn/{isbn}/original.{ext})
    // This was the old storage format before work-based keys were introduced
    if (!object) {
      const extensions = ['jpg', 'png', 'webp'];

      for (const ext of extensions) {
        const key = `isbn/${normalizedISBN}/original.${ext}`;
        object = await c.env.COVER_IMAGES.get(key);
        if (object) {
          console.log(`[CoverServe] Found ISBN-based cover: ${key}`);
          // Cache this key for future requests
          await c.env.CACHE.put(cacheKey, key, { expirationTtl: 86400 * 30 }); // 30 days
          break;
        }
      }
    }

    // STRATEGY 3: Search work-based storage (covers/{work_key}/{hash}/original)
    // This is the current storage format used by queue-based processing
    if (!object) {
      console.log(`[CoverServe] Searching work-based storage for ISBN ${normalizedISBN}`);

      // List objects with covers/ prefix and filter by ISBN in customMetadata
      // Note: R2 doesn't support metadata queries, so we need to list and filter
      let cursor: string | undefined;
      let found = false;

      // Search through covers prefix (limit search to avoid timeout)
      const maxPages = 5; // Search up to 5,000 objects (5 pages × 1000/page)
      let pageCount = 0;

      while (!found && pageCount < maxPages) {
        const list = await c.env.COVER_IMAGES.list({
          prefix: 'covers/',
          cursor,
          limit: 1000
        });

        // Check each object's metadata for matching ISBN
        for (const obj of list.objects) {
          const head = await c.env.COVER_IMAGES.head(obj.key);
          if (head?.customMetadata?.isbn === normalizedISBN) {
            console.log(`[CoverServe] Found work-based cover: ${obj.key} (ISBN: ${normalizedISBN})`);
            object = await c.env.COVER_IMAGES.get(obj.key);
            r2Key = obj.key;

            // Cache this key for future requests (30 days)
            await c.env.CACHE.put(cacheKey, r2Key, { expirationTtl: 86400 * 30 });
            console.log(`[CoverServe] Cached R2 key: ${cacheKey} → ${r2Key}`);

            found = true;
            break;
          }
        }

        cursor = list.truncated ? list.cursor : undefined;
        pageCount++;

        if (!cursor) break; // No more objects to list
      }

      if (!object) {
        console.log(`[CoverServe] No cover found for ISBN ${normalizedISBN} after searching ${pageCount} pages`);
      }
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

  // ISBN-10: 9 digits + optional X, or ISBN-13: 13 digits
  if (!/^(?:[0-9]{9}X|[0-9]{10,13})$/i.test(normalizedISBN)) {
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

  // ISBN-10: 9 digits + optional X, or ISBN-13: 13 digits
  if (!/^(?:[0-9]{9}X|[0-9]{10,13})$/i.test(normalizedISBN)) {
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
// Queue API Endpoints - Manual Pull-Based Consumers (Testing & Debugging)
// =================================================================================

// POST /api/queue/drain/enrichment - Manually pull and process enrichment queue
app.post('/api/queue/drain/enrichment', async (c) => {
  try {
    const { pullAndProcessEnrichmentQueue } = await import('./queue-api-consumer.js');
    const batchSize = parseInt(c.req.query('batch_size') || '10');
    const result = await pullAndProcessEnrichmentQueue(c.env, batchSize);
    return c.json(result);
  } catch (error) {
    console.error('Queue drain error:', error);
    return c.json({
      error: 'Queue drain failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// POST /api/queue/drain/covers - Manually pull and process cover queue
app.post('/api/queue/drain/covers', async (c) => {
  try {
    const { pullAndProcessCoverQueue } = await import('./queue-api-consumer.js');
    const batchSize = parseInt(c.req.query('batch_size') || '20');
    const result = await pullAndProcessCoverQueue(c.env, batchSize);
    return c.json(result);
  } catch (error) {
    console.error('Queue drain error:', error);
    return c.json({
      error: 'Queue drain failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// =================================================================================
// ISBNdb API Testing Endpoints (Development/Verification)
// =================================================================================

// GET /api/covers/inspect - Inspect R2 cover objects with metadata
app.get('/api/covers/inspect', async (c) => {
  try {
    const bucket = c.env.COVER_IMAGES;
    const requestedLimit = parseInt(c.req.query('limit') || '20', 10);
    const includeDetails = c.req.query('details') === 'true';

    // If details requested, fetch limited set with metadata
    if (includeDetails) {
      const list = await bucket.list({ limit: requestedLimit });
      const objects = await Promise.all(
        list.objects.map(async (obj) => {
          const head = await bucket.head(obj.key);
          return {
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded,
            customMetadata: head?.customMetadata,
            httpMetadata: head?.httpMetadata,
          };
        })
      );

      return c.json({
        total_count: objects.length,
        truncated: list.truncated,
        objects: objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
      });
    }

    // Otherwise, just count and return summary
    let totalCount = 0;
    let cursor: string | undefined;
    const sample: any[] = [];
    let oldestDate: Date | null = null;
    let newestDate: Date | null = null;

    do {
      const list = await bucket.list({ cursor, limit: 1000 });
      totalCount += list.objects.length;

      // Collect first 10 for sample
      if (sample.length < 10) {
        sample.push(...list.objects.slice(0, 10 - sample.length).map(o => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded
        })));
      }

      // Track date range
      list.objects.forEach(obj => {
        if (!oldestDate || obj.uploaded < oldestDate) oldestDate = obj.uploaded;
        if (!newestDate || obj.uploaded > newestDate) newestDate = obj.uploaded;
      });

      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    return c.json({
      total_count: totalCount,
      date_range: {
        oldest: oldestDate,
        newest: newestDate
      },
      sample_objects: sample
    });
  } catch (error) {
    console.error('R2 inspect error:', error);
    return c.json({
      error: 'Failed to inspect R2 objects',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

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

