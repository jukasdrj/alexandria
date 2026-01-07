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
import { fetchBestCover, fetchISBNdbCover } from '../../services/cover-fetcher.js';
import { fetchISBNdbBatch } from '../../services/batch-isbndb.js';
import { enrichEdition, enrichWork } from './enrichment-service.js';
import { findOrCreateWork, linkWorkToAuthors } from './work-utils.js';
import { normalizeISBN } from '../../lib/isbn-utils.js';
import { Logger } from '../../lib/logger.js';
import { QuotaManager } from './quota-manager.js';
import type {
  CoverQueueMessage,
  EnrichmentQueueMessage,
  CoverQueueResults,
  EnrichmentQueueResults,
  CoverProcessingResult,
} from './types.js';

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
        // No provider URL provided, search across providers
        logger.debug('No provider URL, fetching from providers', { isbn: normalizedISBN });
        const coverResult = await fetchBestCover(normalizedISBN, env);

        if (coverResult.source === 'placeholder') {
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

        const freshCover = await fetchISBNdbCover(normalizedISBN, env);
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
            console.error('[CoverQueue] Analytics write failed:', analyticsError);
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
    const enrichmentData = await fetchISBNdbBatch(isbnsToFetch, env);
    const batchDuration = Date.now() - batchStartTime;

    // Record API call in quota manager (queue handlers track but don't enforce)
    const quotaManager = new QuotaManager(env.QUOTA_KV);
    await quotaManager.recordApiCall(1);

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
      errorCount: results.errors.length,
    });
  } finally {
    // Always close the connection
    await sql.end();
  }

  return results;
}
