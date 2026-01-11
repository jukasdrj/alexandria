/**
 * Cover Fetch Orchestrator
 *
 * Registry-based orchestrator for book cover image fetching using the Service Provider Framework.
 * Replaces hard-coded provider chains with dynamic discovery.
 *
 * Priority Chain:
 * 1. Google Books (free, good quality, fast)
 * 2. OpenLibrary (free, reliable)
 * 3. Archive.org (free, excellent for pre-2000 books)
 * 4. Wikidata (free, Wikimedia Commons images)
 * 5. ISBNdb (paid, highest quality, quota-protected)
 *
 * Features:
 * - Dynamic provider discovery via registry
 * - Quality-based provider ordering (free providers first to save quota)
 * - Timeout protection per provider (10s default - covers usually fast)
 * - Observability logging for cache hit analysis
 *
 * @module lib/external-services/orchestrators/cover-fetch-orchestrator
 */

import type { CoverResult, ICoverProvider } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Cover Fetch Orchestrator Configuration
 */
export interface CoverFetchConfig {
  /** Timeout per provider in milliseconds (default: 10000 - covers are usually fast) */
  providerTimeoutMs?: number;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;

  /** Provider priority order (default: free-first to save quota) */
  providerOrder?: string[];

  /** Preferred image size (default: 'large') */
  preferredSize?: 'small' | 'medium' | 'large';
}

/**
 * Cover fetch attempt result (internal tracking)
 */
interface CoverAttempt {
  provider: string;
  success: boolean;
  url: string | null;
  size?: string;
  durationMs: number;
  error?: string;
}

// =================================================================================
// Cover Fetch Orchestrator
// =================================================================================

/**
 * Cover Fetch Orchestrator
 *
 * Uses Service Provider Registry for dynamic cover image fetching with cascading fallback.
 * Prioritizes free providers to preserve ISBNdb quota.
 *
 * @example
 * ```typescript
 * const registry = new ServiceProviderRegistry();
 * registry.register(new GoogleBooksProvider());
 * registry.register(new OpenLibraryProvider());
 * registry.register(new ISBNdbProvider());
 *
 * const orchestrator = new CoverFetchOrchestrator(registry);
 * const result = await orchestrator.fetchCover(
 *   '9780385544153',
 *   { env, logger }
 * );
 *
 * if (result) {
 *   console.log(`Cover from ${result.source}: ${result.url}`);
 * }
 * ```
 */
export class CoverFetchOrchestrator {
  private config: Required<CoverFetchConfig>;

  constructor(
    private registry: ServiceProviderRegistry,
    config: CoverFetchConfig = {}
  ) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? 10000,
      enableLogging: config.enableLogging ?? true,
      providerOrder: config.providerOrder ?? [],
      preferredSize: config.preferredSize ?? 'large',
    };
  }

  /**
   * Fetch cover image for ISBN
   *
   * Tries providers in priority order (free first) until success or all fail.
   *
   * @param isbn - ISBN-13 to fetch cover for
   * @param context - Service context (env, logger)
   * @returns Cover result with URL and source, or null if not found
   */
  async fetchCover(
    isbn: string,
    context: ServiceContext
  ): Promise<CoverResult | null> {
    const { logger } = context;
    const startTime = Date.now();
    const attempts: CoverAttempt[] = [];

    try {
      // Get available cover providers from registry
      const providers = await this.registry.getAvailableProviders<ICoverProvider>(
        ServiceCapability.COVER_IMAGES,
        context
      );

      if (providers.length === 0) {
        logger.warn('No cover providers available');
        return null;
      }

      // Order providers (free first to save quota)
      const orderedProviders = this.orderProviders(providers, context);

      if (this.config.enableLogging) {
        logger.info('Starting cover fetch', {
          isbn,
          availableProviders: orderedProviders.map(p => p.name),
        });
      }

      // Try each provider until success
      for (const provider of orderedProviders) {
        const attempt = await this.tryProvider(provider, isbn, context);
        attempts.push(attempt);

        if (attempt.success && attempt.url) {
          // Success! Log and return
          if (this.config.enableLogging) {
            logger.info('Cover fetched successfully', {
              isbn,
              provider: attempt.provider,
              size: attempt.size,
              durationMs: attempt.durationMs,
              totalDurationMs: Date.now() - startTime,
              attemptedProviders: attempts.length,
            });
          }

          return {
            url: attempt.url,
            source: attempt.provider,
            size: (attempt.size as 'small' | 'medium' | 'large') || this.config.preferredSize,
          };
        }

        // Log failure and continue
        if (this.config.enableLogging) {
          logger.debug('Cover provider failed, trying next', {
            provider: attempt.provider,
            error: attempt.error,
            remainingProviders: orderedProviders.length - attempts.length,
          });
        }
      }

      // All providers failed
      if (this.config.enableLogging) {
        logger.warn('All cover providers failed', {
          isbn,
          attemptedProviders: attempts.length,
          totalDurationMs: Date.now() - startTime,
        });
      }

      return null;
    } catch (error) {
      logger.error('Cover fetch orchestrator error', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
        attempts: attempts.length,
      });
      return null;
    }
  }

  /**
   * Try a single provider with timeout protection
   *
   * Creates an AbortController to properly cancel timed-out requests.
   * Uses Promise.race to ensure timeout rejects even if provider doesn't respect signal.
   *
   * @private
   */
  private async tryProvider(
    provider: ICoverProvider,
    isbn: string,
    context: ServiceContext
  ): Promise<CoverAttempt> {
    const startTime = Date.now();
    const abortController = new AbortController();

    try {
      // Create timeout promise that rejects
      const timeoutPromise = new Promise<CoverResult | null>((_, reject) => {
        setTimeout(() => {
          abortController.abort(); // Abort HTTP requests
          reject(new Error('Provider timeout'));
        }, this.config.providerTimeoutMs);
      });

      // Create context with abort signal
      const contextWithSignal: ServiceContext = {
        ...context,
        signal: abortController.signal,
      };

      // Race between provider and timeout
      const result = await Promise.race([
        provider.fetchCover(isbn, contextWithSignal),
        timeoutPromise,
      ]);

      return {
        provider: provider.name,
        success: result !== null,
        url: result?.url ?? null,
        size: result?.size,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      // Check if error was due to timeout or abort
      if (
        error instanceof Error &&
        (error.message.includes('Provider timeout') ||
          error.message.includes('cancelled by caller'))
      ) {
        return {
          provider: provider.name,
          success: false,
          url: null,
          durationMs: Date.now() - startTime,
          error: 'Provider timeout (request cancelled)',
        };
      }

      return {
        provider: provider.name,
        success: false,
        url: null,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Order providers by priority
   *
   * Strategy:
   * - If custom order provided, use it
   * - Otherwise: free providers first (to save quota), then paid
   *
   * @private
   */
  private orderProviders(
    providers: ICoverProvider[],
    _context: ServiceContext
  ): ICoverProvider[] {
    // If custom order specified, use it
    if (this.config.providerOrder.length > 0) {
      return this.sortByCustomOrder(providers, this.config.providerOrder);
    }

    // Default ordering: free first to preserve quota
    return providers.sort((a, b) => {
      // Free providers first
      if (a.providerType === 'free' && b.providerType !== 'free') return -1;
      if (a.providerType !== 'free' && b.providerType === 'free') return 1;

      // Within same tier, maintain existing order
      return 0;
    });
  }

  /**
   * Sort providers by custom order
   *
   * @private
   */
  private sortByCustomOrder(
    providers: ICoverProvider[],
    order: string[]
  ): ICoverProvider[] {
    const orderMap = new Map(order.map((name, index) => [name, index]));

    return providers.sort((a, b) => {
      const aIndex = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }
}
