/**
 * Async Backfill Routes - Queue-based Historical Book Harvesting
 *
 * Replaces synchronous backfill with async queue-based processing
 * to avoid client timeouts and leverage existing enrichment infrastructure.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import { HarvestState } from '../services/harvest-state.js';
import {
  createJobStatus,
  getJobStatus,
  type BackfillQueueMessage,
} from '../services/async-backfill.js';

const app = new OpenAPIHono<AppBindings>();

// =================================================================================
// Schemas
// =================================================================================

const BackfillRequestSchema = z.object({
  year: z.number().int().min(2005).max(2030).optional()
    .describe('Specific year to backfill (2005-2030). If omitted, processes next incomplete year.'),
  month: z.number().int().min(1).max(12).optional()
    .describe('Specific month to backfill (1-12). If omitted, processes next incomplete month.'),
  batch_size: z.number().int().min(10).max(50).optional()
    .describe('Number of books to generate (default: 20, A/B test with 50)'),
});

const BackfillResponseSchema = z.object({
  success: z.boolean(),
  job_id: z.string(),
  year: z.number(),
  month: z.number(),
  status: z.string(),
  message: z.string(),
  status_url: z.string(),
});

const BackfillStatusSchema = z.object({
  job_id: z.string(),
  year: z.number(),
  month: z.number(),
  status: z.string(),
  progress: z.string(),
  stats: z.object({
    gemini_books_generated: z.number().optional(),
    isbns_resolved: z.number().optional(),
    isbn_resolution_rate: z.number().optional(),
    isbns_sent_to_enrichment: z.number().optional(),
  }).optional(),
  error: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
});

// =================================================================================
// POST /api/harvest/backfill - Queue backfill job
// =================================================================================

const backfillRoute = createRoute({
  method: 'post',
  path: '/api/harvest/backfill',
  tags: ['Harvest'],
  summary: 'Queue Historical Book Backfill (Async)',
  description: `Queue historically significant books for async enrichment.

**Async Workflow:**
1. Returns 202 Accepted immediately with job_id
2. Job processes in background via BACKFILL_QUEUE
3. Poll GET /api/harvest/backfill/status/{job_id} for progress

**Background Processing:**
- Gemini generates N books (batch_size, default 20)
- ISBNdb resolves ISBNs via title/author search
- Sends to ENRICHMENT_QUEUE (reuses existing infrastructure!)

**No timeouts** - Job runs in background, client can disconnect.`,
  request: {
    body: {
      content: {
        'application/json': {
          schema: BackfillRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Job queued successfully',
      content: {
        'application/json': {
          schema: BackfillResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
    },
  },
});

app.openapi(backfillRoute, async (c) => {
  const logger = c.get('logger');
  const body = c.req.valid('json');

  // Parse request
  const requestedYear = body.year;
  const requestedMonth = body.month;
  const batchSize = body.batch_size ?? 20;

  // Initialize services
  const harvestState = new HarvestState(c.env.QUOTA_KV, logger);

  // Determine year/month to process
  let year = requestedYear;
  let month = requestedMonth;

  if (!year) {
    // Get next incomplete year
    const incompleteYears = await harvestState.getIncompleteYears(2005, new Date().getFullYear());
    if (incompleteYears.length === 0) {
      return c.json({
        success: false,
        error: 'All years complete (2005-present)',
      }, 400);
    }
    year = incompleteYears[0];
  }

  if (!month) {
    // Get next incomplete month for this year
    const nextMonth = await harvestState.getNextMonth(year);
    if (!nextMonth) {
      return c.json({
        success: false,
        error: `Year ${year} is already complete`,
      }, 400);
    }
    month = nextMonth;
  }

  // Check if month already completed (idempotency)
  const isComplete = await harvestState.isMonthComplete(year, month);
  if (isComplete) {
    logger.warn('[BackfillAsync] Month already complete', { year, month });
    return c.json({
      success: false,
      error: `${year}-${month.toString().padStart(2, '0')} already backfilled`,
    }, 400);
  }

  // Generate job ID
  const job_id = crypto.randomUUID();

  logger.info('[BackfillAsync] Queueing job', { job_id, year, month, batch_size: batchSize });

  // Create initial job status in KV
  await createJobStatus(c.env.QUOTA_KV, job_id, year, month);

  // Send job to BACKFILL_QUEUE
  const message: BackfillQueueMessage = {
    job_id,
    year,
    month,
    batch_size: batchSize,
  };

  await c.env.BACKFILL_QUEUE.send(message);

  logger.info('[BackfillAsync] Job queued successfully', { job_id });

  // Return 202 Accepted with job_id and status URL
  return c.json({
    success: true,
    job_id,
    year,
    month,
    status: 'queued',
    message: 'Backfill job queued successfully. Poll status URL for progress.',
    status_url: `/api/harvest/backfill/status/${job_id}`,
  }, 202);
});

// =================================================================================
// GET /api/harvest/backfill/status/:jobId - Poll job status
// =================================================================================

const statusRoute = createRoute({
  method: 'get',
  path: '/api/harvest/backfill/status/:jobId',
  tags: ['Harvest'],
  summary: 'Get Backfill Job Status',
  description: 'Poll for backfill job progress. Status updates in real-time as job processes.',
  request: {
    params: z.object({
      jobId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Job status',
      content: {
        'application/json': {
          schema: BackfillStatusSchema,
        },
      },
    },
    404: {
      description: 'Job not found',
    },
  },
});

app.openapi(statusRoute, async (c) => {
  const { jobId } = c.req.valid('param');
  const logger = c.get('logger');

  logger.debug('[BackfillStatus] Fetching job status', { job_id: jobId });

  const status = await getJobStatus(c.env.QUOTA_KV, jobId);

  if (!status) {
    return c.json({
      error: 'Job not found',
      message: `No backfill job found with ID: ${jobId}`,
    }, 404);
  }

  return c.json(status);
});

export default app;
