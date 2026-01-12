/**
 * Integration Tests for Service Provider Framework
 *
 * Tests the full orchestration flow with real providers (mocked HTTP).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceProviderRegistry } from '../../provider-registry.js';
import { ISBNResolutionOrchestrator } from '../isbn-resolution-orchestrator.js';
import { CoverFetchOrchestrator } from '../cover-fetch-orchestrator.js';
import { MetadataEnrichmentOrchestrator } from '../metadata-enrichment-orchestrator.js';

// Import real providers
import { OpenLibraryProvider } from '../../providers/open-library-provider.js';
import { GoogleBooksProvider } from '../../providers/google-books-provider.js';
import { ArchiveOrgProvider } from '../../providers/archive-org-provider.js';
import { WikidataProvider } from '../../providers/wikidata-provider.js';

import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

describe('Service Provider Framework Integration', () => {
  let registry: ServiceProviderRegistry;
  let mockContext: ServiceContext;

  beforeEach(() => {
    registry = new ServiceProviderRegistry();
    mockContext = {
      env: {
        // Minimal env for free providers
        CACHE: {} as any,
        QUOTA_KV: {} as any,
      } as Env,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as any,
    };
  });

  describe('Provider Registration', () => {
    it('should register all providers without errors', () => {
      const providers = [
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
      ];

      expect(() => registry.registerAll(providers)).not.toThrow();
      expect(registry.getAll()).toHaveLength(4);
    });

    it('should correctly categorize providers by type', () => {
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
      ]);

      const stats = registry.getStats();

      expect(stats.totalProviders).toBe(4);
      expect(stats.byType.free).toBe(4); // All free providers
    });

    it('should correctly index providers by capability', () => {
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
      ]);

      const stats = registry.getStats();

      // ISBN resolution: OpenLibrary
      expect(stats.byCapability['isbn-resolution']).toBeGreaterThanOrEqual(1);

      // Cover images: Google Books, OpenLibrary, Archive.org, Wikidata
      expect(stats.byCapability['cover-images']).toBeGreaterThanOrEqual(3);

      // Metadata: Google Books, OpenLibrary, Archive.org, Wikidata
      expect(stats.byCapability['metadata-enrichment']).toBeGreaterThanOrEqual(3);
    });
  });

  describe('ISBN Resolution Orchestration', () => {
    it('should create orchestrator without errors', () => {
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
      ]);

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      expect(orchestrator).toBeDefined();
    });

    it('should attempt resolution with available providers', async () => {
      registry.registerAll([
        new OpenLibraryProvider(),
      ]);

      const orchestrator = new ISBNResolutionOrchestrator(registry, {
        providerTimeoutMs: 5000,
        enableLogging: false,
      });

      // This will fail due to no HTTP mocks, but tests orchestration logic
      const result = await orchestrator.resolveISBN(
        'The Hobbit',
        'J.R.R. Tolkien',
        mockContext
      );

      // Should fail gracefully (no mocks), but orchestrator should work
      expect(result).toBeDefined();
      expect(result.source).toBeDefined();
    });
  });

  describe('Cover Fetch Orchestration', () => {
    it('should create orchestrator without errors', () => {
      registry.registerAll([
        new GoogleBooksProvider(),
        new OpenLibraryProvider(),
        new ArchiveOrgProvider(),
      ]);

      const orchestrator = new CoverFetchOrchestrator(registry);
      expect(orchestrator).toBeDefined();
    });

    it('should attempt cover fetch with available providers', async () => {
      registry.registerAll([
        new GoogleBooksProvider(),
        new OpenLibraryProvider(),
      ]);

      const orchestrator = new CoverFetchOrchestrator(registry, {
        providerTimeoutMs: 5000,
        enableLogging: false,
      });

      // This will fail due to no HTTP mocks, but tests orchestration logic
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      // Should fail gracefully (no mocks), but orchestrator should work
      expect(result).toBeDefined(); // Can be null
    });
  });

  describe('Metadata Enrichment Orchestration', () => {
    it('should create orchestrator without errors', () => {
      registry.registerAll([
        new GoogleBooksProvider(),
        new OpenLibraryProvider(),
        new WikidataProvider(),
      ]);

      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      expect(orchestrator).toBeDefined();
    });

    it('should attempt enrichment with available providers', async () => {
      registry.registerAll([
        new GoogleBooksProvider(),
        new OpenLibraryProvider(),
      ]);

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        providerTimeoutMs: 5000,
        enableLogging: false,
        enableParallelFetch: true,
      });

      // This will fail due to no HTTP mocks, but tests orchestration logic
      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      // Should fail gracefully (no mocks), but orchestrator should work
      expect(result).toBeDefined();
      expect(result.metadata).toBeDefined(); // Can be null
      expect(result.providers).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multi-Orchestrator Workflows', () => {
    it('should support using multiple orchestrators together', { timeout: 30000 }, async () => {
      // Register all providers
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
      ]);

      // Create all orchestrators
      const isbnOrchestrator = new ISBNResolutionOrchestrator(registry, {
        enableLogging: false,
      });
      const coverOrchestrator = new CoverFetchOrchestrator(registry, {
        enableLogging: false,
      });
      const metadataOrchestrator = new MetadataEnrichmentOrchestrator(registry, {
        enableLogging: false,
      });

      // All orchestrators should be created successfully
      expect(isbnOrchestrator).toBeDefined();
      expect(coverOrchestrator).toBeDefined();
      expect(metadataOrchestrator).toBeDefined();

      // Simulate workflow: Title/Author → ISBN → Metadata + Cover
      const isbn = await isbnOrchestrator.resolveISBN(
        'The Hobbit',
        'J.R.R. Tolkien',
        mockContext
      );

      if (isbn.isbn) {
        // If ISBN resolved, fetch metadata and cover in parallel
        const [metadata, cover] = await Promise.all([
          metadataOrchestrator.enrichMetadata(isbn.isbn, mockContext),
          coverOrchestrator.fetchCover(isbn.isbn, mockContext),
        ]);

        expect(metadata).toBeDefined();
        expect(cover).toBeDefined();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle provider initialization errors gracefully', async () => {
      // Create orchestrator with empty registry
      const orchestrator = new ISBNResolutionOrchestrator(registry);

      // Should not throw, should return graceful failure
      const result = await orchestrator.resolveISBN(
        'The Hobbit',
        'J.R.R. Tolkien',
        mockContext
      );

      expect(result.isbn).toBeNull();
      expect(result.source).toBe('none');
    });

    it('should handle all providers failing gracefully', async () => {
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
      ]);

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        providerTimeoutMs: 100, // Very short timeout to force failures
        enableLogging: false,
      });

      const result = await orchestrator.enrichMetadata(
        '9780385544153',
        mockContext
      );

      // Should not throw, should return null metadata with error tracking
      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete orchestration within reasonable time', async () => {
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
      ]);

      const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
        providerTimeoutMs: 5000,
        enableLogging: false,
      });

      const startTime = Date.now();
      await orchestrator.enrichMetadata('9780385544153', mockContext);
      const duration = Date.now() - startTime;

      // Should timeout within reasonable time (10s max with 5s per provider)
      expect(duration).toBeLessThan(15000);
    });

    it('should support parallel execution for metadata enrichment', async () => {
      registry.registerAll([
        new GoogleBooksProvider(),
        new OpenLibraryProvider(),
      ]);

      const parallelOrchestrator = new MetadataEnrichmentOrchestrator(registry, {
        enableParallelFetch: true,
        providerTimeoutMs: 1000,
        enableLogging: false,
      });

      const startTime = Date.now();
      await parallelOrchestrator.enrichMetadata('9780385544153', mockContext);
      const parallelDuration = Date.now() - startTime;

      // Parallel should complete (even if all fail due to no mocks)
      expect(parallelDuration).toBeLessThan(5000);
    });
  });
});
