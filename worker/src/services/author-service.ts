// =================================================================================
// Author Service - Business Logic for Author Operations
// =================================================================================

import type { Sql } from 'postgres';
import type { Env } from '../env.js';
import type { Logger } from '../../lib/logger.js';
import type { DatabaseRow } from '../types/database.js';
import { enrichWork, enrichEdition } from './enrichment-service.js';
import { findOrCreateWork, linkWorkToAuthors } from './work-utils.js';
import { createQuotaManager } from './quota-manager.js';
import { fetchWikidataMultipleBatches } from '../../services/wikidata-client.js';

// =================================================================================
// Types
// =================================================================================

export interface GetTopAuthorsParams {
  offset: number;
  limit: number;
  nocache?: boolean;
}

export interface TopAuthorsResult {
  authors: Array<{
    author_key: string;
    author_name: string;
    work_count: number;
  }>;
  pagination: {
    offset: number;
    limit: number;
    returned: number;
  };
}

export interface AuthorDetailsResult {
  author_key: string;
  name: string;
  gender: string | null;
  gender_qid: string | null;
  nationality: string | null;
  citizenship_qid: string | null;
  birth_year: number | null;
  death_year: number | null;
  birth_place: string | null;
  birth_place_qid: string | null;
  birth_country: string | null;
  birth_country_qid: string | null;
  death_place: string | null;
  death_place_qid: string | null;
  bio: string | null;
  bio_source: string | null;
  wikidata_id: string | null;
  openlibrary_author_id: string | null;
  goodreads_author_ids: string[] | null;
  author_photo_url: string | null;
  book_count: number;
  wikidata_enriched_at: string | null;
}

export interface GetAuthorBibliographyParams {
  author_name: string;
  max_pages?: number;
}

export interface AuthorBibliographyBook {
  isbn: string;
  title: string;
  author: string;
  publisher?: string;
  date_published?: string;
}

export interface AuthorBibliographyResult {
  author: string;
  books_found: number;
  pages_fetched: number;
  books: AuthorBibliographyBook[];
  not_found?: boolean;
  rate_limited?: boolean;
  error?: string;
}

export interface EnrichAuthorBibliographyParams {
  author_name: string;
  max_pages?: number;
  skip_existing?: boolean;
}

export interface EnrichAuthorBibliographyResult {
  author: string;
  books_found: number;
  already_existed: number;
  enriched: number;
  covers_queued: number;
  failed: number;
  pages_fetched: number;
  api_calls: number;
  quota_status: any;
  quota_exhausted: boolean;
  errors: Array<{ isbn: string; error: string }>;
  duration_ms: number;
  cached?: boolean;
}

interface ISBNdbAuthorBook {
  isbn?: string;
  isbn13?: string;
  title?: string;
  title_long?: string;
  authors?: string[];
  publisher?: string;
  date_published?: string;
  pages?: number;
  language?: string;
  synopsis?: string;
  image?: string;
  image_original?: string;
  subjects?: string[];
  binding?: string;
  dewey_decimal?: string[];
  related?: Record<string, string>;
}

interface ISBNdbAuthorResponse {
  books?: ISBNdbAuthorBook[];
  total?: number;
}

export interface EnrichmentStatusResult {
  total_authors: number;
  has_wikidata_id: number;
  wikidata_enriched: number;
  pending_enrichment: number;
  diversity_fields: {
    has_gender: number;
    has_nationality: number;
    has_birth_place: number;
  };
}

export interface EnrichWikidataParams {
  limit?: number;
  force_refresh?: boolean;
}

export interface EnrichWikidataResult {
  processed: number;
  enriched: number;
  wikidata_fetched: number;
  results: Array<{
    author_key: string;
    wikidata_id: string;
    fields_updated: string[];
    error?: string;
  }>;
}

// =================================================================================
// Service Functions
// =================================================================================

/**
 * Get top authors by work count
 *
 * Queries authors sorted by number of works, excluding institutional/corporate authors.
 * Uses work count instead of edition count for better ISBNdb coverage correlation.
 *
 * @param deps - Dependencies (sql, env for caching)
 * @param params - Query parameters (offset, limit, nocache)
 * @returns Top authors with pagination info
 */
export async function getTopAuthors(
  { sql, env }: { sql: Sql; env?: Env },
  params: GetTopAuthorsParams
): Promise<TopAuthorsResult> {
  const { offset, limit, nocache } = params;

  // Check cache first (expensive query ~20s)
  if (env && !nocache) {
    const cacheKey = `top_authors:${offset}:${limit}`;
    const cached = await env.CACHE.get(cacheKey, 'json');
    if (cached) {
      return cached as TopAuthorsResult;
    }
  }

  // Query authors sorted by work count (faster than edition count)
  // Excludes institutional/corporate authors that won't have ISBNdb entries
  const authors = await sql`
    SELECT
      a.key as author_key,
      a.data->>'name' as author_name,
      COUNT(*)::int as work_count
    FROM authors a
    JOIN author_works aw ON aw.author_key = a.key
    WHERE a.data->>'name' IS NOT NULL
      AND LENGTH(a.data->>'name') > 3
      AND a.data->>'name' !~* '^(United States|Great Britain|Anonymous|Congress|House|Senate|Committee|Department|Ministry|Government|Office|Board|Bureau|Commission|Council|Agency|Institute|Corporation|Company|Ltd|Inc|Corp|Association|Society|Foundation|University|College|Library|Museum|Press|Publishing|Rand McNally|ICON Group|Philip M\. Parker|\[name missing\])'
      AND a.data->>'name' NOT LIKE '%Congress%'
      AND a.data->>'name' NOT LIKE '%Parliament%'
      AND a.data->>'name' NOT LIKE '%Government%'
      AND a.data->>'name' NOT LIKE '%Ministry%'
    GROUP BY a.key, a.data->>'name'
    ORDER BY COUNT(*) DESC
    OFFSET ${offset}
    LIMIT ${limit}
  `;

  const result: TopAuthorsResult = {
    authors: authors.map((a) => ({
      author_key: a.author_key,
      author_name: a.author_name,
      work_count: a.work_count,
    })),
    pagination: {
      offset,
      limit,
      returned: authors.length,
    },
  };

  // Cache for 24 hours (expensive query)
  if (env) {
    const cacheKey = `top_authors:${offset}:${limit}`;
    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
  }

  return result;
}

/**
 * Get detailed information for a specific author
 *
 * Queries the enriched_authors table for comprehensive author metadata including
 * biographical information, Wikidata enrichment, and external identifiers.
 *
 * @param deps - Dependencies (sql connection)
 * @param key - Author key in OpenLibrary format (accepts both "OL123A" and "/authors/OL123A")
 * @returns Author details or null if not found
 */
export async function getAuthorDetails(
  { sql }: { sql: Sql },
  params: { key: string }
): Promise<{ success: boolean; data?: AuthorDetailsResult; error?: string; author_key?: string }> {
  // Handle both formats: "OL7234434A" and "/authors/OL7234434A"
  let authorKey = params.key;
  if (!authorKey.startsWith('/authors/')) {
    authorKey = `/authors/${authorKey}`;
  }

  const results = await sql`
    SELECT
      author_key,
      name,
      gender,
      gender_qid,
      nationality,
      citizenship_qid,
      birth_year,
      death_year,
      birth_place,
      birth_place_qid,
      birth_country,
      birth_country_qid,
      death_place,
      death_place_qid,
      bio,
      bio_source,
      wikidata_id,
      openlibrary_author_id,
      goodreads_author_ids,
      author_photo_url,
      book_count,
      wikidata_enriched_at
    FROM enriched_authors
    WHERE author_key = ${authorKey}
    LIMIT 1
  `;

  if (results.length === 0) {
    return {
      success: false,
      error: 'Author not found',
      author_key: authorKey
    };
  }

  const author = results[0];

  return {
    success: true,
    data: {
      author_key: author.author_key,
      name: author.name,
      gender: author.gender ?? null,
      gender_qid: author.gender_qid ?? null,
      nationality: author.nationality ?? null,
      citizenship_qid: author.citizenship_qid ?? null,
      birth_year: author.birth_year ?? null,
      death_year: author.death_year ?? null,
      birth_place: author.birth_place ?? null,
      birth_place_qid: author.birth_place_qid ?? null,
      birth_country: author.birth_country ?? null,
      birth_country_qid: author.birth_country_qid ?? null,
      death_place: author.death_place ?? null,
      death_place_qid: author.death_place_qid ?? null,
      bio: author.bio ?? null,
      bio_source: author.bio_source ?? null,
      wikidata_id: author.wikidata_id ?? null,
      openlibrary_author_id: author.openlibrary_author_id ?? null,
      goodreads_author_ids: author.goodreads_author_ids ?? null,
      author_photo_url: author.author_photo_url ?? null,
      book_count: author.book_count ?? 0,
      wikidata_enriched_at: author.wikidata_enriched_at?.toISOString() ?? null,
    }
  };
}

/**
 * Get enrichment status statistics
 *
 * Queries enriched_authors table for overall enrichment progress including
 * total authors, Wikidata coverage, and diversity field completion.
 *
 * @param deps - Dependencies (sql connection)
 * @returns Enrichment status statistics
 */
export async function getEnrichmentStatus(
  { sql }: { sql: Sql }
): Promise<{ success: boolean; data?: EnrichmentStatusResult; error?: string; message?: string }> {
  try {
    const stats = await sql`
      SELECT
        COUNT(*) as total_authors,
        COUNT(wikidata_id) as has_wikidata_id,
        COUNT(wikidata_enriched_at) as wikidata_enriched,
        COUNT(CASE WHEN gender IS NOT NULL AND gender != 'Unknown' THEN 1 END) as has_gender,
        COUNT(nationality) as has_nationality,
        COUNT(birth_place) as has_birth_place,
        COUNT(CASE WHEN wikidata_id IS NOT NULL AND wikidata_enriched_at IS NULL THEN 1 END) as pending_enrichment
      FROM enriched_authors
    `;

    return {
      success: true,
      data: {
        total_authors: Number(stats[0].total_authors),
        has_wikidata_id: Number(stats[0].has_wikidata_id),
        wikidata_enriched: Number(stats[0].wikidata_enriched),
        pending_enrichment: Number(stats[0].pending_enrichment),
        diversity_fields: {
          has_gender: Number(stats[0].has_gender),
          has_nationality: Number(stats[0].has_nationality),
          has_birth_place: Number(stats[0].has_birth_place),
        },
      }
    };
  } catch (error) {
    return {
      success: false,
      error: 'Status check failed',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Enrich authors with Wikidata diversity data
 *
 * Fetches diversity metadata (gender, nationality, birth place, etc.) from Wikidata
 * for authors who have wikidata_id but haven't been enriched yet.
 *
 * @param deps - Dependencies (sql connection)
 * @param params - Enrichment parameters (limit, force_refresh)
 * @returns Enrichment statistics and per-author results
 */
export async function enrichWikidataAuthors(
  { sql }: { sql: Sql },
  params: EnrichWikidataParams
): Promise<{ success: boolean; data?: EnrichWikidataResult; error?: string; message?: string }> {
  try {
    const { limit = 100, force_refresh = false } = params;

    // Get authors with wikidata_id but not yet enriched
    const authorsToEnrich = await sql`
      SELECT author_key, wikidata_id, name
      FROM enriched_authors
      WHERE wikidata_id IS NOT NULL
        AND (wikidata_enriched_at IS NULL OR ${force_refresh})
      ORDER BY
        CASE WHEN birth_year IS NOT NULL THEN 0 ELSE 1 END, -- Prioritize those with some data
        author_key
      LIMIT ${limit}
    `;

    if (authorsToEnrich.length === 0) {
      return {
        success: true,
        data: {
          processed: 0,
          enriched: 0,
          wikidata_fetched: 0,
          results: [],
        }
      };
    }

  // Extract Q-IDs for Wikidata batch fetch
  const qids = authorsToEnrich.map((a) => a.wikidata_id).filter(Boolean);

  // Fetch from Wikidata
  const wikidataResults = await fetchWikidataMultipleBatches(qids);

  // Update database
  let enrichedCount = 0;
  const results: Array<{
    author_key: string;
    wikidata_id: string;
    fields_updated: string[];
    error?: string;
  }> = [];

  for (const author of authorsToEnrich) {
    const data = wikidataResults.get(author.wikidata_id);

    if (data) {
      const fieldsUpdated: string[] = [];

      // Build update fields
      if (data.gender) fieldsUpdated.push('gender');
      if (data.gender_qid) fieldsUpdated.push('gender_qid');
      if (data.citizenship) fieldsUpdated.push('nationality');
      if (data.citizenship_qid) fieldsUpdated.push('citizenship_qid');
      if (data.birth_year) fieldsUpdated.push('birth_year');
      if (data.death_year) fieldsUpdated.push('death_year');
      if (data.birth_place) fieldsUpdated.push('birth_place');
      if (data.birth_place_qid) fieldsUpdated.push('birth_place_qid');
      if (data.birth_country) fieldsUpdated.push('birth_country');
      if (data.birth_country_qid) fieldsUpdated.push('birth_country_qid');
      if (data.death_place) fieldsUpdated.push('death_place');
      if (data.death_place_qid) fieldsUpdated.push('death_place_qid');
      if (data.occupations?.length) fieldsUpdated.push('occupations');
      if (data.image_url) fieldsUpdated.push('author_photo_url');

      // Convert undefined to null for postgres
      const gender = data.gender ?? null;
      const gender_qid = data.gender_qid ?? null;
      const citizenship = data.citizenship ?? null;
      const citizenship_qid = data.citizenship_qid ?? null;
      const birth_year = data.birth_year ?? null;
      const death_year = data.death_year ?? null;
      const birth_place = data.birth_place ?? null;
      const birth_place_qid = data.birth_place_qid ?? null;
      const birth_country = data.birth_country ?? null;
      const birth_country_qid = data.birth_country_qid ?? null;
      const death_place = data.death_place ?? null;
      const death_place_qid = data.death_place_qid ?? null;
      // TODO: Add occupations to UPDATE query when enriched_authors table has the column
      const image_url = data.image_url ?? null;

      await sql`
        UPDATE enriched_authors
        SET
          gender = COALESCE(${gender}, gender),
          gender_qid = COALESCE(${gender_qid}, gender_qid),
          nationality = COALESCE(${citizenship}, nationality),
          citizenship_qid = COALESCE(${citizenship_qid}, citizenship_qid),
          birth_year = COALESCE(${birth_year}, birth_year),
          death_year = COALESCE(${death_year}, death_year),
          birth_place = COALESCE(${birth_place}, birth_place),
          birth_place_qid = COALESCE(${birth_place_qid}, birth_place_qid),
          birth_country = COALESCE(${birth_country}, birth_country),
          birth_country_qid = COALESCE(${birth_country_qid}, birth_country_qid),
          death_place = COALESCE(${death_place}, death_place),
          death_place_qid = COALESCE(${death_place_qid}, death_place_qid),
          author_photo_url = COALESCE(${image_url}, author_photo_url),
          wikidata_enriched_at = NOW(),
          enrichment_source = 'wikidata',
          updated_at = NOW()
        WHERE author_key = ${author.author_key}
      `;

      enrichedCount++;
      results.push({
        author_key: author.author_key,
        wikidata_id: author.wikidata_id,
        fields_updated: fieldsUpdated,
      });
    } else {
      // Mark as attempted even if no data found
      await sql`
        UPDATE enriched_authors
        SET
          wikidata_enriched_at = NOW(),
          enrichment_source = 'wikidata_empty',
          updated_at = NOW()
        WHERE author_key = ${author.author_key}
      `;

      results.push({
        author_key: author.author_key,
        wikidata_id: author.wikidata_id,
        fields_updated: [],
        error: 'No data returned from Wikidata',
      });
    }
  }

    return {
      success: true,
      data: {
        processed: authorsToEnrich.length,
        enriched: enrichedCount,
        wikidata_fetched: wikidataResults.size,
        results,
      }
    };
  } catch (error) {
    return {
      success: false,
      error: 'Wikidata enrichment failed',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
/**
 * Get author bibliography from ISBNdb
 *
 * Fetches complete bibliography for an author from ISBNdb Premium API with pagination.
 * Uses 350ms delay between pages to respect 3 req/sec rate limit.
 *
 * @param deps - Dependencies (env for API key, optional logger)
 * @param params - Query parameters (author_name, max_pages)
 * @returns Author bibliography with books array and pagination info
 */
export async function getAuthorBibliography(
  { env, logger: providedLogger }: { env: Env; logger?: Logger },
  params: GetAuthorBibliographyParams
): Promise<AuthorBibliographyResult> {
  const { author_name, max_pages = 10 } = params;

  // Create no-op logger if not provided
  const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const logger = providedLogger || (noopLogger as unknown as Logger);

  try {
    // Get ISBNdb API key
    const apiKey = await env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      return {
        author: author_name,
        books_found: 0,
        pages_fetched: 0,
        books: [],
        error: 'ISBNdb API key not configured',
      };
    }

    const pageSize = 100;
    const books: AuthorBibliographyBook[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= max_pages) {
      // Use Premium endpoint for 3x throughput (3 req/sec vs 1 req/sec)
      const response = await fetch(
        `https://api.premium.isbndb.com/author/${encodeURIComponent(author_name)}?page=${page}&pageSize=${pageSize}`,
        {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 404) {
        // Author not found
        logger.info('[Bibliography] Author not found', { author_name });
        return {
          author: author_name,
          books_found: 0,
          pages_fetched: 0,
          books: [],
          not_found: true,
        };
      }

      if (response.status === 429) {
        logger.warn('[Bibliography] Rate limited by ISBNdb', { author_name, page });
        return {
          author: author_name,
          books_found: books.length,
          pages_fetched: page - 1,
          books,
          rate_limited: true,
        };
      }

      if (!response.ok) {
        logger.error('[Bibliography] ISBNdb API error', {
          author_name,
          status: response.status,
          page,
        });
        return {
          author: author_name,
          books_found: books.length,
          pages_fetched: page - 1,
          books,
          error: `ISBNdb API error: ${response.status}`,
        };
      }

      const data = await response.json() as ISBNdbAuthorResponse;

      // Debug: log the pagination info from ISBNdb
      logger.info('[Bibliography] Page info', {
        page,
        total: data.total,
        books_in_response: data.books?.length || 0,
      });

      if (data.books && Array.isArray(data.books)) {
        for (const book of data.books) {
          const isbn = book.isbn13 || book.isbn;
          if (isbn) {
            books.push({
              isbn,
              title: book.title || 'Unknown',
              author: book.authors?.[0] || author_name,
              publisher: book.publisher,
              date_published: book.date_published
            });
          }
        }
      }

      // ISBNdb pagination: if we got a full page, there might be more
      // Also check data.total if available
      const booksInResponse = data.books?.length || 0;
      const total = data.total || 0;

      // Continue if: we got a full page OR total indicates more pages exist
      hasMore = booksInResponse === pageSize || (total > 0 && books.length < total);

      logger.info('[Bibliography] After page', { page, collected: books.length, hasMore });

      page++;

      // Rate limit between pagination requests (ISBNdb Premium: 3 req/sec)
      if (hasMore && page <= max_pages) {
        await new Promise(resolve => setTimeout(resolve, 350)); // 350ms delay for 3 req/sec
      }
    }

    return {
      author: author_name,
      books_found: books.length,
      pages_fetched: page - 1,
      books,
    };
  } catch (error) {
    logger.error('Author bibliography error', {
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      author: author_name,
      books_found: 0,
      pages_fetched: 0,
      books: [],
      error: `Failed to fetch author bibliography: ${message}`,
    };
  }
}
/**
 * Enrich author bibliography from ISBNdb
 *
 * Fetches all books by an author from ISBNdb, enriches them in Alexandria database,
 * and queues cover downloads. Includes quota management and caching.
 *
 * @param deps - Dependencies (sql, env, logger)
 * @param params - Enrichment parameters (author_name, max_pages, skip_existing)
 * @returns Enrichment results with statistics
 */
export async function enrichAuthorBibliography(
  { sql, env, logger: providedLogger }: { sql: Sql; env: Env; logger?: Logger },
  params: EnrichAuthorBibliographyParams
): Promise<EnrichAuthorBibliographyResult> {
  const startTime = Date.now();
  const { author_name, max_pages = 10, skip_existing = true } = params;

  // Create no-op logger if not provided (enrichWork/enrichEdition require Logger)
  const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    perf: () => {},
    query: () => {},
  };
  const logger = providedLogger || (noopLogger as unknown as Logger);

  // Get ISBNdb API key
  const apiKey = await env.ISBNDB_API_KEY.get();
  if (!apiKey) {
    throw new Error('ISBNdb API key not configured');
  }

  // Check KV cache for this author (avoid redundant API calls)
  const cacheKey = `author_bibliography:${author_name.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = await env.CACHE.get(cacheKey, 'json');

  if (cached) {
    logger.info('[EnrichBibliography] Cache hit', { author_name });
    return {
      ...(cached as EnrichAuthorBibliographyResult),
      cached: true,
      duration_ms: Date.now() - startTime
    };
  }

  // Initialize QuotaManager
  const quotaManager = createQuotaManager(env.QUOTA_KV);
  const pageSize = 100;

  // Track results (including quota status)
  const results: EnrichAuthorBibliographyResult = {
    author: author_name,
    books_found: 0,
    already_existed: 0,
    enriched: 0,
    covers_queued: 0,
    failed: 0,
    pages_fetched: 0,
    api_calls: 0,
    quota_status: null as any,
    quota_exhausted: false,
    errors: [],
    duration_ms: 0
  };

  // Estimate how many pages we might need (max 100 pages for ISBNdb, 10,000 results)
  const estimatedMaxPages = Math.min(max_pages, 100);

  // Pre-check: Can we do at least one page?
  logger.info('[EnrichBibliography] Checking quota for author bibliography fetch', {
    author_name,
    estimated_max_pages: estimatedMaxPages
  });

  const initialQuotaCheck = await quotaManager.checkQuota(1, false);

  if (!initialQuotaCheck.allowed) {
    results.quota_status = initialQuotaCheck.status;
    logger.warn('[EnrichBibliography] Quota exhausted before starting', {
      author_name,
      reason: initialQuotaCheck.reason
    });
    throw new Error(`ISBNdb quota exhausted: ${initialQuotaCheck.reason}`);
  }

  // Collect all books from ISBNdb author endpoint (with full metadata!)
  const allBooks: Array<{
    isbn: string;
    title: string;
    authors: string[];
    publisher?: string;
    date_published?: string;
    pages?: number;
    language?: string;
    synopsis?: string;
    image?: string;
    image_original?: string;
    subjects?: string[];
    binding?: string;
    dewey_decimal?: string[];
    related?: Record<string, string>;
  }> = [];

  let page = 1;
  let hasMore = true;
  let quotaExhausted = false;

  while (hasMore && page <= max_pages && !quotaExhausted) {
    // Check quota BEFORE each API call
    const quotaCheck = await quotaManager.checkQuota(1, false);

    if (!quotaCheck.allowed) {
      logger.warn('[EnrichBibliography] Quota exhausted mid-operation', {
        author_name,
        page,
        books_collected: allBooks.length,
        reason: quotaCheck.reason
      });
      results.quota_status = quotaCheck.status;
      results.quota_exhausted = true;
      quotaExhausted = true;
      // Continue with partial results
      break;
    }

    // Make ISBNdb API call
    const response = await fetch(
      `https://api.premium.isbndb.com/author/${encodeURIComponent(author_name)}?page=${page}&pageSize=${pageSize}`,
      {
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    // Reserve quota for this call (using checkQuota with reserveQuota=true)
    const quotaReserve = await quotaManager.checkQuota(1, true);
    if (quotaReserve.allowed) {
      results.api_calls++;
    }

    if (response.status === 404) {
      logger.info('[EnrichBibliography] Author not found on ISBNdb', { author_name });
      break;
    }

    if (response.status === 429) {
      logger.error('[EnrichBibliography] Rate limited by ISBNdb', { author_name, page });
      results.quota_status = await quotaManager.getQuotaStatus();
      throw new Error('Rate limited by ISBNdb');
    }

    if (!response.ok) {
      logger.error('[EnrichBibliography] ISBNdb API error', {
        author_name,
        page,
        status: response.status
      });
      results.quota_status = await quotaManager.getQuotaStatus();
      throw new Error(`ISBNdb API error: ${response.status}`);
    }

    const data = await response.json() as ISBNdbAuthorResponse;
    results.pages_fetched = page;

    if (data.books && Array.isArray(data.books)) {
      for (const book of data.books) {
        const isbn = book.isbn13 || book.isbn;
        if (isbn) {
          allBooks.push({
            isbn,
            title: book.title_long || book.title || 'Unknown',
            authors: book.authors || [author_name],
            publisher: book.publisher,
            date_published: book.date_published,
            pages: book.pages,
            language: book.language,
            synopsis: book.synopsis,
            image: book.image,
            image_original: book.image_original, // High-quality cover (2hr expiry!)
            subjects: book.subjects,
            binding: book.binding,
            dewey_decimal: book.dewey_decimal,
            related: book.related,
          });
        }
      }
    }

    const booksInResponse = data.books?.length || 0;
    const total = data.total || 0;
    hasMore = booksInResponse === pageSize || (total > 0 && allBooks.length < total);

    logger.debug('[EnrichBibliography] Page fetched', {
      author_name,
      page,
      books_in_page: booksInResponse,
      total_collected: allBooks.length,
      has_more: hasMore
    });

    page++;

    // Rate limit between pagination requests (ISBNdb Premium: 3 req/sec = 350ms delay)
    if (hasMore && page <= max_pages && !quotaExhausted) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }

  results.books_found = allBooks.length;
  logger.info('[EnrichBibliography] Found books', {
    author_name,
    books_found: allBooks.length,
    api_calls: results.api_calls,
    quota_exhausted: quotaExhausted
  });

  if (allBooks.length === 0) {
    // Cache empty result to avoid repeated lookups
    await env.CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: 86400 });
    results.duration_ms = Date.now() - startTime;
    results.quota_status = await quotaManager.getQuotaStatus();
    return results;
  }

  // Check which ISBNs already exist (if skip_existing is true)
  let isbnsToEnrich = allBooks;

  if (skip_existing) {
    const allISBNs = allBooks.map(b => b.isbn);
    const existingResult = await sql`
      SELECT isbn FROM enriched_editions
      WHERE isbn IN ${sql(allISBNs)}
    `;
    const existingSet = new Set(existingResult.map((r: DatabaseRow) => r.isbn));
    results.already_existed = existingSet.size;

    isbnsToEnrich = allBooks.filter(b => !existingSet.has(b.isbn));
    logger.info('[EnrichBibliography] Existing vs new', {
      author_name,
      already_existed: existingSet.size,
      to_enrich: isbnsToEnrich.length
    });
  }

  // DIRECTLY enrich from the data we already have (NO re-fetch from ISBNdb!)
  for (const book of isbnsToEnrich) {
    try {
      // Find or create work (deduplication via consensus-driven algorithm)
      // Order: ISBN lookup → Author-scoped fuzzy title → Exact title → Generate new
      const { workKey, isNew: isNewWork } = await findOrCreateWork(
        sql,
        book.isbn,
        book.title,
        book.authors
      );

      // Only create enriched_work if it's genuinely new
      if (isNewWork) {
        await enrichWork(sql, {
          work_key: workKey,
          title: book.title,
          description: book.synopsis,
          subject_tags: book.subjects,
          primary_provider: 'isbndb',
        }, logger);
      }

      // ALWAYS link work to authors (idempotent via ON CONFLICT DO NOTHING)
      // This fixes the 99.8% orphaned works bug
      if (book.authors && book.authors.length > 0) {
        await linkWorkToAuthors(sql, workKey, book.authors);
      }

      // Create enriched_edition with all the metadata we already have
      // Prefer image_original for highest quality (but it expires in 2hrs!)
      const hasCover = book.image_original || book.image;
      const coverUrls = hasCover ? {
        original: book.image_original, // High-quality original (best for R2)
        large: book.image,
        medium: book.image,
        small: book.image,
      } : undefined;

      await enrichEdition(sql, {
        isbn: book.isbn,
        title: book.title,
        publisher: book.publisher,
        publication_date: book.date_published,
        page_count: book.pages,
        language: book.language,
        primary_provider: 'isbndb',
        cover_urls: coverUrls,
        cover_source: hasCover ? 'isbndb' : undefined,
        work_key: workKey,
        subjects: book.subjects,
        binding: book.binding,
        dewey_decimal: book.dewey_decimal,
        related_isbns: book.related,
      }, logger, env);

      results.enriched++;

      // Queue cover download - prefer image_original (expires in 2hrs!) for best quality
      if (hasCover) {
        try {
          const bestCoverUrl = book.image_original || book.image;
          await env.COVER_QUEUE.send({
            isbn: book.isbn,
            work_key: workKey,
            provider_url: bestCoverUrl,
            priority: 'high', // Bump priority since image_original expires!
            source: 'author_bibliography'
          });
          results.covers_queued++;
        } catch (queueError) {
          // Don't fail enrichment if cover queue fails
          logger.warn('[EnrichBibliography] Cover queue failed', {
            isbn: book.isbn,
            error: queueError instanceof Error ? queueError.message : String(queueError)
          });
        }
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.failed++;
      results.errors.push({ isbn: book.isbn, error: message });
    }
  }

  results.duration_ms = Date.now() - startTime;
  results.quota_status = await quotaManager.getQuotaStatus();

  // Cache successful result (24 hours)
  const cacheResult = { ...results, errors: [] }; // Don't cache individual errors
  await env.CACHE.put(cacheKey, JSON.stringify(cacheResult), { expirationTtl: 86400 });

  logger.info('[EnrichBibliography] Complete', {
    author_name,
    enriched: results.enriched,
    already_existed: results.already_existed,
    failed: results.failed,
    quota_exhausted: results.quota_exhausted,
    duration_ms: results.duration_ms
  });

  return results;
}
