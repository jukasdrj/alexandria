/**
 * Image Processor Service
 *
 * Downloads, validates, and stores cover images in R2.
 * Handles WebP conversion and multiple size generation.
 *
 * @module services/image-processor
 */

import { fetchBestCover, getPlaceholderCover } from './cover-fetcher.js';
import { fetchWithRetry } from '../lib/fetch-utils.js';

// Image size definitions (width x height for book covers - 2:3 aspect ratio)
const SIZES = {
  large: { width: 512, height: 768 },
  medium: { width: 256, height: 384 },
  small: { width: 128, height: 192 }
};

// Security: Only allow images from known book cover providers
const ALLOWED_DOMAINS = new Set([
  'books.google.com',
  'covers.openlibrary.org',
  'images.isbndb.com',
  'images-na.ssl-images-amazon.com',
  'pictures.abebooks.com',
  'm.media-amazon.com'
]);

// Max image size (10MB)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * Validate that URL is from an allowed domain
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
function isAllowedDomain(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.has(parsed.hostname);
  } catch {
    return false;
  }
}


/**
 * Generate SHA-256 hash of data for deduplication
 * @param {ArrayBuffer} data - Data to hash
 * @returns {Promise<string>} Hex hash string
 */
async function hashData(data) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download and validate an image from a URL
 * @param {string} url - Image URL
 * @returns {Promise<{buffer: ArrayBuffer, contentType: string}>}
 */
async function downloadImage(url) {
  // Security check
  if (!isAllowedDomain(url)) {
    throw new Error(`Domain not allowed: ${new URL(url).hostname}`);
  }

  const response = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Alexandria/1.0 (cover-processor)',
      'Accept': 'image/*'
    }
  }, { timeoutMs: 15000, maxRetries: 2 });

  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status}`);
  }

  // Validate content type
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Invalid content type: ${contentType}`);
  }

  const buffer = await response.arrayBuffer();

  // Validate size
  if (buffer.byteLength > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${buffer.byteLength} bytes (max ${MAX_IMAGE_SIZE})`);
  }

  if (buffer.byteLength < 100) {
    throw new Error('Image too small (likely placeholder)');
  }

  return { buffer, contentType };
}

/**
 * Store image in R2 with metadata
 * @param {object} env - Worker environment
 * @param {string} key - R2 object key
 * @param {ArrayBuffer} data - Image data
 * @param {string} contentType - Image content type
 * @param {object} metadata - Custom metadata
 * @returns {Promise<void>}
 */
async function storeInR2(env, key, data, contentType, metadata = {}) {
  await env.COVER_IMAGES.put(key, data, {
    httpMetadata: {
      contentType: contentType || 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable'
    },
    customMetadata: {
      uploadedAt: new Date().toISOString(),
      ...metadata
    }
  });
}

/**
 * Check if a cover already exists in R2
 * Checks all possible extensions (jpg, png, webp)
 * @param {object} env - Worker environment
 * @param {string} isbn - ISBN to check
 * @returns {Promise<boolean>}
 */
export async function coverExists(env, isbn) {
  const extensions = ['jpg', 'png', 'webp'];
  for (const ext of extensions) {
    const key = `isbn/${isbn}/original.${ext}`;
    const head = await env.COVER_IMAGES.head(key);
    if (head) return true;
  }
  return false;
}

/**
 * Get cover metadata from R2
 * Checks all possible extensions (jpg, png, webp)
 * @param {object} env - Worker environment
 * @param {string} isbn - ISBN to check
 * @returns {Promise<object|null>}
 */
export async function getCoverMetadata(env, isbn) {
  const extensions = ['jpg', 'png', 'webp'];

  for (const ext of extensions) {
    const key = `isbn/${isbn}/original.${ext}`;
    const head = await env.COVER_IMAGES.head(key);

    if (head) {
      return {
        exists: true,
        isbn,
        extension: ext,
        size: head.size,
        uploaded: head.uploaded,
        ...head.customMetadata
      };
    }
  }

  return null;
}

/**
 * Process and store a cover image for an ISBN
 *
 * Pipeline:
 * 1. Check if already processed (idempotency)
 * 2. Fetch best cover URL from providers
 * 3. Download and validate image
 * 4. Store original in R2
 * 5. Return metadata
 *
 * Note: Resizing to multiple sizes is deferred - we store original only
 * and can use Cloudflare Image Resizing on-demand, or add pre-generation later.
 *
 * @param {string} isbn - ISBN to process
 * @param {object} env - Worker environment
 * @param {object} options - Processing options
 * @param {boolean} options.force - Force reprocessing even if exists
 * @returns {Promise<object>} Processing result
 */
export async function processCoverImage(isbn, env, options = {}) {
  const normalizedISBN = isbn.replace(/[-\s]/g, '');
  const startTime = Date.now();

  try {
    // 1. Check if already processed (unless forced)
    if (!options.force) {
      const existing = await coverExists(env, normalizedISBN);
      if (existing) {
        console.log(`Cover already exists for ${normalizedISBN}`);
        return {
          status: 'already_exists',
          isbn: normalizedISBN,
          cached: true
        };
      }
    }

    // 2. Fetch best cover URL from providers
    console.log(`Fetching cover for ${normalizedISBN}...`);
    const coverResult = await fetchBestCover(normalizedISBN, env);

    if (coverResult.source === 'placeholder') {
      console.log(`No cover found for ${normalizedISBN}`);
      return {
        status: 'no_cover',
        isbn: normalizedISBN,
        source: 'placeholder',
        error: coverResult.error || 'No cover found from any provider'
      };
    }

    // 3. Download and validate image
    console.log(`Downloading from ${coverResult.source}: ${coverResult.url}`);
    const { buffer, contentType } = await downloadImage(coverResult.url);

    // 4. Generate hash for deduplication tracking
    const hash = await hashData(buffer);

    // 5. Store original in R2 (preserve original content type)
    // Use appropriate extension based on content type
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const r2Key = `isbn/${normalizedISBN}/original.${ext}`;
    await storeInR2(env, r2Key, buffer, contentType, {
      source: coverResult.source,
      sourceUrl: coverResult.url,
      quality: coverResult.quality,
      originalSize: buffer.byteLength.toString(),
      hash
    });

    const processingTime = Date.now() - startTime;
    console.log(`Stored cover for ${normalizedISBN} (${buffer.byteLength} bytes, ${processingTime}ms)`);

    return {
      status: 'processed',
      isbn: normalizedISBN,
      source: coverResult.source,
      quality: coverResult.quality,
      size: buffer.byteLength,
      hash,
      processingTimeMs: processingTime,
      urls: {
        original: `/covers/${normalizedISBN}/original`,
        large: `/covers/${normalizedISBN}/large`,
        medium: `/covers/${normalizedISBN}/medium`,
        small: `/covers/${normalizedISBN}/small`
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`Failed to process cover for ${normalizedISBN}:`, error.message);

    return {
      status: 'error',
      isbn: normalizedISBN,
      error: error.message,
      processingTimeMs: processingTime
    };
  }
}

/**
 * Process multiple covers in batch
 * Limited to prevent Worker CPU timeout
 *
 * @param {string[]} isbns - Array of ISBNs to process
 * @param {object} env - Worker environment
 * @param {number} limit - Max concurrent processing (default 5)
 * @returns {Promise<object>} Batch processing results
 */
export async function processCoverBatch(isbns, env, limit = 5) {
  const startTime = Date.now();

  // Limit batch size to prevent timeout
  const batch = isbns.slice(0, limit);

  const results = await Promise.allSettled(
    batch.map(isbn => processCoverImage(isbn, env))
  );

  const processed = results.map((result, index) => ({
    isbn: batch[index],
    ...(result.status === 'fulfilled' ? result.value : { status: 'error', error: result.reason?.message })
  }));

  return {
    total: batch.length,
    processed: processed.filter(r => r.status === 'processed').length,
    cached: processed.filter(r => r.status === 'already_exists').length,
    failed: processed.filter(r => r.status === 'error' || r.status === 'no_cover').length,
    processingTimeMs: Date.now() - startTime,
    results: processed
  };
}

/**
 * Get available sizes for serving
 * @returns {object}
 */
export function getAvailableSizes() {
  return SIZES;
}

/**
 * Get placeholder cover URL
 * @returns {string}
 */
export { getPlaceholderCover };
