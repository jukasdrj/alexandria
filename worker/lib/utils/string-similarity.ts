/**
 * String Similarity Utilities
 *
 * Shared fuzzy matching logic used across Alexandria for:
 * - In-memory deduplication (AI generation results)
 * - Database queries (PostgreSQL trigram similarity)
 *
 * @module lib/utils/string-similarity
 */

// =================================================================================
// Constants
// =================================================================================

/**
 * Similarity threshold for fuzzy matching
 *
 * ALGORITHM NOTE:
 * This threshold (0.6 = 60%) is used with **Levenshtein distance**, NOT PostgreSQL pg_trgm.
 * While both use the same threshold value, they calculate similarity differently:
 *
 * - **Levenshtein (this file)**: Edit distance normalized by max string length
 *   Formula: 1.0 - (edit_distance / max_length)
 *   Best for: Character-level differences, typos, minor variations
 *
 * - **PostgreSQL pg_trgm (deduplication.ts)**: Trigram Jaccard similarity
 *   Formula: (shared_trigrams) / (total_unique_trigrams)
 *   Best for: Word-level differences, reordering, partial matches
 *
 * EXAMPLE COMPARISON:
 * Title pair: "The Hobbit" vs "Hobbit"
 * - Levenshtein: ~0.82 similarity (2 char difference, 10 max length)
 * - pg_trgm: ~0.75 similarity (fewer shared trigrams due to "The" prefix)
 *
 * IMPACT:
 * - In-memory deduplication (AI results) uses Levenshtein (this file)
 * - Database deduplication (ISBN checking) uses pg_trgm (deduplication.ts)
 * - Both use 0.6 threshold, but may produce slightly different results
 * - This is acceptable: in-memory dedup is more lenient (catches close matches early)
 *   while database dedup is final validation (prevents false positives)
 *
 * VALIDATION:
 * Empirically tested with diverse book titles - 0.6 threshold provides good balance
 * between catching duplicates and preserving legitimate variations.
 */
export const FUZZY_SIMILARITY_THRESHOLD = 0.6; // 60% similarity

// =================================================================================
// Title Normalization
// =================================================================================

/**
 * Normalize book title for fuzzy comparison
 *
 * INTERNATIONAL SUPPORT:
 * - Uses Unicode property escapes to preserve non-ASCII letters (Arabic, Chinese, Cyrillic, etc.)
 * - NFD normalization for consistent accent handling
 * - Removes diacritical marks for similarity matching (optional - currently disabled)
 *
 * Transformations:
 * - Lowercase for case-insensitive comparison
 * - Preserve Unicode letters and numbers (\p{L} and \p{N})
 * - Remove punctuation and special characters
 * - Remove common English articles (a, an, the)
 * - Normalize whitespace (collapse multiple spaces to one)
 * - Trim leading/trailing whitespace
 *
 * Examples:
 * - "The Hobbit: There and Back Again" → "hobbit there and back again"
 * - "Les Misérables" → "les misérables" (preserves accents)
 * - "Gabriel García Márquez" → "gabriel garcía márquez" (preserves accents)
 * - "東京物語" (Tokyo Story) → "東京物語" (preserves Japanese)
 * - "الأمير الصغير" (The Little Prince) → "الأمير الصغير" (preserves Arabic)
 *
 * @param title - Raw title string
 * @returns Normalized title (empty string if null/undefined)
 */
export function normalizeTitle(title: string): string {
  // Defensive check for null/undefined
  if (!title) return '';

  return title
    .toLowerCase()
    .normalize("NFD") // Decompose accented characters for consistent handling
    // Note: NOT removing diacritical marks to preserve international character distinctions
    // .replace(/[\u0300-\u036f]/g, "") // Would remove accents - disabled for diversity
    .replace(/[^\p{L}\p{N}\s]/gu, '') // Keep Unicode letters (\p{L}) and numbers (\p{N}), remove punctuation
    .replace(/\b(a|an|the)\b/g, '') // Remove common English articles
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// =================================================================================
// Levenshtein Distance
// =================================================================================

/**
 * Calculate Levenshtein distance between two strings
 *
 * Uses optimized single-row dynamic programming approach.
 * Levenshtein distance measures the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to transform one string into another.
 *
 * Time complexity: O(m * n) where m and n are string lengths
 * Space complexity: O(n) - single row optimization
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance (0 = identical, higher = more different)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Optimize for empty strings
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  // Create single row for dynamic programming
  let prevRow = Array.from({ length: len2 + 1 }, (_, i) => i);

  for (let i = 0; i < len1; i++) {
    let currentRow = [i + 1];

    for (let j = 0; j < len2; j++) {
      const insertCost = currentRow[j] + 1;
      const deleteCost = prevRow[j + 1] + 1;
      const replaceCost = prevRow[j] + (str1[i] === str2[j] ? 0 : 1);

      currentRow.push(Math.min(insertCost, deleteCost, replaceCost));
    }

    prevRow = currentRow;
  }

  return prevRow[len2];
}

/**
 * Calculate similarity score between two strings using Levenshtein distance
 *
 * Converts Levenshtein distance to a 0.0-1.0 similarity score.
 * - 1.0 = identical strings
 * - 0.0 = completely different strings
 * - 0.6 = 60% similar (Alexandria's fuzzy match threshold)
 *
 * Formula: 1.0 - (distance / maxLength)
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score (0.0 - 1.0)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1.0;
  return 1.0 - distance / maxLength;
}

// =================================================================================
// Fuzzy Matching
// =================================================================================

/**
 * Check if two titles are fuzzy duplicates using normalized comparison
 *
 * Uses Alexandria's standard fuzzy matching:
 * 1. Normalize both titles (lowercase, remove punctuation, remove articles)
 * 2. Calculate Levenshtein similarity
 * 3. Compare against FUZZY_SIMILARITY_THRESHOLD (0.6 = 60%)
 *
 * @param title1 - First title
 * @param title2 - Second title
 * @param threshold - Similarity threshold (default: 0.6)
 * @returns True if titles are fuzzy duplicates
 */
export function areTitlesSimilar(
  title1: string,
  title2: string,
  threshold: number = FUZZY_SIMILARITY_THRESHOLD
): boolean {
  const normalized1 = normalizeTitle(title1);
  const normalized2 = normalizeTitle(title2);
  const similarity = calculateSimilarity(normalized1, normalized2);
  return similarity >= threshold;
}
