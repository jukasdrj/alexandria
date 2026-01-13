/**
 * Books Routes - ISBNdb book search and new releases harvesting
 *
 * Provides endpoints for searching ISBNdb and harvesting new releases
 * that aren't in the OpenLibrary dump.
 */

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
import { enrichWork, enrichEdition } from '../services/enrichment-service.js';
import { findOrCreateWork, linkWorkToAuthors } from '../services/work-utils.js';
import { getQuotaManager } from '../services/quota-manager.js';

// =================================================================================
// Types
// =================================================================================

interface ISBNdbBook {
  isbn?: string;
  isbn13?: string;
  title?: string;
  title_long?: string;
  authors?: string[];
  publisher?: string;
  date_published?: string;
  pages?: number;
  language?: string;
  synopsis?: string;
  image?: string;
  image_original?: string;
  subjects?: string[];
  binding?: string;
  dewey_decimal?: string[];
  related?: Record<string, string>;
}

interface ISBNdbSearchResponse {
  books?: ISBNdbBook[];
  total?: number;
}

// =================================================================================
// Schemas
// =================================================================================

const SearchBooksRequestSchema = z.object({
  query: z.string().min(1).describe('Search query (e.g., "2025-09" for September 2025)'),
  column: z.enum(['title', 'author', 'date_published', 'subject']).default('date_published')
    .describe('Column to search in'),
  max_pages: z.number().int().min(1).max(100).default(10)
    .describe('Maximum pages to fetch (100 results per page)'),
  language: z.string().optional().describe('Filter by language code (e.g., "en")'),
}).openapi('SearchBooksRequest');

const EnrichNewReleasesRequestSchema = z.object({
  start_month: z.string().regex(/^\d{4}-\d{2}$/).describe('Start month (YYYY-MM format, e.g., "2025-09")'),
  end_month: z.string().regex(/^\d{4}-\d{2}$/).describe('End month (YYYY-MM format, e.g., "2025-12")'),
  max_pages_per_month: z.number().int().min(1).max(100).default(20)
    .describe('Maximum pages per month (100 results per page, 10K limit)'),
  subjects: z.array(z.string()).optional()
    .describe('Optional subjects to filter by (will query each subject separately)'),
  skip_existing: z.boolean().default(true)
    .describe('Skip ISBNs already in Alexandria'),
}).openapi('EnrichNewReleasesRequest');

const BookSchema = z.object({
  isbn: z.string(),
  title: z.string(),
  authors: z.array(z.string()).optional(),
  publisher: z.string().optional(),
  date_published: z.string().optional(),
  has_cover: z.boolean(),
}).openapi('Book');

const SearchBooksDataSchema = z.object({
  query: z.string(),
  column: z.string(),
  books_found: z.number(),
  pages_fetched: z.number(),
  books: z.array(BookSchema),
}).openapi('SearchBooksData');

const QuotaStatusSchema = z.object({
  used_today: z.number(),
  remaining: z.number(),
  limit: z.number(),
  buffer_remaining: z.number(),
}).openapi('QuotaStatus');

const EnrichNewReleasesDataSchema = z.object({
  start_month: z.string(),
  end_month: z.string(),
  months_processed: z.number(),
  total_books_found: z.number(),
  already_existed: z.number(),
  newly_enriched: z.number(),
  covers_queued: z.number(),
  failed: z.number(),
  api_calls: z.number(),
  duration_ms: z.number(),
  quota_status: QuotaStatusSchema.optional().describe('Final quota status'),
  quota_exhausted: z.boolean().optional().describe('Whether quota was exhausted during operation'),
}).openapi('EnrichNewReleasesData');

const SearchBooksSuccessSchema = createSuccessSchema(SearchBooksDataSchema, 'SearchBooksSuccess');
const EnrichNewReleasesSuccessSchema = createSuccessSchema(EnrichNewReleasesDataSchema, 'EnrichNewReleasesSuccess');

// =================================================================================
// Route Definitions
// =================================================================================

const searchBooksRoute = createRoute({
  method: 'post',
  path: '/api/books/search',
  tags: ['Books'],
  summary: 'Search ISBNdb books',
  description: `
Search ISBNdb for books by various criteria.

**Column options:**
- \`date_published\`: Search by publication date (e.g., "2025-09")
- \`title\`: Search by title
- \`author\`: Search by author name
- \`subject\`: Search by subject/genre

**Example - Find September 2025 releases:**
\`\`\`json
{"query": "2025-09", "column": "date_published", "max_pages": 10}
\`\`\`
  `,
  request: {
    body: {
      content: {
        'application/json': {
          schema: SearchBooksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Books found',
      content: {
        'application/json': {
          schema: SearchBooksSuccessSchema,
        },
      },
    },
    429: {
      description: 'Rate limited by ISBNdb',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: 'Search failed',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const enrichNewReleasesRoute = createRoute({
  method: 'post',
  path: '/api/books/enrich-new-releases',
  tags: ['Books'],
  summary: 'Enrich new releases by date range',
  description: `
Fetch and enrich books published in a date range from ISBNdb.

Use this to fill the gap between your OpenLibrary dump and today.

**Example - Enrich Sep-Dec 2025 releases:**
\`\`\`json
{
  "start_month": "2025-09",
  "end_month": "2025-12",
  "max_pages_per_month": 20
}
\`\`\`

**With subject filtering (for more coverage):**
\`\`\`json
{
  "start_month": "2025-09",
  "end_month": "2025-12",
  "subjects": ["fiction", "mystery", "romance", "science fiction", "fantasy"]
}
\`\`\`
  `,
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichNewReleasesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'New releases enriched',
      content: {
        'application/json': {
          schema: EnrichNewReleasesSuccessSchema,
        },
      },
    },
    429: {
      description: 'Rate limited or quota exhausted',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: 'Enrichment failed',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

// POST /api/books/search - Search ISBNdb books
app.openapi(searchBooksRoute, async (c) => {
  const logger = c.get('logger');

  try {
    const { query, column, max_pages, language } = c.req.valid('json');

    const apiKey = await c.env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      return createErrorResponse(c, ErrorCode.INTERNAL_ERROR, 'ISBNdb API key not configured');
    }

    const pageSize = 100;
    const books: Array<{
      isbn: string;
      title: string;
      authors?: string[];
      publisher?: string;
      date_published?: string;
      has_cover: boolean;
    }> = [];

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= max_pages) {
      let url = `https://api.premium.isbndb.com/books/${encodeURIComponent(query)}?page=${page}&pageSize=${pageSize}&column=${column}`;
      if (language) {
        url += `&language=${encodeURIComponent(language)}`;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 404) break;
      if (response.status === 429) {
        return createErrorResponse(c, ErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limited by ISBNdb');
      }
      if (response.status === 403) {
        return createErrorResponse(c, ErrorCode.RATE_LIMIT_EXCEEDED, 'ISBNdb quota exhausted');
      }
      if (!response.ok) {
        return createErrorResponse(c, ErrorCode.ISBNDB_ERROR, `ISBNdb error: ${response.status}`);
      }

      const data = await response.json() as ISBNdbSearchResponse;

      if (data.books && Array.isArray(data.books)) {
        for (const book of data.books) {
          const isbn = book.isbn13 || book.isbn;
          if (isbn) {
            books.push({
              isbn,
              title: book.title_long || book.title || 'Unknown',
              authors: book.authors,
              publisher: book.publisher,
              date_published: book.date_published,
              has_cover: !!(book.image_original || book.image),
            });
          }
        }
      }

      const booksInResponse = data.books?.length || 0;
      const total = data.total || 0;
      hasMore = booksInResponse === pageSize || (total > 0 && books.length < total && books.length < 10000);

      page++;

      if (hasMore && page <= max_pages) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    logger.info('[SearchBooks] Complete', { query, column, books_found: books.length, pages: page - 1 });

    return createSuccessResponse(c, {
      query,
      column,
      books_found: books.length,
      pages_fetched: page - 1,
      books,
    });
  } catch (error) {
    logger.error('[SearchBooks] Error', { error: error instanceof Error ? error.message : String(error) });
    return createErrorResponse(c, ErrorCode.INTERNAL_ERROR, 'Search failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/books/enrich-new-releases - Enrich books by date range
app.openapi(enrichNewReleasesRoute, async (c) => {
  const startTime = Date.now();
  const logger = c.get('logger');

  try {
    const { start_month, end_month, max_pages_per_month, subjects, skip_existing } = c.req.valid('json');

    const apiKey = await c.env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      return createErrorResponse(c, ErrorCode.INTERNAL_ERROR, 'ISBNdb API key not configured');
    }

    const sql = c.get('sql');

    // Initialize singleton quota manager
    const quotaManager = getQuotaManager(c.env.QUOTA_KV, c.get('logger'));

    // Generate list of months to process
    const months: string[] = [];
    const [startYear, startMo] = start_month.split('-').map(Number);
    const [endYear, endMo] = end_month.split('-').map(Number);

    let year = startYear;
    let month = startMo;
    while (year < endYear || (year === endYear && month <= endMo)) {
      months.push(`${year}-${String(month).padStart(2, '0')}`);
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }

    logger.info('[EnrichNewReleases] Starting', { months, subjects, max_pages_per_month });

    // Calculate total pages needed and pre-check quota
    const queryCount = subjects && subjects.length > 0
      ? months.length * subjects.length
      : months.length;
    const estimatedApiCalls = queryCount * max_pages_per_month;

    logger.info('[EnrichNewReleases] Quota pre-check', {
      months: months.length,
      queries_per_month: queryCount / months.length,
      total_queries: queryCount,
      estimated_api_calls: estimatedApiCalls,
    });

    // Pre-check quota before starting
    const preCheckResult = await quotaManager.checkQuota(estimatedApiCalls, false);
    if (!preCheckResult.allowed) {
      logger.warn('[EnrichNewReleases] Pre-check failed', {
        reason: preCheckResult.reason,
        quota_status: preCheckResult.status,
      });
      return createSuccessResponse(c, {
        start_month,
        end_month,
        months_processed: 0,
        total_books_found: 0,
        already_existed: 0,
        newly_enriched: 0,
        covers_queued: 0,
        failed: 0,
        api_calls: 0,
        duration_ms: Date.now() - startTime,
        quota_status: {
          used_today: preCheckResult.status.used_today,
          remaining: preCheckResult.status.remaining,
          limit: preCheckResult.status.limit,
          buffer_remaining: preCheckResult.status.buffer_remaining,
        },
        quota_exhausted: true,
      });
    }

    // Results tracking
    const results = {
      start_month,
      end_month,
      months_processed: 0,
      total_books_found: 0,
      already_existed: 0,
      newly_enriched: 0,
      covers_queued: 0,
      failed: 0,
      api_calls: 0,
      duration_ms: 0,
      quota_status: undefined as any,
      quota_exhausted: false,
    };

    // Process each month
    for (const monthStr of months) {
      const queries = subjects && subjects.length > 0
        ? subjects.map(s => ({ query: `${monthStr} ${s}`, column: 'date_published' as const }))
        : [{ query: monthStr, column: 'date_published' as const }];

      for (const { query, column } of queries) {
        // Check quota before starting this month's queries
        const monthQuotaCheck = await quotaManager.checkQuota(max_pages_per_month, false);
        if (!monthQuotaCheck.allowed) {
          logger.warn('[EnrichNewReleases] Quota exhausted mid-operation', {
            month: monthStr,
            months_processed: results.months_processed,
            api_calls: results.api_calls,
            reason: monthQuotaCheck.reason,
          });
          results.duration_ms = Date.now() - startTime;
          results.quota_status = {
            used_today: monthQuotaCheck.status.used_today,
            remaining: monthQuotaCheck.status.remaining,
            limit: monthQuotaCheck.status.limit,
            buffer_remaining: monthQuotaCheck.status.buffer_remaining,
          };
          results.quota_exhausted = true;
          return createSuccessResponse(c, results);
        }

        const pageSize = 100;
        let page = 1;
        let hasMore = true;
        const monthBooks: ISBNdbBook[] = [];

        // Fetch all pages for this query
        while (hasMore && page <= max_pages_per_month) {
          const url = `https://api.premium.isbndb.com/books/${encodeURIComponent(query)}?page=${page}&pageSize=${pageSize}&column=${column}`;

          const response = await fetch(url, {
            headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
          });

          // Record API call
          results.api_calls++;
          await quotaManager.recordApiCall(1);

          if (response.status === 404) break;
          if (response.status === 429 || response.status === 403) {
            logger.warn('[EnrichNewReleases] Quota/rate limit hit by ISBNdb', {
              month: monthStr,
              page,
              api_calls: results.api_calls,
              status: response.status,
            });
            results.duration_ms = Date.now() - startTime;
            const finalStatus = await quotaManager.getQuotaStatus();
            results.quota_status = {
              used_today: finalStatus.used_today,
              remaining: finalStatus.remaining,
              limit: finalStatus.limit,
              buffer_remaining: finalStatus.buffer_remaining,
            };
            results.quota_exhausted = true;
            return createSuccessResponse(c, results);
          }
          if (!response.ok) break;

          const data = await response.json() as ISBNdbSearchResponse;

          if (data.books && Array.isArray(data.books)) {
            monthBooks.push(...data.books.filter(b => b.isbn13 || b.isbn));
          }

          const booksInResponse = data.books?.length || 0;
          hasMore = booksInResponse === pageSize && monthBooks.length < 10000;
          page++;

          if (hasMore) await new Promise(r => setTimeout(r, 350));
        }

        results.total_books_found += monthBooks.length;

        // Filter existing ISBNs
        let booksToEnrich = monthBooks;
        if (skip_existing && monthBooks.length > 0) {
          const allISBNs = monthBooks.map(b => b.isbn13 || b.isbn).filter(Boolean) as string[];
          const existingResult = await sql`
            SELECT isbn FROM enriched_editions WHERE isbn IN ${sql(allISBNs)}
          `;
          const existingSet = new Set((existingResult as unknown as Array<{ isbn: string }>).map((r) => r.isbn));
          results.already_existed += existingSet.size;
          booksToEnrich = monthBooks.filter(b => {
            const isbn = b.isbn13 || b.isbn;
            return isbn && !existingSet.has(isbn);
          });
        }

        // Create request-scoped caches for work/author deduplication
        const localAuthorKeyCache = new Map<string, string>();
        const localWorkKeyCache = new Map<string, string>();

        // Enrich new books
        for (const book of booksToEnrich) {
          const isbn = book.isbn13 || book.isbn;
          if (!isbn) continue;

          try {
            const { workKey, isNew: isNewWork } = await findOrCreateWork(
              sql, isbn, book.title || 'Unknown', book.authors || [], localWorkKeyCache, localAuthorKeyCache
            );

            if (isNewWork) {
              await enrichWork(sql, {
                work_key: workKey,
                title: book.title || 'Unknown',
                description: book.synopsis,
                subject_tags: book.subjects,
                primary_provider: 'isbndb',
              }, c.get('logger'));
            }

            if (book.authors && book.authors.length > 0) {
              await linkWorkToAuthors(sql, workKey, book.authors, localAuthorKeyCache);
            }

            const hasCover = !!(book.image_original || book.image);
            await enrichEdition(sql, {
              isbn,
              title: book.title || 'Unknown',
              publisher: book.publisher,
              publication_date: book.date_published,
              page_count: book.pages,
              language: book.language,
              primary_provider: 'isbndb',
              cover_urls: hasCover ? {
                original: book.image_original,
                large: book.image,
                medium: book.image,
                small: book.image,
              } : undefined,
              cover_source: hasCover ? 'isbndb' : undefined,
              work_key: workKey,
              subjects: book.subjects,
              binding: book.binding,
              dewey_decimal: book.dewey_decimal,
              related_isbns: book.related,
            }, c.get('logger'), c.env);

            results.newly_enriched++;

            if (hasCover) {
              try {
                await c.env.COVER_QUEUE.send({
                  isbn,
                  work_key: workKey,
                  provider_url: book.image_original || book.image,
                  priority: 'normal',
                  source: 'new_releases',
                });
                results.covers_queued++;
              } catch {
                // Cover queue failure is non-fatal
              }
            }
          } catch {
            results.failed++;
          }
        }

        logger.info('[EnrichNewReleases] Month complete', {
          month: monthStr,
          query,
          found: monthBooks.length,
          enriched: booksToEnrich.length,
        });
      }

      results.months_processed++;
    }

    results.duration_ms = Date.now() - startTime;

    // Get final quota status
    const finalStatus = await quotaManager.getQuotaStatus();
    results.quota_status = {
      used_today: finalStatus.used_today,
      remaining: finalStatus.remaining,
      limit: finalStatus.limit,
      buffer_remaining: finalStatus.buffer_remaining,
    };

    logger.info('[EnrichNewReleases] Complete', { ...results, quota_status: finalStatus });

    return createSuccessResponse(c, results);
  } catch (error) {
    logger.error('[EnrichNewReleases] Error', { error: error instanceof Error ? error.message : String(error) });
    return createErrorResponse(c, ErrorCode.INTERNAL_ERROR, 'Enrichment failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default app;
