/**
 * Smart Enrichment Service
 *
 * Automatically enriches Alexandria's database when external data is fetched.
 * This is the "brain transplant" logic that makes Alexandria self-sufficient.
 */

import type { Sql } from 'postgres';
import type { Env } from '../src/env.js';
import type { ExternalBookData } from './external-apis.js';
import { resolveExternalISBN } from './external-apis.js';
import { enrichEdition, enrichWork, enrichAuthor } from '../src/services/enrichment-service.js';
import { selectBestCoverURL } from '../src/services/utils.js';

// =================================================================================
// Database Storage Logic
// =================================================================================

/**
 * Stores external book data in Alexandria's database.
 * Creates edition, work, author, and relationship records as needed.
 *
 * @param sql - PostgreSQL client
 * @param bookData - External book data to store
 * @param env - Worker environment with COVER_QUEUE binding
 * @returns The stored edition key
 */
async function storeExternalBookData(sql: Sql, bookData: ExternalBookData, env: Env): Promise<string> {
  console.log(`[Smart Enrich] Storing data for ISBN ${bookData.isbn} from ${bookData.provider}`);

  // Wrap all database operations in a transaction for atomicity
  return await sql.begin(async (transaction) => {
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

    await transaction`
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

    await transaction`
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
    await transaction`
      INSERT INTO edition_isbns (edition_key, isbn)
      VALUES (${editionKey}, ${bookData.isbn})
      ON CONFLICT (edition_key, isbn) DO NOTHING
    `;

    // 5. Create author records (if any) - PARALLEL for better performance
    const authorKeys: string[] = [];
    if (bookData.authors && bookData.authors.length > 0) {
      await Promise.all(bookData.authors.map(async (authorName) => {
        // Generate author key (or use existing if it's a key)
        const authorKey = authorName.startsWith('/authors/')
          ? authorName
          : `/authors/${crypto.randomUUID()}`;

        authorKeys.push(authorKey);

        const authorData = {
          name: authorName,
          source_provider: bookData.provider,
          fetched_at: new Date().toISOString(),
        };

        // Insert author
        await transaction`
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
        await transaction`
          INSERT INTO author_works (author_key, work_key)
          VALUES (${authorKey}, ${workKey})
          ON CONFLICT (author_key, work_key) DO NOTHING
        `;
      }));
    }

    console.log(`[Smart Enrich] ✓ Stored edition ${editionKey} with work ${workKey}`);

    // 6. ENRICHMENT: Populate enriched tables with cover URLs and metadata
    // This is critical for cover image capture from ISBNdb/Google Books
    console.log(`[Smart Enrich] Enriching tables for ISBN ${bookData.isbn}...`);

    try {
      // Enrich edition (most important - contains cover URLs!)
      await enrichEdition(transaction, {
        isbn: bookData.isbn,
        title: bookData.title,
        subtitle: bookData.subtitle,
        publisher: bookData.publisher,
        publication_date: bookData.publicationDate,
        page_count: bookData.pageCount,
        format: bookData.binding,
        language: bookData.language,
        primary_provider: bookData.provider,
        cover_urls: {
          large: bookData.coverUrls?.large,
          medium: bookData.coverUrls?.medium,
          small: bookData.coverUrls?.small,
          original: bookData.coverUrls?.original, // ISBNdb high-quality original
        },
        cover_source: bookData.provider,
        work_key: workKey,
        openlibrary_edition_id: editionKey,
        subjects: bookData.subjects,
        dewey_decimal: bookData.deweyDecimal,
        binding: bookData.binding,
        related_isbns: bookData.relatedISBNs,
      }, env);
      console.log(`[Smart Enrich] ✓ Enriched edition ${bookData.isbn}`);

      // Enrich work
      await enrichWork(transaction, {
        work_key: workKey,
        title: bookData.title,
        subtitle: bookData.subtitle,
        description: bookData.description,
        subject_tags: bookData.subjects,
        primary_provider: bookData.provider,
        cover_urls: {
          large: bookData.coverUrls?.large,
          medium: bookData.coverUrls?.medium,
          small: bookData.coverUrls?.small,
        },
        cover_source: bookData.provider,
        openlibrary_work_id: workKey,
      });
      console.log(`[Smart Enrich] ✓ Enriched work ${workKey}`);

      // Enrich authors
      if (bookData.authors && bookData.authors.length > 0) {
        for (let i = 0; i < bookData.authors.length; i++) {
          await enrichAuthor(transaction, {
            author_key: authorKeys[i],
            name: bookData.authors[i],
            primary_provider: bookData.provider,
            openlibrary_author_id: authorKeys[i],
          });
        }
        console.log(`[Smart Enrich] ✓ Enriched ${bookData.authors.length} author(s)`);
      }
    } catch (enrichError) {
      // Log but don't fail - core data is already stored
      console.error('[Smart Enrich] Enrichment failed (core data still saved):', enrichError);
    }

    return editionKey;
  });
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
    await storeExternalBookData(sql, externalData, env);

    // 3. Return the formatted result (matching /api/search response format)
    return {
      title: externalData.title,
      author: externalData.authors?.[0] || null, // First author
      isbn: externalData.isbn,
      coverUrl: selectBestCoverURL(externalData.coverUrls),
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
      work_title: externalData.title,
      openlibrary_edition: externalData.editionKey
        ? `https://openlibrary.org${externalData.editionKey}`
        : null,
      openlibrary_work: externalData.workKey
        ? `https://openlibrary.org${externalData.workKey}`
        : null,
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
export function shouldResolveExternally(_isbn: string, _env: Env): boolean {
  // For now, always attempt resolution on cache miss
  // Future: Add rate limiting, user quotas, or API key checks
  return true;
}
