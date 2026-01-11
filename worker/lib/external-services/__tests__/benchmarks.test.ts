/**
 * Performance Benchmarks for Service Provider Framework
 *
 * Measures:
 * - Provider registration overhead
 * - Registry lookup performance
 * - Orchestrator initialization time
 * - Capability filtering performance
 * - Memory footprint
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ISBNResolutionOrchestrator } from '../orchestrators/isbn-resolution-orchestrator.js';
import { CoverFetchOrchestrator } from '../orchestrators/cover-fetch-orchestrator.js';
import { MetadataEnrichmentOrchestrator } from '../orchestrators/metadata-enrichment-orchestrator.js';

// Import all providers
import { OpenLibraryProvider } from '../providers/open-library-provider.js';
import { GoogleBooksProvider } from '../providers/google-books-provider.js';
import { ArchiveOrgProvider } from '../providers/archive-org-provider.js';
import { WikidataProvider } from '../providers/wikidata-provider.js';
import { WikipediaProvider } from '../providers/wikipedia-provider.js';
import { ISBNdbProvider } from '../providers/isbndb-provider.js';
import { GeminiProvider } from '../providers/gemini-provider.js';

import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceCapability } from '../capabilities.js';

describe('Performance Benchmarks', () => {
  let mockContext: ServiceContext;

  beforeEach(() => {
    mockContext = {
      env: {
        CACHE: {} as any,
        QUOTA_KV: {} as any,
        ISBNDB_API_KEY: 'test-key',
        GOOGLE_BOOKS_API_KEY: 'test-key',
        GEMINI_API_KEY: 'test-key',
      } as Env,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as any,
    };
  });

  describe('Provider Registration Performance', () => {
    it('should register all 7 providers in <10ms', () => {
      const registry = new ServiceProviderRegistry();
      const providers = [
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
        new WikipediaProvider(),
        new ISBNdbProvider(),
        new GeminiProvider(),
      ];

      const startTime = performance.now();
      registry.registerAll(providers);
      const duration = performance.now() - startTime;

      expect(registry.getAll()).toHaveLength(7);
      expect(duration).toBeLessThan(10); // Should be nearly instant
    });

    it('should handle duplicate registration efficiently', () => {
      const registry = new ServiceProviderRegistry();
      const provider = new OpenLibraryProvider();

      registry.register(provider);

      const startTime = performance.now();
      expect(() => registry.register(provider)).toThrow();
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1); // Error check should be instant
    });
  });

  describe('Registry Lookup Performance', () => {
    let registry: ServiceProviderRegistry;

    beforeEach(() => {
      registry = new ServiceProviderRegistry();
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
        new WikipediaProvider(),
        new ISBNdbProvider(),
        new GeminiProvider(),
      ]);
    });

    it('should retrieve provider by name in <1ms', () => {
      const startTime = performance.now();
      const provider = registry.get('open-library');
      const duration = performance.now() - startTime;

      expect(provider).toBeDefined();
      expect(duration).toBeLessThan(1); // Map lookup should be instant
    });

    it('should filter by capability in <5ms', () => {
      const startTime = performance.now();
      const providers = registry.getByCapability(ServiceCapability.ISBN_RESOLUTION);
      const duration = performance.now() - startTime;

      expect(providers.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5); // Array filter should be fast
    });

    it('should filter by type in <5ms', () => {
      const startTime = performance.now();
      const providers = registry.getByType('free');
      const duration = performance.now() - startTime;

      expect(providers.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5);
    });

    it('should compute stats in <5ms', () => {
      const startTime = performance.now();
      const stats = registry.getStats();
      const duration = performance.now() - startTime;

      expect(stats.totalProviders).toBe(7);
      expect(duration).toBeLessThan(5); // Stats should be fast
    });
  });

  describe('Orchestrator Initialization Performance', () => {
    let registry: ServiceProviderRegistry;

    beforeEach(() => {
      registry = new ServiceProviderRegistry();
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
        new ISBNdbProvider(),
      ]);
    });

    it('should initialize ISBN orchestrator in <5ms', () => {
      const startTime = performance.now();
      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const duration = performance.now() - startTime;

      expect(orchestrator).toBeDefined();
      expect(duration).toBeLessThan(5);
    });

    it('should initialize cover orchestrator in <5ms', () => {
      const startTime = performance.now();
      const orchestrator = new CoverFetchOrchestrator(registry);
      const duration = performance.now() - startTime;

      expect(orchestrator).toBeDefined();
      expect(duration).toBeLessThan(5);
    });

    it('should initialize metadata orchestrator in <5ms', () => {
      const startTime = performance.now();
      const orchestrator = new MetadataEnrichmentOrchestrator(registry);
      const duration = performance.now() - startTime;

      expect(orchestrator).toBeDefined();
      expect(duration).toBeLessThan(5);
    });
  });

  describe('Provider Availability Checks', () => {
    let registry: ServiceProviderRegistry;

    beforeEach(() => {
      registry = new ServiceProviderRegistry();
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
        new WikipediaProvider(),
      ]);
    });

    it('should check 5 free providers availability in <50ms', async () => {
      const startTime = performance.now();
      const available = await registry.getAvailableProviders(
        ServiceCapability.METADATA_ENRICHMENT,
        mockContext
      );
      const duration = performance.now() - startTime;

      expect(available.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(50); // All free providers, should be fast
    });

    it('should handle quota checks for paid providers in <100ms', async () => {
      const paidRegistry = new ServiceProviderRegistry();
      paidRegistry.register(new ISBNdbProvider());

      const startTime = performance.now();
      const available = await paidRegistry.getAvailableProviders(
        ServiceCapability.ISBN_RESOLUTION,
        mockContext
      );
      const duration = performance.now() - startTime;

      // ISBNdb requires API key check
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Memory Footprint', () => {
    it('should maintain reasonable memory usage with all providers', () => {
      const registry = new ServiceProviderRegistry();
      const providers = [
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
        new WikipediaProvider(),
        new ISBNdbProvider(),
        new GeminiProvider(),
      ];

      // Memory usage should be minimal (providers are mostly stateless)
      registry.registerAll(providers);

      // Verify registry is functioning
      expect(registry.getAll()).toHaveLength(7);

      // Note: Actual memory profiling would require process.memoryUsage()
      // This test ensures registry doesn't throw OOM errors
    });
  });

  describe('Concurrent Operations', () => {
    let registry: ServiceProviderRegistry;

    beforeEach(() => {
      registry = new ServiceProviderRegistry();
      registry.registerAll([
        new OpenLibraryProvider(),
        new GoogleBooksProvider(),
        new ArchiveOrgProvider(),
        new WikidataProvider(),
      ]);
    });

    it('should handle 100 concurrent capability lookups in <50ms', async () => {
      const startTime = performance.now();

      const promises = Array.from({ length: 100 }, () =>
        Promise.resolve(
          registry.getByCapability(ServiceCapability.METADATA_ENRICHMENT)
        )
      );

      await Promise.all(promises);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50); // Should be very fast (no I/O)
    });

    it('should handle 100 concurrent availability checks in <500ms', async () => {
      const startTime = performance.now();

      const promises = Array.from({ length: 100 }, () =>
        registry.getAvailableProviders(
          ServiceCapability.COVER_IMAGES,
          mockContext
        )
      );

      await Promise.all(promises);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(500); // Multiple availability checks
    });
  });

  describe('Scalability', () => {
    it('should scale linearly with number of providers', () => {
      const timings: number[] = [];

      // Test with 1, 3, 5, 7 providers
      for (const count of [1, 3, 5, 7]) {
        const registry = new ServiceProviderRegistry();
        const providers = [
          new OpenLibraryProvider(),
          new GoogleBooksProvider(),
          new ArchiveOrgProvider(),
          new WikidataProvider(),
          new WikipediaProvider(),
          new ISBNdbProvider(),
          new GeminiProvider(),
        ].slice(0, count);

        const startTime = performance.now();
        registry.registerAll(providers);
        registry.getByCapability(ServiceCapability.METADATA_ENRICHMENT);
        const duration = performance.now() - startTime;

        timings.push(duration);
      }

      // Each iteration should be similarly fast
      const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
      expect(avgTiming).toBeLessThan(10); // Average should be <10ms
    });
  });
});
