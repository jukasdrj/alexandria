import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EditionVariantOrchestrator } from '../../orchestrators/edition-variant-orchestrator.js';
import { ServiceProviderRegistry } from '../../provider-registry.js';
import { ServiceCapability, type IEditionVariantProvider, type EditionVariant } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';

// --- Mock Providers ---

class MockFastProvider implements IEditionVariantProvider {
  constructor(
    public name: string,
    public data: EditionVariant[],
    public type: 'free' | 'paid' = 'free'
  ) {}

  readonly providerType = this.type;
  readonly capabilities = [ServiceCapability.EDITION_VARIANTS];

  async isAvailable() { return true; }

  async fetchEditionVariants() {
    return this.data;
  }
}

class MockSlowProvider implements IEditionVariantProvider {
  readonly name = 'slow-provider';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.EDITION_VARIANTS];

  constructor(private delayMs: number, private data: EditionVariant[]) {}

  async isAvailable() { return true; }

  async fetchEditionVariants() {
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    return this.data;
  }
}

class MockErrorProvider implements IEditionVariantProvider {
  readonly name = 'error-provider';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.EDITION_VARIANTS];

  async isAvailable() { return true; }

  async fetchEditionVariants() {
    throw new Error('API Boom');
  }
}

// --- Tests ---

describe('EditionVariantOrchestrator', () => {
  let registry: ServiceProviderRegistry;
  let mockContext: ServiceContext;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new ServiceProviderRegistry();
    mockContext = {
      env: {} as any,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Aggregation Logic', () => {
    it('should aggregate variants from multiple providers', async () => {
      const providerA = new MockFastProvider('provider-a', [
        { isbn: '978111', format: 'paperback', source: 'provider-a' }
      ]);
      const providerB = new MockFastProvider('provider-b', [
        { isbn: '978222', format: 'hardcover', source: 'provider-b' }
      ]);

      registry.registerAll([providerA, providerB]);
      const orchestrator = new EditionVariantOrchestrator(registry);

      const results = await orchestrator.fetchEditionVariants('978000', mockContext);

      expect(results).toHaveLength(2);
      expect(results.map(r => r.isbn).sort()).toEqual(['978111', '978222']);
    });

    it('should deduplicate by ISBN, keeping first matching provider', async () => {
      // Test that deduplication keeps the first provider's data
      const provider1 = new MockFastProvider('provider-1', [
        { isbn: '978111', format: 'hardcover', source: 'provider-1' }
      ]);

      const provider2 = new MockFastProvider('provider-2', [
        { isbn: '978111', format: 'paperback', source: 'provider-2' }
      ]);

      registry.registerAll([provider1, provider2]);

      const orchestrator = new EditionVariantOrchestrator(registry, {
        deduplicateByIsbn: true,
        providerPriority: ['provider-1', 'provider-2'] // Explicit ordering
      });

      const results = await orchestrator.fetchEditionVariants('978000', mockContext);

      expect(results).toHaveLength(1);
      expect(results[0].isbn).toBe('978111');
      expect(results[0].source).toBe('provider-1'); // First in priority order
    });

    it('should keep duplicates if deduplication is disabled', async () => {
      const providerA = new MockFastProvider('A', [{ isbn: '978111', source: 'A', format: 'other' }]);
      const providerB = new MockFastProvider('B', [{ isbn: '978111', source: 'B', format: 'other' }]);

      registry.registerAll([providerA, providerB]);

      const orchestrator = new EditionVariantOrchestrator(registry, {
        deduplicateByIsbn: false
      });

      const results = await orchestrator.fetchEditionVariants('978000', mockContext);

      expect(results).toHaveLength(2);
    });
  });

  describe('Priority and Ordering', () => {
    it('should respect custom provider priority configuration', async () => {
      const p1 = new MockFastProvider('p1', [{isbn:'1', source:'p1', format:'other'}]);
      const p2 = new MockFastProvider('p2', [{isbn:'1', source:'p2', format:'other'}]);

      registry.registerAll([p1, p2]);

      // Force p2 to run first (and thus win deduplication)
      const orchestrator = new EditionVariantOrchestrator(registry, {
        providerPriority: ['p2', 'p1'],
        deduplicateByIsbn: true
      });

      const results = await orchestrator.fetchEditionVariants('000', mockContext);
      expect(results[0].source).toBe('p2');
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout individual slow providers but keep others', async () => {
      const fastProvider = new MockFastProvider('fast', [
        { isbn: '978111', source: 'fast', format: 'other' }
      ]);
      // Provider takes 5000ms, timeout is 1000ms
      const slowProvider = new MockSlowProvider(5000, [
        { isbn: '978222', source: 'slow', format: 'other' }
      ]);

      registry.registerAll([fastProvider, slowProvider]);

      const orchestrator = new EditionVariantOrchestrator(registry, {
        providerTimeoutMs: 1000
      });

      const fetchPromise = orchestrator.fetchEditionVariants('000', mockContext);

      // Run all timers to completion
      await vi.runAllTimersAsync();

      const results = await fetchPromise;

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('fast');
    });

    it('should pass AbortController signal to providers', async () => {
      const spyProvider = {
        name: 'spy',
        providerType: 'free' as const,
        capabilities: [ServiceCapability.EDITION_VARIANTS],
        isAvailable: async () => true,
        fetchEditionVariants: vi.fn().mockImplementation(async (_, ctx) => {
          if (ctx.signal) return [];
          throw new Error('No signal passed');
        })
      };

      registry.register(spyProvider);
      const orchestrator = new EditionVariantOrchestrator(registry);

      await orchestrator.fetchEditionVariants('000', mockContext);

      expect(spyProvider.fetchEditionVariants).toHaveBeenCalled();
      const callArgs = spyProvider.fetchEditionVariants.mock.calls[0];
      const contextArg = callArgs[1];
      expect(contextArg.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('Error Resilience', () => {
    it('should continue if one provider throws an error', async () => {
      const errorProvider = new MockErrorProvider();
      const successProvider = new MockFastProvider('success', [
        { isbn: '978111', source: 'success', format: 'other' }
      ]);

      registry.registerAll([errorProvider, successProvider]);
      const orchestrator = new EditionVariantOrchestrator(registry);

      const results = await orchestrator.fetchEditionVariants('000', mockContext);

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('success');
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('provider failed'),
        expect.objectContaining({ provider: 'error-provider' })
      );
    });

    it('should return empty array if all providers fail', async () => {
      registry.register(new MockErrorProvider());
      const orchestrator = new EditionVariantOrchestrator(registry);

      const results = await orchestrator.fetchEditionVariants('000', mockContext);

      expect(results).toEqual([]);
    });
  });

  describe('Stop On First Success', () => {
    it('should return immediately after first successful provider', async () => {
      const p1 = new MockFastProvider('p1', [{isbn:'1', source:'p1', format:'other'}]);
      const p2 = new MockFastProvider('p2', [{isbn:'2', source:'p2', format:'other'}]);

      registry.registerAll([p1, p2]);

      const orchestrator = new EditionVariantOrchestrator(registry, {
        stopOnFirstSuccess: true,
        providerPriority: ['p1', 'p2']
      });

      const results = await orchestrator.fetchEditionVariants('000', mockContext);

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('p1');
    });
  });
});
