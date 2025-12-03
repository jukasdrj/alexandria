/**
 * Smart Enrichment Service
 *
 * Automatically enriches Alexandria's database when external data is fetched.
 * This is the "brain transplant" logic that makes Alexandria self-sufficient.
 */

import type { Sql } from 'postgres';
import type { Env } from '../env.d.js';
import type { ExternalBookData } from './external-apis.js';
import { resolveExternalISBN } from './external-apis.js';

// =================================================================================
// Database Storage Logic
// =================================================================================

/**
 * Stores external book data in Alexandria's database.
 * Creates edition, work, author, and relationship records as needed.
 *
 * @param sql - PostgreSQL client
 * @param bookData - External book data to store
 * @returns The stored edition key
 */
async function storeExternalBookData(sql: Sql, bookData: ExternalBookData): Promise<string> {
  console.log(`[Smart Enrich] Storing data for ISBN ${bookData.isbn} from ${bookData.provider}`);

  // 1. Generate keys for new entities (using UUID for guaranteed uniqueness)
  const editionKey = bookData.editionKey || `/books/${crypto.randomUUID()}`;
  const workKey = bookData.workKey || `/works/${crypto.randomUUID()}`;

  // 2. Create work record (if not exists)
  const workData = {
    title: bookData.title,
    subtitle: bookData.subtitle,
    description: bookData.description,
    covers: bookData.coverUrls?.large ? [bookData.coverUrls.large] : [],
  };

  await sql`
    INSERT INTO works (key, type, revision, data, last_modified)
    VALUES (
      ${workKey},
      '/type/work',
      1,
      ${JSON.stringify(workData)}::jsonb,
      NOW()
    )
    ON CONFLICT (key) DO UPDATE SET
      data = works.data || ${JSON.stringify(workData)}::jsonb,
      last_modified = NOW()
  `;

  // 3. Create edition record
  const editionData = {
    title: bookData.title,
    subtitle: bookData.subtitle,
    publishers: bookData.publisher ? [bookData.publisher] : [],
    publish_date: bookData.publicationDate,
    number_of_pages: bookData.pageCount,
    languages: bookData.language ? [{ key: `/languages/${bookData.language}` }] : [],
    description: bookData.description,
    covers: bookData.coverUrls?.large ? [bookData.coverUrls.large] : [],
    isbn_10: bookData.isbn.length === 10 ? [bookData.isbn] : [],
    isbn_13: bookData.isbn.length === 13 ? [bookData.isbn] : [],
    source_provider: bookData.provider,
    fetched_at: new Date().toISOString(),
  };

  await sql`
    INSERT INTO editions (key, type, revision, work_key, data, last_modified)
    VALUES (
      ${editionKey},
      '/type/edition',
      1,
      ${workKey},
      ${JSON.stringify(editionData)}::jsonb,
      NOW()
    )
    ON CONFLICT (key) DO UPDATE SET
      data = editions.data || ${JSON.stringify(editionData)}::jsonb,
      last_modified = NOW()
  `;

  // 4. Store ISBN mapping
  await sql`
    INSERT INTO edition_isbns (edition_key, isbn)
    VALUES (${editionKey}, ${bookData.isbn})
    ON CONFLICT (edition_key, isbn) DO NOTHING
  `;

  // 5. Create author records (if any) - PARALLEL for better performance
  if (bookData.authors && bookData.authors.length > 0) {
    await Promise.all(bookData.authors.map(async (authorName) => {
      // Generate author key (or use existing if it's a key)
      const authorKey = authorName.startsWith('/authors/')
        ? authorName
        : `/authors/${crypto.randomUUID()}`;

      const authorData = {
        name: authorName,
        source_provider: bookData.provider,
        fetched_at: new Date().toISOString(),
      };

      // Insert author
      await sql`
        INSERT INTO authors (key, type, revision, data, last_modified)
        VALUES (
          ${authorKey},
          '/type/author',
          1,
          ${JSON.stringify(authorData)}::jsonb,
          NOW()
        )
        ON CONFLICT (key) DO UPDATE SET
          data = authors.data || ${JSON.stringify(authorData)}::jsonb,
          last_modified = NOW()
      `;

      // Link author to work
      await sql`
        INSERT INTO author_works (author_key, work_key)
        VALUES (${authorKey}, ${workKey})
        ON CONFLICT (author_key, work_key) DO NOTHING
      `;
    }));
  }

  console.log(`[Smart Enrich] ✓ Stored edition ${editionKey} with work ${workKey}`);
  return editionKey;
}

// =================================================================================
// Main Smart Enrichment Logic
// =================================================================================

/**
 * Result type for smart ISBN resolution.
 * Matches the format expected by /api/search response.
 */
export interface SmartResolveResult {
  title: string;
  author: string | null;
  isbn: string;
  coverUrl: string | null;
  coverSource: string;
  publish_date: string | null;
  publishers: string[] | null;
  pages: number | null;
  work_title: string;
  openlibrary_edition: string | null;
  openlibrary_work: string | null;
  _enriched: boolean;
  _provider: 'isbndb' | 'google-books' | 'openlibrary';
  _storage_failed?: boolean;
}

/**
 * Smart resolution with automatic database enrichment.
 * This is called when /api/search finds no results for an ISBN.
 *
 * Flow:
 * 1. Fetch from external APIs (ISBNdb → Google Books → OpenLibrary)
 * 2. If found, store in Alexandria's database
 * 3. Return the newly stored data
 *
 * @param isbn - The ISBN to resolve
 * @param sql - PostgreSQL client
 * @param env - Worker environment with API keys
 * @returns The resolved book data, or null if not found anywhere
 */
export async function smartResolveISBN(
  isbn: string,
  sql: Sql,
  env: Env
): Promise<SmartResolveResult | null> {
  console.log(`[Smart Resolve] Starting resolution for ISBN: ${isbn}`);

  // 0. Check if this ISBN previously failed (cache "not found" results)
  const cacheKey = `isbn_not_found:${isbn}`;
  const cachedNotFound = await env.CACHE.get(cacheKey);
  if (cachedNotFound) {
    console.log(`[Smart Resolve] ISBN ${isbn} previously failed, skipping external lookup`);
    return null;
  }

  // 1. Fetch from external APIs
  const externalData = await resolveExternalISBN(isbn, env);

  if (!externalData) {
    // Cache the "not found" result to prevent repeated expensive API calls
    await env.CACHE.put(cacheKey, 'true', {
      expirationTtl: parseInt(env.CACHE_TTL_LONG) // 24 hours (86400s)
    });
    console.warn(`[Smart Resolve] No external data found for ISBN ${isbn}, cached failure`);
    return null;
  }

  // 2. Store in Alexandria's database
  try {
    const editionKey = await storeExternalBookData(sql, externalData);

    // 3. Return the formatted result (matching /api/search response format)
    return {
      title: externalData.title,
      author: externalData.authors?.[0] || null, // First author
      isbn: externalData.isbn,
      coverUrl: externalData.coverUrls?.large || null,
      coverSource: 'external-provider',
      publish_date: externalData.publicationDate || null,
      publishers: externalData.publisher ? [externalData.publisher] : null,
      pages: externalData.pageCount || null,
      work_title: externalData.title,
      openlibrary_edition: externalData.editionKey
        ? `https://openlibrary.org${externalData.editionKey}`
        : null,
      openlibrary_work: externalData.workKey
        ? `https://openlibrary.org${externalData.workKey}`
        : null,
      _enriched: true, // Flag to indicate this was auto-enriched
      _provider: externalData.provider,
    };
  } catch (error) {
    console.error('[Smart Resolve] Failed to store external data:', error);
    // Even if storage fails, return the data we fetched
    return {
      title: externalData.title,
      author: externalData.authors?.[0] || null,
      isbn: externalData.isbn,
      coverUrl: externalData.coverUrls?.large || null,
      coverSource: 'external-provider',
      publish_date: externalData.publicationDate || null,
      publishers: externalData.publisher ? [externalData.publisher] : null,
      pages: externalData.pageCount || null,
      _enriched: true,
      _provider: externalData.provider,
      _storage_failed: true,
    };
  }
}

/**
 * Check if an ISBN should trigger smart resolution.
 * Can be extended with rate limiting, caching, or business rules.
 *
 * @param isbn - The ISBN to check
 * @param env - Worker environment
 * @returns True if smart resolution should be attempted
 */
export function shouldResolveExternally(isbn: string, env: Env): boolean {
  // For now, always attempt resolution on cache miss
  // Future: Add rate limiting, user quotas, or API key checks
  return true;
}
