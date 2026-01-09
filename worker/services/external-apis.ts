/**
 * External API Service
 *
 * Fetches book metadata from external providers when Alexandria doesn't have the data.
 * Implements the "Smart Resolution" pattern for cache misses.
 *
 * Provider Priority:
 * 1. ISBNdb (paid, most reliable, rich metadata)
 * 2. Google Books (free, good coverage)
 * 3. OpenLibrary (free, fallback)
 */

import type { Env } from '../src/env.js';

// =================================================================================
// Validation Utilities
// =================================================================================

/**
 * Validates ISBN format (defense-in-depth validation).
 * Primary validation happens at route level via Zod, but service-level
 * validation prevents misuse if called from other modules.
 *
 * @param isbn - The ISBN to validate (should be pre-normalized: no hyphens/spaces)
 * @returns True if ISBN is valid format (10 or 13 digits with optional X)
 */
function validateISBN(isbn: string): boolean {
  // Remove any remaining hyphens or spaces
  const cleaned = isbn.replace(/[-\s]/g, '').toUpperCase();

  // Must be 10 or 13 digits (with optional X for ISBN-10 check digit)
  if (!/^[0-9]{9}[0-9X]$|^[0-9]{13}$/.test(cleaned)) {
    return false;
  }

  return cleaned.length === 10 || cleaned.length === 13;
}

// =================================================================================
// Fetch Utilities (Timeout + Retry Logic)
// =================================================================================

/**
 * Fetches a URL with timeout and exponential backoff retry logic.
 * Retries on transient failures (5xx, 429, timeouts).
 *
 * @param url - The URL to fetch
 * @param options - Fetch options (headers, etc.)
 * @param config - Retry configuration
 * @returns Response or null if all retries exhausted
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: {
    maxRetries?: number;
    timeoutMs?: number;
    baseDelayMs?: number;
  } = {}
): Promise<Response | null> {
  const {
    maxRetries = 3,
    timeoutMs = 5000, // 5s timeout (reduced from 10s for better responsiveness)
    baseDelayMs = 1000 // 1s base delay
  } = config;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add timeout via AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        // Retry on 5xx errors or 429 (rate limit)
        if (response.status >= 500 || response.status === 429) {
          if (attempt === maxRetries - 1) {
            console.warn(`Max retries exhausted for ${url}, status: ${response.status}`);
            return null;
          }

          const delay = baseDelayMs * Math.pow(2, attempt);
          console.warn(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms (status: ${response.status})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return response;

      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Handle timeout separately
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          if (attempt === maxRetries - 1) {
            console.warn(`Timeout after ${maxRetries} attempts for ${url}`);
            return null;
          }

          const delay = baseDelayMs * Math.pow(2, attempt);
          console.warn(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms (timeout)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw fetchError; // Re-throw non-timeout errors
      }

    } catch (error) {
      // Non-retryable error
      if (attempt === maxRetries - 1) {
        console.error(`Fetch failed after ${maxRetries} attempts:`, error instanceof Error ? error.message : String(error));
        return null;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms (error: ${error})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return null;
}

// =================================================================================
// Types
// =================================================================================

export interface ExternalBookData {
  isbn: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  language?: string;
  description?: string;
  coverUrls?: {
    small?: string;
    medium?: string;
    large?: string;
    original?: string;  // NEW: High-quality original cover (ISBNdb)
  };
  // NEW: ISBNdb enrichment fields (Issue #53)
  subjects?: string[];           // Subject tags for genre classification
  deweyDecimal?: string[];       // Dewey Decimal classification
  binding?: string;              // Format type (Hardcover, Paperback, etc.)
  relatedISBNs?: Record<string, string>;  // Related format ISBNs (epub, audiobook, etc.)
  workKey?: string;
  editionKey?: string;
  provider: 'isbndb' | 'google-books' | 'openlibrary';
}

interface ISBNdbResponse {
  book?: {
    title?: string;
    title_long?: string;
    authors?: string[];
    publisher?: string;
    date_published?: string;
    pages?: number;
    language?: string;
    synopsis?: string;
    image?: string;
    // NEW: ISBNdb enrichment fields (Issue #53)
    image_original?: string;                // High-quality original cover
    subjects?: string[];                     // Subject tags
    dewey_decimal?: string[];                // Dewey Decimal classification
    binding?: string;                        // Format (Hardcover, Paperback, etc.)
    related?: Record<string, string>;        // Related ISBNs (epub, audiobook, etc.)
    dimensions_structured?: {
      length?: { unit: string; value: number };
      width?: { unit: string; value: number };
      height?: { unit: string; value: number };
      weight?: { unit: string; value: number };
    };
  };
}

interface GoogleBooksResponse {
  items?: Array<{
    volumeInfo: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      publisher?: string;
      publishedDate?: string;
      pageCount?: number;
      language?: string;
      description?: string;
      imageLinks?: {
        smallThumbnail?: string;
        thumbnail?: string;
        small?: string;
        medium?: string;
        large?: string;
      };
      industryIdentifiers?: Array<{
        type: string;
        identifier: string;
      }>;
    };
  }>;
}

interface OpenLibraryResponse {
  [key: string]: {
    info?: {
      url?: string;
    };
    details?: {
      title?: string;
      subtitle?: string;
      authors?: Array<{ key: string }>;
      publishers?: string[];
      publish_date?: string;
      number_of_pages?: number;
      languages?: Array<{ key: string }>;
      description?: string | { value: string };
      covers?: number[];
      key?: string;
      works?: Array<{ key: string }>;
    };
  };
}

// =================================================================================
// ISBNdb Provider
// =================================================================================

async function fetchFromISBNdb(isbn: string, env: Env): Promise<ExternalBookData | null> {
  try {
    // QUOTA ENFORCEMENT (Issue #158 Fix)
    // Check and reserve quota BEFORE making API call
    const { QuotaManager } = await import('../src/services/quota-manager.js');
    const { Logger } = await import('../lib/logger.js');

    const logger = new Logger(env, { service: 'external-apis' });
    const quotaManager = new QuotaManager(env.QUOTA_KV, logger);

    const quota = await quotaManager.checkQuota(1, true);
    if (!quota.allowed) {
      console.warn(`[ExternalAPIs] ISBNdb quota exhausted (${quota.status.used_today}/${quota.status.limit}). Skipping ${isbn}`);
      return null; // Graceful degradation: resolveExternalISBN will try other sources
    }

    const apiKey = await env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      console.warn('ISBNdb API key not configured');
      return null;
    }

    // Premium endpoint: 3 req/sec, 15K daily searches
    const url = `https://api.premium.isbndb.com/book/${isbn}`;
    const response = await fetchWithRetry(url, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response || !response.ok) {
      console.warn(`ISBNdb returned ${response?.status || 'no response'} for ${isbn}`);
      return null;
    }

    const data: ISBNdbResponse = await response.json();
    const book = data.book;

    if (!book || !book.title) {
      return null;
    }

    // Extract cover URLs (prefer image_original for best quality)
    let coverUrls: ExternalBookData['coverUrls'];
    if (book.image_original || book.image) {
      coverUrls = {
        original: book.image_original,  // High-quality original (best for R2 processing)
        large: book.image,
        medium: book.image,
        small: book.image,
      };
    }

    return {
      isbn,
      title: book.title_long || book.title,
      authors: book.authors || [],
      publisher: book.publisher,
      publicationDate: book.date_published,
      pageCount: book.pages,
      language: book.language,
      description: book.synopsis,
      coverUrls,
      // NEW: ISBNdb enrichment fields (Issue #53)
      subjects: book.subjects || [],
      deweyDecimal: book.dewey_decimal || [],
      binding: book.binding,
      relatedISBNs: book.related,
      provider: 'isbndb',
    };

  } catch (error) {
    console.error('ISBNdb fetch error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// =================================================================================
// Google Books Provider
// =================================================================================

async function fetchFromGoogleBooks(isbn: string, env: Env): Promise<ExternalBookData | null> {
  try {
    const apiKey = await env.GOOGLE_BOOKS_API_KEY.get();
    if (!apiKey) {
      console.warn('Google Books API key not configured');
      return null;
    }

    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${apiKey}`;
    const response = await fetchWithRetry(url);

    if (!response || !response.ok) {
      console.warn(`Google Books returned ${response?.status || 'no response'} for ${isbn}`);
      return null;
    }

    const data: GoogleBooksResponse = await response.json();
    const item = data.items?.[0];

    if (!item || !item.volumeInfo) {
      return null;
    }

    const volumeInfo = item.volumeInfo;

    // Extract cover URLs with Google Books high-res trick
    let coverUrls: ExternalBookData['coverUrls'];
    if (volumeInfo.imageLinks) {
      const baseUrl = volumeInfo.imageLinks.thumbnail || volumeInfo.imageLinks.smallThumbnail;
      if (baseUrl) {
        // Remove zoom and edge parameters to get higher resolution
        const cleanUrl = baseUrl.replace(/&zoom=\d+/, '').replace(/&edge=curl/, '');
        coverUrls = {
          small: cleanUrl,
          medium: cleanUrl,
          large: cleanUrl,
        };
      }
    }

    return {
      isbn,
      title: volumeInfo.title || '',
      subtitle: volumeInfo.subtitle,
      authors: volumeInfo.authors || [],
      publisher: volumeInfo.publisher,
      publicationDate: volumeInfo.publishedDate,
      pageCount: volumeInfo.pageCount,
      language: volumeInfo.language,
      description: volumeInfo.description,
      coverUrls,
      provider: 'google-books',
    };

  } catch (error) {
    console.error('Google Books fetch error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// =================================================================================
// OpenLibrary Provider
// =================================================================================

async function fetchFromOpenLibrary(isbn: string, env: Env): Promise<ExternalBookData | null> {
  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=details`;
    const userAgent = env.USER_AGENT || 'Alexandria/2.0 (nerd@ooheynerds.com)';

    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': userAgent,
      },
    });

    if (!response || !response.ok) {
      console.warn(`OpenLibrary returned ${response?.status || 'no response'} for ${isbn}`);
      return null;
    }

    const data: OpenLibraryResponse = await response.json();
    const bookData = data[`ISBN:${isbn}`];

    if (!bookData || !bookData.details) {
      return null;
    }

    const details = bookData.details;

    // Extract description (can be string or object)
    let description: string | undefined;
    if (typeof details.description === 'string') {
      description = details.description;
    } else if (details.description && typeof details.description === 'object' && 'value' in details.description) {
      description = details.description.value;
    }

    // Extract cover URLs
    let coverUrls: ExternalBookData['coverUrls'];
    if (details.covers && details.covers.length > 0) {
      const coverId = details.covers[0];
      coverUrls = {
        small: `https://covers.openlibrary.org/b/id/${coverId}-S.jpg`,
        medium: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`,
        large: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`,
      };
    }

    // Extract work key
    const workKey = details.works?.[0]?.key;

    return {
      isbn,
      title: details.title || '',
      subtitle: details.subtitle,
      authors: details.authors?.map(a => a.key) || [],
      publisher: details.publishers?.[0],
      publicationDate: details.publish_date,
      pageCount: details.number_of_pages,
      language: details.languages?.[0]?.key,
      description,
      coverUrls,
      workKey,
      editionKey: details.key,
      provider: 'openlibrary',
    };

  } catch (error) {
    console.error('OpenLibrary fetch error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// =================================================================================
// Main Resolution Logic
// =================================================================================

/**
 * Resolves book metadata from external providers with cascading fallback.
 * Priority: ISBNdb → Google Books → OpenLibrary
 *
 * @param isbn - The ISBN to resolve (10 or 13 digits)
 * @param env - Worker environment with API keys
 * @returns Book data from the first successful provider, or null if all fail
 */
export async function resolveExternalISBN(isbn: string, env: Env): Promise<ExternalBookData | null> {
  console.log(`[External APIs] Resolving ISBN: ${isbn}`);

  // Validate ISBN format (defense-in-depth)
  if (!validateISBN(isbn)) {
    console.warn(`[External APIs] Invalid ISBN format: ${isbn}`);
    return null;
  }

  // Try ISBNdb first (paid, most reliable)
  const isbndbData = await fetchFromISBNdb(isbn, env);
  if (isbndbData) {
    console.log(`[External APIs] ✓ Resolved from ISBNdb`);
    return isbndbData;
  }

  // Fallback to Google Books (free, good coverage)
  const googleData = await fetchFromGoogleBooks(isbn, env);
  if (googleData) {
    console.log(`[External APIs] ✓ Resolved from Google Books`);
    return googleData;
  }

  // Final fallback to OpenLibrary (free, community-maintained)
  const openLibraryData = await fetchFromOpenLibrary(isbn, env);
  if (openLibraryData) {
    console.log(`[External APIs] ✓ Resolved from OpenLibrary`);
    return openLibraryData;
  }

  // All providers failed
  console.warn(`[External APIs] ✗ No data found for ISBN ${isbn}`);
  return null;
}

/**
 * Resolves multiple ISBNs in parallel with rate limiting.
 *
 * @param isbns - Array of ISBNs to resolve
 * @param env - Worker environment with API keys
 * @param maxConcurrent - Maximum concurrent requests (default: 5)
 * @returns Array of resolved book data (null for failed lookups)
 */
export async function resolveExternalBatch(
  isbns: string[],
  env: Env,
  maxConcurrent: number = 5
): Promise<Array<ExternalBookData | null>> {
  const results: Array<ExternalBookData | null> = [];

  // Process in batches to avoid rate limits
  for (let i = 0; i < isbns.length; i += maxConcurrent) {
    const batch = isbns.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(isbn => resolveExternalISBN(isbn, env))
    );
    results.push(...batchResults);
  }

  return results;
}
