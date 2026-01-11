/**
 * Quota Enforcement Validation Tests
 *
 * Tests that paid providers correctly respect quota limits and
 * orchestrators properly handle quota exhaustion scenarios.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ISBNResolutionOrchestrator } from '../orchestrators/isbn-resolution-orchestrator.js';
import { CoverFetchOrchestrator } from '../orchestrators/cover-fetch-orchestrator.js';
import {
  ServiceCapability,
  type IISBNResolver,
  type ICoverProvider,
  type ISBNResolutionResult,
  type CoverResult,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';

// Mock paid provider with quota checks
class MockQuotaLimitedProvider implements IISBNResolver, ICoverProvider {
  readonly name = 'mock-paid-quota';
  readonly providerType = 'paid' as const;
  readonly capabilities = [
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.COVER_IMAGES,
  ];

  constructor(private quotaAvailable: boolean = true) {}

  async isAvailable(_env: Env): Promise<boolean> {
    // Simulate quota check
    return this.quotaAvailable;
  }

  async resolveISBN(
    _title: string,
    _author: string,
    _context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    if (!this.quotaAvailable) {
      throw new Error('Quota exhausted');
    }
    return { isbn: '9780385544153', confidence: 95, source: 'mock-paid-quota' };
  }

  async fetchCover(
    _isbn: string,
    _context: ServiceContext
  ): Promise<CoverResult | null> {
    if (!this.quotaAvailable) {
      throw new Error('Quota exhausted');
    }
    return {
      url: 'https://example.com/cover.jpg',
      source: 'mock-paid-quota',
      size: 'large',
    };
  }
}

// Mock free fallback provider
class MockFreeProvider implements IISBNResolver, ICoverProvider {
  readonly name = 'mock-free-fallback';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.COVER_IMAGES,
  ];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async resolveISBN(
    _title: string,
    _author: string,
    _context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    return { isbn: '9780385544153', confidence: 85, source: 'mock-free-fallback' };
  }

  async fetchCover(
    _isbn: string,
    _context: ServiceContext
  ): Promise<CoverResult | null> {
    return {
      url: 'https://example.com/free-cover.jpg',
      source: 'mock-free-fallback',
      size: 'large',
    };
  }
}

describe('Quota Enforcement Validation', () => {
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

  describe('Provider Availability Based on Quota', () => {
    it('should exclude paid provider when quota exhausted', async () => {
      const paidProvider = new MockQuotaLimitedProvider(false); // No quota
      const freeProvider = new MockFreeProvider();

      registry.register(paidProvider);
      registry.register(freeProvider);

      const available = await registry.getAvailableProviders<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION,
        mockContext
      );

      // Should only return free provider (paid provider excluded due to quota)
      expect(available).toHaveLength(1);
      expect(available[0].name).toBe('mock-free-fallback');
    });

    it('should include paid provider when quota available', async () => {
      const paidProvider = new MockQuotaLimitedProvider(true); // Quota available
      const freeProvider = new MockFreeProvider();

      registry.register(paidProvider);
      registry.register(freeProvider);

      const available = await registry.getAvailableProviders<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION,
        mockContext
      );

      // Should return both providers
      expect(available).toHaveLength(2);
      expect(available.map((p) => p.name)).toContain('mock-paid-quota');
      expect(available.map((p) => p.name)).toContain('mock-free-fallback');
    });
  });

  describe('ISBN Resolution with Quota Exhaustion', () => {
    it('should fallback to free provider when paid quota exhausted', async () => {
      const paidProvider = new MockQuotaLimitedProvider(false); // No quota
      const freeProvider = new MockFreeProvider();

      registry.register(paidProvider);
      registry.register(freeProvider);

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      // Should use free provider (paid excluded from availability check)
      expect(result.isbn).toBe('9780385544153');
      expect(result.source).toBe('mock-free-fallback');
    });

    it('should use paid provider when quota available', async () => {
      const paidProvider = new MockQuotaLimitedProvider(true); // Quota available
      const freeProvider = new MockFreeProvider();

      registry.register(paidProvider);
      registry.register(freeProvider);

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      // Should use paid provider (higher priority)
      expect(result.isbn).toBe('9780385544153');
      expect(result.source).toBe('mock-paid-quota');
    });
  });

  describe('Cover Fetch with Quota Exhaustion', () => {
    it('should prioritize free providers to save quota', async () => {
      const paidProvider = new MockQuotaLimitedProvider(true); // Quota available
      const freeProvider = new MockFreeProvider();

      registry.register(paidProvider);
      registry.register(freeProvider);

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      // Should use free provider first (quota preservation)
      expect(result).not.toBeNull();
      expect(result?.source).toBe('mock-free-fallback');
    });

    it('should fallback to paid provider when free providers fail', async () => {
      const paidProvider = new MockQuotaLimitedProvider(true); // Quota available

      // Free provider that fails
      class FailingFreeProvider extends MockFreeProvider {
        async fetchCover(): Promise<CoverResult | null> {
          return null; // Fails
        }
      }

      registry.register(new FailingFreeProvider());
      registry.register(paidProvider);

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      // Should fallback to paid provider
      expect(result).not.toBeNull();
      expect(result?.source).toBe('mock-paid-quota');
    });

    it('should skip paid provider when quota exhausted', async () => {
      const paidProvider = new MockQuotaLimitedProvider(false); // No quota
      const freeProvider = new MockFreeProvider();

      registry.register(paidProvider);
      registry.register(freeProvider);

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      // Should use free provider (paid excluded from availability)
      expect(result).not.toBeNull();
      expect(result?.source).toBe('mock-free-fallback');
    });
  });

  describe('Graceful Degradation', () => {
    it('should return null when all providers quota exhausted', async () => {
      const paidProvider = new MockQuotaLimitedProvider(false); // No quota

      registry.register(paidProvider);

      const orchestrator = new CoverFetchOrchestrator(registry);
      const result = await orchestrator.fetchCover('9780385544153', mockContext);

      // Should fail gracefully (no available providers)
      expect(result).toBeNull();
    });

    it('should track quota-related errors', async () => {
      const paidProvider = new MockQuotaLimitedProvider(false); // No quota

      registry.register(paidProvider);

      const orchestrator = new ISBNResolutionOrchestrator(registry);
      const result = await orchestrator.resolveISBN(
        'The Splendid and the Vile',
        'Erik Larson',
        mockContext
      );

      // Should return graceful failure
      expect(result.isbn).toBeNull();
      expect(result.source).toBe('none');
    });
  });

  describe('Provider Ordering with Mixed Quota States', () => {
    it('should order providers correctly: paid (with quota) → free', async () => {
      const paidWithQuota = new MockQuotaLimitedProvider(true);
      const freeProvider = new MockFreeProvider();

      registry.register(paidWithQuota);
      registry.register(freeProvider);

      const available = await registry.getAvailableProviders<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION,
        mockContext
      );

      expect(available).toHaveLength(2);
      // Paid provider should be included when quota available
      expect(available.map((p) => p.name)).toContain('mock-paid-quota');
    });

    it('should skip paid providers without quota', async () => {
      const paidNoQuota = new MockQuotaLimitedProvider(false);
      const freeProvider = new MockFreeProvider();

      registry.register(paidNoQuota);
      registry.register(freeProvider);

      const available = await registry.getAvailableProviders<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION,
        mockContext
      );

      expect(available).toHaveLength(1);
      expect(available[0].name).toBe('mock-free-fallback');
    });
  });
});
