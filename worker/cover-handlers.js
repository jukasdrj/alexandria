/**
 * Cover Image Processing Handlers for Alexandria
 *
 * Endpoints:
 * - POST /api/covers/process - Process a cover image from provider URL
 * - GET /api/covers/{work_key}/{size}.webp - Serve processed cover
 *
 * R2 Bucket: bookstrack-covers-processed (binding: COVER_IMAGES)
 */

import {
  downloadImage,
  hashURL,
  normalizeImageURL,
  PLACEHOLDER_COVER,
  SIZES,
} from './image-utils.js';

/**
 * POST /api/covers/process
 *
 * Process a cover image from a provider URL
 *
 * Request body:
 * {
 *   "work_key": "/works/OL45804W",
 *   "provider_url": "https://covers.openlibrary.org/b/id/12345-L.jpg",
 *   "isbn": "9780439064873" // optional, for logging
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "urls": {
 *     "large": "https://alexandria.ooheynerds.com/api/covers/OL45804W/large",
 *     "medium": "https://alexandria.ooheynerds.com/api/covers/OL45804W/medium",
 *     "small": "https://alexandria.ooheynerds.com/api/covers/OL45804W/small"
 *   },
 *   "metadata": {
 *     "processedAt": "2025-11-30T...",
 *     "originalSize": 245678,
 *     "r2Key": "covers/OL45804W/abc123...",
 *     "sourceUrl": "https://covers.openlibrary.org/..."
 *   }
 * }
 */
export async function handleProcessCover(c) {
  try {
    // 1. Parse and validate request
    const body = await c.req.json();
    const { work_key, provider_url, isbn } = body;

    if (!work_key || !provider_url) {
      return c.json({
        success: false,
        error: 'Missing required fields: work_key, provider_url',
      }, 400);
    }

    console.log(`[CoverProcessor] Processing cover for ${work_key} from ${provider_url}`);

    // 2. Download and validate original image
    const { buffer: originalImage, contentType } = await downloadImage(provider_url);
    console.log(`[CoverProcessor] Downloaded ${originalImage.byteLength} bytes (${contentType})`);

    // 3. Generate R2 key (use URL hash for deduplication)
    const urlHash = await hashURL(normalizeImageURL(provider_url));
    const workKeyClean = work_key.replace(/^\/works\//, ''); // Remove /works/ prefix
    const r2Key = `covers/${workKeyClean}/${urlHash}`;

    // 4. Upload to R2 (bookstrack-covers-processed bucket)
    const env = c.env;
    await env.COVER_IMAGES.put(`${r2Key}/original`, originalImage, {
      httpMetadata: {
        contentType: contentType,
        cacheControl: 'public, max-age=31536000, immutable', // 1 year
      },
      customMetadata: {
        uploadedAt: new Date().toISOString(),
        originalSize: originalImage.byteLength.toString(),
        sourceUrl: provider_url,
        workKey: work_key,
        isbn: isbn || 'unknown',
      },
    });

    console.log(`[CoverProcessor] Uploaded to R2: ${r2Key}/original`);

    // 5. Generate CDN URLs (served via Worker endpoints)
    const cdnBase = 'https://alexandria.ooheynerds.com/api/covers';
    const urls = {
      large: `${cdnBase}/${workKeyClean}/large`,
      medium: `${cdnBase}/${workKeyClean}/medium`,
      small: `${cdnBase}/${workKeyClean}/small`,
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
        workKey: work_key,
      },
    });

  } catch (error) {
    console.error('[CoverProcessor] Error:', error);

    // Return placeholder URLs on error
    return c.json({
      success: false,
      error: error.message,
      urls: {
        large: PLACEHOLDER_COVER,
        medium: PLACEHOLDER_COVER,
        small: PLACEHOLDER_COVER,
      },
    }, error.message.includes('Domain not allowed') ? 403 : 500);
  }
}

/**
 * GET /api/covers/:work_key/:size
 *
 * Serve a processed cover image with on-the-fly resizing
 *
 * Example: GET /api/covers/OL45804W/medium
 */
export async function handleServeCover(c) {
  try {
    const work_key = c.req.param('work_key');
    const size = c.req.param('size');

    if (!SIZES[size]) {
      return c.json({ error: 'Invalid size. Use: large, medium, or small' }, 400);
    }

    const env = c.env;

    // Find the original image in R2 (bookstrack-covers-processed bucket)
    const prefix = `covers/${work_key}/`;
    const objects = await env.COVER_IMAGES.list({ prefix, limit: 1 });

    if (objects.objects.length === 0) {
      // No cover found, redirect to placeholder
      return c.redirect(PLACEHOLDER_COVER);
    }

    // Get the hash directory, then fetch original
    const hashDir = objects.objects[0].key.replace('/original', '');
    const originalKey = `${hashDir}/original`;
    const originalImage = await env.COVER_IMAGES.get(originalKey);

    if (!originalImage) {
      return c.redirect(PLACEHOLDER_COVER);
    }

    // Get image data
    const imageData = await originalImage.arrayBuffer();
    const contentType = originalImage.httpMetadata?.contentType || 'image/jpeg';

    // Get dimensions for requested size
    const dimensions = SIZES[size];

    // Return image with CF Image Resizing headers
    // Note: Actual resizing happens at Cloudflare edge if Image Resizing is enabled
    return new Response(imageData, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=2592000, immutable', // 30 days
        'X-Image-Width': dimensions.width.toString(),
        'X-Image-Height': dimensions.height.toString(),
      },
    });

  } catch (error) {
    console.error('[CoverServer] Error:', error);
    return c.redirect(PLACEHOLDER_COVER);
  }
}
