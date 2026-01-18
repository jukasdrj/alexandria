// =================================================================================
// Cover Image Processing Handlers for Alexandria
// =================================================================================

import type { Context } from 'hono';
import type { AppBindings } from '../env.js';
import { downloadImage, getPlaceholderCover } from './image-utils.js';

/**
 * POST /api/covers/process
 *
 * Process a cover image from a provider URL
 *
 * STORAGE: Uses isbn/{isbn}/ path (unified with jSquash processor)
 * This consolidates all cover storage to a single path scheme.
 *
 * Request body:
 * {
 *   "work_key": "/works/OL45804W",  // optional, for metadata
 *   "provider_url": "https://covers.openlibrary.org/b/id/12345-L.jpg",
 *   "isbn": "9780439064873" // REQUIRED - used as primary storage key
 * }
 */
export async function handleProcessCover(c: Context<AppBindings>): Promise<Response> {
  try {
    // 1. Parse and validate request
    const body = await c.req.json<{
      work_key?: string;
      provider_url?: string;
      isbn?: string;
    }>();
    const { work_key, provider_url, isbn } = body;

    // ISBN is now required (used as storage key)
    if (!isbn || !provider_url) {
      return c.json(
        {
          success: false,
          error: 'Missing required fields: isbn, provider_url',
        },
        400
      );
    }

    const normalizedISBN = isbn.replace(/[-\s]/g, '');
    const logger = c.get('logger');
    logger.info('Processing cover', {
      isbn: normalizedISBN,
      provider_url
    });

    // 2. Download and validate original image
    const { buffer: originalImage, contentType } = await downloadImage(provider_url);
    c.get('logger').debug('Downloaded image', {
      isbn: normalizedISBN,
      size_bytes: originalImage.byteLength,
      content_type: contentType,
    });

    // 3. Determine file extension from content type
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

    // 4. Upload to R2 using ISBN-based path (unified with jSquash processor)
    // Storage path: isbn/{isbn}/original.{ext}
    const env = c.env;
    const r2Key = `isbn/${normalizedISBN}/original.${ext}`;

    await env.COVER_IMAGES.put(r2Key, originalImage, {
      httpMetadata: {
        contentType: contentType,
        cacheControl: 'public, max-age=31536000, immutable', // 1 year
      },
      customMetadata: {
        uploadedAt: new Date().toISOString(),
        originalSize: originalImage.byteLength.toString(),
        sourceUrl: provider_url,
        workKey: work_key || 'unknown',
        isbn: normalizedISBN,
      },
    });

    logger.info('Uploaded cover to R2', {
      isbn: normalizedISBN,
      r2_key: r2Key,
      size_bytes: originalImage.byteLength,
    });

    // 5. Generate CDN URLs (served via /covers/:isbn/:size endpoint)
    const cdnBase = 'https://alexandria.ooheynerds.com/covers';
    const urls = {
      large: `${cdnBase}/${normalizedISBN}/large`,
      medium: `${cdnBase}/${normalizedISBN}/medium`,
      small: `${cdnBase}/${normalizedISBN}/small`,
    };

    // 6. Return success response
    return c.json({
      success: true,
      urls,
      metadata: {
        processedAt: new Date().toISOString(),
        originalSize: originalImage.byteLength,
        r2Key,
        sourceUrl: provider_url,
        workKey: work_key || null,
        isbn: normalizedISBN,
      },
    });
  } catch (error) {
    c.get('logger').error('Cover processing error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Return placeholder URLs on error
    const placeholderUrl = getPlaceholderCover(c.env);
    return c.json(
      {
        success: false,
        error: errorMessage,
        urls: {
          large: placeholderUrl,
          medium: placeholderUrl,
          small: placeholderUrl,
        },
      },
      errorMessage.includes('Domain not allowed') ? 403 : 500
    );
  }
}

/**
 * GET /api/covers/:work_key/:size
 * GET /covers/:isbn/:size (legacy compatibility)
 *
 * Serve cover images from R2 storage. Accepts both work_key and ISBN parameters.
 * The parameter is named work_key for OpenAPI spec but accepts ISBNs in practice.
 *
 * Storage strategies (priority order):
 * 1. jSquash WebP format: isbn/{isbn}/{size}.webp (pre-resized)
 * 2. Legacy ISBN storage: isbn/{isbn}/original.{ext}
 * 3. Work-based storage: covers/{work_key}/{hash}/original (oldest format)
 *
 * Falls back to placeholder if cover not found.
 */
export async function handleServeCover(c: Context<AppBindings>): Promise<Response> {
  const work_key = c.req.param('work_key');
  const size = c.req.param('size');
  const logger = c.get('logger');

  // Normalize the identifier (could be ISBN or work_key)
  const normalizedId = work_key.replace(/[-\s]/g, '');

  logger.debug('Cover serve request', { identifier: normalizedId, size });

  try {
    let object = null;

    // STRATEGY 1: Try jSquash WebP format (isbn/{isbn}/{size}.webp)
    // This is the preferred format - pre-resized WebP files from jSquash processing
    if (size !== 'original') {
      const webpKey = `isbn/${normalizedId}/${size}.webp`;
      object = await c.env.COVER_IMAGES.get(webpKey);
      if (object) {
        logger.info('Cover served - jSquash WebP', { identifier: normalizedId, size, key: webpKey });
        // Return WebP with caching headers
        const headers = new Headers();
        headers.set('Content-Type', 'image/webp');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('CDN-Cache-Control', 'max-age=31536000');
        return new Response(object.body, { headers });
      }
    }

    // STRATEGY 2: Check KV cache for ISBN→R2 key mapping (legacy originals)
    const cacheKey = `cover_key:${normalizedId}`;
    let r2Key = await c.env.CACHE.get(cacheKey);

    if (r2Key) {
      logger.debug('Found cached R2 key', { identifier: normalizedId, r2Key });
      object = await c.env.COVER_IMAGES.get(r2Key);

      // If cached key is stale (object deleted), remove from cache
      if (!object) {
        logger.warn('Cached R2 key is stale', { identifier: normalizedId, r2Key });
        await c.env.CACHE.delete(cacheKey);
        r2Key = null;
      }
    }

    // STRATEGY 3: Try legacy ISBN-based storage (isbn/{isbn}/original.{ext})
    if (!object) {
      const extensions = ['jpg', 'png', 'webp'];

      for (const ext of extensions) {
        const key = `isbn/${normalizedId}/original.${ext}`;
        object = await c.env.COVER_IMAGES.get(key);
        if (object) {
          logger.info('Cover served - legacy ISBN-based', { identifier: normalizedId, key });
          // Cache this key for future requests
          await c.env.CACHE.put(cacheKey, key, { expirationTtl: 86400 * 30 }); // 30 days
          break;
        }
      }
    }

    // STRATEGY 4: Search work-based storage (covers/{work_key}/{hash}/original)
    // This is the oldest work-based format
    if (!object) {
      logger.debug('Searching work-based storage', { identifier: normalizedId });

      let cursor: string | undefined;
      let found = false;
      const maxPages = 5;
      let pageCount = 0;

      while (!found && pageCount < maxPages) {
        const list = await c.env.COVER_IMAGES.list({
          prefix: 'covers/',
          cursor,
          limit: 1000,
        });

        for (const obj of list.objects) {
          if (obj.customMetadata?.isbn === normalizedId) {
            logger.info('Cover served - work-based', { identifier: normalizedId, key: obj.key });
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
      logger.debug('Cover not found, redirecting to placeholder', { identifier: normalizedId });
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
      identifier: normalizedId,
      size,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.redirect(getPlaceholderCover(c.env), 302);
  }
}
