/**
 * OpenLibrary Service Provider
 *
 * Provides free, quota-free book metadata and ISBN resolution via OpenLibrary's Search API.
 * Used as fallback when ISBNdb quota exhausted.
 *
 * Implements:
 * - IISBNResolver: Title/author → ISBN search
 * - IMetadataProvider: ISBN → Book metadata lookup
 *
 * Features:
 * - KV-backed rate limiting (100 req per 5 minutes = ~1 req every 3 seconds)
 * - Response caching (7-day TTL for stable metadata)
 * - Graceful error handling (returns null, never throws)
 * - User-Agent with contact info following best practices
 *
 * @see https://openlibrary.org/dev/docs/api/search
 * @module lib/external-services/providers/open-library-provider
 */

import type {
  IISBNResolver,
  IMetadataProvider,
  ISBNResolutionResult,
  BookMetadata,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

// =================================================================================
// Constants
// =================================================================================

/**
 * OpenLibrary Search API endpoint
 */
const OPEN_LIBRARY_SEARCH_API = 'https://openlibrary.org/search.json';

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
  subject?: string[];
}

// =================================================================================
// OpenLibrary Provider
// =================================================================================

/**
 * OpenLibrary Service Provider
 *
 * Free service, always available (no API key required).
 * Rate limited to 1 req every 3 seconds (100 req per 5 minutes).
 */
export class OpenLibraryProvider implements IISBNResolver, IMetadataProvider {
  readonly name = 'open-library';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.METADATA_ENRICHMENT,
  ];

  private client = new ServiceHttpClient({
    providerName: 'open-library',
    rateLimitMs: 3000, // 1 req per 3 seconds (100 req per 5 minutes)
    cacheTtlSeconds: 604800, // 7 days
    purpose: 'Book metadata enrichment and ISBN resolution',
  });

  /**
   * Check if OpenLibrary is available
   * Always true - free service with no API key required
   */
  async isAvailable(_env: Env): Promise<boolean> {
    return true; // Free service, always available
  }

  /**
   * Resolve ISBN from title and author
   *
   * Searches OpenLibrary for the best matching work and returns the first ISBN found.
   * Used as fallback when ISBNdb quota exhausted.
   *
   * @param title - Book title
   * @param author - Author name
   * @param context - Service context
   * @returns ISBN resolution result with metadata
   */
  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const { logger } = context;

    try {
      // Build search URL
      const params = new URLSearchParams({
        title: title,
        author: author,
        fields: 'key,title,author_name,author_key,first_publish_year,isbn,edition_count,publisher,language,cover_i,subject',
        limit: '5', // Get top 5 results for best match
      });
      const url = `${OPEN_LIBRARY_SEARCH_API}?${params.toString()}`;

      // Execute search
      const response = await this.client.fetch<OpenLibrarySearchResponse>(url, {}, context);

      if (!response || !response.docs || response.docs.length === 0) {
        logger.debug('No OpenLibrary results found', { title, author });
        return { isbn: null, confidence: 0, source: 'open-library' };
      }

      // Get first result (best match)
      const doc = response.docs[0];

      // Extract first ISBN
      const isbn = doc.isbn?.[0];
      if (!isbn) {
        logger.debug('No ISBN found in OpenLibrary result', { title, author, workKey: doc.key });
        return { isbn: null, confidence: 0, source: 'open-library' };
      }

      // Normalize ISBN to ISBN-13
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.warn('Invalid ISBN from OpenLibrary', { title, author, isbn });
        return { isbn: null, confidence: 0, source: 'open-library' };
      }

      // Calculate confidence based on result quality
      const confidence = this.calculateConfidence(doc);

      logger.info('ISBN resolved via OpenLibrary', {
        title,
        author,
        isbn: normalizedISBN,
        confidence,
        workKey: doc.key,
      });

      return {
        isbn: normalizedISBN,
        confidence,
        source: 'open-library',
        metadata: this.documentToMetadata(doc),
      };
    } catch (error) {
      logger.error('OpenLibrary ISBN resolution failed', {
        title,
        author,
        error: error instanceof Error ? error.message : String(error),
      });
      return { isbn: null, confidence: 0, source: 'open-library' };
    }
  }

  /**
   * Fetch metadata for a single ISBN
   *
   * @param isbn - ISBN-13 to lookup
   * @param context - Service context
   * @returns Book metadata or null if not found
   */
  async fetchMetadata(
    isbn: string,
    context: ServiceContext
  ): Promise<BookMetadata | null> {
    const { logger } = context;

    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      logger.debug('Invalid ISBN format, skipping OpenLibrary API call', { isbn });
      return null;
    }

    try {
      // Build search URL
      const params = new URLSearchParams({
        isbn: normalizedISBN,
        fields: 'key,title,author_name,author_key,first_publish_year,isbn,edition_count,publisher,language,cover_i,subject',
        limit: '1',
      });
      const url = `${OPEN_LIBRARY_SEARCH_API}?${params.toString()}`;

      // Execute search
      const response = await this.client.fetch<OpenLibrarySearchResponse>(url, {}, context);

      if (!response || !response.docs || response.docs.length === 0) {
        logger.debug('No OpenLibrary metadata found', { isbn: normalizedISBN });
        return null;
      }

      const doc = response.docs[0];

      logger.info('Metadata fetched via OpenLibrary', {
        isbn,
        workKey: doc.key,
        title: doc.title,
      });

      return this.documentToMetadata(doc);
    } catch (error) {
      logger.error('OpenLibrary metadata fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // =================================================================================
  // Private Helper Methods
  // =================================================================================

  /**
   * Calculate confidence score for OpenLibrary metadata
   *
   * @param doc - Search result document
   * @returns Confidence score (0-100)
   */
  private calculateConfidence(doc: OpenLibraryDocument): number {
    let confidence = 50; // Base confidence for finding the work

    if (doc.author_name?.length) confidence += 20; // Has authors
    if (doc.first_publish_year) confidence += 10; // Has publication year
    if (doc.isbn?.length) confidence += 10; // Has ISBNs
    if (doc.cover_i) confidence += 5; // Has cover
    if (doc.edition_count && doc.edition_count > 1) confidence += 5; // Multiple editions (well-known work)

    return Math.min(confidence, 100);
  }

  /**
   * Convert OpenLibrary document to standardized BookMetadata
   *
   * @param doc - Search result document
   * @returns Standardized book metadata
   */
  private documentToMetadata(doc: OpenLibraryDocument): BookMetadata {
    return {
      title: doc.title,
      authors: doc.author_name,
      publisher: doc.publisher?.[0],
      publishDate: doc.first_publish_year?.toString(),
      language: doc.language?.[0],
      subjects: doc.subject,
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined,
      externalIds: {
        // OpenLibrary work key can be useful for future lookups
      },
    };
  }
}
