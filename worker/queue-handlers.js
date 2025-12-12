/**
 * Queue Handlers for Alexandria Worker
 *
 * Handles async queue processing for:
 * 1. Cover image downloads (alexandria-cover-queue)
 * 2. Metadata enrichment (alexandria-enrichment-queue) - BATCHED for 100x efficiency
 *
 * @module queue-handlers
 */

import postgres from 'postgres';
import { processAndStoreCover, coversExist } from './services/jsquash-processor.js';
import { fetchBestCover } from './services/cover-fetcher.js';
import { smartResolveISBN } from './services/smart-enrich.js';
import { fetchISBNdbBatch } from './services/batch-isbndb.js';
import { enrichEdition, enrichWork, enrichAuthor } from './enrichment-service.js';
import { normalizeISBN } from './lib/isbn-utils.js';
import { Logger } from './lib/logger.js';

/**
 * Process cover messages from queue
 *
 * Handles async cover downloads from bendv3 enrichment requests.
 * Processes covers in batches with retry logic and analytics tracking.
 *
 * @param {MessageBatch} batch - Queue messages from Cloudflare Queues
 * @param {Env} env - Worker environment bindings
 * @returns {Promise<object>} Processing results summary
 */
export async function processCoverQueue(batch, env) {
  const logger = Logger.forQueue(env, 'alexandria-cover-queue', batch.messages.length);

  logger.info('Cover queue processing started (jSquash WebP)', {
    queueName: batch.queue,
    messageCount: batch.messages.length
  });

  const results = {
    processed: 0,
    cached: 0,
    failed: 0,
    errors: [],
    compressionStats: {
      totalOriginalBytes: 0,
      totalWebpBytes: 0
    }
  };

  for (const message of batch.messages) {
    try {
      const { isbn, work_key, provider_url, priority } = message.body;
      const normalizedISBN = isbn?.replace(/[-\s]/g, '') || '';

      logger.debug('Processing cover', { isbn: normalizedISBN, priority: priority || 'normal', has_provider_url: !!provider_url });

      // Skip if already processed (unless high priority forces reprocessing)
      if (priority !== 'high') {
        const exists = await coversExist(env, normalizedISBN);
        if (exists) {
          logger.debug('Cover already exists, skipping', { isbn: normalizedISBN });
          results.cached++;
          message.ack();
          continue;
        }
      }

      // Determine cover URL - use provided URL or fetch from providers
      let coverUrl = provider_url;

      if (!coverUrl) {
        // No provider URL provided, search across providers
        logger.debug('No provider URL, fetching from providers', { isbn: normalizedISBN });
        const coverResult = await fetchBestCover(normalizedISBN, env);

        if (coverResult.source === 'placeholder') {
          logger.warn('No cover found from any provider', { isbn: normalizedISBN });
          results.failed++;
          results.errors.push({ isbn: normalizedISBN, error: 'No cover found from any provider' });
          message.ack(); // Don't retry - no cover exists
          continue;
        }

        coverUrl = coverResult.url;
      }

      // Process with jSquash: download → decode → resize → WebP → R2
      const result = await processAndStoreCover(normalizedISBN, coverUrl, env);

      if (result.status === 'processed') {
        results.processed++;
        results.compressionStats.totalOriginalBytes += result.metrics.originalSize || 0;
        results.compressionStats.totalWebpBytes += result.compression?.totalWebpSize || 0;

        // Write analytics if binding exists
        if (env.COVER_ANALYTICS) {
          try {
            env.COVER_ANALYTICS.writeDataPoint({
              indexes: [normalizedISBN],
              blobs: ['jsquash', normalizedISBN],
              doubles: [
                result.metrics.totalMs || 0,
                result.metrics.originalSize || 0,
                result.compression?.totalWebpSize || 0
              ]
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
          processingMs: result.metrics.totalMs
        });

      } else {
        results.failed++;
        results.errors.push({ isbn: normalizedISBN, error: result.error || 'Processing failed' });
        logger.error('Cover processing failed', { isbn: normalizedISBN, error: result.error });
      }

      // Ack message on success or non-retryable failure
      message.ack();

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Cover processing exception', {
        isbn: message.body?.isbn || 'unknown',
        error: errorMsg
      });
      results.failed++;
      results.errors.push({
        isbn: message.body?.isbn || 'unknown',
        error: errorMsg
      });

      // Retry on exception (up to max_retries from wrangler.jsonc)
      message.retry();
    }
  }

  // Log batch summary
  const compressionRatio = results.compressionStats.totalOriginalBytes > 0
    ? ((1 - results.compressionStats.totalWebpBytes / results.compressionStats.totalOriginalBytes) * 100).toFixed(1)
    : 0;

  logger.info('Cover queue processing complete', {
    processed: results.processed,
    cached: results.cached,
    failed: results.failed,
    errorCount: results.errors.length,
    totalOriginalBytes: results.compressionStats.totalOriginalBytes,
    totalWebpBytes: results.compressionStats.totalWebpBytes,
    overallCompression: `${compressionRatio}%`
  });

  return results;
}

/**
 * Process enrichment messages from queue - BATCHED VERSION
 *
 * Handles async metadata enrichment from bendv3 or scheduled jobs.
 * Uses ISBNdb batch endpoint to fetch up to 100 ISBNs in a SINGLE API call.
 *
 * This reduces API waste from 7.1x to near 1.0x efficiency (90%+ reduction).
 *
 * @param {MessageBatch} batch - Queue messages from Cloudflare Queues
 * @param {Env} env - Worker environment bindings
 * @returns {Promise<object>} Processing results summary
 */
export async function processEnrichmentQueue(batch, env) {
  const logger = Logger.forQueue(env, 'alexandria-enrichment-queue', batch.messages.length);

  logger.info('Enrichment queue processing started (BATCHED)', {
    messageCount: batch.messages.length
  });

  // Create postgres connection for this batch
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false
  });

  const results = {
    enriched: 0,
    cached: 0,
    failed: 0,
    errors: [],
    api_calls_saved: 0
  };

  try {
    // 1. Collect all ISBNs from batch messages
    const isbnMessages = new Map();
    const isbnsToFetch = [];

    for (const message of batch.messages) {
      const { isbn, priority, source } = message.body;
      const normalizedISBN = normalizeISBN(isbn);

      if (!normalizedISBN) {
        logger.warn('Invalid ISBN format', { isbn });
        results.failed++;
        results.errors.push({ isbn, error: 'Invalid ISBN format' });
        message.ack(); // Don't retry invalid ISBNs
        continue;
      }

      // Check if this ISBN previously failed (cache check)
      const cacheKey = `isbn_not_found:${normalizedISBN}`;
      const cachedNotFound = await env.CACHE.get(cacheKey);
      if (cachedNotFound) {
        logger.debug('ISBN previously failed, skipping', { isbn: normalizedISBN });
        results.cached++;
        message.ack(); // Don't retry known failures
        continue;
      }

      isbnMessages.set(normalizedISBN, message);
      isbnsToFetch.push(normalizedISBN);
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

    logger.info('Batch fetch complete', {
      found: enrichmentData.size,
      requested: isbnsToFetch.length,
      durationMs: batchDuration
    });
    results.api_calls_saved = isbnsToFetch.length - 1; // Saved N-1 API calls

    // Log performance analytics
    logger.perf('isbndb_batch_fetch', batchDuration, {
      isbn_count: isbnsToFetch.length,
      found_count: enrichmentData.size,
      api_calls_saved: results.api_calls_saved
    });

    // 3. Process each ISBN result
    for (const [isbn, externalData] of enrichmentData) {
      const message = isbnMessages.get(isbn);
      if (!message) continue;

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
        }, env);

        logger.debug('Enriched ISBN from batch', { isbn });

        results.enriched++;
        message.ack();

      } catch (error) {
        logger.error('Storage error during enrichment', {
          isbn,
          error: error.message
        });
        results.failed++;
        results.errors.push({ isbn, error: error.message });
        message.retry();
      }
    }

    // 4. Handle ISBNs that weren't found in ISBNdb
    for (const isbn of isbnsToFetch) {
      if (!enrichmentData.has(isbn)) {
        const message = isbnMessages.get(isbn);

        // Cache "not found" to prevent future API calls
        const cacheKey = `isbn_not_found:${isbn}`;
        await env.CACHE.put(cacheKey, 'true', {
          expirationTtl: 86400 // 24 hours
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
      errorCount: results.errors.length
    });

  } finally {
    // Always close the connection
    await sql.end();
  }

  return results;
}
