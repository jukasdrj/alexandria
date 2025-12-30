/**
 * Centralized ISBNdb API Quota Management Service
 *
 * Manages the ISBNdb Premium daily quota (15,000 calls/day) across all harvesting operations:
 * - Scheduled cron harvesting
 * - Bulk author processing
 * - Direct batch enrichment
 * - Queue-based enrichment
 * - New releases harvesting
 *
 * Uses Cloudflare KV for atomic operations and distributed coordination.
 */

export interface QuotaStatus {
  used_today: number;
  remaining: number;
  limit: number;
  last_reset: string;
  next_reset_in_hours: number;
  buffer_remaining: number;
  can_make_calls: boolean;
}

export interface QuotaCheckResult {
  allowed: boolean;
  status: QuotaStatus;
  reason?: string;
}

export class QuotaManager {
  private kv: KVNamespace;
  private readonly DAILY_LIMIT = 15000; // ISBNdb Premium quota
  private readonly SAFETY_BUFFER = 2000; // Keep 2K calls in reserve (use 13K max)
  private readonly QUOTA_KEY = 'isbndb_daily_calls';
  private readonly RESET_KEY = 'isbndb_quota_last_reset';

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  /**
   * Check if quota is available and optionally reserve API calls
   * @param requestCount Number of API calls to reserve (default: 1)
   * @param reserveQuota Whether to actually reserve the quota (default: false)
   * @returns QuotaCheckResult with availability and status
   */
  async checkQuota(requestCount: number = 1, reserveQuota: boolean = false): Promise<QuotaCheckResult> {
    const status = await this.getQuotaStatus();

    // Check if we have enough quota remaining
    const effectiveLimit = this.DAILY_LIMIT - this.SAFETY_BUFFER;
    const wouldExceedLimit = (status.used_today + requestCount) > effectiveLimit;

    if (wouldExceedLimit) {
      return {
        allowed: false,
        status,
        reason: `Request would exceed daily limit. Need ${requestCount} calls, but only ${status.buffer_remaining} remaining.`
      };
    }

    // If we're just checking (not reserving), return success
    if (!reserveQuota) {
      return {
        allowed: true,
        status
      };
    }

    // Reserve the quota atomically
    const success = await this.reserveQuota(requestCount);
    if (!success) {
      // Race condition: quota was exhausted between check and reserve
      const updatedStatus = await this.getQuotaStatus();
      return {
        allowed: false,
        status: updatedStatus,
        reason: 'Quota was exhausted by concurrent request'
      };
    }

    // Return updated status after reservation
    const finalStatus = await this.getQuotaStatus();
    return {
      allowed: true,
      status: finalStatus
    };
  }

  /**
   * Reserve quota for API calls
   * Note: This uses optimistic concurrency - there's a small race condition window,
   * but it's mitigated by the 2K safety buffer (13K limit vs 15K actual quota).
   * @param requestCount Number of API calls to reserve
   * @returns true if successfully reserved, false if quota exhausted
   */
  async reserveQuota(requestCount: number): Promise<boolean> {
    await this.ensureDailyReset();

    // Get current usage
    const currentUsage = await this.kv.get<number>(this.QUOTA_KEY, 'json') || 0;
    const newUsage = currentUsage + requestCount;
    const effectiveLimit = this.DAILY_LIMIT - this.SAFETY_BUFFER;

    if (newUsage > effectiveLimit) {
      return false;
    }

    // Update counter (single atomic write)
    // Race condition is possible but mitigated by safety buffer
    await this.kv.put(this.QUOTA_KEY, JSON.stringify(newUsage));

    return true;
  }

  /**
   * Get total usage by reading the main counter (updated on each reservation)
   * Note: This uses eventual consistency - the main counter is updated after each
   * shard write, so it may lag slightly behind the true total under high concurrency.
   * This is acceptable since we have a safety buffer.
   */
  private async getTotalUsage(): Promise<number> {
    // Read main counter for fast reads (updated on each reserveQuota call)
    const currentUsage = await this.kv.get<number>(this.QUOTA_KEY, 'json') || 0;
    return currentUsage;
  }

  /**
   * Get current quota status without modifying it
   */
  async getQuotaStatus(): Promise<QuotaStatus> {
    await this.ensureDailyReset();

    // Use aggregated total from shards for most accurate count
    const usedToday = await this.getTotalUsage();
    const remaining = Math.max(0, this.DAILY_LIMIT - usedToday);
    const effectiveLimit = this.DAILY_LIMIT - this.SAFETY_BUFFER;
    const bufferRemaining = Math.max(0, effectiveLimit - usedToday);

    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    nextMidnight.setUTCHours(0, 0, 0, 0);
    const hoursToReset = (nextMidnight.getTime() - now.getTime()) / (1000 * 60 * 60);

    return {
      used_today: usedToday,
      remaining,
      limit: this.DAILY_LIMIT,
      last_reset: await this.getLastResetDate(),
      next_reset_in_hours: Math.round(hoursToReset * 100) / 100,
      buffer_remaining: bufferRemaining,
      can_make_calls: bufferRemaining > 0
    };
  }

  /**
   * Manually increment quota (for tracking external API calls)
   * Use this when you make ISBNdb calls outside the reservation system
   */
  async recordApiCall(callCount: number = 1): Promise<void> {
    await this.ensureDailyReset();

    const currentUsage = await this.kv.get<number>(this.QUOTA_KEY, 'json') || 0;
    const newUsage = currentUsage + callCount;
    await this.kv.put(this.QUOTA_KEY, JSON.stringify(newUsage));
  }

  /**
   * Reset quota counter (for testing or manual reset)
   */
  async resetQuota(): Promise<void> {
    await this.kv.put(this.QUOTA_KEY, JSON.stringify(0));
    await this.kv.put(this.RESET_KEY, this.getTodayDateString());
  }

  /**
   * Check if quota should be reset for new day and reset if needed
   */
  private async ensureDailyReset(): Promise<void> {
    const lastReset = await this.getLastResetDate();
    const today = this.getTodayDateString();

    if (lastReset !== today) {
      // New day - reset quota
      await this.kv.put(this.QUOTA_KEY, JSON.stringify(0));
      await this.kv.put(this.RESET_KEY, today);
    }
  }

  private async getLastResetDate(): Promise<string> {
    return await this.kv.get(this.RESET_KEY) || this.getTodayDateString();
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * Get estimated safe batch size based on remaining quota
   * Useful for dynamic batch sizing in harvesting operations
   */
  async getSafeBatchSize(maxBatchSize: number = 1000): Promise<number> {
    const status = await this.getQuotaStatus();

    if (!status.can_make_calls) {
      return 0;
    }

    // Conservative approach: use half of remaining quota for this batch
    const conservativeQuota = Math.floor(status.buffer_remaining / 2);

    // ISBNdb Premium can handle 1000 ISBNs per call
    // So batch size = min(maxBatchSize, remaining quota * 1000)
    return Math.min(maxBatchSize, conservativeQuota * 1000);
  }

  /**
   * Check if specific harvesting operation should proceed
   * Includes operational logic for different harvesting types
   */
  async shouldAllowOperation(operation: 'cron' | 'bulk_author' | 'batch_direct' | 'new_releases', estimatedCalls: number = 1): Promise<QuotaCheckResult> {
    const result = await this.checkQuota(estimatedCalls, false);

    if (!result.allowed) {
      return result;
    }

    // Additional operational rules
    switch (operation) {
      case 'cron':
        // Cron jobs should be more conservative (leave room for manual operations)
        if (result.status.buffer_remaining < estimatedCalls * 2) {
          return {
            allowed: false,
            status: result.status,
            reason: `Cron operation blocked: need ${estimatedCalls * 2} buffer calls, only ${result.status.buffer_remaining} remaining`
          };
        }
        break;

      case 'bulk_author':
        // Bulk operations can use more quota but should check if it's a reasonable batch
        if (estimatedCalls > 100) {
          return {
            allowed: false,
            status: result.status,
            reason: `Bulk operation too large: ${estimatedCalls} calls requested, max 100 recommended`
          };
        }
        break;
    }

    return result;
  }
}

/**
 * Factory function to create QuotaManager instance
 * Use this in your Worker handlers to get a properly configured instance
 */
export function createQuotaManager(kv: KVNamespace): QuotaManager {
  return new QuotaManager(kv);
}

/**
 * Utility function for quota-aware API calling
 * Wraps an ISBNdb API call with automatic quota management
 */
export async function withQuotaGuard<T>(
  quotaManager: QuotaManager,
  operation: string,
  estimatedCalls: number,
  apiCall: () => Promise<T>
): Promise<T> {
  // Check and reserve quota
  const quotaResult = await quotaManager.checkQuota(estimatedCalls, true);

  if (!quotaResult.allowed) {
    throw new Error(`Quota exhausted for ${operation}: ${quotaResult.reason}`);
  }

  try {
    // Execute the API call
    const result = await apiCall();

    console.log(`✅ ${operation} completed successfully. Quota used: ${estimatedCalls}. Remaining: ${quotaResult.status.buffer_remaining}`);

    return result;
  } catch (error) {
    // On failure, we could implement quota rollback here
    // For now, we keep the reservation to be conservative
    console.error(`❌ ${operation} failed:`, error);
    throw error;
  }
}