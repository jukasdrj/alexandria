/**
 * Subject Enrichment Service
 *
 * Handles merging of subjects from multiple providers (ISBNdb, Google Books, etc.)
 * into enriched_works.subject_tags array.
 *
 * Supports Phase 2 of Issue #163: Multi-source subject enrichment for 70-80% coverage.
 *
 * @module services/subject-enrichment
 * @since 2.4.0
 */

import type { Sql } from 'postgres';
import type { Logger } from '../../lib/logger.js';

/**
 * Update work subjects by merging new categories with existing subjects
 *
 * Uses SQL-level deduplication via array_agg(DISTINCT) to prevent duplicates.
 * Updates contributors array to track provider involvement for analytics.
 *
 * **Pattern**: Follows enrichment-service.ts subject merging pattern (lines 395-402)
 *
 * **SQL Behavior**:
 * - Merges new categories with existing subject_tags
 * - Deduplicates using DISTINCT
 * - Adds provider to contributors array (if not already present)
 * - Updates timestamp
 *
 * **Error Handling**: Logs errors but doesn't throw - subject enrichment is optional
 *
 * @param sql - PostgreSQL connection (request-scoped)
 * @param workKey - Work key to update (e.g., "/works/OL123W")
 * @param newCategories - Categories from external provider (e.g., Google Books)
 * @param provider - Provider name for contributors tracking (default: 'google-books')
 * @param logger - Logger instance
 * @returns Promise<void>
 *
 * @example
 * ```typescript
 * // In enrichment queue after ISBNdb enrichment
 * const googleCategories = await extractGoogleBooksCategories(isbn, env, logger);
 * if (googleCategories.length > 0) {
 *   await updateWorkSubjects(sql, workKey, googleCategories, 'google-books', logger);
 * }
 * ```
 */
export async function updateWorkSubjects(
  sql: Sql,
  workKey: string,
  newCategories: string[],
  provider: string = 'google-books',
  logger?: Logger
): Promise<void> {
  if (!newCategories || newCategories.length === 0) {
    return; // Nothing to update
  }

  try {
    // SQL merges new categories with existing subjects using || operator + array_agg(DISTINCT)
    // This pattern matches enrichment-service.ts lines 395-402
    await sql`
      UPDATE enriched_works
      SET
        subject_tags = (
          SELECT array_agg(DISTINCT tag)
          FROM unnest(
            COALESCE(subject_tags, ARRAY[]::text[]) || ${sql.array(newCategories)}
          ) AS tag
        ),
        contributors = CASE
          WHEN ${provider} = ANY(COALESCE(contributors, ARRAY[]::text[]))
            THEN contributors
          ELSE array_append(COALESCE(contributors, ARRAY[]::text[]), ${provider})
        END,
        updated_at = NOW()
      WHERE work_key = ${workKey}
    `;

    if (logger) {
      logger.debug('Updated work subjects from external provider', {
        work_key: workKey,
        provider,
        categories_added: newCategories.length,
      });
    }

  } catch (error) {
    // Log but don't throw - subject enrichment is optional, shouldn't block main enrichment
    if (logger) {
      logger.error('Failed to update work subjects', {
        work_key: workKey,
        provider,
        categories_count: newCategories.length,
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      console.error(`[SubjectEnrichment] Failed to update work ${workKey}:`, error);
    }
  }
}

/**
 * Merge subjects from multiple sources with deduplication
 *
 * Utility function for combining subjects from different providers
 * before storing in database.
 *
 * @param existingSubjects - Subjects already in database
 * @param newSubjects - New subjects to merge
 * @returns Deduplicated array of subjects
 *
 * @example
 * ```typescript
 * const isbndbSubjects = ['Wizards', 'Magic', 'Fantasy'];
 * const googleSubjects = ['Fiction', 'Fantasy', 'Juvenile Fiction'];
 * const merged = mergeSubjects(isbndbSubjects, googleSubjects);
 * // Returns: ['Wizards', 'Magic', 'Fantasy', 'Fiction', 'Juvenile Fiction']
 * ```
 */
export function mergeSubjects(
  existingSubjects: string[] | null | undefined,
  newSubjects: string[]
): string[] {
  const existing = existingSubjects || [];
  const combined = [...existing, ...newSubjects];

  // Deduplicate using Set
  return Array.from(new Set(combined));
}

/**
 * Calculate subject quality score based on count and diversity
 *
 * Used for analytics and quality tracking.
 *
 * @param subjects - Subject array
 * @returns Quality score (0-100)
 *
 * Score Breakdown:
 * - 0 subjects: 0 points
 * - 1-2 subjects: 40 points
 * - 3-5 subjects: 70 points
 * - 6-10 subjects: 90 points
 * - 11+ subjects: 100 points
 */
export function calculateSubjectQuality(subjects: string[] | null | undefined): number {
  if (!subjects || subjects.length === 0) return 0;

  const count = subjects.length;

  if (count === 1) return 30;
  if (count === 2) return 50;
  if (count <= 5) return 70;
  if (count <= 10) return 90;
  return 100;
}
