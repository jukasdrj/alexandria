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
// Module-Level Singleton (Cold Start Optimization)
// =================================================================================

/**
 * Global ISBN resolution orchestrator initialized once and reused across requests.
 * Reduces per-request overhead by ~10-15ms and enables HTTP connection reuse.
 *
 * Providers are registered in queue-handlers.ts at module load time.
 * This orchestrator simply reuses the global registry.
 *
 * Follows same pattern as BookGenerationOrchestrator in hybrid-backfill.ts
 */
const isbnOrchestrator = new ISBNResolutionOrchestrator(getGlobalRegistry(), {
  providerTimeoutMs: 15000, // 15s per provider
  enableLogging: true,
});

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
  source: string; // Provider name: 'isbndb', 'google-books', 'open-library', etc.
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
  _apiKey: string, // Unused - kept for backward compatibility
  logger: Logger,
  quotaManager?: { checkQuota: (count: number, reserve: boolean) => Promise<{ allowed: boolean; status: any }>; recordApiCall: (count: number) => Promise<void> },
  env?: Env
): Promise<ISBNResolutionResult[]> {
  if (!env) {
    logger.error('[ISBNResolution] Env required for orchestrator - cannot proceed');
    throw new Error('Env required for ISBN resolution');
  }

  // Build service context for module-level orchestrator
  const context: ServiceContext = {
    env,
    logger,
    quotaManager: quotaManager || undefined,
  };

  logger.info('[ISBNResolution] Starting batch resolution with singleton orchestrator', {
    total_books: books.length,
  });

  // Process books in parallel with concurrency limit of 5
  // This balances speed (3x faster) with API rate limiting
  const CONCURRENCY = 5;
  const results: ISBNResolutionResult[] = new Array(books.length);

  // Process books in chunks to limit concurrent requests
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const chunk = books.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (book, chunkIndex) => {
        const globalIndex = i + chunkIndex;

        try {
          // Use module-level singleton orchestrator - handles all provider selection, fallback, and quota
          const result = await isbnOrchestrator.resolveISBN(book.title, book.author, context);

          // Convert NEW confidence (0-100) to OLD confidence (string enum)
          const confidence = convertConfidence(result.confidence);

          logger.debug('[ISBNResolution] Book resolved', {
            title: book.title,
            author: book.author,
            isbn: result.isbn,
            source: result.source,
            confidence: result.confidence,
            mapped_confidence: confidence,
          });

          // Convert to backward-compatible format
          return {
            isbn: result.isbn,
            confidence,
            match_quality: result.confidence / 100, // Convert 0-100 to 0-1
            matched_title: null, // NEW orchestrator doesn't return matched_title
            source: result.source as any, // 'isbndb', 'google-books', 'open-library', etc.
          };

        } catch (error) {
          // Orchestrator is designed to NEVER throw - it returns null on all errors
          // This catch block is defensive fallback
          logger.error('[ISBNResolution] Unexpected orchestrator error', {
            title: book.title,
            author: book.author,
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            isbn: null,
            confidence: 'not_found' as const,
            match_quality: 0.0,
            matched_title: null,
            source: 'isbndb', // Default source for backward compatibility
          };
        }
      })
    );

    // Store chunk results in correct positions
    chunkResults.forEach((result, chunkIndex) => {
      results[i + chunkIndex] = result;
    });

    // Small delay between chunks to avoid overwhelming providers
    // (Providers have their own rate limiting, but this adds buffer)
    if (i + CONCURRENCY < books.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
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

  logger.info('[ISBNResolution] Batch complete (singleton orchestrator)', {
    total: books.length,
    resolved: successCount,
    high_confidence: highConfidence,
    success_rate: ((successCount / books.length) * 100).toFixed(1) + '%',
    source_breakdown: sourceBreakdown,
  });

  return results;
}
