/**
 * Ratings Orchestrator
 *
 * Registry-based orchestrator for book ratings using the Service Provider Framework.
 * Replaces hard-coded provider chains with dynamic discovery.
 *
 * Priority Chain:
 * 1. ISBNdb (paid, quota-protected, highest accuracy)
 * 2. Google Books (free, good coverage)
 * 3. OpenLibrary (free, community ratings)
 * 4. Wikidata (free, aggregated data)
 *
 * Features:
 * - Dynamic provider discovery via registry
 * - Automatic quota-aware provider selection
 * - Timeout protection per provider (10s default)
 * - Batch operations with fallback to sequential
 * - Observability logging for optimization
 *
 * @module lib/external-services/orchestrators/ratings-orchestrator
 */

import type { RatingsResult, IRatingsProvider } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Ratings Orchestrator Configuration
 */
export interface RatingsOrchestratorConfig {
  /** Timeout per provider in milliseconds (default: 10000) */
  providerTimeoutMs?: number;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;

  /** Provider priority order (default: ['isbndb', 'google-books', 'open-library', 'wikidata']) */
  providerPriority?: string[];

  /** Stop on first successful result (default: true) */
  stopOnFirstSuccess?: boolean;
}

/**
 * Ratings fetch attempt result (internal tracking)
 */
interface RatingsAttempt {
  provider: string;
  success: boolean;
  result: RatingsResult | null;
  durationMs: number;
  error?: string;
}

// =================================================================================
// Ratings Orchestrator
// =================================================================================

/**
 * Ratings Orchestrator
 *
 * Uses Service Provider Registry for dynamic ratings fetching with cascading fallback.
 * Automatically selects providers based on quota availability and capability.
 *
 * @example
 * ```typescript
 * const registry = new ServiceProviderRegistry();
 * registry.register(new ISBNdbProvider());
 * registry.register(new GoogleBooksProvider());
 *
 * const orchestrator = new RatingsOrchestrator(registry);
 * const result = await orchestrator.fetchRatings(
 *   '9780385544153',
 *   { env, logger }
 * );
 *
 * if (result) {
 *   console.log(`Rating: ${result.averageRating}/5.0 (${result.ratingsCount} ratings)`);
 *   console.log(`Source: ${result.source}`);
 * }
 * ```
 */
export class RatingsOrchestrator {
  private config: Required<RatingsOrchestratorConfig>;

  constructor(
    private registry: ServiceProviderRegistry,
    config: RatingsOrchestratorConfig = {}
  ) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? 10000,
      enableLogging: config.enableLogging ?? true,
      providerPriority: config.providerPriority ?? ['isbndb', 'google-books', 'open-library', 'wikidata'],
      stopOnFirstSuccess: config.stopOnFirstSuccess ?? true,
    };
  }

  /**
   * Fetch ratings for a single ISBN
   *
   * Tries providers in priority order until success or all fail.
   * Paid providers checked for quota before attempting.
   *
   * @param isbn - ISBN-13 to fetch ratings for
   * @param context - Service context (env, logger, quotaManager)
   * @returns Ratings result with source provider, or null if not found
   */
  async fetchRatings(
    isbn: string,
    context: ServiceContext
  ): Promise<RatingsResult | null> {
    const { logger } = context;
    const startTime = Date.now();
    const attempts: RatingsAttempt[] = [];

    try {
      // Get available ratings providers from registry
      const providers = await this.registry.getAvailableProviders<IRatingsProvider>(
        ServiceCapability.RATINGS,
        context
      );

      if (providers.length === 0) {
        logger.warn('No ratings providers available');
        return null;
      }

      // Order providers by priority
      const orderedProviders = this.orderProviders(providers, context);

      if (this.config.enableLogging) {
        logger.info('Starting ratings fetch', {
          isbn,
          availableProviders: orderedProviders.map(p => p.name),
        });
      }

      // Try each provider until success (or all if stopOnFirstSuccess=false)
      for (const provider of orderedProviders) {
        const attempt = await this.tryProvider(provider, isbn, context);
        attempts.push(attempt);

        if (attempt.success && attempt.result) {
          // Success! Log and return (unless configured to continue)
          if (this.config.enableLogging) {
            logger.info('Ratings fetched successfully', {
              isbn,
              provider: attempt.provider,
              averageRating: attempt.result.averageRating,
              ratingsCount: attempt.result.ratingsCount,
              confidence: attempt.result.confidence,
              durationMs: attempt.durationMs,
              totalDurationMs: Date.now() - startTime,
              attemptedProviders: attempts.length,
            });
          }

          if (this.config.stopOnFirstSuccess) {
            return attempt.result;
          }
        }

        // Log failure and continue to next provider
        if (this.config.enableLogging && !attempt.success) {
          logger.debug('Ratings provider failed, trying next', {
            provider: attempt.provider,
            error: attempt.error,
            remainingProviders: orderedProviders.length - attempts.length,
          });
        }
      }

      // If stopOnFirstSuccess=false, return best result (highest confidence)
      if (!this.config.stopOnFirstSuccess) {
        const successfulAttempts = attempts.filter(a => a.success && a.result);
        if (successfulAttempts.length > 0) {
          const best = successfulAttempts.reduce((prev, current) =>
            (current.result!.confidence > prev.result!.confidence) ? current : prev
          );

          if (this.config.enableLogging) {
            logger.info('Ratings aggregation complete', {
              isbn,
              bestProvider: best.provider,
              totalProviders: successfulAttempts.length,
              averageRating: best.result!.averageRating,
              ratingsCount: best.result!.ratingsCount,
              confidence: best.result!.confidence,
              totalDurationMs: Date.now() - startTime,
            });
          }

          return best.result;
        }
      }

      // All providers failed
      if (this.config.enableLogging) {
        logger.warn('All ratings providers failed', {
          isbn,
          attemptedProviders: attempts.length,
          totalDurationMs: Date.now() - startTime,
          attempts: attempts.map(a => ({ provider: a.provider, error: a.error })),
        });
      }

      return null;
    } catch (error) {
      logger.error('Ratings orchestrator error', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
        attempts: attempts.length,
      });
      return null;
    }
  }

  /**
   * Batch fetch ratings for multiple ISBNs
   *
   * Uses provider batch methods when available, falls back to sequential single fetches.
   * Aggregates results from all providers when stopOnFirstSuccess=false.
   *
   * @param isbns - Array of ISBN-13s to fetch ratings for
   * @param context - Service context (env, logger, quotaManager)
   * @returns Map of ISBN to ratings result (only successful fetches)
   */
  async batchFetchRatings(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, RatingsResult>> {
    const { logger } = context;
    const startTime = Date.now();
    const aggregated = new Map<string, RatingsResult>();

    try {
      // Get available ratings providers from registry
      const providers = await this.registry.getAvailableProviders<IRatingsProvider>(
        ServiceCapability.RATINGS,
        context
      );

      if (providers.length === 0) {
        logger.warn('No ratings providers available for batch fetch');
        return aggregated;
      }

      // Order providers by priority
      const orderedProviders = this.orderProviders(providers, context);

      if (this.config.enableLogging) {
        logger.info('Starting batch ratings fetch', {
          isbnCount: isbns.length,
          availableProviders: orderedProviders.map(p => p.name),
        });
      }

      // Track which ISBNs still need ratings (for stopOnFirstSuccess mode)
      const remainingIsbns = new Set(isbns);

      // Try each provider
      for (const provider of orderedProviders) {
        if (remainingIsbns.size === 0 && this.config.stopOnFirstSuccess) {
          // All ISBNs resolved, stop if configured
          break;
        }

        const providerStartTime = Date.now();
        let providerResults: Map<string, RatingsResult>;

        try {
          // Use batch method if available
          if (provider.batchFetchRatings) {
            const abortController = new AbortController();
            let timeoutId: NodeJS.Timeout | undefined;

            const contextWithSignal: ServiceContext = {
              ...context,
              signal: abortController.signal,
            };

            try {
              timeoutId = setTimeout(() => {
                abortController.abort();
              }, this.config.providerTimeoutMs);

              const targetIsbns = this.config.stopOnFirstSuccess
                ? Array.from(remainingIsbns)
                : isbns;

              providerResults = await provider.batchFetchRatings(targetIsbns, contextWithSignal);
            } finally {
              if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
              }
            }
          } else {
            // Fallback to sequential single fetches
            providerResults = await this.sequentialFetch(
              provider,
              this.config.stopOnFirstSuccess ? Array.from(remainingIsbns) : isbns,
              context
            );
          }

          // Aggregate results
          for (const [isbn, result] of providerResults.entries()) {
            if (!aggregated.has(isbn) || result.confidence > aggregated.get(isbn)!.confidence) {
              aggregated.set(isbn, result);
              remainingIsbns.delete(isbn);
            }
          }

          if (this.config.enableLogging) {
            logger.debug('Batch provider completed', {
              provider: provider.name,
              resultCount: providerResults.size,
              remainingIsbns: remainingIsbns.size,
              durationMs: Date.now() - providerStartTime,
            });
          }
        } catch (error) {
          logger.error('Batch provider failed', {
            provider: provider.name,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - providerStartTime,
          });
          // Continue to next provider
        }
      }

      if (this.config.enableLogging) {
        logger.info('Batch ratings fetch complete', {
          isbnCount: isbns.length,
          resolvedCount: aggregated.size,
          totalDurationMs: Date.now() - startTime,
        });
      }

      return aggregated;
    } catch (error) {
      logger.error('Batch ratings orchestrator error', {
        isbnCount: isbns.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return aggregated;
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
    provider: IRatingsProvider,
    isbn: string,
    context: ServiceContext
  ): Promise<RatingsAttempt> {
    const startTime = Date.now();
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      // Create timeout promise that rejects
      const timeoutPromise = new Promise<RatingsResult | null>((_, reject) => {
        timeoutId = setTimeout(() => {
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
        provider.fetchRatings(isbn, contextWithSignal),
        timeoutPromise,
      ]);

      return {
        provider: provider.name,
        success: result !== null,
        result,
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
          result: null,
          durationMs: Date.now() - startTime,
          error: 'Provider timeout (request cancelled)',
        };
      }

      return {
        provider: provider.name,
        success: false,
        result: null,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // CRITICAL: Always clear timeout to prevent resource leak
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Sequential fetch for providers without batch support
   *
   * @private
   */
  private async sequentialFetch(
    provider: IRatingsProvider,
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, RatingsResult>> {
    const results = new Map<string, RatingsResult>();

    for (const isbn of isbns) {
      const attempt = await this.tryProvider(provider, isbn, context);
      if (attempt.success && attempt.result) {
        results.set(isbn, attempt.result);
      }
    }

    return results;
  }

  /**
   * Order providers by priority
   *
   * Strategy:
   * - If custom order provided, use it
   * - Otherwise: paid providers first (if quota available), then free providers
   *
   * @private
   */
  private orderProviders(
    providers: IRatingsProvider[],
    _context: ServiceContext
  ): IRatingsProvider[] {
    // If custom order specified, use it
    if (this.config.providerPriority.length > 0) {
      return this.sortByCustomOrder(providers, this.config.providerPriority);
    }

    // Default ordering: paid first (if quota), then free
    return providers.sort((a, b) => {
      // Paid providers first
      if (a.providerType === 'paid' && b.providerType !== 'paid') return -1;
      if (a.providerType !== 'paid' && b.providerType === 'paid') return 1;

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
    providers: IRatingsProvider[],
    order: string[]
  ): IRatingsProvider[] {
    const orderMap = new Map(order.map((name, index) => [name, index]));

    return providers.sort((a, b) => {
      const aIndex = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }
}
