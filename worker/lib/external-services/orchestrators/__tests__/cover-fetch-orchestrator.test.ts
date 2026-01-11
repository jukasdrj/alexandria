import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoverFetchOrchestrator } from '../cover-fetch-orchestrator.js';
import { ServiceProviderRegistry } from '../../provider-registry.js';
import {
  ServiceCapability,
  type ICoverProvider,
  type CoverResult,
} from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

// Mock cover providers
class MockFreeCoverProvider implements ICoverProvider {
  readonly name = 'mock-free-cover';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.COVER_IMAGES];

  constructor(private shouldSucceed: boolean = true) {}

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async fetchCover(
    _isbn: string,
    _context: ServiceContext
  ): Promise<CoverResult | null> {
    if (this.shouldSucceed) {
      return {
        url: 'https://example.com/free-cover.jpg',
        source: 'mock-free-cover',
        size: 'large',
      };
    }
    return null;
  }
}

class MockPaidCoverProvider implements ICoverProvider {
  readonly name = 'mock-paid-cover';
  readonly providerType = 'paid' as const;
  readonly capabilities = [ServiceCapability.COVER_IMAGES];

  constructor(
    private shouldSucceed: boolean = true,
    private availabilityStatus: boolean = true
  ) {}

  async isAvailable(_env: Env): Promise<boolean> {
    return this.availabilityStatus;
  }

  async fetchCover(
    _isbn: string,
    _context: ServiceContext
  ): Promise<CoverResult | null> {
    if (this.shouldSucceed) {
      return {
        url: 'https://example.com/paid-cover.jpg',
        source: 'mock-paid-cover',
        size: 'large',
      };
    }
    return null;
  }
}

class MockSlowCoverProvider implements ICoverProvider {
  readonly name = 'mock-slow-cover';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.COVER_IMAGES];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async fetchCover(
    _isbn: string,
    _context: ServiceContext
  ): Promise<CoverResult | null> {
    // Simulate slow provider (15s delay - will timeout)
    await new Promise((resolve) => setTimeout(resolve, 15000));
    return {
      url: 'https://example.com/slow-cover.jpg',
      source: 'mock-slow-cover',
      size: 'large',
    };
  }
}

describe('CoverFetchOrchestrator', () => {
  let registry: ServiceProviderRegistry;
  let mockContext: ServiceContext;

  beforeEach(() => {
    registry = new ServiceProviderRegistry();
    mockContext = {
      env: {} as Env,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };
  });

  describe('fetchCover', () => {
    it('should return null when no providers available', async () => {
      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      expect(result).toBeNull();
    });

    it('should prioritize free providers to save quota', async () => {
      registry.register(new MockPaidCoverProvider(true));
      registry.register(new MockFreeCoverProvider(true));

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      expect(result).not.toBeNull();
      expect(result?.source).toBe('mock-free-cover');
      expect(result?.url).toBe('https://example.com/free-cover.jpg');
    });

    it('should fallback to paid when free providers fail', async () => {
      registry.register(new MockFreeCoverProvider(false)); // Fails
      registry.register(new MockPaidCoverProvider(true)); // Succeeds

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      expect(result).not.toBeNull();
      expect(result?.source).toBe('mock-paid-cover');
    });

    it('should skip unavailable providers', async () => {
      registry.register(new MockPaidCoverProvider(true, false)); // Unavailable
      registry.register(new MockFreeCoverProvider(true)); // Available

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      expect(result?.source).toBe('mock-free-cover');
    });

    it('should return null when all providers fail', async () => {
      registry.register(new MockFreeCoverProvider(false));
      registry.register(new MockPaidCoverProvider(false));

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      expect(result).toBeNull();
    });

    it('should timeout slow providers', async () => {
      registry.register(new MockSlowCoverProvider());
      registry.register(new MockFreeCoverProvider(true));

      const orchestrator = new CoverFetchOrchestrator(registry, {
        providerTimeoutMs: 1000, // 1 second timeout
      });

      const startTime = Date.now();
      const result = await orchestrator.fetchCover('9780385544153', mockContext);
      const duration = Date.now() - startTime;

      // Should timeout and fallback to second provider
      expect(duration).toBeLessThan(5000);
      expect(result?.source).toBe('mock-free-cover');
    });

    it('should respect custom provider order', async () => {
      registry.register(new MockFreeCoverProvider(true));
      registry.register(new MockPaidCoverProvider(true));

      // Force paid provider first
      const orchestrator = new CoverFetchOrchestrator(registry, {
        providerOrder: ['mock-paid-cover', 'mock-free-cover'],
      });

      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      expect(result?.source).toBe('mock-paid-cover');
    });

    it('should use preferred size', async () => {
      registry.register(new MockFreeCoverProvider(true));

      const orchestrator = new CoverFetchOrchestrator(registry, {
        preferredSize: 'medium',
      });

      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      expect(result?.size).toBe('large'); // Provider returned 'large'
    });

    it('should log fetch attempts when logging enabled', async () => {
      registry.register(new MockFreeCoverProvider(true));

      const orchestrator = new CoverFetchOrchestrator(registry, {
        enableLogging: true,
      });

      await orchestrator.fetchCover('9780385544153', mockContext);

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Starting cover fetch',
        expect.objectContaining({
          isbn: '9780385544153',
        })
      );
    });

    it('should not log when logging disabled', async () => {
      registry.register(new MockFreeCoverProvider(true));

      const orchestrator = new CoverFetchOrchestrator(registry, {
        enableLogging: false,
      });

      await orchestrator.fetchCover('9780385544153', mockContext);

      expect(mockContext.logger.info).not.toHaveBeenCalled();
    });
  });
});
