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
 * Aligned with PostgreSQL pg_trgm similarity threshold in deduplication.ts
 */
export const FUZZY_SIMILARITY_THRESHOLD = 0.6; // 60% similarity

// =================================================================================
// Title Normalization
// =================================================================================

/**
 * Normalize book title for fuzzy comparison
 *
 * Transformations:
 * - Lowercase for case-insensitive comparison
 * - Remove punctuation (non-alphanumeric except spaces)
 * - Remove common articles (a, an, the)
 * - Normalize whitespace (collapse multiple spaces to one)
 * - Trim leading/trailing whitespace
 *
 * Examples:
 * - "The Hobbit: There and Back Again" → "hobbit there and back again"
 * - "Harry Potter and the Philosopher's Stone" → "harry potter and philosophers stone"
 *
 * @param title - Raw title string
 * @returns Normalized title
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\b(a|an|the)\b/g, '') // Remove articles
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
