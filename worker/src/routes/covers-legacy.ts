import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  CoverStatusParamsSchema,
  CoverStatusResponseSchema,
  CoverServeParamsSchema,
  CoverServeErrorSchema,
  CoverProcessParamsSchema,
  CoverProcessQuerySchema,
  CoverProcessResponseSchema,
  CoverBatchRequestSchema,
  CoverBatchResponseSchema,
} from '../schemas/covers-legacy.js';
import {
  processCoverImage,
  processCoverBatch,
  getCoverMetadata,
  getPlaceholderCover,
} from '../../services/image-processor.js';

// =================================================================================
// Legacy Cover Route Definitions
// =================================================================================

// GET /covers/:isbn/status - Check if cover exists
const coverStatusRoute = createRoute({
  method: 'get',
  path: '/covers/{isbn}/status',
  tags: ['Covers (Legacy)'],
  summary: 'Check cover status',
  description: 'Check if a cover exists for the given ISBN and get metadata about available sizes',
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
          schema: CoverServeErrorSchema,
        },
      },
    },
    500: {
      description: 'Failed to check cover status',
      content: {
        'application/json': {
          schema: CoverServeErrorSchema,
        },
      },
    },
  },
});

// GET /covers/:isbn/:size - Serve cover image
const coverServeRoute = createRoute({
  method: 'get',
  path: '/covers/{isbn}/{size}',
  tags: ['Covers (Legacy)'],
  summary: 'Serve cover image',
  description: 'Serve a cover image from R2 storage. Supports both jSquash WebP format and legacy originals. Falls back to placeholder if not found.',
  request: {
    params: CoverServeParamsSchema,
  },
  responses: {
    200: {
      description: 'Cover image',
      content: {
        'image/webp': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
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
      },
    },
    302: {
      description: 'Redirect to placeholder image',
    },
    400: {
      description: 'Invalid ISBN or size',
      content: {
        'application/json': {
          schema: CoverServeErrorSchema,
        },
      },
    },
  },
});

// POST /covers/:isbn/process - Process cover
const coverProcessRoute = createRoute({
  method: 'post',
  path: '/covers/{isbn}/process',
  tags: ['Covers (Legacy)'],
  summary: 'Process cover image',
  description: 'Trigger cover processing for the given ISBN. Fetches from providers, validates, and stores in R2.',
  request: {
    params: CoverProcessParamsSchema,
    query: CoverProcessQuerySchema,
  },
  responses: {
    200: {
      description: 'Cover already exists',
      content: {
        'application/json': {
          schema: CoverProcessResponseSchema,
        },
      },
    },
    201: {
      description: 'Cover processed successfully',
      content: {
        'application/json': {
          schema: CoverProcessResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid ISBN format',
      content: {
        'application/json': {
          schema: CoverServeErrorSchema,
        },
      },
    },
    404: {
      description: 'No cover found',
      content: {
        'application/json': {
          schema: CoverProcessResponseSchema,
        },
      },
    },
    500: {
      description: 'Processing failed',
      content: {
        'application/json': {
          schema: CoverProcessResponseSchema,
        },
      },
    },
  },
});

// POST /covers/batch - Process multiple covers
const coverBatchRoute = createRoute({
  method: 'post',
  path: '/covers/batch',
  tags: ['Covers (Legacy)'],
  summary: 'Process multiple covers',
  description: 'Process covers for multiple ISBNs in a single request (max 10)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CoverBatchRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch processing results',
      content: {
        'application/json': {
          schema: CoverBatchResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: CoverServeErrorSchema,
        },
      },
    },
    500: {
      description: 'Batch processing failed',
      content: {
        'application/json': {
          schema: CoverServeErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

// GET /covers/:isbn/status
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(coverStatusRoute, async (c) => {
  const { isbn } = c.req.valid('param');
  const logger = c.get('logger');
  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  logger.debug('Cover status check', { isbn: normalizedISBN });

  try {
    // First check for jSquash WebP files (preferred format)
    const webpKey = `isbn/${normalizedISBN}/large.webp`;
    const webpHead = await c.env.COVER_IMAGES.head(webpKey);

    if (webpHead) {
      // Get metadata from WebP file
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
        storage: 'jsquash',
        sizes,
        uploaded: webpHead.uploaded.toISOString(),
        ...webpHead.customMetadata,
        urls: {
          large: `/covers/${normalizedISBN}/large`,
          medium: `/covers/${normalizedISBN}/medium`,
          small: `/covers/${normalizedISBN}/small`,
        },
      });
    }

    // Fallback to legacy metadata check
    const metadata = await getCoverMetadata(c.env, normalizedISBN);

    if (!metadata) {
      logger.debug('Cover not found', { isbn: normalizedISBN });
      return c.json({
        exists: false,
        isbn: normalizedISBN,
      });
    }

    logger.info('Cover status - legacy format found', { isbn: normalizedISBN });

    return c.json({
      ...metadata,  // Spread metadata first
      format: 'legacy' as const,  // Then override format
      urls: {
        original: `/covers/${normalizedISBN}/original`,
        large: `/covers/${normalizedISBN}/large`,
        medium: `/covers/${normalizedISBN}/medium`,
        small: `/covers/${normalizedISBN}/small`,
      },
    });
  } catch (error) {
    logger.error('Cover status check failed', {
      isbn: normalizedISBN,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'Failed to check cover status' }, 500);
  }
});

// GET /covers/:isbn/:size
app.openapi(coverServeRoute, async (c) => {
  const { isbn, size } = c.req.valid('param');
  const logger = c.get('logger');
  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  logger.debug('Cover serve request', { isbn: normalizedISBN, size });

  try {
    let object = null;

    // STRATEGY 1: Try new jSquash WebP format (isbn/{isbn}/{size}.webp)
    // This is the preferred format - pre-resized WebP files from jSquash processing
    if (size !== 'original') {
      const webpKey = `isbn/${normalizedISBN}/${size}.webp`;
      object = await c.env.COVER_IMAGES.get(webpKey);
      if (object) {
        logger.info('Cover served - jSquash WebP', { isbn: normalizedISBN, size, key: webpKey });
        // Return WebP with caching headers
        const headers = new Headers();
        headers.set('Content-Type', 'image/webp');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('CDN-Cache-Control', 'max-age=31536000');
        return new Response(object.body, { headers });
      }
    }

    // STRATEGY 2: Check KV cache for ISBN→R2 key mapping (legacy originals)
    const cacheKey = `cover_key:${normalizedISBN}`;
    let r2Key = await c.env.CACHE.get(cacheKey);

    if (r2Key) {
      logger.debug('Found cached R2 key', { isbn: normalizedISBN, r2Key });
      object = await c.env.COVER_IMAGES.get(r2Key);

      // If cached key is stale (object deleted), remove from cache
      if (!object) {
        logger.warn('Cached R2 key is stale', { isbn: normalizedISBN, r2Key });
        await c.env.CACHE.delete(cacheKey);
        r2Key = null;
      }
    }

    // STRATEGY 3: Try legacy ISBN-based storage (isbn/{isbn}/original.{ext})
    if (!object) {
      const extensions = ['jpg', 'png', 'webp'];

      for (const ext of extensions) {
        const key = `isbn/${normalizedISBN}/original.${ext}`;
        object = await c.env.COVER_IMAGES.get(key);
        if (object) {
          logger.info('Cover served - legacy ISBN-based', { isbn: normalizedISBN, key });
          // Cache this key for future requests
          await c.env.CACHE.put(cacheKey, key, { expirationTtl: 86400 * 30 }); // 30 days
          break;
        }
      }
    }

    // STRATEGY 4: Search work-based storage (covers/{work_key}/{hash}/original)
    // This is the older work-based format
    if (!object) {
      logger.debug('Searching work-based storage', { isbn: normalizedISBN });

      let cursor: string | undefined;
      let found = false;
      const maxPages = 5;
      let pageCount = 0;

      while (!found && pageCount < maxPages) {
        const list = await c.env.COVER_IMAGES.list({
          prefix: 'covers/',
          cursor,
          limit: 1000,
          include: ['customMetadata'],
        });

        for (const obj of list.objects) {
          if (obj.customMetadata?.isbn === normalizedISBN) {
            logger.info('Cover served - work-based', { isbn: normalizedISBN, key: obj.key });
            object = await c.env.COVER_IMAGES.get(obj.key);
            r2Key = obj.key;
            await c.env.CACHE.put(cacheKey, r2Key, { expirationTtl: 86400 * 30 });
            found = true;
            break;
          }
        }

        cursor = list.truncated ? list.cursor : undefined;
        pageCount++;
        if (!cursor) break;
      }
    }

    if (!object) {
      logger.debug('Cover not found, redirecting to placeholder', { isbn: normalizedISBN });
      return c.redirect(getPlaceholderCover(c.env), 302);
    }

    // Return image with caching headers
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('CDN-Cache-Control', 'max-age=31536000');

    return new Response(object.body, { headers });
  } catch (error) {
    logger.error('Cover serve failed', {
      isbn: normalizedISBN,
      size,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.redirect(getPlaceholderCover(), 302);
  }
});

// POST /covers/:isbn/process
app.openapi(coverProcessRoute, async (c) => {
  const { isbn } = c.req.valid('param');
  const { force } = c.req.valid('query');
  const logger = c.get('logger');
  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  logger.info('Cover processing triggered', { isbn: normalizedISBN, force });

  try {
    const result = await processCoverImage(normalizedISBN, c.env, force ? { force } : {}) as any;

    const statusCode =
      (result as any).status === 'processed'
        ? 201
        : (result as any).status === 'already_exists'
          ? 200
          : (result as any).status === 'no_cover'
            ? 404
            : 500;

    logger.info('Cover processing completed', {
      isbn: normalizedISBN,
      status: (result as any).status,
      statusCode,
    });

    return c.json(result, statusCode);
  } catch (error) {
    logger.error('Cover processing failed', {
      isbn: normalizedISBN,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        status: 'error' as const,
        isbn: normalizedISBN,
        error: message,
      },
      500
    );
  }
});

// POST /covers/batch
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(coverBatchRoute, async (c) => {
  const { isbns } = c.req.valid('json');
  const logger = c.get('logger');

  logger.info('Batch cover processing triggered', { count: isbns.length });

  try {
    const result = await processCoverBatch(isbns, c.env) as any;

    logger.info('Batch cover processing completed', {
      total: result.total,
      processed: result.processed,
      cached: result.cached,
      failed: result.failed,
    });

    // Transform the flat structure to match schema with summary
    return c.json({
      results: result.results,
      summary: {
        total: result.total,
        processed: result.processed,
        cached: result.cached,
        no_cover: 0, // Not tracked by processCoverBatch
        failed: result.failed,
      },
    });
  } catch (error) {
    logger.error('Batch cover processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        error: 'Batch processing failed',
        message,
      },
      500
    );
  }
});

export default app;
