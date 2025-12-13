// =================================================================================
// Image Processing Utilities for Alexandria Cover Processing
// =================================================================================

import type { ImageSizes, DownloadImageResult } from './types.js';

export const PLACEHOLDER_COVER =
  'https://placehold.co/300x450/e0e0e0/666666?text=No+Cover';

export const ALLOWED_DOMAINS = new Set([
  'books.google.com',
  'covers.openlibrary.org',
  'images-na.ssl-images-amazon.com',
  'images.isbndb.com',
]);

export const SIZES: ImageSizes = {
  large: { width: 512, height: 768 },
  medium: { width: 256, height: 384 },
  small: { width: 128, height: 192 },
};

/**
 * Download image from provider URL with validation
 *
 * @param url - Provider cover URL
 * @returns Promise with buffer and contentType
 * @throws Error if download fails or validation fails
 */
export async function downloadImage(url: string): Promise<DownloadImageResult> {
  // Security: Validate domain whitelist
  try {
    const parsedUrl = new URL(url);
    if (!ALLOWED_DOMAINS.has(parsedUrl.hostname)) {
      throw new Error(`Domain not allowed: ${parsedUrl.hostname}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Domain not allowed')) {
      throw error;
    }
    throw new Error(`Invalid URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Download with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Alexandria/1.0 (covers@ooheynerds.com)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    const buffer = await response.arrayBuffer();

    // Validate file size (max 10MB)
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new Error('Image too large (>10MB)');
    }

    return { buffer, contentType };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Download timeout (>10s)');
    }
    throw error;
  }
}

/**
 * Generate SHA-256 hash for cache key generation
 *
 * @param url - URL to hash
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashURL(url: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalize image URL for consistent caching
 *
 * @param url - Original URL
 * @returns Normalized URL (HTTPS, no query params)
 */
export function normalizeImageURL(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.search = ''; // Remove query params
    parsed.protocol = 'https:'; // Force HTTPS
    return parsed.toString();
  } catch {
    return url.trim();
  }
}
