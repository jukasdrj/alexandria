/**
 * Cover Image Fetcher Service
 *
 * Fetches cover image URLs from multiple providers with fallback chain:
 * 1. ISBNdb (highest quality, paid API)
 * 2. Google Books (good quality, free with API key)
 * 3. OpenLibrary (free, reliable)
 *
 * @module services/cover-fetcher
 */

import { fetchWithRetry } from '../lib/fetch-utils.js';
import type { Env } from '../src/env.js';

const PLACEHOLDER_COVER = 'https://placehold.co/300x450/e0e0e0/666666?text=No+Cover';

// Rate limiting: ISBNdb Premium allows 3 requests/second
const ISBNDB_RATE_LIMIT_MS = 350; // 350ms = ~3 req/sec with safety margin
const RATE_LIMIT_KV_KEY = 'cover_fetcher:isbndb_last_request';

/**
 * Cover URL result from providers
 */
export interface CoverResult {
  url: string;
  source: 'isbndb' | 'google-books' | 'openlibrary' | 'placeholder';
  quality: 'original' | 'high' | 'medium' | 'low' | 'missing';
  error?: string;
}

/**
 * ISBNdb batch book response
 */
interface ISBNdbBook {
  isbn?: string;
  isbn13?: string;
  image?: string;
  image_original?: string;
}

/**
 * ISBNdb batch API response
 */
interface ISBNdbBatchResponse {
  books?: ISBNdbBook[];
}

/**
 * Google Books API response
 */
interface GoogleBooksVolume {
  volumeInfo?: {
    imageLinks?: {
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
      extraLarge?: string;
    };
  };
}

interface GoogleBooksResponse {
  items?: GoogleBooksVolume[];
}

/**
 * Normalize ISBN to 13-digit format (remove hyphens, validate)
 * @param isbn - ISBN-10 or ISBN-13
 * @returns Normalized ISBN or null if invalid
 */
export function normalizeISBN(isbn: string): string | null {
  if (!isbn) return null;

  // Remove hyphens and spaces
  const cleaned = isbn.replace(/[-\s]/g, '').toUpperCase();

  // Validate length (10 or 13 digits, ISBN-10 can end with X)
  if (cleaned.length === 10) {
    if (!/^[0-9]{9}[0-9X]$/.test(cleaned)) return null;
    return cleaned;
  }

  if (cleaned.length === 13) {
    if (!/^[0-9]{13}$/.test(cleaned)) return null;
    return cleaned;
  }

  return null;
}

/**
 * Enforce rate limit for ISBNdb API using KV storage
 * Note: Uses KV for distributed rate limiting across Worker isolates
 * Falls back to in-memory if KV not available (dev mode)
 * @param env - Worker environment (optional, for KV access)
 */
async function enforceISBNdbRateLimit(env?: Env): Promise<void> {
  const now = Date.now();

  // Try KV-based rate limiting if available
  if (env?.CACHE) {
    try {
      const lastRequestStr = await env.CACHE.get(RATE_LIMIT_KV_KEY);
      const lastRequest = lastRequestStr ? parseInt(lastRequestStr) : 0;
      const timeSinceLastRequest = now - lastRequest;

      if (timeSinceLastRequest < ISBNDB_RATE_LIMIT_MS) {
        const waitTime = ISBNDB_RATE_LIMIT_MS - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Update KV with current timestamp (60s TTL)
      await env.CACHE.put(RATE_LIMIT_KV_KEY, Date.now().toString(), { expirationTtl: 60 });
      return;
    } catch (error) {
      console.warn('KV rate limiting unavailable, proceeding without:', (error as Error).message);
    }
  }

  // Fallback: proceed without rate limiting (log warning)
  console.warn('ISBNdb rate limiting not enforced - CACHE KV not available');
}

/**
 * Fetch cover URL from ISBNdb API
 * @param isbn - ISBN to lookup
 * @param env - Worker environment with ISBNDB_API_KEY
 * @returns Cover result or null if not found
 */
export async function fetchISBNdbCover(isbn: string, env: Env): Promise<CoverResult | null> {
  const normalizedISBN = normalizeISBN(isbn);
  if (!normalizedISBN) return null;

  try {
    // Get API key from Secrets Store (async)
    const apiKey = await env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      console.error('ISBNdb API key not configured');
      return null;
    }

    // Enforce rate limit (uses KV if available)
    await enforceISBNdbRateLimit(env);

    // Use Premium endpoint for 3x rate limit
    const response = await fetchWithRetry(`https://api.premium.isbndb.com/book/${normalizedISBN}`, {
      headers: {
        'Authorization': apiKey,
        'User-Agent': 'Alexandria/1.0 (covers)'
      }
    }, { timeoutMs: 10000, maxRetries: 2 });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`ISBNdb: Book not found for ISBN ${normalizedISBN}`);
        return null;
      }
      if (response.status === 429) {
        console.warn('ISBNdb: Rate limited');
        return null;
      }
      console.error(`ISBNdb: API error ${response.status}`);
      return null;
    }

    const data = await response.json() as { book?: ISBNdbBook };
    const imageUrl = data?.book?.image;

    if (!imageUrl) {
      console.log(`ISBNdb: No image for ISBN ${normalizedISBN}`);
      return null;
    }

    return {
      url: imageUrl,
      source: 'isbndb',
      quality: 'high'
    };

  } catch (error) {
    console.error('ISBNdb fetch error:', (error as Error).message);
    return null;
  }
}

/**
 * Fetch cover URLs from ISBNdb in batch (up to 1000 ISBNs on Premium plan)
 * @param isbns - ISBNs to lookup (max 1000)
 * @param env - Worker environment with ISBNDB_API_KEY
 * @returns Map of ISBN to cover result
 */
export async function fetchISBNdbCoversBatch(
  isbns: string[],
  env: Env
): Promise<Map<string, CoverResult>> {
  if (!isbns || isbns.length === 0) return new Map();

  // Enforce batch limit (ISBNdb Premium plan: 1000 ISBNs max)
  if (isbns.length > 1000) {
    console.warn(`ISBNdb batch limit exceeded: ${isbns.length} ISBNs (max 1000)`);
    isbns = isbns.slice(0, 1000);
  }

  try {
    const apiKey = await env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      console.error('ISBNdb API key not configured');
      return new Map();
    }

    // Enforce rate limit (3 req/sec on Premium)
    await enforceISBNdbRateLimit(env);

    // Use Premium endpoint
    const response = await fetchWithRetry('https://api.premium.isbndb.com/books', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `isbns=${isbns.join(',')}`,
    }, { timeoutMs: 15000, maxRetries: 2 });

    if (!response || !response.ok) {
      console.error(`ISBNdb batch fetch failed: ${response?.status}`);
      return new Map();
    }

    const { books } = await response.json() as ISBNdbBatchResponse;
    const results = new Map<string, CoverResult>();

    if (books && Array.isArray(books)) {
      books.forEach(book => {
        const isbn = book.isbn13 || book.isbn;
        if (isbn && (book.image_original || book.image)) {
          results.set(isbn, {
            url: book.image_original || book.image,
            source: 'isbndb',
            quality: book.image_original ? 'original' : 'high',
          });
        }
      });
    }

    console.log(`[ISBNdb Batch] Fetched ${results.size}/${isbns.length} cover URLs`);
    return results;
  } catch (error) {
    console.error('ISBNdb batch fetch error:', (error as Error).message);
    return new Map();
  }
}

/**
 * Fetch cover URL from Google Books API
 * @param isbn - ISBN to lookup
 * @param env - Worker environment with GOOGLE_BOOKS_API_KEY
 * @returns Cover result or null if not found
 */
export async function fetchGoogleBooksCover(isbn: string, env: Env): Promise<CoverResult | null> {
  const normalizedISBN = normalizeISBN(isbn);
  if (!normalizedISBN) return null;

  try {
    // Get API key from Secrets Store (async) - optional but increases quota
    let apiKey: string | null = null;
    try {
      apiKey = await env.GOOGLE_BOOKS_API_KEY.get();
    } catch (e) {
      console.warn('Google Books API key not available, proceeding without');
    }

    // Build URL - API key is optional but increases quota
    let url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${normalizedISBN}`;
    if (apiKey) {
      url += `&key=${apiKey}`;
    }

    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Alexandria/1.0 (covers)'
      }
    }, { timeoutMs: 10000, maxRetries: 2 });

    if (!response.ok) {
      console.error(`Google Books: API error ${response.status}`);
      return null;
    }

    const data = await response.json() as GoogleBooksResponse;

    if (!data.items || data.items.length === 0) {
      console.log(`Google Books: No results for ISBN ${normalizedISBN}`);
      return null;
    }

    const imageLinks = data.items[0]?.volumeInfo?.imageLinks;
    if (!imageLinks) {
      console.log(`Google Books: No image links for ISBN ${normalizedISBN}`);
      return null;
    }

    // Prefer larger images, add zoom=3 for highest quality
    let imageUrl = imageLinks.extraLarge || imageLinks.large || imageLinks.medium || imageLinks.thumbnail;

    if (!imageUrl) return null;

    // Upgrade to HTTPS and request high-res version
    imageUrl = imageUrl.replace('http:', 'https:');
    imageUrl = imageUrl.replace(/&zoom=\d/, '') + '&zoom=3';

    // Determine quality based on available size
    let quality: 'high' | 'medium' | 'low' = 'low';
    if (imageLinks.extraLarge || imageLinks.large) {
      quality = 'high';
    } else if (imageLinks.medium) {
      quality = 'medium';
    }

    return {
      url: imageUrl,
      source: 'google-books',
      quality
    };

  } catch (error) {
    console.error('Google Books fetch error:', (error as Error).message);
    return null;
  }
}

/**
 * Fetch cover URL from OpenLibrary
 * @param isbn - ISBN to lookup
 * @returns Cover result or null if not found
 */
export async function fetchOpenLibraryCover(isbn: string): Promise<CoverResult | null> {
  const normalizedISBN = normalizeISBN(isbn);
  if (!normalizedISBN) return null;

  try {
    // OpenLibrary covers API - check if image exists
    // Using -L suffix for large size (800x1200)
    const coverUrl = `https://covers.openlibrary.org/b/isbn/${normalizedISBN}-L.jpg`;

    // Do a HEAD request to verify the image exists
    const response = await fetchWithRetry(coverUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Alexandria/1.0 (covers)'
      }
    }, { timeoutMs: 10000, maxRetries: 2 });

    // OpenLibrary returns a 1x1 pixel placeholder for missing covers
    // Check content-length to detect this
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) < 1000) {
      console.log(`OpenLibrary: No cover for ISBN ${normalizedISBN} (placeholder detected)`);
      return null;
    }

    if (!response.ok) {
      console.log(`OpenLibrary: No cover for ISBN ${normalizedISBN}`);
      return null;
    }

    return {
      url: coverUrl,
      source: 'openlibrary',
      quality: 'medium'
    };

  } catch (error) {
    console.error('OpenLibrary fetch error:', (error as Error).message);
    return null;
  }
}

/**
 * Fetch best available cover from all providers (fallback chain)
 * @param isbn - ISBN to lookup
 * @param env - Worker environment
 * @returns Cover result (placeholder if not found)
 */
export async function fetchBestCover(isbn: string, env: Env): Promise<CoverResult> {
  const normalizedISBN = normalizeISBN(isbn);
  if (!normalizedISBN) {
    return {
      url: PLACEHOLDER_COVER,
      source: 'placeholder',
      quality: 'missing',
      error: 'Invalid ISBN'
    };
  }

  // Try ISBNdb first (highest quality)
  let cover = await fetchISBNdbCover(normalizedISBN, env);
  if (cover?.url) {
    console.log(`Cover found via ISBNdb for ${normalizedISBN}`);
    return cover;
  }

  // Fallback to Google Books
  cover = await fetchGoogleBooksCover(normalizedISBN, env);
  if (cover?.url) {
    console.log(`Cover found via Google Books for ${normalizedISBN}`);
    return cover;
  }

  // Fallback to OpenLibrary
  cover = await fetchOpenLibraryCover(normalizedISBN);
  if (cover?.url) {
    console.log(`Cover found via OpenLibrary for ${normalizedISBN}`);
    return cover;
  }

  // No cover found anywhere
  console.log(`No cover found for ${normalizedISBN} from any provider`);
  return {
    url: PLACEHOLDER_COVER,
    source: 'placeholder',
    quality: 'missing'
  };
}

/**
 * Get placeholder cover URL
 * @returns Placeholder cover URL
 */
export function getPlaceholderCover(): string {
  return PLACEHOLDER_COVER;
}
