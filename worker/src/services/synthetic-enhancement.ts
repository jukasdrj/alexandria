/**
 * Synthetic Works Enhancement Service
 *
 * Deferred enhancement system for synthetic works created during ISBNdb quota exhaustion.
 *
 * WORKFLOW:
 * 1. Query synthetic works needing enhancement (completeness_score < 50)
 * 2. Extract title/author from metadata (double-parse JSONB)
 * 3. Resolve ISBN via ISBNdb title/author search (reuse isbn-resolution.ts)
 * 4. If ISBN found:
 *    - Create enriched_editions record
 *    - Send to ENRICHMENT_QUEUE (triggers full enrichment)
 *    - Update work completeness_score to 80+
 * 5. Update last_isbndb_sync timestamp (success or failure)
 *
 * QUOTA MANAGEMENT:
 * - Check quota before batch enhancement
 * - Stop processing if quota exhausted mid-batch
 * - Record all API calls (even failures)
 *
 * @module services/synthetic-enhancement
 */

import type postgres from 'postgres';
import type { Env } from '../env.js';
import type { Logger } from '../../lib/logger.js';
import { getQuotaManager } from './quota-manager.js';
import type { ISBNResolutionResult } from './isbn-resolution.js';
import { ISBNResolutionOrchestrator } from '../../lib/external-services/orchestrators/index.js';
import { getGlobalRegistry } from '../../lib/external-services/provider-registry.js';
import { ISBNdbProvider } from '../../lib/external-services/providers/index.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Synthetic work candidate for enhancement
 * Extracted from enriched_works table
 */
export interface SyntheticWorkCandidate {
  work_key: string;
  title: string;
  author: string;
  publisher?: string;
  format?: string;
  publication_year?: number;
  completeness_score: number;
  created_at: Date;
  metadata: Record<string, unknown>;
}

/**
 * Enhancement result for a single work
 */
export interface EnhancementResult {
  work_key: string;
  success: boolean;
  isbn_found: boolean;
  isbn?: string;
  confidence?: 'high' | 'medium' | 'low' | 'not_found';
  error?: string;
  api_calls_used: number;
}

/**
 * Batch enhancement statistics
 */
export interface EnhancementBatchStats {
  total_attempted: number;
  isbns_resolved: number;
  editions_created: number;
  enrichment_queued: number;
  quota_exhausted: boolean;
  api_calls_used: number;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  not_found: number;
  errors: number;
  duration_ms: number;
}

// =================================================================================
// Query Functions
// =================================================================================

/**
 * Get synthetic works needing enhancement
 *
 * Uses optimized index: idx_enriched_works_synthetic_enhancement
 *
 * QUERY PATTERN:
 * - synthetic = true AND primary_provider = 'gemini-backfill'
 * - completeness_score < 50 (needs enhancement)
 * - last_isbndb_sync IS NULL (never attempted) OR last_isbndb_sync < NOW() - INTERVAL '7 days' (retry)
 * - ORDER BY created_at ASC (oldest first, FIFO)
 *
 * METADATA EXTRACTION:
 * - Metadata stored as stringified JSON in JSONB column
 * - Requires double-parse: (metadata#>>'{}')::jsonb->>'field'
 *
 * @param limit Maximum number of works to return (default: 100)
 * @param sql PostgreSQL connection
 * @param logger Logger instance
 * @returns Array of synthetic work candidates
 */
export async function getSyntheticWorksForEnhancement(
  limit: number = 500,  // Increased from 100 to 500 per Gemini Pro recommendation
  sql: postgres.Sql,
  logger: Logger
): Promise<SyntheticWorkCandidate[]> {
  try {
    logger.info('[SyntheticEnhancement] Querying works for enhancement', { limit });

    // Query with optimized index
    // CRITICAL: Double-parse metadata because it's stored as JSON.stringify() in JSONB
    const results = await sql<Array<{
      work_key: string;
      title: string;
      author: string;
      publisher: string | null;
      format: string | null;
      publication_year: number | null;
      completeness_score: number;
      created_at: Date;
      metadata: unknown;
    }>>`
      SELECT
        work_key,
        title,
        (metadata#>>'{}')::jsonb->>'gemini_author' as author,
        (metadata#>>'{}')::jsonb->>'gemini_publisher' as publisher,
        (metadata#>>'{}')::jsonb->>'gemini_format' as format,
        first_publication_year as publication_year,
        completeness_score,
        created_at,
        metadata
      FROM enriched_works
      WHERE synthetic = true
        AND primary_provider = 'gemini-backfill'
        AND completeness_score < 50
        AND (
          last_isbndb_sync IS NULL  -- Never attempted
          OR last_isbndb_sync < NOW() - INTERVAL '7 days'  -- Retry after 7 days
        )
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED  -- Gemini Pro: Prevent concurrent workers from selecting same works
    `;

    logger.info('[SyntheticEnhancement] Query complete', {
      found: results.length,
      limit,
    });

    // Parse metadata and construct candidates
    const candidates: SyntheticWorkCandidate[] = [];

    for (const row of results) {
      // Validate required fields
      if (!row.author) {
        logger.warn('[SyntheticEnhancement] Skipping work without author', {
          work_key: row.work_key,
          title: row.title,
        });
        continue;
      }

      // Parse metadata (already extracted fields, but keep full metadata for reference)
      let metadata: Record<string, unknown> = {};
      try {
        // Metadata is stringified JSON in JSONB column
        const metadataString = row.metadata as unknown as string;
        metadata = JSON.parse(metadataString);
      } catch (error) {
        logger.warn('[SyntheticEnhancement] Failed to parse metadata', {
          work_key: row.work_key,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      candidates.push({
        work_key: row.work_key,
        title: row.title,
        author: row.author,
        publisher: row.publisher || undefined,
        format: row.format || undefined,
        publication_year: row.publication_year || undefined,
        completeness_score: row.completeness_score,
        created_at: row.created_at,
        metadata,
      });
    }

    logger.info('[SyntheticEnhancement] Candidates prepared', {
      total: candidates.length,
      with_publisher: candidates.filter(c => c.publisher).length,
      with_format: candidates.filter(c => c.format).length,
    });

    return candidates;

  } catch (error) {
    logger.error('[SyntheticEnhancement] Query failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Enhance a single synthetic work
 *
 * WORKFLOW:
 * 1. Resolve ISBN via ISBNdb title/author search
 * 2. If ISBN found:
 *    a. Create enriched_editions record (links to work)
 *    b. Send ISBN to ENRICHMENT_QUEUE (triggers full ISBNdb + Open API enrichment)
 *    c. Update work completeness_score to 80
 * 3. Update last_isbndb_sync timestamp (success or failure)
 *
 * @param candidate Synthetic work to enhance
 * @param sql PostgreSQL connection
 * @param env Worker environment
 * @param logger Logger instance
 * @returns Enhancement result
 */
export async function enhanceSyntheticWork(
  candidate: SyntheticWorkCandidate,
  sql: postgres.Sql,
  env: Env,
  logger: Logger
): Promise<EnhancementResult> {
  const startTime = Date.now();

  try {
    logger.info('[SyntheticEnhancement] Enhancing work', {
      work_key: candidate.work_key,
      title: candidate.title,
      author: candidate.author,
    });

    // Initialize orchestrator with ISBNdb provider only
    // (Synthetic enhancement uses ISBNdb directly for high-quality resolution)
    const registry = getGlobalRegistry();
    registry.registerAll([new ISBNdbProvider()]);

    const orchestrator = new ISBNResolutionOrchestrator(registry, {
      providerTimeoutMs: 15000,
      enableLogging: true,
    });

    // Create singleton quota manager for ISBNdb tracking
    const quotaManager = getQuotaManager(env.QUOTA_KV, logger);

    // Resolve ISBN via NEW orchestrator
    // Uses Service Provider Framework with ISBNdb
    const result = await orchestrator.resolveISBN(
      candidate.title,
      candidate.author,
      { env, logger, quotaManager }
    );

    // Convert NEW confidence (0-100) to OLD format (string enum) for backward compatibility
    const confidence = result.confidence >= 85 ? 'high'
      : result.confidence >= 65 ? 'medium'
      : result.confidence >= 45 ? 'low'
      : 'not_found';

    const resolution: ISBNResolutionResult = {
      isbn: result.isbn,
      confidence,
      match_quality: result.confidence / 100,
      matched_title: null, // NEW orchestrator doesn't return matched_title
      source: result.source as any,
    };

    const apiCallsUsed = result.isbn ? 1 : 1; // Always 1 call (search endpoint)

    // If no ISBN found, mark as attempted and skip
    if (!resolution.isbn || resolution.confidence === 'not_found') {
      logger.info('[SyntheticEnhancement] ISBN not found', {
        work_key: candidate.work_key,
        title: candidate.title,
        confidence: resolution.confidence,
      });

      // Update last_isbndb_sync to prevent immediate retry
      await sql`
        UPDATE enriched_works
        SET
          last_isbndb_sync = NOW(),
          updated_at = NOW()
        WHERE work_key = ${candidate.work_key}
      `;

      return {
        work_key: candidate.work_key,
        success: false,
        isbn_found: false,
        confidence: resolution.confidence,
        api_calls_used: apiCallsUsed,
      };
    }

    logger.info('[SyntheticEnhancement] ISBN resolved', {
      work_key: candidate.work_key,
      isbn: resolution.isbn,
      confidence: resolution.confidence,
      match_quality: resolution.match_quality,
    });

    // Create enriched_editions record (minimal edition linking to work)
    // This allows the work to be found via ISBN searches
    await sql`
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
        ${resolution.isbn},
        ${candidate.work_key},
        ${candidate.title},
        ${candidate.publisher || null},
        ${candidate.publication_year ? candidate.publication_year.toString() : null},
        ${candidate.format || 'Unknown'},
        'synthetic-enhancement',
        50,  -- Partial completeness (has ISBN, needs full enrichment)
        ${resolution.match_quality * 100},  -- Convert 0.0-1.0 to 0-100
        'isbndb-title-author-search',
        ${JSON.stringify({
          enhancement_source: 'synthetic-enhancement',
          original_work_key: candidate.work_key,
          resolution_confidence: resolution.confidence,
          match_quality: resolution.match_quality,
          enhanced_at: new Date().toISOString(),
        })},
        NOW(),
        NOW()
      )
      ON CONFLICT (isbn) DO UPDATE SET
        -- If edition already exists, preserve existing work_key (Issue #173 - Grok Review Fix)
        -- Rationale: Confidence scores alone are insufficient to determine correct work linkage.
        -- Updating work_key based solely on higher confidence could corrupt valid relationships.
        -- Original work_key from first enrichment should be preserved unless manual review.
        updated_at = NOW()
    `;

    logger.info('[SyntheticEnhancement] Edition created', {
      isbn: resolution.isbn,
      work_key: candidate.work_key,
    });

    // Send to ENRICHMENT_QUEUE for full metadata enrichment
    // This triggers: ISBNdb batch fetch + Wikidata + Archive.org + Google Books + covers
    // CRITICAL: Only mark work as enhanced if queue succeeds (Gemini Pro recommendation)
    let queueSuccess = false;
    try {
      await env.ENRICHMENT_QUEUE.send({
        isbn: resolution.isbn,
        priority: 'low',  // Backfill priority (user requests are higher)
        source: 'synthetic-enhancement',
      });

      queueSuccess = true;
      logger.info('[SyntheticEnhancement] Queued for enrichment', {
        isbn: resolution.isbn,
        work_key: candidate.work_key,
      });
    } catch (queueError) {
      // DO NOT mark as fully enhanced - leave for retry or monitoring
      logger.error('[SyntheticEnhancement] Failed to queue for enrichment', {
        isbn: resolution.isbn,
        error: queueError instanceof Error ? queueError.message : String(queueError),
      });
    }

    // Update work: mark as enhanced ONLY if queue succeeded
    // 80 = Complete (ISBN + queued for full enrichment)
    // 40 = Partial (ISBN found but queue failed - needs manual retry or monitoring)
    await sql`
      UPDATE enriched_works
      SET
        completeness_score = ${queueSuccess ? 80 : 40},
        last_isbndb_sync = NOW(),
        updated_at = NOW()
      WHERE work_key = ${candidate.work_key}
    `;

    logger.info('[SyntheticEnhancement] Work enhanced successfully', {
      work_key: candidate.work_key,
      isbn: resolution.isbn,
      confidence: resolution.confidence,
      duration_ms: Date.now() - startTime,
    });

    return {
      work_key: candidate.work_key,
      success: true,
      isbn_found: true,
      isbn: resolution.isbn,
      confidence: resolution.confidence,
      api_calls_used: apiCallsUsed,
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[SyntheticEnhancement] Enhancement failed', {
      work_key: candidate.work_key,
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Update last_isbndb_sync to prevent immediate retry
    try {
      await sql`
        UPDATE enriched_works
        SET
          last_isbndb_sync = NOW(),
          updated_at = NOW()
        WHERE work_key = ${candidate.work_key}
      `;
    } catch (updateError) {
      logger.error('[SyntheticEnhancement] Failed to update timestamp', {
        work_key: candidate.work_key,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      });
    }

    return {
      work_key: candidate.work_key,
      success: false,
      isbn_found: false,
      error: errorMsg,
      api_calls_used: 1, // Assume 1 call was made before error
    };
  }
}

/**
 * Enhance a batch of synthetic works
 *
 * QUOTA MANAGEMENT:
 * - Checks quota before starting
 * - Stops processing if quota exhausted mid-batch
 * - Records all API calls (even failures)
 * - Returns partial results if quota exhausted
 *
 * RATE LIMITING:
 * - ISBNdb Premium: 3 req/sec
 * - 350ms delay between requests (built into isbn-resolution.ts)
 *
 * @param candidates Array of synthetic works to enhance
 * @param sql PostgreSQL connection
 * @param env Worker environment
 * @param logger Logger instance
 * @returns Batch enhancement statistics
 */
export async function enhanceSyntheticBatch(
  candidates: SyntheticWorkCandidate[],
  sql: postgres.Sql,
  env: Env,
  logger: Logger
): Promise<EnhancementBatchStats> {
  const startTime = Date.now();

  const stats: EnhancementBatchStats = {
    total_attempted: 0,
    isbns_resolved: 0,
    editions_created: 0,
    enrichment_queued: 0,
    quota_exhausted: false,
    api_calls_used: 0,
    high_confidence: 0,
    medium_confidence: 0,
    low_confidence: 0,
    not_found: 0,
    errors: 0,
    duration_ms: 0,
  };

  logger.info('[SyntheticEnhancement] Starting batch enhancement', {
    batch_size: candidates.length,
  });

  // Initialize singleton quota manager with atomic reservation pattern (Issue #173 - Grok Review Fix)
  const quotaManager = getQuotaManager(env.QUOTA_KV, logger);
  let quotaExhausted = false;

  // Create quota check lambda with atomic reservation (same pattern as isbn-resolution.ts)
  const quotaCheck = async (): Promise<boolean> => {
    if (quotaExhausted) return false;
    const result = await quotaManager.checkQuota(1, true);  // reserveQuota=true for atomic operation
    if (!result.allowed) {
      quotaExhausted = true;
      return false;
    }
    return true;
  };

  // Check initial quota availability (non-reserving check for logging)
  const initialQuotaCheck = await quotaManager.checkQuota(candidates.length, false);
  if (!initialQuotaCheck.allowed) {
    logger.warn('[SyntheticEnhancement] Insufficient quota for batch', {
      requested: candidates.length,
      available: initialQuotaCheck.status.buffer_remaining,
    });

    stats.quota_exhausted = true;
    stats.duration_ms = Date.now() - startTime;
    return stats;
  }

  logger.info('[SyntheticEnhancement] Quota check passed', {
    batch_size: candidates.length,
    quota_available: initialQuotaCheck.status.buffer_remaining,
  });

  // Process each candidate with atomic quota reservation
  for (const candidate of candidates) {
    // Check and reserve quota atomically before each request
    const quotaAllowed = await quotaCheck();
    if (!quotaAllowed) {
      logger.warn('[SyntheticEnhancement] Quota exhausted mid-batch', {
        processed: stats.total_attempted,
        remaining: candidates.length - stats.total_attempted,
      });
      stats.quota_exhausted = true;
      break;
    }

    stats.total_attempted++;

    const result = await enhanceSyntheticWork(candidate, sql, env, logger);

    // Update statistics
    stats.api_calls_used += result.api_calls_used;

    if (result.success && result.isbn_found) {
      stats.isbns_resolved++;
      stats.editions_created++;
      stats.enrichment_queued++; // Assuming queue send succeeded (logged if failed)

      // Track confidence levels
      if (result.confidence === 'high') stats.high_confidence++;
      else if (result.confidence === 'medium') stats.medium_confidence++;
      else if (result.confidence === 'low') stats.low_confidence++;
    } else if (result.confidence === 'not_found') {
      stats.not_found++;
    }

    if (result.error) {
      stats.errors++;
    }
  }

  // Record total API calls used
  if (stats.api_calls_used > 0) {
    await quotaManager.recordApiCall(stats.api_calls_used);
  }

  stats.duration_ms = Date.now() - startTime;

  logger.info('[SyntheticEnhancement] Batch enhancement complete', {
    total_attempted: stats.total_attempted,
    isbns_resolved: stats.isbns_resolved,
    editions_created: stats.editions_created,
    quota_exhausted: stats.quota_exhausted,
    api_calls_used: stats.api_calls_used,
    resolution_rate: stats.total_attempted > 0
      ? ((stats.isbns_resolved / stats.total_attempted) * 100).toFixed(1) + '%'
      : '0%',
    duration_ms: stats.duration_ms,
  });

  return stats;
}
