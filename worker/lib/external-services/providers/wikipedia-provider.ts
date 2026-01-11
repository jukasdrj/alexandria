/**
 * Wikipedia Service Provider
 *
 * Fetches author biographies from Wikipedia with ID-based lookup for accuracy.
 *
 * Implements:
 * - IAuthorBiographyProvider: Author key → Biography
 *
 * Features:
 * - ID-based lookup (eliminates fuzzy matching for 174K+ authors with Wikidata IDs)
 * - KV-backed rate limiting (1 req/sec)
 * - Response caching (30-day TTL for biographies)
 * - Structured data extraction (birth year, nationality, image)
 *
 * Note: This provider requires database access to lookup Wikidata QIDs
 * from enriched_authors table. It's not a pure HTTP provider.
 *
 * @module lib/external-services/providers/wikipedia-provider
 */

import type {
  IAuthorBiographyProvider,
  AuthorBiography,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { fetchAuthorBiography } from '../../../services/wikipedia.js';

// =================================================================================
// Constants
// =================================================================================

const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';

// =================================================================================
// Types
// =================================================================================

interface WikipediaQueryResponse {
  query?: {
    pages?: Record<string, {
      pageid: number;
      title: string;
      extract?: string;
      thumbnail?: {
        source: string;
        width: number;
        height: number;
      };
      categories?: Array<{
        title: string;
      }>;
    }>;
  };
}

interface WikidataResponse {
  entities?: Record<string, {
    sitelinks?: {
      enwiki?: {
        title: string;
      };
    };
  }>;
}

// =================================================================================
// Wikipedia Provider
// =================================================================================

export class WikipediaProvider implements IAuthorBiographyProvider {
  readonly name = 'wikipedia';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.AUTHOR_BIOGRAPHY];

  private client = new ServiceHttpClient({
    providerName: 'wikipedia',
    rateLimitMs: 1000, // 1 req/sec
    cacheTtlSeconds: 2592000, // 30 days
    purpose: 'Author biographies',
  });

  async isAvailable(_env: Env): Promise<boolean> {
    return true; // Free service, always available
  }

  async fetchBiography(
    authorKey: string,
    context: ServiceContext
  ): Promise<AuthorBiography | null> {
    const { logger, env, sql } = context;

    try {
      // Validate database connection
      if (!sql) {
        logger.error('Wikipedia provider requires database connection', {
          authorKey,
        });
        return null;
      }

      // Call existing Wikipedia service
      const wikiData = await fetchAuthorBiography(sql, authorKey, env);

      if (!wikiData) {
        logger.debug('No Wikipedia biography found', { authorKey });
        return null;
      }

      // Map WikipediaAuthorBiography to AuthorBiography interface
      const biography: AuthorBiography = {
        authorKey,
        name: wikiData.article_title,
        biography: wikiData.extract,
        birthDate: wikiData.birth_year?.toString(),
        deathDate: wikiData.death_year?.toString(),
        wikidataQid: wikiData.wikidata_qid,
        wikipediaUrl: wikiData.wikipedia_url,
        source: 'wikipedia',
      };

      logger.info('Wikipedia biography fetched successfully', {
        authorKey,
        confidence: wikiData.confidence,
        hasWikidataQid: !!wikiData.wikidata_qid,
      });

      return biography;
    } catch (error) {
      logger.error('Wikipedia biography fetch failed', {
        authorKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch Wikipedia page by title
   * Helper method for when we have the page title
   */
  async fetchByPageTitle(
    pageTitle: string,
    context: ServiceContext
  ): Promise<string | null> {
    const params = new URLSearchParams({
      action: 'query',
      titles: pageTitle,
      prop: 'extracts|pageimages',
      exintro: '1',
      explaintext: '1',
      piprop: 'thumbnail',
      pithumbsize: '300',
      format: 'json',
    });

    const url = `${WIKIPEDIA_API_URL}?${params.toString()}`;
    const response = await this.client.fetch<WikipediaQueryResponse>(url, {}, context);

    if (!response?.query?.pages) {
      return null;
    }

    const pages = Object.values(response.query.pages);
    if (pages.length === 0 || !pages[0].extract) {
      return null;
    }

    return pages[0].extract;
  }

  /**
   * Get Wikipedia page title from Wikidata QID
   */
  async getPageTitleFromWikidata(
    wikidataQid: string,
    context: ServiceContext
  ): Promise<string | null> {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: wikidataQid,
      props: 'sitelinks',
      sitefilter: 'enwiki',
      format: 'json',
    });

    const url = `${WIKIDATA_API_URL}?${params.toString()}`;
    const response = await this.client.fetch<WikidataResponse>(url, {}, context);

    return response?.entities?.[wikidataQid]?.sitelinks?.enwiki?.title || null;
  }
}
