/**
 * Cover Processing API Routes
 *
 * Handles cover image processing, serving, and queue-based batch processing
 * R2 Bucket: bookstrack-covers-processed (binding: COVER_IMAGES)
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppBindings } from '../env.js';
import {
  ProcessCoverSchema,
  QueueCoverSchema,
  ServeCoverParamsSchema,
  CoverStatusParamsSchema,
  CoverStatusResponseSchema,
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
// GET /api/covers/status/:isbn - Check cover availability
// =================================================================================

const coverStatusRoute = createRoute({
  method: 'get',
  path: '/api/covers/status/{isbn}',
  tags: ['Covers'],
  summary: 'Check Cover Status',
  description: 'Check if a cover exists for the given ISBN and get metadata about available sizes.',
  request: {
    params: CoverStatusParamsSchema,
  },
  responses: {
    200: {
      description: 'Cover status information',
      content: {
        'application/json': {
          schema: CoverStatusResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid ISBN format',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Failed to check cover status',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(coverStatusRoute, async (c) => {
  const { isbn } = c.req.valid('param');
  const logger = c.get('logger');
  const normalizedISBN = normalizeISBN(isbn);

  if (!normalizedISBN) {
    return c.json({ error: 'Invalid ISBN format' }, 400);
  }

  logger.debug('Cover status check', { isbn: normalizedISBN });

  try {
    // Check for jSquash WebP files (preferred format)
    const webpKey = `isbn/${normalizedISBN}/large.webp`;
    const webpHead = await c.env.COVER_IMAGES.head(webpKey);

    if (webpHead) {
      // Get metadata from WebP files
      const sizes: Record<string, number> = {};
      for (const size of ['large', 'medium', 'small']) {
        const sizeHead = await c.env.COVER_IMAGES.head(`isbn/${normalizedISBN}/${size}.webp`);
        if (sizeHead) {
          sizes[size] = sizeHead.size;
        }
      }

      logger.info('Cover status - WebP format found', { isbn: normalizedISBN });

      return c.json({
        exists: true,
        isbn: normalizedISBN,
        format: 'webp' as const,
        sizes,
        uploaded: webpHead.uploaded.toISOString(),
        urls: {
          large: `/covers/${normalizedISBN}/large`,
          medium: `/covers/${normalizedISBN}/medium`,
          small: `/covers/${normalizedISBN}/small`,
        },
      });
    }

    // Fallback: Check for legacy ISBN-based storage
    const extensions = ['jpg', 'png', 'webp'];
    for (const ext of extensions) {
      const key = `isbn/${normalizedISBN}/original.${ext}`;
      const head = await c.env.COVER_IMAGES.head(key);
      if (head) {
        logger.info('Cover status - legacy format found', { isbn: normalizedISBN });

        return c.json({
          exists: true,
          isbn: normalizedISBN,
          format: 'legacy' as const,
          sizes: { large: head.size },
          uploaded: head.uploaded.toISOString(),
          urls: {
            large: `/covers/${normalizedISBN}/large`,
            medium: `/covers/${normalizedISBN}/medium`,
            small: `/covers/${normalizedISBN}/small`,
          },
        });
      }
    }

    // Cover not found
    logger.debug('Cover not found', { isbn: normalizedISBN });
    return c.json({
      exists: false,
      isbn: normalizedISBN,
    });
  } catch (error) {
    logger.error('Cover status check failed', {
      isbn: normalizedISBN,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'Failed to check cover status' }, 500);
  }
});

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

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
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

export async function handleQueueCovers(c: Context<AppBindings>): Promise<Response> {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    const validBooks: string[] = [];

    // 1. Validate all books first
    for (const book of books) {
      const { isbn, work_key, priority = 'normal', source = 'unknown', title, author } = book;

      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        failed.push({ isbn: isbn || 'undefined', error: 'Invalid ISBN format' });
        continue;
      }

      messages.push({
        body: {
          isbn: normalizedISBN,
          work_key,
          priority,
          source,
          title,
          author,
          queued_at: new Date().toISOString(),
        }
      });
      validBooks.push(normalizedISBN);
    }

    // 2. Batch send if we have valid messages
    if (messages.length > 0) {
      try {
        // Optimized: Send all messages in a single batch
        await c.env.COVER_QUEUE.sendBatch(messages);
        queued.push(...validBooks);

        // Log successful batch send
        logger.info('Cover queue batch sent successfully', {
          batch_size: validBooks.length,
          sample_isbns: validBooks.slice(0, 5),
        });
      } catch (error) {
        // If batch fails, all valid messages fail (atomic operation)
        const message = error instanceof Error ? error.message : 'Queue batch failed';
        const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

        logger.error('Cover queue batch send failed - NO messages were queued (atomic operation)', {
          error: message,
          error_type: errorType,
          stack: error instanceof Error ? error.stack : undefined,
          batch_size: validBooks.length,
          sample_isbns: validBooks.slice(0, 5),
        });

        // Mark all ISBNs as failed since batch operations are all-or-nothing
        const failureMessage = `Batch queue operation failed: NO messages were queued (transient error - retry entire batch of ${validBooks.length} ISBNs)`;
        for (const isbn of validBooks) {
          failed.push({ isbn, error: failureMessage });
        }
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
}

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(queueCoverRoute, handleQueueCovers);

export default app;
