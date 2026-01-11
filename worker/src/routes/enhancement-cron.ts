/**
 * Enhancement Cron Routes - Synthetic Works Enhancement
 *
 * Provides:
 * - POST /api/internal/enhance-synthetic-works - Daily cron endpoint to enhance synthetic works
 *
 * Purpose: Deferred ISBNdb enhancement for synthetic works created during quota exhaustion.
 * When backfill exhausts ISBNdb quota, Gemini creates synthetic works (completeness_score=30).
 * This endpoint enhances them with full ISBNdb metadata when quota refreshes.
 *
 * Flow:
 * 1. Query synthetic works (synthetic=true, completeness_score<50, last_isbndb_sync=NULL)
 * 2. Resolve ISBN via ISBNdb title/author search
 * 3. Create enriched_editions record
 * 4. Queue for full enrichment (Wikidata, Archive.org, Google Books, covers)
 * 5. Update completeness_score (30 → 80) and last_isbndb_sync
 *
 * Scheduled: Daily at 00:00 UTC (right after ISBNdb quota reset)
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppBindings, Env } from '../env.js';
import {
  getSyntheticWorksForEnhancement,
  enhanceSyntheticBatch,
} from '../services/synthetic-enhancement.js';
import { Logger } from '../../lib/logger.js';
import postgres from 'postgres';

const app = new OpenAPIHono<AppBindings>();

// =================================================================================
// Schemas
// =================================================================================

const EnhancementRequestSchema = z.object({
  batch_size: z.number().int().min(1).max(500).default(100).describe('Number of synthetic works to enhance (1-500, default: 100)'),
  dry_run: z.boolean().default(false).describe('If true, query candidates but do not enhance (for testing)'),
}).openapi('EnhancementRequest');

const EnhancementResponseSchema = z.object({
  success: z.boolean().describe('Overall operation success'),
  dry_run: z.boolean().describe('Whether this was a dry run (no actual enhancements)'),
  stats: z.object({
    candidates_found: z.number().describe('Total synthetic works found needing enhancement'),
    total_attempted: z.number().describe('Number of enhancement attempts'),
    isbns_resolved: z.number().describe('Successfully resolved ISBNs via ISBNdb search'),
    editions_created: z.number().describe('enriched_editions records created'),
    enrichment_queued: z.number().describe('Works queued for full enrichment'),
    no_isbn_found: z.number().describe('Works where ISBNdb search returned no results'),
    errors: z.number().describe('Enhancement failures (errors)'),
    api_calls_used: z.number().describe('ISBNdb API calls consumed'),
    quota_exhausted: z.boolean().describe('Whether quota was exhausted mid-batch'),
    duration_ms: z.number().describe('Total processing time in milliseconds'),
  }).describe('Detailed enhancement statistics'),
  sample_candidates: z.array(z.object({
    work_key: z.string(),
    title: z.string(),
    author: z.string().nullable(),
    completeness_score: z.number(),
    created_at: z.string(),
  })).describe('Sample of candidates found (max 10, only in dry_run mode)'),
}).openapi('EnhancementResponse');

// =================================================================================
// POST /api/internal/enhance-synthetic-works - Daily cron endpoint
// =================================================================================

const enhancementRoute = createRoute({
  method: 'post',
  path: '/api/internal/enhance-synthetic-works',
  tags: ['Internal'],
  summary: 'Enhance Synthetic Works (Cron)',
  description: `
Daily cron endpoint to enhance synthetic works created during ISBNdb quota exhaustion.

**Authentication**: Requires \`X-Cron-Secret\` header matching \`ALEXANDRIA_WEBHOOK_SECRET\`.

**Scheduled**: Daily at 00:00 UTC (right after ISBNdb quota reset).

**Process**:
1. Query synthetic works (synthetic=true, completeness_score<50, last_isbndb_sync=NULL)
2. Resolve ISBN via ISBNdb title/author search (reuses isbn-resolution.ts)
3. Create enriched_editions record
4. Queue for full enrichment (Wikidata, Archive.org, Google Books, covers)
5. Update completeness_score (30 → 80) and last_isbndb_sync

**Quota Management**:
- Checks quota before starting
- Atomically reserves quota for each API call (prevents race conditions)
- Stops gracefully if quota exhausted mid-batch
- Returns quota usage statistics

**Dry Run Mode**:
- Set \`dry_run=true\` to query candidates without enhancing
- Returns sample of candidates found (max 10)
- Useful for testing and monitoring

**Recommended Batch Size**: 100 works/day (balances quota usage vs coverage)
  `.trim(),
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnhancementRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Enhancement completed (or dry run)',
      content: {
        'application/json': {
          schema: EnhancementResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - Invalid or missing X-Cron-Secret header',
    },
    500: {
      description: 'Internal server error',
    },
  },
});

app.openapi(enhancementRoute, async (c) => {
  const logger = c.get('logger');
  const sql = c.get('sql');
  const env = c.env;

  // ===== Authentication =====
  // Require X-Cron-Secret header matching ALEXANDRIA_WEBHOOK_SECRET
  const cronSecret = c.req.header('X-Cron-Secret');
  const expectedSecret = env.ALEXANDRIA_WEBHOOK_SECRET;

  if (!expectedSecret) {
    logger.error('[EnhancementCron] ALEXANDRIA_WEBHOOK_SECRET not configured');
    return c.json({ error: 'Authentication not configured' }, 500);
  }

  if (!cronSecret || cronSecret !== expectedSecret) {
    logger.warn('[EnhancementCron] Unauthorized access attempt', {
      has_secret: !!cronSecret,
      ip: c.req.header('CF-Connecting-IP'),
    });
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // ===== Parse Request =====
  const body = await c.req.json();
  const validated = EnhancementRequestSchema.parse(body);
  const { batch_size, dry_run } = validated;

  logger.info('[EnhancementCron] Enhancement job started', {
    batch_size,
    dry_run,
  });

  const startTime = Date.now();

  try {
    // ===== Query Candidates =====
    const candidates = await getSyntheticWorksForEnhancement(batch_size, sql, logger);

    logger.info('[EnhancementCron] Candidates found', {
      count: candidates.length,
      requested: batch_size,
    });

    // ===== Dry Run Mode =====
    if (dry_run) {
      // Return sample of candidates without enhancing
      const sample = candidates.slice(0, 10).map(c => ({
        work_key: c.work_key,
        title: c.title,
        author: c.author,
        completeness_score: c.completeness_score,
        created_at: c.created_at.toISOString(),
      }));

      return c.json({
        success: true,
        dry_run: true,
        stats: {
          candidates_found: candidates.length,
          total_attempted: 0,
          isbns_resolved: 0,
          editions_created: 0,
          enrichment_queued: 0,
          no_isbn_found: 0,
          errors: 0,
          api_calls_used: 0,
          quota_exhausted: false,
          duration_ms: Date.now() - startTime,
        },
        sample_candidates: sample,
      });
    }

    // ===== Enhancement (Production) =====
    const stats = await enhanceSyntheticBatch(candidates, sql, env, logger);

    logger.info('[EnhancementCron] Enhancement job complete', {
      duration_ms: stats.duration_ms,
      isbns_resolved: stats.isbns_resolved,
      quota_exhausted: stats.quota_exhausted,
    });

    return c.json({
      success: true,
      dry_run: false,
      stats: {
        candidates_found: candidates.length,
        total_attempted: stats.total_attempted,
        isbns_resolved: stats.isbns_resolved,
        editions_created: stats.editions_created,
        enrichment_queued: stats.enrichment_queued,
        no_isbn_found: stats.not_found,
        errors: stats.errors,
        api_calls_used: stats.api_calls_used,
        quota_exhausted: stats.quota_exhausted,
        duration_ms: stats.duration_ms,
      },
      sample_candidates: [], // Only populated in dry_run mode
    });
  } catch (error) {
    logger.error('[EnhancementCron] Enhancement job failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return c.json(
      {
        success: false,
        dry_run,
        stats: {
          candidates_found: 0,
          total_attempted: 0,
          isbns_resolved: 0,
          editions_created: 0,
          enrichment_queued: 0,
          no_isbn_found: 0,
          errors: 1,
          api_calls_used: 0,
          quota_exhausted: false,
          duration_ms: Date.now() - startTime,
        },
        sample_candidates: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// =================================================================================
// Scheduled Handler - Called by index.ts scheduled() event
// =================================================================================

/**
 * Handle scheduled synthetic enhancement cron (daily at 00:00 UTC)
 *
 * This function is called by the Worker's scheduled() handler when the
 * "0 0 * * *" cron trigger fires. It enhances synthetic works created
 * during ISBNdb quota exhaustion.
 *
 * @param env - Worker environment bindings
 */
export async function handleScheduledSyntheticEnhancement(env: Env): Promise<void> {
  const logger = Logger.forScheduled(env);

  logger.info('[ScheduledEnhancement] Daily synthetic enhancement started');

  const startTime = Date.now();

  try {
    // Create database connection
    const sql = postgres(env.HYPERDRIVE.connectionString, {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    try {
      // Query synthetic works ready for enhancement (default batch size: 500)
      const candidates = await getSyntheticWorksForEnhancement(500, sql, logger);

      if (candidates.length === 0) {
        logger.info('[ScheduledEnhancement] No synthetic works need enhancement');
        return;
      }

      logger.info('[ScheduledEnhancement] Found candidates for enhancement', {
        count: candidates.length,
      });

      // Enhance batch
      const stats = await enhanceSyntheticBatch(candidates, sql, env, logger);

      logger.info('[ScheduledEnhancement] Daily enhancement complete', {
        duration_ms: Date.now() - startTime,
        candidates_found: candidates.length,
        isbns_resolved: stats.isbns_resolved,
        editions_created: stats.editions_created,
        enrichment_queued: stats.enrichment_queued,
        api_calls_used: stats.api_calls_used,
        quota_exhausted: stats.quota_exhausted,
        errors: stats.errors,
      });
    } finally {
      await sql.end();
    }
  } catch (error) {
    logger.error('[ScheduledEnhancement] Daily enhancement failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration_ms: Date.now() - startTime,
    });

    // Don't throw - allow other scheduled tasks to continue
    // Monitoring should catch this via logs
  }
}

export default app;
