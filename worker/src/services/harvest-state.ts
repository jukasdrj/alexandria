/**
 * Harvest State Management - KV-based progress tracking for backfill operations
 *
 * Enables idempotent, resumable backfill operations by tracking:
 * - Which years have been processed
 * - Which months within each year are complete
 * - Total books enriched, covers harvested, quota used
 *
 * KV Keys:
 * - `harvest:backfill:{year}` - BackfillProgress JSON
 * - `harvest:backfill:meta` - Global metadata (last_run, total_books, etc.)
 *
 * Used by: harvest.ts (POST /api/harvest/backfill endpoint)
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { Logger } from '../../lib/logger.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Progress tracking for a single year's backfill
 */
export interface BackfillProgress {
  year: number;

  /** Months completed (1-12) */
  months_completed: number[];

  /** Total ISBNs processed for this year */
  total_isbns: number;

  /** ISBNs that were new (not duplicates) */
  unique_isbns: number;

  /** ISBNs skipped (duplicates) */
  duplicate_isbns: number;

  /** Covers successfully harvested */
  covers_harvested: number;

  /** ISBNdb API calls made for this year */
  quota_used: number;

  /** When backfill started for this year */
  started_at: string; // ISO 8601

  /** When last month was completed */
  last_updated: string; // ISO 8601

  /** Whether all 12 months are complete */
  is_complete: boolean;
}

/**
 * Global backfill metadata
 */
export interface BackfillMetadata {
  /** Years that have been started */
  years_started: number[];

  /** Years that are 100% complete */
  years_completed: number[];

  /** Total books enriched across all years */
  total_books: number;

  /** Total covers harvested across all years */
  total_covers: number;

  /** Total ISBNdb calls made across all years */
  total_quota_used: number;

  /** When backfill system was first used */
  first_run: string; // ISO 8601

  /** When any backfill operation last ran */
  last_run: string; // ISO 8601
}

/**
 * Result of recording monthly progress
 */
export interface ProgressUpdateResult {
  success: boolean;
  year: number;
  month: number;
  year_is_complete: boolean;
  error?: string;
}

// =================================================================================
// HarvestState Class
// =================================================================================

export class HarvestState {
  private kv: KVNamespace;
  private logger: Logger;

  constructor(kv: KVNamespace, logger: Logger) {
    this.kv = kv;
    this.logger = logger;
  }

  // ===============================================================================
  // Year Progress Management
  // ===============================================================================

  /**
   * Get progress for a specific year
   * Returns null if year hasn't been started yet
   */
  async getYearProgress(year: number): Promise<BackfillProgress | null> {
    try {
      const key = `harvest:backfill:${year}`;
      const data = await this.kv.get(key, 'json');

      if (!data) {
        return null;
      }

      return data as BackfillProgress;
    } catch (error) {
      this.logger.error('[HarvestState] Failed to get year progress', { year, error });
      return null;
    }
  }

  /**
   * Initialize progress tracking for a new year
   */
  async initializeYear(year: number): Promise<BackfillProgress> {
    const progress: BackfillProgress = {
      year,
      months_completed: [],
      total_isbns: 0,
      unique_isbns: 0,
      duplicate_isbns: 0,
      covers_harvested: 0,
      quota_used: 0,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      is_complete: false,
    };

    try {
      const key = `harvest:backfill:${year}`;
      await this.kv.put(key, JSON.stringify(progress));

      this.logger.info('[HarvestState] Initialized year', { year });
      return progress;
    } catch (error) {
      this.logger.error('[HarvestState] Failed to initialize year', { year, error });
      throw error;
    }
  }

  /**
   * Record completion of a month's backfill
   *
   * IMPORTANT: This method has a read-modify-write pattern that is NOT safe for
   * concurrent operations on the same year. Do not run multiple backfill operations
   * for different months of the same year simultaneously, as the last write will win
   * and may lose progress data.
   *
   * This is acceptable for the current design (single cron schedule, manual API calls
   * process one month at a time), but would need optimistic locking (KV metadata
   * versioning) if concurrent year processing is required in the future.
   *
   * @param year - Year being processed
   * @param month - Month completed (1-12)
   * @param stats - Statistics from deduplication + enrichment
   */
  async recordMonthComplete(
    year: number,
    month: number,
    stats: {
      total_isbns: number;
      unique_isbns: number;
      duplicate_isbns: number;
      covers_harvested: number;
      quota_used: number;
    }
  ): Promise<ProgressUpdateResult> {
    try {
      // Get or initialize year progress
      let progress = await this.getYearProgress(year);
      if (!progress) {
        progress = await this.initializeYear(year);
      }

      // Check if month already completed (idempotency)
      if (progress.months_completed.includes(month)) {
        this.logger.warn('[HarvestState] Month already completed', { year, month });
        return {
          success: true,
          year,
          month,
          year_is_complete: progress.is_complete,
        };
      }

      // Update progress
      progress.months_completed.push(month);
      progress.months_completed.sort((a, b) => a - b); // Keep sorted
      progress.total_isbns += stats.total_isbns;
      progress.unique_isbns += stats.unique_isbns;
      progress.duplicate_isbns += stats.duplicate_isbns;
      progress.covers_harvested += stats.covers_harvested;
      progress.quota_used += stats.quota_used;
      progress.last_updated = new Date().toISOString();
      progress.is_complete = progress.months_completed.length === 12;

      // Save updated progress
      const key = `harvest:backfill:${year}`;
      await this.kv.put(key, JSON.stringify(progress));

      // Update global metadata
      await this.updateMetadata(year, stats, progress.is_complete);

      this.logger.info('[HarvestState] Recorded month complete', {
        year,
        month,
        months_completed: progress.months_completed.length,
        year_is_complete: progress.is_complete,
      });

      return {
        success: true,
        year,
        month,
        year_is_complete: progress.is_complete,
      };
    } catch (error) {
      this.logger.error('[HarvestState] Failed to record month', { year, month, error });
      return {
        success: false,
        year,
        month,
        year_is_complete: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get next incomplete month for a year
   * Returns null if year is complete
   */
  async getNextMonth(year: number): Promise<number | null> {
    const progress = await this.getYearProgress(year);

    if (!progress) {
      return 1; // Start with January
    }

    if (progress.is_complete) {
      return null; // Year is done
    }

    // Find first missing month (1-12)
    for (let month = 1; month <= 12; month++) {
      if (!progress.months_completed.includes(month)) {
        return month;
      }
    }

    return null;
  }

  // ===============================================================================
  // Global Metadata Management
  // ===============================================================================

  /**
   * Get global backfill metadata
   */
  async getMetadata(): Promise<BackfillMetadata | null> {
    try {
      const data = await this.kv.get('harvest:backfill:meta', 'json');

      if (!data) {
        return null;
      }

      return data as BackfillMetadata;
    } catch (error) {
      this.logger.error('[HarvestState] Failed to get metadata', { error });
      return null;
    }
  }

  /**
   * Initialize global metadata
   */
  private async initializeMetadata(): Promise<BackfillMetadata> {
    const metadata: BackfillMetadata = {
      years_started: [],
      years_completed: [],
      total_books: 0,
      total_covers: 0,
      total_quota_used: 0,
      first_run: new Date().toISOString(),
      last_run: new Date().toISOString(),
    };

    try {
      await this.kv.put('harvest:backfill:meta', JSON.stringify(metadata));
      return metadata;
    } catch (error) {
      this.logger.error('[HarvestState] Failed to initialize metadata', { error });
      throw error;
    }
  }

  /**
   * Update global metadata after month completion
   */
  private async updateMetadata(
    year: number,
    stats: { unique_isbns: number; covers_harvested: number; quota_used: number },
    yearIsComplete: boolean
  ): Promise<void> {
    try {
      let metadata = await this.getMetadata();
      if (!metadata) {
        metadata = await this.initializeMetadata();
      }

      // Add year to started list if not present
      if (!metadata.years_started.includes(year)) {
        metadata.years_started.push(year);
        metadata.years_started.sort((a, b) => b - a); // Descending order
      }

      // Add to completed list if year just finished
      if (yearIsComplete && !metadata.years_completed.includes(year)) {
        metadata.years_completed.push(year);
        metadata.years_completed.sort((a, b) => b - a); // Descending order
      }

      // Increment totals
      metadata.total_books += stats.unique_isbns;
      metadata.total_covers += stats.covers_harvested;
      metadata.total_quota_used += stats.quota_used;
      metadata.last_run = new Date().toISOString();

      await this.kv.put('harvest:backfill:meta', JSON.stringify(metadata));
    } catch (error) {
      this.logger.error('[HarvestState] Failed to update metadata', { error });
      // Don't throw - metadata update failure shouldn't block progress tracking
    }
  }

  // ===============================================================================
  // Utility Methods
  // ===============================================================================

  /**
   * Get list of years that need processing
   * Returns years in descending order (newest first)
   *
   * @param startYear - Oldest year to backfill (default: 2005)
   * @param endYear - Newest year to backfill (default: current year)
   */
  async getIncompleteYears(
    startYear: number = 2005,
    endYear: number = new Date().getFullYear()
  ): Promise<number[]> {
    const incomplete: number[] = [];

    for (let year = endYear; year >= startYear; year--) {
      const progress = await this.getYearProgress(year);

      if (!progress || !progress.is_complete) {
        incomplete.push(year);
      }
    }

    return incomplete;
  }

  /**
   * Check if a specific month has been completed
   */
  async isMonthComplete(year: number, month: number): Promise<boolean> {
    const progress = await this.getYearProgress(year);

    if (!progress) {
      return false;
    }

    return progress.months_completed.includes(month);
  }

  /**
   * Get summary statistics for backfill progress
   */
  async getSummary(): Promise<{
    years_total: number;
    years_completed: number;
    years_in_progress: number;
    total_books: number;
    total_covers: number;
    total_quota_used: number;
  }> {
    const metadata = await this.getMetadata();

    if (!metadata) {
      return {
        years_total: 0,
        years_completed: 0,
        years_in_progress: 0,
        total_books: 0,
        total_covers: 0,
        total_quota_used: 0,
      };
    }

    return {
      years_total: metadata.years_started.length,
      years_completed: metadata.years_completed.length,
      years_in_progress: metadata.years_started.length - metadata.years_completed.length,
      total_books: metadata.total_books,
      total_covers: metadata.total_covers,
      total_quota_used: metadata.total_quota_used,
    };
  }

  /**
   * Reset all progress for a year (use with caution!)
   */
  async resetYear(year: number): Promise<void> {
    try {
      const key = `harvest:backfill:${year}`;
      await this.kv.delete(key);

      this.logger.warn('[HarvestState] Reset year progress', { year });
    } catch (error) {
      this.logger.error('[HarvestState] Failed to reset year', { year, error });
      throw error;
    }
  }
}
