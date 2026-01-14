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
 * - IRatingsProvider: ISBN → User ratings (average + count)
 * - IEditionVariantProvider: ISBN → Format variants (hardcover, paperback, ebook, etc.)
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
  IRatingsProvider,
  IEditionVariantProvider,
  ISBNResolutionResult,
  BookMetadata,
  CoverResult,
  RatingsResult,
  EditionVariant,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import type { QuotaManager } from '../../../src/services/quota-manager.js';
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
    rating_avg?: number; // Average rating (0.0-5.0)
    rating_count?: number; // Number of ratings
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

export class ISBNdbProvider implements IISBNResolver, IMetadataProvider, ICoverProvider, IRatingsProvider, IEditionVariantProvider {
  readonly name = 'isbndb';
  readonly providerType = 'paid' as const;
  readonly capabilities = [
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
    ServiceCapability.RATINGS,
    ServiceCapability.EDITION_VARIANTS,
  ];

  private client = new ServiceHttpClient({
    providerName: 'isbndb',
    rateLimitMs: 333, // 3 req/sec (Premium plan)
    cacheTtlSeconds: 2592000, // 30 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(env: Env, quotaManager?: QuotaManager): Promise<boolean> {
    // Check if API key exists
    const apiKey = await env.ISBNDB_API_KEY?.get();
    if (!apiKey) {
      return false;
    }

    // Circuit Breaker: Check quota availability before operations
    // Prevents orchestrator from attempting ISBNdb calls when quota exhausted
    if (quotaManager) {
      const quotaCheck = await quotaManager.checkQuota(1, false);
      if (!quotaCheck.allowed) {
        // Quota exhausted - return false to skip this provider
        return false;
      }
    }

    return true;
  }

  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const { logger, env, quotaManager } = context;

    try {
      // Check quota before making API call (blocking logic)
      if (quotaManager) {
        const quotaCheck = await quotaManager.checkQuota(1, false);
        if (!quotaCheck.allowed) {
          logger.warn('ISBNdb quota exhausted, skipping ISBN resolution', {
            title,
            author,
            reason: quotaCheck.reason,
            quota_status: quotaCheck.status,
          });
          return { isbn: null, confidence: 0, source: 'isbndb' };
        }
      }

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

      // Record API call after HTTP request completes (metering logic)
      // IMPORTANT: ISBNdb counts ALL requests (including 403/500 errors) against quota
      if (quotaManager) {
        await quotaManager.recordApiCall(1);
        logger.debug('ISBNdb quota recorded', { calls: 1, success: !!response });
      }

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
    const { logger, env, quotaManager } = context;

    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      logger.debug('Invalid ISBN format, skipping ISBNdb API call', { isbn });
      return null;
    }

    try {
      // Check quota before making API call (blocking logic)
      if (quotaManager) {
        const quotaCheck = await quotaManager.checkQuota(1, false);
        if (!quotaCheck.allowed) {
          logger.warn('ISBNdb quota exhausted, skipping metadata fetch', {
            isbn,
            reason: quotaCheck.reason,
          });
          return null;
        }
      }

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

      // Record API call after HTTP request completes (metering logic)
      // IMPORTANT: ISBNdb counts ALL requests (including 403/500 errors) against quota
      if (quotaManager) {
        await quotaManager.recordApiCall(1);
        logger.debug('ISBNdb quota recorded', { calls: 1, success: !!response });
      }

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
    const { logger, env, quotaManager } = context;
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
      // Check quota before making batch API call (blocking logic)
      // Note: Batch API call counts as 1 API call regardless of ISBN count
      if (quotaManager) {
        const quotaCheck = await quotaManager.checkQuota(1, false);
        if (!quotaCheck.allowed) {
          logger.warn('ISBNdb quota exhausted, skipping batch metadata fetch', {
            isbn_count: isbns.length,
            reason: quotaCheck.reason,
          });
          return results;
        }
      }

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

      // Record API call after HTTP request completes (metering logic)
      // IMPORTANT: ISBNdb counts ALL requests (including 403/500 errors) against quota
      // Batch call counts as 1 API call (ISBNdb Premium feature)
      if (quotaManager) {
        await quotaManager.recordApiCall(1);
        logger.debug('ISBNdb quota recorded for batch call', { calls: 1, isbn_count: truncatedIsbns.length, success: !!response });
      }

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

  /**
   * Fetch ratings for a single ISBN
   * Extracts rating_avg and rating_count from ISBNdb API response
   *
   * IMPORTANT: Reuses the same API call as fetchMetadata to avoid wasting quota
   */
  async fetchRatings(isbn: string, context: ServiceContext): Promise<RatingsResult | null> {
    const { logger, quotaManager } = context;

    try {
      // Validate ISBN format before making API call
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format, skipping ISBNdb API call', { isbn });
        return null;
      }

      // Check quota before making API call (blocking logic)
      if (quotaManager) {
        const quotaCheck = await quotaManager.checkQuota(1, false);
        if (!quotaCheck.allowed) {
          logger.warn('ISBNdb quota exhausted, skipping ratings fetch', {
            isbn,
            reason: quotaCheck.reason,
          });
          return null;
        }
      }

      const apiKey = await context.env.ISBNDB_API_KEY.get();
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

      // Record API call after HTTP request completes (metering logic)
      // IMPORTANT: ISBNdb counts ALL requests (including 403/500 errors) against quota
      if (quotaManager) {
        await quotaManager.recordApiCall(1);
        logger.debug('ISBNdb quota recorded', { calls: 1, success: !!response });
      }

      if (!response?.book) {
        return null;
      }

      const book = response.book;

      // Check if rating data is available
      if (book.rating_avg === undefined || book.rating_count === undefined) {
        logger.debug('No rating data available from ISBNdb', { isbn });
        return null;
      }

      // ISBNdb is authoritative, so high confidence (90)
      return {
        averageRating: book.rating_avg,
        ratingsCount: book.rating_count,
        source: 'isbndb',
        confidence: 90,
      };
    } catch (error) {
      logger.error('ISBNdb ratings fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Batch fetch ratings for multiple ISBNs
   * Leverages existing batchFetchMetadata to extract rating fields
   */
  async batchFetchRatings(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, RatingsResult>> {
    const { logger, env, quotaManager } = context;
    const results = new Map<string, RatingsResult>();

    if (isbns.length === 0) {
      return results;
    }

    // Validate and normalize ISBNs
    const validIsbns = isbns
      .map(isbn => normalizeISBN(isbn))
      .filter((isbn): isbn is string => isbn !== null);

    if (validIsbns.length === 0) {
      logger.debug('No valid ISBNs in batch for ratings fetch');
      return results;
    }

    // Enforce batch limit (avoid mutating input)
    const truncatedIsbns = validIsbns.length > 1000 ? validIsbns.slice(0, 1000) : validIsbns;
    if (validIsbns.length > 1000) {
      logger.warn('ISBNdb ratings batch size exceeds 1000, truncating', {
        requested: validIsbns.length,
        processing: truncatedIsbns.length,
      });
    }

    try {
      // Check quota before making batch API call (blocking logic)
      if (quotaManager) {
        const quotaCheck = await quotaManager.checkQuota(1, false);
        if (!quotaCheck.allowed) {
          logger.warn('ISBNdb quota exhausted, skipping batch ratings fetch', {
            isbn_count: isbns.length,
            reason: quotaCheck.reason,
          });
          return results;
        }
      }

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

      // Record API call after HTTP request completes (metering logic)
      // IMPORTANT: ISBNdb counts ALL requests (including 403/500 errors) against quota
      if (quotaManager) {
        await quotaManager.recordApiCall(1);
        logger.debug('ISBNdb quota recorded for batch ratings', { calls: 1, isbn_count: truncatedIsbns.length, success: !!response });
      }

      if (!response?.data) {
        return results;
      }

      // Extract ratings from batch response
      for (const book of response.data) {
        const isbn = book.isbn13 || book.isbn;

        // Only include books with rating data
        if (book.rating_avg !== undefined && book.rating_count !== undefined) {
          results.set(isbn, {
            averageRating: book.rating_avg,
            ratingsCount: book.rating_count,
            source: 'isbndb',
            confidence: 90,
          });
        }
      }

      logger.info('ISBNdb batch ratings fetch complete', {
        requested: isbns.length,
        retrieved: results.size,
      });

      return results;
    } catch (error) {
      logger.error('ISBNdb batch ratings fetch failed', {
        count: isbns.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return results;
    }
  }

  /**
   * Fetch edition variants (format editions) for an ISBN
   * Extracts from ISBNdb's 'related' field which contains format variants
   */
  async fetchEditionVariants(isbn: string, context: ServiceContext): Promise<EditionVariant[]> {
    const { logger, quotaManager } = context;

    try {
      // Reuse metadata fetch to get related ISBNs
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format for edition variants fetch', { isbn });
        return [];
      }

      // Check quota before making API call (blocking logic)
      if (quotaManager) {
        const quotaCheck = await quotaManager.checkQuota(1, false);
        if (!quotaCheck.allowed) {
          logger.warn('ISBNdb quota exhausted, skipping edition variants fetch', {
            isbn,
            reason: quotaCheck.reason,
          });
          return [];
        }
      }

      const apiKey = await context.env.ISBNDB_API_KEY.get();
      if (!apiKey) {
        logger.error('ISBNdb API key not configured');
        return [];
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

      // Record API call after HTTP request completes (metering logic)
      // IMPORTANT: ISBNdb counts ALL requests (including 403/500 errors) against quota
      if (quotaManager) {
        await quotaManager.recordApiCall(1);
        logger.debug('ISBNdb quota recorded', { calls: 1, success: !!response });
      }

      if (!response?.book) {
        return [];
      }

      const book = response.book;

      // Check if related ISBNs exist
      if (!book.related || Object.keys(book.related).length === 0) {
        logger.debug('No edition variants available from ISBNdb', { isbn });
        return [];
      }

      // Map ISBNdb binding types to our format enum
      const variants: EditionVariant[] = [];
      for (const [relatedIsbn, bindingType] of Object.entries(book.related)) {
        variants.push({
          isbn: relatedIsbn,
          format: this.normalizeBindingType(bindingType),
          formatDescription: bindingType,
          source: 'isbndb',
        });
      }

      logger.info('ISBNdb edition variants fetched', {
        isbn,
        variantCount: variants.length,
      });

      return variants;
    } catch (error) {
      logger.error('ISBNdb edition variants fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Normalize ISBNdb binding types to our EditionVariant format enum
   */
  private normalizeBindingType(bindingType: string): EditionVariant['format'] {
    const normalized = bindingType.toLowerCase().trim();

    // Map common ISBNdb binding types
    if (normalized.includes('hardcover') || normalized.includes('hard cover')) {
      return 'hardcover';
    }
    if (normalized.includes('paperback') || normalized.includes('paper back')) {
      return 'paperback';
    }
    if (normalized.includes('mass market') || normalized.includes('mass-market')) {
      return 'mass-market';
    }
    if (normalized.includes('ebook') || normalized.includes('e-book') || normalized.includes('epub') || normalized.includes('kindle')) {
      return 'ebook';
    }
    if (normalized.includes('audiobook') || normalized.includes('audio book') || normalized.includes('audio cd')) {
      return 'audiobook';
    }
    if (normalized.includes('library') || normalized.includes('library binding')) {
      return 'library-binding';
    }

    // Default to 'other' for unknown types
    return 'other';
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
