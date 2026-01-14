/**
 * Archive.org Service Provider
 *
 * Fetches cover images and book metadata from Archive.org's digital library.
 * Excellent for pre-2000 books and historical texts.
 *
 * Implements:
 * - ICoverProvider: ISBN → Cover image URL
 * - IMetadataProvider: ISBN → Book metadata
 * - IPublicDomainProvider: ISBN → Public domain status (date-based heuristic)
 *
 * Features:
 * - Free, respectful rate limiting (1 req/sec)
 * - Response caching (7-day TTL)
 * - Cover quality detection
 * - Metadata enrichment (descriptions, subjects)
 * - Public domain detection via publication date heuristic
 *
 * @module lib/external-services/providers/archive-org-provider
 */

import type {
  IMetadataProvider,
  ICoverProvider,
  IISBNResolver,
  IPublicDomainProvider,
  BookMetadata,
  CoverResult,
  ISBNResolutionResult,
  PublicDomainResult,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

// =================================================================================
// Constants
// =================================================================================

const ARCHIVE_ORG_SEARCH_API = 'https://archive.org/advancedsearch.php';
const ARCHIVE_ORG_IMAGE_SERVICE = 'https://archive.org/services/img';

// =================================================================================
// Types
// =================================================================================

interface ArchiveOrgSearchResponse {
  response: {
    numFound: number;
    docs: Array<{
      identifier: string;
      title?: string;
      creator?: string | string[];
      publisher?: string | string[];
      date?: string;
      description?: string | string[];
      subject?: string | string[];
      isbn?: string[];
    }>;
  };
}

// =================================================================================
// Archive.org Provider
// =================================================================================

export class ArchiveOrgProvider implements ICoverProvider, IMetadataProvider, IISBNResolver, IPublicDomainProvider {
  readonly name = 'archive.org';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.COVER_IMAGES,
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.PUBLIC_DOMAIN,
  ];

  private client = new ServiceHttpClient({
    providerName: 'archive.org',
    rateLimitMs: 1000, // 1 req/sec (respectful)
    cacheTtlSeconds: 604800, // 7 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(_env: Env, _quotaManager?: import("../../../src/services/quota-manager.js").QuotaManager): Promise<boolean> {
    return true; // Free service, always available
  }

  async fetchCover(isbn: string, context: ServiceContext): Promise<CoverResult | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Archive.org API call', { isbn });
      return null;
    }

    // First, find the Archive.org identifier for this ISBN
    const identifier = await this.findIdentifier(normalizedISBN, context);
    if (!identifier) {
      return null;
    }

    // Use Archive.org Image Service for cover
    const coverUrl = `${ARCHIVE_ORG_IMAGE_SERVICE}/${identifier}`;

    return {
      url: coverUrl,
      source: 'archive.org',
      size: 'large',
    };
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Archive.org API call', { isbn });
      return null;
    }

    const params = new URLSearchParams({
      q: `isbn:${normalizedISBN}`,
      fl: 'identifier,title,creator,publisher,date,description,subject',
      output: 'json',
      rows: '1',
    });

    const url = `${ARCHIVE_ORG_SEARCH_API}?${params.toString()}`;
    const response = await this.client.fetch<ArchiveOrgSearchResponse>(url, {}, context);

    if (!response?.response?.docs?.[0]) {
      return null;
    }

    const doc = response.response.docs[0];
    return {
      title: doc.title || '',
      authors: Array.isArray(doc.creator) ? doc.creator : doc.creator ? [doc.creator] : undefined,
      publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher,
      publishDate: doc.date,
      description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
      subjects: Array.isArray(doc.subject) ? doc.subject : doc.subject ? [doc.subject] : undefined,
    };
  }

  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const { logger } = context;

    try {
      // Build Advanced Search query (Lucene syntax)
      const safeTitle = this.escapeLucene(title);
      const safeAuthor = this.escapeLucene(author);
      const query = `title:(${safeTitle}) AND creator:(${safeAuthor})`;
      const params = new URLSearchParams({
        q: query,
        fl: 'identifier,title,creator,publisher,date,isbn,subject,description',
        output: 'json',
        rows: '5',
      });

      const url = `${ARCHIVE_ORG_SEARCH_API}?${params.toString()}`;
      const response = await this.client.fetch<ArchiveOrgSearchResponse>(url, {}, context);

      if (!response?.response?.docs || response.response.docs.length === 0) {
        logger.debug('No Archive.org results found', { title, author });
        return { isbn: null, confidence: 0, source: 'archive.org' };
      }

      // Find best match with ISBN
      let bestMatch: ArchiveOrgSearchResponse['response']['docs'][0] | null = null;
      let bestISBN: string | null = null;

      for (const doc of response.response.docs) {
        if (doc.isbn && doc.isbn.length > 0) {
          bestMatch = doc;
          bestISBN = this.selectBestISBN(doc.isbn);
          break; // Use first result with ISBN
        }
      }

      if (!bestMatch || !bestISBN) {
        logger.debug('No ISBN found in Archive.org results', { title, author });
        return { isbn: null, confidence: 0, source: 'archive.org' };
      }

      // Normalize ISBN
      const normalizedISBN = normalizeISBN(bestISBN);
      if (!normalizedISBN) {
        logger.warn('Invalid ISBN format from Archive.org', {
          title,
          author,
          rawIsbn: bestISBN,
        });
        return { isbn: null, confidence: 0, source: 'archive.org' };
      }

      // Calculate confidence score
      const confidence = this.calculateISBNResolutionConfidence(
        title,
        author,
        bestMatch
      );

      logger.debug('ISBN resolved via Archive.org', {
        title,
        author,
        isbn: normalizedISBN,
        confidence,
        matchedTitle: bestMatch.title,
      });

      return {
        isbn: normalizedISBN,
        confidence,
        source: 'archive.org',
      };
    } catch (error) {
      logger.error('Archive.org ISBN resolution failed', {
        title,
        author,
        error: error instanceof Error ? error.message : String(error),
      });
      return { isbn: null, confidence: 0, source: 'archive.org' };
    }
  }

  /**
   * Escape Lucene special characters to prevent query injection
   *
   * Escapes: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
   *
   * @param str - String to escape
   * @returns Escaped string safe for Lucene query
   */
  private escapeLucene(str: string): string {
    // Escape Lucene special characters with backslash
    return str.replace(/([+\-&|!(){}[\]^"~*?:\\/\\])/g, '\\$1');
  }

  /**
   * Select best ISBN from array (prefer ISBN-13)
   */
  private selectBestISBN(isbns: string[]): string | null {
    if (isbns.length === 0) return null;

    // Prefer ISBN-13 (13 digits)
    const isbn13 = isbns.find((isbn) => isbn.replace(/[^0-9]/g, '').length === 13);
    if (isbn13) return isbn13;

    // Fallback to ISBN-10
    const isbn10 = isbns.find((isbn) => isbn.replace(/[^0-9X]/g, '').length === 10);
    if (isbn10) return isbn10;

    // Return first ISBN if no standard format found
    return isbns[0];
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
   * Base score: 40 (Archive.org returned a result)
   * Title match: +20 if close match
   * Author match: +20 if close match
   * Has description: +5
   * Has subjects: +5
   * Pre-2000 publication: +10 (Archive.org strength)
   *
   * Maximum: 100
   */
  private calculateISBNResolutionConfidence(
    queryTitle: string,
    queryAuthor: string,
    doc: ArchiveOrgSearchResponse['response']['docs'][0]
  ): number {
    let confidence = 40; // Base score

    // Title matching (+20 max)
    if (doc.title) {
      const normalizedQueryTitle = queryTitle.toLowerCase().trim();
      const normalizedResultTitle = doc.title.toLowerCase().trim();

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
    if (doc.creator) {
      const creators = Array.isArray(doc.creator) ? doc.creator : [doc.creator];
      const normalizedQueryAuthor = queryAuthor.toLowerCase().trim();

      const hasAuthorMatch = creators.some((creator) => {
        const normalizedCreator = creator.toLowerCase().trim();
        return normalizedCreator.includes(normalizedQueryAuthor) ||
               normalizedQueryAuthor.includes(normalizedCreator);
      });

      if (hasAuthorMatch) {
        confidence += 20;
      }
    }

    // Metadata quality bonuses
    if (doc.description) confidence += 5;
    if (doc.subject && (Array.isArray(doc.subject) ? doc.subject.length > 0 : true)) {
      confidence += 5;
    }

    // Pre-2000 bonus (Archive.org excels at historical books)
    if (doc.date) {
      const year = parseInt(doc.date.slice(0, 4), 10);
      if (!isNaN(year) && year < 2000) {
        confidence += 10;
      }
    }

    return Math.min(confidence, 100);
  }

  /**
   * Check if a book is in the public domain
   *
   * Archive.org does not provide an explicit public domain flag, so we use a
   * date-based heuristic based on US copyright law:
   * - Published before 1928: Public domain (high confidence: 90)
   * - Published 1928-1977: Possibly public domain if copyright not renewed (medium confidence: 60)
   * - Published after 1977: Not public domain (high confidence: 90)
   *
   * This is a FALLBACK to Google Books, which provides explicit API-verified public domain status.
   * Use Google Books as the primary source and Archive.org as secondary confirmation.
   *
   * @param isbn - ISBN-10 or ISBN-13
   * @param context - Service context with logger and env
   * @returns PublicDomainResult with heuristic reasoning, or null if publication year unavailable
   *
   * @example
   * ```typescript
   * const result = await provider.checkPublicDomain('9780451524935', context);
   * // Result for "1984" (published 1949):
   * // {
   * //   isPublicDomain: true,
   * //   confidence: 60,
   * //   reason: 'publication-date',
   * //   downloadUrl: 'https://archive.org/details/...',
   * //   source: 'archive.org'
   * // }
   * ```
   */
  async checkPublicDomain(isbn: string, context: ServiceContext): Promise<PublicDomainResult | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Archive.org API call', { isbn });
      return null;
    }

    const params = new URLSearchParams({
      q: `isbn:${normalizedISBN}`,
      fl: 'identifier,date',
      output: 'json',
      rows: '1',
    });

    const url = `${ARCHIVE_ORG_SEARCH_API}?${params.toString()}`;
    const response = await this.client.fetch<ArchiveOrgSearchResponse>(url, {}, context);

    if (!response?.response?.docs?.[0]) {
      return null;
    }

    const doc = response.response.docs[0];

    // Extract publication year from date field (format: YYYY-MM-DD or YYYY)
    if (!doc.date) {
      context.logger.debug('No publication date available for public domain check', {
        isbn: normalizedISBN,
        identifier: doc.identifier,
      });
      return null;
    }

    const year = parseInt(doc.date.slice(0, 4), 10);
    if (isNaN(year)) {
      context.logger.warn('Invalid publication year format', {
        isbn: normalizedISBN,
        date: doc.date,
      });
      return null;
    }

    // Apply US copyright rules (heuristic approach)
    let isPublicDomain: boolean;
    let confidence: number;

    if (year < 1928) {
      // Published before 1928: Definitely public domain in the US
      isPublicDomain = true;
      confidence = 90; // High confidence
    } else if (year >= 1928 && year <= 1977) {
      // Published 1928-1977: Possibly public domain if copyright not renewed
      // We cannot determine renewal status without additional data, so confidence is lower
      isPublicDomain = true;
      confidence = 60; // Medium confidence (uncertain about renewal)
    } else {
      // Published after 1977: Not public domain (95 years from publication)
      isPublicDomain = false;
      confidence = 90; // High confidence
    }

    // Build Archive.org details page URL (download link)
    const downloadUrl = doc.identifier ? `https://archive.org/details/${doc.identifier}` : undefined;

    context.logger.debug('Public domain status checked (heuristic)', {
      isbn: normalizedISBN,
      publicationYear: year,
      isPublicDomain,
      confidence,
      hasDownloadUrl: !!downloadUrl,
    });

    return {
      isPublicDomain,
      confidence,
      reason: 'publication-date', // Heuristic approach based on date
      copyrightExpiry: year < 1928 ? year : undefined, // Only set for definite public domain
      downloadUrl,
      source: 'archive.org',
    };
  }

  private async findIdentifier(isbn: string, context: ServiceContext): Promise<string | null> {
    const params = new URLSearchParams({
      q: `isbn:${isbn}`,
      fl: 'identifier',
      output: 'json',
      rows: '1',
    });

    const url = `${ARCHIVE_ORG_SEARCH_API}?${params.toString()}`;
    const response = await this.client.fetch<ArchiveOrgSearchResponse>(url, {}, context);

    return response?.response?.docs?.[0]?.identifier || null;
  }
}
