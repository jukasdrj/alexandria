/**
 * Test Author Backfill Endpoint - PUBLIC FOR TESTING
 *
 * Temporary public endpoint for testing Issue #186 backfill without auth.
 *
 * **WARNING**: This is a TEST endpoint. Remove or secure after validation!
 *
 * @module routes/test-author-backfill
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import postgres from 'postgres';
import type { AppBindings } from '../env.js';
import { Logger } from '../../lib/logger.js';
import { findOrCreateAuthor, linkWorkToAuthors } from '../services/work-utils.js';
import { getGlobalRegistry } from '../../lib/external-services/provider-registry.js';
import { createServiceContext } from '../../lib/external-services/service-context.js';
import { MetadataEnrichmentOrchestrator } from '../../lib/external-services/orchestrators/metadata-enrichment-orchestrator.js';

// =================================================================================
// Schemas (reuse from main backfill route)
// =================================================================================

const TestBackfillRequestSchema = z.object({
  batch_size: z.number().min(1).max(10).default(5).describe('Number of works (max 10 for public test)'),
  dry_run: z.boolean().default(true).describe('Always true for public test - no DB changes'),
});

const TestBackfillResponseSchema = z.object({
  works_processed: z.number(),
  authors_linked: z.number(),
  openlib_direct_hits: z.number(),
  external_api_hits: z.number(),
  failed: z.number(),
  api_calls_used: z.object({
    openlib: z.number(),
    google_books: z.number(),
    archive_org: z.number(),
    wikidata: z.number(),
  }),
  duration_ms: z.number(),
  dry_run: z.boolean(),
  test_mode: z.boolean(),
  errors: z.array(z.object({
    isbn: z.string(),
    work_key: z.string(),
    error: z.string(),
  })),
  warning: z.string(),
});

// =================================================================================
// Route Definition
// =================================================================================

const testRoute = createRoute({
  method: 'post',
  path: '/api/test/author-backfill',
  tags: ['Test'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: TestBackfillRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Test backfill results (dry run only)',
      content: {
        'application/json': {
          schema: TestBackfillResponseSchema,
        },
      },
    },
  },
});

// =================================================================================
// Handler
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(testRoute, async (c) => {
  const logger = new Logger(c.env, { requestId: c.get('requestId'), type: 'http' });
  const startTime = Date.now();

  const body = c.req.valid('json');
  const batch_size = Math.min(body.batch_size, 10); // Cap at 10 for public test

  logger.info('TEST: Author backfill dry run started', { batch_size });

  // Create database connection
  const sql = postgres(c.env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  // Initialize results tracking
  const results = {
    works_processed: 0,
    authors_linked: 0,
    openlib_direct_hits: 0,
    external_api_hits: 0,
    failed: 0,
    api_calls_used: {
      openlib: 0,
      google_books: 0,
      archive_org: 0,
      wikidata: 0,
    },
    errors: [] as Array<{ isbn: string; work_key: string; error: string }>,
  };

  try {
    // 1. Query works missing author_works records
    const candidateWorks = await sql`
      SELECT DISTINCT
        ew.work_key,
        ee.isbn,
        ew.title,
        ee.openlibrary_edition_id
      FROM enriched_works ew
      JOIN enriched_editions ee ON ew.work_key = ee.work_key
      LEFT JOIN author_works aw ON ew.work_key = aw.work_key
      WHERE ew.primary_provider = 'isbndb'
        AND aw.work_key IS NULL
      ORDER BY ew.work_key
      LIMIT ${batch_size}
    `;

    logger.info('TEST: Candidate works found', { count: candidateWorks.length });

    if (candidateWorks.length === 0) {
      logger.info('TEST: No works to process');
      return c.json({
        ...results,
        duration_ms: Date.now() - startTime,
        dry_run: true,
        test_mode: true,
        warning: 'This is a TEST endpoint - no database changes are made. Use /api/internal/backfill-author-works for production.',
      });
    }

    // Create request-scoped author cache
    const authorKeyCache = new Map<string, string>();

    // Initialize service context for external APIs
    const serviceContext = createServiceContext(c.env, logger);
    const registry = getGlobalRegistry();

    // Get metadata orchestrator (free APIs only)
    const metadataOrchestrator = new MetadataEnrichmentOrchestrator(registry, {
      enableLogging: true,
      providerTimeoutMs: 10000,
      enableParallelFetch: true,
      maxSubjectProviders: 3,
    });

    // 2. Process each work (DRY RUN ONLY - no database writes)
    for (const work of candidateWorks) {
      const workStartTime = Date.now();
      const { work_key, isbn, title, openlibrary_edition_id } = work as {
        work_key: string;
        isbn: string;
        title: string;
        openlibrary_edition_id: string | null;
      };

      results.works_processed++;

      try {
        let authorNames: string[] = [];
        let source = 'unknown';

        // Strategy 1: Direct OpenLibrary lookup
        if (openlibrary_edition_id) {
          try {
            logger.debug('TEST: Trying OpenLibrary direct lookup', { isbn, openlibrary_edition_id });

            const olUrl = `https://openlibrary.org${openlibrary_edition_id}.json`;
            const olResponse = await fetch(olUrl, {
              headers: {
                'User-Agent': 'Alexandria/2.7.0 (nerd@ooheynerds.com; Book metadata enrichment - TEST MODE)',
              },
            });

            results.api_calls_used.openlib++;

            if (olResponse.ok) {
              const olData = await olResponse.json() as any;

              if (olData.authors && Array.isArray(olData.authors)) {
                for (const authorRef of olData.authors) {
                  if (authorRef.key) {
                    const authorUrl = `https://openlibrary.org${authorRef.key}.json`;
                    const authorResponse = await fetch(authorUrl, {
                      headers: {
                        'User-Agent': 'Alexandria/2.7.0 (nerd@ooheynerds.com; Book metadata enrichment - TEST MODE)',
                      },
                    });

                    results.api_calls_used.openlib++;

                    if (authorResponse.ok) {
                      const authorData = await authorResponse.json() as any;
                      if (authorData.name) {
                        authorNames.push(authorData.name);
                      }
                    }
                  }
                }
              }

              if (authorNames.length > 0) {
                source = 'openlibrary-direct';
                results.openlib_direct_hits++;
                logger.debug('TEST: OpenLibrary direct hit', { isbn, authors: authorNames });
              }
            }
          } catch (olError) {
            logger.debug('TEST: OpenLibrary direct lookup failed', {
              isbn,
              error: olError instanceof Error ? olError.message : String(olError),
            });
          }
        }

        // Strategy 2: External API resolution via orchestrator
        if (authorNames.length === 0) {
          logger.debug('TEST: Trying external API resolution', { isbn, title });

          const result = await metadataOrchestrator.enrichMetadata(isbn, serviceContext);

          // Fix: Access nested metadata property
          if (result.metadata && result.metadata.authors && result.metadata.authors.length > 0) {
            authorNames = result.metadata.authors;
            source = result.providers.metadata[0] || 'external-api';
            results.external_api_hits++;

            // Track API calls from provider list
            for (const provider of result.providers.metadata) {
              if (provider.includes('google')) results.api_calls_used.google_books++;
              else if (provider.includes('archive')) results.api_calls_used.archive_org++;
              else if (provider.includes('wikidata')) results.api_calls_used.wikidata++;
              else if (provider.includes('open-library') || provider.includes('openlibrary')) results.api_calls_used.openlib++;
            }

            logger.debug('TEST: External API hit', { isbn, source, authors: authorNames, providers: result.providers.metadata });
          }
        }

        // 3. Count authors found (NO DATABASE WRITES IN TEST MODE)
        if (authorNames.length > 0) {
          results.authors_linked += authorNames.length;

          logger.info('TEST: Authors found for work', {
            work_key,
            isbn,
            title: title.substring(0, 50),
            authors: authorNames,
            source,
            duration_ms: Date.now() - workStartTime,
          });
        } else {
          results.failed++;
          results.errors.push({
            isbn,
            work_key,
            error: 'No authors found via any provider',
          });

          logger.warn('TEST: No authors found for work', {
            work_key,
            isbn,
            title: title.substring(0, 50),
          });
        }

        // Rate limiting: Wait 3 seconds between works
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (workError) {
        results.failed++;
        results.errors.push({
          isbn,
          work_key,
          error: workError instanceof Error ? workError.message : String(workError),
        });

        logger.error('TEST: Work processing failed', {
          work_key,
          isbn,
          error: workError instanceof Error ? workError.message : String(workError),
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('TEST: Author backfill dry run complete', {
      ...results,
      duration_ms: duration,
    });

    return c.json({
      ...results,
      duration_ms: duration,
      dry_run: true, // Always true for test endpoint
      test_mode: true,
      warning: 'This is a TEST endpoint - no database changes were made. Use /api/internal/backfill-author-works for production.',
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('TEST: Backfill failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration_ms: duration,
    });

    return c.json({
      ...results,
      duration_ms: duration,
      dry_run: true,
      test_mode: true,
      warning: 'This is a TEST endpoint - an error occurred during testing.',
    }, 500);
  } finally {
    await sql.end();
  }
});

export default app;
