// =================================================================================
// External ID Crosswalk Utilities
// =================================================================================
//
// Provides lazy backfill utilities for populating external_id_mappings table
// from enriched_editions array columns. This enables fast external ID lookups
// without disrupting the existing enrichment pipeline.
//
// Usage Pattern:
// 1. Query external_id_mappings (crosswalk)
// 2. If empty, call backfillExternalIdsFromArrays() once per ISBN
// 3. Subsequent queries hit crosswalk (500x faster: 0.75ms vs 2605ms)
//
// @module services/external-id-utils

import type { Sql } from 'postgres';
import type { Logger } from '../../lib/logger.js';
import type { ArrayExternalIds, ExternalIdMapping } from './types.js';

/**
 * Confidence scores for external ID providers
 * Tuned based on data quality and authority
 */
const PROVIDER_CONFIDENCE: Record<string, number> = {
  amazon: 90, // High confidence (ISBNdb validated)
  'google-books': 85, // Good confidence (Google validation)
  goodreads: 80, // Medium-high (community validated)
  librarything: 75, // Medium (smaller community)
};

/**
 * Backfill external_id_mappings from enriched_editions array columns
 *
 * This is a one-time operation per ISBN. Parses array columns
 * (amazon_asins, google_books_volume_ids, goodreads_edition_ids, librarything_ids)
 * and batch inserts into external_id_mappings table.
 *
 * @param sql - PostgreSQL connection (request-scoped)
 * @param isbn - ISBN to backfill (our_key in crosswalk)
 * @param edition - Edition record with array columns
 * @param logger - Logger instance for structured logging
 * @returns Count of mappings inserted (excludes conflicts)
 *
 * @example
 * const edition = await sql`
 *   SELECT amazon_asins, google_books_volume_ids,
 *          goodreads_edition_ids, librarything_ids
 *   FROM enriched_editions WHERE isbn = ${isbn}
 * `;
 * const count = await backfillExternalIdsFromArrays(sql, isbn, edition[0], logger);
 * // count = 5 (3 amazon, 1 google, 1 goodreads)
 */
export async function backfillExternalIdsFromArrays(
  sql: Sql,
  isbn: string,
  edition: ArrayExternalIds,
  logger: Logger
): Promise<number> {
  const startTime = Date.now();

  // Build mappings array from all available external ID fields
  const mappings: Array<{
    provider: string;
    provider_id: string;
    confidence: number;
    source: string;
  }> = [];

  // Parse Amazon ASINs
  if (edition.amazon_asins && Array.isArray(edition.amazon_asins)) {
    for (const asin of edition.amazon_asins) {
      if (asin && asin.trim()) {
        mappings.push({
          provider: 'amazon',
          provider_id: asin.trim(),
          confidence: PROVIDER_CONFIDENCE.amazon,
          source: 'array-backfill',
        });
      }
    }
  }

  // Parse Google Books Volume IDs
  if (edition.google_books_volume_ids && Array.isArray(edition.google_books_volume_ids)) {
    for (const volumeId of edition.google_books_volume_ids) {
      if (volumeId && volumeId.trim()) {
        mappings.push({
          provider: 'google-books',
          provider_id: volumeId.trim(),
          confidence: PROVIDER_CONFIDENCE['google-books'],
          source: 'array-backfill',
        });
      }
    }
  }

  // Parse Goodreads Edition IDs
  if (edition.goodreads_edition_ids && Array.isArray(edition.goodreads_edition_ids)) {
    for (const grId of edition.goodreads_edition_ids) {
      if (grId && grId.trim()) {
        mappings.push({
          provider: 'goodreads',
          provider_id: grId.trim(),
          confidence: PROVIDER_CONFIDENCE.goodreads,
          source: 'array-backfill',
        });
      }
    }
  }

  // Parse LibraryThing IDs
  if (edition.librarything_ids && Array.isArray(edition.librarything_ids)) {
    for (const ltId of edition.librarything_ids) {
      if (ltId && ltId.trim()) {
        mappings.push({
          provider: 'librarything',
          provider_id: ltId.trim(),
          confidence: PROVIDER_CONFIDENCE.librarything,
          source: 'array-backfill',
        });
      }
    }
  }

  // If no mappings found, return early
  if (mappings.length === 0) {
    logger.debug('No external IDs to backfill', { isbn });
    return 0;
  }

  try {
    // Batch insert using json_to_recordset for efficiency
    const result = await sql`
      INSERT INTO external_id_mappings (
        entity_type,
        our_key,
        provider,
        provider_id,
        confidence,
        mapping_source,
        mapping_method
      )
      SELECT
        'edition',
        ${isbn},
        provider,
        provider_id,
        confidence,
        source,
        'lazy-backfill'
      FROM json_to_recordset(${JSON.stringify(mappings)}) AS t(
        provider TEXT,
        provider_id TEXT,
        confidence INT,
        source TEXT
      )
      ON CONFLICT (entity_type, our_key, provider, provider_id) DO NOTHING
    `;

    const insertedCount = result.count || 0;
    const duration = Date.now() - startTime;

    logger.info('Backfilled external IDs', {
      isbn,
      total_mappings: mappings.length,
      inserted: insertedCount,
      skipped: mappings.length - insertedCount,
      duration_ms: duration,
    });

    return insertedCount;
  } catch (error) {
    logger.error('Backfill external IDs failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      isbn,
      mapping_count: mappings.length,
    });

    throw new Error(
      `External ID backfill failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get all external IDs for an entity from the crosswalk table
 *
 * Returns mappings ordered by provider (alphabetically) and confidence (descending).
 * This ensures consistent ordering and prioritizes highest confidence mappings
 * when multiple IDs exist for the same provider.
 *
 * @param sql - PostgreSQL connection (request-scoped)
 * @param entity_type - Type of entity ('edition', 'work', 'author')
 * @param our_key - Our internal key (ISBN for editions, work_key for works, author_key for authors)
 * @returns Array of external ID mappings
 *
 * @example
 * const ids = await getExternalIds(sql, 'edition', '9780439064873');
 * // [
 * //   { provider: 'amazon', provider_id: 'B000FC1MCS', confidence: 90, created_at: ... },
 * //   { provider: 'goodreads', provider_id: '2089208', confidence: 80, created_at: ... }
 * // ]
 */
export async function getExternalIds(
  sql: Sql,
  entity_type: string,
  our_key: string
): Promise<ExternalIdMapping[]> {
  const results = await sql<ExternalIdMapping[]>`
    SELECT
      provider,
      provider_id,
      confidence,
      created_at
    FROM external_id_mappings
    WHERE entity_type = ${entity_type}
      AND our_key = ${our_key}
    ORDER BY provider, confidence DESC
  `;

  return results.map((row) => ({
    provider: row.provider,
    provider_id: row.provider_id,
    confidence: row.confidence,
    created_at: row.created_at,
  }));
}

/**
 * Find entity by external ID (reverse lookup)
 *
 * Searches for the highest-confidence mapping for a given provider ID.
 * Returns both our_key and confidence in a single query (optimized to prevent N+1).
 * Returns null if no mapping exists. This is useful for resolving
 * external IDs (e.g., Amazon ASIN, Goodreads ID) to our internal keys.
 *
 * @param sql - PostgreSQL connection (request-scoped)
 * @param entity_type - Type of entity ('edition', 'work', 'author')
 * @param provider - Provider name (e.g., 'amazon', 'goodreads')
 * @param provider_id - External ID from provider
 * @returns Object with our_key and confidence, or null if not found
 *
 * @example
 * const result = await findByExternalId(sql, 'edition', 'amazon', 'B000FC1MCS');
 * // { our_key: '9780439064873', confidence: 90 }
 *
 * const result2 = await findByExternalId(sql, 'edition', 'goodreads', '999999');
 * // null (not found)
 */
export async function findByExternalId(
  sql: Sql,
  entity_type: string,
  provider: string,
  provider_id: string
): Promise<{ our_key: string; confidence: number } | null> {
  const result = await sql<Array<{ our_key: string; confidence: number }>>`
    SELECT
      our_key,
      confidence
    FROM external_id_mappings
    WHERE entity_type = ${entity_type}
      AND provider = ${provider}
      AND provider_id = ${provider_id}
    ORDER BY confidence DESC
    LIMIT 1
  `;

  return result[0] || null;
}
