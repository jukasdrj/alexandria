/**
 * Queue Handlers for Alexandria Worker
 *
 * Handles async queue processing for:
 * 1. Cover image downloads (alexandria-cover-queue)
 * 2. Metadata enrichment (alexandria-enrichment-queue)
 *
 * @module queue-handlers
 */

import postgres from 'postgres';
import { processCoverImage } from './services/image-processor.js';
import { smartResolveISBN } from './services/smart-enrich.js';

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
  console.log(`[CoverQueue] Processing ${batch.messages.length} cover requests`);

  const results = {
    processed: 0,
    cached: 0,
    failed: 0,
    errors: []
  };

  for (const message of batch.messages) {
    try {
      const { isbn, work_key, provider_url, priority } = message.body;

      console.log(`[CoverQueue] Processing ISBN ${isbn} (priority: ${priority})`);

      // Process cover with Alexandria's battle-tested processor
      const result = await processCoverImage(isbn, env, {
        force: priority === 'high'  // Force reprocess for high-priority
      });

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
 * Process enrichment messages from queue
 *
 * Handles async metadata enrichment from bendv3 or scheduled jobs.
 * Uses smart resolution to fetch from ISBNdb → Google Books → OpenLibrary.
 *
 * @param {MessageBatch} batch - Queue messages from Cloudflare Queues
 * @param {Env} env - Worker environment bindings
 * @returns {Promise<object>} Processing results summary
 */
export async function processEnrichmentQueue(batch, env) {
  console.log(`[EnrichQueue] Processing ${batch.messages.length} enrichment requests`);

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
    errors: []
  };

  try {
    for (const message of batch.messages) {
      try {
        const { isbn, work_key, priority, source } = message.body;

        console.log(`[EnrichQueue] Enriching ISBN ${isbn} (priority: ${priority || 'normal'}, source: ${source || 'unknown'})`);

        // Use smart resolution to fetch + store
        const result = await smartResolveISBN(isbn, sql, env);

        if (result) {
          results.enriched++;

          // Write analytics if binding exists
          if (env.ANALYTICS) {
            try {
              env.ANALYTICS.writeDataPoint({
                indexes: [isbn, result._provider || 'unknown'],
                blobs: [isbn, result._provider || 'unknown'],
                doubles: [parseInt(result.pages) || 0, priority || 5]
              });
            } catch (analyticsError) {
              console.error('[EnrichQueue] Analytics write failed:', analyticsError);
            }
          }
        } else {
          // Might be already in DB (cached)
          results.cached++;
        }

        // Ack message on success
        message.ack();

      } catch (error) {
        console.error('[EnrichQueue] Message error:', error);
        results.failed++;
        results.errors.push({
          isbn: message.body?.isbn || 'unknown',
          error: error instanceof Error ? error.message : String(error)
        });

        // Retry on failure
        message.retry();
      }
    }

    console.log('[EnrichQueue] Batch complete:', JSON.stringify({
      enriched: results.enriched,
      cached: results.cached,
      failed: results.failed,
      errorCount: results.errors.length
    }));

  } finally {
    // Always close the connection
    await sql.end();
  }

  return results;
}
