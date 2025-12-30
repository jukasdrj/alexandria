import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';
import {
  createSuccessSchema,
  ErrorResponseSchema,
  createSuccessResponse,
  createErrorResponse,
  ErrorCode,
} from '../schemas/response.js';
import { QuotaManager } from '../services/quota-manager.js';

// =================================================================================
// Quota Status Data Schemas
// =================================================================================

const QuotaDataSchema = z.object({
  daily_limit: z.number().int().positive().openapi({
    description: 'Total daily API call limit',
    example: 15000,
  }),
  safety_limit: z.number().int().positive().openapi({
    description: 'Safety threshold (daily_limit - buffer)',
    example: 13000,
  }),
  used: z.number().int().nonnegative().openapi({
    description: 'Number of API calls used today',
    example: 5234,
  }),
  remaining: z.number().int().nonnegative().openapi({
    description: 'API calls remaining until daily limit',
    example: 9766,
  }),
  safety_remaining: z.number().int().nonnegative().openapi({
    description: 'API calls remaining until safety limit (recommended max)',
    example: 7766,
  }),
  percentage_used: z.number().min(0).max(100).openapi({
    description: 'Percentage of safety limit used',
    example: 40.26,
  }),
  reset_at: z.string().datetime().openapi({
    description: 'UTC midnight timestamp when quota resets',
    example: '2025-12-31T00:00:00Z',
  }),
  can_make_calls: z.boolean().openapi({
    description: 'Whether calls can be made without exceeding safety limit',
    example: true,
  }),
}).openapi('QuotaData');

// Success response with envelope
const QuotaSuccessSchema = createSuccessSchema(QuotaDataSchema, 'QuotaSuccess');

// =================================================================================
// Quota Status Route Definition
// =================================================================================

const quotaRoute = createRoute({
  method: 'get',
  path: '/api/quota/status',
  tags: ['System'],
  summary: 'ISBNdb API quota status',
  description: 'Returns current ISBNdb Premium API quota usage. The API has a daily limit of 15,000 calls with a safety threshold of 13,000 (keeping 2,000 calls in reserve). Use this endpoint to monitor quota usage before initiating bulk operations.',
  responses: {
    200: {
      description: 'Quota status retrieved successfully',
      content: {
        'application/json': {
          schema: QuotaSuccessSchema,
        },
      },
      headers: z.object({
        'cache-control': z.string().openapi({
          example: 'public, max-age=60',
        }),
      }),
    },
    500: {
      description: 'Failed to retrieve quota status',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handler
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(quotaRoute, async (c) => {
  try {
    const env = c.env;

    // Initialize QuotaManager with KV cache
    const quotaManager = new QuotaManager(env.CACHE);

    // Get quota status
    const status = await quotaManager.getQuotaStatus();

    // Calculate percentage used
    const safetyLimit = status.limit - 2000; // 15000 - 2000 = 13000
    const percentageUsed = (status.used_today / safetyLimit) * 100;

    const quotaData = {
      daily_limit: status.limit,
      safety_limit: safetyLimit,
      used: status.used_today,
      remaining: status.remaining,
      safety_remaining: status.buffer_remaining,
      percentage_used: Math.round(percentageUsed * 100) / 100, // Round to 2 decimals
      reset_at: getNextResetTime().toISOString(),
      can_make_calls: status.can_make_calls,
    };

    return createSuccessResponse(c, quotaData, 200, {
      'cache-control': 'public, max-age=60',
    });
  } catch (e) {
    const logger = c.get('logger');
    logger.error('Quota status retrieval error', { error: e instanceof Error ? e.message : 'Unknown' });

    return createErrorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      'Failed to retrieve quota status',
      { details: e instanceof Error ? e.message : 'Unknown error' }
    );
  }
});

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Calculate the next UTC midnight timestamp (when quota resets)
 */
function getNextResetTime(): Date {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  return nextMidnight;
}

export default app;
