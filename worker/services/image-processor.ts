/**
 * Image Processor Service
 *
 * Downloads, validates, and stores cover images in R2.
 * Handles WebP conversion and multiple size generation.
 *
 * @module services/image-processor
 */

import { fetchBestCover, getPlaceholderCover, type CoverResult } from './cover-fetcher.js';
import { fetchWithRetry } from '../lib/fetch-utils.js';
import type { Env } from '../src/env.js';
import type { ImageSizes, DownloadImageResult } from '../src/services/types.js';

// Image size definitions (width x height for book covers - 2:3 aspect ratio)
const SIZES: ImageSizes = {
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
 * R2 custom metadata fields stored with cover images
 * These fields are stored as strings in R2's customMetadata
 * All fields are optional because R2 spreads may not include all fields
 */
interface R2CoverCustomMetadata {
  /** ISO timestamp when the cover was uploaded */
  uploadedAt?: string;
  /** Provider source (openlibrary, isbndb, google, etc.) */
  source?: string;
  /** Original provider URL */
  sourceUrl?: string;
  /** Cover quality rating (high, medium, low) */
  quality?: string;
  /** Original image size in bytes (as string) */
  originalSize?: string;
  /** SHA-256 hash for deduplication */
  hash?: string;
  /** OpenLibrary work key (optional metadata) */
  workKey?: string;
  /** Original image type (jpg, png, webp) */
  originalType?: string;
  /** Flag if WebP conversion was skipped */
  webpSkipped?: string;
}

/**
 * Cover metadata from R2
 * Combines R2 object metadata with custom metadata fields
 */
export interface CoverMetadata extends R2CoverCustomMetadata {
  /** Whether the cover exists in R2 */
  exists: boolean;
  /** ISBN key used for lookup */
  isbn: string;
  /** File extension (jpg, png, webp) */
  extension: string;
  /** File size in bytes from R2 */
  size: number;
  /** Upload timestamp from R2 */
  uploaded: Date;
}

/**
 * Cover processing options
 */
export interface ProcessCoverOptions {
  force?: boolean;
  knownCoverUrl?: string;
  /** Source provider for knownCoverUrl (defaults to 'openlibrary') */
  knownCoverSource?: 'isbndb' | 'google-books' | 'openlibrary';
}

/**
 * Cover processing result
 */
export interface ProcessCoverResult {
  status: 'processed' | 'already_exists' | 'no_cover' | 'error';
  isbn: string;
  cached?: boolean;
  source?: string;
  quality?: string;
  size?: number;
  hash?: string;
  processingTimeMs: number;
  urls?: {
    original: string;
    large: string;
    medium: string;
    small: string;
  };
  error?: string;
}

/**
 * Batch processing result
 */
export interface BatchProcessResult {
  total: number;
  processed: number;
  cached: number;
  failed: number;
  processingTimeMs: number;
  results: ProcessCoverResult[];
}

/**
 * Validate that URL is from an allowed domain
 * @param url - URL to validate
 * @returns True if domain is allowed
 */
function isAllowedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Generate SHA-256 hash of data for deduplication
 * @param data - Data to hash
 * @returns Hex hash string
 */
async function hashData(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download and validate an image from a URL
 * @param url - Image URL
 * @returns Image buffer and content type
 */
async function downloadImage(url: string): Promise<DownloadImageResult> {
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
 * @param env - Worker environment
 * @param key - R2 object key
 * @param data - Image data
 * @param contentType - Image content type
 * @param metadata - Custom metadata
 */
async function storeInR2(
  env: Env,
  key: string,
  data: ArrayBuffer,
  contentType: string,
  metadata: Record<string, string> = {}
): Promise<void> {
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
 * @param env - Worker environment
 * @param isbn - ISBN to check
 * @returns True if cover exists
 */
export async function coverExists(env: Env, isbn: string): Promise<boolean> {
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
 * @param env - Worker environment
 * @param isbn - ISBN to check
 * @returns Cover metadata or null if not found
 */
export async function getCoverMetadata(env: Env, isbn: string): Promise<CoverMetadata | null> {
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
 * 2. Fetch best cover URL from providers (or use provided URL)
 * 3. Download and validate image
 * 4. Store original in R2
 * 5. Return metadata
 *
 * Note: Resizing to multiple sizes is deferred - we store original only
 * and can use Cloudflare Image Resizing on-demand, or add pre-generation later.
 *
 * @param isbn - ISBN to process
 * @param env - Worker environment
 * @param options - Processing options
 * @returns Processing result
 */
export async function processCoverImage(
  isbn: string,
  env: Env,
  options: ProcessCoverOptions = {}
): Promise<ProcessCoverResult> {
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
          cached: true,
          processingTimeMs: Date.now() - startTime
        };
      }
    }

    // 2. Fetch best cover URL from providers (or use known URL)
    let coverResult: CoverResult;

    if (options.knownCoverUrl) {
      // Use the provided cover URL directly (avoids redundant API calls)
      console.log(`Using known cover URL for ${normalizedISBN}: ${options.knownCoverUrl}`);
      coverResult = {
        url: options.knownCoverUrl,
        source: options.knownCoverSource || 'openlibrary',
        quality: 'high'
      };
    } else {
      // Search across providers
      console.log(`Fetching cover for ${normalizedISBN}...`);
      coverResult = await fetchBestCover(normalizedISBN, env);
    }

    if (coverResult.source === 'placeholder') {
      console.log(`No cover found for ${normalizedISBN}`);
      return {
        status: 'no_cover',
        isbn: normalizedISBN,
        source: 'placeholder',
        error: coverResult.error || 'No cover found from any provider',
        processingTimeMs: Date.now() - startTime
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
    console.error(`Failed to process cover for ${normalizedISBN}:`, (error as Error).message);

    return {
      status: 'error',
      isbn: normalizedISBN,
      error: (error as Error).message,
      processingTimeMs: processingTime
    };
  }
}

/**
 * Process multiple covers in batch
 * Limited to prevent Worker CPU timeout
 *
 * @param isbns - Array of ISBNs to process
 * @param env - Worker environment
 * @param limit - Max concurrent processing (default 5)
 * @returns Batch processing results
 */
export async function processCoverBatch(
  isbns: string[],
  env: Env,
  limit: number = 5
): Promise<BatchProcessResult> {
  const startTime = Date.now();

  // Limit batch size to prevent timeout
  const batch = isbns.slice(0, limit);

  const results = await Promise.allSettled(
    batch.map(isbn => processCoverImage(isbn, env))
  );

  const processed = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        isbn: batch[index],
        status: 'error' as const,
        error: (result.reason as Error)?.message || 'Unknown error',
        processingTimeMs: 0
      };
    }
  });

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
 * @returns Image sizes configuration
 */
export function getAvailableSizes(): ImageSizes {
  return SIZES;
}

/**
 * Get placeholder cover URL
 * Re-export from cover-fetcher for convenience
 */
export { getPlaceholderCover };
