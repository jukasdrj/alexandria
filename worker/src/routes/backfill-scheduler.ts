/**
 * Backfill Scheduler Routes
 *
 * Systematic month-by-month backfill orchestration for AI-driven book enrichment.
 * Designed for cron-based execution with state tracking and dynamic cadence control.
 *
 * @module routes/backfill-scheduler
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import { createJobStatus } from '../services/async-backfill.js';
import { acquireMonthLock, releaseMonthLock } from '../services/advisory-locks.js';

// =================================================================================
// Schemas
// =================================================================================

const SchedulerRequestSchema = z.object({
  batch_size: z.number().int().min(1).max(50).default(10).openapi({
    description: 'Number of months to process in this batch',
    example: 10,
  }),
  dry_run: z.boolean().default(false).openapi({
    description: 'If true, only return months that would be processed without executing backfill',
    example: false,
  }),
  force_retry: z.boolean().default(false).openapi({
    description: 'If true, include failed months with retry_count < 5 in batch',
    example: false,
  }),
  year_range: z.object({
    start: z.number().int().min(1900).max(2100).optional(),
    end: z.number().int().min(1900).max(2100).optional(),
  }).optional().openapi({
    description: 'Optional year range filter (defaults to 2024 → 2000)',
    example: { start: 2020, end: 2024 },
  }),
}).openapi('BackfillSchedulerRequest');

const MonthStatusSchema = z.object({
  year: z.number().int(),
  month: z.number().int(),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'retry']),
  books_generated: z.number().int().optional(),
  isbns_resolved: z.number().int().optional(),
  resolution_rate: z.number().optional(),
  error_message: z.string().optional(),
}).openapi('MonthStatus');

const SchedulerResponseSchema = z.object({
  dry_run: z.boolean(),
  batch_size: z.number().int(),
  months_selected: z.number().int(),
  months: z.array(MonthStatusSchema),
  total_pending: z.number().int(),
  total_processing: z.number().int(),
  total_completed: z.number().int(),
  total_failed: z.number().int(),
  execution_summary: z.object({
    triggered: z.number().int(),
    skipped: z.number().int(),
    errors: z.number().int(),
  }).optional(),
}).openapi('BackfillSchedulerResponse');

const SchedulerStatsSchema = z.object({
  total_months: z.number().int(),
  by_status: z.object({
    pending: z.number().int(),
    processing: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
    retry: z.number().int(),
  }),
  progress: z.object({
    total_books_generated: z.number().int(),
    total_isbns_resolved: z.number().int(),
    overall_resolution_rate: z.number(),
    total_isbns_queued: z.number().int(),
  }),
  recent_activity: z.array(MonthStatusSchema),
}).openapi('BackfillSchedulerStats');

// =================================================================================
// Routes
// =================================================================================

const scheduleRoute = createRoute({
  method: 'post',
  path: '/api/internal/schedule-backfill',
  tags: ['Internal', 'Backfill'],
  summary: 'Schedule systematic month-by-month backfill operations',
  description: 'Triggers backfill for pending months in batch. Designed for cron execution.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SchedulerRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Backfill batch scheduled successfully',
      content: {
        'application/json': {
          schema: SchedulerResponseSchema,
        },
      },
    },
    401: {
      description: 'Missing or invalid X-Cron-Secret header',
    },
    500: {
      description: 'Scheduler execution failed',
    },
  },
});

const statsRoute = createRoute({
  method: 'get',
  path: '/api/internal/backfill-stats',
  tags: ['Internal', 'Backfill'],
  summary: 'Get backfill progress statistics',
  description: 'Returns aggregated stats on backfill completion, resolution rates, and recent activity',
  responses: {
    200: {
      description: 'Backfill statistics',
      content: {
        'application/json': {
          schema: SchedulerStatsSchema,
        },
      },
    },
    401: {
      description: 'Missing or invalid X-Cron-Secret header',
    },
  },
});

const seedRoute = createRoute({
  method: 'post',
  path: '/api/internal/seed-backfill-queue',
  tags: ['Internal', 'Backfill'],
  summary: 'Seed backfill_log with pending months (one-time setup)',
  description: 'Populates backfill_log with months from 2000-2024 marked as pending',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            year_start: z.number().int().min(1900).max(2100).default(2000),
            year_end: z.number().int().min(1900).max(2100).default(2024),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Backfill queue seeded successfully',
      content: {
        'application/json': {
          schema: z.object({
            months_seeded: z.number().int(),
            message: z.string(),
          }),
        },
      },
    },
    401: {
      description: 'Missing or invalid X-Cron-Secret header',
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

// Middleware: Verify cron secret
app.use('/api/internal/*', async (c, next) => {
  const cronSecret = c.req.header('X-Cron-Secret');
  const expectedSecret = c.env.ALEXANDRIA_WEBHOOK_SECRET;

  if (!cronSecret || !expectedSecret || cronSecret !== expectedSecret) {
    return c.json({ error: 'Unauthorized: Invalid or missing X-Cron-Secret' }, 401);
  }

  await next();
});

// POST /api/internal/schedule-backfill
app.openapi(scheduleRoute, async (c) => {
  const { batch_size, dry_run, force_retry, year_range } = c.req.valid('json');
  const sql = c.get('sql');
  const logger = c.get('logger');
  const env = c.env;

  logger.info('Backfill scheduler invoked', {
    batch_size,
    dry_run,
    force_retry,
    year_range,
  });

  try {
    // 1. Query pending/retry months (recent-first priority)
    const startYear = year_range?.start ?? 2024;
    const endYear = year_range?.end ?? 2000;

    const statusFilter = force_retry
      ? "status IN ('pending', 'retry', 'failed')"
      : "status IN ('pending', 'retry')";

    // 2. Get overall statistics (read-only, no transaction needed)
    const statusCounts = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM backfill_log
    `;

    const stats = statusCounts[0];

    // Track months that acquired locks (for cleanup in finally block)
    const lockedMonths: Array<{ year: number; month: number }> = [];
    let triggered = 0;
    let skipped = 0;
    let errors = 0;

    // Declare candidateMonths outside transaction scope so it can be referenced in response
    let candidateMonths: any[] = [];

    //  3. ATOMIC TRANSACTION: Query + Lock + Status Update
    // This prevents TOCTOU race condition where multiple schedulers
    // query the same pending months before locks are acquired.
    // Transaction provides snapshot isolation for SELECT query.
    await sql.begin(async (tx) => {
      // Query candidates INSIDE transaction for consistent snapshot
      candidateMonths = await tx`
        SELECT
          id,
          year,
          month,
          status,
          retry_count,
          books_generated,
          isbns_resolved,
          resolution_rate,
          error_message
        FROM backfill_log
        WHERE ${tx.unsafe(statusFilter)}
          AND year BETWEEN ${endYear} AND ${startYear}
          AND (status != 'failed' OR retry_count < 5)
        ORDER BY year DESC, month DESC
        LIMIT ${batch_size}
      `;

      logger.info('Candidate months retrieved (in transaction)', {
        count: candidateMonths.length,
        requested: batch_size,
      });

      // Dry run mode - return candidates without execution
      if (dry_run) {
        // Early return from transaction - no changes will be committed
        return c.json({
          dry_run: true,
          batch_size,
          months_selected: candidateMonths.length,
          months: candidateMonths.map((m: any) => ({
            year: m.year,
            month: m.month,
            status: m.status,
            books_generated: m.books_generated,
            isbns_resolved: m.isbns_resolved,
            resolution_rate: m.resolution_rate ? parseFloat(m.resolution_rate) : undefined,
            error_message: m.error_message,
          })),
          total_pending: parseInt(stats.pending || '0'),
          total_processing: parseInt(stats.processing || '0'),
          total_completed: parseInt(stats.completed || '0'),
          total_failed: parseInt(stats.failed || '0'),
        });
      }

      // Execute backfill for each candidate month (with advisory locks)
      for (const candidate of candidateMonths) {
        // Try to acquire lock for this month (10s timeout)
        // IMPORTANT: Lock acquired INSIDE transaction, but persists after COMMIT
        // Advisory locks are session-scoped, not transaction-scoped
        const lockAcquired = await acquireMonthLock(
          tx, // Use transaction handle
          candidate.year,
          candidate.month,
          10000, // 10 second timeout
          logger
        );

        if (!lockAcquired) {
          // Lock unavailable - another Worker is processing this month
          skipped++;
          logger.info('Month lock unavailable - skipping (another process may be running)', {
            year: candidate.year,
            month: candidate.month,
          });
          continue;
        }

        // Track locked month for cleanup in finally block
        lockedMonths.push({ year: candidate.year, month: candidate.month });

        try {
          // Lock acquired - proceed with processing
          logger.debug('Month lock acquired - proceeding with backfill', {
            year: candidate.year,
            month: candidate.month,
          });

          // Update status to 'processing' INSIDE transaction
          // This ensures atomicity: If queue send fails, transaction rollback reverts status
          await tx`
            UPDATE backfill_log
            SET
              status = 'processing',
              started_at = NOW(),
              completed_at = NULL,
              error_message = NULL,
              last_retry_at = CASE WHEN ${candidate.status} = 'retry' THEN NOW() ELSE last_retry_at END
            WHERE id = ${candidate.id}
              AND status IN ('pending', 'retry')  -- Defense-in-depth: Prevent clobbering
          `;

          // Determine prompt variant based on year
          const promptVariant = candidate.year >= 2020 ? 'contemporary-notable' : 'baseline';

          // Create job status in KV before queuing
          const jobId = crypto.randomUUID();
          await createJobStatus(env.QUOTA_KV, jobId, candidate.year, candidate.month);

          // Send job directly to BACKFILL_QUEUE
          // NOTE: If this fails, transaction rollback will revert status update
          await env.BACKFILL_QUEUE.send({
            job_id: jobId,
            year: candidate.year,
            month: candidate.month,
            batch_size: 20, // 20 books per provider (40 total after dedup)
            prompt_variant: promptVariant,
            dry_run: false,
          });

          logger.debug('Job sent to BACKFILL_QUEUE', {
            job_id: jobId,
            year: candidate.year,
            month: candidate.month,
          });

          triggered++;
          logger.info('Backfill triggered', {
            year: candidate.year,
            month: candidate.month,
            prompt_variant: promptVariant,
          });
        } catch (error) {
          errors++;
          const errorMsg = error instanceof Error ? error.message : String(error);

          logger.error('Backfill execution failed (will rollback status update)', {
            year: candidate.year,
            month: candidate.month,
            error: errorMsg,
            retry_count: candidate.retry_count + 1,
          });

          // Throw error to trigger transaction rollback
          // Status update will be reverted, month remains pending/retry
          // Lock will be released in finally block (session-scoped)
          throw error;
        }
      }

      // Transaction COMMIT: All status updates persist atomically
    });

    // 4. Release all acquired locks (OUTSIDE transaction, uses sql not tx)
    // Advisory locks are session-scoped, so must be explicitly released
    // even after transaction commit
    for (const { year, month } of lockedMonths) {
      await releaseMonthLock(sql, year, month, logger);
    }

    logger.info('Scheduler execution complete', {
      triggered,
      skipped,
      errors,
      batch_size,
    });

    return c.json({
      dry_run: false,
      batch_size,
      months_selected: candidateMonths.length,
      months: candidateMonths.map((m: any) => ({
        year: m.year,
        month: m.month,
        status: m.status,
      })),
      total_pending: parseInt(stats.pending || '0'),
      total_processing: parseInt(stats.processing || '0'),
      total_completed: parseInt(stats.completed || '0'),
      total_failed: parseInt(stats.failed || '0'),
      execution_summary: {
        triggered,
        skipped,
        errors,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Scheduler execution failed', { error: errorMsg });
    return c.json({ error: 'Scheduler execution failed', details: errorMsg }, 500);
  }
});

// GET /api/internal/backfill-stats
app.openapi(statsRoute, async (c) => {
  const sql = c.get('sql');
  const logger = c.get('logger');

  try {
    // Aggregate statistics
    const stats = await sql`
      SELECT
        COUNT(*) AS total_months,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'retry') AS retry,
        SUM(books_generated) FILTER (WHERE books_generated IS NOT NULL) AS total_books_generated,
        SUM(isbns_resolved) FILTER (WHERE isbns_resolved IS NOT NULL) AS total_isbns_resolved,
        SUM(isbns_queued) FILTER (WHERE isbns_queued IS NOT NULL) AS total_isbns_queued
      FROM backfill_log
    `;

    const recentActivity = await sql`
      SELECT
        year,
        month,
        status,
        books_generated,
        isbns_resolved,
        resolution_rate,
        error_message
      FROM backfill_log
      WHERE completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 20
    `;

    const row = stats[0];
    const totalBooksGenerated = parseInt(row.total_books_generated || '0');
    const totalIsbnsResolved = parseInt(row.total_isbns_resolved || '0');
    const overallResolutionRate =
      totalBooksGenerated > 0 ? (totalIsbnsResolved / totalBooksGenerated) * 100 : 0;

    return c.json({
      total_months: parseInt(row.total_months || '0'),
      by_status: {
        pending: parseInt(row.pending || '0'),
        processing: parseInt(row.processing || '0'),
        completed: parseInt(row.completed || '0'),
        failed: parseInt(row.failed || '0'),
        retry: parseInt(row.retry || '0'),
      },
      progress: {
        total_books_generated: totalBooksGenerated,
        total_isbns_resolved: totalIsbnsResolved,
        overall_resolution_rate: parseFloat(overallResolutionRate.toFixed(2)),
        total_isbns_queued: parseInt(row.total_isbns_queued || '0'),
      },
      recent_activity: recentActivity.map((m: any) => ({
        year: m.year,
        month: m.month,
        status: m.status,
        books_generated: m.books_generated,
        isbns_resolved: m.isbns_resolved,
        resolution_rate: m.resolution_rate ? parseFloat(m.resolution_rate) : undefined,
        error_message: m.error_message,
      })),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to retrieve backfill stats', { error: errorMsg });
    return c.json({ error: 'Failed to retrieve stats', details: errorMsg }, 500);
  }
});

// POST /api/internal/seed-backfill-queue
app.openapi(seedRoute, async (c) => {
  const { year_start, year_end } = c.req.valid('json');
  const sql = c.get('sql');
  const logger = c.get('logger');

  try {
    logger.info('Seeding backfill queue', { year_start, year_end });

    // Generate all month combinations for year range
    const result = await sql`
      INSERT INTO backfill_log (year, month, status, prompt_variant, batch_size)
      SELECT
        y.year::INT,
        m.month::INT,
        'pending'::VARCHAR,
        CASE WHEN y.year >= 2020 THEN 'contemporary-notable' ELSE 'baseline' END,
        20
      FROM
        generate_series(${year_start}::INT, ${year_end}::INT) AS y(year)
        CROSS JOIN generate_series(1, 12) AS m(month)
      WHERE
        (y.year < ${year_end}) OR (y.year = ${year_end} AND m.month <= 12)
      ORDER BY y.year DESC, m.month DESC
      ON CONFLICT (year, month) DO NOTHING
    `;

    const monthsSeeded = result.count || 0;

    logger.info('Backfill queue seeded', {
      year_start,
      year_end,
      months_seeded: monthsSeeded,
    });

    return c.json({
      months_seeded: monthsSeeded,
      message: `Successfully seeded ${monthsSeeded} months (${year_start}-${year_end})`,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to seed backfill queue', { error: errorMsg });
    return c.json({ error: 'Failed to seed queue', details: errorMsg }, 500);
  }
});

export default app;
