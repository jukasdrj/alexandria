/**
 * Service Provider Framework - Provider Registry
 *
 * Central registry for all external service providers.
 * Enables runtime service discovery and capability-based routing.
 *
 * WORKER OPTIMIZATION:
 * - Global singleton pattern minimizes cold start overhead
 * - Providers registered once on Worker initialization
 * - Availability checks run in parallel (Promise.all) to reduce latency from O(n) to O(1)
 * - Each availability check has a configurable timeout (default: 5s) to prevent slow KV lookups
 * - Consider pre-filtering by capability before availability checks to reduce KV reads
 */

import type { IServiceProvider } from './capabilities.js';
import type { ServiceCapability } from './capabilities.js';
import type { ServiceContext } from './service-context.js';

/**
 * Central registry for all external service providers
 *
 * This enables:
 * - Dynamic service discovery at runtime
 * - Capability-based service routing
 * - Easy addition/removal of providers
 * - Configuration-driven orchestration (future)
 */
export class ServiceProviderRegistry {
  private providers: Map<string, IServiceProvider> = new Map();
  private readonly availabilityTimeoutMs: number;

  /**
   * Create a new provider registry
   *
   * @param availabilityTimeoutMs - Timeout in milliseconds for provider availability checks.
   *                                This prevents slow KV lookups from delaying orchestrator startup.
   *                                Default: 5000ms (5 seconds)
   */
  constructor(availabilityTimeoutMs: number = 5000) {
    this.availabilityTimeoutMs = availabilityTimeoutMs;
  }

  /**
   * Register a service provider
   *
   * @param provider - Service provider to register
   * @throws Error if provider with same name already registered
   */
  register(provider: IServiceProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider '${provider.name}' is already registered`);
    }

    this.providers.set(provider.name, provider);
  }

  /**
   * Register multiple providers at once
   *
   * @param providers - Array of providers to register
   */
  registerAll(providers: IServiceProvider[]): void {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  /**
   * Get a specific provider by name
   *
   * @param name - Provider name
   * @returns Provider or undefined if not found
   */
  get(name: string): IServiceProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers
   *
   * @returns Array of all providers
   */
  getAll(): IServiceProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers by capability
   *
   * @param capability - Service capability to filter by
   * @returns Array of providers supporting this capability
   */
  getByCapability<T extends IServiceProvider>(
    capability: ServiceCapability
  ): T[] {
    return Array.from(this.providers.values())
      .filter((p) => p.capabilities.includes(capability)) as T[];
  }

  /**
   * Get providers by type (free, paid, ai)
   *
   * @param type - Provider type
   * @returns Array of providers of this type
   */
  getByType(type: 'free' | 'paid' | 'ai'): IServiceProvider[] {
    return Array.from(this.providers.values()).filter(
      (p) => p.providerType === type
    );
  }

  /**
   * Get available providers for a capability
   *
   * Checks each provider's isAvailable() method to filter out
   * providers that can't currently be used (missing API keys, quota exhausted, etc.)
   *
   * Each availability check has a configurable timeout to prevent slow KV lookups
   * from delaying orchestrator startup (especially on cold starts).
   *
   * @param capability - Service capability to filter by
   * @param context - Service context for availability checks
   * @returns Array of currently available providers
   */
  async getAvailableProviders<T extends IServiceProvider>(
    capability: ServiceCapability,
    context: ServiceContext
  ): Promise<T[]> {
    const providers = this.getByCapability<T>(capability);

    // Check all providers in parallel
    const availabilityChecks = providers.map(async (provider) => {
      try {
        // Add timeout to prevent slow quota checks from delaying startup
        const timeoutPromise = new Promise<boolean>((_, reject) => {
          setTimeout(() => reject(new Error('Availability check timeout')), this.availabilityTimeoutMs);
        });

        const isAvailable = await Promise.race([
          provider.isAvailable(context.env),
          timeoutPromise,
        ]);

        if (isAvailable) {
          return provider;
        } else {
          context.logger.debug('Provider not available', {
            provider: provider.name,
            capability,
          });
          return null;
        }
      } catch (error) {
        context.logger.warn('Provider availability check failed', {
          provider: provider.name,
          capability,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    });

    const results = await Promise.all(availabilityChecks);

    // Filter out null values and return only available providers
    return results.filter((provider): provider is T => provider !== null);
  }

  /**
   * Check if a capability is supported by any registered provider
   *
   * @param capability - Service capability to check
   * @returns True if at least one provider supports this capability
   */
  hasCapability(capability: ServiceCapability): boolean {
    return this.getByCapability(capability).length > 0;
  }

  /**
   * Get statistics about registered providers
   *
   * @returns Registry statistics
   */
  getStats(): {
    totalProviders: number;
    byType: Record<string, number>;
    byCapability: Record<string, number>;
  } {
    const providers = this.getAll();

    const byType: Record<string, number> = {};
    const byCapability: Record<string, number> = {};

    for (const provider of providers) {
      // Count by type
      byType[provider.providerType] = (byType[provider.providerType] || 0) + 1;

      // Count by capability
      for (const capability of provider.capabilities) {
        byCapability[capability] = (byCapability[capability] || 0) + 1;
      }
    }

    return {
      totalProviders: providers.length,
      byType,
      byCapability,
    };
  }

  /**
   * Clear all registered providers
   * Primarily for testing
   */
  clear(): void {
    this.providers.clear();
  }
}

/**
 * Global registry instance
 * Initialized once and reused across requests
 */
let globalRegistry: ServiceProviderRegistry | null = null;

/**
 * Get the global provider registry
 * Creates it on first access
 */
export function getGlobalRegistry(): ServiceProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new ServiceProviderRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry
 * Primarily for testing
 */
export function resetGlobalRegistry(): void {
  globalRegistry = null;
}
