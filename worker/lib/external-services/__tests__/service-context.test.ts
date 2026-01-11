import { describe, it, expect } from 'vitest';
import { createServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import type { Logger } from '../../logger.js';

describe('ServiceContext', () => {
  const mockEnv = {} as Env;
  const mockLogger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  } as Logger;

  describe('createServiceContext', () => {
    it('should create context with required fields only', () => {
      const context = createServiceContext(mockEnv, mockLogger);

      expect(context.env).toBe(mockEnv);
      expect(context.logger).toBe(mockLogger);
      expect(context.cacheStrategy).toBe('read-write');
      expect(context.rateLimitStrategy).toBe('enforce');
      expect(context.quotaManager).toBeUndefined();
      expect(context.timeoutMs).toBeUndefined();
      expect(context.metadata).toBeUndefined();
    });

    it('should create context with custom cache strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        cacheStrategy: 'disabled',
      });

      expect(context.cacheStrategy).toBe('disabled');
    });

    it('should create context with custom rate limit strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        rateLimitStrategy: 'log-only',
      });

      expect(context.rateLimitStrategy).toBe('log-only');
    });

    it('should create context with custom timeout', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        timeoutMs: 5000,
      });

      expect(context.timeoutMs).toBe(5000);
    });

    it('should create context with quota manager', () => {
      const mockQuotaManager = { checkQuota: () => {} } as any;

      const context = createServiceContext(mockEnv, mockLogger, {
        quotaManager: mockQuotaManager,
      });

      expect(context.quotaManager).toBe(mockQuotaManager);
    });

    it('should create context with metadata', () => {
      const metadata = { requestId: '123', userId: 'test-user' };

      const context = createServiceContext(mockEnv, mockLogger, {
        metadata,
      });

      expect(context.metadata).toEqual(metadata);
    });

    it('should create context with all options', () => {
      const mockQuotaManager = { checkQuota: () => {} } as any;
      const metadata = { requestId: '456' };

      const context = createServiceContext(mockEnv, mockLogger, {
        quotaManager: mockQuotaManager,
        cacheStrategy: 'read-only',
        rateLimitStrategy: 'disabled',
        timeoutMs: 15000,
        metadata,
      });

      expect(context.env).toBe(mockEnv);
      expect(context.logger).toBe(mockLogger);
      expect(context.quotaManager).toBe(mockQuotaManager);
      expect(context.cacheStrategy).toBe('read-only');
      expect(context.rateLimitStrategy).toBe('disabled');
      expect(context.timeoutMs).toBe(15000);
      expect(context.metadata).toEqual(metadata);
    });
  });

  describe('cache strategy values', () => {
    it('should accept read-write strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        cacheStrategy: 'read-write',
      });
      expect(context.cacheStrategy).toBe('read-write');
    });

    it('should accept read-only strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        cacheStrategy: 'read-only',
      });
      expect(context.cacheStrategy).toBe('read-only');
    });

    it('should accept write-only strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        cacheStrategy: 'write-only',
      });
      expect(context.cacheStrategy).toBe('write-only');
    });

    it('should accept disabled strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        cacheStrategy: 'disabled',
      });
      expect(context.cacheStrategy).toBe('disabled');
    });
  });

  describe('rate limit strategy values', () => {
    it('should accept enforce strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        rateLimitStrategy: 'enforce',
      });
      expect(context.rateLimitStrategy).toBe('enforce');
    });

    it('should accept log-only strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        rateLimitStrategy: 'log-only',
      });
      expect(context.rateLimitStrategy).toBe('log-only');
    });

    it('should accept disabled strategy', () => {
      const context = createServiceContext(mockEnv, mockLogger, {
        rateLimitStrategy: 'disabled',
      });
      expect(context.rateLimitStrategy).toBe('disabled');
    });
  });
});
