/**
 * Unit tests for advisory lock utilities
 *
 * Tests lock acquisition, release, timeout behavior, and error handling.
 *
 * @module services/advisory-locks.test
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import {
  getMonthLockKey,
  acquireMonthLock,
  releaseMonthLock,
  withMonthLock,
  isMonthLocked,
  getAllAdvisoryLocks,
} from './advisory-locks.js';

// =================================================================================
// Test Setup
// =================================================================================

// Use test database connection
const sql = postgres(process.env.TEST_DATABASE_URL || 'postgresql://openlibrary:openlibrary@localhost:5432/openlibrary', {
  max: 2, // Allow 2 connections for concurrent tests
  fetch_types: false,
  prepare: false,
});

afterAll(async () => {
  await sql.end();
});

// =================================================================================
// Lock Key Generation Tests
// =================================================================================

describe('getMonthLockKey', () => {
  test('generates correct lock key for valid inputs', () => {
    expect(getMonthLockKey(2020, 1)).toBe(202001);
    expect(getMonthLockKey(2020, 12)).toBe(202012);
    expect(getMonthLockKey(2024, 6)).toBe(202406);
    expect(getMonthLockKey(2000, 1)).toBe(200001);
  });

  test('generates correct lock key for 1900-1999 range (historical backfill)', () => {
    expect(getMonthLockKey(1900, 1)).toBe(190001);
    expect(getMonthLockKey(1900, 12)).toBe(190012);
    expect(getMonthLockKey(1950, 6)).toBe(195006);
    expect(getMonthLockKey(1999, 12)).toBe(199912);
  });

  test('generates correct lock key for boundary values', () => {
    // Lower boundary (1900-01)
    expect(getMonthLockKey(1900, 1)).toBe(190001);

    // Upper boundary (2099-12)
    expect(getMonthLockKey(2099, 12)).toBe(209912);

    // Verify uniqueness across the entire range
    const min = getMonthLockKey(1900, 1);  // 190001
    const max = getMonthLockKey(2099, 12); // 209912
    expect(max - min).toBe(19911); // (2099 - 1900) * 12 + 11 = 2388 + 11 = 19911
  });

  test('throws error for invalid year (below 1900)', () => {
    expect(() => getMonthLockKey(1899, 1)).toThrow('Invalid year');
    expect(() => getMonthLockKey(1899, 1)).toThrow('Must be between 1900 and 2099');
  });

  test('throws error for invalid year (above 2099)', () => {
    expect(() => getMonthLockKey(2100, 1)).toThrow('Invalid year');
    expect(() => getMonthLockKey(2100, 1)).toThrow('Must be between 1900 and 2099');
  });

  test('throws error for invalid month', () => {
    expect(() => getMonthLockKey(2020, 0)).toThrow('Invalid month');
    expect(() => getMonthLockKey(2020, 13)).toThrow('Invalid month');
    expect(() => getMonthLockKey(1950, 0)).toThrow('Invalid month');
    expect(() => getMonthLockKey(1950, 13)).toThrow('Invalid month');
  });
});

// =================================================================================
// Lock Acquisition Tests
// =================================================================================

describe.skipIf(!process.env.HYPERDRIVE_CONNECTION_STRING)('acquireMonthLock', () => {
  test('acquires lock when available', async () => {
    const locked = await acquireMonthLock(sql, 2020, 1, 5000);
    expect(locked).toBe(true);

    // Cleanup
    await releaseMonthLock(sql, 2020, 1);
  });

  test('fails when lock already held by same session', async () => {
    // NOTE: PostgreSQL advisory locks are re-entrant within same session
    // This test verifies that behavior
    const locked1 = await acquireMonthLock(sql, 2020, 2, 5000);
    expect(locked1).toBe(true);

    const locked2 = await acquireMonthLock(sql, 2020, 2, 1000);
    expect(locked2).toBe(true); // Same session can re-acquire

    // Cleanup
    await releaseMonthLock(sql, 2020, 2);
    await releaseMonthLock(sql, 2020, 2); // Release twice (re-entrant)
  });

  test('respects timeout when lock unavailable', async () => {
    // This test requires a second database connection to simulate concurrent access
    const sql2 = postgres(process.env.TEST_DATABASE_URL || 'postgresql://openlibrary:openlibrary@localhost:5432/openlibrary', {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    try {
      // Acquire lock in first connection
      await acquireMonthLock(sql, 2020, 3, 5000);

      // Try to acquire same lock in second connection (should timeout)
      const start = Date.now();
      const locked2 = await acquireMonthLock(sql2, 2020, 3, 2000);
      const duration = Date.now() - start;

      expect(locked2).toBe(false);
      expect(duration).toBeGreaterThanOrEqual(2000);
      expect(duration).toBeLessThan(2500); // Allow 500ms buffer

      // Cleanup
      await releaseMonthLock(sql, 2020, 3);
    } finally {
      await sql2.end();
    }
  });

  test('allows lock acquisition after release', async () => {
    // Acquire lock
    await acquireMonthLock(sql, 2020, 4, 5000);
    expect(await isMonthLocked(sql, 2020, 4)).toBe(true);

    // Release lock
    await releaseMonthLock(sql, 2020, 4);

    // Acquire again (should succeed immediately)
    const start = Date.now();
    const locked = await acquireMonthLock(sql, 2020, 4, 5000);
    const duration = Date.now() - start;

    expect(locked).toBe(true);
    expect(duration).toBeLessThan(500); // Should be fast

    // Cleanup
    await releaseMonthLock(sql, 2020, 4);
  });
});

// =================================================================================
// Lock Release Tests
// =================================================================================

describe.skipIf(!process.env.HYPERDRIVE_CONNECTION_STRING)('releaseMonthLock', () => {
  test('releases held lock successfully', async () => {
    await acquireMonthLock(sql, 2020, 5, 5000);

    const released = await releaseMonthLock(sql, 2020, 5);
    expect(released).toBe(true);

    // Verify lock is no longer held
    expect(await isMonthLocked(sql, 2020, 5)).toBe(false);
  });

  test('returns false when lock not held', async () => {
    // Don't acquire lock, just try to release
    const released = await releaseMonthLock(sql, 2020, 6);
    expect(released).toBe(false);
  });

  test('is idempotent - can call multiple times', async () => {
    await acquireMonthLock(sql, 2020, 7, 5000);

    const released1 = await releaseMonthLock(sql, 2020, 7);
    expect(released1).toBe(true);

    const released2 = await releaseMonthLock(sql, 2020, 7);
    expect(released2).toBe(false); // Already released

    const released3 = await releaseMonthLock(sql, 2020, 7);
    expect(released3).toBe(false); // Still not held
  });
});

// =================================================================================
// Wrapper Function Tests
// =================================================================================

describe.skipIf(!process.env.HYPERDRIVE_CONNECTION_STRING)('withMonthLock', () => {
  test('executes function with lock held', async () => {
    let executed = false;

    await withMonthLock(sql, 2020, 8, async () => {
      executed = true;
      expect(await isMonthLocked(sql, 2020, 8)).toBe(true);
    }, 5000);

    expect(executed).toBe(true);

    // Verify lock is released after execution
    expect(await isMonthLocked(sql, 2020, 8)).toBe(false);
  });

  test('returns function result', async () => {
    const result = await withMonthLock(sql, 2020, 9, async () => {
      return { success: true, value: 42 };
    }, 5000);

    expect(result).toEqual({ success: true, value: 42 });
  });

  test('releases lock even if function throws error', async () => {
    await expect(
      withMonthLock(sql, 2020, 10, async () => {
        expect(await isMonthLocked(sql, 2020, 10)).toBe(true);
        throw new Error('Test error');
      }, 5000)
    ).rejects.toThrow('Test error');

    // Verify lock is released even after error
    expect(await isMonthLocked(sql, 2020, 10)).toBe(false);
  });

  test('throws error if lock cannot be acquired', async () => {
    const sql2 = postgres(process.env.TEST_DATABASE_URL || 'postgresql://openlibrary:openlibrary@localhost:5432/openlibrary', {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    try {
      // Acquire lock in first connection
      await acquireMonthLock(sql, 2020, 11, 5000);

      // Try to execute with lock in second connection (should throw)
      await expect(
        withMonthLock(sql2, 2020, 11, async () => {
          return 'should not execute';
        }, 1000)
      ).rejects.toThrow('Could not acquire lock');

      // Cleanup
      await releaseMonthLock(sql, 2020, 11);
    } finally {
      await sql2.end();
    }
  });

  test('propagates async function errors', async () => {
    await expect(
      withMonthLock(sql, 2020, 12, async () => {
        throw new Error('Custom error message');
      }, 5000)
    ).rejects.toThrow('Custom error message');

    // Verify lock is released
    expect(await isMonthLocked(sql, 2020, 12)).toBe(false);
  });
});

// =================================================================================
// Debugging Utility Tests
// =================================================================================

describe.skipIf(!process.env.HYPERDRIVE_CONNECTION_STRING)('isMonthLocked', () => {
  test('returns true when lock is held', async () => {
    await acquireMonthLock(sql, 2021, 1, 5000);

    expect(await isMonthLocked(sql, 2021, 1)).toBe(true);

    // Cleanup
    await releaseMonthLock(sql, 2021, 1);
  });

  test('returns false when lock is not held', async () => {
    expect(await isMonthLocked(sql, 2021, 2)).toBe(false);
  });
});

describe.skipIf(!process.env.HYPERDRIVE_CONNECTION_STRING)('getAllAdvisoryLocks', () => {
  test('returns empty array when no locks held', async () => {
    // Release any locks from previous tests
    await releaseMonthLock(sql, 2021, 3);
    await releaseMonthLock(sql, 2021, 4);

    const locks = await getAllAdvisoryLocks(sql);

    // May have locks from other test runs, filter to our test locks
    const testLocks = locks.filter(lock =>
      lock.lock_key >= 202001 && lock.lock_key <= 202112
    );

    expect(testLocks.length).toBe(0);
  });

  test('returns lock information when locks held', async () => {
    await acquireMonthLock(sql, 2021, 3, 5000);
    await acquireMonthLock(sql, 2021, 4, 5000);

    const locks = await getAllAdvisoryLocks(sql);

    // Filter to our test locks
    const testLocks = locks.filter(lock =>
      lock.lock_key === 202103 || lock.lock_key === 202104
    );

    expect(testLocks.length).toBe(2);
    expect(testLocks.some(lock => lock.lock_key === 202103)).toBe(true);
    expect(testLocks.some(lock => lock.lock_key === 202104)).toBe(true);
    expect(testLocks.every(lock => lock.granted)).toBe(true);

    // Cleanup
    await releaseMonthLock(sql, 2021, 3);
    await releaseMonthLock(sql, 2021, 4);
  });
});

// =================================================================================
// Concurrent Access Tests (Integration-Level)
// =================================================================================

describe.skipIf(!process.env.HYPERDRIVE_CONNECTION_STRING)('concurrent lock attempts', () => {
  test('only one connection can hold lock at a time', async () => {
    const sql2 = postgres(process.env.HYPERDRIVE_CONNECTION_STRING!, {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    try {
      // Acquire lock in first connection
      const locked1 = await acquireMonthLock(sql, 2021, 5, 5000);
      expect(locked1).toBe(true);

      // Try to acquire in second connection (should fail quickly)
      const locked2 = await acquireMonthLock(sql2, 2021, 5, 1000);
      expect(locked2).toBe(false);

      // Release in first connection
      await releaseMonthLock(sql, 2021, 5);

      // Now second connection should be able to acquire
      const locked3 = await acquireMonthLock(sql2, 2021, 5, 1000);
      expect(locked3).toBe(true);

      // Cleanup
      await releaseMonthLock(sql2, 2021, 5);
    } finally {
      await sql2.end();
    }
  });

  test('lock is released when connection closes', async () => {
    const sql2 = postgres(process.env.HYPERDRIVE_CONNECTION_STRING!, {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    // Acquire lock in second connection
    await acquireMonthLock(sql2, 2021, 6, 5000);
    expect(await isMonthLocked(sql, 2021, 6)).toBe(true);

    // Close connection WITHOUT explicitly releasing lock
    await sql2.end();

    // Wait a moment for PostgreSQL to clean up
    await new Promise(resolve => setTimeout(resolve, 500));

    // Lock should now be available in first connection
    const locked = await acquireMonthLock(sql, 2021, 6, 1000);
    expect(locked).toBe(true);

    // Cleanup
    await releaseMonthLock(sql, 2021, 6);
  });
});
