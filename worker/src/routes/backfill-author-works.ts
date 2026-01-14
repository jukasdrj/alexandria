/**
 * Author Works Backfill - Internal Endpoint
 *
 * Fixes Issue #186: Backfills missing author_works mappings for ISBNdb works
 * created before January 6, 2026 (when linkWorkToAuthors was added).
 *
 * Strategy:
 * 1. Query works missing author_works records
 * 2. For works with OpenLibrary IDs: Fetch directly from OpenLibrary API
 * 3. For works without IDs: Resolve via title + ISBN using external APIs
 * 4. Use existing linkWorkToAuthors() to create author_works records
 *
 * External API Priority (ISBNdb quota exhausted):
 * - OpenLibrary: Free, 100 req/5min, reliable
 * - Google Books: Free, 1000 req/day (with API key)
 * - Archive.org: Free, 1 req/sec, excellent for older books
 * - Wikidata: Free, 2 req/sec (SPARQL), comprehensive
 *
 * @module routes/backfill-author-works
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import postgres from 'postgres';
import type { AppBindings } from '../env.js';
import { Logger } from '../../lib/logger.js';
import { findOrCreateAuthor, linkWorkToAuthors } from '../services/work-utils.js';
import { getGlobalRegistry } from '../../lib/external-services/provider-registry.js';
import { createServiceContext } from '../../lib/external-services/service-context.js';
import { MetadataEnrichmentOrchestrator } from '../../lib/external-services/orchestrators/metadata-enrichment-orchestrator.js';
import { ServiceCapability } from '../../lib/external-services/capabilities.js';

// =================================================================================
// Schemas
// =================================================================================

const BackfillRequestSchema = z.object({
  batch_size: z.number().min(1).max(1000).default(100).describe('Number of works to process'),
  dry_run: z.boolean().default(true).describe('Preview without making changes'),
  skip_openlib_direct: z.boolean().default(false).describe('Skip direct OpenLibrary ID lookup'),
});

const BackfillResponseSchema = z.object({
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
  errors: z.array(z.object({
    isbn: z.string(),
    work_key: z.string(),
    error: z.string(),
  })),
});

// =================================================================================
// Route Definition
// =================================================================================

const backfillRoute = createRoute({
  method: 'post',
  path: '/api/internal/backfill-author-works',
  tags: ['Internal', 'Backfill'],
  security: [{ 'X-Cron-Secret': [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: BackfillRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Author backfill results',
      content: {
        'application/json': {
          schema: BackfillResponseSchema,
        },
      },
    },
    403: {
      description: 'Invalid authentication',
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
    },
  },
});

// =================================================================================
// Handler
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(backfillRoute, async (c) => {
  const logger = Logger.forEndpoint(c, 'POST /api/internal/backfill-author-works');
  const startTime = Date.now();

  // Authentication check
  const cronSecret = c.req.header('X-Cron-Secret');
  const expectedSecret = c.env.ALEXANDRIA_WEBHOOK_SECRET;

  if (!cronSecret || cronSecret !== expectedSecret) {
    logger.warn('Unauthorized backfill attempt', {
      hasSecret: !!cronSecret,
      secretMatch: cronSecret === expectedSecret,
    });
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const { batch_size, dry_run, skip_openlib_direct } = c.req.valid('json');

  logger.info('Author backfill started', { batch_size, dry_run, skip_openlib_direct });

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

    logger.info('Candidate works found', { count: candidateWorks.length });

    if (candidateWorks.length === 0) {
      logger.info('No works to process');
      return c.json({
        ...results,
        duration_ms: Date.now() - startTime,
        dry_run,
      });
    }

    // Create request-scoped author cache
    const authorKeyCache = new Map<string, string>();

    // Initialize service context for external APIs
    const serviceContext = createServiceContext(c.env, logger);
    const registry = getGlobalRegistry();

    // Get metadata orchestrator (free APIs only - ISBNdb quota exhausted)
    const metadataOrchestrator = new MetadataEnrichmentOrchestrator(registry, {
      enableLogging: true,
      providerTimeoutMs: 10000, // 10s per provider
      enableParallelFetch: true,
      maxSubjectProviders: 3,
    });

    // 2. Process each work
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

        // Strategy 1: Direct OpenLibrary lookup (1,670 works - 2.2%)
        if (openlibrary_edition_id && !skip_openlib_direct) {
          try {
            logger.debug('Trying OpenLibrary direct lookup', { isbn, openlibrary_edition_id });

            // Fetch from OpenLibrary Editions API
            const olUrl = `https://openlibrary.org${openlibrary_edition_id}.json`;
            const olResponse = await fetch(olUrl, {
              headers: {
                'User-Agent': 'Alexandria/2.7.0 (nerd@ooheynerds.com; Book metadata enrichment)',
              },
            });

            results.api_calls_used.openlib++;

            if (olResponse.ok) {
              const olData = await olResponse.json() as any;

              // Extract author names from OpenLibrary authors array
              if (olData.authors && Array.isArray(olData.authors)) {
                // Authors in editions are references: { key: "/authors/OL27695A" }
                // Need to fetch each author's name
                for (const authorRef of olData.authors) {
                  if (authorRef.key) {
                    const authorUrl = `https://openlibrary.org${authorRef.key}.json`;
                    const authorResponse = await fetch(authorUrl, {
                      headers: {
                        'User-Agent': 'Alexandria/2.7.0 (nerd@ooheynerds.com; Book metadata enrichment)',
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
                logger.debug('OpenLibrary direct hit', { isbn, authors: authorNames });
              }
            }
          } catch (olError) {
            logger.debug('OpenLibrary direct lookup failed', {
              isbn,
              error: olError instanceof Error ? olError.message : String(olError),
            });
          }
        }

        // Strategy 2: External API resolution via orchestrator (73,838 works - 97.8%)
        if (authorNames.length === 0) {
          logger.debug('Trying external API resolution', { isbn, title });

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

            logger.debug('External API hit', { isbn, source, authors: authorNames, providers: result.providers.metadata });
          }
        }

        // 3. Link authors to work
        if (authorNames.length > 0) {
          if (!dry_run) {
            await linkWorkToAuthors(sql, work_key, authorNames, authorKeyCache);
          }

          results.authors_linked += authorNames.length;

          logger.info('Authors linked to work', {
            work_key,
            isbn,
            title: title.substring(0, 50),
            authors: authorNames,
            source,
            dry_run,
            duration_ms: Date.now() - workStartTime,
          });
        } else {
          // No authors found via any method
          results.failed++;
          results.errors.push({
            isbn,
            work_key,
            error: 'No authors found via any provider',
          });

          logger.warn('No authors found for work', {
            work_key,
            isbn,
            title: title.substring(0, 50),
          });
        }

        // Rate limiting: Wait 3 seconds between works (OpenLibrary limit: 100 req/5min)
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (workError) {
        results.failed++;
        results.errors.push({
          isbn,
          work_key,
          error: workError instanceof Error ? workError.message : String(workError),
        });

        logger.error('Work processing failed', {
          work_key,
          isbn,
          error: workError instanceof Error ? workError.message : String(workError),
          stack: workError instanceof Error ? workError.stack : undefined,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Author backfill complete', {
      ...results,
      duration_ms: duration,
      dry_run,
    });

    return c.json({
      ...results,
      duration_ms: duration,
      dry_run,
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Backfill failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration_ms: duration,
    });

    return c.json({
      ...results,
      duration_ms: duration,
      dry_run,
    }, 500);
  } finally {
    await sql.end();
  }
});

export default app;
