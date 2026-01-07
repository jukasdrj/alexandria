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
  };
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

  await kv.put(
    `${JOB_STATUS_PREFIX}${job_id}`,
    JSON.stringify(status),
    { expirationTtl: JOB_STATUS_TTL }
  );
}

/**
 * Update job status in KV
 */
export async function updateJobStatus(
  kv: KVNamespace,
  job_id: string,
  updates: Partial<BackfillJobStatus>
): Promise<void> {
  const existing = await getJobStatus(kv, job_id);
  if (!existing) {
    throw new Error(`Job ${job_id} not found`);
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
}

/**
 * Get job status from KV
 */
export async function getJobStatus(
  kv: KVNamespace,
  job_id: string
): Promise<BackfillJobStatus | null> {
  const data = await kv.get(`${JOB_STATUS_PREFIX}${job_id}`);
  if (!data) {
    return null;
  }

  return JSON.parse(data) as BackfillJobStatus;
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
 * 4. Update job status: "enriching" (ENRICHMENT_QUEUE will handle the rest)
 * 5. Mark as "complete" (enrichment happens async)
 *
 * Note: We don't wait for enrichment to complete - that's handled by existing queue
 */
export async function processBackfillJob(
  message: BackfillQueueMessage,
  env: Env,
  logger: Logger
): Promise<void> {
  const { job_id, year, month, batch_size } = message;
  const startTime = Date.now();

  try {
    logger.info('[AsyncBackfill] Processing job', { job_id, year, month });

    // Update status: processing
    await updateJobStatus(env.QUOTA_KV, job_id, {
      status: 'processing',
      progress: `Generating book list for ${year}-${month.toString().padStart(2, '0')}...`,
    });

    // Step 1: Run hybrid workflow (Gemini + ISBNdb resolution)
    const hybridResult = await generateHybridBackfillList(
      year,
      month,
      env,
      logger,
      batch_size
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

    // Step 2: Send ISBNs to ENRICHMENT_QUEUE (reuse existing infrastructure!)
    // This is the same pattern as bendv3 CSV imports
    const isbnsToEnrich = hybridResult.candidates.map(c => c.isbn);

    if (isbnsToEnrich.length === 0) {
      logger.warn('[AsyncBackfill] No ISBNs to enrich', { job_id, year, month });
      await updateJobStatus(env.QUOTA_KV, job_id, {
        status: 'complete',
        progress: 'No ISBNs resolved - job complete',
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    // Send to enrichment queue in batches (max 100 per message)
    const enrichmentBatchSize = 100;
    let totalSent = 0;

    for (let i = 0; i < isbnsToEnrich.length; i += enrichmentBatchSize) {
      const batch = isbnsToEnrich.slice(i, i + enrichmentBatchSize);

      await env.ENRICHMENT_QUEUE.send({
        isbns: batch,
        source: `backfill-${year}-${month.toString().padStart(2, '0')}`,
        priority: 'low', // Background job, low priority
        job_id, // Link back to backfill job
      });

      totalSent += batch.length;
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
      },
    });

    // Note: We mark as "complete" here because enrichment happens async
    // The ENRICHMENT_QUEUE consumer will handle the actual ISBNdb calls
    const duration = Date.now() - startTime;

    await updateJobStatus(env.QUOTA_KV, job_id, {
      status: 'complete',
      progress: `Backfill queued successfully. ${totalSent} ISBNs will be enriched async via ENRICHMENT_QUEUE.`,
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
