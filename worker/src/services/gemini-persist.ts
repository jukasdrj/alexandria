/**
 * Gemini Result Persistence - Save Expensive AI Results Immediately
 *
 * PROBLEM: Gemini generates valuable book metadata (title, author, publisher, year)
 * but current flow discards it if ISBNdb quota is exhausted or enrichment fails.
 *
 * SOLUTION: Save Gemini results to database IMMEDIATELY as minimal work records.
 * Later, enhance these records with ISBNdb data when quota available.
 *
 * STAGED ENRICHMENT:
 * - Stage 1 (No quota): Save Gemini metadata → synthetic works, minimal editions
 * - Stage 2 (Later): Enhance with ISBNdb → full metadata, covers, descriptions
 *
 * @module services/gemini-persist
 */

import type postgres from 'postgres';
import type { Logger } from '../../lib/logger.js';
import type { ResolvedCandidate } from './types/backfill.js';

// =================================================================================
// Types
// =================================================================================

export interface GeminiPersistStats {
  works_created: number;
  editions_created: number;
  works_updated: number;
  editions_updated: number;
  failed: number;
  errors: Array<{ isbn: string; error: string }>;
}

/**
 * Save Gemini-generated book metadata to database immediately
 *
 * Creates minimal enriched_works and enriched_editions records with:
 * - Title, author, publisher, format, year (from Gemini)
 * - ISBN (from ISBNdb resolution)
 * - synthetic=true flag (indicates AI-generated, not human-verified)
 * - completeness_score=30 (minimal data, needs ISBNdb enhancement)
 * - primary_provider='gemini-backfill'
 *
 * Benefits:
 * - Preserves expensive Gemini API results even if ISBNdb quota exhausted
 * - Allows searching for books immediately (title/author search)
 * - Can enhance later with ISBNdb when quota available
 *
 * @param candidates - ResolvedCandidate array from hybrid backfill (Gemini + ISBNdb resolution)
 * @param sql - PostgreSQL connection
 * @param logger - Logger instance
 * @param source - Source identifier (e.g., 'backfill-2024-01')
 * @returns Statistics about what was saved
 */
export async function persistGeminiResults(
  candidates: ResolvedCandidate[],
  sql: postgres.Sql,
  logger: Logger,
  source: string
): Promise<GeminiPersistStats> {
  const stats: GeminiPersistStats = {
    works_created: 0,
    editions_created: 0,
    works_updated: 0,
    editions_updated: 0,
    failed: 0,
    errors: [],
  };

  logger.info('[GeminiPersist] Starting persistence', {
    candidate_count: candidates.length,
    source,
  });

  // Process each candidate
  for (const candidate of candidates) {
    try {
      // Validate candidate has required fields
      if (!candidate.title || !candidate.author) {
        logger.warn('[GeminiPersist] Skipping candidate without title/author', {
          isbn: candidate.isbn,
          has_title: !!candidate.title,
          has_author: !!candidate.author,
        });
        stats.failed++;
        stats.errors.push({
          isbn: candidate.isbn || 'unknown',
          error: 'Missing title or author',
        });
        continue;
      }

      // Create synthetic work_key from title (normalized)
      const workKey = generateSyntheticWorkKey(candidate.title, candidate.author);

      // Create or update enriched_works (synthetic work)
      const workResult = await sql`
        INSERT INTO enriched_works (
          work_key,
          title,
          first_publication_year,
          synthetic,
          primary_provider,
          completeness_score,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          ${workKey},
          ${candidate.title},
          ${candidate.year || null},
          true, -- synthetic: AI-generated, not human-verified
          'gemini-backfill',
          30, -- Minimal completeness (needs ISBNdb enhancement)
          ${JSON.stringify({
            gemini_source: source,
            gemini_author: candidate.author,
            gemini_publisher: candidate.publisher,
            gemini_format: candidate.format,
            gemini_significance: candidate.significance,
            gemini_persisted_at: new Date().toISOString(),
          })},
          NOW(),
          NOW()
        )
        ON CONFLICT (work_key) DO UPDATE SET
          -- Update metadata to add Gemini info if not already present
          metadata = enriched_works.metadata || ${JSON.stringify({
            gemini_source: source,
            gemini_persisted_at: new Date().toISOString(),
          })},
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `.execute();

      if (workResult[0]?.inserted) {
        stats.works_created++;
      } else {
        stats.works_updated++;
      }

      // Only create edition if we have an ISBN
      // When ISBNdb quota exhausted, we save work-only records
      if (!candidate.isbn) {
        logger.info('[GeminiPersist] Saved work without ISBN (quota exhausted scenario)', {
          work_key: workKey,
          title: candidate.title,
          author: candidate.author,
        });
        continue;
      }

      // Create or update enriched_editions (minimal edition)
      const editionResult = await sql`
        INSERT INTO enriched_editions (
          isbn,
          work_key,
          title,
          publisher,
          publication_date,
          format,
          primary_provider,
          completeness_score,
          work_match_confidence,
          work_match_source,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          ${candidate.isbn},
          ${workKey},
          ${candidate.title},
          ${candidate.publisher || null},
          ${candidate.year ? candidate.year.toString() : null},
          ${candidate.format || 'Unknown'},
          'gemini-backfill',
          30, -- Minimal completeness
          50, -- Low confidence (synthetic work match)
          'gemini-synthetic',
          ${JSON.stringify({
            gemini_source: source,
            gemini_author: candidate.author,
            gemini_significance: candidate.significance,
            gemini_persisted_at: new Date().toISOString(),
            needs_isbndb_enhancement: true,
          })},
          NOW(),
          NOW()
        )
        ON CONFLICT (isbn) DO UPDATE SET
          -- Only update if current record is also Gemini-sourced (don't overwrite ISBNdb data)
          metadata = CASE
            WHEN enriched_editions.primary_provider = 'gemini-backfill' THEN
              enriched_editions.metadata || ${JSON.stringify({
                gemini_source: source,
                gemini_updated_at: new Date().toISOString(),
              })}
            ELSE enriched_editions.metadata
          END,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `.execute();

      if (editionResult[0]?.inserted) {
        stats.editions_created++;
      } else {
        stats.editions_updated++;
      }

      logger.debug('[GeminiPersist] Saved candidate', {
        isbn: candidate.isbn,
        work_key: workKey,
        title: candidate.title,
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('[GeminiPersist] Failed to save candidate', {
        isbn: candidate.isbn,
        title: candidate.title,
        error: errorMsg,
      });

      stats.failed++;
      stats.errors.push({
        isbn: candidate.isbn || 'unknown',
        error: errorMsg,
      });
    }
  }

  logger.info('[GeminiPersist] Persistence complete', {
    works_created: stats.works_created,
    editions_created: stats.editions_created,
    works_updated: stats.works_updated,
    editions_updated: stats.editions_updated,
    failed: stats.failed,
    source,
  });

  return stats;
}

/**
 * Generate synthetic work key from title and author
 * Format: synthetic:normalized-title:normalized-author
 *
 * This allows grouping multiple editions under the same synthetic work
 * Later, when ISBNdb data arrives, we can merge synthetic works with real ones
 */
function generateSyntheticWorkKey(title: string, author?: string): string {
  // Normalize title: lowercase, remove punctuation, collapse whitespace
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, '-') // Collapse whitespace to hyphens
    .substring(0, 50); // Truncate to 50 chars

  // Normalize author (optional)
  const normalizedAuthor = author
    ? author
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 30)
    : 'unknown';

  return `synthetic:${normalizedTitle}:${normalizedAuthor}`;
}
