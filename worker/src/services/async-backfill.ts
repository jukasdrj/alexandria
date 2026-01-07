/**
 * Async Backfill Service - Queue-based Historical Book Harvesting
 *
 * ARCHITECTURE (Reuses Existing Infrastructure):
 * 1. POST /api/harvest/backfill → Create job, send to BACKFILL_QUEUE, return 202
 * 2. BACKFILL_QUEUE Consumer → Run hybrid workflow (Gemini generates ISBNs)
 * 3. Send resolved ISBNs to ENRICHMENT_QUEUE (existing infrastructure!)
 * 4. ENRICHMENT_QUEUE Consumer → Batch fetch from ISBNdb, enrich database
 * 5. Update job status in KV throughout process
 *
 * BENEFITS:
 * - No client timeouts (202 Accepted pattern)
 * - Reuses battle-tested ENRICHMENT_QUEUE infrastructure
 * - ISBNdb calls happen async (no sync requirement with Gemini)
 * - Each queue message gets own 300s CPU budget
 *
 * @module services/async-backfill
 */

import type { Env } from '../env.js';
import type { Logger } from '../../lib/logger.js';
import { generateHybridBackfillList } from './hybrid-backfill.js';

// =================================================================================
// Types
// =================================================================================

export interface BackfillJobRequest {
  year: number;
  month: number;
  max_quota?: number;
  batch_size?: number;
}

export interface BackfillJobStatus {
  job_id: string;
  year: number;
  month: number;
  status: 'queued' | 'processing' | 'enriching' | 'complete' | 'failed';
  progress: string;
  stats?: {
    gemini_books_generated?: number;
    isbns_resolved?: number;
    isbn_resolution_rate?: number;
    isbns_sent_to_enrichment?: number;
    already_enriched?: number;
    editions_enriched?: number;
    covers_queued?: number;
    valid_isbns?: number;
    invalid_isbns?: number;
    exact_dedup_matches?: number;
    related_dedup_matches?: number;
    fuzzy_dedup_matches?: number;
    new_isbns?: number;
    new_isbn_percentage?: number;
    isbndb_hits?: number;
    isbndb_hit_rate?: number;
    gemini_calls?: number;
    isbndb_calls?: number;
    total_api_calls?: number;
    quota_used?: number;
  };
  experiment_id?: string;
  dry_run?: boolean;
  prompt_variant?: string;
  model_used?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface BackfillQueueMessage {
  job_id: string;
  year: number;
  month: number;
  batch_size: number;
  dry_run?: boolean;
  experiment_id?: string;
  prompt_override?: string;
  model_override?: string;
  max_quota?: number;
}

// =================================================================================
// Job Status Management (KV)
// =================================================================================

const JOB_STATUS_PREFIX = 'backfill:job:';
const JOB_STATUS_TTL = 7 * 24 * 60 * 60; // 7 days

/**
 * Create initial job status in KV
 */
export async function createJobStatus(
  kv: KVNamespace,
  job_id: string,
  year: number,
  month: number
): Promise<void> {
  const status: BackfillJobStatus = {
    job_id,
    year,
    month,
    status: 'queued',
    progress: 'Job queued for processing',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await kv.put(
      `${JOB_STATUS_PREFIX}${job_id}`,
      JSON.stringify(status),
      { expirationTtl: JOB_STATUS_TTL }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create job status in KV: ${errorMsg}. Job ${job_id} will not be trackable.`);
  }
}

/**
 * Update job status in KV
 */
export async function updateJobStatus(
  kv: KVNamespace,
  job_id: string,
  updates: Partial<BackfillJobStatus>
): Promise<void> {
  try {
    const existing = await getJobStatus(kv, job_id);
    if (!existing) {
      throw new Error(`Job ${job_id} not found in KV - may have expired or never been created`);
    }

    const updated: BackfillJobStatus = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    await kv.put(
      `${JOB_STATUS_PREFIX}${job_id}`,
      JSON.stringify(updated),
      { expirationTtl: JOB_STATUS_TTL }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to update job ${job_id} status: ${errorMsg}`);
  }
}

/**
 * Get job status from KV
 */
export async function getJobStatus(
  kv: KVNamespace,
  job_id: string
): Promise<BackfillJobStatus | null> {
  try {
    const data = await kv.get(`${JOB_STATUS_PREFIX}${job_id}`);
    if (!data) {
      return null;
    }

    return JSON.parse(data) as BackfillJobStatus;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get job status for ${job_id}: ${errorMsg}. KV data may be corrupted.`);
  }
}

// =================================================================================
// Queue Consumer Logic
// =================================================================================

/**
 * Process backfill job from queue
 *
 * WORKFLOW:
 * 1. Run hybrid workflow (Gemini → ISBNdb ISBN resolution)
 * 2. Update job status: "processing"
 * 3. Send resolved ISBNs to ENRICHMENT_QUEUE (existing infrastructure!)
 * 4. Update job status: "enriching" (ENRICHMENT_QUEUE will handle ISBNdb fetch + DB writes)
 * 5. Mark as "complete" - THIS JOB is done (enrichment continues async in separate queue)
 *
 * IMPORTANT: "complete" status means THIS BACKFILL JOB completed its work
 * (Gemini generation → ISBN resolution → queuing for enrichment).
 * The actual ISBNdb fetching + database writes happen async in ENRICHMENT_QUEUE.
 */
export async function processBackfillJob(
  message: BackfillQueueMessage,
  env: Env,
  logger: Logger
): Promise<void> {
  const { job_id, year, month, batch_size, dry_run, experiment_id, prompt_override, model_override } = message;
  const startTime = Date.now();

  try {
    logger.info('[AsyncBackfill] Processing job', {
      job_id,
      year,
      month,
      dry_run,
      experiment_id,
    });

    // Update status: processing (include experiment metadata)
    await updateJobStatus(env.QUOTA_KV, job_id, {
      status: 'processing',
      progress: dry_run
        ? `[DRY-RUN] Generating book list for ${year}-${month.toString().padStart(2, '0')}...`
        : `Generating book list for ${year}-${month.toString().padStart(2, '0')}...`,
      experiment_id,
      dry_run,
      prompt_variant: prompt_override || 'baseline',
      model_used: model_override || 'default',
    });

    // Step 1: Run hybrid workflow (Gemini + ISBNdb resolution)
    const hybridResult = await generateHybridBackfillList(
      year,
      month,
      env,
      logger,
      batch_size,
      prompt_override,
      model_override
    );

    logger.info('[AsyncBackfill] Hybrid workflow complete', {
      job_id,
      books_generated: hybridResult.stats.total_books,
      isbns_resolved: hybridResult.candidates.length,
      resolution_rate: hybridResult.stats.isbn_resolution.resolution_rate,
    });

    // Update status with Gemini stats
    await updateJobStatus(env.QUOTA_KV, job_id, {
      progress: `Resolved ${hybridResult.candidates.length} ISBNs, sending to enrichment queue...`,
      stats: {
        gemini_books_generated: hybridResult.stats.total_books,
        isbns_resolved: hybridResult.candidates.length,
        isbn_resolution_rate: hybridResult.stats.isbn_resolution.resolution_rate,
      },
    });

    // Step 2: Extract ISBNs from candidates
    const isbnsToEnrich = hybridResult.candidates.map(c => c.isbn).filter(isbn => isbn);

    if (isbnsToEnrich.length === 0) {
      logger.warn('[AsyncBackfill] No ISBNs to enrich', { job_id, year, month });
      await updateJobStatus(env.QUOTA_KV, job_id, {
        status: 'complete',
        progress: dry_run
          ? '[DRY-RUN] No ISBNs resolved - experiment complete'
          : 'No ISBNs resolved - job complete',
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        stats: {
          gemini_books_generated: hybridResult.stats.total_books,
          isbns_resolved: 0,
          gemini_calls: hybridResult.stats.api_calls.gemini,
          isbndb_calls: hybridResult.stats.api_calls.isbndb,
          total_api_calls: hybridResult.stats.api_calls.total,
        },
      });
      return;
    }

    // DRY-RUN MODE: Skip enrichment queue, just return metrics
    if (dry_run) {
      const duration = Date.now() - startTime;

      logger.info('[AsyncBackfill:DryRun] Skipping enrichment queue', {
        job_id,
        experiment_id,
        isbns_resolved: isbnsToEnrich.length,
      });

      await updateJobStatus(env.QUOTA_KV, job_id, {
        status: 'complete',
        progress: `[DRY-RUN] Experiment complete. ${isbnsToEnrich.length} ISBNs resolved (enrichment skipped).`,
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        stats: {
          gemini_books_generated: hybridResult.stats.total_books,
          isbns_resolved: isbnsToEnrich.length,
          isbn_resolution_rate: hybridResult.stats.isbn_resolution.resolution_rate,
          // Dedup stats would go here (TODO: add deduplication step)
          gemini_calls: hybridResult.stats.api_calls.gemini,
          isbndb_calls: hybridResult.stats.api_calls.isbndb,
          total_api_calls: hybridResult.stats.api_calls.total,
        },
      });

      logger.info('[AsyncBackfill:DryRun] Experiment complete', {
        job_id,
        experiment_id,
        duration_ms: duration,
      });

      return; // Exit early - no enrichment in dry-run
    }

    // PRODUCTION MODE: Send to enrichment queue in batches (max 100 per message)
    const enrichmentBatchSize = 100;
    let totalSent = 0;

    for (let i = 0; i < isbnsToEnrich.length; i += enrichmentBatchSize) {
      const batch = isbnsToEnrich.slice(i, i + enrichmentBatchSize);
      const batchNum = Math.floor(i / enrichmentBatchSize) + 1;

      try {
        await env.ENRICHMENT_QUEUE.send({
          isbns: batch,
          source: `backfill-${year}-${month.toString().padStart(2, '0')}`,
          priority: 'low', // Background job, low priority
          job_id, // Link back to backfill job
        });

        totalSent += batch.length;
        logger.debug('[AsyncBackfill] Sent batch to enrichment queue', {
          job_id,
          batch_num: batchNum,
          batch_size: batch.length,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('[AsyncBackfill] Failed to send batch to enrichment queue', {
          job_id,
          batch_num: batchNum,
          batch_size: batch.length,
          error: errorMsg,
        });

        // Critical: If we can't queue enrichment, the job is failing
        throw new Error(
          `Failed to send batch ${batchNum} to enrichment queue: ${errorMsg}. ` +
          `${totalSent} of ${isbnsToEnrich.length} ISBNs sent before failure.`
        );
      }
    }

    logger.info('[AsyncBackfill] Sent ISBNs to enrichment queue', {
      job_id,
      total_sent: totalSent,
      batches: Math.ceil(isbnsToEnrich.length / enrichmentBatchSize),
    });

    // Step 3: Update status to "enriching"
    // The ENRICHMENT_QUEUE consumer will handle ISBNdb batch fetching & DB writes
    await updateJobStatus(env.QUOTA_KV, job_id, {
      status: 'enriching',
      progress: `${totalSent} ISBNs sent to enrichment queue (processing async)`,
      stats: {
        gemini_books_generated: hybridResult.stats.total_books,
        isbns_resolved: hybridResult.candidates.length,
        isbn_resolution_rate: hybridResult.stats.isbn_resolution.resolution_rate,
        isbns_sent_to_enrichment: totalSent,
        gemini_calls: hybridResult.stats.api_calls.gemini,
        isbndb_calls: hybridResult.stats.api_calls.isbndb,
        total_api_calls: hybridResult.stats.api_calls.total,
      },
    });

    // IMPORTANT: "complete" means the BACKFILL JOB is done, NOT enrichment itself
    // The ENRICHMENT_QUEUE consumer handles actual ISBNdb fetching + DB writes async
    // This job's responsibility was: Gemini → ISBN resolution → queue ISBNs
    const duration = Date.now() - startTime;

    await updateJobStatus(env.QUOTA_KV, job_id, {
      status: 'complete',
      progress: `Backfill job complete. ${totalSent} ISBNs queued for async enrichment via ENRICHMENT_QUEUE.`,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
    });

    logger.info('[AsyncBackfill] Job complete', {
      job_id,
      year,
      month,
      duration_ms: duration,
    });

  } catch (error) {
    logger.error('[AsyncBackfill] Job failed', {
      job_id,
      year,
      month,
      error: error instanceof Error ? error.message : String(error),
    });

    await updateJobStatus(env.QUOTA_KV, job_id, {
      status: 'failed',
      progress: 'Job failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    throw error; // Re-throw for queue retry logic
  }
}
