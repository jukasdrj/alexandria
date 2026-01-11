/**
 * Integration tests for Quota System
 *
 * Tests quota endpoints and quota enforcement across API endpoints.
 * Note: These are simplified integration tests that focus on quota logic
 * without requiring the full app stack (which has WASM dependencies).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuotaManager } from '../services/quota-manager.js';

// Mock KV namespace for integration tests
class MockKVNamespace {
  private store: Map<string, string> = new Map();
  private shouldFail = false;

  async get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  async get(key: string): Promise<string | null>;
  async get<T = unknown>(key: string, type?: 'json'): Promise<T | string | null> {
    if (this.shouldFail) {
      throw new Error('KV failure (simulated)');
    }
    const value = this.store.get(key);
    if (value === undefined) return null;
    if (type === 'json') {
      return JSON.parse(value) as T;
    }
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error('KV failure (simulated)');
    }
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }
}

describe('Quota Integration Tests', () => {
  let mockKV: MockKVNamespace;
  let quotaManager: QuotaManager;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    const mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    };
    quotaManager = new QuotaManager(
      mockKV as unknown as KVNamespace,
      mockLogger as any
    );
  });

  describe('Multi-operation quota coordination', () => {
    it('should coordinate quota across multiple operations', async () => {
      // Simulate concurrent operations from different sources
      const op1 = quotaManager.checkQuota(100, true); // batch-direct
      const op2 = quotaManager.checkQuota(200, true); // author bibliography
      const op3 = quotaManager.checkQuota(150, true); // new releases

      const [result1, result2, result3] = await Promise.all([op1, op2, op3]);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);

      // Total should be tracked (though may not be exact due to mock races)
      const status = await quotaManager.getQuotaStatus();
      expect(status.used_today).toBeGreaterThan(0);
    });

    it('should deny operations when quota approaches limit', async () => {
      // Use most of quota
      await quotaManager.reserveQuota(12900);

      // These operations should be denied
      const result1 = await quotaManager.checkQuota(200, true);
      const result2 = await quotaManager.checkQuota(100, true);

      // At least one should be denied
      const deniedCount = [result1, result2].filter(r => !r.allowed).length;
      expect(deniedCount).toBeGreaterThan(0);
    });
  });

  describe('Operation-specific quota rules', () => {
    it('should enforce cron job quota limits (2x buffer)', async () => {
      // Leave 300 buffer
      await quotaManager.reserveQuota(12700);

      // Cron needs 2x buffer, so 150 calls need 300 buffer
      const result = await quotaManager.shouldAllowOperation('cron', 150);

      expect(result.allowed).toBe(true);

      // But 200 calls need 400 buffer, should be denied
      const result2 = await quotaManager.shouldAllowOperation('cron', 200);
      expect(result2.allowed).toBe(false);
    });

    it('should enforce bulk author limits (max 100 calls)', async () => {
      const result1 = await quotaManager.shouldAllowOperation('bulk_author', 100);
      expect(result1.allowed).toBe(true);

      const result2 = await quotaManager.shouldAllowOperation('bulk_author', 101);
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('too large');
    });

    it('should allow batch_direct and new_releases without extra rules', async () => {
      const result1 = await quotaManager.shouldAllowOperation('batch_direct', 1000);
      const result2 = await quotaManager.shouldAllowOperation('new_releases', 1000);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });
  });

  describe('Daily quota reset', () => {
    it('should automatically reset quota on day boundary', async () => {
      // Set yesterday's date and usage
      await mockKV.put('isbndb_daily_calls', JSON.stringify(5000));

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      await mockKV.put('isbndb_quota_last_reset', yesterdayStr);

      // Trigger reset by checking status
      const status = await quotaManager.getQuotaStatus();

      // Should be reset
      expect(status.used_today).toBe(0);
      expect(status.buffer_remaining).toBe(13000);
      expect(status.last_reset).not.toBe(yesterdayStr);
    });

    it('should not reset within same day', async () => {
      await quotaManager.reserveQuota(1000);

      const status1 = await quotaManager.getQuotaStatus();
      expect(status1.used_today).toBe(1000);

      // Check again
      const status2 = await quotaManager.getQuotaStatus();
      expect(status2.used_today).toBe(1000); // Should not reset
    });
  });

  describe('Quota tracking and monitoring', () => {
    it('should track quota usage over multiple operations', async () => {
      const operations = [
        { type: 'batch_direct', calls: 100 },
        { type: 'author_bibliography', calls: 50 },
        { type: 'new_releases', calls: 200 },
        { type: 'batch_direct', calls: 150 },
      ];

      for (const op of operations) {
        await quotaManager.recordApiCall(op.calls);
      }

      const status = await quotaManager.getQuotaStatus();
      expect(status.used_today).toBe(500);
      expect(status.buffer_remaining).toBe(12500);
    });

    it('should provide accurate safe batch sizes', async () => {
      // Full quota: 6.5M batch size
      const batch1 = await quotaManager.getSafeBatchSize(10_000_000);
      expect(batch1).toBe(6_500_000);

      // After using half quota
      await quotaManager.reserveQuota(6500);
      const batch2 = await quotaManager.getSafeBatchSize(10_000_000);
      expect(batch2).toBe(3_250_000); // Half of previous

      // After exhausting quota
      await quotaManager.reserveQuota(6500);
      const batch3 = await quotaManager.getSafeBatchSize(10_000_000);
      expect(batch3).toBe(0);
    });
  });

  describe('Error recovery', () => {
    it('should handle KV errors gracefully', async () => {
      mockKV.setShouldFail(true);

      // Operations should not throw, but should fail gracefully
      const reserveResult = await quotaManager.reserveQuota(100);
      expect(reserveResult).toBe(false);

      const status = await quotaManager.getQuotaStatus();
      expect(status).toBeDefined();

      // recordApiCall should not throw
      await expect(quotaManager.recordApiCall(100)).resolves.not.toThrow();
    });

    it('should recover after KV comes back online', async () => {
      // Start with failure
      mockKV.setShouldFail(true);
      const failResult = await quotaManager.reserveQuota(100);
      expect(failResult).toBe(false);

      // Recovery
      mockKV.setShouldFail(false);
      const successResult = await quotaManager.reserveQuota(100);
      expect(successResult).toBe(true);

      const status = await quotaManager.getQuotaStatus();
      expect(status.used_today).toBe(100);
    });
  });

  describe('Quota exhaustion scenarios', () => {
    it('should handle gradual quota exhaustion', async () => {
      const operations = [];

      // Use quota in chunks until exhausted
      for (let i = 0; i < 14; i++) {
        const result = await quotaManager.checkQuota(1000, true);
        operations.push(result);
      }

      // First 13 should succeed, 14th should fail
      const successCount = operations.filter(r => r.allowed).length;
      const failCount = operations.filter(r => !r.allowed).length;

      expect(successCount).toBe(13);
      expect(failCount).toBe(1);
    });

    it('should provide clear error messages on exhaustion', async () => {
      await quotaManager.reserveQuota(13000);

      const result = await quotaManager.checkQuota(100, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('exceed');
    });
  });
});
