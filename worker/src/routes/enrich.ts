/**
 * Enrichment API Routes
 *
 * Handles metadata enrichment from external providers (ISBNdb, Google Books, OpenLibrary)
 * Includes queue-based async processing and direct batch enrichment
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  EnrichEditionSchema,
  EnrichWorkSchema,
  EnrichAuthorSchema,
  QueueEnrichmentSchema,
  QueueBatchSchema,
  BatchDirectSchema,
  CoverHarvestSchema,
  EnrichmentResultSchema,
  QueueResultSchema,
  QueueBatchResultSchema,
  EnrichmentStatusSchema,
  BatchDirectResultSchema,
  CoverHarvestResultSchema,
  ErrorResponseSchema,
} from '../schemas/enrich.js';
import { QuotaManager } from '../services/quota-manager.js';
import {
  handleEnrichEdition,
  handleEnrichWork,
  handleEnrichAuthor,
  handleQueueEnrichment,
  handleGetEnrichmentStatus,
} from '../services/enrich-handlers.js';
import { normalizeISBN, validateISBNBatch } from '../../lib/isbn-utils.js';
import { enrichEdition, enrichWork } from '../services/enrichment-service.js';
import { fetchISBNdbBatch } from '../../services/batch-isbndb.js';
import { createQuotaManager } from '../services/quota-manager.js';
import { extractGoogleBooksCategories } from '../../services/google-books.js';
import { updateWorkSubjects } from '../services/subject-enrichment.js';
import { fetchBookByISBN } from '../../services/wikidata.js';
import type { WikidataBookMetadata } from '../../types/open-apis.js';

// Create enrichment router
export const enrichRoutes = new OpenAPIHono<AppBindings>();

// =================================================================================
// POST /api/enrich/edition - Store edition metadata
// =================================================================================

const enrichEditionRoute = createRoute({
  method: 'post',
  path: '/api/enrich/edition',
  tags: ['Enrichment'],
  summary: 'Enrich Edition',
  description: 'Store or update edition metadata in enriched_editions table. Automatically queues cover download if cover URLs provided.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichEditionSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Edition updated successfully',
      content: {
        'application/json': {
          schema: EnrichmentResultSchema,
        },
      },
    },
    201: {
      description: 'Edition created successfully',
      content: {
        'application/json': {
          schema: EnrichmentResultSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(enrichEditionRoute, handleEnrichEdition);

// =================================================================================
// POST /api/enrich/work - Store work metadata
// =================================================================================

const enrichWorkRoute = createRoute({
  method: 'post',
  path: '/api/enrich/work',
  tags: ['Enrichment'],
  summary: 'Enrich Work',
  description: 'Store or update work metadata in enriched_works table',
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichWorkSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Work updated successfully',
      content: {
        'application/json': {
          schema: EnrichmentResultSchema,
        },
      },
    },
    201: {
      description: 'Work created successfully',
      content: {
        'application/json': {
          schema: EnrichmentResultSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(enrichWorkRoute, handleEnrichWork);

// =================================================================================
// POST /api/enrich/author - Store author metadata
// =================================================================================

const enrichAuthorRoute = createRoute({
  method: 'post',
  path: '/api/enrich/author',
  tags: ['Enrichment'],
  summary: 'Enrich Author',
  description: 'Store or update author biographical data in enriched_authors table',
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichAuthorSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Author updated successfully',
      content: {
        'application/json': {
          schema: EnrichmentResultSchema,
        },
      },
    },
    201: {
      description: 'Author created successfully',
      content: {
        'application/json': {
          schema: EnrichmentResultSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(enrichAuthorRoute, handleEnrichAuthor);

// =================================================================================
// POST /api/enrich/queue - Queue background enrichment
// =================================================================================

const queueEnrichmentRoute = createRoute({
  method: 'post',
  path: '/api/enrich/queue',
  tags: ['Enrichment'],
  summary: 'Queue Enrichment',
  description: 'Queue background enrichment job for async processing',
  request: {
    body: {
      content: {
        'application/json': {
          schema: QueueEnrichmentSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Job queued successfully',
      content: {
        'application/json': {
          schema: QueueResultSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(queueEnrichmentRoute, handleQueueEnrichment);

// =================================================================================
// POST /api/enrich/queue/batch - Batch queue enrichment
// =================================================================================

const queueBatchRoute = createRoute({
  method: 'post',
  path: '/api/enrich/queue/batch',
  tags: ['Enrichment'],
  summary: 'Batch Queue Enrichment',
  description: 'Queue multiple enrichment jobs (max 100 per request). Each ISBN is queued for async processing through Cloudflare Queues.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: QueueBatchSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch queued',
      content: {
        'application/json': {
          schema: QueueBatchResultSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(queueBatchRoute, async (c) => {
  try {
    const body = c.req.valid('json');
    const { books } = body;

    const logger = c.get('logger');
    const queued: string[] = [];
    const failed: Array<{ isbn: string; error: string }> = [];

    for (const book of books) {
      const { isbn, priority = 'normal', source = 'unknown', title, author } = book;

      // Validate ISBN using utility
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        failed.push({ isbn: isbn || 'undefined', error: 'Invalid ISBN format' });
        continue;
      }

      try {
        // Queue enrichment processing
        await c.env.ENRICHMENT_QUEUE.send({
          isbn: normalizedISBN,
          entity_type: 'edition',
          entity_key: normalizedISBN,
          providers_to_try: ['isbndb', 'google-books', 'openlibrary'],
          priority,
          source,
          title,
          author,
          queued_at: new Date().toISOString(),
        });

        queued.push(normalizedISBN);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Queue send failed', { isbn: normalizedISBN, error: message });
        failed.push({ isbn: normalizedISBN, error: message });
      }
    }

    return c.json({
      queued: queued.length,
      failed: failed.length,
      errors: failed,
    });
  } catch (error) {
    const logger = c.get('logger');
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Batch queue operation failed', { error: message });
    return c.json(
      {
        success: false,
        error: 'Queue operation failed',
        message,
      },
      500
    );
  }
});

// =================================================================================
// GET /api/enrich/status/:id - Check enrichment status
// =================================================================================

const enrichmentStatusRoute = createRoute({
  method: 'get',
  path: '/api/enrich/status/{id}',
  tags: ['Enrichment'],
  summary: 'Get Enrichment Status',
  description: 'Check the status of a queued enrichment job',
  responses: {
    200: {
      description: 'Job status retrieved',
      content: {
        'application/json': {
          schema: EnrichmentStatusSchema,
        },
      },
    },
    404: {
      description: 'Job not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(enrichmentStatusRoute, handleGetEnrichmentStatus);

// =================================================================================
// POST /api/enrich/batch-direct - Direct batch enrichment
// =================================================================================

const batchDirectRoute = createRoute({
  method: 'post',
  path: '/api/enrich/batch-direct',
  tags: ['Enrichment'],
  summary: 'Batch Direct Enrichment',
  description: `Direct batch enrichment that bypasses queue for maximum efficiency. Fetches metadata for up to 1000 ISBNs in a single ISBNdb Premium API call (10x more efficient than queue).

**Use Cases:**
- Bulk author bibliography harvesting
- Large imports (> 100 ISBNs)
- High-priority batch operations

**Queue Alternative:** For < 100 ISBNs, use /api/enrich/queue/batch for async processing.`,
  request: {
    body: {
      content: {
        'application/json': {
          schema: BatchDirectSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch processed successfully',
      content: {
        'application/json': {
          schema: BatchDirectResultSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(batchDirectRoute, async (c) => {
  const startTime = Date.now();
  const logger = c.get('logger');

  try {
    const body = c.req.valid('json');
    const { isbns, source = 'batch-direct' } = body;

    // Normalize and validate ISBNs using utility
    const { valid: normalizedISBNs, invalid: invalidISBNs } = validateISBNBatch(isbns);

    if (normalizedISBNs.length === 0) {
      return c.json({ success: false, error: 'No valid ISBNs provided', invalid: invalidISBNs }, 400);
    }

    logger.info('Starting batch direct enrichment', {
      count: normalizedISBNs.length,
      source,
    });

    // Initialize QuotaManager and check quota availability
    const quotaManager = createQuotaManager(c.env.QUOTA_KV);
    const quotaCheck = await quotaManager.checkQuota(1, true); // 1 call for batch (regardless of ISBN count)

    if (!quotaCheck.allowed) {
      logger.warn('Batch direct enrichment blocked by quota limit', {
        reason: quotaCheck.reason,
        status: quotaCheck.status,
      });
      return c.json(
        {
          success: false,
          error: 'Quota exhausted',
          message: quotaCheck.reason,
          quota: quotaCheck.status,
        },
        429
      );
    }

    logger.info('Quota reserved for batch direct enrichment', {
      used: quotaCheck.status.used_today,
      remaining: quotaCheck.status.remaining,
      buffer_remaining: quotaCheck.status.buffer_remaining,
    });

    // Fetch all ISBNs in a single ISBNdb API call (10x efficiency!)
    const batchStartTime = Date.now();
    const enrichmentData = await fetchISBNdbBatch(normalizedISBNs, c.env);
    const batchDuration = Date.now() - batchStartTime;

    logger.info('ISBNdb batch complete', {
      found: enrichmentData.size,
      requested: normalizedISBNs.length,
      duration_ms: batchDuration,
    });

    // Parallel Wikidata genre enrichment (non-blocking)
    const wikidataStartTime = Date.now();
    const wikidataData = new Map<string, WikidataBookMetadata>();

    // Fetch Wikidata metadata for all ISBNs in parallel
    const wikidataPromises = normalizedISBNs.map(isbn =>
      fetchBookByISBN(isbn, c.env, logger)
        .then(metadata => ({ isbn, metadata }))
        .catch(error => {
          logger.warn('Wikidata fetch failed for ISBN', {
            isbn,
            error: error instanceof Error ? error.message : String(error),
          });
          return { isbn, metadata: null };
        })
    );

    const wikidataResults = await Promise.allSettled(wikidataPromises);
    for (const result of wikidataResults) {
      if (result.status === 'fulfilled' && result.value.metadata) {
        wikidataData.set(result.value.isbn, result.value.metadata);
      }
    }

    const wikidataDuration = Date.now() - wikidataStartTime;
    logger.info('Wikidata batch fetch complete', {
      found: wikidataData.size,
      requested: normalizedISBNs.length,
      durationMs: wikidataDuration,
    });

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
      duration_ms: 0,
      quota: quotaCheck.status,
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
        }, c.get('logger'));

        // Then enrich the edition (stores metadata + cover URLs)
        await enrichEdition(
          sql,
          {
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
          },
          c.get('logger'),
          c.env
        );

        // Phase 2: Enrich subjects with Google Books categories (opportunistic, non-blocking)
        logger.info('[DEBUG] Google Books check', {
          flag_value: c.env.ENABLE_GOOGLE_BOOKS_ENRICHMENT,
          flag_type: typeof c.env.ENABLE_GOOGLE_BOOKS_ENRICHMENT,
          will_run: c.env.ENABLE_GOOGLE_BOOKS_ENRICHMENT === 'true'
        });

        if (c.env.ENABLE_GOOGLE_BOOKS_ENRICHMENT === 'true') {
          logger.info('[DEBUG] Google Books enrichment starting', { isbn });
          try {
            const googleStartTime = Date.now();
            const googleCategories = await extractGoogleBooksCategories(isbn, c.env, logger);
            const googleDuration = Date.now() - googleStartTime;

            if (googleCategories.length > 0) {
              await updateWorkSubjects(sql, workKey, googleCategories, 'google-books', logger);

              logger.info('Google Books subject enrichment complete', {
                isbn,
                work_key: workKey,
                categories_count: googleCategories.length,
                duration_ms: googleDuration,
              });

              // Track analytics for donation calculation
              if (c.env.ANALYTICS) {
                await c.env.ANALYTICS.writeDataPoint({
                  indexes: ['google_books_subject_enrichment'],
                  blobs: [`isbn_${isbn}`, `work_${workKey}`, `categories_${googleCategories.length}`],
                  doubles: [googleCategories.length, googleDuration]
                });
              }
            }
          } catch (googleError) {
            // Log but don't fail enrichment if Google Books fails
            logger.warn('Google Books subject enrichment failed (non-blocking)', {
              isbn,
              error: googleError instanceof Error ? googleError.message : String(googleError),
            });
          }
        }

        // Phase 3: Enrich genres with Wikidata (opportunistic, non-blocking)
        const wikidataMetadata = wikidataData.get(isbn);
        if (wikidataMetadata?.genre_names || wikidataMetadata?.subject_names) {
          try {
            const wikidataGenres = [
              ...(wikidataMetadata.genre_names || []),
              ...(wikidataMetadata.subject_names || [])
            ];

            if (wikidataGenres.length > 0) {
              await updateWorkSubjects(sql, workKey, wikidataGenres, 'wikidata', logger);

              logger.info('Wikidata genre enrichment complete', {
                isbn,
                work_key: workKey,
                genres_count: wikidataGenres.length,
                duration_ms: 0, // Already fetched in batch
              });

              // Track analytics for donation calculation
              if (c.env.ANALYTICS) {
                await c.env.ANALYTICS.writeDataPoint({
                  indexes: ['wikidata_genre_enrichment'],
                  blobs: [`isbn_${isbn}`, `work_${workKey}`, `genres_${wikidataGenres.length}`],
                  doubles: [wikidataGenres.length, wikidataDuration]
                });
              }
            }
          } catch (wikidataError) {
            // Log but don't fail enrichment if Wikidata fails
            logger.warn('Wikidata genre enrichment failed (non-blocking)', {
              isbn,
              error: wikidataError instanceof Error ? wikidataError.message : String(wikidataError),
            });
          }
        }

        results.enriched++;

        // Queue cover download if we have a cover URL
        if (externalData.coverUrls?.original || externalData.coverUrls?.large) {
          try {
            await c.env.COVER_QUEUE.send({
              isbn,
              work_key: workKey,
              provider_url: externalData.coverUrls.original || externalData.coverUrls.large,
              priority: 'normal',
              source,
            });
            results.covers_queued++;
          } catch (queueError) {
            // Don't fail enrichment if cover queue fails
            logger.warn('Cover queue failed', { isbn, error: queueError });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.failed++;
        results.errors.push({ isbn, error: message });
        logger.error('Edition enrichment failed', { isbn, error: message });
      }
    }

    results.duration_ms = Date.now() - startTime;

    logger.info('Batch direct complete', {
      enriched: results.enriched,
      failed: results.failed,
      not_found: results.not_found,
      duration_ms: results.duration_ms,
    });

    return c.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Batch direct operation failed', { error: message });
    return c.json(
      {
        success: false,
        error: 'Batch enrichment failed',
        message,
      },
      500
    );
  }
});

// =================================================================================
// POST /api/harvest/covers - Harvest covers for OpenLibrary editions
// =================================================================================

const coverHarvestRoute = createRoute({
  method: 'post',
  path: '/api/harvest/covers',
  tags: ['Enrichment'],
  summary: 'Harvest Covers',
  description: `Automatically harvest covers for OpenLibrary editions that don't have them.

**How it works:**
1. Queries the database for editions without covers (English ISBNs only: 978-0, 978-1)
2. Batches up to 1000 ISBNs in a single ISBNdb API call
3. Updates editions with cover URLs from ISBNdb
4. Queues cover downloads for R2 storage

**Efficiency:**
- 1000 ISBNs per API call (ISBNdb Premium)
- 15,000 API calls/day = 15M ISBNs/day
- Could process all 28M editions needing covers in ~2 days

**Usage:**
Call this endpoint repeatedly with increasing offset to process all editions.`,
  request: {
    body: {
      content: {
        'application/json': {
          schema: CoverHarvestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch processed successfully',
      content: {
        'application/json': {
          schema: CoverHarvestResultSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
enrichRoutes.openapi(coverHarvestRoute, async (c) => {
  const startTime = Date.now();
  const logger = c.get('logger');

  try {
    const body = c.req.valid('json');
    const { batch_size = 1000, offset = 0, queue_covers = false } = body;

    const sql = c.get('sql');

    // Initialize quota manager
    const quotaManager = new QuotaManager(c.env.QUOTA_KV);

    // Check quota before making ISBNdb call
    const quotaCheck = await quotaManager.checkQuota(1, true);
    if (!quotaCheck.allowed) {
      logger.warn('Cover harvest: quota exhausted', {
        reason: quotaCheck.reason,
        used_today: quotaCheck.status.used_today,
        remaining: quotaCheck.status.buffer_remaining,
      });

      return c.json(
        {
          error: 'ISBNdb quota exhausted',
          quota_status: {
            used_today: quotaCheck.status.used_today,
            remaining: quotaCheck.status.buffer_remaining,
            limit: quotaCheck.status.limit,
          },
        },
        429
      );
    }

    // Query OpenLibrary editions without covers (English ISBNs only)
    // Using created_at DESC to process newest first
    logger.info('Cover harvest: querying editions', { batch_size, offset });

    const editionsResult = await sql`
      SELECT isbn
      FROM enriched_editions
      WHERE primary_provider = 'openlibrary'
        AND cover_url_large IS NULL
        AND isbn IS NOT NULL
        AND LENGTH(isbn) = 13
        AND (isbn LIKE '9780%' OR isbn LIKE '9781%')
      ORDER BY created_at DESC
      OFFSET ${offset}
      LIMIT ${batch_size}
    `;

    const isbns = (editionsResult as unknown as Array<{ isbn: string }>).map((row) => row.isbn);

    if (isbns.length === 0) {
      return c.json({
        queried: 0,
        found_in_isbndb: 0,
        covers_queued: 0,
        editions_updated: 0,
        no_cover_url: 0,
        api_calls: 0,
        duration_ms: Date.now() - startTime,
        next_offset: offset,
        message: 'No more editions to process',
      });
    }

    logger.info('Cover harvest: fetching from ISBNdb', { isbn_count: isbns.length });

    // Fetch from ISBNdb (single API call for up to 1000 ISBNs)
    const batchData = await fetchISBNdbBatch(isbns, c.env);

    // Note: Quota already reserved via checkQuota(1, true) on line 702
    // No need to call recordApiCall() - that would double-count

    logger.info('Cover harvest: ISBNdb call complete', {
      found: batchData.size,
      quota_used: 1,
    });

    const results = {
      queried: isbns.length,
      found_in_isbndb: batchData.size,
      covers_queued: 0,
      editions_updated: 0,
      no_cover_url: 0,
      api_calls: 1,
      duration_ms: 0,
      next_offset: offset + isbns.length,
    };

    // Update editions with cover URLs and queue downloads
    for (const [isbn, data] of batchData) {
      const coverUrl = data.coverUrls?.original || data.coverUrls?.large;

      if (!coverUrl) {
        results.no_cover_url++;
        continue;
      }

      try {
        // Update edition with cover URLs (don't overwrite other metadata)
        await sql`
          UPDATE enriched_editions
          SET
            cover_url_large = ${data.coverUrls?.large || coverUrl},
            cover_url_medium = ${data.coverUrls?.medium || coverUrl},
            cover_url_small = ${data.coverUrls?.small || coverUrl},
            cover_url_original = ${data.coverUrls?.original || null},
            cover_source = 'isbndb',
            updated_at = NOW()
          WHERE isbn = ${isbn}
        `;
        results.editions_updated++;

        // Queue cover download only if requested
        if (queue_covers) {
          await c.env.COVER_QUEUE.send({
            isbn,
            provider_url: coverUrl,
            priority: 'normal',
            source: 'cover-harvest',
          });
          results.covers_queued++;
        }

      } catch (error) {
        logger.error('Cover harvest: update failed', {
          isbn,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    results.duration_ms = Date.now() - startTime;

    // Get estimated remaining count (cached, not real-time)
    try {
      const remainingResult = await sql`
        SELECT COUNT(*)::int as count
        FROM enriched_editions
        WHERE primary_provider = 'openlibrary'
          AND cover_url_large IS NULL
          AND isbn IS NOT NULL
          AND LENGTH(isbn) = 13
          AND (isbn LIKE '9780%' OR isbn LIKE '9781%')
      `;
      (results as Record<string, unknown>).estimated_remaining = remainingResult[0]?.count || 0;
    } catch {
      // Ignore count errors
    }

    logger.info('Cover harvest: complete', results);

    return c.json(results);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Cover harvest failed', { error: message });
    return c.json(
      {
        success: false,
        error: 'Cover harvest failed',
        message,
      },
      500
    );
  }
});
