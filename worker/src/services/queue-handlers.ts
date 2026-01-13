// =================================================================================
// Queue Handlers for Alexandria Worker
//
// Handles async queue processing for:
// 1. Cover image downloads (alexandria-cover-queue)
// 2. Metadata enrichment (alexandria-enrichment-queue) - BATCHED for 100x efficiency
// =================================================================================

import postgres from 'postgres';
import type { Env } from '../env.js';
import { processAndStoreCover, coversExist } from '../../services/jsquash-processor.js';
import { ISBNdbProvider } from '../../lib/external-services/providers/isbndb-provider.js';
import { createServiceContext } from '../../lib/external-services/service-context.js';
import { enrichEdition, enrichWork } from './enrichment-service.js';
import { findOrCreateWork, linkWorkToAuthors } from './work-utils.js';
import { normalizeISBN } from '../../lib/isbn-utils.js';
import { Logger } from '../../lib/logger.js';
import { getQuotaManager } from './quota-manager.js';
import { extractGoogleBooksCategories } from '../../services/google-books.js';
import { updateWorkSubjects } from './subject-enrichment.js';
import { fetchBookByISBN } from '../../services/wikidata.js';
import type { WikidataBookMetadata } from '../../types/open-apis.js';
import type {
  CoverQueueMessage,
  EnrichmentQueueMessage,
  CoverQueueResults,
  EnrichmentQueueResults,
  CoverProcessingResult,
} from './types.js';
import { CoverFetchOrchestrator } from '../../lib/external-services/orchestrators/cover-fetch-orchestrator.js';
import { EditionVariantOrchestrator } from '../../lib/external-services/orchestrators/edition-variant-orchestrator.js';
import { getGlobalRegistry } from '../../lib/external-services/provider-registry.js';
import {
  GoogleBooksProvider,
  OpenLibraryProvider,
  ArchiveOrgProvider,
  WikidataProvider,
  LibraryThingProvider,
  GeminiProvider,
  XaiProvider,
} from '../../lib/external-services/providers/index.js';
import { COVER_PROVIDER_TIMEOUT_MS } from '../lib/constants.js';

// Cloudflare Queue types
interface QueueMessage<T = unknown> {
  id: string;
  timestamp: Date;
  body: T;
  ack(): void;
  retry(): void;
}

interface MessageBatch<T = unknown> {
  queue: string;
  messages: QueueMessage<T>[];
}

// =================================================================================
// Module-Level Provider Registry (Cold Start Optimization)
// =================================================================================

/**
 * Global provider registry initialized once and reused across batches.
 * This reduces per-batch overhead by ~5-10ms (no repeated allocations).
 *
 * QuotaManager is still created per-batch (needs fresh env bindings).
 */
const providerRegistry = getGlobalRegistry();

// Register all providers once at module initialization
providerRegistry.registerAll([
  new GoogleBooksProvider(),
  new OpenLibraryProvider(),
  new ArchiveOrgProvider(),
  new WikidataProvider(),
  new ISBNdbProvider(),
  new LibraryThingProvider(),
  // AI providers for book generation (backfill)
  new GeminiProvider(),
  new XaiProvider(),
]);

/**
 * Process cover messages from queue
 *
 * Handles async cover downloads from bendv3 enrichment requests.
 * Processes covers in batches with retry logic and analytics tracking.
 */
export async function processCoverQueue(
  batch: MessageBatch<CoverQueueMessage>,
  env: Env
): Promise<CoverQueueResults> {
  const logger = Logger.forQueue(env, 'alexandria-cover-queue', batch.messages.length);

  logger.info('Cover queue processing started (jSquash WebP)', {
    queueName: batch.queue,
    messageCount: batch.messages.length,
  });

  // Initialize singleton quota manager for ISBNdb quota enforcement
  const quotaManager = getQuotaManager(env.QUOTA_KV, logger);

  // Create cover fetch orchestrator with shared registry (reuses module-level registry)
  // Timeout per provider prevents slow providers from blocking entire batch
  const coverOrchestrator = new CoverFetchOrchestrator(providerRegistry, {
    enableLogging: true,
    providerTimeoutMs: COVER_PROVIDER_TIMEOUT_MS, // 10s timeout per provider
  });

  // Create postgres connection for updating cover URLs after processing
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  const results: CoverQueueResults = {
    processed: 0,
    cached: 0,
    failed: 0,
    dbUpdated: 0,
    errors: [],
    compressionStats: {
      totalOriginalBytes: 0,
      totalWebpBytes: 0,
    },
  };

  // OPTIMIZATION: Process covers in parallel using Promise.allSettled()
  // This significantly improves throughput vs sequential processing
  const processingPromises = batch.messages.map(async (message) => {
    try {
      const { isbn, provider_url, priority } = message.body;
      const normalizedISBN = isbn?.replace(/[-\s]/g, '') || '';

      logger.debug('Processing cover', {
        isbn: normalizedISBN,
        priority: priority || 'normal',
        has_provider_url: !!provider_url,
      });

      // Skip if already processed - we always check now to avoid duplicate processing
      const exists = await coversExist(env, normalizedISBN);
      if (exists) {
        logger.debug('Cover already exists, skipping', { isbn: normalizedISBN });
        message.ack();
        return { status: 'cached' as const, isbn: normalizedISBN };
      }

      // Determine cover URL - use provided URL or fetch from providers
      let coverUrl = provider_url;

      if (!coverUrl) {
        // No provider URL provided, search across providers using orchestrator
        logger.debug('No provider URL, fetching from providers', { isbn: normalizedISBN });

        // Create service context for orchestrator
        const context = createServiceContext(env, logger, {
          quotaManager,
          metadata: { isbn: normalizedISBN, source: 'cover_queue' },
        });

        const coverResult = await coverOrchestrator.fetchCover(normalizedISBN, context);

        if (!coverResult) {
          logger.warn('No cover found from any provider', { isbn: normalizedISBN });
          message.ack(); // Don't retry - no cover exists
          return {
            status: 'failed' as const,
            isbn: normalizedISBN,
            error: 'No cover found from any provider',
          };
        }

        coverUrl = coverResult.url;
      }

      // Process with jSquash: download -> decode -> resize -> WebP -> R2
      let result = (await processAndStoreCover(
        normalizedISBN,
        coverUrl,
        env
      )) as CoverProcessingResult;

      // JWT Expiry Recovery (Issue #96): If download failed with 401/403,
      // the ISBNdb image_original JWT likely expired. Re-fetch fresh URL from ISBNdb.
      if (result.status === 'error' && result.error?.match(/HTTP (401|403)/)) {
        logger.info('JWT expired, re-fetching fresh cover URL from ISBNdb', {
          isbn: normalizedISBN,
          originalError: result.error,
        });

        // Use ISBNdbProvider directly (part of External Service Provider Framework)
        const isbndbProvider = new ISBNdbProvider();
        const context = createServiceContext(env, logger, {
          quotaManager,
          metadata: { isbn: normalizedISBN, source: 'jwt_recovery' },
        });

        const freshCover = await isbndbProvider.fetchCover(normalizedISBN, context);
        if (freshCover?.url) {
          logger.info('Got fresh cover URL from ISBNdb, retrying download', {
            isbn: normalizedISBN,
            newUrl: freshCover.url.substring(0, 50) + '...',
          });

          // Retry with fresh URL
          result = (await processAndStoreCover(
            normalizedISBN,
            freshCover.url,
            env
          )) as CoverProcessingResult;
        } else {
          logger.warn('Failed to get fresh cover URL from ISBNdb', { isbn: normalizedISBN });
        }
      }

      if (result.status === 'processed') {
        // Write analytics if binding exists
        if (env.COVER_ANALYTICS) {
          try {
            env.COVER_ANALYTICS.writeDataPoint({
              indexes: [normalizedISBN],
              blobs: ['jsquash', normalizedISBN],
              doubles: [
                result.metrics.totalMs || 0,
                result.metrics.originalSize || 0,
                result.compression?.totalWebpSize || 0,
              ],
            });
          } catch (analyticsError) {
            logger.error('Cover queue: Analytics write failed', {
              error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
              stack: analyticsError instanceof Error ? analyticsError.stack : undefined,
              isbn: normalizedISBN
            });
          }
        }

        logger.info('Cover processed successfully', {
          isbn: normalizedISBN,
          originalSize: result.metrics.originalSize,
          webpSize: result.compression?.totalWebpSize,
          compression: result.compression?.ratio,
          processingMs: result.metrics.totalMs,
        });

        // Update enriched_editions with Alexandria R2 URLs (closes the loop!)
        try {
          const baseUrl = 'https://alexandria.ooheynerds.com/covers';
          const updateResult = await sql`
            UPDATE enriched_editions
            SET cover_url_large = ${`${baseUrl}/${normalizedISBN}/large`},
                cover_url_medium = ${`${baseUrl}/${normalizedISBN}/medium`},
                cover_url_small = ${`${baseUrl}/${normalizedISBN}/small`},
                cover_source = 'alexandria-r2'
            WHERE isbn = ${normalizedISBN}
          `;
          if (updateResult.count > 0) {
            logger.debug('Updated enriched_editions with R2 URLs', { isbn: normalizedISBN });
            // Ack message on success with DB update
            message.ack();
            return {
              status: 'processed' as const,
              isbn: normalizedISBN,
              metrics: result.metrics,
              compression: result.compression,
              dbUpdated: true,
            };
          }
        } catch (dbError) {
          // Don't fail the cover processing if DB update fails
          logger.warn('Failed to update enriched_editions with R2 URLs', {
            isbn: normalizedISBN,
            error: dbError instanceof Error ? dbError.message : String(dbError),
          });
        }

        // Ack message on success
        message.ack();
        return {
          status: 'processed' as const,
          isbn: normalizedISBN,
          metrics: result.metrics,
          compression: result.compression,
          dbUpdated: false,
        };
      } else {
        logger.error('Cover processing failed', {
          isbn: normalizedISBN,
          error: result.error,
        });
        // Ack message on non-retryable failure
        message.ack();
        return {
          status: 'failed' as const,
          isbn: normalizedISBN,
          error: result.error || 'Processing failed',
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Cover processing exception', {
        isbn: message.body?.isbn || 'unknown',
        error: errorMsg,
      });

      // Retry on exception (up to max_retries from wrangler.jsonc)
      message.retry();
      return {
        status: 'failed' as const,
        isbn: message.body?.isbn || 'unknown',
        error: errorMsg,
      };
    }
  });

  // Wait for all covers to process in parallel
  const processingResults = await Promise.allSettled(processingPromises);

  // Aggregate results
  for (const result of processingResults) {
    if (result.status === 'fulfilled') {
      const coverResult = result.value;
      if (coverResult.status === 'cached') {
        results.cached++;
      } else if (coverResult.status === 'processed') {
        results.processed++;
        results.compressionStats.totalOriginalBytes += coverResult.metrics?.originalSize || 0;
        results.compressionStats.totalWebpBytes += coverResult.compression?.totalWebpSize || 0;
        if (coverResult.dbUpdated) {
          results.dbUpdated++;
        }
      } else if (coverResult.status === 'failed') {
        results.failed++;
        results.errors.push({
          isbn: coverResult.isbn,
          error: coverResult.error || 'Processing failed',
        });
      }
    } else {
      // Promise rejected (shouldn't happen with try/catch, but handle it)
      results.failed++;
      results.errors.push({
        isbn: 'unknown',
        error: result.reason?.message || String(result.reason),
      });
    }
  }

  // Log batch summary
  const compressionRatio =
    results.compressionStats.totalOriginalBytes > 0
      ? (
          (1 -
            results.compressionStats.totalWebpBytes /
              results.compressionStats.totalOriginalBytes) *
          100
        ).toFixed(1)
      : 0;

  logger.info('Cover queue processing complete', {
    processed: results.processed,
    cached: results.cached,
    failed: results.failed,
    dbUpdated: results.dbUpdated,
    errorCount: results.errors.length,
    totalOriginalBytes: results.compressionStats.totalOriginalBytes,
    totalWebpBytes: results.compressionStats.totalWebpBytes,
    overallCompression: `${compressionRatio}%`,
  });

  // Close database connection
  await sql.end();

  return results;
}

/**
 * Process enrichment messages from queue - BATCHED VERSION
 *
 * Handles async metadata enrichment from bendv3 or scheduled jobs.
 * Uses ISBNdb batch endpoint to fetch up to 100 ISBNs in a SINGLE API call.
 *
 * This reduces API waste from 7.1x to near 1.0x efficiency (90%+ reduction).
 */
export async function processEnrichmentQueue(
  batch: MessageBatch<EnrichmentQueueMessage>,
  env: Env
): Promise<EnrichmentQueueResults> {
  const logger = Logger.forQueue(env, 'alexandria-enrichment-queue', batch.messages.length);

  // Time budget for Google Books enrichment (prevent Worker timeout)
  const TIME_BUDGET_MS = 30_000; // 30 seconds max
  const startTime = Date.now();

  logger.info('Enrichment queue processing started (BATCHED)', {
    messageCount: batch.messages.length,
  });

  // Create postgres connection for this batch
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  const results: EnrichmentQueueResults = {
    enriched: 0,
    cached: 0,
    failed: 0,
    errors: [],
    api_calls_saved: 0,
    wikidata_hits: 0,
    wikidata_genres_added: 0,
  };

  try {
    // 1. Collect all ISBNs from batch messages
    // Support both single ISBN (bendv3) and batch ISBNs (backfill) formats
    const isbnMessages = new Map<string, QueueMessage<EnrichmentQueueMessage>>();
    const isbnsToFetch: string[] = [];

    for (const message of batch.messages) {
      const { isbn, isbns } = message.body;

      // Extract ISBNs from either format
      const rawISBNs = isbn ? [isbn] : (isbns || []);

      if (rawISBNs.length === 0) {
        logger.warn('Message missing both isbn and isbns fields', { message: message.body });
        results.failed++;
        results.errors.push({ isbn: 'unknown', error: 'Missing ISBN data' });
        message.ack(); // Don't retry invalid messages
        continue;
      }

      // Process each ISBN in the message
      for (const rawISBN of rawISBNs) {
        const normalizedISBN = normalizeISBN(rawISBN);

        if (!normalizedISBN) {
          logger.warn('Invalid ISBN format', { isbn: rawISBN });
          results.failed++;
          results.errors.push({ isbn: rawISBN, error: 'Invalid ISBN format' });
          continue; // Skip this ISBN but continue with others in batch
        }

        // Check if this ISBN previously failed (cache check)
        const cacheKey = `isbn_not_found:${normalizedISBN}`;
        const cachedNotFound = await env.CACHE.get(cacheKey);
        if (cachedNotFound) {
          logger.debug('ISBN previously failed, skipping', { isbn: normalizedISBN });
          results.cached++;
          continue; // Skip this ISBN but continue with others
        }

        isbnMessages.set(normalizedISBN, message);
        isbnsToFetch.push(normalizedISBN);
      }

      // Only ack message if all its ISBNs were processed (cached or queued)
      // If any ISBN needs fetching, we'll ack after successful enrichment
      const allCached = rawISBNs.every(isbn => {
        const normalized = normalizeISBN(isbn);
        return !normalized || !isbnsToFetch.includes(normalized);
      });

      if (allCached) {
        message.ack();
      }
    }

    if (isbnsToFetch.length === 0) {
      logger.info('No valid ISBNs to process after filtering');
      return results;
    }

    logger.info('Fetching ISBNs via batch API', { count: isbnsToFetch.length });

    // 2. Fetch ALL ISBNs in a single batched API call (100x efficiency!)
    const batchStartTime = Date.now();

    // Initialize singleton quota manager and create service context
    const quotaManager = getQuotaManager(env.QUOTA_KV, logger);
    const serviceContext = createServiceContext(env, logger, { quotaManager });

    // Get ISBNdb provider from shared registry (avoids repeated instantiation)
    const provider = providerRegistry.get('isbndb');
    if (!provider) {
      throw new Error('ISBNdb provider not registered');
    }

    // Type-safe access to batchFetchMetadata (ISBNdb implements IMetadataProvider)
    const isbndbProvider = provider as ISBNdbProvider;
    if (!isbndbProvider.batchFetchMetadata) {
      throw new Error('ISBNdb provider does not support batch metadata fetching');
    }

    // Fetch batch metadata using unified framework
    const batchMetadata = await isbndbProvider.batchFetchMetadata(isbnsToFetch, serviceContext);
    const batchDuration = Date.now() - batchStartTime;

    // Record API call in quota manager (queue handlers track but don't enforce)
    await quotaManager.recordApiCall(1);

    // Convert BookMetadata to ExternalBookData format
    // Note: ISBNdbProvider returns extended fields (deweyDecimal, binding, relatedISBNs)
    // which are now part of the BookMetadata interface
    const enrichmentData = new Map<string, any>();
    for (const [isbn, metadata] of batchMetadata) {
      enrichmentData.set(isbn, {
        isbn: metadata.isbn || isbn,
        title: metadata.title,
        authors: metadata.authors || [],
        publisher: metadata.publisher,
        publicationDate: metadata.publishDate,
        pageCount: metadata.pageCount,
        language: metadata.language,
        description: metadata.description,
        coverUrls: metadata.coverUrl ? {
          large: metadata.coverUrl,
          medium: metadata.coverUrl,
          small: metadata.coverUrl,
          original: metadata.coverUrl,
        } : undefined,
        subjects: metadata.subjects || [],
        deweyDecimal: metadata.deweyDecimal || [],
        binding: metadata.binding,
        relatedISBNs: metadata.relatedISBNs,
        provider: 'isbndb' as const,
      });
    }

    logger.info('Batch fetch complete', {
      found: enrichmentData.size,
      requested: isbnsToFetch.length,
      durationMs: batchDuration,
      quota_recorded: true,
    });
    results.api_calls_saved = isbnsToFetch.length - 1; // Saved N-1 API calls

    // Log performance analytics
    logger.perf('isbndb_batch_fetch', batchDuration, {
      isbn_count: isbnsToFetch.length,
      found_count: enrichmentData.size,
      api_calls_saved: results.api_calls_saved,
    });

    // Parallel Wikidata genre enrichment (non-blocking)
    const wikidataStartTime = Date.now();
    const wikidataData = await fetchWikidataBatch(isbnsToFetch, env, logger);
    const wikidataDuration = Date.now() - wikidataStartTime;

    logger.info('Wikidata batch fetch complete', {
      found: wikidataData.size,
      requested: isbnsToFetch.length,
      durationMs: wikidataDuration,
    });

    // Create request-scoped caches for work/author deduplication
    const localAuthorKeyCache = new Map<string, string>();
    const localWorkKeyCache = new Map<string, string>();

    // 3. Process each ISBN result
    for (const [isbn, externalData] of enrichmentData) {
      const message = isbnMessages.get(isbn);
      if (!message) continue;

      try {
        // Use findOrCreateWork for proper deduplication
        const { workKey, isNew: isNewWork } = await findOrCreateWork(
          sql,
          isbn,
          externalData.title,
          externalData.authors || [],
          localWorkKeyCache,
          localAuthorKeyCache
        );

        // Only create enriched_work if it's genuinely new
        if (isNewWork) {
          await enrichWork(sql, {
            work_key: workKey,
            title: externalData.title,
            description: externalData.description,
            subject_tags: externalData.subjects,
            primary_provider: 'isbndb',
          }, logger);
        }

        // Link work to authors (fixes orphaned works)
        if (externalData.authors && externalData.authors.length > 0) {
          await linkWorkToAuthors(sql, workKey, externalData.authors, localAuthorKeyCache);
        }

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
          logger,
          env
        );

        // Merge Wikidata genres if available
        const wikidataMetadata = wikidataData.get(isbn);
        if (wikidataMetadata?.genre_names || wikidataMetadata?.subject_names) {
          const mergeResult = mergeGenres(
            externalData.subjects,
            wikidataMetadata.genre_names,
            wikidataMetadata.subject_names
          );

          // Update work with merged subjects
          if (mergeResult.wikidata_added > 0) {
            const wikidataGenres = mergeResult.merged.slice(mergeResult.isbndb_count); // Extract only Wikidata additions
            await updateWorkSubjects(sql, workKey, wikidataGenres, 'wikidata', logger);

            logger.debug('Wikidata genre enrichment applied', {
              isbn,
              work_key: workKey,
              genres_added: mergeResult.wikidata_added,
              total_subjects: mergeResult.merged.length,
            });

            // Track analytics
            if (env.ANALYTICS) {
              await env.ANALYTICS.writeDataPoint({
                indexes: ['wikidata_genre_enrichment'],
                blobs: [
                  `isbn_${isbn}`,
                  `work_${workKey}`,
                  `genres_${mergeResult.wikidata_added}`
                ],
                doubles: [mergeResult.wikidata_added, wikidataDuration]
              });
            }

            results.wikidata_hits = (results.wikidata_hits || 0) + 1;
            results.wikidata_genres_added = (results.wikidata_genres_added || 0) + mergeResult.wikidata_added;
          }
        }

        // Phase 2: Enrich subjects with Google Books categories (opportunistic, non-blocking)
        // This adds complementary broad categories to ISBNdb's specific subjects
        // Protected by feature flag + time budget circuit breaker to prevent Worker timeouts
        if (env.ENABLE_GOOGLE_BOOKS_ENRICHMENT === 'true' && (Date.now() - startTime < TIME_BUDGET_MS)) {
          try {
            const googleStartTime = Date.now();
            const googleCategories = await extractGoogleBooksCategories(isbn, env, logger);
            const googleDuration = Date.now() - googleStartTime;

            if (googleCategories.length > 0) {
              await updateWorkSubjects(sql, workKey, googleCategories, 'google-books', logger);

              logger.info('Google Books subject enrichment complete', {
                isbn,
                work_key: workKey,
                categories_count: googleCategories.length,
                duration_ms: googleDuration,
              });

              // Track analytics for Open API usage
              if (env.ANALYTICS) {
                await env.ANALYTICS.writeDataPoint({
                  indexes: ['google_books_subject_enrichment'],
                  blobs: [
                    `isbn_${isbn}`,
                    `work_${workKey}`,
                    `categories_${googleCategories.length}`
                  ],
                  doubles: [googleCategories.length, googleDuration]
                });
              }
            } else {
              logger.debug('No Google Books categories found', { isbn });
            }
          } catch (googleError) {
            // Log but don't fail enrichment if Google Books fails
            logger.warn('Google Books subject enrichment failed (non-blocking)', {
              isbn,
              error: googleError instanceof Error ? googleError.message : String(googleError),
            });
          }
        } else if (env.ENABLE_GOOGLE_BOOKS_ENRICHMENT === 'true') {
          // Time budget exceeded - skip remaining ISBNs
          logger.debug('Skipping Google Books enrichment due to time budget', {
            isbn,
            elapsed_ms: Date.now() - startTime,
            budget_ms: TIME_BUDGET_MS,
          });
        }

        // Phase 3: Enrich edition variants (opportunistic, non-blocking)
        // Aggregates related ISBNs from multiple providers (ISBNdb, LibraryThing, Wikidata)
        // Protected by time budget to prevent Worker timeouts
        if (Date.now() - startTime < TIME_BUDGET_MS) {
          try {
            const variantStartTime = Date.now();
            const editionVariantOrchestrator = new EditionVariantOrchestrator(providerRegistry, {
              enableLogging: true,
              stopOnFirstSuccess: false, // Aggregate from all providers
              providerTimeoutMs: 5000, // 5s per provider
            });

            const variants = await editionVariantOrchestrator.fetchEditionVariants(
              isbn,
              createServiceContext(env, logger, { quotaManager })
            );
            const variantDuration = Date.now() - variantStartTime;

            if (variants.length > 0) {
              // Merge variants from all providers into related_isbns JSONB
              const mergedRelatedIsbns: Record<string, string> = {};

              // Keep existing ISBNdb variants if any
              if (externalData.relatedISBNs) {
                Object.assign(mergedRelatedIsbns, externalData.relatedISBNs);
              }

              // Add variants from orchestrator (LibraryThing + Wikidata)
              for (const variant of variants) {
                const key = variant.formatDescription || variant.format;
                if (!mergedRelatedIsbns[key]) {
                  mergedRelatedIsbns[key] = variant.isbn;
                }
              }

              // Update enriched_editions with merged variants
              await sql`
                UPDATE enriched_editions
                SET related_isbns = ${JSON.stringify(mergedRelatedIsbns)},
                    updated_at = NOW()
                WHERE isbn = ${isbn}
              `;

              logger.info('Edition variant enrichment complete', {
                isbn,
                variants_count: variants.length,
                sources: [...new Set(variants.map(v => v.source))],
                duration_ms: variantDuration,
              });

              // Track analytics
              if (env.ANALYTICS) {
                await env.ANALYTICS.writeDataPoint({
                  indexes: ['edition_variant_enrichment'],
                  blobs: [
                    `isbn_${isbn}`,
                    `variants_${variants.length}`,
                    `sources_${[...new Set(variants.map(v => v.source))].join(',')}`
                  ],
                  doubles: [variants.length, variantDuration]
                });
              }
            } else {
              logger.debug('No edition variants found', { isbn });
            }
          } catch (variantError) {
            // Log but don't fail enrichment if edition variant fetch fails
            logger.warn('Edition variant enrichment failed (non-blocking)', {
              isbn,
              error: variantError instanceof Error ? variantError.message : String(variantError),
            });
          }
        } else {
          // Time budget exceeded - skip remaining ISBNs
          logger.debug('Skipping edition variant enrichment due to time budget', {
            isbn,
            elapsed_ms: Date.now() - startTime,
            budget_ms: TIME_BUDGET_MS,
          });
        }

        logger.debug('Enriched ISBN from batch', { isbn });

        results.enriched++;
        message.ack();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Storage error during enrichment', {
          isbn,
          error: errorMsg,
        });
        results.failed++;
        results.errors.push({ isbn, error: errorMsg });
        message.retry();
      }
    }

    // 4. Handle ISBNs that weren't found in ISBNdb
    for (const isbn of isbnsToFetch) {
      if (!enrichmentData.has(isbn)) {
        const message = isbnMessages.get(isbn);
        if (!message) continue;

        // Cache "not found" to prevent future API calls
        const cacheKey = `isbn_not_found:${isbn}`;
        await env.CACHE.put(cacheKey, 'true', {
          expirationTtl: 86400, // 24 hours
        });

        logger.warn('ISBN not found in ISBNdb, cached failure', { isbn });
        results.failed++;
        results.errors.push({ isbn, error: 'Not found in ISBNdb' });
        message.ack(); // Don't retry - it won't exist on retry either
      }
    }

    logger.info('Enrichment queue processing complete', {
      enriched: results.enriched,
      cached: results.cached,
      failed: results.failed,
      api_calls_saved: results.api_calls_saved,
      wikidata_hits: results.wikidata_hits,
      wikidata_genres_added: results.wikidata_genres_added,
      errorCount: results.errors.length,
    });
  } finally {
    // Always close the connection
    await sql.end();
  }

  return results;
}

// =================================================================================
// Author Queue Handler
// =================================================================================

export interface AuthorQueueMessage {
  type: 'JIT_ENRICH';
  priority: 'low' | 'medium' | 'high';
  author_key: string;
  wikidata_id: string;
  triggered_by: 'view' | 'search' | 'manual';
}

export interface AuthorQueueResults {
  processed: number;
  enriched: number;
  failed: number;
  quota_blocked: number;
  errors: Array<{ author_key: string; error: string }>;
}

// =================================================================================
// Wikidata Enrichment Helpers
// =================================================================================

/**
 * Fetch Wikidata metadata for multiple ISBNs in parallel
 *
 * Uses Promise.allSettled to handle partial failures gracefully.
 * Respects Wikidata rate limiting (2 req/sec) via built-in enforceRateLimit.
 *
 * @param isbns - Array of normalized ISBNs
 * @param env - Environment with KV bindings
 * @param logger - Logger instance
 * @returns Map of ISBN -> Wikidata metadata (only successful fetches)
 */
async function fetchWikidataBatch(
  isbns: string[],
  env: Env,
  logger: Logger
): Promise<Map<string, WikidataBookMetadata>> {
  const results = new Map<string, WikidataBookMetadata>();

  // Fetch all ISBNs in parallel (fetchBookByISBN handles rate limiting internally)
  const promises = isbns.map(isbn =>
    fetchBookByISBN(isbn, env, logger)
      .then(metadata => ({ isbn, metadata }))
      .catch(error => {
        logger.warn('Wikidata fetch failed for ISBN', {
          isbn,
          error: error instanceof Error ? error.message : String(error),
        });
        return { isbn, metadata: null };
      })
  );

  const settled = await Promise.allSettled(promises);

  // Extract successful results
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.metadata) {
      results.set(result.value.isbn, result.value.metadata);
    }
  }

  return results;
}

/**
 * Merge ISBNdb subjects with Wikidata genres/subjects
 *
 * Deduplicates case-insensitively, preserves ISBNdb subjects as primary.
 * Tracks contribution statistics for analytics.
 *
 * @param isbndbSubjects - Subjects from ISBNdb
 * @param wikidataGenres - Genre names from Wikidata (P136)
 * @param wikidataSubjects - Subject names from Wikidata (P921)
 * @returns Merged subjects + statistics
 */
function mergeGenres(
  isbndbSubjects: string[] | undefined,
  wikidataGenres: string[] | undefined,
  wikidataSubjects: string[] | undefined
): {
  merged: string[];
  isbndb_count: number;
  wikidata_added: number;
} {
  const merged = [...(isbndbSubjects || [])];
  const isbndbCount = merged.length;
  let wikidataAdded = 0;

  // Create lowercase set for deduplication
  const lowerCaseSet = new Set(merged.map(s => s.toLowerCase()));

  // Add Wikidata genres
  for (const genre of wikidataGenres || []) {
    const normalized = genre.trim();
    if (normalized && !lowerCaseSet.has(normalized.toLowerCase())) {
      merged.push(normalized);
      lowerCaseSet.add(normalized.toLowerCase());
      wikidataAdded++;
    }
  }

  // Add Wikidata subjects
  for (const subject of wikidataSubjects || []) {
    const normalized = subject.trim();
    if (normalized && !lowerCaseSet.has(normalized.toLowerCase())) {
      merged.push(normalized);
      lowerCaseSet.add(normalized.toLowerCase());
      wikidataAdded++;
    }
  }

  return {
    merged,
    isbndb_count: isbndbCount,
    wikidata_added: wikidataAdded,
  };
}

// =================================================================================
// Author Queue Handler
// =================================================================================

/**
 * Process author enrichment queue
 *
 * Handles Just-in-Time (JIT) author enrichment triggered by views/searches.
 * Enforces strict quota limits to protect book enrichment pipeline.
 *
 * Circuit breakers:
 * - 85% daily quota: halt ALL author enrichment
 * - 70% daily quota: halt background author enrichment (allow JIT only if urgent)
 *
 * @param batch - Message batch from Cloudflare Queue
 * @param env - Worker environment bindings
 * @returns Processing results with statistics
 */
export async function processAuthorQueue(
  batch: MessageBatch<AuthorQueueMessage>,
  env: Env
): Promise<AuthorQueueResults> {
  const logger = Logger.forQueue(env, 'alexandria-author-queue', batch.messages.length);

  logger.info('[AuthorQueue] Processing started', {
    queueName: batch.queue,
    messageCount: batch.messages.length,
  });

  // Create postgres connection
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  const results: AuthorQueueResults = {
    processed: 0,
    enriched: 0,
    failed: 0,
    quota_blocked: 0,
    errors: [],
  };

  try {
    // Initialize singleton quota manager
    const quotaManager = getQuotaManager(env.QUOTA_KV, logger);
    const quotaStatus = await quotaManager.getQuotaStatus();

    // Circuit breaker: 85% quota - halt ALL author enrichment
    if (quotaStatus.usage_percentage >= 0.85) {
      logger.warn('[AuthorQueue] Circuit breaker at 85% quota - rejecting all author enrichment', {
        usage: quotaStatus.used_today,
        limit: quotaStatus.limit,
        percentage: quotaStatus.usage_percentage
      });

      // Nack all messages to retry later (when quota resets)
      for (const message of batch.messages) {
        message.retry();
        results.quota_blocked++;
      }

      return results;
    }

    // Circuit breaker: 70% quota - allow only high-priority JIT requests
    const isQuotaTight = quotaStatus.usage_percentage >= 0.70;
    if (isQuotaTight) {
      logger.warn('[AuthorQueue] Circuit breaker at 70% quota - prioritizing only high-priority requests', {
        usage: quotaStatus.used_today,
        limit: quotaStatus.limit,
        percentage: quotaStatus.usage_percentage
      });
    }

    // Collect unique authors to enrich (deduplicate within batch)
    const authorsToEnrich = new Map<string, {
      author_key: string;
      wikidata_id: string;
      priority: 'low' | 'medium' | 'high';
      message: QueueMessage<AuthorQueueMessage>;
    }>();

    for (const message of batch.messages) {
      const { author_key, wikidata_id, priority } = message.body;

      // Skip low/medium priority if quota is tight (>70%)
      if (isQuotaTight && priority !== 'high') {
        logger.debug('[AuthorQueue] Skipping low-priority request due to quota pressure', {
          author_key,
          priority,
          quota_percentage: quotaStatus.usage_percentage
        });
        message.retry(); // Retry later when quota resets
        results.quota_blocked++;
        continue;
      }

      // Deduplicate: if author already in batch, upgrade priority
      if (authorsToEnrich.has(author_key)) {
        const existing = authorsToEnrich.get(author_key)!;
        const priorityOrder = { low: 0, medium: 1, high: 2 };
        if (priorityOrder[priority] > priorityOrder[existing.priority]) {
          existing.priority = priority;
        }
      } else {
        authorsToEnrich.set(author_key, {
          author_key,
          wikidata_id,
          priority,
          message
        });
      }
    }

    if (authorsToEnrich.size === 0) {
      logger.info('[AuthorQueue] No authors to process after quota filtering');
      return results;
    }

    // Extract Q-IDs for batch Wikidata fetch
    const qids = Array.from(authorsToEnrich.values()).map(a => a.wikidata_id);

    logger.info('[AuthorQueue] Fetching from Wikidata', {
      author_count: qids.length,
      quota_percentage: quotaStatus.usage_percentage
    });

    // Import Wikidata client (avoid circular dependency)
    const { fetchWikidataMultipleBatches } = await import('../../services/wikidata-client.js');
    const wikidataResults = await fetchWikidataMultipleBatches(qids);

    logger.info('[AuthorQueue] Wikidata fetch complete', {
      fetched: wikidataResults.size,
      requested: qids.length
    });

    // Process each author
    for (const [author_key, { wikidata_id, message }] of authorsToEnrich) {
      try {
        const data = wikidataResults.get(wikidata_id);

        // Mark attempt regardless of success
        await sql`
          UPDATE enriched_authors
          SET
            last_enrichment_attempt_at = NOW(),
            enrichment_attempt_count = COALESCE(enrichment_attempt_count, 0) + 1
          WHERE author_key = ${author_key}
        `;

        if (data) {
          // Build update fields
          const fieldsUpdated: string[] = [];
          if (data.gender) fieldsUpdated.push('gender');
          if (data.gender_qid) fieldsUpdated.push('gender_qid');
          if (data.citizenship) fieldsUpdated.push('nationality');
          if (data.citizenship_qid) fieldsUpdated.push('citizenship_qid');
          if (data.birth_year) fieldsUpdated.push('birth_year');
          if (data.death_year) fieldsUpdated.push('death_year');
          if (data.birth_place) fieldsUpdated.push('birth_place');
          if (data.birth_place_qid) fieldsUpdated.push('birth_place_qid');
          if (data.birth_country) fieldsUpdated.push('birth_country');
          if (data.birth_country_qid) fieldsUpdated.push('birth_country_qid');
          if (data.death_place) fieldsUpdated.push('death_place');
          if (data.death_place_qid) fieldsUpdated.push('death_place_qid');
          if (data.image_url) fieldsUpdated.push('author_photo_url');

          // Update author with enriched data
          await sql`
            UPDATE enriched_authors
            SET
              gender = COALESCE(${data.gender ?? null}, gender),
              gender_qid = COALESCE(${data.gender_qid ?? null}, gender_qid),
              nationality = COALESCE(${data.citizenship ?? null}, nationality),
              citizenship_qid = COALESCE(${data.citizenship_qid ?? null}, citizenship_qid),
              birth_year = COALESCE(${data.birth_year ?? null}, birth_year),
              death_year = COALESCE(${data.death_year ?? null}, death_year),
              birth_place = COALESCE(${data.birth_place ?? null}, birth_place),
              birth_place_qid = COALESCE(${data.birth_place_qid ?? null}, birth_place_qid),
              birth_country = COALESCE(${data.birth_country ?? null}, birth_country),
              birth_country_qid = COALESCE(${data.birth_country_qid ?? null}, birth_country_qid),
              death_place = COALESCE(${data.death_place ?? null}, death_place),
              death_place_qid = COALESCE(${data.death_place_qid ?? null}, death_place_qid),
              author_photo_url = COALESCE(${data.image_url ?? null}, author_photo_url),
              wikidata_enriched_at = NOW(),
              enrichment_source = 'wikidata_jit',
              updated_at = NOW()
            WHERE author_key = ${author_key}
          `;

          results.enriched++;
          logger.info('[AuthorQueue] Author enriched', {
            author_key,
            wikidata_id,
            fields_updated: fieldsUpdated.length
          });
        } else {
          // No data from Wikidata - mark as attempted (empty)
          await sql`
            UPDATE enriched_authors
            SET
              wikidata_enriched_at = NOW(),
              enrichment_source = 'wikidata_jit_empty',
              updated_at = NOW()
            WHERE author_key = ${author_key}
          `;

          logger.debug('[AuthorQueue] No Wikidata data found', {
            author_key,
            wikidata_id
          });
        }

        message.ack();
        results.processed++;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('[AuthorQueue] Author enrichment failed', {
          author_key,
          wikidata_id,
          error: errorMsg
        });

        results.failed++;
        results.errors.push({ author_key, error: errorMsg });
        message.retry(); // Retry on genuine errors
      }
    }

    logger.info('[AuthorQueue] Processing complete', {
      processed: results.processed,
      enriched: results.enriched,
      failed: results.failed,
      quota_blocked: results.quota_blocked
    });

    // Track analytics for author enrichment
    if (env.ENABLE_ANALYTICS === 'true' && env.ANALYTICS) {
      try {
        env.ANALYTICS.writeDataPoint({
          blobs: [
            'author_enrichment',
            'jit',
            quotaStatus.usage_percentage >= 0.70 ? 'quota_tight' : 'normal'
          ],
          doubles: [
            results.processed,
            results.enriched,
            results.failed,
            results.quota_blocked,
            quotaStatus.usage_percentage
          ],
          indexes: [`batch_size:${batch.messages.length}`]
        });
      } catch (analyticsError) {
        logger.warn('[AuthorQueue] Failed to write analytics', {
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        });
      }
    }

  } catch (error) {
    logger.error('[AuthorQueue] Queue processing error', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    await sql.end();
  }

  return results;
}
