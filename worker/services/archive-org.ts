/**
 * Archive.org Cover Image Fetcher Service
 *
 * Fetches cover image URLs from Archive.org's digital library using a two-step process:
 * 1. ISBN → Identifier lookup via Advanced Search API
 * 2. Identifier → Cover URL via Metadata API or Image Service
 *
 * Features:
 * - KV-backed rate limiting (1 req/sec, respectful to Archive.org)
 * - Response caching (7 days TTL)
 * - Cover quality detection based on file metadata
 * - Graceful error handling (returns null, never throws)
 * - User-Agent with donation link following API best practices
 *
 * @module services/archive-org
 * @since 2.3.0
 */

import { fetchWithRetry } from '../lib/fetch-utils.js';
import { normalizeISBN } from '../lib/isbn-utils.js';
import {
  enforceRateLimit,
  buildUserAgent,
  buildRateLimitKey,
  buildCacheKey,
  getCachedResponse,
  setCachedResponse,
  RATE_LIMITS,
  CACHE_TTLS,
} from '../lib/open-api-utils.js';
import type { Env } from '../src/env.js';
import type {
  ArchiveOrgSearchResponse,
  ArchiveOrgMetadataResponse,
  ArchiveOrgFile,
} from '../types/open-apis.js';
import type { CoverResult } from './cover-fetcher.js';

// =================================================================================
// Constants
// =================================================================================

/**
 * Archive.org API endpoints
 */
const ARCHIVE_ORG_SEARCH_API = 'https://archive.org/advancedsearch.php';
const ARCHIVE_ORG_METADATA_API = 'https://archive.org/metadata';
const ARCHIVE_ORG_IMAGE_SERVICE = 'https://archive.org/services/img';

/**
 * User-Agent for Archive.org API requests
 */
const USER_AGENT = buildUserAgent('archive.org', 'Cover images');

/**
 * Cover file formats in priority order (highest quality first)
 */
const COVER_FORMATS = ['jp2', 'jpg', 'jpeg', 'png', 'gif'];

/**
 * Cover file patterns to match in metadata files array
 * Archive.org typically names cover files with these patterns
 */
const COVER_FILE_PATTERNS = [
  /cover\.jp2$/i,
  /cover\.jpg$/i,
  /cover\.jpeg$/i,
  /cover\.png$/i,
  /_0000\.jp2$/i,  // First page scan
  /_0001\.jp2$/i,  // Sometimes front matter
];

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Search Archive.org for an identifier by ISBN
 *
 * Uses the Advanced Search API to find books matching the ISBN.
 * Returns the first matching identifier, or null if not found.
 *
 * API: https://archive.org/advancedsearch.php?q=isbn:{isbn}&output=json
 *
 * @param isbn - Normalized ISBN (10 or 13 digits)
 * @param env - Worker environment (for KV rate limiting)
 * @returns Archive.org identifier or null
 *
 * @example
 * ```typescript
 * const identifier = await searchArchiveOrgByISBN('9780553293357', env);
 * // Returns: "harrypotterphilo00rowl" or null
 * ```
 */
async function searchArchiveOrgByISBN(isbn: string, env: Env): Promise<string | null> {
  try {
    // Enforce rate limit before search API call
    await enforceRateLimit(
      env.CACHE,
      buildRateLimitKey('archive.org'),
      RATE_LIMITS['archive.org']
    );

    // Build search query URL
    const searchUrl = `${ARCHIVE_ORG_SEARCH_API}?q=isbn:${isbn}&fl=identifier&output=json`;

    // Fetch search results
    const response = await fetchWithRetry(
      searchUrl,
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      { timeoutMs: 10000, maxRetries: 2 }
    );

    if (!response.ok) {
      console.error(`Archive.org: Search API error ${response.status} for ISBN ${isbn}`);
      return null;
    }

    const data = (await response.json()) as ArchiveOrgSearchResponse;

    // Check if any results found
    if (!data.response || !data.response.docs || data.response.docs.length === 0) {
      console.log(`Archive.org: No search results for ISBN ${isbn}`);
      return null;
    }

    // Return first matching identifier
    const identifier = data.response.docs[0].identifier;
    console.log(`Archive.org: Found identifier "${identifier}" for ISBN ${isbn}`);
    return identifier;
  } catch (error) {
    console.error('Archive.org: Search failed:', (error as Error).message);
    return null;
  }
}

/**
 * Get cover URL for an Archive.org identifier
 *
 * Two strategies:
 * 1. Try direct image service URL (fast, reliable)
 * 2. Fallback to metadata API to find specific cover file (slower but more accurate)
 *
 * @param identifier - Archive.org identifier
 * @param env - Worker environment (for KV rate limiting)
 * @returns Cover URL and quality information, or null
 *
 * @example
 * ```typescript
 * const cover = await getArchiveOrgCoverUrl('harrypotterphilo00rowl', env);
 * // Returns: { url: 'https://archive.org/services/img/...', quality: 'high' }
 * ```
 */
async function getArchiveOrgCoverUrl(
  identifier: string,
  env: Env
): Promise<{ url: string; quality: CoverResult['quality'] } | null> {
  try {
    // Strategy 1: Try direct image service URL first (fast path)
    const imageServiceUrl = `${ARCHIVE_ORG_IMAGE_SERVICE}/${identifier}`;

    // Validate image service URL with HEAD request
    await enforceRateLimit(
      env.CACHE,
      buildRateLimitKey('archive.org'),
      RATE_LIMITS['archive.org']
    );

    const headResponse = await fetchWithRetry(
      imageServiceUrl,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      { timeoutMs: 10000, maxRetries: 2 }
    );

    // If image service returns a valid image, use it
    if (headResponse.ok) {
      const contentType = headResponse.headers.get('content-type');
      const contentLength = headResponse.headers.get('content-length');

      if (contentType?.startsWith('image/')) {
        const sizeBytes = contentLength ? parseInt(contentLength, 10) : 0;
        const quality = detectCoverQuality(sizeBytes, 'jpg');
        console.log(
          `Archive.org: Using image service URL for ${identifier} (${sizeBytes} bytes, quality: ${quality})`
        );
        return { url: imageServiceUrl, quality };
      }
    }

    // Strategy 2: Fallback to metadata API for specific cover file
    console.log(`Archive.org: Image service failed for ${identifier}, trying metadata API`);

    await enforceRateLimit(
      env.CACHE,
      buildRateLimitKey('archive.org'),
      RATE_LIMITS['archive.org']
    );

    const metadataUrl = `${ARCHIVE_ORG_METADATA_API}/${identifier}`;
    const metadataResponse = await fetchWithRetry(
      metadataUrl,
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      { timeoutMs: 10000, maxRetries: 2 }
    );

    if (!metadataResponse.ok) {
      console.error(`Archive.org: Metadata API error ${metadataResponse.status} for ${identifier}`);
      return null;
    }

    const metadata = (await metadataResponse.json()) as ArchiveOrgMetadataResponse;

    // Find best cover file in files array
    const coverFile = findBestCoverFile(metadata.files || []);
    if (!coverFile) {
      console.log(`Archive.org: No cover file found in metadata for ${identifier}`);
      return null;
    }

    // Build download URL for cover file
    const coverUrl = `https://${metadata.server}${metadata.dir}/${coverFile.name}`;
    const quality = detectCoverQuality(
      parseInt(coverFile.size || '0', 10),
      coverFile.format || ''
    );

    console.log(
      `Archive.org: Found cover file "${coverFile.name}" for ${identifier} (quality: ${quality})`
    );
    return { url: coverUrl, quality };
  } catch (error) {
    console.error('Archive.org: Cover URL fetch failed:', (error as Error).message);
    return null;
  }
}

/**
 * Find best cover file from Archive.org metadata files array
 *
 * Prioritizes files matching cover patterns and preferred formats.
 *
 * @param files - Array of file metadata from Archive.org
 * @returns Best matching cover file or null
 */
function findBestCoverFile(files: ArchiveOrgFile[]): ArchiveOrgFile | null {
  if (!files || files.length === 0) return null;

  // Try each cover pattern in order
  for (const pattern of COVER_FILE_PATTERNS) {
    const match = files.find((file) => pattern.test(file.name));
    if (match) return match;
  }

  // Fallback: find any image file in preferred format order
  for (const format of COVER_FORMATS) {
    const match = files.find((file) => file.format?.toLowerCase() === format);
    if (match) return match;
  }

  return null;
}

/**
 * Detect cover quality based on file size and format
 *
 * Quality tiers:
 * - high: Large images (>100KB), JP2/JPEG format
 * - medium: Medium images (20-100KB)
 * - low: Small images (<20KB), thumbnails
 * - missing: No file size available
 *
 * @param sizeBytes - File size in bytes
 * @param format - File format (jp2, jpg, png, etc.)
 * @returns Quality level
 */
function detectCoverQuality(sizeBytes: number, format: string): CoverResult['quality'] {
  const formatLower = format.toLowerCase();

  // High quality: large files in good formats
  if (sizeBytes > 100000 && (formatLower === 'jp2' || formatLower === 'jpg' || formatLower === 'jpeg')) {
    return 'high';
  }

  // Medium quality: decent size
  if (sizeBytes > 20000) {
    return 'medium';
  }

  // Low quality: small files
  if (sizeBytes > 0) {
    return 'low';
  }

  // Unknown size
  return 'low';
}

// =================================================================================
// Main Export
// =================================================================================

/**
 * Fetch cover URL from Archive.org for a given ISBN
 *
 * Process:
 * 1. Check cache (7-day TTL)
 * 2. Normalize ISBN
 * 3. Search Archive.org for identifier (ISBN → identifier)
 * 4. Fetch cover URL from identifier (identifier → cover URL)
 * 5. Detect cover quality
 * 6. Cache result
 * 7. Return CoverResult
 *
 * Error Handling:
 * - Returns null on any error (never throws)
 * - Logs errors with context for debugging
 * - Gracefully handles rate limit failures, API errors, network timeouts
 *
 * Rate Limiting:
 * - Enforces 1 req/sec via KV storage
 * - Distributed across Worker isolates
 * - Gracefully degrades on KV unavailability
 *
 * Caching:
 * - 7-day TTL (covers may be added/updated)
 * - Caches final CoverResult (not intermediate API responses)
 * - Key format: "archive.org:cover:{isbn}"
 *
 * @param isbn - ISBN to lookup (10 or 13 digits)
 * @param env - Worker environment with CACHE KV binding
 * @returns Cover result with URL, source, and quality, or null if not found
 *
 * @example
 * ```typescript
 * const cover = await fetchArchiveOrgCover('9780553293357', env);
 * if (cover) {
 *   console.log(`Cover URL: ${cover.url}`);
 *   console.log(`Quality: ${cover.quality}`);
 * }
 * ```
 */
export async function fetchArchiveOrgCover(isbn: string, env: Env): Promise<CoverResult | null> {
  // Normalize ISBN
  const normalizedISBN = normalizeISBN(isbn);
  if (!normalizedISBN) {
    console.log(`Archive.org: Invalid ISBN "${isbn}"`);
    return null;
  }

  try {
    // Check cache first
    const cacheKey = buildCacheKey('archive.org', 'cover', normalizedISBN);
    const cached = await getCachedResponse<CoverResult>(env.CACHE, cacheKey);

    if (cached) {
      console.log(`Archive.org: Cache hit for ISBN ${normalizedISBN}`);
      return cached;
    }

    // Step 1: Search for identifier by ISBN
    const identifier = await searchArchiveOrgByISBN(normalizedISBN, env);
    if (!identifier) {
      // Cache null result to avoid repeated failed lookups
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['archive.org']);
      return null;
    }

    // Step 2: Get cover URL from identifier
    const coverInfo = await getArchiveOrgCoverUrl(identifier, env);
    if (!coverInfo) {
      // Cache null result
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['archive.org']);
      return null;
    }

    // Build CoverResult
    const result: CoverResult = {
      url: coverInfo.url,
      source: 'archive-org',
      quality: coverInfo.quality,
    };

    // Cache successful result
    await setCachedResponse(env.CACHE, cacheKey, result, CACHE_TTLS['archive.org']);

    console.log(`Archive.org: Successfully fetched cover for ISBN ${normalizedISBN}`);
    return result;
  } catch (error) {
    console.error('Archive.org: Fetch error:', (error as Error).message);
    return null;
  }
}
