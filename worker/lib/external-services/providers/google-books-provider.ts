/**
 * Google Books Service Provider
 *
 * Provides book metadata, covers, subject/category enrichment, and public domain detection
 * via Google Books API.
 *
 * Implements:
 * - IMetadataProvider: ISBN → Book metadata lookup
 * - ICoverProvider: ISBN → Cover image URL
 * - ISubjectProvider: ISBN → Categories/subjects
 * - IPublicDomainProvider: ISBN → Public domain status with download links
 *
 * Features:
 * - Free tier: 1000 requests/day
 * - KV-backed rate limiting (1 req/sec)
 * - Response caching (30-day TTL for stable metadata)
 * - Category extraction and normalization
 * - Public domain detection with downloadable full-text links
 *
 * @module lib/external-services/providers/google-books-provider
 */

import type {
  IMetadataProvider,
  ICoverProvider,
  ISubjectProvider,
  IISBNResolver,
  IPublicDomainProvider,
  IEnhancedExternalIdProvider,
  BookMetadata,
  CoverResult,
  ISBNResolutionResult,
  PublicDomainResult,
  EnhancedExternalIds,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

// =================================================================================
// Constants
// =================================================================================

const GOOGLE_BOOKS_API_BASE = 'https://www.googleapis.com/books/v1/volumes';

// =================================================================================
// Types
// =================================================================================

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
      categories?: string[];
      imageLinks?: {
        smallThumbnail?: string;
        thumbnail?: string;
      };
      industryIdentifiers?: Array<{
        type: string;
        identifier: string;
      }>;
    };
    accessInfo?: {
      accessViewStatus?: string;
      pdf?: {
        downloadLink?: string;
      };
      epub?: {
        downloadLink?: string;
      };
    };
  }>;
}

// =================================================================================
// Google Books Provider
// =================================================================================

export class GoogleBooksProvider implements IMetadataProvider, ICoverProvider, ISubjectProvider, IISBNResolver, IPublicDomainProvider, IEnhancedExternalIdProvider {
  readonly name = 'google-books';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
    ServiceCapability.SUBJECT_ENRICHMENT,
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.PUBLIC_DOMAIN,
    ServiceCapability.ENHANCED_EXTERNAL_IDS,
  ];

  private client = new ServiceHttpClient({
    providerName: 'google-books',
    rateLimitMs: 1000, // 1 req/sec (free tier: 1000 req/day)
    cacheTtlSeconds: 2592000, // 30 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(_env: Env, _quotaManager?: import("../../../src/services/quota-manager.js").QuotaManager): Promise<boolean> {
    // Optional API key improves quota, but not required
    return true;
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return null;
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]) {
      return null;
    }

    const volumeInfo = response.items[0].volumeInfo;
    return {
      title: volumeInfo.title || '',
      authors: volumeInfo.authors,
      publisher: volumeInfo.publisher,
      publishDate: volumeInfo.publishedDate,
      pageCount: volumeInfo.pageCount,
      language: volumeInfo.language,
      description: volumeInfo.description,
      subjects: volumeInfo.categories,
      coverUrl: volumeInfo.imageLinks?.thumbnail,
      externalIds: {
        googleBooksId: response.items[0].id,
      },
    };
  }

  async fetchCover(isbn: string, context: ServiceContext): Promise<CoverResult | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return null;
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]?.volumeInfo.imageLinks) {
      return null;
    }

    const thumbnail = response.items[0].volumeInfo.imageLinks.thumbnail;
    if (!thumbnail) {
      return null;
    }

    return {
      url: thumbnail.replace('http:', 'https:'), // Force HTTPS
      source: 'google-books',
      size: 'medium',
    };
  }

  async fetchSubjects(isbn: string, context: ServiceContext): Promise<string[]> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return [];
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]?.volumeInfo.categories) {
      return [];
    }

    return response.items[0].volumeInfo.categories;
  }

  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const { logger } = context;

    try {
      // Build search query: intitle:{title}+inauthor:{author}
      const query = `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
      const url = `${GOOGLE_BOOKS_API_BASE}?q=${query}&maxResults=1`;

      const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

      if (!response?.items?.[0]) {
        logger.debug('No Google Books results found', { title, author });
        return { isbn: null, confidence: 0, source: 'google-books' };
      }

      const volumeInfo = response.items[0].volumeInfo;

      // Extract ISBN-13 (prefer over ISBN-10)
      const isbn13 = volumeInfo.industryIdentifiers?.find((id) => id.type === 'ISBN_13');
      const isbn10 = volumeInfo.industryIdentifiers?.find((id) => id.type === 'ISBN_10');

      const isbnIdentifier = isbn13 || isbn10;
      if (!isbnIdentifier) {
        logger.debug('No ISBN found in Google Books result', { title, author });
        return { isbn: null, confidence: 0, source: 'google-books' };
      }

      // Normalize ISBN format
      const normalizedISBN = normalizeISBN(isbnIdentifier.identifier);
      if (!normalizedISBN) {
        logger.warn('Invalid ISBN format from Google Books', {
          title,
          author,
          rawIsbn: isbnIdentifier.identifier,
        });
        return { isbn: null, confidence: 0, source: 'google-books' };
      }

      // Calculate confidence score
      const confidence = this.calculateISBNResolutionConfidence(
        title,
        author,
        volumeInfo
      );

      logger.debug('ISBN resolved via Google Books', {
        title,
        author,
        isbn: normalizedISBN,
        confidence,
        matchedTitle: volumeInfo.title,
      });

      return {
        isbn: normalizedISBN,
        confidence,
        source: 'google-books',
      };
    } catch (error) {
      logger.error('Google Books ISBN resolution failed', {
        title,
        author,
        error: error instanceof Error ? error.message : String(error),
      });
      return { isbn: null, confidence: 0, source: 'google-books' };
    }
  }

  /**
   * Common stop words to filter from title matching
   * Reduces false positives from generic words like "the", "a", "and"
   */
  private readonly STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  ]);

  /**
   * Calculate confidence score for ISBN resolution
   *
   * Base score: 50 (API returned a result)
   * Title match: +20 if close match
   * Author match: +20 if close match
   * Has cover: +5
   * Has categories: +5
   *
   * Maximum: 100
   */
  private calculateISBNResolutionConfidence(
    queryTitle: string,
    queryAuthor: string,
    volumeInfo: GoogleBooksVolumeResponse['items'][0]['volumeInfo']
  ): number {
    let confidence = 50; // Base score

    // Title matching (+20 max)
    if (volumeInfo.title) {
      const normalizedQueryTitle = queryTitle.toLowerCase().trim();
      const normalizedResultTitle = volumeInfo.title.toLowerCase().trim();

      if (normalizedResultTitle.includes(normalizedQueryTitle) ||
          normalizedQueryTitle.includes(normalizedResultTitle)) {
        confidence += 20;
      } else {
        // Partial match (meaningful words only - filter stop words)
        const queryWords = new Set(
          normalizedQueryTitle.split(/\s+/).filter(w => !this.STOP_WORDS.has(w))
        );
        const resultWords = new Set(
          normalizedResultTitle.split(/\s+/).filter(w => !this.STOP_WORDS.has(w))
        );

        // Only match if both titles have meaningful words
        if (queryWords.size > 0 && resultWords.size > 0) {
          let matchCount = 0;
          for (const word of queryWords) {
            if (resultWords.has(word)) matchCount++;
          }
          const matchRatio = matchCount / Math.max(queryWords.size, resultWords.size);
          confidence += Math.floor(matchRatio * 20);
        }
      }
    }

    // Author matching (+20 max)
    if (volumeInfo.authors && volumeInfo.authors.length > 0) {
      const normalizedQueryAuthor = queryAuthor.toLowerCase().trim();
      const hasAuthorMatch = volumeInfo.authors.some((author) => {
        const normalizedAuthor = author.toLowerCase().trim();
        return normalizedAuthor.includes(normalizedQueryAuthor) ||
               normalizedQueryAuthor.includes(normalizedAuthor);
      });

      if (hasAuthorMatch) {
        confidence += 20;
      }
    }

    // Metadata quality bonuses
    if (volumeInfo.imageLinks?.thumbnail) confidence += 5;
    if (volumeInfo.categories && volumeInfo.categories.length > 0) confidence += 5;

    return Math.min(confidence, 100);
  }

  /**
   * Check if a book is in the public domain
   *
   * Google Books provides explicit public domain status via accessInfo.accessViewStatus.
   * When a book is marked as "FULL_PUBLIC_DOMAIN", Google offers free full-text downloads
   * in PDF and EPUB formats.
   *
   * @param isbn - ISBN-10 or ISBN-13
   * @param context - Service context with logger and env
   * @returns PublicDomainResult with download links, or null if data unavailable
   *
   * @example
   * ```typescript
   * const result = await provider.checkPublicDomain('9780486280615', context);
   * // Result for "Pride and Prejudice":
   * // {
   * //   isPublicDomain: true,
   * //   confidence: 95,
   * //   reason: 'api-verified',
   * //   downloadUrl: 'https://www.googleapis.com/download/...',
   * //   source: 'google-books'
   * // }
   * ```
   */
  async checkPublicDomain(isbn: string, context: ServiceContext): Promise<PublicDomainResult | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return null;
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]) {
      return null;
    }

    const accessInfo = response.items[0].accessInfo;
    if (!accessInfo) {
      // No access info available - unable to determine public domain status
      return null;
    }

    // Check if Google Books explicitly marks this as public domain
    const isPublicDomain = accessInfo.accessViewStatus === 'FULL_PUBLIC_DOMAIN';

    // Extract download URL (prefer PDF over EPUB)
    let downloadUrl: string | undefined;
    if (accessInfo.pdf?.downloadLink) {
      downloadUrl = accessInfo.pdf.downloadLink;
    } else if (accessInfo.epub?.downloadLink) {
      downloadUrl = accessInfo.epub.downloadLink;
    }

    context.logger.debug('Public domain status checked', {
      isbn: normalizedISBN,
      isPublicDomain,
      accessViewStatus: accessInfo.accessViewStatus,
      hasDownloadUrl: !!downloadUrl,
    });

    return {
      isPublicDomain,
      confidence: 95, // Google Books is highly reliable for US public domain status
      reason: 'api-verified', // Explicit verification from Google
      downloadUrl,
      source: 'google-books',
    };
  }

  /**
   * Fetch enhanced external IDs for a book by ISBN
   *
   * Extracts Google Books ID from the existing API response (no extra API call required).
   * This method reuses the existing ISBN lookup to avoid extra quota usage.
   *
   * @param isbn - ISBN-10 or ISBN-13
   * @param context - Service context with logger and env
   * @returns EnhancedExternalIds with Google Books ID, or null if not found
   *
   * @example
   * ```typescript
   * const result = await provider.fetchEnhancedExternalIds('9780486280615', context);
   * // Result:
   * // {
   * //   googleBooksId: 'XfFGPgAACAAJ',
   * //   sources: ['google-books'],
   * //   confidence: 85
   * // }
   * ```
   */
  async fetchEnhancedExternalIds(
    isbn: string,
    context: ServiceContext
  ): Promise<EnhancedExternalIds | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return null;
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]) {
      context.logger.debug('No Google Books external IDs found', { isbn });
      return null;
    }

    const googleBooksId = response.items[0].id;
    if (!googleBooksId) {
      context.logger.debug('Google Books response missing volume ID', { isbn });
      return null;
    }

    context.logger.debug('Fetched enhanced external IDs', {
      isbn: normalizedISBN,
      googleBooksId,
    });

    return {
      googleBooksId,
      sources: ['google-books'],
      confidence: 85, // Google Books has good data quality
    };
  }
}
