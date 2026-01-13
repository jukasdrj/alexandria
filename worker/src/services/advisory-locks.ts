/**
 * Advisory Lock Utilities for Backfill Scheduler
 *
 * Provides PostgreSQL advisory locks to prevent race conditions when multiple
 * Worker instances attempt to process the same month simultaneously.
 *
 * KEY FEATURES:
 * - Non-blocking lock acquisition (pg_try_advisory_lock)
 * - Configurable timeout with retry loop
 * - Automatic cleanup via try-finally patterns
 * - Observable via structured logging
 * - Session-scoped locks (auto-released on connection close)
 *
 * LOCK KEY STRATEGY:
 * month_id = (year * 100) + month
 * Examples: January 2020 → 202001, December 2024 → 202412
 *
 * USAGE:
 *
 * // Auto-cleanup wrapper (recommended for most cases)
 * await withMonthLock(sql, year, month, async () => {
 *   await sql`UPDATE backfill_log SET status = 'processing' ...`;
 *   await env.BACKFILL_QUEUE.send(...);
 * }, 10000);
 *
 * // Manual control (for complex flows)
 * const locked = await acquireMonthLock(sql, year, month, 10000);
 * if (!locked) {
 *   logger.warn('Could not acquire lock', { year, month });
 *   return; // Skip this month
 * }
 * try {
 *   await sql`UPDATE ...`;
 * } finally {
 *   await releaseMonthLock(sql, year, month);
 * }
 *
 * @module services/advisory-locks
 */

import type { Sql } from 'postgres';
import type { Logger } from '../../lib/logger.js';

/**
 * Union type for SQL connection or transaction handle.
 * postgres.js transaction handles have identical API to sql connections,
 * allowing lock functions to work in both contexts.
 */
type SqlOrTransaction = Sql<any> | Sql<any>['TransactionSql'];

// =================================================================================
// Constants
// =================================================================================

const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds
const RETRY_INTERVAL_MS = 100; // Check every 100ms

// =================================================================================
// Lock Key Generation
// =================================================================================

/**
 * Generate unique lock key for a given month
 *
 * Formula: (year * 100) + month
 *
 * Examples:
 * - January 2020 → 202001
 * - December 2024 → 202412
 * - January 1900 → 190001
 * - December 2099 → 209912
 *
 * Valid range: 190001 to 209912 (24,000 unique months)
 *
 * @param year - Year (1900-2099)
 * @param month - Month (1-12)
 * @returns Integer lock key
 */
export function getMonthLockKey(year: number, month: number): number {
  if (year < 1900 || year > 2099) {
    throw new Error(`Invalid year: ${year}. Must be between 1900 and 2099.`);
  }
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Must be between 1 and 12.`);
  }

  return year * 100 + month;
}

// =================================================================================
// Core Lock Functions
// =================================================================================

/**
 * Attempt to acquire advisory lock for a month (non-blocking with timeout)
 *
 * Uses PostgreSQL's `pg_try_advisory_lock()` which returns immediately with
 * TRUE/FALSE. If lock is not available, retries until timeout.
 *
 * IMPORTANT: This function is NOT re-entrant safe. If the same Worker instance
 * calls this twice for the same month, the second call will succeed immediately
 * (PostgreSQL allows same session to acquire same lock multiple times).
 *
 * Lock is automatically released when database connection closes (session-scoped).
 *
 * TRANSACTION COMPATIBILITY: This function accepts both `sql` connections and
 * transaction handles (`tx` from `sql.begin()`). Advisory locks acquired inside
 * a transaction persist after COMMIT or ROLLBACK (session-scoped, not transaction-scoped).
 *
 * @param sqlOrTx - Postgres SQL connection or transaction handle
 * @param year - Year (1900-2099)
 * @param month - Month (1-12)
 * @param timeoutMs - Maximum time to wait for lock acquisition (default: 10s)
 * @param logger - Optional logger for observability
 * @returns TRUE if lock acquired, FALSE if timeout
 *
 * @example
 * // With transaction
 * await sql.begin(async (tx) => {
 *   const locked = await acquireMonthLock(tx, 2020, 1, 10000, logger);
 *   if (!locked) return;
 *   await tx`UPDATE backfill_log SET status='processing' ...`;
 * });
 *
 * // Without transaction
 * const locked = await acquireMonthLock(sql, 2020, 1, 10000, logger);
 * if (!locked) {
 *   logger.warn('Could not acquire lock', { year: 2020, month: 1 });
 *   return; // Skip processing
 * }
 * try {
 *   // Protected code
 * } finally {
 *   await releaseMonthLock(sql, 2020, 1, logger);
 * }
 */
export async function acquireMonthLock(
  sqlOrTx: SqlOrTransaction,
  year: number,
  month: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  logger?: Logger
): Promise<boolean> {
  const lockKey = getMonthLockKey(year, month);
  const startTime = Date.now();

  logger?.info('Attempting to acquire month lock', {
    year,
    month,
    month_id: lockKey,
    timeoutMs,
  });

  // Retry loop with timeout
  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to acquire lock (non-blocking)
      // Cast to bigint to ensure correct type handling
      // Works with both sql connection and transaction handle
      const result = await sqlOrTx<Array<{ pg_try_advisory_lock: boolean }>>`
        SELECT pg_try_advisory_lock(${lockKey}::bigint) AS pg_try_advisory_lock
      `;

      if (result[0]?.pg_try_advisory_lock) {
        const durationMs = Date.now() - startTime;
        logger?.info('Month lock acquired', {
          year,
          month,
          month_id: lockKey,
          durationMs,
        });
        return true;
      }

      // Lock not available, wait before retry
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger?.error('Error attempting to acquire lock', {
        year,
        month,
        month_id: lockKey,
        error: errorMsg,
      });
      throw new Error(
        `Failed to acquire lock for ${year}-${month.toString().padStart(2, '0')}: ${errorMsg}`
      );
    }
  }

  // Timeout reached
  const durationMs = Date.now() - startTime;
  logger?.warn('Could not acquire month lock - timeout', {
    year,
    month,
    month_id: lockKey,
    reason: 'timeout',
    timeoutMs,
    durationMs,
  });

  return false;
}

/**
 * Release advisory lock for a month
 *
 * Uses PostgreSQL's `pg_advisory_unlock()` which returns TRUE if lock was held
 * by current session and successfully released, FALSE otherwise.
 *
 * IMPORTANT: Locks are automatically released when connection closes, so explicit
 * release is optional but recommended for clarity and to free resources sooner.
 *
 * This function is idempotent - calling it multiple times is safe (will return
 * FALSE on subsequent calls since lock is already released).
 *
 * TRANSACTION COMPATIBILITY: This function accepts both `sql` connections and
 * transaction handles. Advisory locks are session-scoped, so locks acquired
 * inside a transaction must still be explicitly released (they don't auto-release
 * on COMMIT or ROLLBACK).
 *
 * @param sqlOrTx - Postgres SQL connection or transaction handle
 * @param year - Year (1900-2099)
 * @param month - Month (1-12)
 * @param logger - Optional logger for observability
 * @returns TRUE if lock was released, FALSE if not held
 *
 * @example
 * const released = await releaseMonthLock(sql, 2020, 1, logger);
 * if (!released) {
 *   logger.warn('Lock was not held', { year: 2020, month: 1 });
 * }
 */
export async function releaseMonthLock(
  sqlOrTx: SqlOrTransaction,
  year: number,
  month: number,
  logger?: Logger
): Promise<boolean> {
  const lockKey = getMonthLockKey(year, month);

  try {
    // Cast to bigint to ensure correct type handling
    // Works with both sql connection and transaction handle
    const result = await sqlOrTx<Array<{ pg_advisory_unlock: boolean }>>`
      SELECT pg_advisory_unlock(${lockKey}::bigint) AS pg_advisory_unlock
    `;

    const released = result[0]?.pg_advisory_unlock ?? false;

    if (released) {
      logger?.debug('Month lock released', {
        year,
        month,
        month_id: lockKey,
      });
    } else {
      logger?.warn('Month lock was not held by this session', {
        year,
        month,
        month_id: lockKey,
      });
    }

    return released;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger?.error('Error releasing lock', {
      year,
      month,
      month_id: lockKey,
      error: errorMsg,
    });

    // Don't throw - lock will be released when connection closes anyway
    // Throwing here could mask the original error in a finally block
    return false;
  }
}

// =================================================================================
// High-Level Wrapper
// =================================================================================

/**
 * Execute function with automatic lock acquisition and release
 *
 * Acquires lock, executes function, and releases lock in finally block.
 * Ensures lock is always released even if function throws error.
 *
 * This is the RECOMMENDED way to use advisory locks - prevents forgetting
 * to release lock.
 *
 * TRANSACTION COMPATIBILITY: This function accepts both `sql` connections and
 * transaction handles. The callback function receives no parameters, so use
 * the appropriate sql/tx handle from your scope.
 *
 * @param sqlOrTx - Postgres SQL connection or transaction handle
 * @param year - Year (1900-2099)
 * @param month - Month (1-12)
 * @param fn - Async function to execute while holding lock
 * @param timeoutMs - Maximum time to wait for lock acquisition (default: 10s)
 * @param logger - Optional logger for observability
 * @returns Result of function execution
 * @throws Error if lock cannot be acquired or function throws
 *
 * @example
 * // With transaction
 * await sql.begin(async (tx) => {
 *   await withMonthLock(tx, 2020, 1, async () => {
 *     await tx`UPDATE backfill_log SET status = 'processing' ...`;
 *     await env.BACKFILL_QUEUE.send(...);
 *   }, 10000, logger);
 * });
 *
 * // Without transaction
 * const result = await withMonthLock(sql, 2020, 1, async () => {
 *   await sql`UPDATE backfill_log SET status = 'processing' ...`;
 *   await env.BACKFILL_QUEUE.send(...);
 *   return { success: true };
 * }, 10000, logger);
 */
export async function withMonthLock<T>(
  sqlOrTx: SqlOrTransaction,
  year: number,
  month: number,
  fn: () => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  logger?: Logger
): Promise<T> {
  const lockKey = getMonthLockKey(year, month);
  const locked = await acquireMonthLock(sqlOrTx, year, month, timeoutMs, logger);

  if (!locked) {
    throw new Error(
      `Could not acquire lock for ${year}-${month.toString().padStart(2, '0')} ` +
      `(timeout after ${timeoutMs}ms). Another process may be processing this month.`
    );
  }

  try {
    logger?.debug('Executing function with lock held', {
      year,
      month,
      month_id: lockKey,
    });

    return await fn();
  } finally {
    // Always release lock, even if function throws
    await releaseMonthLock(sqlOrTx, year, month, logger);
  }
}

// =================================================================================
// Debugging Utilities
// =================================================================================

/**
 * Check if a month lock is currently held by ANY session
 *
 * Queries `pg_locks` view to check if lock is held.
 * Useful for debugging lock contention issues.
 *
 * @param sqlOrTx - Postgres SQL connection or transaction handle
 * @param year - Year (1900-2099)
 * @param month - Month (1-12)
 * @returns TRUE if lock is held by any session, FALSE otherwise
 *
 * @example
 * const isLocked = await isMonthLocked(sql, 2020, 1);
 * if (isLocked) {
 *   console.log('Month is locked by another process');
 * }
 */
export async function isMonthLocked(
  sqlOrTx: SqlOrTransaction,
  year: number,
  month: number
): Promise<boolean> {
  const lockKey = getMonthLockKey(year, month);

  const result = await sqlOrTx<Array<{ count: string }>>`
    SELECT COUNT(*) AS count
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND objid = ${lockKey}::bigint
      AND granted = true
  `;

  return parseInt(result[0]?.count ?? '0') > 0;
}

/**
 * Get all currently held advisory locks
 *
 * Queries `pg_locks` view to list all advisory locks.
 * Useful for debugging and monitoring.
 *
 * @param sqlOrTx - Postgres SQL connection or transaction handle
 * @returns Array of lock information
 *
 * @example
 * const locks = await getAllAdvisoryLocks(sql);
 * locks.forEach(lock => {
 *   console.log(`Lock ${lock.objid} held by PID ${lock.pid}`);
 * });
 */
export async function getAllAdvisoryLocks(
  sqlOrTx: SqlOrTransaction
): Promise<Array<{
  lock_key: number;
  pid: number;
  mode: string;
  granted: boolean;
}>> {
  return await sqlOrTx<Array<{
    lock_key: number;
    pid: number;
    mode: string;
    granted: boolean;
  }>>`
    SELECT
      objid AS lock_key,
      pid,
      mode,
      granted
    FROM pg_locks
    WHERE locktype = 'advisory'
    ORDER BY objid
  `;
}
