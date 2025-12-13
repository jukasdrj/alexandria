import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';
import {
  createSuccessSchema,
  ErrorResponseSchema,
  createSuccessResponse,
  createErrorResponse,
  ErrorCode,
  ResponseMetaSchema,
} from '../schemas/response.js';

// =================================================================================
// Health Data Schema
// =================================================================================

const HealthDataSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['connected', 'disconnected']),
  r2_covers: z.enum(['bound', 'not_configured']),
  hyperdrive_latency_ms: z.number().optional(),
}).openapi('HealthData');

// Success response with envelope
const HealthSuccessSchema = createSuccessSchema(HealthDataSchema, 'HealthSuccess');

// =================================================================================
// Health Route Definition
// =================================================================================

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'System health check',
  description: 'Returns API health status including database connectivity and R2 binding status.',
  responses: {
    200: {
      description: 'System is healthy',
      content: {
        'application/json': {
          schema: HealthSuccessSchema,
        },
      },
    },
    503: {
      description: 'Service unavailable - database disconnected',
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

app.openapi(healthRoute, async (c) => {
  const r2Status: 'bound' | 'not_configured' = c.env.COVER_IMAGES ? 'bound' : 'not_configured';

  try {
    const sql = c.get('sql');
    const start = Date.now();
    await sql`SELECT 1`;
    const latency = Date.now() - start;

    return createSuccessResponse(c, {
      status: 'ok' as const,
      database: 'connected' as const,
      r2_covers: r2Status,
      hyperdrive_latency_ms: latency,
    });
  } catch (e) {
    const logger = c.get('logger');
    logger.error('Health check DB error', { error: e instanceof Error ? e.message : 'Unknown' });

    return createErrorResponse(
      c,
      ErrorCode.DATABASE_ERROR,
      'Database connection failed',
      {
        r2_covers: r2Status,
        details: e instanceof Error ? e.message : 'Unknown error',
      }
    );
  }
});

export default app;
