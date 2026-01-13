import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookGenerationOrchestrator } from '../book-generation-orchestrator.js';
import { ServiceProviderRegistry } from '../../provider-registry.js';
import type { IBookGenerator, GeneratedBook } from '../../capabilities.js';
import { ServiceCapability } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

// Mock providers for testing
class MockGeminiProvider implements IBookGenerator {
  readonly name = 'gemini';
  readonly providerType = 'ai' as const;
  readonly capabilities = [ServiceCapability.BOOK_GENERATION];

  isAvailableMock = vi.fn();
  generateBooksMock = vi.fn();

  async isAvailable(env: Env): Promise<boolean> {
    return this.isAvailableMock(env);
  }

  async generateBooks(
    prompt: string,
    count: number,
    context: ServiceContext
  ): Promise<GeneratedBook[]> {
    return this.generateBooksMock(prompt, count, context);
  }
}

class MockXaiProvider implements IBookGenerator {
  readonly name = 'xai';
  readonly providerType = 'ai' as const;
  readonly capabilities = [ServiceCapability.BOOK_GENERATION];

  isAvailableMock = vi.fn();
  generateBooksMock = vi.fn();

  async isAvailable(env: Env): Promise<boolean> {
    return this.isAvailableMock(env);
  }

  async generateBooks(
    prompt: string,
    count: number,
    context: ServiceContext
  ): Promise<GeneratedBook[]> {
    return this.generateBooksMock(prompt, count, context);
  }
}

describe('BookGenerationOrchestrator', () => {
  let registry: ServiceProviderRegistry;
  let geminiProvider: MockGeminiProvider;
  let xaiProvider: MockXaiProvider;
  let mockContext: ServiceContext;
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh providers
    geminiProvider = new MockGeminiProvider();
    xaiProvider = new MockXaiProvider();

    // Create fresh registry
    registry = new ServiceProviderRegistry();
    registry.registerAll([geminiProvider, xaiProvider]);

    // Mock environment
    mockEnv = {} as any as Env;

    // Mock context
    mockContext = {
      env: mockEnv,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };
  });

  describe('provider availability checks', () => {
    it('should filter out unavailable providers before concurrent generation', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Gemini available, x.ai unavailable (registry will filter x.ai out)
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(false);

      geminiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Book 1',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'gemini',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Registry filters out x.ai, only Gemini is passed to concurrent method
      expect(geminiProvider.generateBooksMock).toHaveBeenCalledTimes(1);
      expect(xaiProvider.generateBooksMock).not.toHaveBeenCalled();

      // Registry already filtered, concurrent method sees only available providers
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        '[BookGenOrchestrator] Available providers after filtering',
        {
          available: ['gemini'],
          filtered_out: 0, // No additional filtering in concurrent method
        }
      );

      expect(result).toHaveLength(1);
    });

    it('should return empty array when all providers unavailable', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Both providers unavailable (registry filters them all out)
      geminiProvider.isAvailableMock.mockResolvedValue(false);
      xaiProvider.isAvailableMock.mockResolvedValue(false);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Should not call any providers (registry filtered them all out)
      expect(geminiProvider.generateBooksMock).not.toHaveBeenCalled();
      expect(xaiProvider.generateBooksMock).not.toHaveBeenCalled();

      // Registry logs this error before concurrent method is even called
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        '[BookGenOrchestrator] No book generation providers available'
      );

      expect(result).toEqual([]);
    });

    it('should handle availability check errors gracefully', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Gemini throws error, x.ai available (registry handles error)
      geminiProvider.isAvailableMock.mockRejectedValue(
        new Error('KV timeout')
      );
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Book 1',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Registry handles the error and logs warning (not error)
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        'Provider availability check failed',
        {
          provider: 'gemini',
          capability: 'book-generation',
          error: 'KV timeout',
        }
      );

      // Should still call x.ai (registry filtered to only x.ai)
      expect(xaiProvider.generateBooksMock).toHaveBeenCalledTimes(1);
      expect(geminiProvider.generateBooksMock).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
    });

    it('should work with all providers available', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Both providers available
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      geminiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Gemini Book',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'gemini',
        },
      ]);

      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Xai Book',
          author: 'Author 2',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Both should be called
      expect(geminiProvider.generateBooksMock).toHaveBeenCalledTimes(1);
      expect(xaiProvider.generateBooksMock).toHaveBeenCalledTimes(1);

      // Should log all providers available
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        '[BookGenOrchestrator] Available providers after filtering',
        {
          available: ['gemini', 'xai'],
          filtered_out: 0,
        }
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('concurrent execution with availability checks', () => {
    it('should handle provider returning zero books after passing availability check', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Both providers available
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      // Gemini returns empty, x.ai returns books
      geminiProvider.generateBooksMock.mockResolvedValue([]);
      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Xai Book',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Should warn about Gemini returning empty
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        '[BookGenOrchestrator] Provider returned empty result (concurrent)',
        expect.objectContaining({
          provider: 'gemini',
        })
      );

      // Should still succeed with x.ai result
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('xai');
    });

    it('should handle all providers passing availability but returning zero books', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Both providers available
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      // Both return empty
      geminiProvider.generateBooksMock.mockResolvedValue([]);
      xaiProvider.generateBooksMock.mockResolvedValue([]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Should error about all providers failing
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        '[BookGenOrchestrator] All concurrent providers failed',
        expect.objectContaining({
          attempted_providers: ['gemini', 'xai'],
        })
      );

      expect(result).toEqual([]);
    });

    it('should handle provider timeout during generation', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        providerTimeoutMs: 100, // Very short timeout
        enableLogging: true,
      });

      // Both providers available
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      // Gemini hangs, x.ai returns quickly
      geminiProvider.generateBooksMock.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve([]), 5000)) // 5 second delay
      );
      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Xai Book',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Should warn about Gemini timeout
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        '[BookGenOrchestrator] Provider failed (concurrent)',
        expect.objectContaining({
          provider: 'gemini',
          error: 'Provider timeout',
        })
      );

      // Should still succeed with x.ai
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('xai');
    });
  });

  describe('deduplication with availability checks', () => {
    it('should deduplicate results from multiple available providers', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        deduplicationThreshold: 0.6,
        enableLogging: true,
      });

      // Both providers available
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      // Both return the same book (should be deduplicated)
      geminiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'The Midnight Library',
          author: 'Matt Haig',
          publishDate: '2020',
          confidence: 30,
          source: 'gemini',
        },
      ]);

      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'The Midnight Library', // Same title
          author: 'Matt Haig',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Should deduplicate to 1 book
      expect(result).toHaveLength(1);
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        '[BookGenOrchestrator] Concurrent generation complete',
        expect.objectContaining({
          total_generated: 2,
          after_deduplication: 1,
          duplicates_removed: 1,
        })
      );
    });
  });

  describe('provider priority with availability', () => {
    it('should respect provider priority even with availability checks', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: false, // Sequential mode
        providerPriority: ['gemini', 'xai'],
        stopOnFirstSuccess: true,
        enableLogging: true,
      });

      // Both available
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      geminiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Gemini Book',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'gemini',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Should only call Gemini (first in priority, stopOnFirstSuccess=true)
      expect(geminiProvider.generateBooksMock).toHaveBeenCalledTimes(1);
      expect(xaiProvider.generateBooksMock).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('gemini');
    });
  });

  describe('race condition scenarios', () => {
    it('should handle provider becoming unavailable between registry check and generation', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Simulate race condition: provider available during registry check,
      // unavailable during concurrent method check
      let callCount = 0;
      geminiProvider.isAvailableMock.mockImplementation(() => {
        callCount++;
        // First call (registry): available
        // Second call (concurrent method): unavailable
        return Promise.resolve(callCount === 1);
      });
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Book 1',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Gemini should be filtered out by concurrent method's availability check
      expect(geminiProvider.generateBooksMock).not.toHaveBeenCalled();
      expect(xaiProvider.generateBooksMock).toHaveBeenCalledTimes(1);

      // Should log that Gemini was filtered out
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        '[BookGenOrchestrator] Provider unavailable, skipping',
        {
          provider: 'gemini',
          reason: 'isAvailable() returned false',
        }
      );

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('xai');
    });
  });

  describe('error scenarios', () => {
    it('should handle non-Error exceptions in availability checks', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Gemini throws non-Error, x.ai available (registry handles exception)
      geminiProvider.isAvailableMock.mockRejectedValue('string error');
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Book 1',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Registry handles the exception and logs warning
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        'Provider availability check failed',
        {
          provider: 'gemini',
          capability: 'book-generation',
          error: 'string error',
        }
      );

      expect(result).toHaveLength(1);
    });

    it('should handle provider generation failure after passing availability', async () => {
      const orchestrator = new BookGenerationOrchestrator(registry, {
        concurrentExecution: true,
        enableLogging: true,
      });

      // Both available
      geminiProvider.isAvailableMock.mockResolvedValue(true);
      xaiProvider.isAvailableMock.mockResolvedValue(true);

      // Gemini throws during generation, x.ai succeeds
      geminiProvider.generateBooksMock.mockRejectedValue(
        new Error('API rate limit')
      );
      xaiProvider.generateBooksMock.mockResolvedValue([
        {
          title: 'Book 1',
          author: 'Author 1',
          publishDate: '2020',
          confidence: 30,
          source: 'xai',
        },
      ]);

      const result = await orchestrator.generateBooks(
        'test prompt',
        1,
        mockContext
      );

      // Should warn about Gemini failure
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        '[BookGenOrchestrator] Provider failed (concurrent)',
        expect.objectContaining({
          provider: 'gemini',
          error: 'API rate limit',
        })
      );

      // Should still succeed with x.ai
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('xai');
    });
  });
});
