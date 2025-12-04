/**
 * Cloudflare Queues REST API Consumer
 *
 * Uses the Queues HTTP API to manually pull and process messages.
 * More control than worker-based consumers for debugging and testing.
 *
 * @see https://developers.cloudflare.com/queues/configuration/pull-consumers/
 */

import { smartResolveISBN } from './services/smart-enrich.js';
import { processCoverImage } from './services/image-processor.js';
import postgres from 'postgres';

/**
 * Manually pull and process messages from enrichment queue
 *
 * @param {Env} env - Worker environment
 * @param {number} batchSize - Number of messages to pull (max 100)
 * @returns {Promise<object>} Processing results
 */
export async function pullAndProcessEnrichmentQueue(env, batchSize = 10) {
  console.log(`[QueueAPI] Pulling ${batchSize} messages from alexandria-enrichment-queue`);

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const queueId = env.ENRICHMENT_QUEUE_ID || '923439ceb428419c9e02248e2001756e';

  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID not configured');
  }

  // Pull messages via HTTP API
  const pullUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/pull`;

  const pullResponse = await fetch(pullUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      batch_size: batchSize,
      visibility_timeout_ms: 30000, // 30 seconds to process
    }),
  });

  if (!pullResponse.ok) {
    const error = await pullResponse.text();
    console.error('[QueueAPI] Pull failed:', error);
    throw new Error(`Queue pull failed: ${pullResponse.status} ${error}`);
  }

  const data = await pullResponse.json();
  const messages = data.result?.messages || [];

  console.log(`[QueueAPI] Pulled ${messages.length} messages`);

  if (messages.length === 0) {
    return {
      pulled: 0,
      processed: 0,
      failed: 0,
      message: 'No messages in queue',
    };
  }

  // Create database connection for enrichment
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  // Process messages
  const results = {
    pulled: messages.length,
    processed: 0,
    failed: 0,
    acks: [],
    retries: [],
    errors: [],
  };

  for (const msg of messages) {
    try {
      const { entity_type, isbn, source, priority } = msg.body;

      console.log(`[QueueAPI] Processing ISBN ${isbn} from ${source} (priority: ${priority})`);

      // Enrich via smart resolution
      const enrichedData = await smartResolveISBN(isbn, sql, env);

      if (enrichedData) {
        results.processed++;
        results.acks.push(msg.lease_id); // Mark for acknowledgment
        console.log(`[QueueAPI] ✓ Enriched ISBN ${isbn}`);
      } else {
        results.failed++;
        results.retries.push(msg.lease_id); // Retry later
        results.errors.push({ isbn, error: 'No external data found' });
        console.log(`[QueueAPI] ✗ Failed to enrich ISBN ${isbn}`);
      }

    } catch (error) {
      results.failed++;
      results.retries.push(msg.lease_id);
      results.errors.push({
        isbn: msg.body?.isbn || 'unknown',
        error: error.message,
      });
      console.error('[QueueAPI] Processing error:', error);
    }
  }

  // Acknowledge successfully processed messages
  if (results.acks.length > 0) {
    const ackUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/ack`;

    await fetch(ackUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        acks: results.acks,
      }),
    });

    console.log(`[QueueAPI] Acknowledged ${results.acks.length} messages`);
  }

  // Retry failed messages (they'll be redelivered after visibility timeout)
  console.log(`[QueueAPI] ${results.retries.length} messages will be retried`);

  await sql.end();

  return results;
}

/**
 * Manually pull and process messages from cover queue
 *
 * @param {Env} env - Worker environment
 * @param {number} batchSize - Number of messages to pull (max 100)
 * @returns {Promise<object>} Processing results
 */
export async function pullAndProcessCoverQueue(env, batchSize = 20) {
  console.log(`[QueueAPI] Pulling ${batchSize} messages from alexandria-cover-queue`);

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const queueId = env.COVER_QUEUE_ID || 'bf364602a6b540f2b7345104d7332db2';

  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID not configured');
  }

  // Pull messages via HTTP API
  const pullUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/pull`;

  const pullResponse = await fetch(pullUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      batch_size: batchSize,
      visibility_timeout_ms: 30000,
    }),
  });

  if (!pullResponse.ok) {
    const error = await pullResponse.text();
    console.error('[QueueAPI] Pull failed:', error);
    throw new Error(`Queue pull failed: ${pullResponse.status} ${error}`);
  }

  const data = await pullResponse.json();
  const messages = data.result?.messages || [];

  console.log(`[QueueAPI] Pulled ${messages.length} messages`);

  if (messages.length === 0) {
    return {
      pulled: 0,
      processed: 0,
      failed: 0,
      message: 'No messages in queue',
    };
  }

  // Process messages
  const results = {
    pulled: messages.length,
    processed: 0,
    cached: 0,
    failed: 0,
    acks: [],
    retries: [],
    errors: [],
  };

  for (const msg of messages) {
    try {
      const { isbn, priority } = msg.body;

      console.log(`[QueueAPI] Processing cover for ISBN ${isbn} (priority: ${priority})`);

      const result = await processCoverImage(isbn, env, {
        force: priority >= 9,
      });

      if (result.status === 'processed') {
        results.processed++;
        results.acks.push(msg.lease_id);
      } else if (result.status === 'already_exists') {
        results.cached++;
        results.acks.push(msg.lease_id);
      } else {
        results.failed++;
        results.retries.push(msg.lease_id);
        results.errors.push({ isbn, error: result.error });
      }

    } catch (error) {
      results.failed++;
      results.retries.push(msg.lease_id);
      results.errors.push({
        isbn: msg.body?.isbn || 'unknown',
        error: error.message,
      });
      console.error('[QueueAPI] Processing error:', error);
    }
  }

  // Acknowledge successfully processed messages
  if (results.acks.length > 0) {
    const ackUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/ack`;

    await fetch(ackUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        acks: results.acks,
      }),
    });

    console.log(`[QueueAPI] Acknowledged ${results.acks.length} messages`);
  }

  console.log(`[QueueAPI] ${results.retries.length} messages will be retried`);

  return results;
}
