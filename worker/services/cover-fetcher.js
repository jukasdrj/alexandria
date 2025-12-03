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

const PLACEHOLDER_COVER = 'https://placehold.co/300x450/e0e0e0/666666?text=No+Cover';

// Rate limiting: ISBNdb allows 1 request/second on paid plan
const ISBNDB_RATE_LIMIT_MS = 1000;
const RATE_LIMIT_KV_KEY = 'cover_fetcher:isbndb_last_request';

/**
 * Normalize ISBN to 13-digit format (remove hyphens, validate)
 * @param {string} isbn - ISBN-10 or ISBN-13
 * @returns {string|null} Normalized ISBN or null if invalid
 */
export function normalizeISBN(isbn) {
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
 * @param {object} env - Worker environment (optional, for KV access)
 * @returns {Promise<void>}
 */
async function enforceISBNdbRateLimit(env) {
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
      console.warn('KV rate limiting unavailable, proceeding without:', error.message);
    }
  }

  // Fallback: proceed without rate limiting (log warning)
  console.warn('ISBNdb rate limiting not enforced - CACHE KV not available');
}

/**
 * Fetch cover URL from ISBNdb API
 * @param {string} isbn - ISBN to lookup
 * @param {object} env - Worker environment with ISBNDB_API_KEY
 * @returns {Promise<{url: string, source: string, quality: string}|null>}
 */
export async function fetchISBNdbCover(isbn, env) {
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

    const response = await fetchWithRetry(`https://api2.isbndb.com/book/${normalizedISBN}`, {
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

    const data = await response.json();
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
    console.error('ISBNdb fetch error:', error.message);
    return null;
  }
}

/**
 * Fetch cover URL from Google Books API
 * @param {string} isbn - ISBN to lookup
 * @param {object} env - Worker environment with GOOGLE_BOOKS_API_KEY
 * @returns {Promise<{url: string, source: string, quality: string}|null>}
 */
export async function fetchGoogleBooksCover(isbn, env) {
  const normalizedISBN = normalizeISBN(isbn);
  if (!normalizedISBN) return null;

  try {
    // Get API key from Secrets Store (async) - optional but increases quota
    let apiKey = null;
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

    const data = await response.json();

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
    let quality = 'low';
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
    console.error('Google Books fetch error:', error.message);
    return null;
  }
}

/**
 * Fetch cover URL from OpenLibrary
 * @param {string} isbn - ISBN to lookup
 * @returns {Promise<{url: string, source: string, quality: string}|null>}
 */
export async function fetchOpenLibraryCover(isbn) {
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
    console.error('OpenLibrary fetch error:', error.message);
    return null;
  }
}

/**
 * Fetch best available cover from all providers (fallback chain)
 * @param {string} isbn - ISBN to lookup
 * @param {object} env - Worker environment
 * @returns {Promise<{url: string, source: string, quality: string}>}
 */
export async function fetchBestCover(isbn, env) {
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
 * @returns {string}
 */
export function getPlaceholderCover() {
  return PLACEHOLDER_COVER;
}
