import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import postgres from 'postgres';
import type { Env } from './env.js';
import { createOpenAPIApp, registerOpenAPIDoc } from './openapi.js';
import { errorHandler } from '../middleware/error-handler.js'; // Now uses ResponseEnvelope format
import { rateLimiter, RateLimitPresets } from '../middleware/rate-limiter.js';
import { Logger } from '../lib/logger.js';
import { getDashboardHTML } from '../dashboard.js';
import type { MessageBatch, Message, CoverQueueMessage, EnrichmentQueueMessage } from './services/types.js';
import type { BackfillQueueMessage } from './services/async-backfill.js';

// Route imports
import healthRoutes from './routes/health.js';
import statsRoutes from './routes/stats.js';
import searchRoutes from './routes/search.js';
import searchCombinedRoutes from './routes/search-combined.js';
import { enrichRoutes } from './routes/enrich.js';
import coversRoutes from './routes/covers.js';
import coversLegacyRoutes from './routes/covers-legacy.js';
import authorsRoutes from './routes/authors.js';
import booksRoutes from './routes/books.js';
import quotaRoutes from './routes/quota.js';
import testRoutes from './routes/test.js';
import migrateRoutes from './routes/migrate.js';
import harvestRoutes from './routes/harvest.js';
import { handleScheduledCoverHarvest } from './routes/harvest.js';
import { handleScheduledWikidataEnrichment } from './routes/authors.js';
import backfillAsyncRoutes from './routes/backfill-async.js';
import externalIdRoutes from './routes/external-ids.js';
import recommendationsRoutes from './routes/recommendations.js';

// Queue handlers (migrated to TypeScript)
import { processCoverQueue, processEnrichmentQueue, processAuthorQueue } from './services/queue-handlers.js';
import { processBackfillJob } from './services/async-backfill.js';

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
  const logger = new Logger(c.env, { requestId: c.get('requestId') });
  c.set('logger', logger);
  await next();
});

// Response timing middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  c.header('X-Response-Time', `${Date.now() - start}ms`);
});

// Rate limiting middleware (applied before DB connection to save resources)
// Search endpoints (more expensive queries)
app.use('/api/search*', rateLimiter(RateLimitPresets.search));

// Write operations (covers, enrichment)
app.use('/api/covers/process', rateLimiter(RateLimitPresets.write));
app.use('/api/covers/queue', rateLimiter(RateLimitPresets.write));
app.use('/api/enrich/*', rateLimiter(RateLimitPresets.write));

// Heavy operations (batch, bulk)
app.use('/api/enrich/batch-direct', rateLimiter(RateLimitPresets.heavy));
app.use('/covers/batch', rateLimiter(RateLimitPresets.heavy));
app.use('/api/authors/enrich-bibliography', rateLimiter(RateLimitPresets.heavy));
app.use('/api/books/enrich-new-releases', rateLimiter(RateLimitPresets.heavy));

// External ID lookups (read-heavy, allow higher rate)
app.use('/api/external-ids/*', rateLimiter(RateLimitPresets.standard));
app.use('/api/resolve/*', rateLimiter(RateLimitPresets.standard));

// Recommendations endpoints (read-heavy, similar to search)
app.use('/api/recommendations/*', rateLimiter(RateLimitPresets.search));

// Standard rate limit for other API endpoints
app.use('/api/*', rateLimiter(RateLimitPresets.standard));

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
  searchCombinedRoutes,
  enrichRoutes,
  coversRoutes,
  coversLegacyRoutes,
  authorsRoutes,
  booksRoutes,
  quotaRoutes,
  harvestRoutes,
  backfillAsyncRoutes,
  externalIdRoutes,
  recommendationsRoutes,
  testRoutes,
  migrateRoutes,
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
// ✅ POST /api/harvest/start - DONE (Workflows)
// ✅ GET /api/harvest/status/:id - DONE (Workflows)
// ✅ GET /api/harvest/list - DONE (Workflows)
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
// Export Public Types (for external consumers like bendv3)
// =================================================================================

export * from '../types.js';

// =================================================================================
// Export with Queue Handlers
// =================================================================================

export default {
  fetch: app.fetch,

  // Scheduled cron handler (runs daily at 2 AM UTC)
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const logger = Logger.forScheduled(env);

    try {
      logger.info('Scheduled event triggered', { cron: event.cron });

      // Run both scheduled tasks in parallel
      await Promise.all([
        handleScheduledCoverHarvest(env),
        handleScheduledWikidataEnrichment(env)
      ]);

      logger.info('All scheduled tasks completed');
    } catch (error) {
      logger.error('Scheduled handler error', { error });
      throw error;
    }
  },

  // Queue consumer handler
  async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext) {
    const logger = Logger.forQueue(env, batch.queue, batch.messages.length);

    switch (batch.queue) {
      case 'alexandria-cover-queue':
        return await processCoverQueue(batch as MessageBatch<CoverQueueMessage>, env);
      case 'alexandria-enrichment-queue':
        return await processEnrichmentQueue(batch as MessageBatch<EnrichmentQueueMessage>, env);
      case 'alexandria-author-queue':
        return await processAuthorQueue(batch as any, env);
      case 'alexandria-backfill-queue':
        // Process each message (batch_size is 1 for backfill queue)
        for (const message of batch.messages) {
          try {
            await processBackfillJob(message.body as BackfillQueueMessage, env, logger);
            message.ack();
          } catch (error) {
            logger.error('[BackfillQueue] Processing failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            message.retry();
          }
        }
        break;
      default:
        logger.error('Unknown queue', { queue: batch.queue });
        batch.messages.forEach((msg: Message) => msg.ack());
    }
  },
};
