/**
 * jSquash Image Processor
 *
 * Processes cover images using jSquash WASM modules:
 * - Decodes JPEG/PNG source images
 * - Resizes to 3 standard sizes (large, medium, small)
 * - Encodes as WebP
 * - Stores only the 3 WebP files in R2 (no original)
 *
 * @module services/jsquash-processor
 */

// jSquash modules with init functions for manual WASM initialization
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode';
import decodePng, { init as initPngDecode } from '@jsquash/png/decode';
import encodeWebp, { init as initWebpEncode } from '@jsquash/webp/encode';
import resize, { initResize } from '@jsquash/resize';

// WASM modules - direct ES module imports for Cloudflare Workers
import JPEG_DEC_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import PNG_DEC_WASM from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import WEBP_ENC_WASM from '@jsquash/webp/codec/enc/webp_enc.wasm';
import RESIZE_WASM from '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';

// Target sizes for book covers
// We use MAX dimensions - images will be scaled down proportionally to fit
// If source is smaller than target, we DON'T upscale - we use source dimensions
const TARGET_SIZES = {
  large: { maxWidth: 512, maxHeight: 768 },
  medium: { maxWidth: 256, maxHeight: 384 },
  small: { maxWidth: 128, maxHeight: 192 }
};

// WebP encoding quality (0-100)
const WEBP_QUALITY = 85;

/**
 * Calculate target dimensions that fit within max bounds while preserving aspect ratio
 * Never upscales - returns source dimensions if smaller than target
 */
function calculateTargetDimensions(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  // If source is smaller than max, don't upscale
  if (sourceWidth <= maxWidth && sourceHeight <= maxHeight) {
    return { width: sourceWidth, height: sourceHeight, scaled: false };
  }

  // Calculate scale factor to fit within bounds
  const widthRatio = maxWidth / sourceWidth;
  const heightRatio = maxHeight / sourceHeight;
  const scale = Math.min(widthRatio, heightRatio);

  return {
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale),
    scaled: true
  };
}

// Security: Only allow images from known book cover providers
const ALLOWED_DOMAINS = new Set([
  'books.google.com',
  'covers.openlibrary.org',
  'images.isbndb.com',
  'images-na.ssl-images-amazon.com',
  'pictures.abebooks.com',
  'm.media-amazon.com'
]);

// Track WASM initialization state
let wasmInitialized = false;

/**
 * Initialize all WASM modules
 * Must be called before processing images in CF Workers
 */
async function initWasm() {
  if (wasmInitialized) return;

  const startTime = Date.now();

  try {
    // Initialize all WASM modules with globally injected binaries
    await Promise.all([
      initJpegDecode(JPEG_DEC_WASM),
      initPngDecode(PNG_DEC_WASM),
      initWebpEncode(WEBP_ENC_WASM),
      initResize(RESIZE_WASM),
    ]);

    wasmInitialized = true;
    console.log(`[jSquash] WASM initialized in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[jSquash] WASM init failed:', error);
    throw error;
  }
}

/**
 * Validate that URL is from an allowed domain
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
 * Detect image type from ArrayBuffer
 */
function detectImageType(buffer) {
  const view = new Uint8Array(buffer);

  // JPEG: starts with FF D8 FF
  if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
    return 'jpeg';
  }

  // PNG: starts with 89 50 4E 47
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
    return 'png';
  }

  // WebP: starts with RIFF....WEBP
  if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
      view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) {
    return 'webp';
  }

  return null;
}

/**
 * Decode image buffer to ImageData
 */
async function decodeImage(buffer, type) {
  switch (type) {
    case 'jpeg':
      return await decodeJpeg(buffer);
    case 'png':
      return await decodePng(buffer);
    default:
      throw new Error(`Unsupported image type: ${type}`);
  }
}

/**
 * Resize ImageData to target dimensions
 */
async function resizeImage(imageData, targetWidth, targetHeight) {
  return await resize(imageData, {
    width: targetWidth,
    height: targetHeight,
    method: 'lanczos3', // High quality downscaling
    premultiply: true,
    linearRGB: true
  });
}

/**
 * Process a single cover image
 * Downloads, resizes to 3 sizes, encodes as WebP, stores in R2
 *
 * @param {string} isbn - ISBN for the book
 * @param {string} sourceUrl - URL to download the original image
 * @param {object} env - Worker environment with R2 binding
 * @returns {Promise<object>} Processing result
 */
export async function processAndStoreCover(isbn, sourceUrl, env) {
  const startTime = Date.now();
  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  const metrics = {
    isbn: normalizedISBN,
    initMs: 0,
    fetchMs: 0,
    decodeMs: 0,
    resizeMs: 0,
    encodeMs: 0,
    uploadMs: 0,
    totalMs: 0,
    originalSize: 0,
    webpSizes: {}
  };

  try {
    // Security check
    if (!isAllowedDomain(sourceUrl)) {
      throw new Error(`Domain not allowed: ${new URL(sourceUrl).hostname}`);
    }

    // Initialize WASM modules if needed
    const initStart = Date.now();
    await initWasm();
    metrics.initMs = Date.now() - initStart;

    // 1. Fetch the original image
    const fetchStart = Date.now();
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Alexandria/2.0 (cover-processor)',
        'Accept': 'image/*'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    metrics.fetchMs = Date.now() - fetchStart;
    metrics.originalSize = buffer.byteLength;

    // Validate size
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new Error(`Image too large: ${buffer.byteLength} bytes`);
    }

    if (buffer.byteLength < 100) {
      throw new Error('Image too small (likely placeholder)');
    }

    // 2. Detect type and decode
    const decodeStart = Date.now();
    const imageType = detectImageType(buffer);
    if (!imageType) {
      throw new Error('Unknown image format');
    }

    const imageData = await decodeImage(buffer, imageType);
    metrics.decodeMs = Date.now() - decodeStart;

    const sourceWidth = imageData.width;
    const sourceHeight = imageData.height;
    console.log(`[jSquash] Decoded ${imageType} ${sourceWidth}x${sourceHeight} (${buffer.byteLength} bytes)`);

    // 3. Resize to all target sizes and encode as WebP
    // IMPORTANT: We NEVER upscale - if source is smaller, we use source dimensions
    const results = {};
    metrics.dimensions = {};

    for (const [sizeName, targetBounds] of Object.entries(TARGET_SIZES)) {
      const target = calculateTargetDimensions(
        sourceWidth,
        sourceHeight,
        targetBounds.maxWidth,
        targetBounds.maxHeight
      );

      metrics.dimensions[sizeName] = { width: target.width, height: target.height, scaled: target.scaled };

      const resizeStart = Date.now();
      let imageToEncode;

      if (target.scaled) {
        // Source is larger than target - downscale
        imageToEncode = await resizeImage(imageData, target.width, target.height);
      } else {
        // Source is smaller or equal - use original (no upscaling!)
        imageToEncode = imageData;
      }
      metrics.resizeMs += Date.now() - resizeStart;

      // Encode to WebP
      const encodeStart = Date.now();
      const webpBuffer = await encodeWebp(imageToEncode, { quality: WEBP_QUALITY });
      metrics.encodeMs += Date.now() - encodeStart;

      results[sizeName] = webpBuffer;
      metrics.webpSizes[sizeName] = webpBuffer.byteLength;
    }

    // 4. Upload all 3 sizes to R2
    const uploadStart = Date.now();
    const uploadPromises = Object.entries(results).map(async ([sizeName, webpBuffer]) => {
      const r2Key = `isbn/${normalizedISBN}/${sizeName}.webp`;

      await env.COVER_IMAGES.put(r2Key, webpBuffer, {
        httpMetadata: {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable'
        },
        customMetadata: {
          uploadedAt: new Date().toISOString(),
          sourceUrl: sourceUrl,
          originalSize: metrics.originalSize.toString(),
          originalType: imageType,
          quality: WEBP_QUALITY.toString()
        }
      });

      return { sizeName, key: r2Key, size: webpBuffer.byteLength };
    });

    const uploadResults = await Promise.all(uploadPromises);
    metrics.uploadMs = Date.now() - uploadStart;
    metrics.totalMs = Date.now() - startTime;

    const totalWebpSize = Object.values(metrics.webpSizes).reduce((a, b) => a + b, 0);
    const compressionRatio = ((1 - totalWebpSize / metrics.originalSize) * 100).toFixed(1);

    console.log(`[jSquash] Processed ${normalizedISBN}: ${metrics.originalSize} → ${totalWebpSize} bytes (${compressionRatio}% smaller, ${metrics.totalMs}ms)`);

    return {
      status: 'processed',
      isbn: normalizedISBN,
      metrics,
      compression: {
        originalSize: metrics.originalSize,
        totalWebpSize,
        ratio: `${compressionRatio}%`
      },
      urls: {
        large: `/covers/${normalizedISBN}/large`,
        medium: `/covers/${normalizedISBN}/medium`,
        small: `/covers/${normalizedISBN}/small`
      },
      r2Keys: uploadResults.map(r => r.key)
    };

  } catch (error) {
    metrics.totalMs = Date.now() - startTime;
    console.error(`[jSquash] Failed to process ${normalizedISBN}:`, error.message);

    return {
      status: 'error',
      isbn: normalizedISBN,
      error: error.message,
      metrics
    };
  }
}

/**
 * Check if processed WebP covers exist for an ISBN
 */
export async function coversExist(env, isbn) {
  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  // Check for large.webp as indicator
  const key = `isbn/${normalizedISBN}/large.webp`;
  const head = await env.COVER_IMAGES.head(key);
  return head !== null;
}

/**
 * Get available sizes
 */
export function getAvailableSizes() {
  return SIZES;
}

/**
 * Benchmark function for testing
 * Processes image but cleans up R2 files afterward
 */
export async function benchmark(sourceUrl, env) {
  const testISBN = 'benchmark-test';
  const result = await processAndStoreCover(testISBN, sourceUrl, env);

  // Clean up test files
  if (result.status === 'processed') {
    for (const key of result.r2Keys) {
      await env.COVER_IMAGES.delete(key);
    }
  }

  return result;
}
