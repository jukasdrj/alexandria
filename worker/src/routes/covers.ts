/**
 * Cover Processing API Routes
 *
 * Handles cover image processing, serving, and queue-based batch processing
 * R2 Bucket: bookstrack-covers-processed (binding: COVER_IMAGES)
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  ProcessCoverSchema,
  QueueCoverSchema,
  ServeCoverParamsSchema,
  ProcessCoverSuccessSchema,
  ProcessCoverErrorSchema,
  QueueCoverResultSchema,
  ErrorResponseSchema,
} from '../schemas/covers.js';
import { handleProcessCover, handleServeCover } from '../services/cover-handlers.js';
import { normalizeISBN } from '../../lib/isbn-utils.js';

// Create covers router
const app = new OpenAPIHono<AppBindings>();

// =================================================================================
// POST /api/covers/process - Process cover from provider URL
// =================================================================================

const processCoverRoute = createRoute({
  method: 'post',
  path: '/api/covers/process',
  tags: ['Covers'],
  summary: 'Process Cover Image',
  description: 'Downloads and processes a cover image from a provider URL, stores in R2, and returns CDN URLs for all sizes.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ProcessCoverSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Cover processed successfully',
      content: {
        'application/json': {
          schema: ProcessCoverSuccessSchema,
        },
      },
    },
    400: {
      description: 'Bad request - missing required fields',
      content: {
        'application/json': {
          schema: ProcessCoverErrorSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - domain not allowed',
      content: {
        'application/json': {
          schema: ProcessCoverErrorSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ProcessCoverErrorSchema,
        },
      },
    },
  },
});

app.openapi(processCoverRoute, handleProcessCover);

// =================================================================================
// GET /api/covers/:work_key/:size - Serve cover image
// =================================================================================

const serveCoverRoute = createRoute({
  method: 'get',
  path: '/api/covers/{work_key}/{size}',
  tags: ['Covers'],
  summary: 'Serve Cover Image',
  description: 'Serves a processed cover image with on-the-fly resizing. Returns placeholder if cover not found.',
  request: {
    params: ServeCoverParamsSchema,
  },
  responses: {
    200: {
      description: 'Cover image served successfully',
      content: {
        'image/jpeg': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
        'image/png': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
        'image/webp': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
    302: {
      description: 'Redirect to placeholder cover (cover not found)',
    },
    400: {
      description: 'Invalid size parameter',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(serveCoverRoute, handleServeCover);

// =================================================================================
// POST /api/covers/queue - Queue cover processing jobs (batch)
// =================================================================================

const queueCoverRoute = createRoute({
  method: 'post',
  path: '/api/covers/queue',
  tags: ['Covers'],
  summary: 'Queue Cover Processing',
  description: 'Queues multiple cover processing jobs for background processing via Cloudflare Queues (max 100 per request).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: QueueCoverSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Cover processing queued',
      content: {
        'application/json': {
          schema: QueueCoverResultSchema,
        },
      },
    },
    400: {
      description: 'Bad request - invalid input',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(queueCoverRoute, async (c) => {
  const logger = c.get('logger');

  try {
    const { books } = c.req.valid('json');

    // Validate input
    if (!Array.isArray(books) || books.length === 0) {
      return c.json({ error: 'books array required' }, 400);
    }

    if (books.length > 100) {
      return c.json({ error: 'Max 100 books per request' }, 400);
    }

    const queued: string[] = [];
    const failed: Array<{ isbn: string; error: string }> = [];

    for (const book of books) {
      const { isbn, work_key, priority = 'normal', source = 'unknown', title, author } = book;

      // Validate ISBN using utility
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        failed.push({ isbn: isbn || 'undefined', error: 'Invalid ISBN format' });
        continue;
      }

      try {
        // Queue cover processing
        await c.env.COVER_QUEUE.send({
          isbn: normalizedISBN,
          work_key,
          priority,
          source,
          title,
          author,
          queued_at: new Date().toISOString(),
        });

        queued.push(normalizedISBN);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ isbn: normalizedISBN, error: message });
      }
    }

    logger.info('Cover queue batch processed', {
      queued: queued.length,
      failed: failed.length,
    });

    return c.json({
      queued: queued.length,
      failed: failed.length,
      errors: failed,
    });
  } catch (error) {
    logger.error('Cover queue error', { error: error instanceof Error ? error.message : 'Unknown' });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        error: 'Queue operation failed',
        message,
      },
      500
    );
  }
});

export default app;
