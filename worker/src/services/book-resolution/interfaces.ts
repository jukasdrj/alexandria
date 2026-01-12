/**
 * Book Resolution Interfaces
 *
 * Defines the contract for ISBN resolvers in the cascading fallback chain.
 * Each resolver implements Search → Validate pattern to ensure data quality.
 *
 * @module services/book-resolution/interfaces
 * @since 2.5.0
 */

import type { Env } from '../../env.js';
import type { Logger } from '../../../lib/logger.js';
import { ISBN_RESOLUTION_SIMILARITY_THRESHOLD } from '../../lib/constants.js';

/**
 * ISBN resolution result
 *
 * Returned by all resolvers in the fallback chain.
 */
export interface ISBNResolutionResult {
  /** Resolved ISBN (13 or 10 digits), or null if not found */
  isbn: string | null;

  /** Confidence score (0-100) based on match quality */
  confidence: number;

  /** Source that provided the ISBN */
  source: 'isbndb' | 'google-books' | 'open-library' | 'archive-org' | 'wikidata' | 'not_found';

  /** Optional metadata from the source */
  metadata?: {
    title?: string;
    author?: string;
    publishYear?: number;
    publisher?: string;
  };
}

/**
 * Universal Book Resolver Interface
 *
 * All ISBN resolvers must implement this interface.
 * Implementation MUST include Search → Validate pattern:
 * 1. Search: Query API with title/author
 * 2. Validate: Fetch ISBN's metadata and confirm title/author match
 * 3. Return: Only validated ISBNs (prevents data corruption)
 *
 * @example
 * ```typescript
 * class GoogleBooksResolver implements IBookResolver {
 *   async resolve(title: string, author: string): Promise<ISBNResolutionResult> {
 *     // 1. Search Google Books API
 *     const searchResults = await this.searchByTitleAuthor(title, author);
 *
 *     // 2. Validate each result
 *     for (const isbn of searchResults.isbns) {
 *       const metadata = await this.fetchByISBN(isbn);
 *       if (this.validateMatch(metadata, title, author)) {
 *         return { isbn, confidence: 85, source: 'google-books', metadata };
 *       }
 *     }
 *
 *     // 3. No validated match found
 *     return { isbn: null, confidence: 0, source: 'google-books' };
 *   }
 * }
 * ```
 */
export interface IBookResolver {
  /**
   * Resolve ISBN from title and author
   *
   * **Requirements**:
   * - MUST validate results before returning (Search → Validate pattern)
   * - MUST return null if no definitive match found
   * - MUST use string similarity (Levenshtein distance, threshold 0.7) for validation
   * - MUST NOT throw errors (return null on failure)
   * - SHOULD log failures for observability
   *
   * @param title - Book title from Gemini
   * @param author - Author name from Gemini
   * @param env - Worker environment with bindings
   * @param logger - Optional structured logger
   * @returns Resolution result with validated ISBN or null
   */
  resolve(
    title: string,
    author: string,
    env: Env,
    logger?: Logger
  ): Promise<ISBNResolutionResult>;

  /**
   * Resolver name for logging and observability
   *
   * Used by orchestrator to track which resolver succeeded.
   */
  readonly name: string;
}

/**
 * String similarity algorithm for title/author matching
 *
 * Uses Levenshtein distance to calculate similarity between strings.
 * Threshold: 0.7 (70% similarity) for accepting matches.
 *
 * @param str1 - First string (from search result)
 * @param str2 - Second string (from original query)
 * @returns Similarity score (0.0 = completely different, 1.0 = identical)
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  // Normalize strings: lowercase, trim, remove extra whitespace
  const s1 = str1.toLowerCase().trim().replace(/\s+/g, ' ');
  const s2 = str2.toLowerCase().trim().replace(/\s+/g, ' ');

  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  // Levenshtein distance calculation
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  // Convert distance to similarity (0.0-1.0)
  const distance = matrix[s2.length][s1.length];
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}

/**
 * Validation threshold for string similarity
 *
 * Accept matches with >= 70% similarity (0.7).
 * This allows for minor variations while preventing false positives.
 *
 * @see {@link ISBN_RESOLUTION_SIMILARITY_THRESHOLD} in constants.ts
 */
export const SIMILARITY_THRESHOLD = ISBN_RESOLUTION_SIMILARITY_THRESHOLD;

/**
 * Validate that fetched metadata matches the original query
 *
 * Uses string similarity to confirm title and author match.
 * Both title AND author must meet threshold for validation to pass.
 *
 * @param fetchedTitle - Title from ISBN metadata fetch
 * @param fetchedAuthor - Author from ISBN metadata fetch
 * @param queryTitle - Original query title from Gemini
 * @param queryAuthor - Original query author from Gemini
 * @returns True if both title and author match (>= 70% similarity)
 */
export function validateMetadataMatch(
  fetchedTitle: string,
  fetchedAuthor: string,
  queryTitle: string,
  queryAuthor: string
): boolean {
  const titleSimilarity = calculateStringSimilarity(fetchedTitle, queryTitle);
  const authorSimilarity = calculateStringSimilarity(fetchedAuthor, queryAuthor);

  return titleSimilarity >= SIMILARITY_THRESHOLD && authorSimilarity >= SIMILARITY_THRESHOLD;
}
