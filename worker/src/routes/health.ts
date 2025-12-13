import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';

// =================================================================================
// Response Schemas (defined inline for proper type inference)
// =================================================================================

const HealthSuccessSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('connected'),
  r2_covers: z.enum(['bound', 'not_configured']),
  hyperdrive_latency_ms: z.number(),
  timestamp: z.string(),
}).openapi('HealthSuccess');

const HealthErrorSchema = z.object({
  status: z.literal('error'),
  database: z.literal('disconnected'),
  r2_covers: z.enum(['bound', 'not_configured']),
  timestamp: z.string(),
  message: z.string(),
}).openapi('HealthError');

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
          schema: HealthErrorSchema,
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
  try {
    const sql = c.get('sql');
    const start = Date.now();
    await sql`SELECT 1`;
    const latency = Date.now() - start;

    const r2Status: 'bound' | 'not_configured' = c.env.COVER_IMAGES ? 'bound' : 'not_configured';

    return c.json({
      status: 'ok' as const,
      database: 'connected' as const,
      r2_covers: r2Status,
      hyperdrive_latency_ms: latency,
      timestamp: new Date().toISOString(),
    }, 200);
  } catch (e) {
    const logger = c.get('logger');
    logger.error('Health check DB error', { error: e instanceof Error ? e.message : 'Unknown' });
    const r2Status: 'bound' | 'not_configured' = c.env.COVER_IMAGES ? 'bound' : 'not_configured';
    return c.json({
      status: 'error' as const,
      database: 'disconnected' as const,
      r2_covers: r2Status,
      timestamp: new Date().toISOString(),
      message: e instanceof Error ? e.message : 'Unknown error',
    }, 503);
  }
});

export default app;
