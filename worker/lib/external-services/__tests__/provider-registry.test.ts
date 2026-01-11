import { describe, it, expect, beforeEach } from 'vitest';
import {
  ServiceProviderRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from '../provider-registry.js';
import {
  ServiceCapability,
  type IServiceProvider,
  type IISBNResolver,
  type ICoverProvider,
} from '../capabilities.js';
import type { Env } from '../../../src/env.js';
import type { ServiceContext } from '../service-context.js';

// Mock providers for testing
class MockISBNProvider implements IISBNResolver {
  readonly name = 'mock-isbn';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.ISBN_RESOLUTION];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }

  async resolveISBN(
    _title: string,
    _author: string,
    _context: ServiceContext
  ) {
    return { isbn: '9780123456789', confidence: 90, source: 'mock-isbn' };
  }
}

class MockCoverProvider implements ICoverProvider {
  readonly name = 'mock-cover';
  readonly providerType = 'paid' as const;
  readonly capabilities = [ServiceCapability.COVER_IMAGES];

  constructor(private available: boolean = true) {}

  async isAvailable(_env: Env): Promise<boolean> {
    return this.available;
  }

  async fetchCover(_isbn: string, _context: ServiceContext) {
    return { url: 'https://example.com/cover.jpg', source: 'mock-cover' };
  }
}

class MockMultiCapabilityProvider implements IServiceProvider {
  readonly name = 'mock-multi';
  readonly providerType = 'ai' as const;
  readonly capabilities = [
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
  ];

  async isAvailable(_env: Env): Promise<boolean> {
    return true;
  }
}

describe('ServiceProviderRegistry', () => {
  let registry: ServiceProviderRegistry;

  beforeEach(() => {
    registry = new ServiceProviderRegistry();
  });

  describe('register', () => {
    it('should register a provider successfully', () => {
      const provider = new MockISBNProvider();
      registry.register(provider);

      const retrieved = registry.get('mock-isbn');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('mock-isbn');
    });

    it('should throw error if provider with same name already registered', () => {
      const provider1 = new MockISBNProvider();
      const provider2 = new MockISBNProvider();

      registry.register(provider1);

      expect(() => registry.register(provider2)).toThrow(
        "Provider 'mock-isbn' is already registered"
      );
    });
  });

  describe('registerAll', () => {
    it('should register multiple providers at once', () => {
      const providers = [
        new MockISBNProvider(),
        new MockCoverProvider(),
        new MockMultiCapabilityProvider(),
      ];

      registry.registerAll(providers);

      expect(registry.getAll()).toHaveLength(3);
      expect(registry.get('mock-isbn')).toBeDefined();
      expect(registry.get('mock-cover')).toBeDefined();
      expect(registry.get('mock-multi')).toBeDefined();
    });
  });

  describe('get', () => {
    it('should return provider by name', () => {
      const provider = new MockISBNProvider();
      registry.register(provider);

      const retrieved = registry.get('mock-isbn');
      expect(retrieved).toBe(provider);
    });

    it('should return undefined for non-existent provider', () => {
      const retrieved = registry.get('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return empty array when no providers registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('should return all registered providers', () => {
      registry.register(new MockISBNProvider());
      registry.register(new MockCoverProvider());

      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('getByCapability', () => {
    beforeEach(() => {
      registry.register(new MockISBNProvider());
      registry.register(new MockCoverProvider());
      registry.register(new MockMultiCapabilityProvider());
    });

    it('should return providers supporting ISBN resolution', () => {
      const resolvers = registry.getByCapability<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION
      );

      expect(resolvers).toHaveLength(2); // mock-isbn and mock-multi
      expect(resolvers.map((r) => r.name).sort()).toEqual([
        'mock-isbn',
        'mock-multi',
      ]);
    });

    it('should return providers supporting cover images', () => {
      const coverProviders = registry.getByCapability<ICoverProvider>(
        ServiceCapability.COVER_IMAGES
      );

      expect(coverProviders).toHaveLength(2); // mock-cover and mock-multi
      expect(coverProviders.map((p) => p.name).sort()).toEqual([
        'mock-cover',
        'mock-multi',
      ]);
    });

    it('should return empty array for unsupported capability', () => {
      const providers = registry.getByCapability(
        ServiceCapability.AUTHOR_BIOGRAPHY
      );

      expect(providers).toEqual([]);
    });
  });

  describe('getByType', () => {
    beforeEach(() => {
      registry.register(new MockISBNProvider()); // free
      registry.register(new MockCoverProvider()); // paid
      registry.register(new MockMultiCapabilityProvider()); // ai
    });

    it('should return providers by type: free', () => {
      const freeProviders = registry.getByType('free');
      expect(freeProviders).toHaveLength(1);
      expect(freeProviders[0].name).toBe('mock-isbn');
    });

    it('should return providers by type: paid', () => {
      const paidProviders = registry.getByType('paid');
      expect(paidProviders).toHaveLength(1);
      expect(paidProviders[0].name).toBe('mock-cover');
    });

    it('should return providers by type: ai', () => {
      const aiProviders = registry.getByType('ai');
      expect(aiProviders).toHaveLength(1);
      expect(aiProviders[0].name).toBe('mock-multi');
    });
  });

  describe('getAvailableProviders', () => {
    const mockContext = {
      env: {} as Env,
      logger: {
        debug: () => {},
        warn: () => {},
      } as any,
    } as ServiceContext;

    it('should return only available providers', async () => {
      // Create a fresh registry for this test
      const registry2 = new ServiceProviderRegistry();

      class AvailableCoverProvider implements ICoverProvider {
        readonly name = 'available-cover';
        readonly providerType = 'paid' as const;
        readonly capabilities = [ServiceCapability.COVER_IMAGES];

        async isAvailable(_env: Env): Promise<boolean> {
          return true;
        }

        async fetchCover(_isbn: string, _context: ServiceContext) {
          return { url: 'https://example.com/cover.jpg', source: 'available-cover' };
        }
      }

      class UnavailableCoverProvider implements ICoverProvider {
        readonly name = 'unavailable-cover';
        readonly providerType = 'paid' as const;
        readonly capabilities = [ServiceCapability.COVER_IMAGES];

        async isAvailable(_env: Env): Promise<boolean> {
          return false;
        }

        async fetchCover(_isbn: string, _context: ServiceContext) {
          return { url: 'https://example.com/cover.jpg', source: 'unavailable-cover' };
        }
      }

      registry2.register(new AvailableCoverProvider());
      registry2.register(new UnavailableCoverProvider());

      const available = await registry2.getAvailableProviders<ICoverProvider>(
        ServiceCapability.COVER_IMAGES,
        mockContext
      );

      expect(available).toHaveLength(1);
      expect(available[0].name).toBe('available-cover');
    });

    it('should return empty array if no providers available', async () => {
      class UnavailableProvider implements IISBNResolver {
        readonly name = 'unavailable-isbn';
        readonly providerType = 'free' as const;
        readonly capabilities = [ServiceCapability.ISBN_RESOLUTION];

        async isAvailable(): Promise<boolean> {
          return false;
        }

        async resolveISBN(_title: string, _author: string, _context: ServiceContext) {
          return { isbn: '9780123456789', confidence: 90, source: 'unavailable-isbn' };
        }
      }

      registry.register(new UnavailableProvider());

      const available = await registry.getAvailableProviders<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION,
        mockContext
      );

      expect(available).toEqual([]);
    });

    it('should handle provider availability check errors gracefully', async () => {
      class ErrorProvider implements IISBNResolver {
        readonly name = 'error-provider';
        readonly providerType = 'free' as const;
        readonly capabilities = [ServiceCapability.ISBN_RESOLUTION];

        async isAvailable(): Promise<boolean> {
          throw new Error('Availability check failed');
        }

        async resolveISBN(_title: string, _author: string, _context: ServiceContext) {
          return { isbn: '9780123456789', confidence: 90, source: 'error-provider' };
        }
      }

      registry.register(new ErrorProvider());

      const available = await registry.getAvailableProviders<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION,
        mockContext
      );

      expect(available).toEqual([]);
    });
  });

  describe('hasCapability', () => {
    beforeEach(() => {
      registry.register(new MockISBNProvider());
    });

    it('should return true for supported capability', () => {
      expect(registry.hasCapability(ServiceCapability.ISBN_RESOLUTION)).toBe(
        true
      );
    });

    it('should return false for unsupported capability', () => {
      expect(registry.hasCapability(ServiceCapability.AUTHOR_BIOGRAPHY)).toBe(
        false
      );
    });
  });

  describe('getStats', () => {
    it('should return correct stats with no providers', () => {
      const stats = registry.getStats();

      expect(stats.totalProviders).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.byCapability).toEqual({});
    });

    it('should return correct stats with multiple providers', () => {
      registry.register(new MockISBNProvider()); // free, ISBN_RESOLUTION
      registry.register(new MockCoverProvider()); // paid, COVER_IMAGES
      registry.register(new MockMultiCapabilityProvider()); // ai, 3 capabilities

      const stats = registry.getStats();

      expect(stats.totalProviders).toBe(3);
      expect(stats.byType).toEqual({
        free: 1,
        paid: 1,
        ai: 1,
      });
      expect(stats.byCapability).toEqual({
        [ServiceCapability.ISBN_RESOLUTION]: 2,
        [ServiceCapability.COVER_IMAGES]: 2,
        [ServiceCapability.METADATA_ENRICHMENT]: 1,
      });
    });
  });

  describe('clear', () => {
    it('should remove all registered providers', () => {
      registry.register(new MockISBNProvider());
      registry.register(new MockCoverProvider());

      expect(registry.getAll()).toHaveLength(2);

      registry.clear();

      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('global registry', () => {
    beforeEach(() => {
      resetGlobalRegistry();
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = getGlobalRegistry();
      const instance2 = getGlobalRegistry();

      expect(instance1).toBe(instance2);
    });

    it('should allow registration across multiple calls', () => {
      const registry1 = getGlobalRegistry();
      registry1.register(new MockISBNProvider());

      const registry2 = getGlobalRegistry();
      expect(registry2.getAll()).toHaveLength(1);
    });

    it('should reset global registry', () => {
      const registry1 = getGlobalRegistry();
      registry1.register(new MockISBNProvider());

      resetGlobalRegistry();

      const registry2 = getGlobalRegistry();
      expect(registry2).not.toBe(registry1);
      expect(registry2.getAll()).toEqual([]);
    });
  });
});
