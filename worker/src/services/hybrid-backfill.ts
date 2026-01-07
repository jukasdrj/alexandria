/**
 * Hybrid Backfill Workflow - Gemini + ISBNdb Integration
 *
 * ARCHITECTURE:
 * 1. Gemini API → Generate book metadata (title, author, publisher, format, year)
 * 2. ISBNdb API → Resolve authoritative ISBNs via title/author search
 * 3. Deduplication → Filter already-enriched books
 * 4. Enrichment → Update database with complete metadata
 *
 * BENEFITS:
 * - 95%+ ISBN accuracy (ISBNdb authoritative source)
 * - High-quality metadata from Gemini (cultural significance, publisher info)
 * - Reduced batch size (20 books) for better Gemini accuracy
 * - Fuzzy matching handles title variations
 *
 * @module services/hybrid-backfill
 */

import type { Env } from '../env.js';
import type { Logger } from '../../lib/logger.js';
import { generateCuratedBookList, type GenerationStats } from './gemini-backfill.js';
import { batchResolveISBNs, type ISBNResolutionResult } from './isbn-resolution.js';
import type { ISBNCandidate } from './deduplication.js';

// =================================================================================
// Types
// =================================================================================

export interface HybridBackfillStats extends GenerationStats {
  // Gemini stats (inherited from GenerationStats)
  // ISBNdb resolution stats
  isbn_resolution: {
    total_attempted: number;
    resolved: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    not_found: number;
    resolution_rate: number; // Percentage
  };
  // API call tracking
  api_calls: {
    gemini: number;
    isbndb: number;
    total: number;
  };
}

export interface HybridBackfillResult {
  candidates: ISBNCandidate[];
  stats: HybridBackfillStats;
  resolutions: ISBNResolutionResult[];
}

// =================================================================================
// Main Hybrid Workflow
// =================================================================================

/**
 * Generate curated book list with hybrid Gemini + ISBNdb workflow
 *
 * WORKFLOW:
 * 1. Gemini generates N high-quality book metadata records (configurable batch size)
 * 2. ISBNdb resolves authoritative ISBNs via title/author fuzzy search
 * 3. Returns enriched candidates with confidence scores
 *
 * QUOTA IMPACT:
 * - Gemini: 1 API call (N books @ temperature=0.1)
 * - ISBNdb: N API calls (1 per book, rate-limited to 3 req/sec)
 *
 * @param year - Year to generate list for
 * @param month - Month to generate list for (1-12)
 * @param env - Environment with API keys
 * @param logger - Logger instance
 * @param batchSize - Number of books to generate (default: 20, can test 50)
 * @returns Hybrid workflow result with ISBNs resolved
 */
export async function generateHybridBackfillList(
  year: number,
  month: number,
  env: Env,
  logger: Logger,
  batchSize: number = 20,
  promptOverride?: string,
  modelOverride?: string
): Promise<HybridBackfillResult> {
  const startTime = Date.now();

  logger.info('[HybridBackfill] Starting hybrid workflow', {
    year,
    month,
    prompt_override: promptOverride ? 'custom' : 'default',
    model_override: modelOverride || 'default',
  });

  // Step 1: Generate metadata from Gemini (no ISBNs)
  const { candidates: metadataCandidates, stats: geminiStats } = await generateCuratedBookList(
    year,
    month,
    env,
    logger,
    promptOverride,
    batchSize,
    modelOverride
  );

  if (metadataCandidates.length === 0) {
    logger.warn('[HybridBackfill] No books generated from Gemini', { year, month });
    return {
      candidates: [],
      stats: {
        ...geminiStats,
        isbn_resolution: {
          total_attempted: 0,
          resolved: 0,
          high_confidence: 0,
          medium_confidence: 0,
          low_confidence: 0,
          not_found: 0,
          resolution_rate: 0,
        },
        api_calls: {
          gemini: 1,
          isbndb: 0,
          total: 1,
        },
      },
      resolutions: [],
    };
  }

  logger.info('[HybridBackfill] Gemini generation complete', {
    books_generated: metadataCandidates.length,
    model: geminiStats.model_used,
  });

  // Step 2: Resolve ISBNs via ISBNdb title/author search
  const apiKey = await env.ISBNDB_API_KEY.get();
  if (!apiKey) {
    throw new Error('ISBNDB_API_KEY not configured');
  }

  const booksMetadata = metadataCandidates.map(candidate => ({
    title: candidate.title,
    author: candidate.authors[0] || '',
  }));

  logger.info('[HybridBackfill] Starting ISBN resolution', {
    books_to_resolve: booksMetadata.length,
  });

  const resolutions = await batchResolveISBNs(booksMetadata, apiKey, logger);

  // Step 3: Merge Gemini metadata with resolved ISBNs
  const enrichedCandidates: ISBNCandidate[] = [];

  for (let i = 0; i < metadataCandidates.length; i++) {
    const metadata = metadataCandidates[i];
    const resolution = resolutions[i];

    if (resolution.isbn) {
      enrichedCandidates.push({
        isbn: resolution.isbn,
        title: metadata.title,
        authors: metadata.authors,
        source: `${metadata.source}-isbndb-${resolution.confidence}`,
      });
    } else {
      logger.debug('[HybridBackfill] ISBN not resolved', {
        title: metadata.title,
        author: metadata.authors[0],
        confidence: resolution.confidence,
      });
    }
  }

  // Step 4: Calculate resolution stats
  const resolutionStats = {
    total_attempted: resolutions.length,
    resolved: resolutions.filter(r => r.isbn !== null).length,
    high_confidence: resolutions.filter(r => r.confidence === 'high').length,
    medium_confidence: resolutions.filter(r => r.confidence === 'medium').length,
    low_confidence: resolutions.filter(r => r.confidence === 'low').length,
    not_found: resolutions.filter(r => r.confidence === 'not_found').length,
    resolution_rate: 0,
  };

  resolutionStats.resolution_rate = resolutionStats.total_attempted > 0
    ? (resolutionStats.resolved / resolutionStats.total_attempted) * 100
    : 0;

  const duration = Date.now() - startTime;

  logger.info('[HybridBackfill] Workflow complete', {
    year,
    month,
    gemini_books: metadataCandidates.length,
    isbns_resolved: enrichedCandidates.length,
    resolution_rate: `${resolutionStats.resolution_rate.toFixed(1)}%`,
    high_confidence: resolutionStats.high_confidence,
    duration_ms: duration,
  });

  return {
    candidates: enrichedCandidates,
    stats: {
      ...geminiStats,
      isbn_resolution: resolutionStats,
      api_calls: {
        gemini: 1,
        isbndb: resolutions.length,
        total: 1 + resolutions.length,
      },
      duration_ms: duration,
    },
    resolutions,
  };
}
