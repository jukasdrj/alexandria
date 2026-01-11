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

export class WikidataProvider implements IMetadataProvider, ICoverProvider {
  readonly name = 'wikidata';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
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
