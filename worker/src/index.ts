import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import postgres from 'postgres';
import type { AppBindings, Env } from './env.js';
import { createOpenAPIApp, registerOpenAPIDoc } from './openapi.js';
import { errorHandler } from '../middleware/error-handler.js'; // Now uses ResponseEnvelope format
import { Logger } from '../lib/logger.js';
import { getDashboardHTML } from '../dashboard.js';

// Route imports
import healthRoutes from './routes/health.js';
import statsRoutes from './routes/stats.js';
import searchRoutes from './routes/search.js';
import { enrichRoutes } from './routes/enrich.js';
import coversRoutes from './routes/covers.js';
import coversLegacyRoutes from './routes/covers-legacy.js';
import authorsRoutes from './routes/authors.js';
import testRoutes from './routes/test.js';

// Queue handlers (migrated to TypeScript)
import { processCoverQueue, processEnrichmentQueue } from './services/queue-handlers.js';

// =================================================================================
// Application Setup
// =================================================================================

const app = createOpenAPIApp();

// =================================================================================
// Global Middleware
// =================================================================================

// CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID', 'X-Response-Time'],
  maxAge: 86400,
}));

// Security headers
app.use('*', secureHeaders());

// Error handler
app.onError(errorHandler);

// Request ID middleware
app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') ||
                    c.req.header('x-request-id') ||
                    crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});

// Logger middleware
app.use('*', async (c, next) => {
  const logger = new Logger({
    level: c.env.LOG_LEVEL || 'info',
    structured: c.env.STRUCTURED_LOGGING === 'true',
    requestId: c.get('requestId'),
  });
  c.set('logger', logger);
  await next();
});

// Response timing middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  c.header('X-Response-Time', `${Date.now() - start}ms`);
});

// Database connection middleware
app.use('*', async (c, next) => {
  const sql = postgres(c.env.HYPERDRIVE.connectionString, {
    max: 1, // Single connection per request, Hyperdrive handles pooling
    fetch_types: false,
    prepare: false,
  });
  c.set('sql', sql);
  c.set('startTime', Date.now());
  await next();
});

// =================================================================================
// Routes
// =================================================================================

// Dashboard (root)
app.get('/', (c) => {
  return c.html(getDashboardHTML(), 200, {
    'cache-control': 'public, max-age=3600',
  });
});

// Collect sub-routers for OpenAPI spec merging
const subRouters = [
  healthRoutes,
  statsRoutes,
  searchRoutes,
  enrichRoutes,
  coversRoutes,
  coversLegacyRoutes,
  authorsRoutes,
  testRoutes,
];

// Register route modules
for (const router of subRouters) {
  app.route('/', router);
}

// Register OpenAPI documentation endpoint AFTER all routes are mounted
// Merges OpenAPI specs from all sub-routers
registerOpenAPIDoc(app, subRouters);

// Cleanup middleware - close DB connection after request
app.use('*', async (c, next) => {
  await next();
  const sql = c.get('sql');
  if (sql) {
    try {
      await sql.end();
    } catch {
      // Connection may already be closed
    }
  }
});

// =================================================================================
// Route Migration Status - PHASE 2 COMPLETE ✅
// ✅ GET /api/stats - DONE (Batch 1)
// ✅ GET /api/search - DONE (Batch 1)
// ✅ POST /api/enrich/* - DONE (Batch 1)
// ✅ POST /api/covers/process - DONE (Batch 2)
// ✅ GET /api/covers/:work_key/:size - DONE (Batch 2)
// ✅ POST /api/covers/queue - DONE (Batch 2)
// ✅ GET /covers/:isbn/status (legacy) - DONE (Batch 2)
// ✅ GET /covers/:isbn/:size (legacy) - DONE (Batch 2)
// ✅ POST /covers/:isbn/process (legacy) - DONE (Batch 2)
// ✅ POST /covers/batch (legacy) - DONE (Batch 2)
// ✅ GET /api/authors/top - DONE (Batch 3)
// ✅ GET /api/authors/:key - DONE (Batch 3)
// ✅ POST /api/authors/bibliography - DONE (Batch 3)
// ✅ POST /api/authors/enrich-bibliography - DONE (Batch 3)
// ✅ POST /api/authors/enrich-wikidata - DONE (Batch 3)
// ✅ GET /api/authors/enrich-status - DONE (Batch 3)
// ✅ GET /api/test/isbndb/* (8 routes) - DONE (Batch 3)
// ✅ POST /api/test/jsquash - DONE (Batch 3)
// ✅ GET /api/test/wikidata - DONE (Batch 3)
// =================================================================================

// =================================================================================
// Export App Type for Hono RPC Client
// =================================================================================

/**
 * Alexandria Hono app type for RPC client integration
 *
 * Use this type with Hono's `hc` client for compile-time route validation:
 *
 * @example
 * ```typescript
 * import { hc } from 'hono/client'
 * import type { AlexandriaAppType } from 'alexandria-worker'
 *
 * const client = hc<AlexandriaAppType>('https://alexandria.ooheynerds.com')
 * const response = await client.api.search.$get({ query: { isbn: '9780439064873' } })
 * ```
 */
export type AlexandriaAppType = typeof app;

// =================================================================================
// Export with Queue Handlers
// =================================================================================

export default {
  fetch: app.fetch,

  // Queue consumer handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext) {
    switch (batch.queue) {
      case 'alexandria-cover-queue':
        // Cast to expected type for cover queue handler
        return await processCoverQueue(batch as any, env);
      case 'alexandria-enrichment-queue':
        // Cast to expected type for enrichment queue handler
        return await processEnrichmentQueue(batch as any, env);
      default:
        console.error(`Unknown queue: ${batch.queue}`);
        batch.messages.forEach((msg: Message) => msg.ack());
    }
  },

  // Scheduled handler (cron)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`[Cron] Triggered at ${new Date(event.scheduledTime).toISOString()}`);
    // Add scheduled tasks here if needed
  },
};
