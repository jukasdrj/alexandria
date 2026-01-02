/**
 * Rate Limiter Tests
 *
 * Tests for application-level rate limiting middleware
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, RateLimitPresets } from '../../middleware/rate-limiter.js';
import type { Env } from '../env.js';

// Mock KV storage
class MockKV {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiration && Date.now() > item.expiration) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : undefined;
    this.store.set(key, { value, expiration });
  }

  clear() {
    this.store.clear();
  }
}

describe('Rate Limiter', () => {
  let mockKV: MockKV;
  let mockEnv: Partial<Env>;

  beforeEach(() => {
    mockKV = new MockKV();
    mockEnv = {
      CACHE: mockKV as any,
    };
  });

  describe('checkRateLimit', () => {
    it('should allow requests within limit', async () => {
      const result = await checkRateLimit(
        mockEnv as Env,
        '192.168.1.1',
        RateLimitPresets.standard
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // 100 - 1
      expect(result.limit).toBe(100);
    });

    it('should track multiple requests', async () => {
      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(
          mockEnv as Env,
          '192.168.1.1',
          RateLimitPresets.standard
        );
      }

      // 6th request
      const result = await checkRateLimit(
        mockEnv as Env,
        '192.168.1.1',
        RateLimitPresets.standard
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(94); // 100 - 6
    });

    it('should block requests exceeding limit', async () => {
      // Make 100 requests (hit limit)
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(
          mockEnv as Env,
          '192.168.1.1',
          RateLimitPresets.standard
        );
      }

      // 101st request should be blocked
      const result = await checkRateLimit(
        mockEnv as Env,
        '192.168.1.1',
        RateLimitPresets.standard
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should isolate different IPs', async () => {
      // IP 1 makes 100 requests
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(
          mockEnv as Env,
          '192.168.1.1',
          RateLimitPresets.standard
        );
      }

      // IP 2 should still be allowed
      const result = await checkRateLimit(
        mockEnv as Env,
        '192.168.1.2',
        RateLimitPresets.standard
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it('should isolate different key prefixes', async () => {
      // Standard limit - 100 req/min
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(
          mockEnv as Env,
          '192.168.1.1',
          RateLimitPresets.standard
        );
      }

      // Search limit (different prefix) - should still be allowed
      const result = await checkRateLimit(
        mockEnv as Env,
        '192.168.1.1',
        RateLimitPresets.search
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59); // 60 - 1
    });

    it('should use sliding window algorithm', async () => {
      const config = {
        maxRequests: 5,
        windowSeconds: 2, // 2 second window
        keyPrefix: 'test',
        failOpen: true,
      };

      // Make 5 requests (hit limit)
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(mockEnv as Env, '192.168.1.1', config);
      }

      // 6th request should be blocked
      let result = await checkRateLimit(mockEnv as Env, '192.168.1.1', config);
      expect(result.allowed).toBe(false);

      // Wait 2 seconds for window to slide
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // Should be allowed again
      result = await checkRateLimit(mockEnv as Env, '192.168.1.1', config);
      expect(result.allowed).toBe(true);
    });

    it('should fail open on KV error', async () => {
      const brokenKV = {
        get: async () => {
          throw new Error('KV unavailable');
        },
        put: async () => {
          throw new Error('KV unavailable');
        },
      };

      const result = await checkRateLimit(
        { CACHE: brokenKV } as any,
        '192.168.1.1',
        { ...RateLimitPresets.standard, failOpen: true }
      );

      expect(result.allowed).toBe(true);
    });

    it('should fail closed on KV error when configured', async () => {
      const brokenKV = {
        get: async () => {
          throw new Error('KV unavailable');
        },
        put: async () => {
          throw new Error('KV unavailable');
        },
      };

      const result = await checkRateLimit(
        { CACHE: brokenKV } as any,
        '192.168.1.1',
        { ...RateLimitPresets.heavy, failOpen: false }
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('Rate Limit Presets', () => {
    it('should have correct standard preset', () => {
      expect(RateLimitPresets.standard.maxRequests).toBe(100);
      expect(RateLimitPresets.standard.windowSeconds).toBe(60);
      expect(RateLimitPresets.standard.failOpen).toBe(true);
    });

    it('should have correct search preset (stricter)', () => {
      expect(RateLimitPresets.search.maxRequests).toBe(60);
      expect(RateLimitPresets.search.windowSeconds).toBe(60);
      expect(RateLimitPresets.search.failOpen).toBe(true);
    });

    it('should have correct write preset', () => {
      expect(RateLimitPresets.write.maxRequests).toBe(30);
      expect(RateLimitPresets.write.windowSeconds).toBe(60);
      expect(RateLimitPresets.write.failOpen).toBe(true);
    });

    it('should have correct heavy preset (fail closed)', () => {
      expect(RateLimitPresets.heavy.maxRequests).toBe(10);
      expect(RateLimitPresets.heavy.windowSeconds).toBe(60);
      expect(RateLimitPresets.heavy.failOpen).toBe(false);
    });
  });
});
