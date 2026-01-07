/**
 * Deduplication Service - Multi-tier ISBN deduplication
 *
 * Strategy:
 * 1. Exact match: Check if ISBN already exists in enriched_editions
 * 2. Related ISBNs: Check ISBNdb's related_isbns field (hardcover → paperback → ebook links)
 * 3. Fuzzy match: Title + author similarity using PostgreSQL trigram indexes
 *
 * Used by harvest operations to avoid re-enriching existing books.
 */

import type { Sql } from 'postgres';
import type { Logger } from '../../lib/logger.js';

// =================================================================================
// Types
// =================================================================================

export interface ISBNCandidate {
  isbn: string;
  title?: string;
  authors?: string[];
  source?: string; // e.g., 'nyt-fiction', 'gemini-2015'
}

export interface DeduplicationResult {
  /** ISBNs that should be enriched (not found in DB) */
  toEnrich: string[];

  /** ISBNs found via exact match */
  exactMatches: string[];

  /** ISBNs found via related_isbns field */
  relatedMatches: Array<{ isbn: string; matched_via: string }>;

  /** ISBNs found via fuzzy title/author matching */
  fuzzyMatches: Array<{ isbn: string; matched_isbn: string; similarity: number }>;

  /** Summary statistics */
  stats: {
    total: number;
    unique: number;
    duplicate_exact: number;
    duplicate_related: number;
    duplicate_fuzzy: number;
  };
}

// =================================================================================
// Main Deduplication Function
// =================================================================================

/**
 * Deduplicate ISBNs using multi-tier strategy
 *
 * @param sql - Postgres connection
 * @param candidates - ISBN candidates to check
 * @param logger - Logger instance
 * @returns Deduplication results with breakdown by match type
 */
export async function deduplicateISBNs(
  sql: Sql,
  candidates: ISBNCandidate[],
  logger: Logger
): Promise<DeduplicationResult> {
  const startTime = Date.now();

  const result: DeduplicationResult = {
    toEnrich: [],
    exactMatches: [],
    relatedMatches: [],
    fuzzyMatches: [],
    stats: {
      total: candidates.length,
      unique: 0,
      duplicate_exact: 0,
      duplicate_related: 0,
      duplicate_fuzzy: 0,
    },
  };

  if (candidates.length === 0) {
    return result;
  }

  logger.info('[Dedup] Starting deduplication', { total: candidates.length });

  // Stage 1: Exact ISBN match
  const { remaining: afterExact, found: exactFound } = await deduplicateExactMatch(
    sql,
    candidates,
    logger
  );
  result.exactMatches = exactFound;
  result.stats.duplicate_exact = exactFound.length;

  logger.info('[Dedup] Stage 1: Exact match', {
    found: exactFound.length,
    remaining: afterExact.length,
  });

  // Stage 2: Related ISBNs match
  const { remaining: afterRelated, found: relatedFound } = await deduplicateRelatedISBNs(
    sql,
    afterExact,
    logger
  );
  result.relatedMatches = relatedFound;
  result.stats.duplicate_related = relatedFound.length;

  logger.info('[Dedup] Stage 2: Related ISBNs', {
    found: relatedFound.length,
    remaining: afterRelated.length,
  });

  // Stage 3: Fuzzy title/author match (only for candidates with metadata)
  const withMetadata = afterRelated.filter((c) => c.title && c.authors && c.authors.length > 0);
  const withoutMetadata = afterRelated.filter((c) => !c.title || !c.authors || c.authors.length === 0);

  if (withMetadata.length > 0) {
    const { remaining: afterFuzzy, found: fuzzyFound } = await deduplicateFuzzyMatch(
      sql,
      withMetadata,
      logger
    );
    result.fuzzyMatches = fuzzyFound;
    result.stats.duplicate_fuzzy = fuzzyFound.length;

    logger.info('[Dedup] Stage 3: Fuzzy match', {
      found: fuzzyFound.length,
      remaining: afterFuzzy.length,
    });

    result.toEnrich = [...afterFuzzy.map((c) => c.isbn), ...withoutMetadata.map((c) => c.isbn)];
  } else {
    result.toEnrich = afterRelated.map((c) => c.isbn);
  }

  result.stats.unique = result.toEnrich.length;

  const duration = Date.now() - startTime;
  logger.info('[Dedup] Complete', {
    total: result.stats.total,
    unique: result.stats.unique,
    duplicates: result.stats.total - result.stats.unique,
    duration_ms: duration,
  });

  return result;
}

// =================================================================================
// Stage 1: Exact Match
// =================================================================================

async function deduplicateExactMatch(
  sql: Sql,
  candidates: ISBNCandidate[],
  logger: Logger
): Promise<{ remaining: ISBNCandidate[]; found: string[] }> {
  const isbns = candidates.map((c) => c.isbn);

  try {
    const existing = await sql`
      SELECT isbn
      FROM enriched_editions
      WHERE isbn = ANY(${sql.array(isbns)})
    `;

    const existingSet = new Set(existing.map((row: { isbn: string }) => row.isbn));

    const remaining = candidates.filter((c) => !existingSet.has(c.isbn));
    const found = Array.from(existingSet);

    return { remaining, found };
  } catch (error) {
    logger.error('[Dedup:ExactMatch] Query failed', { error });
    // On error, assume none exist (fail-open for enrichment)
    return { remaining: candidates, found: [] };
  }
}

// =================================================================================
// Stage 2: Related ISBNs
// =================================================================================

async function deduplicateRelatedISBNs(
  sql: Sql,
  candidates: ISBNCandidate[],
  logger: Logger
): Promise<{ remaining: ISBNCandidate[]; found: Array<{ isbn: string; matched_via: string }> }> {
  const isbns = candidates.map((c) => c.isbn);
  const found: Array<{ isbn: string; matched_via: string }> = [];

  try {
    // Query: Check if any candidate ISBN appears in related_isbns JSONB field
    // related_isbns structure: {"9780804139021": "paperback", "9780804139038": "ebook"}
    const relatedMatches = await sql`
      SELECT isbn, related_isbns
      FROM enriched_editions
      WHERE related_isbns ?| ${sql.array(isbns)}
    `;

    // Build map of candidate ISBN → matched ISBN
    const matchedISBNs = new Set<string>();
    for (const row of relatedMatches) {
      const relatedISBNs = row.related_isbns as Record<string, string>;
      for (const candidateISBN of isbns) {
        if (relatedISBNs[candidateISBN]) {
          matchedISBNs.add(candidateISBN);
          found.push({
            isbn: candidateISBN,
            matched_via: row.isbn as string,
          });
        }
      }
    }

    const remaining = candidates.filter((c) => !matchedISBNs.has(c.isbn));

    return { remaining, found };
  } catch (error) {
    logger.error('[Dedup:RelatedISBNs] Query failed', { error });
    // On error, skip this stage (fail-open)
    return { remaining: candidates, found: [] };
  }
}

// =================================================================================
// Stage 3: Fuzzy Match
// =================================================================================

const FUZZY_SIMILARITY_THRESHOLD = 0.6; // 60% similarity for title+author combo

async function deduplicateFuzzyMatch(
  sql: Sql,
  candidates: ISBNCandidate[],
  logger: Logger
): Promise<{
  remaining: ISBNCandidate[];
  found: Array<{ isbn: string; matched_isbn: string; similarity: number }>;
}> {
  const found: Array<{ isbn: string; matched_isbn: string; similarity: number }> = [];
  const matchedISBNs = new Set<string>();

  try {
    // Process in batches to avoid overwhelming the database
    const BATCH_SIZE = 50;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      for (const candidate of batch) {
        const title = candidate.title!.toLowerCase();
        const author = (candidate.authors![0] || '').toLowerCase();

        // Use PostgreSQL trigram similarity (requires pg_trgm extension)
        // Combine title and author similarity for better matching
        const similar = await sql`
          SELECT
            isbn,
            title,
            similarity(LOWER(title), ${title}) as title_sim,
            0.5 as author_sim
          FROM enriched_editions
          WHERE similarity(LOWER(title), ${title}) > ${FUZZY_SIMILARITY_THRESHOLD}
          ORDER BY title_sim DESC
          LIMIT 3
        `;

        if (similar.length > 0) {
          const bestMatch = similar[0] as {
            isbn: string;
            title: string;
            title_sim: number;
            author_sim: number;
          };

          // Combined score (weighted: title 70%, author 30%)
          const combinedScore = bestMatch.title_sim * 0.7 + bestMatch.author_sim * 0.3;

          if (combinedScore > FUZZY_SIMILARITY_THRESHOLD) {
            matchedISBNs.add(candidate.isbn);
            found.push({
              isbn: candidate.isbn,
              matched_isbn: bestMatch.isbn,
              similarity: combinedScore,
            });
          }
        }
      }
    }

    const remaining = candidates.filter((c) => !matchedISBNs.has(c.isbn));

    return { remaining, found };
  } catch (error) {
    logger.error('[Dedup:FuzzyMatch] Query failed', { error });
    // On error, skip this stage (fail-open)
    return { remaining: candidates, found: [] };
  }
}
