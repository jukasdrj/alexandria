/**
 * Wikidata Service Provider
 *
 * Provides comprehensive metadata via SPARQL queries to Wikidata's knowledge graph.
 * Excellent for author bibliographies, genre enrichment, and cover images from Wikimedia Commons.
 *
 * Implements:
 * - IMetadataProvider: ISBN/Wikidata QID → Book metadata
 * - ICoverProvider: Wikidata QID → Wikimedia Commons cover image
 * - ISubjectBrowsingProvider: Subject hierarchy and search
 * - ISeriesProvider: Book series information (P179 - part of the series)
 * - IAwardsProvider: Literary awards and nominations (P166 - award received)
 * - ITranslationProvider: Translated editions (P629 - edition or translation of)
 *
 * Features:
 * - SPARQL endpoint for complex queries
 * - KV-backed rate limiting (2 req/sec)
 * - Response caching (30-day TTL)
 * - Comprehensive metadata (genres, awards, translations, series)
 *
 * @module lib/external-services/providers/wikidata-provider
 */

import type {
  IMetadataProvider,
  ICoverProvider,
  IISBNResolver,
  ISubjectBrowsingProvider,
  ISeriesProvider,
  IAwardsProvider,
  ITranslationProvider,
  IEnhancedExternalIdProvider,
  BookMetadata,
  CoverResult,
  ISBNResolutionResult,
  SubjectNode,
  SeriesInfo,
  AwardInfo,
  TranslationInfo,
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

export class WikidataProvider implements IMetadataProvider, ICoverProvider, IISBNResolver, ISubjectBrowsingProvider, ISeriesProvider, IAwardsProvider, ITranslationProvider, IEnhancedExternalIdProvider {
  readonly name = 'wikidata';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.SUBJECT_BROWSING,
    ServiceCapability.SERIES_INFO,
    ServiceCapability.AWARDS,
    ServiceCapability.TRANSLATIONS,
    ServiceCapability.ENHANCED_EXTERNAL_IDS,
  ];

  private client = new ServiceHttpClient({
    providerName: 'wikidata',
    rateLimitMs: 500, // 2 req/sec (SPARQL endpoint limit)
    cacheTtlSeconds: 2592000, // 30 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(_env: Env, _quotaManager?: import("../../../src/services/quota-manager.js").QuotaManager): Promise<boolean> {
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

  /**
   * Fetch subject/genre hierarchy from Wikidata
   *
   * Queries Wikidata for a subject's hierarchical structure using:
   * - P31 (instance of) - What this subject is an instance of
   * - P279 (subclass of) - What this subject is a subclass of (parent)
   * - P910 (topic's main category) - Related category
   *
   * @param subjectId - Wikidata QID (e.g., "Q8253" for fiction)
   * @param depth - How many levels to traverse (1-3 recommended, limited to prevent timeout)
   * @param context - Service context
   * @returns Array of SubjectNode objects with hierarchical structure, empty array if not found
   */
  async fetchSubjectHierarchy(
    subjectId: string,
    depth: number,
    context: ServiceContext
  ): Promise<SubjectNode[]> {
    const { logger } = context;

    try {
      // Sanitize and validate Wikidata QID
      const safeQid = subjectId.replace(/[^Q0-9]/g, '');
      if (!/^Q\d+$/.test(safeQid)) {
        logger.warn('Invalid Wikidata QID format', { subjectId });
        return [];
      }

      // Limit depth to prevent timeout (max 3 levels)
      const safeDepth = Math.min(Math.max(depth, 1), 3);

      // Build SPARQL query to fetch subject + parents + children
      // Uses OPTIONAL to gracefully handle missing relationships
      const query = `
        SELECT ?subject ?subjectLabel ?parent ?parentLabel ?child ?childLabel
        WHERE {
          {
            # Main subject
            BIND(wd:${safeQid} AS ?subject)
            OPTIONAL { ?subject wdt:P279 ?parent . }  # Subclass of (parent)
          }
          UNION
          {
            # Children (things that are subclass of this subject)
            ?child wdt:P279 wd:${safeQid} .
          }
          ${safeDepth > 1 ? `
          UNION
          {
            # Grandchildren (if depth >= 2)
            ?child wdt:P279 ?parent .
            ?parent wdt:P279 wd:${safeQid} .
          }
          ` : ''}
          ${safeDepth > 2 ? `
          UNION
          {
            # Great-grandchildren (if depth >= 3)
            ?child wdt:P279 ?grandparent .
            ?grandparent wdt:P279 ?parent .
            ?parent wdt:P279 wd:${safeQid} .
          }
          ` : ''}

          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 100
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(
        url,
        {}, // Uses client's default 10s timeout
        context
      );

      if (!response?.results?.bindings || response.results.bindings.length === 0) {
        logger.debug('No Wikidata subject hierarchy found', { subjectId, depth });
        return [];
      }

      // Process SPARQL results into SubjectNode structure
      const nodes = this.processSubjectHierarchy(response.results.bindings, safeQid);

      logger.debug('Fetched subject hierarchy', {
        subjectId: safeQid,
        depth: safeDepth,
        nodeCount: nodes.length,
      });

      return nodes;
    } catch (error) {
      logger.error('Wikidata subject hierarchy fetch failed', {
        subjectId,
        depth,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Search for subjects/genres by text query
   *
   * Uses Wikidata's search API to find subjects and genres matching a text query.
   * Filters results to literary genres and subject classifications.
   *
   * @param query - Search query (e.g., "science fiction", "mystery")
   * @param context - Service context
   * @returns Array of SubjectNode objects (flat, no hierarchy), empty array if no matches
   */
  async searchSubjects(
    query: string,
    context: ServiceContext
  ): Promise<SubjectNode[]> {
    const { logger } = context;

    try {
      // Sanitize query for SPARQL injection prevention
      const safeQuery = this.sanitizeSparql(query.trim());

      if (!safeQuery) {
        logger.warn('Empty search query', { query });
        return [];
      }

      // Build SPARQL query to search for literary genres and subject classifications
      // Filter by P31 (instance of) to narrow to relevant entities
      const sparqlQuery = `
        SELECT DISTINCT ?subject ?subjectLabel ?parent ?parentLabel
        WHERE {
          # Text search across labels
          ?subject rdfs:label ?label .
          FILTER(CONTAINS(LCASE(?label), LCASE("${safeQuery}")))
          FILTER(LANG(?label) = "en")

          # Filter to literary genres, genres, or subject headings
          {
            ?subject wdt:P31 wd:Q223393 .  # Literary genre
          }
          UNION
          {
            ?subject wdt:P31 wd:Q483394 .  # Genre
          }
          UNION
          {
            ?subject wdt:P279* wd:Q223393 . # Subclass of literary genre
          }
          UNION
          {
            ?subject wdt:P279* wd:Q483394 . # Subclass of genre
          }

          # Get parent (if exists)
          OPTIONAL { ?subject wdt:P279 ?parent . }

          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50
      `;

      const params = new URLSearchParams({
        query: sparqlQuery,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(
        url,
        {}, // Uses client's default 10s timeout
        context
      );

      if (!response?.results?.bindings || response.results.bindings.length === 0) {
        logger.debug('No Wikidata subjects found', { query });
        return [];
      }

      // Process results into flat SubjectNode structure
      const nodes = this.processSearchResults(response.results.bindings);

      logger.debug('Searched subjects', {
        query: safeQuery,
        resultCount: nodes.length,
      });

      return nodes;
    } catch (error) {
      logger.error('Wikidata subject search failed', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Process SPARQL bindings into SubjectNode hierarchy
   * @private
   */
  private processSubjectHierarchy(
    bindings: Array<Record<string, { value: string; type: string }>>,
    rootQid: string
  ): SubjectNode[] {
    const nodesMap = new Map<string, SubjectNode>();

    // First pass: Create all nodes
    for (const binding of bindings) {
      // Process subject (root node)
      if (binding.subject) {
        const qid = this.extractQid(binding.subject.value);
        if (qid && !nodesMap.has(qid)) {
          nodesMap.set(qid, {
            id: qid,
            label: binding.subjectLabel?.value || qid,
            parentId: null,
            childIds: [],
            source: 'wikidata',
          });
        }
      }

      // Process parent
      if (binding.parent) {
        const parentQid = this.extractQid(binding.parent.value);
        if (parentQid && !nodesMap.has(parentQid)) {
          nodesMap.set(parentQid, {
            id: parentQid,
            label: binding.parentLabel?.value || parentQid,
            parentId: null,
            childIds: [],
            source: 'wikidata',
          });
        }
      }

      // Process child
      if (binding.child) {
        const childQid = this.extractQid(binding.child.value);
        if (childQid && !nodesMap.has(childQid)) {
          nodesMap.set(childQid, {
            id: childQid,
            label: binding.childLabel?.value || childQid,
            parentId: rootQid,
            childIds: [],
            source: 'wikidata',
          });
        }
      }
    }

    // Second pass: Establish parent-child relationships
    for (const binding of bindings) {
      if (binding.subject && binding.parent) {
        const subjectQid = this.extractQid(binding.subject.value);
        const parentQid = this.extractQid(binding.parent.value);

        if (subjectQid && parentQid) {
          const subjectNode = nodesMap.get(subjectQid);
          const parentNode = nodesMap.get(parentQid);

          if (subjectNode && parentNode) {
            subjectNode.parentId = parentQid;
            if (!parentNode.childIds.includes(subjectQid)) {
              parentNode.childIds.push(subjectQid);
            }
          }
        }
      }

      if (binding.child) {
        const childQid = this.extractQid(binding.child.value);
        const rootNode = nodesMap.get(rootQid);

        if (childQid && rootNode && !rootNode.childIds.includes(childQid)) {
          rootNode.childIds.push(childQid);
        }
      }
    }

    return Array.from(nodesMap.values());
  }

  /**
   * Process SPARQL search results into flat SubjectNode structure
   * @private
   */
  private processSearchResults(
    bindings: Array<Record<string, { value: string; type: string }>>
  ): SubjectNode[] {
    const nodesMap = new Map<string, SubjectNode>();

    for (const binding of bindings) {
      if (!binding.subject) continue;

      const qid = this.extractQid(binding.subject.value);
      if (!qid) continue;

      const parentQid = binding.parent ? this.extractQid(binding.parent.value) : null;

      nodesMap.set(qid, {
        id: qid,
        label: binding.subjectLabel?.value || qid,
        parentId: parentQid,
        childIds: [], // Flat search results don't include children
        source: 'wikidata',
      });
    }

    return Array.from(nodesMap.values());
  }

  /**
   * Extract Wikidata QID from entity URI
   * @private
   */
  private extractQid(uri: string): string | null {
    const match = uri.match(/Q\d+$/);
    return match ? match[0] : null;
  }

  // =================================================================================
  // Phase 2 - High-Value Capabilities (Jan 2026)
  // =================================================================================

  /**
   * Fetch series information for a book by ISBN
   *
   * Uses SPARQL query with property P179 (part of the series) to find
   * the series a book belongs to, along with ordinal position.
   *
   * @param isbn - ISBN-13 or ISBN-10
   * @param context - Service context
   * @returns SeriesInfo object if book is part of a series, null otherwise
   */
  async fetchSeriesInfo(isbn: string, context: ServiceContext): Promise<SeriesInfo | null> {
    const { logger } = context;

    try {
      // Validate and normalize ISBN
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format, skipping Wikidata series query', { isbn });
        return null;
      }

      // Sanitize for SPARQL injection prevention
      const safeIsbn = this.sanitizeSparql(normalizedISBN);

      // SPARQL query to find series information
      const query = `
        SELECT ?series ?seriesLabel ?ordinal ?totalBooks
        WHERE {
          ?book wdt:P212 "${safeIsbn}" .  # ISBN-13 (sanitized)
          ?book wdt:P179 ?series .        # Part of the series
          OPTIONAL { ?book pq:P1545 ?ordinal . }  # Series ordinal (qualifier)
          OPTIONAL {
            # Count total books in series (approximate)
            SELECT (COUNT(?otherBook) as ?totalBooks) WHERE {
              ?otherBook wdt:P179 ?series .
            }
            GROUP BY ?series
          }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 1
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(
        url,
        {}, // Uses client's default 10s timeout
        context
      );

      if (!response?.results?.bindings?.[0]) {
        logger.debug('No Wikidata series info found', { isbn });
        return null;
      }

      const binding = response.results.bindings[0];
      const seriesId = binding.series ? this.extractQid(binding.series.value) : undefined;
      const seriesName = binding.seriesLabel?.value;

      if (!seriesName) {
        logger.debug('Series found but no label available', { isbn, seriesId });
        return null;
      }

      const result: SeriesInfo = {
        seriesName,
        seriesPosition: binding.ordinal ? parseInt(binding.ordinal.value, 10) : undefined,
        totalBooks: binding.totalBooks ? parseInt(binding.totalBooks.value, 10) : undefined,
        seriesId: seriesId || undefined,
        confidence: 85, // Wikidata is comprehensive for series info
        source: 'wikidata',
      };

      logger.debug('Fetched series info', {
        isbn,
        seriesName,
        seriesPosition: result.seriesPosition,
        totalBooks: result.totalBooks,
      });

      return result;
    } catch (error) {
      logger.error('Wikidata series info fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch all books in a series by series ID
   *
   * Optional method - queries Wikidata for all works in a series
   * and returns their ISBNs.
   *
   * @param seriesId - Wikidata QID for the series (e.g., "Q42")
   * @param context - Service context
   * @returns Array of ISBN strings, empty array if series not found
   */
  async fetchSeriesBooks(seriesId: string, context: ServiceContext): Promise<string[]> {
    const { logger } = context;

    try {
      // Sanitize and validate Wikidata QID
      const safeQid = seriesId.replace(/[^Q0-9]/g, '');
      if (!/^Q\d+$/.test(safeQid)) {
        logger.warn('Invalid Wikidata series QID format', { seriesId });
        return [];
      }

      // SPARQL query to find all books in series
      const query = `
        SELECT DISTINCT ?isbn13 ?ordinal
        WHERE {
          ?book wdt:P179 wd:${safeQid} .  # Part of the series (sanitized)
          ?book wdt:P212 ?isbn13 .        # ISBN-13
          OPTIONAL { ?book pq:P1545 ?ordinal . }  # Series ordinal
        }
        ORDER BY ?ordinal
        LIMIT 100
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(
        url,
        {}, // Uses client's default 10s timeout
        context
      );

      if (!response?.results?.bindings || response.results.bindings.length === 0) {
        logger.debug('No books found for series', { seriesId: safeQid });
        return [];
      }

      const isbns = response.results.bindings
        .map((b) => b.isbn13?.value)
        .filter((isbn): isbn is string => !!isbn);

      logger.debug('Fetched series books', {
        seriesId: safeQid,
        bookCount: isbns.length,
      });

      return isbns;
    } catch (error) {
      logger.error('Wikidata series books fetch failed', {
        seriesId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Fetch awards and nominations for a book by ISBN
   *
   * Uses SPARQL query with property P166 (award received) to find
   * all literary awards associated with a book.
   *
   * @param isbn - ISBN-13 or ISBN-10
   * @param context - Service context
   * @returns Array of AwardInfo objects, empty array if no awards found
   */
  async fetchAwards(isbn: string, context: ServiceContext): Promise<AwardInfo[]> {
    const { logger } = context;

    try {
      // Validate and normalize ISBN
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format, skipping Wikidata awards query', { isbn });
        return [];
      }

      // Sanitize for SPARQL injection prevention
      const safeIsbn = this.sanitizeSparql(normalizedISBN);

      // SPARQL query to find awards
      const query = `
        SELECT ?award ?awardLabel ?year ?category ?categoryLabel ?isWinner
        WHERE {
          ?book wdt:P212 "${safeIsbn}" .  # ISBN-13 (sanitized)
          ?book wdt:P166 ?award .         # Award received
          OPTIONAL { ?book pq:P585 ?year . }      # Point in time (qualifier)
          OPTIONAL { ?book pq:P2517 ?category . } # Category (qualifier)
          OPTIONAL { ?book pq:P1346 ?isWinner . } # Winner vs nominee
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(
        url,
        {}, // Uses client's default 10s timeout
        context
      );

      if (!response?.results?.bindings || response.results.bindings.length === 0) {
        logger.debug('No Wikidata awards found', { isbn });
        return [];
      }

      const awards: AwardInfo[] = response.results.bindings
        .map((binding): AwardInfo | null => {
          const awardName = binding.awardLabel?.value;
          if (!awardName) return null;

          const awardId = binding.award ? this.extractQid(binding.award.value) : undefined;
          const yearStr = binding.year?.value;
          const year = yearStr ? new Date(yearStr).getFullYear() : new Date().getFullYear();
          const category = binding.categoryLabel?.value;
          const isWinner = binding.isWinner ? true : false; // If P1346 exists, it's a winner

          return {
            awardName,
            year,
            category: category || undefined,
            isWinner,
            awardId: awardId || undefined,
            source: 'wikidata',
          };
        })
        .filter((award): award is AwardInfo => award !== null);

      logger.debug('Fetched awards', {
        isbn,
        awardCount: awards.length,
      });

      return awards;
    } catch (error) {
      logger.error('Wikidata awards fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Fetch translations of a book by ISBN
   *
   * Uses SPARQL query with property P629 (edition or translation of)
   * to find all editions/translations of the same work in different languages.
   *
   * @param isbn - ISBN-13 or ISBN-10 (for the original edition)
   * @param context - Service context
   * @returns Array of TranslationInfo objects, empty array if no translations found
   */
  async fetchTranslations(isbn: string, context: ServiceContext): Promise<TranslationInfo[]> {
    const { logger } = context;

    try {
      // Validate and normalize ISBN
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format, skipping Wikidata translations query', { isbn });
        return [];
      }

      // Sanitize for SPARQL injection prevention
      const safeIsbn = this.sanitizeSparql(normalizedISBN);

      // SPARQL query to find translations
      // Strategy: Find the work this edition belongs to, then find all other editions
      const query = `
        SELECT DISTINCT ?translationIsbn ?language ?languageLabel ?title ?translator ?translatorLabel ?publisher ?publishDate
        WHERE {
          # Find the work for the original ISBN
          ?originalBook wdt:P212 "${safeIsbn}" .
          ?originalBook wdt:P629 ?work .  # Edition or translation of

          # Find all other editions/translations of the same work
          ?translation wdt:P629 ?work .
          ?translation wdt:P212 ?translationIsbn .
          FILTER(?translationIsbn != "${safeIsbn}")  # Exclude original

          # Get language information
          ?translation wdt:P407 ?language .

          # Optional metadata
          OPTIONAL { ?translation rdfs:label ?title . FILTER(LANG(?title) = "en") }
          OPTIONAL { ?translation wdt:P655 ?translator . }
          OPTIONAL { ?translation wdt:P123 ?publisher . }
          OPTIONAL { ?translation wdt:P577 ?publishDate . }

          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 100
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(
        url,
        {}, // Uses client's default 10s timeout
        context
      );

      if (!response?.results?.bindings || response.results.bindings.length === 0) {
        logger.debug('No Wikidata translations found', { isbn });
        return [];
      }

      const translations: TranslationInfo[] = response.results.bindings
        .map((binding): TranslationInfo | null => {
          const translationIsbn = binding.translationIsbn?.value;
          const languageLabel = binding.languageLabel?.value;

          if (!translationIsbn || !languageLabel) return null;

          // Extract ISO 639-1 language code from Wikidata language QID
          // For now, we use the language label as the name and derive a simple code
          const languageCode = this.deriveLanguageCode(languageLabel);

          return {
            isbn: translationIsbn,
            languageCode,
            languageName: languageLabel,
            translatedTitle: binding.title?.value || '',
            translators: binding.translatorLabel?.value ? [binding.translatorLabel.value] : undefined,
            publisher: binding.publisher?.value || undefined,
            publishDate: binding.publishDate?.value || undefined,
            source: 'wikidata',
          };
        })
        .filter((trans): trans is TranslationInfo => trans !== null);

      logger.debug('Fetched translations', {
        isbn,
        translationCount: translations.length,
      });

      return translations;
    } catch (error) {
      logger.error('Wikidata translations fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Derive ISO 639-1 language code from language name
   *
   * Simple mapping for common languages. In production, this should query
   * Wikidata's P218 (ISO 639-1 code) property for accurate codes.
   *
   * @private
   */
  private deriveLanguageCode(languageName: string): string {
    const mapping: Record<string, string> = {
      'English': 'en',
      'Spanish': 'es',
      'French': 'fr',
      'German': 'de',
      'Italian': 'it',
      'Portuguese': 'pt',
      'Russian': 'ru',
      'Japanese': 'ja',
      'Chinese': 'zh',
      'Korean': 'ko',
      'Arabic': 'ar',
      'Hindi': 'hi',
      'Dutch': 'nl',
      'Polish': 'pl',
      'Swedish': 'sv',
      'Danish': 'da',
      'Norwegian': 'no',
      'Finnish': 'fi',
      'Greek': 'el',
      'Turkish': 'tr',
      'Czech': 'cs',
      'Hungarian': 'hu',
      'Romanian': 'ro',
    };

    return mapping[languageName] || languageName.substring(0, 2).toLowerCase();
  }

  /**
   * Fetch enhanced external IDs for a book by ISBN
   *
   * Uses SPARQL query to extract all external identifiers from Wikidata.
   * Wikidata is comprehensive and authoritative for cross-provider linking.
   *
   * Properties queried:
   * - P212: ISBN-13
   * - P957: ISBN-10
   * - P2969: Goodreads work ID
   * - P7421: Google Books ID
   * - P1144: Library of Congress Classification
   * - P243: OCLC control number
   * - P6721: LibraryThing work ID
   *
   * @param isbn - ISBN-10 or ISBN-13
   * @param context - Service context with logger and env
   * @returns EnhancedExternalIds with all available IDs, or null if book not found
   *
   * @example
   * ```typescript
   * const result = await provider.fetchEnhancedExternalIds('9780486280615', context);
   * // Result:
   * // {
   * //   goodreadsId: '12345',
   * //   googleBooksId: 'XfFGPgAACAAJ',
   * //   librarythingId: '67890',
   * //   oclcNumber: '1234567',
   * //   lccn: '12345678',
   * //   sources: ['wikidata'],
   * //   confidence: 90
   * // }
   * ```
   */
  async fetchEnhancedExternalIds(
    isbn: string,
    context: ServiceContext
  ): Promise<EnhancedExternalIds | null> {
    const { logger } = context;

    try {
      // Validate and normalize ISBN
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format, skipping Wikidata external IDs query', { isbn });
        return null;
      }

      // Sanitize for SPARQL injection prevention
      const safeIsbn = this.sanitizeSparql(normalizedISBN);

      // SPARQL query to extract all external IDs
      const query = `
        SELECT ?goodreadsId ?googleBooksId ?librarythingId ?oclcNumber ?lccn ?wikidataQid
        WHERE {
          ?book wdt:P212 "${safeIsbn}" .  # ISBN-13 (sanitized)

          # Extract Wikidata QID (entity identifier)
          BIND(REPLACE(STR(?book), "http://www.wikidata.org/entity/", "") AS ?wikidataQid)

          # External IDs (all optional)
          OPTIONAL { ?book wdt:P2969 ?goodreadsId . }      # Goodreads work ID
          OPTIONAL { ?book wdt:P7421 ?googleBooksId . }    # Google Books ID
          OPTIONAL { ?book wdt:P6721 ?librarythingId . }   # LibraryThing work ID
          OPTIONAL { ?book wdt:P243 ?oclcNumber . }        # OCLC control number
          OPTIONAL { ?book wdt:P1144 ?lccn . }             # Library of Congress Classification
        }
        LIMIT 1
      `;

      const params = new URLSearchParams({
        query,
        format: 'json',
      });

      const url = `${WIKIDATA_SPARQL_ENDPOINT}?${params.toString()}`;
      const response = await this.client.fetch<WikidataSparqlResponse>(
        url,
        {}, // Uses client's default 10s timeout
        context
      );

      if (!response?.results?.bindings?.[0]) {
        logger.debug('No Wikidata external IDs found', { isbn });
        return null;
      }

      const binding = response.results.bindings[0];

      // Extract all available IDs
      const result: EnhancedExternalIds = {
        goodreadsId: binding.goodreadsId?.value,
        googleBooksId: binding.googleBooksId?.value,
        librarythingId: binding.librarythingId?.value,
        wikidataQid: binding.wikidataQid?.value,
        oclcNumber: binding.oclcNumber?.value,
        lccn: binding.lccn?.value,
        sources: ['wikidata'],
        confidence: 90, // Wikidata is comprehensive and authoritative
      };

      // Count how many IDs we found
      const idCount = [
        result.goodreadsId,
        result.googleBooksId,
        result.librarythingId,
        result.wikidataQid,
        result.oclcNumber,
        result.lccn,
      ].filter(Boolean).length;

      logger.debug('Fetched enhanced external IDs from Wikidata', {
        isbn: normalizedISBN,
        idCount,
        hasGoodreads: !!result.goodreadsId,
        hasGoogleBooks: !!result.googleBooksId,
        hasLibraryThing: !!result.librarythingId,
        hasWikidata: !!result.wikidataQid,
        hasOCLC: !!result.oclcNumber,
        hasLCCN: !!result.lccn,
      });

      return result;
    } catch (error) {
      logger.error('Wikidata external IDs fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
