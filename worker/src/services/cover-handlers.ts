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
 *
 * DEPRECATED: This endpoint is deprecated in favor of /covers/:isbn/:size
 *
 * Cover storage has been consolidated to ISBN-based paths (Issue #95).
 * Use the ISBN-based endpoint: GET /covers/{isbn}/{size}
 *
 * Example: GET /covers/9780439064873/medium
 */
export async function handleServeCover(c: Context<AppBindings>): Promise<Response> {
  const work_key = c.req.param('work_key');
  const size = c.req.param('size');

  // Return deprecation notice with guidance
  return c.json(
    {
      error: 'Endpoint deprecated',
      message: `GET /api/covers/{work_key}/{size} is deprecated. Cover storage is now ISBN-based.`,
      migration: {
        deprecated: `/api/covers/${work_key}/${size}`,
        use_instead: '/covers/{isbn}/{size}',
        example: '/covers/9780439064873/large',
        documentation: 'https://alexandria.ooheynerds.com/docs#covers',
      },
      issue: 'https://github.com/ooheynerds/alexandria/issues/95',
    },
    410 // HTTP 410 Gone - resource no longer available
  );
}
