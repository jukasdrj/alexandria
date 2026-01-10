/**
 * Google Books Subject Enrichment Service
 *
 * Extracts book categories/subjects from Google Books API for Phase 2 subject enrichment.
 * Wraps existing Google Books integration from external-apis.ts.
 *
 * Features:
 * - KV-backed rate limiting (1 req/sec via open-api-utils)
 * - Response caching (30-day TTL for stable metadata)
 * - Graceful error handling (returns null, never throws)
 * - Category extraction and normalization
 *
 * Integration: Works alongside existing Google Books cover/metadata fetcher
 *
 * @module services/google-books
 * @since 2.4.0
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
import type { Logger } from '../lib/logger.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Google Books API response structure (extended from external-apis.ts)
 * Includes categories field for subject enrichment
 */
interface GoogleBooksVolumeResponse {
  items?: Array<{
    id: string;
    volumeInfo: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      publisher?: string;
      publishedDate?: string;
      pageCount?: number;
      language?: string;
      description?: string;
      categories?: string[];  // PRIMARY FIELD FOR SUBJECT ENRICHMENT
      imageLinks?: {
        smallThumbnail?: string;
        thumbnail?: string;
      };
      industryIdentifiers?: Array<{
        type: string;
        identifier: string;
      }>;
    };
  }>;
}

/**
 * Google Books metadata with focus on categories/subjects
 */
export interface GoogleBooksMetadata {
  volumeId: string;
  title: string;
  authors?: string[];
  categories?: string[];  // Book categories for subject enrichment
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  language?: string;
  description?: string;
  imageLinks?: {
    thumbnail?: string;
    smallThumbnail?: string;
  };
  confidence: number;
  fetchedAt: string;
}

// =================================================================================
// Constants
// =================================================================================

/**
 * Google Books API endpoint
 */
const GOOGLE_BOOKS_API_BASE = 'https://www.googleapis.com/books/v1/volumes';

/**
 * User-Agent for Google Books API
 */
const USER_AGENT = buildUserAgent('google-books', 'Book metadata enrichment');

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Calculate confidence score for Google Books metadata
 *
 * @param volumeInfo - Google Books volume info object
 * @returns Confidence score (0-100)
 */
function calculateConfidence(volumeInfo: GoogleBooksVolumeResponse['items'][0]['volumeInfo']): number {
  let confidence = 60; // Base confidence for finding the book

  if (volumeInfo.authors?.length) confidence += 15;  // Has authors
  if (volumeInfo.publishedDate) confidence += 10;    // Has publication date
  if (volumeInfo.categories?.length) confidence += 10; // Has categories (critical for subject enrichment)
  if (volumeInfo.description) confidence += 5;        // Has description

  return Math.min(confidence, 100);
}

/**
 * Normalize Google Books categories for consistency
 *
 * Google Books categories are broad (e.g., "Fiction", "History").
 * This function normalizes them for storage in enriched_works.
 *
 * @param categories - Raw categories from Google Books API
 * @returns Normalized category array
 */
function normalizeCategories(categories: string[]): string[] {
  if (!categories || categories.length === 0) {
    return [];
  }

  return categories
    .map(cat => cat.trim())
    .filter(cat => cat.length > 0)
    .map(cat => {
      // Google Books sometimes uses "Fiction / Fantasy" format
      // Split on " / " and take all parts as separate categories
      if (cat.includes(' / ')) {
        return cat.split(' / ').map(c => c.trim());
      }
      return cat;
    })
    .flat()
    .filter((cat, index, self) => self.indexOf(cat) === index); // Deduplicate
}

// =================================================================================
// Public API
// =================================================================================

/**
 * Fetch book metadata from Google Books API with focus on categories
 *
 * **Caching**: 30-day TTL (book metadata rarely changes)
 * **Rate Limiting**: 1 req/sec via KV-backed distributed limiter
 *
 * @param isbn - ISBN (10 or 13 digits)
 * @param env - Environment with KV bindings and API key
 * @param logger - Optional logger
 * @returns Book metadata with categories or null if not found
 *
 * @example
 * ```typescript
 * const metadata = await fetchGoogleBooksMetadata('9780747532743', env, logger);
 * if (metadata?.categories) {
 *   console.log(`Categories: ${metadata.categories.join(', ')}`);
 * }
 * ```
 */
export async function fetchGoogleBooksMetadata(
  isbn: string,
  env: Env,
  logger?: Logger
): Promise<GoogleBooksMetadata | null> {
  // Normalize ISBN
  const normalized = normalizeISBN(isbn);
  if (!normalized) {
    if (logger) {
      logger.warn('Invalid ISBN for Google Books lookup', { isbn });
    }
    return null;
  }

  // Check cache
  const cacheKey = buildCacheKey('google-books', 'metadata', normalized);
  const cached = await getCachedResponse<GoogleBooksMetadata>(env.CACHE, cacheKey, logger);
  if (cached) {
    if (logger) {
      logger.debug('Google Books cache hit', { isbn: normalized });
    }
    return cached;
  }

  try {
    // Get API key
    const apiKey = await env.GOOGLE_BOOKS_API_KEY?.get();
    if (!apiKey) {
      if (logger) {
        logger.warn('Google Books API key not configured');
      }
      return null;
    }

    // Enforce rate limit (1 req/sec)
    const rateLimitKey = buildRateLimitKey('google-books');
    await enforceRateLimit(env.CACHE, rateLimitKey, RATE_LIMITS['google-books'], logger);

    // Build query URL
    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalized}&key=${apiKey}`;

    // Execute API request
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      {
        maxRetries: 3,
        timeoutMs: 10000,
      }
    );

    if (!response || !response.ok) {
      if (logger) {
        logger.warn('Google Books API request failed', {
          isbn: normalized,
          status: response?.status || 'no response',
        });
      }
      return null;
    }

    const data = await response.json() as GoogleBooksVolumeResponse;
    const item = data.items?.[0];

    if (!item || !item.volumeInfo) {
      if (logger) {
        logger.debug('No Google Books results for ISBN', { isbn: normalized });
      }
      return null;
    }

    const volumeInfo = item.volumeInfo;

    // Extract and normalize categories
    const categories = volumeInfo.categories
      ? normalizeCategories(volumeInfo.categories)
      : undefined;

    // Build metadata object
    const metadata: GoogleBooksMetadata = {
      volumeId: item.id,
      title: volumeInfo.title || 'Unknown',
      authors: volumeInfo.authors,
      categories,
      publisher: volumeInfo.publisher,
      publishedDate: volumeInfo.publishedDate,
      pageCount: volumeInfo.pageCount,
      language: volumeInfo.language,
      description: volumeInfo.description,
      imageLinks: volumeInfo.imageLinks,
      confidence: calculateConfidence(volumeInfo),
      fetchedAt: new Date().toISOString(),
    };

    // Cache result
    await setCachedResponse(env.CACHE, cacheKey, metadata, CACHE_TTLS['google-books'], logger);

    if (logger) {
      logger.info('Google Books metadata fetched', {
        isbn: normalized,
        volumeId: item.id,
        categoriesCount: categories?.length || 0,
        confidence: metadata.confidence,
      });
    }

    return metadata;

  } catch (error) {
    if (logger) {
      logger.error('Google Books fetch error', {
        isbn: normalized,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

/**
 * Extract only categories from Google Books metadata
 *
 * Lightweight wrapper that returns just the categories array.
 * Useful for subject enrichment pipeline where only categories are needed.
 *
 * @param isbn - ISBN to lookup
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Array of categories or empty array
 *
 * @example
 * ```typescript
 * const categories = await extractGoogleBooksCategories('9780747532743', env, logger);
 * // Returns: ["Fiction", "Fantasy", "Young Adult"]
 * ```
 */
export async function extractGoogleBooksCategories(
  isbn: string,
  env: Env,
  logger?: Logger
): Promise<string[]> {
  const metadata = await fetchGoogleBooksMetadata(isbn, env, logger);
  return metadata?.categories || [];
}

/**
 * Batch extract categories for multiple ISBNs
 *
 * Respects rate limiting (1 req/sec) so will take ~N seconds for N ISBNs.
 * Returns Map for easy lookup of results.
 *
 * @param isbns - Array of ISBNs to process
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Map of ISBN → categories array
 *
 * @example
 * ```typescript
 * const results = await batchExtractCategories(['978...', '978...'], env, logger);
 * const firstBookCategories = results.get('978...') || [];
 * ```
 */
export async function batchExtractCategories(
  isbns: string[],
  env: Env,
  logger?: Logger
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();

  for (const isbn of isbns) {
    try {
      const categories = await extractGoogleBooksCategories(isbn, env, logger);
      results.set(isbn, categories);
    } catch (error) {
      if (logger) {
        logger.warn('Batch category extraction failed for ISBN', {
          isbn,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      results.set(isbn, []);
    }
  }

  return results;
}
