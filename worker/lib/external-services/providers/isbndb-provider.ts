/**
 * ISBNdb Service Provider (Premium Plan)
 *
 * Provides ISBN resolution and comprehensive book metadata via ISBNdb Premium API.
 * This is Alexandria's primary paid service with quota management.
 *
 * Implements:
 * - IISBNResolver: Title/author → ISBN search
 * - IMetadataProvider: ISBN → Book metadata (with batch support)
 * - ICoverProvider: ISBN → Cover image URL
 *
 * Premium Plan Features:
 * - 1000 results per batch call
 * - 3 requests per second
 * - 15,000 daily searches (~13,000 after 2K buffer)
 * - Premium endpoint: api.premium.isbndb.com
 *
 * @module lib/external-services/providers/isbndb-provider
 */

import type {
  IISBNResolver,
  IMetadataProvider,
  ICoverProvider,
  ISBNResolutionResult,
  BookMetadata,
  CoverResult,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

// =================================================================================
// Constants
// =================================================================================

const ISBNDB_API_BASE = 'https://api.premium.isbndb.com';

// =================================================================================
// Types
// =================================================================================

interface ISBNdbBatchResponse {
  total: number;
  requested: number;
  data: Array<{
    isbn: string;
    isbn13?: string;
    title: string;
    title_long?: string;
    authors?: string[];
    publisher?: string;
    date_published?: string;
    pages?: number;
    language?: string;
    synopsis?: string;
    image?: string;
    subjects?: string[];
    dewey_decimal?: string[];
    binding?: string;
    related?: Record<string, string>; // Related ISBNs (epub, audiobook, etc.)
  }>;
}

interface ISBNdbSearchResponse {
  total: number;
  books: Array<{
    isbn: string;
    isbn13?: string;
    title: string;
    title_long?: string;
    authors?: string[];
    publisher?: string;
    date_published?: string;
  }>;
}

// =================================================================================
// ISBNdb Provider
// =================================================================================

export class ISBNdbProvider implements IISBNResolver, IMetadataProvider, ICoverProvider {
  readonly name = 'isbndb';
  readonly providerType = 'paid' as const;
  readonly capabilities = [
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
  ];

  private client = new ServiceHttpClient({
    providerName: 'isbndb',
    rateLimitMs: 333, // 3 req/sec (Premium plan)
    cacheTtlSeconds: 2592000, // 30 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(env: Env): Promise<boolean> {
    // Check if API key exists and quota is available
    const apiKey = await env.ISBNDB_API_KEY?.get();
    if (!apiKey) {
      return false;
    }

    // Check quota if quotaManager provided in context
    // Note: This is a simplified check - full implementation would check quota
    return true;
  }

  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const { logger, env } = context;

    try {
      const apiKey = await env.ISBNDB_API_KEY.get();
      if (!apiKey) {
        logger.error('ISBNdb API key not configured');
        return { isbn: null, confidence: 0, source: 'isbndb' };
      }

      // Build search query
      const query = `${title} ${author}`;
      const url = `${ISBNDB_API_BASE}/books/${encodeURIComponent(query)}`;

      const response = await this.client.fetch<ISBNdbSearchResponse>(
        url,
        {
          headers: {
            Authorization: apiKey,
          },
        },
        context
      );

      if (!response?.books?.[0]) {
        return { isbn: null, confidence: 0, source: 'isbndb' };
      }

      const book = response.books[0];
      const isbn = book.isbn13 || book.isbn;

      // Calculate confidence based on title/author match
      const confidence = this.calculateConfidence(book, title, author);

      logger.info('ISBN resolved via ISBNdb', {
        title,
        author,
        isbn,
        confidence,
      });

      return {
        isbn,
        confidence,
        source: 'isbndb',
      };
    } catch (error) {
      logger.error('ISBNdb ISBN resolution failed', {
        title,
        author,
        error: error instanceof Error ? error.message : String(error),
      });
      return { isbn: null, confidence: 0, source: 'isbndb' };
    }
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    const { logger, env } = context;

    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      logger.debug('Invalid ISBN format, skipping ISBNdb API call', { isbn });
      return null;
    }

    try {
      const apiKey = await env.ISBNDB_API_KEY.get();
      if (!apiKey) {
        logger.error('ISBNdb API key not configured');
        return null;
      }

      const url = `${ISBNDB_API_BASE}/book/${normalizedISBN}`;

      const response = await this.client.fetch<{ book: ISBNdbBatchResponse['data'][0] }>(
        url,
        {
          headers: {
            Authorization: apiKey,
          },
        },
        context
      );

      if (!response?.book) {
        return null;
      }

      const book = response.book;
      return {
        isbn: book.isbn,
        isbn13: book.isbn13,
        title: book.title_long || book.title,
        authors: book.authors,
        publisher: book.publisher,
        publishDate: book.date_published,
        pageCount: book.pages,
        language: book.language,
        description: book.synopsis,
        subjects: book.subjects,
        coverUrl: book.image,
      };
    } catch (error) {
      logger.error('ISBNdb metadata fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Batch fetch metadata for multiple ISBNs (Premium feature)
   * Up to 1000 ISBNs per call
   */
  async batchFetchMetadata(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, BookMetadata>> {
    const { logger, env } = context;
    const results = new Map<string, BookMetadata>();

    if (isbns.length === 0) {
      return results;
    }

    // Validate and normalize ISBNs before API call
    const validIsbns = isbns
      .map(isbn => normalizeISBN(isbn))
      .filter((isbn): isbn is string => isbn !== null);

    if (validIsbns.length === 0) {
      logger.debug('No valid ISBNs in batch, skipping ISBNdb API call');
      return results;
    }

    // Enforce batch limit (avoid mutating input parameter)
    const truncatedIsbns = validIsbns.length > 1000 ? validIsbns.slice(0, 1000) : validIsbns;
    if (validIsbns.length > 1000) {
      logger.warn('ISBNdb batch size exceeds 1000, truncating', {
        requested: validIsbns.length,
        processing: truncatedIsbns.length,
      });
    }

    try {
      const apiKey = await env.ISBNDB_API_KEY.get();
      if (!apiKey) {
        logger.error('ISBNdb API key not configured');
        return results;
      }

      const url = `${ISBNDB_API_BASE}/books`;

      const response = await this.client.fetch<ISBNdbBatchResponse>(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ isbns: truncatedIsbns }),
        },
        context
      );

      if (!response?.data) {
        return results;
      }

      // Convert to map
      for (const book of response.data) {
        const isbn = book.isbn13 || book.isbn;
        results.set(isbn, {
          isbn: book.isbn,
          isbn13: book.isbn13,
          title: book.title_long || book.title,
          authors: book.authors,
          publisher: book.publisher,
          publishDate: book.date_published,
          pageCount: book.pages,
          language: book.language,
          description: book.synopsis,
          subjects: book.subjects,
          coverUrl: book.image,
          // ISBNdb-specific fields (now part of BookMetadata interface)
          deweyDecimal: book.dewey_decimal,
          binding: book.binding,
          relatedISBNs: book.related,
        });
      }

      logger.info('ISBNdb batch fetch complete', {
        requested: isbns.length,
        retrieved: results.size,
      });

      return results;
    } catch (error) {
      logger.error('ISBNdb batch fetch failed', {
        count: isbns.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return results;
    }
  }

  async fetchCover(isbn: string, context: ServiceContext): Promise<CoverResult | null> {
    // ISBNdb includes cover URL in metadata, so we can fetch it from there
    const metadata = await this.fetchMetadata(isbn, context);

    if (!metadata?.coverUrl) {
      return null;
    }

    return {
      url: metadata.coverUrl,
      source: 'isbndb',
      size: 'large',
    };
  }

  private calculateConfidence(
    book: ISBNdbSearchResponse['books'][0],
    searchTitle: string,
    searchAuthor: string
  ): number {
    let confidence = 60; // Base confidence

    // Title match
    const titleMatch = book.title.toLowerCase().includes(searchTitle.toLowerCase());
    if (titleMatch) confidence += 20;

    // Author match
    const authorMatch = book.authors?.some((a) =>
      a.toLowerCase().includes(searchAuthor.toLowerCase())
    );
    if (authorMatch) confidence += 20;

    return Math.min(confidence, 100);
  }
}
