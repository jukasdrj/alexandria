/**
 * Wikidata Service Provider
 *
 * Provides comprehensive metadata via SPARQL queries to Wikidata's knowledge graph.
 * Excellent for author bibliographies, genre enrichment, and cover images from Wikimedia Commons.
 *
 * Implements:
 * - IMetadataProvider: ISBN/Wikidata QID → Book metadata
 * - ICoverProvider: Wikidata QID → Wikimedia Commons cover image
 *
 * Features:
 * - SPARQL endpoint for complex queries
 * - KV-backed rate limiting (2 req/sec)
 * - Response caching (30-day TTL)
 * - Comprehensive metadata (genres, awards, translations)
 *
 * @module lib/external-services/providers/wikidata-provider
 */

import type {
  IMetadataProvider,
  ICoverProvider,
  IISBNResolver,
  BookMetadata,
  CoverResult,
  ISBNResolutionResult,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

// =================================================================================
// Constants
// =================================================================================

const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

// =================================================================================
// Types
// =================================================================================

interface WikidataSparqlResponse {
  results?: {
    bindings?: Array<Record<string, { value: string; type: string }>>;
  };
}

// =================================================================================
// Wikidata Provider
// =================================================================================

export class WikidataProvider implements IMetadataProvider, ICoverProvider, IISBNResolver {
  readonly name = 'wikidata';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
    ServiceCapability.ISBN_RESOLUTION,
  ];

  private client = new ServiceHttpClient({
    providerName: 'wikidata',
    rateLimitMs: 500, // 2 req/sec (SPARQL endpoint limit)
    cacheTtlSeconds: 2592000, // 30 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(_env: Env): Promise<boolean> {
    return true; // Free service, always available
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    const { logger } = context;

    try {
      // Validate and normalize ISBN (handles ISBN-10 with 'X', ISBN-13)
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format, skipping Wikidata query', { isbn });
        return null;
      }

      // Sanitize for SPARQL injection prevention (normalizeISBN already validated format)
      const safeIsbn = normalizedISBN.replace(/[^0-9X]/g, '');

      // SPARQL query to find book by ISBN
      const query = `
        SELECT ?book ?bookLabel ?author ?authorLabel ?publishDate ?genre ?genreLabel
        WHERE {
          ?book wdt:P212 "${safeIsbn}" .  # ISBN-13 (sanitized)
          OPTIONAL { ?book wdt:P50 ?author . }
          OPTIONAL { ?book wdt:P577 ?publishDate . }
          OPTIONAL { ?book wdt:P136 ?genre . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 1
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(url, {}, context);

      if (!response?.results?.bindings?.[0]) {
        logger.debug('No Wikidata metadata found', { isbn });
        return null;
      }

      const binding = response.results.bindings[0];
      return {
        title: binding.bookLabel?.value || '',
        authors: binding.authorLabel ? [binding.authorLabel.value] : undefined,
        publishDate: binding.publishDate?.value,
        subjects: binding.genreLabel ? [binding.genreLabel.value] : undefined,
      };
    } catch (error) {
      logger.error('Wikidata metadata fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async fetchCover(isbn: string, context: ServiceContext): Promise<CoverResult | null> {
    const { logger } = context;

    try {
      // Validate and normalize ISBN (handles ISBN-10 with 'X', ISBN-13)
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format, skipping Wikidata query', { isbn });
        return null;
      }

      // Sanitize for SPARQL injection prevention (normalizeISBN already validated format)
      const safeIsbn = normalizedISBN.replace(/[^0-9X]/g, '');

      // SPARQL query to find cover image from Wikimedia Commons
      const query = `
        SELECT ?image
        WHERE {
          ?book wdt:P212 "${safeIsbn}" .  # ISBN-13 (sanitized)
          ?book wdt:P18 ?image .      # Image property
        }
        LIMIT 1
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(url, {}, context);

      if (!response?.results?.bindings?.[0]?.image) {
        logger.debug('No Wikidata cover found', { isbn });
        return null;
      }

      const imageUrl = response.results.bindings[0].image.value;

      return {
        url: imageUrl,
        source: 'wikidata',
        size: 'large',
      };
    } catch (error) {
      logger.error('Wikidata cover fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const { logger } = context;

    try {
      // Phase 1: Try exact title match
      const exactResult = await this.searchWikidataBooks(title, author, false, context);
      if (exactResult) return exactResult;

      // Phase 2: Try fuzzy title match (normalized)
      const fuzzyResult = await this.searchWikidataBooks(title, author, true, context);
      if (fuzzyResult) return fuzzyResult;

      logger.debug('No Wikidata ISBN found', { title, author });
      return { isbn: null, confidence: 0, source: 'wikidata' };
    } catch (error) {
      logger.error('Wikidata ISBN resolution failed', {
        title,
        author,
        error: error instanceof Error ? error.message : String(error),
      });
      return { isbn: null, confidence: 0, source: 'wikidata' };
    }
  }

  /**
   * Search Wikidata for books matching title and author
   *
   * @param title - Book title
   * @param author - Author name
   * @param fuzzyMode - Use normalized title for fuzzy matching
   * @param context - Service context
   */
  private async searchWikidataBooks(
    title: string,
    author: string,
    fuzzyMode: boolean,
    context: ServiceContext
  ): Promise<ISBNResolutionResult | null> {
    const { logger } = context;

    // Build SPARQL query
    const query = this.buildTitleSearchQuery(title, author, fuzzyMode);
    const params = new URLSearchParams({
      query,
      format: 'json',
    });

    const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
    const response = await this.client.fetch<WikidataSparqlResponse>(url, {}, context);

    if (!response?.results?.bindings || response.results.bindings.length === 0) {
      return null;
    }

    // Process results
    for (const binding of response.results.bindings) {
      // Prefer ISBN-13
      const isbn13s = binding.isbn13s?.value?.split('|') || [];
      const isbn10s = binding.isbn10s?.value?.split('|') || [];

      const allIsbns = [...isbn13s, ...isbn10s];
      if (allIsbns.length === 0) continue;

      // Select best ISBN (prefer ISBN-13)
      const selectedISBN = isbn13s[0] || isbn10s[0];
      const normalizedISBN = normalizeISBN(selectedISBN);

      if (!normalizedISBN) {
        logger.warn('Invalid ISBN from Wikidata', { rawIsbn: selectedISBN });
        continue;
      }

      // Calculate confidence
      const confidence = this.calculateISBNResolutionConfidence(
        title,
        author,
        binding,
        fuzzyMode
      );

      logger.debug('ISBN resolved via Wikidata', {
        title,
        author,
        isbn: normalizedISBN,
        confidence,
        fuzzyMode,
        matchedTitle: binding.bookLabel?.value,
      });

      return {
        isbn: normalizedISBN,
        confidence,
        source: 'wikidata',
      };
    }

    return null;
  }

  /**
   * Build SPARQL query for title/author search
   *
   * @param title - Book title
   * @param author - Author name
   * @param fuzzyMode - Use normalized title for fuzzy matching
   */
  private buildTitleSearchQuery(
    title: string,
    author: string,
    fuzzyMode: boolean
  ): string {
    // Sanitize inputs for SPARQL injection prevention
    const safeTitle = fuzzyMode
      ? this.sanitizeSparql(this.normalizeForSearch(title))
      : this.sanitizeSparql(title);
    const safeAuthor = this.sanitizeSparql(author);

    return `
      SELECT ?book ?bookLabel ?author ?authorLabel ?pubDate ?image
             (GROUP_CONCAT(DISTINCT ?isbn13; separator="|") as ?isbn13s)
             (GROUP_CONCAT(DISTINCT ?isbn10; separator="|") as ?isbn10s)
      WHERE {
        ?book rdfs:label ?bookLabel .
        FILTER(CONTAINS(LCASE(?bookLabel), LCASE("${safeTitle}")))
        FILTER(LANG(?bookLabel) = "en")

        ?book wdt:P50 ?author .
        ?author rdfs:label ?authorLabel .
        FILTER(CONTAINS(LCASE(?authorLabel), LCASE("${safeAuthor}")))
        FILTER(LANG(?authorLabel) = "en")

        # ISBN properties
        OPTIONAL { ?book wdt:P212 ?isbn13 . }  # ISBN-13
        OPTIONAL { ?book wdt:P957 ?isbn10 . }  # ISBN-10
        OPTIONAL { ?book wdt:P577 ?pubDate . }
        OPTIONAL { ?book wdt:P18 ?image . }

        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
      GROUP BY ?book ?bookLabel ?author ?authorLabel ?pubDate ?image
      LIMIT 10
    `;
  }

  /**
   * Normalize title for fuzzy search (remove articles, punctuation)
   */
  private normalizeForSearch(title: string): string {
    return title
      .toLowerCase()
      .replace(/^(the|a|an)\s+/i, '') // Remove leading articles
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .trim();
  }

  /**
   * Sanitize string for SPARQL injection prevention
   *
   * Escapes backslashes first (to prevent escape sequence attacks),
   * then escapes double quotes.
   *
   * @param str - String to sanitize
   * @returns Sanitized string safe for SPARQL interpolation
   */
  private sanitizeSparql(str: string): string {
    return str
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/"/g, '\\"');   // Then escape quotes
  }

  /**
   * Calculate confidence score for ISBN resolution
   *
   * Base score: 40 (Wikidata returned a result)
   * Exact title match: +30, Fuzzy: +15
   * Author match: +20
   * Has publication date: +5
   * Has cover image: +5
   *
   * Maximum: 100
   */
  private calculateISBNResolutionConfidence(
    queryTitle: string,
    queryAuthor: string,
    binding: Record<string, { value: string; type: string }>,
    fuzzyMode: boolean
  ): number {
    let confidence = 40; // Base score

    // Title matching
    if (binding.bookLabel) {
      const normalizedQueryTitle = queryTitle.toLowerCase().trim();
      const normalizedResultTitle = binding.bookLabel.value.toLowerCase().trim();

      if (normalizedResultTitle === normalizedQueryTitle) {
        confidence += fuzzyMode ? 15 : 30; // Lower bonus for fuzzy match
      } else if (normalizedResultTitle.includes(normalizedQueryTitle) ||
                 normalizedQueryTitle.includes(normalizedResultTitle)) {
        confidence += fuzzyMode ? 10 : 25;
      } else {
        confidence += fuzzyMode ? 5 : 15; // Minimal bonus for CONTAINS match
      }
    }

    // Author matching
    if (binding.authorLabel) {
      const normalizedQueryAuthor = queryAuthor.toLowerCase().trim();
      const normalizedResultAuthor = binding.authorLabel.value.toLowerCase().trim();

      if (normalizedResultAuthor.includes(normalizedQueryAuthor) ||
          normalizedQueryAuthor.includes(normalizedResultAuthor)) {
        confidence += 20;
      }
    }

    // Metadata quality bonuses
    if (binding.pubDate) confidence += 5;
    if (binding.image) confidence += 5;

    return Math.min(confidence, 100);
  }

  /**
   * Fetch author bibliography by Wikidata QID
   * Helper method for author enrichment workflows
   */
  async fetchAuthorBibliography(
    authorQid: string,
    context: ServiceContext
  ): Promise<string[]> {
    // Sanitize Wikidata QID to prevent SPARQL injection
    const safeQid = authorQid.replace(/[^Q0-9]/g, '');
    if (!/^Q\d+$/.test(safeQid)) {
      context.logger.warn('Invalid Wikidata QID format', { authorQid });
      return [];
    }

    const query = `
      SELECT ?work ?workLabel
      WHERE {
        ?work wdt:P50 wd:${safeQid} .  # Author property (sanitized)
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
      LIMIT 100
    `;

    const params = new URLSearchParams({
      query,
      format: 'json',
    });

    const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
    const response = await this.client.fetch<WikidataSparqlResponse>(url, {}, context);

    if (!response?.results?.bindings) {
      return [];
    }

    return response.results.bindings
      .map((b) => b.workLabel?.value)
      .filter((title): title is string => !!title);
  }
}
