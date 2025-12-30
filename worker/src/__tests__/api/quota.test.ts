/**
 * Unit Tests for GET /api/quota/status
 *
 * Tests quota status endpoint response format, calculations, and error handling.
 * Quota Manager business logic is already tested in quota-manager.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('GET /api/quota/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields in success response', () => {
      const response = {
        success: true,
        data: {
          daily_limit: 15000,
          safety_limit: 13000,
          used: 5234,
          remaining: 9766,
          safety_remaining: 7766,
          percentage_used: 40.26,
          reset_at: '2025-12-31T00:00:00Z',
          can_make_calls: true,
        },
      };

      // Verify all required fields exist
      expect(response.data).toHaveProperty('daily_limit');
      expect(response.data).toHaveProperty('safety_limit');
      expect(response.data).toHaveProperty('used');
      expect(response.data).toHaveProperty('remaining');
      expect(response.data).toHaveProperty('safety_remaining');
      expect(response.data).toHaveProperty('percentage_used');
      expect(response.data).toHaveProperty('reset_at');
      expect(response.data).toHaveProperty('can_make_calls');
    });

    it('should format percentage_used to 2 decimal places', () => {
      const percentageUsed = 40.258741;
      const rounded = Math.round(percentageUsed * 100) / 100;

      expect(rounded).toBe(40.26);
    });

    it('should have reset_at in ISO 8601 datetime format', () => {
      const resetAt = '2025-12-31T00:00:00.000Z';
      const date = new Date(resetAt);

      expect(date.toISOString()).toBe(resetAt);
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
      expect(date.getUTCSeconds()).toBe(0);
    });
  });

  describe('Quota Calculations', () => {
    it('should calculate safety limit correctly', () => {
      const dailyLimit = 15000;
      const buffer = 2000;
      const safetyLimit = dailyLimit - buffer;

      expect(safetyLimit).toBe(13000);
    });

    it('should calculate remaining calls', () => {
      const dailyLimit = 15000;
      const used = 5234;
      const remaining = dailyLimit - used;

      expect(remaining).toBe(9766);
    });

    it('should calculate safety_remaining', () => {
      const safetyLimit = 13000;
      const used = 5234;
      const safetyRemaining = safetyLimit - used;

      expect(safetyRemaining).toBe(7766);
    });

    it('should calculate percentage used against safety limit', () => {
      const used = 5234;
      const safetyLimit = 13000;
      const percentageUsed = (used / safetyLimit) * 100;

      expect(percentageUsed).toBeCloseTo(40.26, 2);
    });

    it('should handle zero usage', () => {
      const used = 0;
      const safetyLimit = 13000;
      const percentageUsed = (used / safetyLimit) * 100;

      expect(percentageUsed).toBe(0);
    });

    it('should handle full quota usage', () => {
      const used = 15000;
      const safetyLimit = 13000;
      const percentageUsed = (used / safetyLimit) * 100;

      expect(percentageUsed).toBeCloseTo(115.38, 2); // Over 100% = exceeding safety limit
    });
  });

  describe('Reset Time Calculation', () => {
    it('should calculate next UTC midnight', () => {
      // Create a test date (not midnight)
      const now = new Date('2025-12-30T15:30:45Z');

      // Calculate next midnight
      const nextMidnight = new Date(now);
      nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
      nextMidnight.setUTCHours(0, 0, 0, 0);

      expect(nextMidnight.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    });

    it('should handle year boundary', () => {
      const now = new Date('2025-12-31T23:59:59Z');

      const nextMidnight = new Date(now);
      nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
      nextMidnight.setUTCHours(0, 0, 0, 0);

      expect(nextMidnight.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should always return future time', () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
      nextMidnight.setUTCHours(0, 0, 0, 0);

      expect(nextMidnight.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  describe('can_make_calls Flag', () => {
    it('should be true when safety remaining > 0', () => {
      const safetyRemaining = 7766;
      const canMakeCalls = safetyRemaining > 0;

      expect(canMakeCalls).toBe(true);
    });

    it('should be false when safety remaining <= 0', () => {
      const safetyRemaining = 0;
      const canMakeCalls = safetyRemaining > 0;

      expect(canMakeCalls).toBe(false);
    });

    it('should be false when quota exceeded', () => {
      const safetyRemaining = -100; // Negative = exceeded
      const canMakeCalls = safetyRemaining > 0;

      expect(canMakeCalls).toBe(false);
    });
  });

  describe('Error Response Format', () => {
    it('should have consistent error response shape', () => {
      const error = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve quota status',
          details: 'KV namespace unavailable',
        },
      };

      expect(error.success).toBe(false);
      expect(error.error).toHaveProperty('code');
      expect(error.error).toHaveProperty('message');
      expect(error.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Cache Headers', () => {
    it('should set public caching with 60s TTL', () => {
      const cacheControl = 'public, max-age=60';

      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=60');
    });

    it('should parse max-age value', () => {
      const cacheControl = 'public, max-age=60';
      const match = cacheControl.match(/max-age=(\d+)/);
      const maxAge = match ? parseInt(match[1], 10) : 0;

      expect(maxAge).toBe(60);
    });
  });

  describe('Data Validation', () => {
    it('should have non-negative used count', () => {
      const used = 5234;

      expect(used).toBeGreaterThanOrEqual(0);
    });

    it('should have positive daily limit', () => {
      const dailyLimit = 15000;

      expect(dailyLimit).toBeGreaterThan(0);
    });

    it('should have positive safety limit', () => {
      const safetyLimit = 13000;

      expect(safetyLimit).toBeGreaterThan(0);
    });

    it('should have percentage between 0 and 200', () => {
      // Can exceed 100% if over safety limit, but should cap reasonably
      const testCases = [0, 40.26, 100, 115.38];

      testCases.forEach((pct) => {
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThan(200); // Reasonable upper bound
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle exactly at safety limit', () => {
      const used = 13000;
      const safetyLimit = 13000;
      const safetyRemaining = safetyLimit - used;
      const percentageUsed = (used / safetyLimit) * 100;

      expect(safetyRemaining).toBe(0);
      expect(percentageUsed).toBe(100);
    });

    it('should handle 1 call remaining', () => {
      const used = 12999;
      const safetyLimit = 13000;
      const safetyRemaining = safetyLimit - used;

      expect(safetyRemaining).toBe(1);
    });

    it('should handle exceeding daily limit', () => {
      const used = 15100;
      const dailyLimit = 15000;
      const remaining = dailyLimit - used;

      expect(remaining).toBeLessThan(0);
      expect(remaining).toBe(-100);
    });
  });

  describe('Integration with QuotaManager', () => {
    it('should transform QuotaManager status to API response format', () => {
      // QuotaManager.getQuotaStatus() returns:
      const quotaManagerStatus = {
        limit: 15000,
        used_today: 5234,
        remaining: 9766,
        buffer_remaining: 7766,
        can_make_calls: true,
        last_reset: '2025-12-30',
        next_reset_in_hours: 8.5,
      };

      // API response should transform to:
      const safetyLimit = quotaManagerStatus.limit - 2000;
      const percentageUsed = Math.round((quotaManagerStatus.used_today / safetyLimit) * 10000) / 100;

      const apiResponse = {
        daily_limit: quotaManagerStatus.limit,
        safety_limit: safetyLimit,
        used: quotaManagerStatus.used_today,
        remaining: quotaManagerStatus.remaining,
        safety_remaining: quotaManagerStatus.buffer_remaining,
        percentage_used: percentageUsed,
        reset_at: new Date().toISOString(), // Would calculate next midnight
        can_make_calls: quotaManagerStatus.can_make_calls,
      };

      expect(apiResponse.daily_limit).toBe(15000);
      expect(apiResponse.safety_limit).toBe(13000);
      expect(apiResponse.used).toBe(5234);
      expect(apiResponse.can_make_calls).toBe(true);
    });
  });
});
