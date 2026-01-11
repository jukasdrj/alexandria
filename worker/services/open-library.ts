/**
 * OpenLibrary Search Service
 *
 * Provides free, quota-free book metadata and ISBN resolution via OpenLibrary's Search API.
 * Used as fallback when ISBNdb quota exhausted.
 *
 * Features:
 * - Title/author → ISBN search (primary use case for backfill fallback)
 * - ISBN → Book metadata lookup
 * - KV-backed rate limiting (100 req per 5 minutes = ~1 req every 3 seconds)
 * - Response caching (7-day TTL for stable metadata)
 * - Graceful error handling (returns null, never throws)
 * - User-Agent with contact info following best practices
 *
 * Best Practices (from OpenLibrary documentation):
 * - Include descriptive User-Agent with contact info
 * - Not intended for bulk downloads (use archive.org for bulk)
 * - Respect rate limits to ensure fair access
 * - Query runtime limited to 60 seconds server-side
 * - Max limit parameter: 1000 results
 *
 * @see https://openlibrary.org/dev/docs/api/search
 * @see https://openlibrary.org/developers/api
 * @module services/open-library
 * @since 2.5.0
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
} from '../lib/open-api-utils.js';
import type { Env } from '../src/env.js';
import type { Logger } from '../lib/logger.js';

// =================================================================================
// Constants
// =================================================================================

/**
 * OpenLibrary Search API endpoint
 */
const OPEN_LIBRARY_SEARCH_API = 'https://openlibrary.org/search.json';

/**
 * User-Agent for OpenLibrary API
 * Following best practices: include project name, contact, purpose
 */
const USER_AGENT = buildUserAgent('open-library', 'Book metadata enrichment and ISBN resolution');

/**
 * Rate limit: 100 requests per 5 minutes (per OpenLibrary docs)
 * Conservative: 1 request every 3 seconds = 20 req/min = 100 req/5min
 */
const RATE_LIMIT_MS = 3000; // 3 seconds between requests

/**
 * Cache TTL: 7 days (book metadata may be updated/corrected)
 */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

// =================================================================================
// Types
// =================================================================================

/**
 * OpenLibrary Search API response structure
 *
 * @see https://openlibrary.org/dev/docs/api/search
 */
interface OpenLibrarySearchResponse {
  numFound: number;
  start: number;
  num_found?: number; // Alternative field name
  docs: OpenLibraryDocument[];
}

/**
 * Document in OpenLibrary search results
 *
 * Work-level data with edition-level identifiers.
 * Fields vary by result, defensive parsing required.
 */
interface OpenLibraryDocument {
  key: string; // Work key (e.g., "/works/OL45804W")
  title: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  isbn?: string[]; // ISBNs from all editions
  edition_count?: number;
  publisher?: string[];
  language?: string[];
  cover_i?: number; // Cover ID
  oclc?: string[];
  lccn?: string[];
}

/**
 * OpenLibrary book metadata result
 */
export interface OpenLibraryMetadata {
  workKey: string;
  title: string;
  authorNames?: string[];
  authorKeys?: string[];
  firstPublishYear?: number;
  isbns?: string[];
  editionCount?: number;
  publishers?: string[];
  languages?: string[];
  coverId?: number;
  confidence: number;
  fetchedAt: string;
}

/**
 * ISBN resolution result
 */
export interface OpenLibraryISBNResult {
  isbn: string | null;
  confidence: number;
  source: 'open-library';
  metadata?: OpenLibraryMetadata;
}

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Calculate confidence score for OpenLibrary metadata
 *
 * @param doc - Search result document
 * @returns Confidence score (0-100)
 */
function calculateConfidence(doc: OpenLibraryDocument): number {
  let confidence = 50; // Base confidence for finding the work

  if (doc.author_name?.length) confidence += 20; // Has authors
  if (doc.first_publish_year) confidence += 10; // Has publication year
  if (doc.isbn?.length) confidence += 10; // Has ISBNs
  if (doc.cover_i) confidence += 5; // Has cover
  if (doc.edition_count && doc.edition_count > 1) confidence += 5; // Multiple editions (well-known work)

  return Math.min(confidence, 100);
}

/**
 * Convert OpenLibrary document to metadata object
 *
 * @param doc - Search result document
 * @returns Metadata object
 */
function documentToMetadata(doc: OpenLibraryDocument): OpenLibraryMetadata {
  return {
    workKey: doc.key,
    title: doc.title,
    authorNames: doc.author_name,
    authorKeys: doc.author_key,
    firstPublishYear: doc.first_publish_year,
    isbns: doc.isbn,
    editionCount: doc.edition_count,
    publishers: doc.publisher,
    languages: doc.language,
    coverId: doc.cover_i,
    confidence: calculateConfidence(doc),
    fetchedAt: new Date().toISOString(),
  };
}

// =================================================================================
// Public API
// =================================================================================

/**
 * Search OpenLibrary by title and author
 *
 * Returns the best matching work with ISBNs for all editions.
 * Used as fallback for ISBN resolution when ISBNdb quota exhausted.
 *
 * **Caching**: 7-day TTL (book metadata may be updated)
 * **Rate Limiting**: 1 req every 3 seconds (100 req per 5 minutes)
 *
 * @param title - Book title
 * @param author - Author name
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Metadata with ISBNs or null if not found
 *
 * @example
 * ```typescript
 * const result = await searchOpenLibraryByTitleAuthor(
 *   'The Splendid and the Vile',
 *   'Erik Larson',
 *   env,
 *   logger
 * );
 * if (result) {
 *   console.log(`Found ${result.isbns?.length} ISBNs`);
 * }
 * ```
 */
export async function searchOpenLibraryByTitleAuthor(
  title: string,
  author: string,
  env: Env,
  logger?: Logger
): Promise<OpenLibraryMetadata | null> {
  try {
    // Build cache key
    const cacheKey = buildCacheKey('open-library', 'search', `${title}:${author}`);
    const cached = await getCachedResponse<OpenLibraryMetadata>(env.CACHE, cacheKey, logger);
    if (cached) {
      if (logger) {
        logger.debug('OpenLibrary cache hit', { title, author });
      }
      return cached;
    }

    // Enforce rate limit
    const rateLimitKey = buildRateLimitKey('open-library');
    await enforceRateLimit(env.CACHE, rateLimitKey, RATE_LIMIT_MS, logger);

    // Build search URL
    const params = new URLSearchParams({
      title: title,
      author: author,
      fields: 'key,title,author_name,author_key,first_publish_year,isbn,edition_count,publisher,language,cover_i',
      limit: '5', // Get top 5 results for best match
    });
    const url = `${OPEN_LIBRARY_SEARCH_API}?${params.toString()}`;

    // Execute search
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      {
        maxRetries: 3,
        timeoutMs: 15000, // 15-second timeout (server limit is 60 seconds)
      }
    );

    if (!response || !response.ok) {
      if (logger) {
        logger.warn('OpenLibrary search failed', {
          title,
          author,
          status: response?.status || 'no response',
        });
      }
      return null;
    }

    const data = (await response.json()) as OpenLibrarySearchResponse;
    const numFound = data.numFound || data.num_found || 0;

    if (numFound === 0 || !data.docs || data.docs.length === 0) {
      if (logger) {
        logger.debug('No OpenLibrary results', { title, author });
      }
      // Cache null result to avoid repeated failed lookups
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTL_SECONDS, logger);
      return null;
    }

    // Take first result (best match from OpenLibrary's ranking)
    const doc = data.docs[0];
    const metadata = documentToMetadata(doc);

    // Cache result
    await setCachedResponse(env.CACHE, cacheKey, metadata, CACHE_TTL_SECONDS, logger);

    if (logger) {
      logger.info('OpenLibrary search success', {
        title,
        author,
        workKey: metadata.workKey,
        isbnCount: metadata.isbns?.length || 0,
        confidence: metadata.confidence,
      });
    }

    return metadata;
  } catch (error) {
    if (logger) {
      logger.error('OpenLibrary search error', {
        title,
        author,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

/**
 * Resolve ISBN from title and author using OpenLibrary
 *
 * Searches OpenLibrary and returns the first ISBN-13 from the best matching work.
 * Prefers ISBN-13 over ISBN-10 for consistency with Alexandria's database.
 *
 * @param title - Book title
 * @param author - Author name
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns ISBN result with confidence or null
 *
 * @example
 * ```typescript
 * const result = await resolveISBNFromOpenLibrary('1984', 'George Orwell', env, logger);
 * if (result?.isbn) {
 *   console.log(`Resolved ISBN: ${result.isbn} (confidence: ${result.confidence})`);
 * }
 * ```
 */
export async function resolveISBNFromOpenLibrary(
  title: string,
  author: string,
  env: Env,
  logger?: Logger
): Promise<OpenLibraryISBNResult> {
  const metadata = await searchOpenLibraryByTitleAuthor(title, author, env, logger);

  if (!metadata || !metadata.isbns || metadata.isbns.length === 0) {
    return {
      isbn: null,
      confidence: 0,
      source: 'open-library',
    };
  }

  // Prefer ISBN-13 over ISBN-10
  let selectedISBN: string | null = null;
  for (const isbn of metadata.isbns) {
    const normalized = normalizeISBN(isbn);
    if (normalized) {
      // Prefer 13-digit ISBN
      if (normalized.length === 13) {
        selectedISBN = normalized;
        break;
      }
      // Fallback to 10-digit if no 13-digit found
      if (!selectedISBN && normalized.length === 10) {
        selectedISBN = normalized;
      }
    }
  }

  if (!selectedISBN) {
    if (logger) {
      logger.warn('OpenLibrary returned invalid ISBNs', {
        title,
        author,
        isbns: metadata.isbns,
      });
    }
    return {
      isbn: null,
      confidence: 0,
      source: 'open-library',
    };
  }

  return {
    isbn: selectedISBN,
    confidence: metadata.confidence,
    source: 'open-library',
    metadata,
  };
}

/**
 * Fetch book metadata from OpenLibrary by ISBN
 *
 * Searches OpenLibrary for books matching the given ISBN.
 * Returns work-level metadata with all edition ISBNs.
 *
 * @param isbn - ISBN (10 or 13 digits)
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Book metadata or null if not found
 *
 * @example
 * ```typescript
 * const metadata = await fetchOpenLibraryByISBN('9780747532743', env, logger);
 * if (metadata) {
 *   console.log(`Title: ${metadata.title}`);
 *   console.log(`Authors: ${metadata.authorNames?.join(', ')}`);
 * }
 * ```
 */
export async function fetchOpenLibraryByISBN(
  isbn: string,
  env: Env,
  logger?: Logger
): Promise<OpenLibraryMetadata | null> {
  const normalized = normalizeISBN(isbn);
  if (!normalized) {
    if (logger) {
      logger.warn('Invalid ISBN for OpenLibrary lookup', { isbn });
    }
    return null;
  }

  try {
    // Check cache
    const cacheKey = buildCacheKey('open-library', 'isbn', normalized);
    const cached = await getCachedResponse<OpenLibraryMetadata>(env.CACHE, cacheKey, logger);
    if (cached) {
      return cached;
    }

    // Enforce rate limit
    const rateLimitKey = buildRateLimitKey('open-library');
    await enforceRateLimit(env.CACHE, rateLimitKey, RATE_LIMIT_MS, logger);

    // Search by ISBN
    const params = new URLSearchParams({
      isbn: normalized,
      fields: 'key,title,author_name,author_key,first_publish_year,isbn,edition_count,publisher,language,cover_i',
      limit: '1',
    });
    const url = `${OPEN_LIBRARY_SEARCH_API}?${params.toString()}`;

    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      {
        maxRetries: 3,
        timeoutMs: 15000,
      }
    );

    if (!response || !response.ok) {
      if (logger) {
        logger.warn('OpenLibrary ISBN lookup failed', {
          isbn: normalized,
          status: response?.status || 'no response',
        });
      }
      return null;
    }

    const data = (await response.json()) as OpenLibrarySearchResponse;
    const numFound = data.numFound || data.num_found || 0;

    if (numFound === 0 || !data.docs || data.docs.length === 0) {
      if (logger) {
        logger.debug('No OpenLibrary results for ISBN', { isbn: normalized });
      }
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTL_SECONDS, logger);
      return null;
    }

    const doc = data.docs[0];
    const metadata = documentToMetadata(doc);

    // Cache result
    await setCachedResponse(env.CACHE, cacheKey, metadata, CACHE_TTL_SECONDS, logger);

    if (logger) {
      logger.info('OpenLibrary ISBN lookup success', {
        isbn: normalized,
        workKey: metadata.workKey,
        title: metadata.title,
      });
    }

    return metadata;
  } catch (error) {
    if (logger) {
      logger.error('OpenLibrary ISBN lookup error', {
        isbn: normalized,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}
