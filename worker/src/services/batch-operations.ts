/**
 * Batch Database Operations Service
 *
 * Provides high-performance batch database operations for cover harvest and enrichment.
 */

import type { Sql } from 'postgres';
import type { Logger } from '../../lib/logger.js';

const MAX_CHUNK_SIZE = 500;

export interface CoverUrlUpdate {
  isbn: string;
  cover_url_large: string | null;
  cover_url_medium: string | null;
  cover_url_small: string | null;
  cover_url_original: string | null;
  cover_source: string;
}

export interface BatchResult {
  success: boolean;
  total_rows: number;
  rows_affected: number;
  chunks_processed: number;
  chunks_failed: number;
  duration_ms: number;
  errors: Array<{ chunk_index: number; error: string }>;
}

export async function batchUpdateCoverUrls(
  sql: Sql,
  updates: CoverUrlUpdate[],
  logger: Logger
): Promise<BatchResult> {
  const startTime = Date.now();
  const result: BatchResult = {
    success: true,
    total_rows: updates.length,
    rows_affected: 0,
    chunks_processed: 0,
    chunks_failed: 0,
    duration_ms: 0,
    errors: [],
  };

  if (updates.length === 0) {
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const chunks = chunkArray(updates, MAX_CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const values = chunk.map(update => [
        update.isbn,
        update.cover_url_large,
        update.cover_url_medium,
        update.cover_url_small,
        update.cover_url_original,
        update.cover_source
      ]);

      const updateResult = await sql`
        UPDATE enriched_editions e
        SET
          cover_url_large = v.cover_url_large,
          cover_url_medium = v.cover_url_medium,
          cover_url_small = v.cover_url_small,
          cover_url_original = v.cover_url_original,
          cover_source = v.cover_source,
          updated_at = NOW()
        FROM (VALUES ${sql(values)}) AS v(isbn, cover_url_large, cover_url_medium, cover_url_small, cover_url_original, cover_source)
        WHERE e.isbn = v.isbn
      `;

      result.rows_affected += updateResult.count || 0;
      result.chunks_processed++;
    } catch (error) {
      result.success = false;
      result.chunks_failed++;
      result.errors.push({
        chunk_index: i + 1,
        error: error instanceof Error ? error.message : String(error)
      });
      logger.error('Batch update chunk failed', { chunk: i + 1, error });
    }
  }

  result.duration_ms = Date.now() - startTime;
  logger.info('Batch update complete', {
    total: result.total_rows,
    affected: result.rows_affected,
    duration_ms: result.duration_ms
  });

  return result;
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
