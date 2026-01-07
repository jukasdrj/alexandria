/**
 * ISBN Resolution Service - ISBNdb Title/Author Lookup
 *
 * HYBRID WORKFLOW COMPONENT:
 * - Gemini generates book metadata (title, author, publisher)
 * - This service resolves authoritative ISBNs via ISBNdb API
 * - Avoids LLM ISBN hallucination while maintaining metadata quality
 *
 * STRATEGY:
 * 1. Search ISBNdb by title + author
 * 2. Fuzzy match results (handle title variations)
 * 3. Return best ISBN match with confidence score
 *
 * @module services/isbn-resolution
 */

import type { Logger } from '../../lib/logger.js';

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
 * @returns ISBN resolution result with confidence score
 */
export async function resolveISBNViaTitle(
  metadata: BookMetadata,
  apiKey: string,
  logger: Logger
): Promise<ISBNResolutionResult> {
  const { title, author, publisher, format } = metadata;

  // Construct search query
  const query = `${title} ${author}`;
  const url = `https://api.premium.isbndb.com/books/${encodeURIComponent(query)}?page=1&pageSize=20`;

  logger.debug('[ISBNResolution] Searching ISBNdb', { title, author, query });

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

      // Critical: Don't swallow auth/quota errors
      if (response.status === 401 || response.status === 403) {
        const errorMsg = `ISBNdb authentication failed (${response.status}). Check ISBNDB_API_KEY configuration.`;
        logger.error('[ISBNResolution] Auth error', { title, author, status: response.status });
        throw new Error(errorMsg);
      }

      if (response.status === 429) {
        const errorMsg = `ISBNdb rate limit exceeded (${response.status}). Quota may be exhausted.`;
        logger.error('[ISBNResolution] Rate limit error', { title, author });
        throw new Error(errorMsg);
      }

      throw new Error(`ISBNdb API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as ISBNdbSearchResponse;

    if (!data.books || data.books.length === 0) {
      logger.debug('[ISBNResolution] No books in response', { title, author });
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

      logger.debug('[ISBNResolution] Candidate match', {
        book_title: bookTitle,
        book_author: bookAuthors[0],
        title_sim: titleSimilarity.toFixed(2),
        author_sim: authorSimilarity.toFixed(2),
        total_score: score.toFixed(2),
      });

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { book, score };
      }
    }

    if (!bestMatch) {
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
 * Batch resolve ISBNs for multiple books
 *
 * RATE LIMITING:
 * - ISBNdb Premium: 3 req/sec
 * - Add 350ms delay between requests
 *
 * @param books - Array of book metadata from Gemini
 * @param apiKey - ISBNdb API key
 * @param logger - Logger instance
 * @returns Array of resolution results
 */
export async function batchResolveISBNs(
  books: BookMetadata[],
  apiKey: string,
  logger: Logger
): Promise<ISBNResolutionResult[]> {
  const results: ISBNResolutionResult[] = [];

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const result = await resolveISBNViaTitle(book, apiKey, logger);
    results.push(result);

    // Rate limit: 350ms delay between requests (3 req/sec)
    if (i < books.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }

  const successCount = results.filter(r => r.isbn !== null).length;
  const highConfidence = results.filter(r => r.confidence === 'high').length;

  logger.info('[ISBNResolution] Batch complete', {
    total: books.length,
    resolved: successCount,
    high_confidence: highConfidence,
    success_rate: ((successCount / books.length) * 100).toFixed(1) + '%',
  });

  return results;
}
