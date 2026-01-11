import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ISBNResolutionOrchestrator } from '../isbn-resolution-orchestrator.js';
import { ServiceProviderRegistry } from '../../provider-registry.js';
import {
  ServiceCapability,
  type IISBNResolver,
  type ISBNResolutionResult,
} from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

// Mock ISBN resolvers
class MockPaidResolver implements IISBNResolver {
  readonly name = 'mock-paid';
  readonly providerType = 'paid' as const;
  readonly capabilities = [ServiceCapability.ISBN_RESOLUTION];

  constructor(
    private shouldSucceed: boolean = true,
    private availabilityStatus: boolean = true
  ) {}

  async isAvailable(_env: Env): Promise<boolean> {
    return this.availabilityStatus;
  }

  async resolveISBN(
    _title: string,
    _author: string,
    _context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    if (this.shouldSucceed) {
      return { isbn: '9780385544153', confidence: 95, source: 'mock-paid' };
    }
    return { isbn: null, confidence: 0, source: 'mock-paid' };
  }
}

class MockFreeResolver implements IISBNResolver {
  readonly name = 'mock-free';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.ISBN_RESOLUTION];

  constructor(private shouldSucceed: boolean = true) {}

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async resolveISBN(
    _title: string,
    _author: string,
    _context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    if (this.shouldSucceed) {
      return { isbn: '9780385544153', confidence: 85, source: 'mock-free' };
    }
    return { isbn: null, confidence: 0, source: 'mock-free' };
  }
}

class MockSlowResolver implements IISBNResolver {
  readonly name = 'mock-slow';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.ISBN_RESOLUTION];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async resolveISBN(
    _title: string,
    _author: string,
    _context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    // Simulate slow resolver (20s delay - will timeout)
    await new Promise((resolve) => setTimeout(resolve, 20000));
    return { isbn: '9780385544153', confidence: 90, source: 'mock-slow' };
  }
}

describe('ISBNResolutionOrchestrator', () => {
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

  describe('resolveISBN', () => {
    it('should return null when no resolvers available', async () => {
      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(result.isbn).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.source).toBe('none');
    });

    it('should try paid provider first when available', async () => {
      registry.register(new MockPaidResolver(true));
      registry.register(new MockFreeResolver(true));

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(result.isbn).toBe('9780385544153');
      expect(result.source).toBe('mock-paid');
      expect(result.confidence).toBe(95);
    });

    it('should fallback to free provider when paid fails', async () => {
      registry.register(new MockPaidResolver(false)); // Fails
      registry.register(new MockFreeResolver(true)); // Succeeds

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(result.isbn).toBe('9780385544153');
      expect(result.source).toBe('mock-free');
      expect(result.confidence).toBe(85);
    });

    it('should skip unavailable providers', async () => {
      registry.register(new MockPaidResolver(true, false)); // Unavailable
      registry.register(new MockFreeResolver(true)); // Available

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(result.isbn).toBe('9780385544153');
      expect(result.source).toBe('mock-free');
    });

    it('should return all-failed when all resolvers fail', async () => {
      registry.register(new MockPaidResolver(false));
      registry.register(new MockFreeResolver(false));

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(result.isbn).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.source).toBe('all-failed');
    });

    it('should timeout slow providers', async () => {
      registry.register(new MockSlowResolver());
      registry.register(new MockFreeResolver(true));

      const orchestrator = new ISBNResolutionOrchestrator(registry, {
        providerTimeoutMs: 1000, // 1 second timeout
      });

      const startTime = Date.now();
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );
      const duration = Date.now() - startTime;

      // Should timeout and fallback to second provider
      expect(duration).toBeLessThan(5000);
      expect(result.isbn).toBe('9780385544153');
      expect(result.source).toBe('mock-free');
    });

    it('should respect custom provider order', async () => {
      registry.register(new MockPaidResolver(true));
      registry.register(new MockFreeResolver(true));

      // Force free provider first
      const orchestrator = new ISBNResolutionOrchestrator(registry, {
        providerOrder: ['mock-free', 'mock-paid'],
      });

      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(result.source).toBe('mock-free');
    });

    it('should log resolution attempts when logging enabled', async () => {
      registry.register(new MockFreeResolver(true));

      const orchestrator = new ISBNResolutionOrchestrator(registry, {
        enableLogging: true,
      });

      await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Starting ISBN resolution',
        expect.objectContaining({
          title: 'The Splendid and the Vile',
          author: 'Erik Larson',
        })
      );
    });

    it('should not log when logging disabled', async () => {
      registry.register(new MockFreeResolver(true));

      const orchestrator = new ISBNResolutionOrchestrator(registry, {
        enableLogging: false,
      });

      await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      expect(mockContext.logger.info).not.toHaveBeenCalled();
    });
  });
});
