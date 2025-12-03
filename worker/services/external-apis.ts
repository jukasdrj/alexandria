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

import type { Env } from '../env.d.js';

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
  };
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
    const apiKey = await env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      console.warn('ISBNdb API key not configured');
      return null;
    }

    const url = `https://api2.isbndb.com/book/${isbn}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`ISBNdb returned ${response.status} for ${isbn}`);
      return null;
    }

    const data: ISBNdbResponse = await response.json();
    const book = data.book;

    if (!book || !book.title) {
      return null;
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
      coverUrls: book.image ? {
        large: book.image,
        medium: book.image,
        small: book.image,
      } : undefined,
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
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Google Books returned ${response.status} for ${isbn}`);
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

    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      console.warn(`OpenLibrary returned ${response.status} for ${isbn}`);
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
