/**
 * Wikidata SPARQL Service - Book Metadata & Cover Images
 *
 * Extends existing wikidata-client.ts (author diversity) with:
 * - ISBN → Book metadata lookups
 * - Book cover image extraction (P18 property)
 * - Author bibliography queries
 * - KV-backed rate limiting for distributed Workers
 * - Response caching (30-day TTL)
 *
 * **Integration**: Wikidata covers come AFTER Archive.org, BEFORE ISBNdb in priority chain
 *
 * Features:
 * - SPARQL query builders for books and authors
 * - KV-backed rate limiting (500ms between requests = 2 req/sec)
 * - Response caching (30-day TTL for metadata)
 * - Graceful error handling (returns null, never throws)
 * - User-Agent with donation link following API best practices
 *
 * @module services/wikidata
 * @since 2.3.0
 */

import { fetchWithRetry } from '../lib/fetch-utils.js';
import { normalizeISBN } from '../lib/isbn-utils.js';
import {
  enforceRateLimit,
  buildUserAgent,
  buildRateLimitKey,
  buildCacheKey,
  getCachedResponse,
  setCachedResponse,
  RATE_LIMITS,
  CACHE_TTLS,
} from '../lib/open-api-utils.js';
import type { Env } from '../src/env.js';
import type {
  WikidataBookMetadata,
  WikidataAuthorEnriched,
  WikidataBibliographyWork,
  WikidataSparqlResponse,
  WikidataSparqlBinding,
} from '../types/open-apis.js';
import type { CoverResult } from './cover-fetcher.js';
import type { Logger } from '../lib/logger.js';

// =================================================================================
// Constants
// =================================================================================

/**
 * Wikidata SPARQL endpoint
 */
const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * User-Agent for Wikidata API (with donation link)
 */
const USER_AGENT = buildUserAgent('wikidata', 'Book metadata enrichment');

// =================================================================================
// SPARQL Query Builders
// =================================================================================

/**
 * Build SPARQL query to find book by ISBN
 *
 * Searches for books using P212 (ISBN-13) or P957 (ISBN-10).
 * Returns: Q-ID, title, author Q-IDs, publication date, cover image
 *
 * @param isbn - Normalized ISBN (10 or 13 digits)
 * @returns SPARQL query string
 */
function buildISBNLookupQuery(isbn: string): string {
  // Try both ISBN-13 and ISBN-10 properties
  return `
    SELECT ?book ?bookLabel ?isbn13 ?isbn10 ?pubDate ?image
           (GROUP_CONCAT(DISTINCT ?authorLabel; separator="|") as ?authors)
           (GROUP_CONCAT(DISTINCT ?author; separator="|") as ?authorQids)
           (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") as ?genres)
           (GROUP_CONCAT(DISTINCT ?genre; separator="|") as ?genreQids)
           (GROUP_CONCAT(DISTINCT ?subjectLabel; separator="|") as ?subjects)
           (GROUP_CONCAT(DISTINCT ?subject; separator="|") as ?subjectQids)
           ?publisherLabel ?publisher
    WHERE {
      {
        ?book wdt:P212 "${isbn}" .
      } UNION {
        ?book wdt:P957 "${isbn}" .
      }

      OPTIONAL { ?book wdt:P212 ?isbn13 . }
      OPTIONAL { ?book wdt:P957 ?isbn10 . }
      OPTIONAL { ?book wdt:P577 ?pubDate . }
      OPTIONAL { ?book wdt:P18 ?image . }
      OPTIONAL { ?book wdt:P50 ?author . }
      OPTIONAL { ?book wdt:P123 ?publisher . }
      OPTIONAL { ?book wdt:P136 ?genre . }
      OPTIONAL { ?book wdt:P921 ?subject . }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?book ?bookLabel ?isbn13 ?isbn10 ?pubDate ?image ?publisherLabel ?publisher
    LIMIT 1
  `;
}

/**
 * Build SPARQL query for author bibliography (all works by author)
 *
 * Given a Wikidata Q-ID for an author, returns all works with ISBNs.
 *
 * @param authorQid - Wikidata Q-ID (e.g., "Q34660" for J.K. Rowling)
 * @returns SPARQL query string
 */
function buildAuthorBibliographyQuery(authorQid: string): string {
  return `
    SELECT ?work ?workLabel ?pubDate
           (GROUP_CONCAT(DISTINCT ?isbn13; separator="|") as ?isbn13s)
           (GROUP_CONCAT(DISTINCT ?isbn10; separator="|") as ?isbn10s)
           (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") as ?genres)
           (GROUP_CONCAT(DISTINCT ?genre; separator="|") as ?genreQids)
    WHERE {
      ?work wdt:P50 wd:${authorQid} .
      OPTIONAL { ?work wdt:P577 ?pubDate . }
      OPTIONAL { ?work wdt:P212 ?isbn13 . }
      OPTIONAL { ?work wdt:P957 ?isbn10 . }
      OPTIONAL { ?work wdt:P136 ?genre . }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?work ?workLabel ?pubDate
    ORDER BY DESC(?pubDate)
    LIMIT 100
  `;
}

/**
 * Build SPARQL query for comprehensive author metadata
 *
 * Extends basic author data with literary movements, awards, notable works.
 *
 * @param authorQid - Wikidata Q-ID
 * @returns SPARQL query string
 */
function buildAuthorMetadataQuery(authorQid: string): string {
  return `
    SELECT ?author ?authorLabel
           ?genderLabel ?gender
           ?citizenshipLabel ?citizenship
           ?birthDate ?deathDate
           ?birthPlaceLabel ?birthPlace
           ?birthCountryLabel ?birthCountry
           ?deathPlaceLabel ?deathPlace
           ?image
           (GROUP_CONCAT(DISTINCT ?occupationLabel; separator="|") as ?occupations)
           (GROUP_CONCAT(DISTINCT ?occupation; separator="|") as ?occupationQids)
           (GROUP_CONCAT(DISTINCT ?movementLabel; separator="|") as ?movements)
           (GROUP_CONCAT(DISTINCT ?movement; separator="|") as ?movementQids)
           (GROUP_CONCAT(DISTINCT ?awardLabel; separator="|") as ?awards)
           (GROUP_CONCAT(DISTINCT ?award; separator="|") as ?awardQids)
           (GROUP_CONCAT(DISTINCT ?notableWorkLabel; separator="|") as ?notableWorks)
           (GROUP_CONCAT(DISTINCT ?notableWork; separator="|") as ?notableWorkQids)
    WHERE {
      BIND(wd:${authorQid} AS ?author)

      OPTIONAL { ?author wdt:P21 ?gender . }
      OPTIONAL { ?author wdt:P27 ?citizenship . }
      OPTIONAL { ?author wdt:P569 ?birthDate . }
      OPTIONAL { ?author wdt:P570 ?deathDate . }
      OPTIONAL {
        ?author wdt:P19 ?birthPlace .
        OPTIONAL { ?birthPlace wdt:P17 ?birthCountry . }
      }
      OPTIONAL { ?author wdt:P20 ?deathPlace . }
      OPTIONAL { ?author wdt:P18 ?image . }
      OPTIONAL { ?author wdt:P106 ?occupation . }
      OPTIONAL { ?author wdt:P135 ?movement . }
      OPTIONAL { ?author wdt:P166 ?award . }
      OPTIONAL { ?author wdt:P800 ?notableWork . }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?author ?authorLabel ?genderLabel ?gender ?citizenshipLabel ?citizenship
             ?birthDate ?deathDate ?birthPlaceLabel ?birthPlace ?birthCountryLabel ?birthCountry
             ?deathPlaceLabel ?deathPlace ?image
  `;
}

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Extract Q-ID from Wikidata entity URI
 * e.g., "http://www.wikidata.org/entity/Q43361" -> "Q43361"
 */
function extractQid(uri: string): string | undefined {
  if (!uri) return undefined;
  const match = uri.match(/Q\d+$/);
  return match ? match[0] : undefined;
}

/**
 * Extract year from Wikidata date string
 * e.g., "1997-06-26T00:00:00Z" -> 1997
 */
function extractYear(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const match = dateStr.match(/^-?(\d{4})/);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  return dateStr.startsWith('-') ? -year : year; // Handle BCE dates
}

/**
 * Extract date string (YYYY-MM-DD) from Wikidata timestamp
 * e.g., "1997-06-26T00:00:00Z" -> "1997-06-26"
 */
function extractDate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const match = dateStr.match(/^(-?\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}

/**
 * Parse pipe-delimited string into array
 * e.g., "Fiction|Fantasy|Adventure" -> ["Fiction", "Fantasy", "Adventure"]
 */
function parsePipeDelimited(str: string | undefined): string[] | undefined {
  if (!str) return undefined;
  const items = str.split('|').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Execute SPARQL query against Wikidata endpoint
 *
 * @param query - SPARQL query string
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns SPARQL JSON response
 */
async function executeSparqlQuery(
  query: string,
  env: Env,
  logger?: Logger
): Promise<WikidataSparqlResponse | null> {
  try {
    // Enforce rate limit (500ms = 2 req/sec)
    const rateLimitKey = buildRateLimitKey('wikidata');
    await enforceRateLimit(env.CACHE, rateLimitKey, RATE_LIMITS['wikidata'], logger);

    // Execute query
    const response = await fetchWithRetry(
      WIKIDATA_SPARQL_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
          'User-Agent': USER_AGENT,
        },
        body: `query=${encodeURIComponent(query)}`,
      },
      {
        maxRetries: 3,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (logger) {
        logger.warn('Wikidata SPARQL query failed', {
          status: response.status,
          error: errorText.substring(0, 200),
        });
      }
      return null;
    }

    const data = await response.json() as WikidataSparqlResponse;
    return data;

  } catch (error) {
    if (logger) {
      logger.warn('Wikidata SPARQL query error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

// =================================================================================
// Public API
// =================================================================================

/**
 * Fetch book metadata from Wikidata by ISBN
 *
 * Searches Wikidata for books using ISBN-13 or ISBN-10.
 * Returns structured metadata including authors, genres, subjects, cover image.
 *
 * **Caching**: 30-day TTL (book metadata rarely changes)
 *
 * @param isbn - ISBN (10 or 13 digits)
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Book metadata or null if not found
 *
 * @example
 * ```typescript
 * const book = await fetchBookByISBN('9780747532743', env, logger);
 * if (book) {
 *   console.log(`Found: ${book.title} by ${book.author_names?.join(', ')}`);
 *   console.log(`Wikidata: https://www.wikidata.org/wiki/${book.qid}`);
 * }
 * ```
 */
export async function fetchBookByISBN(
  isbn: string,
  env: Env,
  logger?: Logger
): Promise<WikidataBookMetadata | null> {
  // Normalize ISBN
  const normalized = normalizeISBN(isbn);
  if (!normalized) {
    if (logger) {
      logger.warn('Invalid ISBN for Wikidata lookup', { isbn });
    }
    return null;
  }

  // Check cache
  const cacheKey = buildCacheKey('wikidata', 'book', normalized);
  const cached = await getCachedResponse<WikidataBookMetadata>(env.CACHE, cacheKey, logger);
  if (cached) {
    return cached;
  }

  // Build and execute SPARQL query
  const query = buildISBNLookupQuery(normalized);
  const response = await executeSparqlQuery(query, env, logger);

  if (!response || response.results.bindings.length === 0) {
    if (logger) {
      logger.debug('No Wikidata results for ISBN', { isbn: normalized });
    }
    return null;
  }

  // Parse first result
  const result = response.results.bindings[0];
  const bookUri = result.book?.value;
  if (!bookUri) return null;

  const qid = extractQid(bookUri);
  if (!qid) return null;

  // Extract data
  const metadata: WikidataBookMetadata = {
    qid,
    title: result.bookLabel?.value || 'Unknown',
    isbn13: result.isbn13?.value ? [result.isbn13.value] : undefined,
    isbn10: result.isbn10?.value ? [result.isbn10.value] : undefined,
    author_names: parsePipeDelimited(result.authors?.value),
    author_qids: parsePipeDelimited(result.authorQids?.value),
    publication_date: result.pubDate?.value ? extractDate(result.pubDate.value) : undefined,
    publisher_name: result.publisherLabel?.value,
    publisher_qid: result.publisher?.value ? extractQid(result.publisher.value) : undefined,
    genre_names: parsePipeDelimited(result.genres?.value),
    genre_qids: parsePipeDelimited(result.genreQids?.value),
    subject_names: parsePipeDelimited(result.subjects?.value),
    subject_qids: parsePipeDelimited(result.subjectQids?.value),
    image_url: result.image?.value,
    fetched_at: new Date().toISOString(),
    confidence: calculateBookConfidence(result),
  };

  // Cache result
  await setCachedResponse(env.CACHE, cacheKey, metadata, CACHE_TTLS['wikidata'], logger);

  return metadata;
}

/**
 * Calculate confidence score for book metadata
 *
 * @param result - SPARQL binding result
 * @returns Confidence score (0-100)
 */
function calculateBookConfidence(result: WikidataSparqlBinding): number {
  let confidence = 50; // Base confidence for finding the book

  if (result.authors?.value) confidence += 20; // Has authors
  if (result.pubDate?.value) confidence += 10; // Has publication date
  if (result.image?.value) confidence += 10; // Has cover image
  if (result.genres?.value) confidence += 5; // Has genres
  if (result.subjects?.value) confidence += 5; // Has subjects

  return Math.min(confidence, 100);
}

/**
 * Fetch cover image URL from Wikidata
 *
 * Lightweight wrapper around fetchBookByISBN that only returns cover URL.
 * Used by cover-fetcher.ts in priority chain.
 *
 * @param isbn - ISBN (10 or 13 digits)
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Cover result or null
 *
 * @example
 * ```typescript
 * const cover = await fetchWikidataCover('9780747532743', env, logger);
 * if (cover) {
 *   console.log(`Cover URL: ${cover.url}`);
 *   console.log(`Confidence: ${cover.confidence}`);
 * }
 * ```
 */
export async function fetchWikidataCover(
  isbn: string,
  env: Env,
  logger?: Logger
): Promise<CoverResult | null> {
  const book = await fetchBookByISBN(isbn, env, logger);

  if (!book || !book.image_url) {
    return null;
  }

  return {
    url: book.image_url,
    source: 'wikidata',
    quality: book.confidence >= 70 ? 'high' : book.confidence >= 50 ? 'medium' : 'low',
  };
}

/**
 * Fetch author bibliography from Wikidata
 *
 * Returns all works by an author (up to 100 most recent).
 * Includes ISBNs, genres, and publication dates.
 *
 * **Use Case**: Author page "Complete Works" section
 *
 * @param authorQid - Wikidata Q-ID (e.g., "Q34660")
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Array of bibliography works
 *
 * @example
 * ```typescript
 * const works = await fetchAuthorBibliography('Q34660', env, logger); // J.K. Rowling
 * console.log(`Found ${works.length} works by this author`);
 * ```
 */
export async function fetchAuthorBibliography(
  authorQid: string,
  env: Env,
  logger?: Logger
): Promise<WikidataBibliographyWork[]> {
  // Check cache
  const cacheKey = buildCacheKey('wikidata', 'biblio', authorQid);
  const cached = await getCachedResponse<WikidataBibliographyWork[]>(env.CACHE, cacheKey, logger);
  if (cached) {
    return cached;
  }

  // Build and execute SPARQL query
  const query = buildAuthorBibliographyQuery(authorQid);
  const response = await executeSparqlQuery(query, env, logger);

  if (!response || response.results.bindings.length === 0) {
    if (logger) {
      logger.debug('No Wikidata bibliography for author', { authorQid });
    }
    return [];
  }

  // Parse results
  const works: WikidataBibliographyWork[] = response.results.bindings.map(result => {
    const workQid = result.work?.value ? extractQid(result.work.value) : undefined;
    return {
      work_qid: workQid || '',
      work_title: result.workLabel?.value || 'Unknown',
      publication_date: result.pubDate?.value ? extractDate(result.pubDate.value) : undefined,
      isbn13: parsePipeDelimited(result.isbn13s?.value),
      isbn10: parsePipeDelimited(result.isbn10s?.value),
      genre: parsePipeDelimited(result.genres?.value),
      genre_qids: parsePipeDelimited(result.genreQids?.value),
    };
  });

  // Cache result
  await setCachedResponse(env.CACHE, cacheKey, works, CACHE_TTLS['wikidata'], logger);

  return works;
}

/**
 * Fetch comprehensive author metadata from Wikidata
 *
 * Returns full author profile including diversity data, literary movements, awards.
 * **Note**: Existing wikidata-client.ts provides basic diversity data; this extends it.
 *
 * @param authorQid - Wikidata Q-ID
 * @param env - Environment with KV bindings
 * @param logger - Optional logger
 * @returns Author enriched data or null
 */
export async function fetchAuthorMetadata(
  authorQid: string,
  env: Env,
  logger?: Logger
): Promise<WikidataAuthorEnriched | null> {
  // Check cache
  const cacheKey = buildCacheKey('wikidata', 'author', authorQid);
  const cached = await getCachedResponse<WikidataAuthorEnriched>(env.CACHE, cacheKey, logger);
  if (cached) {
    return cached;
  }

  // Build and execute SPARQL query
  const query = buildAuthorMetadataQuery(authorQid);
  const response = await executeSparqlQuery(query, env, logger);

  if (!response || response.results.bindings.length === 0) {
    if (logger) {
      logger.debug('No Wikidata metadata for author', { authorQid });
    }
    return null;
  }

  // Parse first result
  const result = response.results.bindings[0];

  const enriched: WikidataAuthorEnriched = {
    qid: authorQid,
    name: result.authorLabel?.value || 'Unknown',
    gender: result.genderLabel?.value,
    gender_qid: result.gender?.value ? extractQid(result.gender.value) : undefined,
    citizenship: parsePipeDelimited(result.citizenshipLabel?.value),
    citizenship_qids: parsePipeDelimited(result.citizenship?.value),
    birth_year: result.birthDate?.value ? extractYear(result.birthDate.value) : undefined,
    death_year: result.deathDate?.value ? extractYear(result.deathDate.value) : undefined,
    birth_place: result.birthPlaceLabel?.value,
    birth_place_qid: result.birthPlace?.value ? extractQid(result.birthPlace.value) : undefined,
    birth_country: result.birthCountryLabel?.value,
    birth_country_qid: result.birthCountry?.value ? extractQid(result.birthCountry.value) : undefined,
    death_place: result.deathPlaceLabel?.value,
    death_place_qid: result.deathPlace?.value ? extractQid(result.deathPlace.value) : undefined,
    occupations: parsePipeDelimited(result.occupations?.value),
    occupation_qids: parsePipeDelimited(result.occupationQids?.value),
    image_url: result.image?.value,
    movements: parsePipeDelimited(result.movements?.value),
    movement_qids: parsePipeDelimited(result.movementQids?.value),
    awards: parsePipeDelimited(result.awards?.value),
    award_qids: parsePipeDelimited(result.awardQids?.value),
    notable_works: parsePipeDelimited(result.notableWorks?.value),
    notable_work_qids: parsePipeDelimited(result.notableWorkQids?.value),
    fetched_at: new Date().toISOString(),
  };

  // Cache result
  await setCachedResponse(env.CACHE, cacheKey, enriched, CACHE_TTLS['wikidata'], logger);

  return enriched;
}
