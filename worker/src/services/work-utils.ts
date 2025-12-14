/**
 * Work and Author Utility Functions
 *
 * Extracted from workflows/author-harvest.ts for reuse across routes.
 * These functions handle work deduplication and author linking.
 */

import postgres from 'postgres';
import { formatPgArray } from './utils.js';

// Cache for author lookups within a request (reduces DB queries)
const authorKeyCache = new Map<string, string>();

// Cache for work lookups (ISBN → work_key)
const workKeyCache = new Map<string, string>();

/**
 * Find or create an author by name, returning the author_key
 */
export async function findOrCreateAuthor(
  sql: ReturnType<typeof postgres>,
  authorName: string
): Promise<string> {
  // Check cache first
  const cached = authorKeyCache.get(authorName.toLowerCase());
  if (cached) return cached;

  // Try exact match first (fast)
  const exactMatch = await sql`
    SELECT author_key FROM enriched_authors
    WHERE LOWER(name) = ${authorName.toLowerCase()}
    LIMIT 1
  `;

  if (exactMatch.length > 0) {
    const key = (exactMatch[0] as { author_key: string }).author_key;
    authorKeyCache.set(authorName.toLowerCase(), key);
    return key;
  }

  // Try fuzzy match with pg_trgm (slower but catches variations)
  const fuzzyMatch = await sql`
    SELECT author_key, name, similarity(LOWER(name), ${authorName.toLowerCase()}) as sim
    FROM enriched_authors
    WHERE LOWER(name) % ${authorName.toLowerCase()}
    ORDER BY sim DESC
    LIMIT 1
  `;

  if (fuzzyMatch.length > 0 && (fuzzyMatch[0] as { sim: number }).sim > 0.7) {
    const key = (fuzzyMatch[0] as { author_key: string }).author_key;
    authorKeyCache.set(authorName.toLowerCase(), key);
    return key;
  }

  // Create new author
  const newKey = `/authors/isbndb-${crypto.randomUUID().slice(0, 8)}`;
  await sql`
    INSERT INTO enriched_authors (author_key, name, primary_provider, created_at, updated_at)
    VALUES (${newKey}, ${authorName}, 'isbndb', NOW(), NOW())
    ON CONFLICT (author_key) DO NOTHING
  `;

  authorKeyCache.set(authorName.toLowerCase(), newKey);
  return newKey;
}

/**
 * Link a work to its authors in work_authors_enriched
 * Uses ON CONFLICT DO NOTHING for idempotency (safe to call multiple times)
 */
export async function linkWorkToAuthors(
  sql: ReturnType<typeof postgres>,
  workKey: string,
  authorNames: string[]
): Promise<void> {
  for (let i = 0; i < authorNames.length; i++) {
    const authorKey = await findOrCreateAuthor(sql, authorNames[i]);
    await sql`
      INSERT INTO work_authors_enriched (work_key, author_key, author_order)
      VALUES (${workKey}, ${authorKey}, ${i + 1})
      ON CONFLICT (work_key, author_key) DO NOTHING
    `;
  }
}

/**
 * Find or create a work by ISBN/title/authors, returning work_key and whether it's new
 *
 * Resolution order (consensus-driven):
 * 1. ISBN lookup - check if edition already exists with work_key (most accurate)
 * 2. Author-scoped fuzzy title match - find work by same author with similar title (0.8 threshold)
 * 3. Exact title match - fallback for works without author links yet (risky for common titles)
 * 4. Generate new synthetic key - only if no match found
 */
export async function findOrCreateWork(
  sql: ReturnType<typeof postgres>,
  isbn: string,
  title: string,
  authorNames: string[]
): Promise<{ workKey: string; isNew: boolean }> {
  // Check cache first (ISBN → work_key)
  const cached = workKeyCache.get(isbn);
  if (cached) {
    return { workKey: cached, isNew: false };
  }

  // Step 0: Check if edition already exists with a work_key (ISBN is most accurate)
  const existingEdition = await sql`
    SELECT work_key FROM enriched_editions
    WHERE isbn = ${isbn} AND work_key IS NOT NULL
    LIMIT 1
  `;
  if (existingEdition.length > 0) {
    const workKey = (existingEdition[0] as { work_key: string }).work_key;
    workKeyCache.set(isbn, workKey);
    return { workKey, isNew: false };
  }

  // Step 1: Author-scoped fuzzy title match (if we have authors)
  if (authorNames && authorNames.length > 0) {
    // Get or create author keys first
    const authorKeys = await Promise.all(
      authorNames.slice(0, 3).map(name => findOrCreateAuthor(sql, name)) // Limit to first 3 authors
    );

    // Format author keys as PostgreSQL array literal for ANY() clause
    const authorKeysArray = formatPgArray(authorKeys);
    const existingWork = authorKeysArray ? await sql`
      SELECT ew.work_key, similarity(LOWER(ew.title), ${title.toLowerCase()}) as sim
      FROM enriched_works ew
      JOIN work_authors_enriched wae ON ew.work_key = wae.work_key
      WHERE wae.author_key = ANY(${authorKeysArray}::text[])
        AND similarity(LOWER(ew.title), ${title.toLowerCase()}) > 0.8
      ORDER BY sim DESC
      LIMIT 1
    ` : [];
    if (existingWork.length > 0) {
      const workKey = (existingWork[0] as { work_key: string }).work_key;
      workKeyCache.set(isbn, workKey);
      return { workKey, isNew: false };
    }
  }

  // Step 2: Exact title match fallback (use with caution - common titles may collide)
  // Only use exact match, not fuzzy, to reduce false positives
  const exactMatch = await sql`
    SELECT work_key FROM enriched_works
    WHERE LOWER(title) = ${title.toLowerCase()}
    LIMIT 1
  `;
  if (exactMatch.length > 0) {
    const workKey = (exactMatch[0] as { work_key: string }).work_key;
    workKeyCache.set(isbn, workKey);
    return { workKey, isNew: false };
  }

  // Step 3: Generate new synthetic key
  const newKey = `/works/isbndb-${crypto.randomUUID().slice(0, 8)}`;
  workKeyCache.set(isbn, newKey);
  return { workKey: newKey, isNew: true };
}

/**
 * Clear the in-memory caches (useful between requests or for testing)
 */
export function clearWorkUtilsCaches(): void {
  authorKeyCache.clear();
  workKeyCache.clear();
}
