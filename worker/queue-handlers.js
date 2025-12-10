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
import { processCoverImage } from './services/image-processor.js';
import { smartResolveISBN } from './services/smart-enrich.js';
import { fetchISBNdbBatch } from './services/batch-isbndb.js';
import { enrichEdition, enrichWork, enrichAuthor } from './enrichment-service.js';
import { normalizeISBN } from './lib/isbn-utils.js';

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
  console.log(`[CoverQueue] ========================================`);
  console.log(`[CoverQueue] Queue triggered with ${batch.messages.length} messages`);
  console.log(`[CoverQueue] Queue name: ${batch.queue}`);
  console.log(`[CoverQueue] Timestamp: ${new Date().toISOString()}`);
  console.log(`[CoverQueue] ========================================`);

  const results = {
    processed: 0,
    cached: 0,
    failed: 0,
    errors: []
  };

  for (const message of batch.messages) {
    try {
      const { isbn, work_key, provider_url, priority } = message.body;

      console.log(`[CoverQueue] Processing ISBN ${isbn} (priority: ${priority || 'normal'})`);

      // Build options with provider URL if available (avoids redundant API lookups)
      const options = {
        force: priority === 'high'
      };

      if (provider_url) {
        options.knownCoverUrl = provider_url;  // ✅ Use provider URL from enrichment
        console.log(`[CoverQueue] Using provider URL: ${provider_url}`);
      }

      const result = await processCoverImage(isbn, env, options);

      if (result.status === 'processed') {
        results.processed++;

        // Write analytics if binding exists
        if (env.COVER_ANALYTICS) {
          try {
            env.COVER_ANALYTICS.writeDataPoint({
              indexes: [isbn, result.source],
              blobs: [isbn, result.source],
              doubles: [result.processingTimeMs || 0, result.size || 0]
            });
          } catch (analyticsError) {
            console.error('[CoverQueue] Analytics write failed:', analyticsError);
          }
        }

      } else if (result.status === 'already_exists') {
        results.cached++;
      } else {
        results.failed++;
        results.errors.push({ isbn, error: result.error || 'Unknown error' });
      }

      // Ack message on success
      message.ack();

    } catch (error) {
      console.error('[CoverQueue] Message processing error:', error);
      results.failed++;
      results.errors.push({
        isbn: message.body?.isbn || 'unknown',
        error: error instanceof Error ? error.message : String(error)
      });

      // Retry on failure (up to max_retries from wrangler.jsonc)
      message.retry();
    }
  }

  console.log('[CoverQueue] Batch complete:', JSON.stringify({
    processed: results.processed,
    cached: results.cached,
    failed: results.failed,
    errorCount: results.errors.length
  }));

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
  console.log(`[EnrichQueue] ========================================`);
  console.log(`[EnrichQueue] Processing ${batch.messages.length} enrichment requests (BATCHED)`);
  console.log(`[EnrichQueue] ========================================`);

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
        console.warn(`[EnrichQueue] Invalid ISBN format: ${isbn}`);
        results.failed++;
        results.errors.push({ isbn, error: 'Invalid ISBN format' });
        message.ack(); // Don't retry invalid ISBNs
        continue;
      }

      // Check if this ISBN previously failed (cache check)
      const cacheKey = `isbn_not_found:${normalizedISBN}`;
      const cachedNotFound = await env.CACHE.get(cacheKey);
      if (cachedNotFound) {
        console.log(`[EnrichQueue] ISBN ${normalizedISBN} previously failed, skipping`);
        results.cached++;
        message.ack(); // Don't retry known failures
        continue;
      }

      isbnMessages.set(normalizedISBN, message);
      isbnsToFetch.push(normalizedISBN);
    }

    if (isbnsToFetch.length === 0) {
      console.log('[EnrichQueue] No valid ISBNs to process after filtering');
      return results;
    }

    console.log(`[EnrichQueue] Fetching ${isbnsToFetch.length} ISBNs via batch API`);

    // 2. Fetch ALL ISBNs in a single batched API call (100x efficiency!)
    const batchStartTime = Date.now();
    const enrichmentData = await fetchISBNdbBatch(isbnsToFetch, env);
    const batchDuration = Date.now() - batchStartTime;

    console.log(`[EnrichQueue] Batch fetch complete: ${enrichmentData.size}/${isbnsToFetch.length} ISBNs in ${batchDuration}ms`);
    results.api_calls_saved = isbnsToFetch.length - 1; // Saved N-1 API calls

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

        console.log(`[EnrichQueue] ✓ Enriched ${isbn} from batch`);

        results.enriched++;
        message.ack();

      } catch (error) {
        console.error(`[EnrichQueue] Storage error for ${isbn}:`, error);
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

        console.warn(`[EnrichQueue] ISBN ${isbn} not found in ISBNdb, cached failure`);
        results.failed++;
        results.errors.push({ isbn, error: 'Not found in ISBNdb' });
        message.ack(); // Don't retry - it won't exist on retry either
      }
    }

    console.log('[EnrichQueue] ========================================');
    console.log('[EnrichQueue] Batch complete:', JSON.stringify({
      enriched: results.enriched,
      cached: results.cached,
      failed: results.failed,
      api_calls_saved: results.api_calls_saved,
      errorCount: results.errors.length
    }));
    console.log('[EnrichQueue] ========================================');

  } finally {
    // Always close the connection
    await sql.end();
  }

  return results;
}
