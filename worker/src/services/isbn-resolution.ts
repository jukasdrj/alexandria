/**
 * ISBN Resolution Service - Multi-Source ISBN Resolution
 *
 * HYBRID WORKFLOW COMPONENT:
 * - Gemini generates book metadata (title, author, publisher)
 * - This service resolves authoritative ISBNs via multiple sources
 * - Avoids LLM ISBN hallucination while maintaining metadata quality
 *
 * STRATEGY (5-TIER CASCADING FALLBACK):
 * 1. ISBNdb (primary - fast, accurate, quota-limited)
 * 2. Google Books (1st fallback - fast, good coverage)
 * 3. OpenLibrary (2nd fallback - free, reliable)
 * 4. Archive.org (3rd fallback - excellent for pre-2000 books)
 * 5. Wikidata (last resort - comprehensive, slow SPARQL)
 *
 * When ISBNdb quota exhausted, automatically falls back to free APIs.
 * All resolvers implement Search → Validate pattern for data quality.
 *
 * @module services/isbn-resolution
 * @since 2.0.0
 * @updated 2.5.0 - Added multi-source fallback
 */

import type { Logger } from '../../lib/logger.js';
import type { Env } from '../env.js';
import { ISBNResolutionOrchestrator } from '../../lib/external-services/orchestrators/index.js';
import { getGlobalRegistry } from '../../lib/external-services/provider-registry.js';
import type { ServiceContext } from '../../lib/external-services/service-context.js';
import {
  OpenLibraryProvider,
  GoogleBooksProvider,
  ArchiveOrgProvider,
  WikidataProvider,
  ISBNdbProvider,
} from '../../lib/external-services/providers/index.js';

// =================================================================================
// Types
// =================================================================================

export interface BookMetadata {
  title: string;
  author: string;
  publisher?: string;
  format?: string;
  publication_year?: number;
}

export interface ISBNResolutionResult {
  isbn: string | null;
  confidence: 'high' | 'medium' | 'low' | 'not_found';
  match_quality: number; // 0.0 to 1.0
  matched_title: string | null;
  source: 'isbndb';
}

interface ISBNdbBook {
  isbn?: string;
  isbn13?: string;
  title?: string;
  title_long?: string;
  authors?: string[];
  publisher?: string;
  date_published?: string;
  binding?: string;
}

interface ISBNdbSearchResponse {
  books?: ISBNdbBook[];
  total?: number;
}

// =================================================================================
// Confidence Conversion Utilities
// =================================================================================

/**
 * Convert NEW orchestrator confidence (0-100) to OLD confidence enum
 *
 * Mapping:
 * - 85-100: high
 * - 65-84: medium
 * - 45-64: low
 * - 0-44: not_found
 *
 * @param numericConfidence - Confidence score from NEW orchestrator (0-100)
 * @returns Confidence enum for backward compatibility
 */
function convertConfidence(numericConfidence: number): 'high' | 'medium' | 'low' | 'not_found' {
  if (numericConfidence >= 85) return 'high';
  if (numericConfidence >= 65) return 'medium';
  if (numericConfidence >= 45) return 'low';
  return 'not_found';
}

// =================================================================================
// String Similarity Utilities
// =================================================================================

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy title matching
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
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

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0.0 to 1.0)
 */
function similarityRatio(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) {
    return 1.0;
  }

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Normalize title for comparison
 * - Lowercase
 * - Remove special characters
 * - Trim whitespace
 * - Remove common subtitles (": A Novel", etc.)
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:\-\u2013\u2014].*(novel|memoir|story|tale|book).*$/i, '') // Remove subtitles
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Normalize author name for comparison
 * - Lowercase
 * - Handle "Last, First" vs "First Last"
 */
function normalizeAuthor(author: string): string {
  const cleaned = author.toLowerCase().replace(/[^\w\s]/g, '').trim();

  // If comma-separated (Last, First), convert to First Last
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map(p => p.trim());
    return `${parts[1]} ${parts[0]}`.trim();
  }

  return cleaned;
}

// =================================================================================
// ISBN Resolution Logic
// =================================================================================

/**
 * Resolve ISBN via ISBNdb title/author search
 *
 * MATCHING STRATEGY:
 * 1. Query ISBNdb with "{title} {author}"
 * 2. Fuzzy match results against expected title/author
 * 3. Score each match based on:
 *    - Title similarity (70% weight)
 *    - Author similarity (30% weight)
 *    - Publisher match bonus (+10% if matching)
 *    - Format match bonus (+5% if matching)
 *
 * @param metadata - Book metadata from Gemini
 * @param apiKey - ISBNdb API key
 * @param logger - Logger instance
 * @param quotaCheck - Optional quota check function (returns false if quota exhausted)
 * @returns ISBN resolution result with confidence score
 */
export async function resolveISBNViaTitle(
  metadata: BookMetadata,
  apiKey: string,
  logger: Logger,
  quotaCheck?: () => Promise<boolean>
): Promise<ISBNResolutionResult> {
  const { title, author, publisher, format } = metadata;

  // QUOTA ENFORCEMENT (Issue #158 Fix)
  // Check quota BEFORE making API call if checker provided
  if (quotaCheck) {
    const allowed = await quotaCheck();
    if (!allowed) {
      logger.warn('[ISBNResolution] ISBNdb quota exhausted - proceeding without ISBN', { title, author });
      return {
        isbn: null,
        confidence: 'not_found',
        match_quality: 0.0,
        matched_title: null,
        source: 'isbndb',
      };
    }
  }

  // Construct search query
  const query = `${title} ${author}`;
  const url = `https://api.premium.isbndb.com/books/${encodeURIComponent(query)}?page=1&pageSize=20`;

  logger.info('[ISBNResolution] Searching ISBNdb', { title, author, query, url });

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.debug('[ISBNResolution] No results found', { title, author });
        return {
          isbn: null,
          confidence: 'not_found',
          match_quality: 0.0,
          matched_title: null,
          source: 'isbndb',
        };
      }

      // Quota exhaustion (429/403): Return not_found instead of throwing
      // This allows staged enrichment to save Gemini metadata even when ISBNdb quota exhausted
      if (response.status === 429 || response.status === 403) {
        const isQuota = response.status === 403;
        logger.warn(`[ISBNResolution] ISBNdb ${isQuota ? 'quota exhausted' : 'rate limited'} - proceeding without ISBN`, {
          title,
          author,
          status: response.status,
        });
        return {
          isbn: null,
          confidence: 'not_found',
          match_quality: 0.0,
          matched_title: null,
          source: 'isbndb',
        };
      }

      // Auth errors (401): Still throw - this is a configuration problem
      if (response.status === 401) {
        const errorMsg = `ISBNdb authentication failed (401). Check ISBNDB_API_KEY configuration.`;
        logger.error('[ISBNResolution] Auth error', { title, author, status: response.status });
        throw new Error(errorMsg);
      }

      throw new Error(`ISBNdb API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as ISBNdbSearchResponse;

    logger.info('[ISBNResolution] ISBNdb response received', {
      title,
      author,
      total_results: data.total || 0,
      books_count: data.books?.length || 0,
      raw_response: JSON.stringify(data).substring(0, 500), // First 500 chars
    });

    if (!data.books || data.books.length === 0) {
      logger.warn('[ISBNResolution] No books in response', { title, author, total: data.total });
      return {
        isbn: null,
        confidence: 'not_found',
        match_quality: 0.0,
        matched_title: null,
        source: 'isbndb',
      };
    }

    // Normalize search criteria
    const normalizedTitle = normalizeTitle(title);
    const normalizedAuthor = normalizeAuthor(author);

    // Score each result
    let bestMatch: { book: ISBNdbBook; score: number } | null = null;

    for (const book of data.books) {
      const bookTitle = book.title_long || book.title || '';
      const bookAuthors = book.authors || [];
      const bookPublisher = book.publisher || '';
      const bookBinding = book.binding || '';

      // Calculate title similarity (70% weight)
      const titleSimilarity = similarityRatio(normalizedTitle, normalizeTitle(bookTitle));

      // Calculate author similarity (30% weight)
      // Check if any book author matches the search author
      let authorSimilarity = 0.0;
      for (const bookAuthor of bookAuthors) {
        const sim = similarityRatio(normalizedAuthor, normalizeAuthor(bookAuthor));
        authorSimilarity = Math.max(authorSimilarity, sim);
      }

      // Base score: weighted average
      let score = (titleSimilarity * 0.7) + (authorSimilarity * 0.3);

      // Publisher match bonus (+10%)
      if (publisher && bookPublisher.toLowerCase().includes(publisher.toLowerCase())) {
        score += 0.10;
      }

      // Format match bonus (+5%)
      if (format && bookBinding.toLowerCase().includes(format.toLowerCase())) {
        score += 0.05;
      }

      // Cap score at 1.0
      score = Math.min(score, 1.0);

      logger.info('[ISBNResolution] Candidate match', {
        search_title: title,
        search_author: author,
        book_title: bookTitle,
        book_authors: bookAuthors,
        book_isbn13: book.isbn13,
        title_sim: titleSimilarity.toFixed(2),
        author_sim: authorSimilarity.toFixed(2),
        total_score: score.toFixed(2),
      });

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { book, score };
      }
    }

    if (!bestMatch) {
      logger.warn('[ISBNResolution] No suitable match found after scoring', { title, author });
      return {
        isbn: null,
        confidence: 'not_found',
        match_quality: 0.0,
        matched_title: null,
        source: 'isbndb',
      };
    }

    // Determine confidence level based on score
    let confidence: 'high' | 'medium' | 'low' | 'not_found';
    if (bestMatch.score >= 0.85) {
      confidence = 'high';
    } else if (bestMatch.score >= 0.65) {
      confidence = 'medium';
    } else if (bestMatch.score >= 0.45) {
      confidence = 'low';
    } else {
      logger.warn('[ISBNResolution] Best match score too low, rejecting', {
        title,
        author,
        best_score: bestMatch.score.toFixed(2),
        threshold: 0.45,
        best_match_title: bestMatch.book.title,
      });
      confidence = 'not_found';
    }

    const isbn = bestMatch.book.isbn13 || bestMatch.book.isbn;

    logger.info('[ISBNResolution] Match found', {
      original_title: title,
      matched_title: bestMatch.book.title,
      isbn,
      confidence,
      score: bestMatch.score.toFixed(2),
    });

    return {
      isbn: isbn || null,
      confidence,
      match_quality: bestMatch.score,
      matched_title: bestMatch.book.title_long || bestMatch.book.title || null,
      source: 'isbndb',
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Critical: Re-throw auth/quota/API errors - don't mask as "not_found"
    if (errorMsg.includes('authentication') || errorMsg.includes('rate limit') || errorMsg.includes('API error')) {
      logger.error('[ISBNResolution] Critical error - re-throwing', {
        title,
        author,
        error: errorMsg,
      });
      throw error;
    }

    // For network/timeout/parse errors, log and return not_found
    logger.warn('[ISBNResolution] Non-critical error, treating as not_found', {
      title,
      author,
      error: errorMsg,
    });

    return {
      isbn: null,
      confidence: 'not_found',
      match_quality: 0.0,
      matched_title: null,
      source: 'isbndb',
    };
  }
}

/**
 * Batch resolve ISBNs for multiple books with multi-source fallback
 *
 * ARCHITECTURE (NEW in 2.6.0):
 * - Uses Service Provider Framework with dynamic discovery
 * - ISBNResolutionOrchestrator handles provider selection and cascading
 * - Automatic fallback when ISBNdb quota exhausted
 *
 * FALLBACK CHAIN (5-tier cascading):
 * 1. ISBNdb (paid, quota-limited, highest accuracy)
 * 2. Google Books (free, fast, good coverage)
 * 3. OpenLibrary (free, reliable, 100 req/5min)
 * 4. Archive.org (free, excellent for pre-2000 books)
 * 5. Wikidata (free, comprehensive SPARQL, slowest)
 *
 * RATE LIMITING:
 * - Handled by ServiceHttpClient in each provider
 * - ISBNdb: 3 req/sec (333ms between calls)
 * - OpenLibrary: 1 req/3sec (3000ms between calls)
 * - All providers have built-in rate limiting
 *
 * QUOTA TRACKING:
 * - ISBNdbProvider checks quota via quotaManager before each call
 * - When quota exhausted, registry.getAvailableProviders() filters ISBNdb out
 * - Orchestrator automatically tries next provider
 *
 * @param books - Array of book metadata from Gemini
 * @param apiKey - ISBNdb API key
 * @param logger - Logger instance
 * @param quotaManager - Optional quota manager for ISBNdb tracking
 * @param env - Worker environment (required for providers)
 * @returns Array of resolution results with backward-compatible format
 */
export async function batchResolveISBNs(
  books: BookMetadata[],
  apiKey: string,
  logger: Logger,
  quotaManager?: { checkQuota: (count: number, reserve: boolean) => Promise<{ allowed: boolean; status: any }>; recordApiCall: (count: number) => Promise<void> },
  env?: Env
): Promise<ISBNResolutionResult[]> {
  if (!env) {
    logger.error('[ISBNResolution] Env required for NEW orchestrator - cannot proceed');
    throw new Error('Env required for ISBN resolution');
  }

  // Initialize provider registry with all 5 ISBN resolvers
  const registry = getGlobalRegistry();

  // Register all providers (idempotent - safe to call multiple times)
  registry.registerAll([
    new ISBNdbProvider(),
    new GoogleBooksProvider(),
    new OpenLibraryProvider(),
    new ArchiveOrgProvider(),
    new WikidataProvider(),
  ]);

  // Create NEW orchestrator with default config
  const orchestrator = new ISBNResolutionOrchestrator(registry, {
    providerTimeoutMs: 15000, // 15s per provider
    enableLogging: true,
  });

  // Build service context for providers
  const context: ServiceContext = {
    env,
    logger,
    quotaManager: quotaManager || undefined,
  };

  const results: ISBNResolutionResult[] = [];

  logger.info('[ISBNResolution] Starting batch resolution with NEW orchestrator', {
    total_books: books.length,
  });

  for (let i = 0; i < books.length; i++) {
    const book = books[i];

    try {
      // Use NEW orchestrator - it handles all provider selection, fallback, and quota
      const result = await orchestrator.resolveISBN(book.title, book.author, context);

      // Convert NEW confidence (0-100) to OLD confidence (string enum)
      const confidence = convertConfidence(result.confidence);

      // Convert to backward-compatible format
      results.push({
        isbn: result.isbn,
        confidence,
        match_quality: result.confidence / 100, // Convert 0-100 to 0-1
        matched_title: null, // NEW orchestrator doesn't return matched_title
        source: result.source as any, // 'isbndb', 'google-books', 'open-library', etc.
      });

      logger.debug('[ISBNResolution] Book resolved', {
        title: book.title,
        author: book.author,
        isbn: result.isbn,
        source: result.source,
        confidence: result.confidence,
        mapped_confidence: confidence,
      });

    } catch (error) {
      // NEW orchestrator is designed to NEVER throw - it returns null on all errors
      // This catch block is defensive fallback
      logger.error('[ISBNResolution] Unexpected orchestrator error', {
        title: book.title,
        author: book.author,
        error: error instanceof Error ? error.message : String(error),
      });

      results.push({
        isbn: null,
        confidence: 'not_found',
        match_quality: 0.0,
        matched_title: null,
        source: 'isbndb', // Default source for backward compatibility
      });
    }

    // Small delay between books to avoid hammering providers
    // (Providers have their own rate limiting, but this adds buffer)
    if (i < books.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const successCount = results.filter(r => r.isbn !== null).length;
  const highConfidence = results.filter(r => r.confidence === 'high').length;
  const sourceBreakdown = results.reduce((acc, r) => {
    if (r.isbn) {
      acc[r.source] = (acc[r.source] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  logger.info('[ISBNResolution] Batch complete (NEW orchestrator)', {
    total: books.length,
    resolved: successCount,
    high_confidence: highConfidence,
    success_rate: ((successCount / books.length) * 100).toFixed(1) + '%',
    source_breakdown: sourceBreakdown,
  });

  return results;
}
