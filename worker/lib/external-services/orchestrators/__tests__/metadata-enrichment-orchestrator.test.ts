import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetadataEnrichmentOrchestrator } from '../metadata-enrichment-orchestrator.js';
import { ServiceProviderRegistry } from '../../provider-registry.js';
import {
  ServiceCapability,
  type IMetadataProvider,
  type ISubjectProvider,
  type BookMetadata,
} from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

// Mock metadata providers
class MockPrimaryMetadataProvider implements IMetadataProvider {
  readonly name = 'mock-primary';
  readonly providerType = 'paid' as const;
  readonly capabilities = [ServiceCapability.METADATA_ENRICHMENT];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async fetchMetadata(
    _isbn: string,
    _context: ServiceContext
  ): Promise<BookMetadata | null> {
    return {
      title: 'The Splendid and the Vile',
      authors: ['Erik Larson'],
      publisher: 'Crown',
      publishDate: '2020-02-25',
      pageCount: 608,
      language: 'en',
      isbn: '0385544154',
      isbn13: '9780385544153',
      description: 'A short description from primary provider.',
      subjects: ['World War II', 'History'],
    };
  }
}

class MockSecondaryMetadataProvider implements IMetadataProvider {
  readonly name = 'mock-secondary';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.METADATA_ENRICHMENT];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async fetchMetadata(
    _isbn: string,
    _context: ServiceContext
  ): Promise<BookMetadata | null> {
    return {
      title: 'The Splendid and the Vile',
      authors: ['Erik Larson'],
      publisher: 'Crown Publishing',
      publishDate: '2020-02-25',
      pageCount: 608,
      language: 'en',
      isbn: '0385544154',
      isbn13: '9780385544153',
      description:
        'A much longer and more detailed description from the secondary provider that should be preferred over the shorter one.',
      subjects: ['Biography', 'Churchill'],
      coverUrl: 'https://example.com/cover.jpg',
    };
  }
}

class MockSubjectOnlyProvider implements ISubjectProvider {
  readonly name = 'mock-subjects';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.SUBJECT_ENRICHMENT];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async fetchSubjects(
    _isbn: string,
    _context: ServiceContext
  ): Promise<string[] | null> {
    return ['World War II', 'London', 'Blitz']; // Some overlap with metadata
  }
}

class MockFailingProvider implements IMetadataProvider {
  readonly name = 'mock-failing';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.METADATA_ENRICHMENT];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async fetchMetadata(
    _isbn: string,
    _context: ServiceContext
  ): Promise<BookMetadata | null> {
    throw new Error('Provider failed');
  }
}

describe('MetadataEnrichmentOrchestrator', () => {
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

  describe('enrichMetadata', () => {
    it('should return null when no providers available', async () => {
      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      expect(result.metadata).toBeNull();
      expect(result.providers.metadata).toEqual([]);
      expect(result.providers.subjects).toEqual([]);
    });

    it('should merge metadata from multiple providers', async () => {
      registry.register(new MockPrimaryMetadataProvider());
      registry.register(new MockSecondaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.title).toBe('The Splendid and the Vile');
      expect(result.providers.metadata).toHaveLength(2);
    });

    it('should prefer longer descriptions', async () => {
      registry.register(new MockPrimaryMetadataProvider());
      registry.register(new MockSecondaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      // Should use longer description from secondary provider
      expect(result.metadata?.description).toContain('much longer and more detailed');
    });

    it('should deduplicate subjects from multiple sources', async () => {
      registry.register(new MockPrimaryMetadataProvider());
      registry.register(new MockSubjectOnlyProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      // Should have unique subjects from both providers
      expect(result.metadata?.subjects).toBeDefined();
      expect(result.metadata?.subjects).toContain('World War II'); // Original casing preserved
      expect(result.metadata?.subjects).toContain('History');
      expect(result.metadata?.subjects).toContain('London');
      expect(result.metadata?.subjects).toContain('Blitz');

      // Check for duplicates (case-insensitive)
      const lowercaseSubjects = result.metadata?.subjects?.map((s) =>
        s.toLowerCase()
      );
      const uniqueSubjects = new Set(lowercaseSubjects);
      expect(lowercaseSubjects?.length).toBe(uniqueSubjects.size);
    });

    it('should handle provider failures gracefully', async () => {
      registry.register(new MockFailingProvider());
      registry.register(new MockPrimaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      // Should still get metadata from successful provider
      expect(result.metadata).not.toBeNull();
      expect(result.providers.metadata).toEqual(['mock-primary']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].provider).toBe('mock-failing');
    });

    it('should support parallel fetching', async () => {
      registry.register(new MockPrimaryMetadataProvider());
      registry.register(new MockSecondaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        enableParallelFetch: true,
      });

      const startTime = Date.now();
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );
      const duration = Date.now() - startTime;

      expect(result.metadata).not.toBeNull();
      // Parallel should be faster than sequential (though this is a weak test with mocks)
      expect(duration).toBeLessThan(1000);
    });

    it('should support sequential fetching', async () => {
      registry.register(new MockPrimaryMetadataProvider());
      registry.register(new MockSecondaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        enableParallelFetch: false,
      });

      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      expect(result.metadata).not.toBeNull();
      expect(result.providers.metadata).toHaveLength(2);
    });

    it('should limit subject providers', async () => {
      // Register more subject providers than the limit
      class MockSubjectProvider1 extends MockSubjectOnlyProvider {
        readonly name = 'mock-subjects-1';
      }
      class MockSubjectProvider2 extends MockSubjectOnlyProvider {
        readonly name = 'mock-subjects-2';
      }
      class MockSubjectProvider3 extends MockSubjectOnlyProvider {
        readonly name = 'mock-subjects-3';
      }
      class MockSubjectProvider4 extends MockSubjectOnlyProvider {
        readonly name = 'mock-subjects-4';
      }

      registry.register(new MockSubjectProvider1());
      registry.register(new MockSubjectProvider2());
      registry.register(new MockSubjectProvider3());
      registry.register(new MockSubjectProvider4());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        maxSubjectProviders: 2,
      });

      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      // Should only query 2 subject providers
      expect(result.providers.subjects.length).toBeLessThanOrEqual(2);
    });

    it('should log enrichment when logging enabled', async () => {
      registry.register(new MockPrimaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        enableLogging: true,
      });

      await orchestrator.enrichMetadata('9780385544153', mockContext);

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Starting metadata enrichment',
        expect.objectContaining({
          isbn: '9780385544153',
        })
      );
    });

    it('should not log when logging disabled', async () => {
      registry.register(new MockPrimaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        enableLogging: false,
      });

      await orchestrator.enrichMetadata('9780385544153', mockContext);

      expect(mockContext.logger.info).not.toHaveBeenCalled();
    });

    it('should track enrichment duration', async () => {
      registry.register(new MockPrimaryMetadataProvider());

      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(1000); // Should be fast with mocks
    });
  });
});
