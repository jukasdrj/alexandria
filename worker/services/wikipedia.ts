/**
 * Wikipedia Author Biography Fetcher Service
 *
 * ID-BASED APPROACH: Uses author_key and Wikidata QIDs for exact matching
 *
 * Lookup Strategy:
 * 1. Get author from enriched_authors by author_key
 * 2. Get Wikidata QID from enriched_authors OR source authors table
 * 3. If Wikidata QID exists → Use Wikidata API to get exact Wikipedia page title
 * 4. If no Wikidata QID → Fall back to name-based search with disambiguation
 * 5. Fetch Wikipedia page details (extracts, images, categories)
 * 6. Extract structured data and calculate confidence
 *
 * Features:
 * - ID-based lookup (eliminates fuzzy matching for 174K+ authors with Wikidata IDs)
 * - KV-backed rate limiting (1 req/sec, respectful to Wikipedia)
 * - Response caching (30-day TTL for biographies)
 * - Conservative disambiguation for name-based fallback
 * - Structured data extraction (birth year, nationality, image)
 * - Graceful error handling (returns null, never throws)
 *
 * @module services/wikipedia
 * @since 2.3.0
 */

import { fetchWithRetry } from '../lib/fetch-utils.js';
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
  WikipediaAuthorBiography,
  WikipediaQueryResponse,
  WikipediaPage,
  WikipediaCategory,
} from '../types/open-apis.js';
import type { Sql } from 'postgres';

// =================================================================================
// Constants
// =================================================================================

/**
 * Wikipedia API endpoint
 */
const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';

/**
 * Wikidata API endpoint
 */
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';

/**
 * User-Agent for Wikipedia/Wikidata API requests
 */
const USER_AGENT = buildUserAgent('wikipedia', 'Author biographies');

/**
 * Categories that indicate an author/writer page
 * Used for conservative disambiguation in name-based fallback
 */
const AUTHOR_CATEGORIES = [
  'births',      // Year-based birth categories (e.g., "1965 births")
  'writers',     // Generic writer category
  'novelists',   // Fiction authors
  'authors',     // Generic author category
  'poets',       // Poetry authors
  'journalists', // Non-fiction writers
  'essayists',   // Essay writers
  'playwrights', // Drama authors
  'dramatists',  // Drama authors
];

/**
 * Disambiguation page indicators
 * If ANY of these appear in categories or title, reject the match
 */
const DISAMBIGUATION_INDICATORS = [
  'disambiguation',
  'disambig',
  'set index',
];

// =================================================================================
// Author Data Lookup
// =================================================================================

/**
 * Author data from database
 */
interface AuthorData {
  author_key: string;
  name: string;
  wikidata_id: string | null;
}

/**
 * Get author data from database
 *
 * Tries enriched_authors first, then falls back to source authors table
 * to extract Wikidata QID from remote_ids JSONB
 *
 * @param sql - Database connection
 * @param authorKey - Author key (e.g., '/authors/OL23919A')
 * @returns Author data with Wikidata QID (if available)
 */
async function getAuthorData(sql: Sql, authorKey: string): Promise<AuthorData | null> {
  try {
    // Try enriched_authors first
    const enriched = await sql<AuthorData[]>`
      SELECT
        author_key,
        name,
        wikidata_id
      FROM enriched_authors
      WHERE author_key = ${authorKey}
      LIMIT 1
    `;

    if (enriched.length > 0 && enriched[0]) {
      const author = enriched[0];

      // If wikidata_id exists in enriched_authors, use it
      if (author.wikidata_id) {
        return author;
      }

      // Otherwise, try to extract from source authors table
      const source = await sql`
        SELECT
          key as author_key,
          data#>>'{0,name}' as name,
          data#>>'{0,remote_ids,wikidata}' as wikidata_id
        FROM authors
        WHERE key = ${authorKey}
        LIMIT 1
      `;

      if (source.length > 0 && source[0]) {
        return {
          author_key: authorKey,
          name: author.name || (source[0] as any).name || '',
          wikidata_id: (source[0] as any).wikidata_id || null,
        };
      }

      return author;
    }

    // Fallback: Try source authors table directly
    const source = await sql`
      SELECT
        key as author_key,
        data#>>'{0,name}' as name,
        data#>>'{0,remote_ids,wikidata}' as wikidata_id
      FROM authors
      WHERE key = ${authorKey}
      LIMIT 1
    `;

    if (source.length > 0 && source[0]) {
      return {
        author_key: authorKey,
        name: (source[0] as any).name || '',
        wikidata_id: (source[0] as any).wikidata_id || null,
      };
    }

    return null;
  } catch (error) {
    console.error('Failed to get author data:', (error as Error).message);
    return null;
  }
}

// =================================================================================
// Wikidata → Wikipedia Page Title Resolution
// =================================================================================

/**
 * Get Wikipedia page title from Wikidata QID
 *
 * Uses Wikidata API to get the English Wikipedia sitelink for a given QID.
 * This provides an exact page title without fuzzy matching.
 *
 * API: https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q34660&props=sitelinks/urls&sitefilter=enwiki
 *
 * @param wikidataQid - Wikidata QID (e.g., 'Q34660')
 * @param env - Worker environment (for rate limiting)
 * @returns Wikipedia page title or null if not found
 *
 * @example
 * ```typescript
 * const pageTitle = await getWikipediaPageTitleFromWikidata('Q34660', env);
 * // Returns: "J. K. Rowling"
 * ```
 */
async function getWikipediaPageTitleFromWikidata(
  wikidataQid: string,
  env: Env
): Promise<string | null> {
  try {
    // Enforce rate limit (use Wikipedia rate limit for simplicity)
    await enforceRateLimit(
      env.CACHE,
      buildRateLimitKey('wikipedia'),
      RATE_LIMITS['wikipedia']
    );

    // Build Wikidata API URL
    const wikidataUrl = new URL(WIKIDATA_API_URL);
    wikidataUrl.searchParams.set('action', 'wbgetentities');
    wikidataUrl.searchParams.set('ids', wikidataQid);
    wikidataUrl.searchParams.set('props', 'sitelinks/urls');
    wikidataUrl.searchParams.set('sitefilter', 'enwiki');
    wikidataUrl.searchParams.set('format', 'json');

    const response = await fetchWithRetry(
      wikidataUrl.toString(),
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      { timeoutMs: 10000, maxRetries: 2 }
    );

    if (!response.ok) {
      console.error(`Wikidata: API error ${response.status} for QID ${wikidataQid}`);
      return null;
    }

    const data = await response.json() as any;

    // Extract English Wikipedia page title
    const entity = data.entities?.[wikidataQid];
    const enwiki = entity?.sitelinks?.enwiki;

    if (!enwiki || !enwiki.title) {
      console.log(`Wikidata: No English Wikipedia page for QID ${wikidataQid}`);
      return null;
    }

    console.log(`Wikidata: Found Wikipedia page "${enwiki.title}" for QID ${wikidataQid}`);
    return enwiki.title;
  } catch (error) {
    console.error('Wikidata: API error:', (error as Error).message);
    return null;
  }
}

// =================================================================================
// Name-Based Fallback (Original Implementation)
// =================================================================================

/**
 * Search Wikipedia for a page by author name (FALLBACK ONLY)
 *
 * This is only used when no Wikidata QID is available.
 * Uses opensearch API to find matching page titles.
 *
 * @param authorName - Author name to search for
 * @param env - Worker environment (for rate limiting)
 * @returns Wikipedia page title or null if not found
 */
async function searchWikipediaByName(authorName: string, env: Env): Promise<string | null> {
  try {
    await enforceRateLimit(
      env.CACHE,
      buildRateLimitKey('wikipedia'),
      RATE_LIMITS['wikipedia']
    );

    const searchUrl = new URL(WIKIPEDIA_API_URL);
    searchUrl.searchParams.set('action', 'opensearch');
    searchUrl.searchParams.set('search', authorName);
    searchUrl.searchParams.set('limit', '5');
    searchUrl.searchParams.set('format', 'json');

    const response = await fetchWithRetry(
      searchUrl.toString(),
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      { timeoutMs: 10000, maxRetries: 2 }
    );

    if (!response.ok) {
      console.error(`Wikipedia: Search API error ${response.status} for "${authorName}"`);
      return null;
    }

    const data = await response.json() as [string, string[], string[], string[]];

    if (!data[1] || data[1].length === 0) {
      console.log(`Wikipedia: No search results for "${authorName}"`);
      return null;
    }

    const pageTitle = data[1][0];
    console.log(`Wikipedia: Found page "${pageTitle}" for author "${authorName}" (name-based fallback)`);
    return pageTitle;
  } catch (error) {
    console.error('Wikipedia: Search failed:', (error as Error).message);
    return null;
  }
}

// =================================================================================
// Wikipedia Page Data Fetching
// =================================================================================

/**
 * Fetch detailed page data from Wikipedia
 *
 * Uses query API with multiple props:
 * - extracts: First 2-3 paragraphs of text
 * - pageimages: Author portrait image
 * - categories: Page categories for disambiguation detection
 *
 * @param pageTitle - Wikipedia page title
 * @param env - Worker environment (for rate limiting)
 * @returns Page data or null if not found
 */
async function fetchWikipediaPageData(pageTitle: string, env: Env): Promise<WikipediaPage | null> {
  try {
    await enforceRateLimit(
      env.CACHE,
      buildRateLimitKey('wikipedia'),
      RATE_LIMITS['wikipedia']
    );

    const queryUrl = new URL(WIKIPEDIA_API_URL);
    queryUrl.searchParams.set('action', 'query');
    queryUrl.searchParams.set('titles', pageTitle);
    queryUrl.searchParams.set('prop', 'extracts|pageimages|categories');
    queryUrl.searchParams.set('exintro', '1');
    queryUrl.searchParams.set('explaintext', '1');
    queryUrl.searchParams.set('piprop', 'thumbnail');
    queryUrl.searchParams.set('pithumbsize', '500');
    queryUrl.searchParams.set('cllimit', '500');
    queryUrl.searchParams.set('format', 'json');

    const response = await fetchWithRetry(
      queryUrl.toString(),
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      { timeoutMs: 10000, maxRetries: 2 }
    );

    if (!response.ok) {
      console.error(`Wikipedia: Query API error ${response.status} for page "${pageTitle}"`);
      return null;
    }

    const data = await response.json() as WikipediaQueryResponse;

    const pages = data.query?.pages;
    if (!pages) {
      console.log(`Wikipedia: No page data for "${pageTitle}"`);
      return null;
    }

    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (page.missing !== undefined) {
      console.log(`Wikipedia: Page "${pageTitle}" does not exist`);
      return null;
    }

    return page;
  } catch (error) {
    console.error('Wikipedia: Page fetch failed:', (error as Error).message);
    return null;
  }
}

// =================================================================================
// Disambiguation & Validation
// =================================================================================

/**
 * Check if page is a disambiguation page
 */
function isDisambiguationPage(page: WikipediaPage): boolean {
  const titleLower = page.title.toLowerCase();
  for (const indicator of DISAMBIGUATION_INDICATORS) {
    if (titleLower.includes(indicator)) {
      console.log(`Wikipedia: Disambiguation page detected in title: "${page.title}"`);
      return true;
    }
  }

  if (page.categories) {
    for (const category of page.categories) {
      const categoryLower = category.title.toLowerCase();
      for (const indicator of DISAMBIGUATION_INDICATORS) {
        if (categoryLower.includes(indicator)) {
          console.log(`Wikipedia: Disambiguation page detected in categories: "${category.title}"`);
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if page has author-related categories
 */
function hasAuthorCategories(page: WikipediaPage): boolean {
  if (!page.categories || page.categories.length === 0) {
    console.log(`Wikipedia: No categories found for page "${page.title}"`);
    return false;
  }

  for (const category of page.categories) {
    const categoryLower = category.title.toLowerCase();
    for (const authorTerm of AUTHOR_CATEGORIES) {
      if (categoryLower.includes(authorTerm)) {
        console.log(
          `Wikipedia: Author category found for "${page.title}": "${category.title}"`
        );
        return true;
      }
    }
  }

  console.log(`Wikipedia: No author-related categories found for "${page.title}"`);
  return false;
}

// =================================================================================
// Data Extraction
// =================================================================================

/**
 * Extract birth year from Wikipedia categories
 */
function extractBirthYear(categories?: WikipediaCategory[]): number | undefined {
  if (!categories) return undefined;

  for (const category of categories) {
    const match = category.title.match(/(\d{4})\s+births/i);
    if (match) {
      const year = parseInt(match[1], 10);
      if (year >= 1000 && year <= new Date().getFullYear()) {
        return year;
      }
    }
  }

  return undefined;
}

/**
 * Extract death year from Wikipedia categories
 */
function extractDeathYear(categories?: WikipediaCategory[]): number | undefined {
  if (!categories) return undefined;

  for (const category of categories) {
    const match = category.title.match(/(\d{4})\s+deaths/i);
    if (match) {
      const year = parseInt(match[1], 10);
      if (year >= 1000 && year <= new Date().getFullYear()) {
        return year;
      }
    }
  }

  return undefined;
}

/**
 * Extract nationality from Wikipedia categories
 */
function extractNationality(categories?: WikipediaCategory[]): string[] {
  if (!categories) return [];

  const nationalities = new Set<string>();

  for (const category of categories) {
    const categoryLower = category.title.toLowerCase();

    for (const authorTerm of AUTHOR_CATEGORIES) {
      const pattern = new RegExp(`category:([a-z-]+)\\s+${authorTerm}`, 'i');
      const match = categoryLower.match(pattern);

      if (match && match[1]) {
        const nationality = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        nationalities.add(nationality);
      }
    }
  }

  return Array.from(nationalities);
}

/**
 * Calculate confidence score for biography match
 */
function calculateConfidence(
  page: WikipediaPage,
  birthYear?: number,
  hasWikidataQid?: boolean
): number {
  let confidence = 0;

  // Wikidata QID match (highest confidence)
  if (hasWikidataQid) {
    confidence += 50;
  }

  // Has extract (required)
  if (page.extract && page.extract.length > 50) {
    confidence += 20;
  }

  // Has birth year (strong signal)
  if (birthYear !== undefined) {
    confidence += 15;
  }

  // Has author categories (verified author)
  if (hasAuthorCategories(page)) {
    confidence += 10;
  }

  // Has image (completeness)
  if (page.thumbnail?.source) {
    confidence += 5;
  }

  return confidence;
}

/**
 * Build Wikipedia article URL from page title
 */
function buildWikipediaUrl(pageTitle: string): string {
  const encodedTitle = encodeURIComponent(pageTitle.replace(/ /g, '_'));
  return `https://en.wikipedia.org/wiki/${encodedTitle}`;
}

// =================================================================================
// Main Export
// =================================================================================

/**
 * Fetch author biography from Wikipedia by author_key
 *
 * ID-BASED LOOKUP STRATEGY:
 * 1. Get author data from database (enriched_authors + source authors)
 * 2. If Wikidata QID exists:
 *    - Use Wikidata API to get exact Wikipedia page title
 *    - Fetch Wikipedia page data (no disambiguation needed!)
 * 3. If no Wikidata QID:
 *    - Fall back to name-based search (opensearch API)
 *    - Apply conservative disambiguation checks
 * 4. Extract structured data (birth year, nationality, image)
 * 5. Calculate confidence score (0-100)
 * 6. Cache result (30-day TTL)
 *
 * This eliminates fuzzy matching for 174K+ authors with Wikidata IDs!
 *
 * @param sql - Database connection
 * @param authorKey - Author key (e.g., '/authors/OL23919A')
 * @param env - Worker environment with CACHE KV binding
 * @returns Author biography or null if not found
 *
 * @example
 * ```typescript
 * const bio = await fetchAuthorBiography(sql, '/authors/OL23919A', env);
 * if (bio) {
 *   console.log(`Source: ${bio.wikidata_qid ? 'Wikidata QID' : 'Name search'}`);
 *   console.log(`Birth year: ${bio.birth_year}`);
 *   console.log(`Confidence: ${bio.confidence}/100`);
 * }
 * ```
 */
export async function fetchAuthorBiography(
  sql: Sql,
  authorKey: string,
  env: Env
): Promise<WikipediaAuthorBiography | null> {
  try {
    // Check cache first (keyed by author_key for consistency)
    const cacheKey = buildCacheKey('wikipedia', 'bio', authorKey);
    const cached = await getCachedResponse<WikipediaAuthorBiography>(env.CACHE, cacheKey);

    if (cached) {
      console.log(`Wikipedia: Cache hit for author_key "${authorKey}"`);
      return cached;
    }

    // Step 1: Get author data from database
    const author = await getAuthorData(sql, authorKey);
    if (!author || !author.name) {
      console.log(`Wikipedia: Author not found for key "${authorKey}"`);
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['wikipedia']);
      return null;
    }

    let pageTitle: string | null = null;
    let hasWikidataQid = false;

    // Step 2: Try Wikidata QID → Wikipedia page title (ID-BASED - NO FUZZY MATCHING!)
    if (author.wikidata_id) {
      console.log(`Wikipedia: Using Wikidata QID ${author.wikidata_id} for "${author.name}"`);
      pageTitle = await getWikipediaPageTitleFromWikidata(author.wikidata_id, env);
      hasWikidataQid = !!pageTitle;
    }

    // Step 3: Fallback to name-based search if no Wikidata QID
    if (!pageTitle) {
      console.log(`Wikipedia: Falling back to name search for "${author.name}"`);
      pageTitle = await searchWikipediaByName(author.name, env);
    }

    if (!pageTitle) {
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['wikipedia']);
      return null;
    }

    // Step 4: Fetch Wikipedia page data
    const page = await fetchWikipediaPageData(pageTitle, env);
    if (!page) {
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['wikipedia']);
      return null;
    }

    // Step 5: Conservative disambiguation checks (only for name-based fallback)
    if (!hasWikidataQid) {
      if (isDisambiguationPage(page)) {
        console.log(`Wikipedia: Rejecting disambiguation page for "${author.name}"`);
        await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['wikipedia']);
        return null;
      }

      if (!hasAuthorCategories(page)) {
        console.log(`Wikipedia: Rejecting page without author categories for "${author.name}"`);
        await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['wikipedia']);
        return null;
      }
    }

    // Step 6: Verify we have meaningful extract
    if (!page.extract || page.extract.length < 50) {
      console.log(`Wikipedia: Rejecting page with insufficient extract for "${author.name}"`);
      await setCachedResponse(env.CACHE, cacheKey, null, CACHE_TTLS['wikipedia']);
      return null;
    }

    // Step 7: Extract structured data
    const birthYear = extractBirthYear(page.categories);
    const deathYear = extractDeathYear(page.categories);
    const nationality = extractNationality(page.categories);
    const imageUrl = page.thumbnail?.source;

    // Step 8: Calculate confidence score
    const confidence = calculateConfidence(page, birthYear, hasWikidataQid);

    // Step 9: Build result
    const biography: WikipediaAuthorBiography = {
      source: 'wikipedia',
      article_title: page.title,
      extract: page.extract,
      birth_year: birthYear,
      death_year: deathYear,
      nationality: nationality.length > 0 ? nationality : undefined,
      image_url: imageUrl,
      fetched_at: new Date().toISOString(),
      wikipedia_url: buildWikipediaUrl(page.title),
      wikidata_qid: author.wikidata_id || undefined,
      confidence,
    };

    // Step 10: Cache successful result
    await setCachedResponse(env.CACHE, cacheKey, biography, CACHE_TTLS['wikipedia']);

    console.log(
      `Wikipedia: Successfully fetched biography for "${author.name}" ` +
      `(method: ${hasWikidataQid ? 'Wikidata QID' : 'name search'}, confidence: ${confidence})`
    );
    return biography;
  } catch (error) {
    console.error('Wikipedia: Fetch error:', (error as Error).message);
    return null;
  }
}
