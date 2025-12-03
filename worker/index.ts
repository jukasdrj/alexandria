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
import { errorHandler } from './middleware/error-handler.js';
import type { Env, Variables } from './env.d.js';

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

// Search endpoint query parameters
const SearchQuerySchema = z.object({
  isbn: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 10)),
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

// OpenAPI 3.0 Specification
const openAPISpec = {
  openapi: '3.0.0',
  info: {
    title: 'Alexandria Book API',
    version: '2.0.0',
    description: 'Search 54+ million books from OpenLibrary via ISBN, title, and author. Powered by Cloudflare Workers and Hyperdrive.',
    contact: {
      name: 'API Support',
      url: 'https://github.com/jukasdrj/alexandria'
    }
  },
  servers: [{ url: 'https://alexandria.ooheynerds.com', description: 'Production' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health Check',
        description: 'Returns API and database health status',
        tags: ['System'],
        responses: {
          '200': { description: 'Healthy' }
        }
      }
    },
    '/api/stats': {
      get: {
        summary: 'Database Statistics',
        description: 'Get live counts of editions, ISBNs, works, and authors',
        tags: ['System'],
        responses: {
          '200': { description: 'Statistics' }
        }
      }
    },
    '/api/search': {
      get: {
        summary: 'Search for books',
        description: 'Search by ISBN, title, or author',
        tags: ['Books'],
        parameters: [
          { name: 'isbn', in: 'query', description: 'Search by ISBN-10 or ISBN-13', schema: { type: 'string' } },
          { name: 'title', in: 'query', description: 'Search by book title (partial match)', schema: { type: 'string' } },
          { name: 'author', in: 'query', description: 'Search by author name (partial match)', schema: { type: 'string' } },
          { name: 'limit', in: 'query', description: 'Max results (default 10, max 50)', schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Search results' },
          '400': { description: 'Invalid query' },
          '404': { description: 'No results found' }
        }
      }
    },
    '/api/enrich/edition': {
      post: {
        summary: 'Store or update edition metadata',
        description: 'Enrich an edition with metadata from external providers (ISBNdb, Google Books, etc.)',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['isbn', 'primary_provider'],
                properties: {
                  isbn: { type: 'string', example: '9780439064873', description: 'ISBN-10 or ISBN-13' },
                  title: { type: 'string', example: 'Harry Potter and the Sorcerer\'s Stone' },
                  subtitle: { type: 'string' },
                  publisher: { type: 'string', example: 'Scholastic' },
                  publication_date: { type: 'string', example: '1998-09-01' },
                  page_count: { type: 'integer', example: 309 },
                  format: { type: 'string', example: 'Paperback' },
                  language: { type: 'string', example: 'eng' },
                  primary_provider: { type: 'string', enum: ['isbndb', 'google-books', 'openlibrary', 'user-correction'], example: 'isbndb' },
                  cover_urls: { type: 'object', properties: { large: { type: 'string' }, medium: { type: 'string' }, small: { type: 'string' } } },
                  cover_source: { type: 'string' },
                  work_key: { type: 'string', description: 'OpenLibrary work key' },
                  openlibrary_edition_id: { type: 'string' },
                  amazon_asins: { type: 'array', items: { type: 'string' } },
                  google_books_volume_ids: { type: 'array', items: { type: 'string' } },
                  goodreads_edition_ids: { type: 'array', items: { type: 'string' } },
                  alternate_isbns: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Edition created' },
          '200': { description: 'Edition updated' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/work': {
      post: {
        summary: 'Store or update work metadata',
        description: 'Enrich a work (collection of editions) with metadata',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['work_key', 'title', 'primary_provider'],
                properties: {
                  work_key: { type: 'string', example: '/works/OL45883W' },
                  title: { type: 'string', example: 'Harry Potter and the Philosopher\'s Stone' },
                  subtitle: { type: 'string' },
                  description: { type: 'string' },
                  original_language: { type: 'string', example: 'eng' },
                  first_publication_year: { type: 'integer', example: 1997 },
                  subject_tags: { type: 'array', items: { type: 'string' } },
                  primary_provider: { type: 'string', enum: ['isbndb', 'google-books', 'openlibrary'], example: 'openlibrary' },
                  cover_urls: { type: 'object', properties: { large: { type: 'string' }, medium: { type: 'string' }, small: { type: 'string' } } },
                  cover_source: { type: 'string' },
                  openlibrary_work_id: { type: 'string' },
                  goodreads_work_ids: { type: 'array', items: { type: 'string' } },
                  amazon_asins: { type: 'array', items: { type: 'string' } },
                  google_books_volume_ids: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Work created' },
          '200': { description: 'Work updated' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/author': {
      post: {
        summary: 'Store or update author biographical data',
        description: 'Enrich an author with biographical metadata',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['author_key', 'name', 'primary_provider'],
                properties: {
                  author_key: { type: 'string', example: '/authors/OL23919A' },
                  name: { type: 'string', example: 'J.K. Rowling' },
                  gender: { type: 'string', example: 'female' },
                  nationality: { type: 'string', example: 'British' },
                  birth_year: { type: 'integer', example: 1965 },
                  death_year: { type: 'integer' },
                  bio: { type: 'string' },
                  bio_source: { type: 'string' },
                  author_photo_url: { type: 'string' },
                  primary_provider: { type: 'string', enum: ['isbndb', 'openlibrary', 'wikidata'], example: 'wikidata' },
                  openlibrary_author_id: { type: 'string' },
                  goodreads_author_ids: { type: 'array', items: { type: 'string' } },
                  wikidata_id: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Author created' },
          '200': { description: 'Author updated' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/queue': {
      post: {
        summary: 'Queue background enrichment job',
        description: 'Queue an enrichment task to be processed in the background',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['entity_type', 'entity_key', 'providers_to_try'],
                properties: {
                  entity_type: { type: 'string', enum: ['work', 'edition', 'author'], example: 'edition' },
                  entity_key: { type: 'string', example: '9780439064873', description: 'ISBN for editions, work_key for works, author_key for authors' },
                  providers_to_try: { type: 'array', items: { type: 'string' }, example: ['isbndb', 'google-books'], description: 'List of providers to attempt enrichment from' },
                  priority: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Job priority (1=lowest, 10=highest)' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Job queued successfully' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/status/{id}': {
      get: {
        summary: 'Get enrichment job status',
        description: 'Check the status of a queued enrichment job',
        tags: ['Enrichment'],
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Job ID (UUID)', schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Job status' },
          '404': { description: 'Job not found' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/covers/{isbn}/{size}': {
      get: {
        summary: 'Get cover image',
        description: 'Serve cover image from R2 storage. Redirects to placeholder if not found.',
        tags: ['Covers'],
        parameters: [
          { name: 'isbn', in: 'path', required: true, description: 'ISBN-10 or ISBN-13', schema: { type: 'string' } },
          { name: 'size', in: 'path', required: true, description: 'Image size', schema: { type: 'string', enum: ['small', 'medium', 'large', 'original'] } }
        ],
        responses: {
          '200': { description: 'Cover image (image/jpeg or image/png)' },
          '302': { description: 'Redirect to placeholder if not found' },
          '400': { description: 'Invalid ISBN or size' }
        }
      }
    },
    '/covers/{isbn}/status': {
      get: {
        summary: 'Check cover status',
        description: 'Check if a cover exists and get metadata',
        tags: ['Covers'],
        parameters: [
          { name: 'isbn', in: 'path', required: true, description: 'ISBN-10 or ISBN-13', schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Cover status and metadata' },
          '400': { description: 'Invalid ISBN' }
        }
      }
    },
    '/covers/{isbn}/process': {
      post: {
        summary: 'Process cover image',
        description: 'Download, process, and store cover image from providers (ISBNdb, Google Books, OpenLibrary)',
        tags: ['Covers'],
        parameters: [
          { name: 'isbn', in: 'path', required: true, description: 'ISBN-10 or ISBN-13', schema: { type: 'string' } },
          { name: 'force', in: 'query', description: 'Force reprocessing even if exists', schema: { type: 'boolean' } }
        ],
        responses: {
          '201': { description: 'Cover processed successfully' },
          '200': { description: 'Cover already exists' },
          '404': { description: 'No cover found from any provider' },
          '400': { description: 'Invalid ISBN' }
        }
      }
    },
    '/covers/batch': {
      post: {
        summary: 'Batch process covers',
        description: 'Process multiple cover images (max 10 per request)',
        tags: ['Covers'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['isbns'],
                properties: {
                  isbns: { type: 'array', items: { type: 'string' }, maxItems: 10, example: ['9780439064873', '9780141439518'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Batch processing results' },
          '400': { description: 'Invalid request' }
        }
      }
    },
    '/api/covers/process': {
      post: {
        summary: 'Process cover image from provider URL',
        description: 'Download, validate, and store cover image in R2 (bookstrack-covers-processed bucket)',
        tags: ['Covers'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['work_key', 'provider_url'],
                properties: {
                  work_key: { type: 'string', example: '/works/OL45804W' },
                  provider_url: { type: 'string', example: 'https://covers.openlibrary.org/b/id/8091323-L.jpg' },
                  isbn: { type: 'string', example: '9780439064873', description: 'Optional, for logging' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Cover processed successfully' },
          '400': { description: 'Invalid request' },
          '403': { description: 'Domain not allowed' },
          '500': { description: 'Processing error' }
        }
      }
    },
    '/api/covers/{work_key}/{size}': {
      get: {
        summary: 'Serve processed cover image',
        description: 'Retrieve cover image from R2 (bookstrack-covers-processed bucket)',
        tags: ['Covers'],
        parameters: [
          { name: 'work_key', in: 'path', required: true, schema: { type: 'string' }, description: 'OpenLibrary work key (without /works/ prefix)' },
          { name: 'size', in: 'path', required: true, schema: { type: 'string', enum: ['large', 'medium', 'small'] } }
        ],
        responses: {
          '200': { description: 'Cover image' },
          '302': { description: 'Redirect to placeholder' },
          '400': { description: 'Invalid size parameter' }
        }
      }
    }
  }
};

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
      message: e.message
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
        message: e.message
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
    const { isbn: rawIsbn, title, author, limit: validatedLimit } = c.req.valid('query');
    const isbn = rawIsbn?.replace(/[^0-9X]/gi, '').toUpperCase();
    const limit = Math.min(validatedLimit || 10, 50);

    if (!isbn && !title && !author) {
      return c.json({
        error: 'Missing query parameter',
        message: 'Please provide one of: isbn, title, or author.'
      }, 400);
    }

    const sql = c.get('sql');
    const start = Date.now();
    try {
      let results;

      if (isbn) {
        if (isbn.length !== 10 && isbn.length !== 13) {
          return c.json({
            error: 'Invalid ISBN format',
            provided: c.req.query('isbn')
          }, 400);
        }
        results = await sql`
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
        `;
      } else if (title) {
        // NOTE: ILIKE can be slow. For production, consider pg_trgm with GIN/GIST indexes.
        results = await sql`
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
          LIMIT ${limit}
        `;
      } else if (author) {
        results = await sql`
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
          LIMIT ${limit}
        `;
      }

      const queryDuration = Date.now() - start;

      if (results.length === 0) {
        return c.json({
          error: 'Not Found',
          query: { isbn, title, author }
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
            console.error(`Cover resolve failed for ${row.isbn}:`, e.message);
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

      return c.json({
        query: { isbn, title, author },
        query_duration_ms: queryDuration,
        count: formattedResults.length,
        results: formattedResults
      }, 200, {
        'cache-control': 'public, max-age=86400'
      });

    } catch (e) {
      console.error('Search query error:', e);
      return c.json({
        error: 'Database query failed',
        message: e.message
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

    const statusCode = result.status === 'processed' ? 201 :
                       result.status === 'already_exists' ? 200 :
                       result.status === 'no_cover' ? 404 : 500;

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
// Worker Entrypoint
// =================================================================================

// Export the type for Hono RPC type safety (consumed by bendv3)
// This allows strict type checking across service boundaries
export type AlexandriaAppType = typeof app;

export default {
  // HTTP request handler (Hono app)
  fetch: app.fetch,

  // Scheduled handler for cron triggers (enrichment queue consumer)
  async scheduled(event, env, ctx) {
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

  // Queue consumer handler for enrichment queue
  async queue(batch, env, ctx) {
    console.log(`Queue consumer triggered with ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
        console.log(`Processing queue message:`, message.body);
        // Add queue message processing logic here when needed
        message.ack();
      } catch (error) {
        console.error(`Failed to process queue message:`, error);
        message.retry();
      }
    }
  }
};


// =================================================================================
// Dashboard HTML Template
// =================================================================================

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alexandria API Dashboard</title>
  <style>
    :root {
      --primary-color: #2563eb; --primary-dark: #1d4ed8; --text-color: #1f2937;
      --bg-light: #f9fafb; --bg-white: #fff; --border-color: #e5e7eb;
      --green: #10b981; --red: #ef4444; --yellow: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6; color: var(--text-color); background: var(--bg-light);
      display: flex; flex-direction: column; min-height: 100vh;
    }
    .container { max-width: 1100px; margin: 0 auto; padding: 20px; flex-grow: 1; }
    header {
      background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
      color: white; padding: 40px 30px; border-radius: 12px; margin-bottom: 30px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.1);
    }
    h1 { font-size: 2.5em; margin-bottom: 10px; }
    .tagline { font-size: 1.2em; opacity: 0.9; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
    .card { background: var(--bg-white); padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .card h2 { color: var(--primary-color); margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 10px; font-size: 1.5em; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .stat-item .value { font-size: 2em; font-weight: bold; color: var(--primary-color); }
    .stat-item .label { color: #6b7280; font-size: 0.9em; }
    .status-indicator { display: flex; align-items: center; gap: 10px; font-size: 1.2em; font-weight: 500; }
    .status-dot { width: 14px; height: 14px; border-radius: 50%; animation: pulse 2s infinite; }
    .status-dot.ok { background-color: var(--green); box-shadow: 0 0 8px var(--green); }
    .status-dot.error { background-color: var(--red); box-shadow: 0 0 8px var(--red); }
    .status-dot.loading { background-color: var(--yellow); box-shadow: 0 0 8px var(--yellow); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .search-form input, .search-form select, .search-form button {
      width: 100%; padding: 12px; font-size: 1em; margin-bottom: 10px; border-radius: 6px;
      border: 1px solid #d1d5db;
    }
    .search-form button { background: var(--primary-color); color: white; border: 0; cursor: pointer; transition: background 0.2s; }
    .search-form button:hover { background: var(--primary-dark); }
    #results { margin-top: 20px; font-family: monospace; white-space: pre-wrap; word-break: break-all; background: #111827; color: #f3f4f6; padding: 15px; border-radius: 6px; max-height: 400px; overflow-y: auto; }
    .spinner { border: 4px solid #f3f3f3; border-top: 4px solid var(--primary-color); border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    footer { text-align: center; padding: 20px; margin-top: 30px; color: #6b7280; border-top: 1px solid var(--border-color); }
    a { color: var(--primary-color); text-decoration: none; }
    .example-link { display: inline-block; margin: 0 10px 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📚 Alexandria API Dashboard</h1>
      <div class="tagline">Real-time stats and interactive search for 54+ million books from OpenLibrary.</div>
    </header>

    <div class="grid">
      <div class="card" style="grid-column: 1 / -1;">
        <h2>System Status</h2>
        <div id="status-container">
          <div class="status-indicator">
            <div class="status-dot loading"></div>
            <span>Checking database connection...</span>
          </div>
        </div>
      </div>

      <div class="card" style="grid-column: span 2;">
        <h2>Live Database Stats</h2>
        <div id="stats-container" class="stat-grid">
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">Book Editions</div></div>
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">ISBN Records</div></div>
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">Literary Works</div></div>
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">Authors</div></div>
        </div>
        <p id="stats-timing" style="margin-top: 15px; font-size: 0.9em; color: #6b7280;"></p>
      </div>

      <div class="card" style="grid-column: span 2;">
        <h2>API Query Tester</h2>
        <form id="search-form" class="search-form">
          <select id="search-type" name="type">
            <option value="isbn">ISBN</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
          <input type="text" id="search-query" name="query" placeholder="Enter search term..." required>
          <button type="submit">Search</button>
        </form>
        <div id="results-container" style="display: none;">
          <h3 style="margin: 10px 0;">Results</h3>
          <pre id="results"></pre>
        </div>
      </div>
      
      <div class="card" style="grid-column: 1 / -1;">
        <h2>API Documentation</h2>
        <p>This API provides access to a self-hosted mirror of the OpenLibrary dataset via Cloudflare's global edge network. All queries are routed through Hyperdrive for optimal performance and connection pooling.</p>
        <p style="margin-top: 15px;">
          <a href="/openapi.json" class="example-link">View OpenAPI Spec</a> | 
          <a href="https://github.com/jukasdrj/alexandria" target="_blank" class="example-link">View on GitHub</a>
        </p>
        <h3 style="margin-top: 20px; color: var(--text-color);">Quick Examples</h3>
        <ul style="margin: 10px 0 0 20px;">
          <li><code>/api/search?isbn=9780439064873</code> - Search by ISBN</li>
          <li><code>/api/search?title=harry+potter</code> - Search by title</li>
          <li><code>/api/search?author=rowling</code> - Search by author</li>
          <li><code>/api/stats</code> - Get database statistics</li>
          <li><code>/health</code> - Check system health</li>
        </ul>
      </div>
    </div>
  </div>
  <footer>
    <p><strong>Powered by:</strong> Cloudflare Workers + Hyperdrive + PostgreSQL (self-hosted)</p>
    <p><strong>Infrastructure:</strong> Cloudflare Tunnel → Unraid Server (192.168.1.240)</p>
  </footer>

  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const statusContainer = document.getElementById('status-container');
      const statsContainer = document.getElementById('stats-container');
      const statsTiming = document.getElementById('stats-timing');
      const searchForm = document.getElementById('search-form');
      const resultsContainer = document.getElementById('results-container');
      const resultsEl = document.getElementById('results');

      const formatNumber = (num) => num ? new Intl.NumberFormat('en-US').format(num) : 'N/A';

      // Fetch health status
      async function checkHealth() {
        try {
          const res = await fetch('/health');
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Health check failed');
          
          statusContainer.innerHTML = \`
            <div class="status-indicator">
              <div class="status-dot ok"></div>
              <span>Database connected via Hyperdrive (Latency: \${data.hyperdrive_latency_ms}ms)</span>
            </div>\`;
        } catch (error) {
          statusContainer.innerHTML = \`
            <div class="status-indicator">
              <div class="status-dot error"></div>
              <span>Database connection error: \${error.message}</span>
            </div>\`;
        }
      }

      // Fetch database stats
      async function loadStats() {
        try {
          const res = await fetch('/api/stats');
          const data = await res.json();
          if (!res.ok) throw new Error('Failed to load stats');

          statsContainer.innerHTML = \`
            <div class="stat-item"><div class="value">\${formatNumber(data.editions)}</div><div class="label">Book Editions</div></div>
            <div class="stat-item"><div class="value">\${formatNumber(data.isbns)}</div><div class="label">ISBN Records</div></div>
            <div class="stat-item"><div class="value">\${formatNumber(data.works)}</div><div class="label">Literary Works</div></div>
            <div class="stat-item"><div class="value">\${formatNumber(data.authors)}</div><div class="label">Authors</div></div>
          \`;
          statsTiming.textContent = \`Stats query completed in \${data.query_duration_ms}ms. Cached for 24 hours.\`;
        } catch (error) {
          statsContainer.innerHTML = '<p style="color: var(--red);">Could not load database stats. Please check system status.</p>';
        }
      }

      // Handle search form submission
      searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('search-type').value;
        const query = document.getElementById('search-query').value;
        
        resultsContainer.style.display = 'block';
        resultsEl.innerHTML = '<div class="spinner"></div>';
        
        try {
          const res = await fetch(\`/api/search?\${type}=\${encodeURIComponent(query)}\`);
          const data = await res.json();
          
          if (!res.ok) {
              resultsEl.textContent = JSON.stringify({ status: res.status, ...data }, null, 2);
          } else {
              resultsEl.textContent = JSON.stringify(data, null, 2);
          }

        } catch (error) {
          resultsEl.textContent = JSON.stringify({ error: 'Request failed', message: error.message }, null, 2);
        }
      });

      // Initial data load
      checkHealth();
      loadStats();
      
      // Refresh stats every 5 minutes
      setInterval(loadStats, 300000);
    });
  </script>
</body>
</html>`;
}
