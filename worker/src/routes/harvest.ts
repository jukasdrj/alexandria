/**
 * Harvest API Routes - Scheduled Cover Harvesting
 *
 * Provides:
 * - GET /api/harvest/quota - Check ISBNdb quota status
 * - Scheduled handler for cover harvesting (cron trigger)
 *
 * Note: POST /api/harvest/covers is in enrich.ts to keep all enrichment logic together
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppBindings, Env } from '../env.js';
import postgres from 'postgres';
import { fetchISBNdbBatch } from '../../services/batch-isbndb.js';
import { QuotaManager } from '../services/quota-manager.js';
import { parseHarvestConfig, buildISBNPrefixFilter, buildYearFilter } from '../lib/harvest-config.js';
import { batchUpdateCoverUrls } from '../services/batch-operations.js';
import type { Logger } from '../lib/logger.js';

const app = new OpenAPIHono<AppBindings>();

// =================================================================================
// Schemas
// =================================================================================

const QuotaStatusResponseSchema = z.object({
  used_today: z.number(),
  remaining: z.number(),
  limit: z.number(),
  last_reset: z.string().nullable(),
  next_reset_in_hours: z.number(),
});

// =================================================================================
// GET /api/harvest/quota - Check quota status
// =================================================================================

const quotaStatusRoute = createRoute({
  method: 'get',
  path: '/api/harvest/quota',
  tags: ['Harvest'],
  summary: 'Check Quota Status',
  description: 'Returns current ISBNdb API quota usage and remaining calls for the day.',
  responses: {
    200: {
      description: 'Quota status',
      content: {
        'application/json': {
          schema: QuotaStatusResponseSchema,
        },
      },
    },
  },
});

app.openapi(quotaStatusRoute, async (c) => {
  const quotaManager = new QuotaManager(c.env.QUOTA_KV);
  const status = await quotaManager.getQuotaStatus();

  return c.json({
    used_today: status.used_today,
    remaining: status.remaining,
    limit: status.limit,
    last_reset: status.last_reset,
    next_reset_in_hours: status.next_reset_in_hours,
  });
});

// =================================================================================
// Scheduled Handler (called by cron every 5 minutes)
// =================================================================================

/**
 * Handle scheduled cover harvest
 * Runs every 5 minutes via cron trigger (every-5-minutes pattern)
 *
 * Strategy:
 * - Initialize QuotaManager to check ISBNdb quota
 * - Queries enriched_editions for OpenLibrary editions missing covers
 * - Filters to 2000-present (past 25 years)
 * - Batches 1000 ISBNs per ISBNdb API call
 * - Updates editions with cover URLs
 * - Queues cover downloads for WebP processing
 * - Records API calls in quota manager
 */
export async function handleScheduledCoverHarvest(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[CoverHarvest:Scheduled] Starting scheduled harvest');

  // Parse harvest configuration
  const harvestConfig = parseHarvestConfig(env);

  // Initialize QuotaManager
  const quotaManager = new QuotaManager(env.QUOTA_KV);

  // Check quota before starting
  const quotaCheck = await quotaManager.shouldAllowOperation('cron', 1);
  if (!quotaCheck.allowed) {
    console.warn('[CoverHarvest:Scheduled] Quota check failed, skipping', {
      reason: quotaCheck.reason,
      status: quotaCheck.status,
    });
    return;
  }

  console.log('[CoverHarvest:Scheduled] Quota check passed', {
    used_today: quotaCheck.status.used_today,
    remaining: quotaCheck.status.buffer_remaining,
    limit: quotaCheck.status.limit,
  });

  // Create database connection
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  try {
    // Build ISBN prefix filter
    const isbnPrefixFilter = buildISBNPrefixFilter(harvestConfig.isbnPrefixes);

    // Build year pattern for regex
    const yearPattern = `^(${Array.from(
      { length: harvestConfig.maxYear - harvestConfig.minYear + 1 },
      (_, i) => harvestConfig.minYear + i
    ).join('|')})$`;

    // Query OpenLibrary editions without covers
    const editionsResult = await sql`
      SELECT isbn
      FROM enriched_editions
      WHERE primary_provider = 'openlibrary'
        AND cover_url_large IS NULL
        AND isbn IS NOT NULL
        AND LENGTH(isbn) = 13
        AND (${sql.unsafe(isbnPrefixFilter)})
        AND publication_date ~ ${yearPattern}
      ORDER BY ${sql.unsafe(harvestConfig.sortBy)} DESC NULLS LAST
      LIMIT ${harvestConfig.batchSize}
    `;

    const isbns = (editionsResult as unknown as { isbn: string }[]).map(row => row.isbn);

    if (isbns.length === 0) {
      console.log('[CoverHarvest:Scheduled] No editions found needing covers');
      return;
    }

    console.log('[CoverHarvest:Scheduled] Found editions to process', { count: isbns.length });

    // Fetch from ISBNdb (single API call for up to 1000 ISBNs)
    const batchData = await fetchISBNdbBatch(isbns, env);

    // Record API call in quota manager
    await quotaManager.recordApiCall(1);

    let coversQueued = 0;
    let noCoverUrl = 0;

    // Prepare batch updates
    const updates = [];
    for (const [isbn, data] of batchData) {
      const coverUrl = data.coverUrls?.original || data.coverUrls?.large;

      if (!coverUrl) {
        noCoverUrl++;
        continue;
      }

      updates.push({
        isbn,
        cover_url_large: data.coverUrls?.large || coverUrl,
        cover_url_medium: data.coverUrls?.medium || coverUrl,
        cover_url_small: data.coverUrls?.small || coverUrl,
        cover_url_original: data.coverUrls?.original || null,
        cover_source: 'isbndb',
      });
    }

    // Batch update all editions
    const simpleLogger: Logger = {
      info: (msg: string, meta?: unknown) => console.log(`[INFO] ${msg}`, meta),
      error: (msg: string, meta?: unknown) => console.error(`[ERROR] ${msg}`, meta),
      warn: (msg: string, meta?: unknown) => console.warn(`[WARN] ${msg}`, meta),
      debug: (msg: string, meta?: unknown) => console.debug(`[DEBUG] ${msg}`, meta),
    };

    const batchResult = await batchUpdateCoverUrls(sql, updates, simpleLogger);

    // Queue cover downloads
    for (const update of updates) {
      try {
        await env.COVER_QUEUE.send({
          isbn: update.isbn,
          provider_url: update.cover_url_original || update.cover_url_large,
          priority: 'normal',
          source: 'scheduled_harvest',
        });
        coversQueued++;
      } catch (error) {
        console.error('[CoverHarvest:Scheduled] Queue failed', {
          isbn: update.isbn,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Get updated quota status for logging
    const updatedQuota = await quotaManager.getQuotaStatus();

    console.log('[CoverHarvest:Scheduled] Complete', {
      isbns_queried: isbns.length,
      found_in_isbndb: batchData.size,
      editions_updated: batchResult.rows_affected,
      covers_queued: coversQueued,
      no_cover_url: noCoverUrl,
      batch_duration_ms: batchResult.duration_ms,
      chunks_processed: batchResult.chunks_processed,
      duration_ms: Date.now() - startTime,
      quota_used_today: updatedQuota.used_today,
      quota_remaining: updatedQuota.buffer_remaining,
    });

  } catch (error) {
    console.error('[CoverHarvest:Scheduled] Failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await sql.end();
  }
}

export default app;
