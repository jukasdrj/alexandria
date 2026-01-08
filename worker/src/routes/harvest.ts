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
import { parseHarvestConfig, buildISBNPrefixFilter } from '../lib/harvest-config.js';
import { batchUpdateCoverUrls } from '../services/batch-operations.js';
import { Logger } from '../../lib/logger.js';
import { HarvestState } from '../services/harvest-state.js';
import { deduplicateISBNs } from '../services/deduplication.js';
import { enrichEdition } from '../services/enrichment-service.js';
import type { EnrichEditionRequest } from '../services/types.js';
import {
  generateCuratedBookList,
  testGeminiConnection,
} from '../services/gemini-backfill.js';
import { generateHybridBackfillList } from '../services/hybrid-backfill.js';
import {
  createJobStatus,
  getJobStatus,
  type BackfillQueueMessage,
} from '../services/async-backfill.js';

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

const BackfillStatusResponseSchema = z.object({
  summary: z.object({
    years_total: z.number(),
    years_completed: z.number(),
    years_in_progress: z.number(),
    total_books: z.number(),
    total_covers: z.number(),
    total_quota_used: z.number(),
  }),
  incomplete_years: z.array(z.number()),
  next_target: z.object({
    year: z.number(),
    month: z.number(),
  }).nullable(),
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
// GET /api/harvest/gemini/test - Test Gemini API connection
// =================================================================================

const GeminiTestResponseSchema = z.object({
  success: z.boolean(),
  model: z.string(),
  error: z.string().optional(),
  message: z.string().optional(),
});

const geminiTestRoute = createRoute({
  method: 'get',
  path: '/api/harvest/gemini/test',
  tags: ['Harvest'],
  summary: 'Test Gemini API Connection',
  description: 'Validates Gemini API key and model access. Useful for debugging backfill issues.',
  responses: {
    200: {
      description: 'Test result',
      content: {
        'application/json': {
          schema: GeminiTestResponseSchema,
        },
      },
    },
  },
});

app.openapi(geminiTestRoute, async (c) => {
  const logger = c.get('logger');

  logger.info('[GeminiTest] Testing API connection');

  const result = await testGeminiConnection(c.env, logger);

  if (result.success) {
    return c.json({
      success: true,
      model: result.model,
      message: 'Gemini API connection successful. Native structured output is working.',
    });
  } else {
    return c.json({
      success: false,
      model: result.model,
      error: result.error,
    });
  }
});

// =================================================================================
// POST /api/harvest/hybrid/test - Test hybrid workflow (Gemini + ISBNdb)
// =================================================================================

const HybridTestRequestSchema = z.object({
  year: z.number().int().min(2005).max(2030).describe('Year to test'),
  month: z.number().int().min(1).max(12).describe('Month to test (1-12)'),
});

const HybridTestResponseSchema = z.object({
  success: z.boolean(),
  year: z.number(),
  month: z.number(),
  gemini_stats: z.object({
    total_books: z.number(),
    books_with_publisher: z.number(),
    books_with_significance: z.number(),
    model_used: z.string(),
  }),
  isbn_resolution: z.object({
    total_attempted: z.number(),
    resolved: z.number(),
    resolution_rate: z.number(),
    high_confidence: z.number(),
    medium_confidence: z.number(),
    low_confidence: z.number(),
    not_found: z.number(),
  }),
  api_calls: z.object({
    gemini: z.number(),
    isbndb: z.number(),
    total: z.number(),
  }),
  sample_results: z.array(z.object({
    title: z.string(),
    author: z.string(),
    isbn: z.string().nullable(),
    confidence: z.string(),
    match_quality: z.number(),
  })),
  duration_ms: z.number(),
});

const hybridTestRoute = createRoute({
  method: 'post',
  path: '/api/harvest/hybrid/test',
  tags: ['Harvest'],
  summary: 'Test Hybrid Workflow',
  description: `Test the hybrid Gemini + ISBNdb workflow with a specific year/month.

**Workflow:**
1. Gemini generates 20 book metadata records (title, author, publisher, format)
2. ISBNdb resolves authoritative ISBNs via title/author fuzzy search
3. Returns stats and sample results

**Quota Impact:**
- Gemini: 1 API call
- ISBNdb: 20 API calls (1 per book)`,
  request: {
    body: {
      content: {
        'application/json': {
          schema: HybridTestRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Hybrid workflow test results',
      content: {
        'application/json': {
          schema: HybridTestResponseSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
    },
  },
});

app.openapi(hybridTestRoute, async (c) => {
  const logger = c.get('logger');
  const { year, month } = c.req.valid('json');

  logger.info('[HybridTest] Starting hybrid workflow test', { year, month });

  try {
    const result = await generateHybridBackfillList(year, month, c.env, logger);

    // Sample first 5 results
    const sampleResults = result.resolutions.slice(0, 5).map((resolution, i) => ({
      title: result.candidates[i]?.title || 'Unknown',
      author: result.candidates[i]?.authors[0] || 'Unknown',
      isbn: resolution.isbn,
      confidence: resolution.confidence,
      match_quality: Math.round(resolution.match_quality * 100) / 100,
    }));

    return c.json({
      success: true,
      year,
      month,
      gemini_stats: {
        total_books: result.stats.total_books,
        books_with_publisher: result.stats.books_with_publisher,
        books_with_significance: result.stats.books_with_significance,
        model_used: result.stats.model_used,
      },
      isbn_resolution: result.stats.isbn_resolution,
      api_calls: result.stats.api_calls,
      sample_results: sampleResults,
      duration_ms: result.stats.duration_ms,
    });
  } catch (error) {
    logger.error('[HybridTest] Error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// =================================================================================
// GET /api/harvest/backfill/status - Check backfill progress
// =================================================================================

const backfillStatusRoute = createRoute({
  method: 'get',
  path: '/api/harvest/backfill/status',
  tags: ['Harvest'],
  summary: 'Check Backfill Status',
  description: 'Returns progress summary for historical book backfill (2005-present).',
  responses: {
    200: {
      description: 'Backfill status',
      content: {
        'application/json': {
          schema: BackfillStatusResponseSchema,
        },
      },
    },
  },
});

app.openapi(backfillStatusRoute, async (c) => {
  const logger = c.get('logger');
  const harvestState = new HarvestState(c.env.QUOTA_KV, logger);

  // Get summary statistics
  const summary = await harvestState.getSummary();

  // Get incomplete years
  const incompleteYears = await harvestState.getIncompleteYears(2005, new Date().getFullYear());

  // Determine next target
  let nextTarget = null;
  if (incompleteYears.length > 0) {
    const nextYear = incompleteYears[0];
    const nextMonth = await harvestState.getNextMonth(nextYear);
    if (nextMonth) {
      nextTarget = { year: nextYear, month: nextMonth };
    }
  }

  return c.json({
    summary,
    incomplete_years: incompleteYears,
    next_target: nextTarget,
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
  const logger = Logger.forScheduled(env);

  logger.info('Cover harvest: Starting scheduled harvest');

  // Parse harvest configuration
  const harvestConfig = parseHarvestConfig(env);

  // Initialize QuotaManager
  const quotaManager = new QuotaManager(env.QUOTA_KV, logger);

  // Check quota before starting
  const quotaCheck = await quotaManager.shouldAllowOperation('cron', 1);
  if (!quotaCheck.allowed) {
    logger.warn('Cover harvest: Quota check failed, skipping', {
      reason: quotaCheck.reason,
      status: quotaCheck.status,
    });
    return;
  }

  logger.info('Cover harvest: Quota check passed', {
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
      logger.info('Cover harvest: No editions found needing covers');
      return;
    }

    logger.info('Cover harvest: Found editions to process', { count: isbns.length });

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
    const batchResult = await batchUpdateCoverUrls(sql, updates, logger);

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
        logger.error('Cover harvest: Queue failed', {
          isbn: update.isbn,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }

    // Get updated quota status for logging
    const updatedQuota = await quotaManager.getQuotaStatus();

    logger.info('Cover harvest: Complete', {
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
    logger.error('Cover harvest: Failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  } finally {
    await sql.end();
  }
}

export default app;
