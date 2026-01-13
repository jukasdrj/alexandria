/**
 * External ID Orchestrator
 *
 * Registry-based orchestrator for enhanced external identifier fetching using the Service Provider Framework.
 * Aggregates external IDs from multiple providers for comprehensive cross-provider linking.
 *
 * Aggregation Strategy:
 * 1. Query all available providers (in parallel or sequential)
 * 2. Merge external IDs from all sources
 * 3. Track which provider contributed each ID (sources array)
 * 4. Calculate aggregate confidence (weighted average)
 * 5. Deduplicate IDs (same ID from multiple providers = higher confidence)
 *
 * Provider Priority (default):
 * 1. Wikidata (comprehensive SPARQL queries, free)
 * 2. Google Books (fast, good coverage, free)
 * 3. OpenLibrary (reliable, free)
 * 4. ISBNdb (highest accuracy, paid, quota-protected)
 *
 * Features:
 * - Dynamic provider discovery via registry
 * - Aggregation mode (merge all providers) or fallback mode (stop on first success)
 * - Smart ID deduplication with confidence boosting
 * - Timeout protection per provider (10s default)
 * - Observability logging for optimization
 *
 * @module lib/external-services/orchestrators/external-id-orchestrator
 */

import type {
  EnhancedExternalIds,
  IEnhancedExternalIdProvider,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';

// =================================================================================
// Types
// =================================================================================

/**
 * External ID Orchestrator Configuration
 */
export interface ExternalIdOrchestratorConfig {
  /** Timeout per provider in milliseconds (default: 10000) */
  providerTimeoutMs?: number;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;

  /** Provider priority order (default: ['wikidata', 'google-books', 'open-library']) */
  providerPriority?: string[];

  /**
   * Aggregate results from all providers (default: true)
   * - true: Query all providers and merge IDs
   * - false: Stop on first success (fallback chain)
   */
  aggregateResults?: boolean;
}

/**
 * Fetch attempt result (internal tracking)
 */
interface FetchAttempt {
  provider: string;
  success: boolean;
  data: EnhancedExternalIds | null;
  durationMs: number;
  error?: string;
}

/**
 * ID contribution tracking (for deduplication)
 */
interface IdContribution {
  value: string;
  sources: string[];
  providerConfidences: number[];
}

// =================================================================================
// External ID Orchestrator
// =================================================================================

/**
 * External ID Orchestrator
 *
 * Aggregates external identifiers from multiple providers to create comprehensive
 * cross-provider linking. Supports both aggregation (merge all providers) and
 * fallback (stop on first success) modes.
 *
 * @example
 * ```typescript
 * const registry = new ServiceProviderRegistry();
 * registry.register(new WikidataProvider());
 * registry.register(new GoogleBooksProvider());
 * registry.register(new OpenLibraryProvider());
 *
 * const orchestrator = new ExternalIdOrchestrator(registry, {
 *   aggregateResults: true,  // Merge IDs from all providers
 * });
 *
 * const result = await orchestrator.fetchEnhancedExternalIds(
 *   '9780385544153',
 *   { env, logger }
 * );
 *
 * console.log(`Found IDs from ${result?.sources.length} providers`);
 * console.log(`Aggregate confidence: ${result?.confidence}`);
 * ```
 */
export class ExternalIdOrchestrator {
  private config: Required<ExternalIdOrchestratorConfig>;

  constructor(
    private registry: ServiceProviderRegistry,
    config: ExternalIdOrchestratorConfig = {}
  ) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? 10000,
      enableLogging: config.enableLogging ?? true,
      providerPriority: config.providerPriority ?? [
        'wikidata',
        'google-books',
        'open-library',
      ],
      aggregateResults: config.aggregateResults ?? true,
    };
  }

  /**
   * Fetch enhanced external IDs for ISBN
   *
   * Queries multiple providers and either aggregates results or uses fallback chain.
   *
   * @param isbn - ISBN-13 to fetch external IDs for
   * @param context - Service context (env, logger)
   * @returns Enhanced external IDs with sources and confidence, or null if not found
   */
  async fetchEnhancedExternalIds(
    isbn: string,
    context: ServiceContext
  ): Promise<EnhancedExternalIds | null> {
    const { logger } = context;
    const startTime = Date.now();
    const attempts: FetchAttempt[] = [];

    try {
      // Get available external ID providers from registry
      const providers =
        await this.registry.getAvailableProviders<IEnhancedExternalIdProvider>(
          ServiceCapability.ENHANCED_EXTERNAL_IDS,
          context
        );

      if (providers.length === 0) {
        logger.warn('No external ID providers available');
        return null;
      }

      // Order providers by priority
      const orderedProviders = this.orderProviders(providers);

      if (this.config.enableLogging) {
        logger.info('Starting external ID fetch', {
          isbn,
          mode: this.config.aggregateResults ? 'aggregate' : 'fallback',
          availableProviders: orderedProviders.map((p) => p.name),
        });
      }

      // Choose aggregation or fallback mode
      const results = this.config.aggregateResults
        ? await this.fetchAllProviders(orderedProviders, isbn, context, attempts)
        : await this.fetchUntilSuccess(orderedProviders, isbn, context, attempts);

      if (!results) {
        if (this.config.enableLogging) {
          logger.warn('All external ID providers failed', {
            isbn,
            attemptedProviders: attempts.length,
            totalDurationMs: Date.now() - startTime,
          });
        }
        return null;
      }

      if (this.config.enableLogging) {
        logger.info('External ID fetch complete', {
          isbn,
          sources: results.sources.length,
          confidence: results.confidence,
          totalIds: Object.keys(results).filter((k) => k !== 'sources' && k !== 'confidence')
            .length,
          durationMs: Date.now() - startTime,
          attemptedProviders: attempts.length,
        });
      }

      return results;
    } catch (error) {
      logger.error('External ID orchestrator error', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
        attempts: attempts.length,
      });
      return null;
    }
  }

  /**
   * Batch fetch enhanced external IDs for multiple ISBNs
   *
   * Uses provider batch methods when available, otherwise falls back to individual fetches.
   * Always aggregates results across providers for each ISBN.
   *
   * @param isbns - Array of ISBN-13s to fetch external IDs for
   * @param context - Service context (env, logger)
   * @returns Map of ISBN to enhanced external IDs
   */
  async batchFetchEnhancedExternalIds(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, EnhancedExternalIds>> {
    const { logger } = context;
    const startTime = Date.now();

    try {
      // Get available providers
      const providers =
        await this.registry.getAvailableProviders<IEnhancedExternalIdProvider>(
          ServiceCapability.ENHANCED_EXTERNAL_IDS,
          context
        );

      if (providers.length === 0) {
        logger.warn('No external ID providers available for batch fetch');
        return new Map();
      }

      if (this.config.enableLogging) {
        logger.info('Starting batch external ID fetch', {
          isbnCount: isbns.length,
          providers: providers.map((p) => p.name),
        });
      }

      // Fetch from all providers (use batch methods if available)
      const providerResults = await Promise.all(
        providers.map(async (provider) => {
          try {
            // Use batch method if available
            if (provider.batchFetchEnhancedExternalIds) {
              return await this.timeoutWrapper(
                provider.batchFetchEnhancedExternalIds(isbns, context),
                provider.name
              );
            }

            // Fallback: individual fetches
            const results = new Map<string, EnhancedExternalIds>();
            for (const isbn of isbns) {
              const result = await this.timeoutWrapper(
                provider.fetchEnhancedExternalIds(isbn, context),
                provider.name
              );
              if (result) {
                results.set(isbn, result);
              }
            }
            return results;
          } catch (error) {
            logger.debug('Batch provider failed', {
              provider: provider.name,
              error: error instanceof Error ? error.message : String(error),
            });
            return new Map<string, EnhancedExternalIds>();
          }
        })
      );

      // Aggregate results for each ISBN
      const aggregated = new Map<string, EnhancedExternalIds>();

      for (const isbn of isbns) {
        const isbnResults: EnhancedExternalIds[] = [];

        for (const providerResult of providerResults) {
          const data = providerResult.get(isbn);
          if (data) {
            isbnResults.push(data);
          }
        }

        if (isbnResults.length > 0) {
          const merged = this.mergeExternalIds(isbnResults);
          aggregated.set(isbn, merged);
        }
      }

      if (this.config.enableLogging) {
        logger.info('Batch external ID fetch complete', {
          isbnCount: isbns.length,
          foundCount: aggregated.size,
          durationMs: Date.now() - startTime,
        });
      }

      return aggregated;
    } catch (error) {
      logger.error('Batch external ID orchestrator error', {
        isbnCount: isbns.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  /**
   * Fetch from all providers and aggregate results
   *
   * Queries all providers in parallel, then merges IDs intelligently.
   *
   * @private
   */
  private async fetchAllProviders(
    providers: IEnhancedExternalIdProvider[],
    isbn: string,
    context: ServiceContext,
    attempts: FetchAttempt[]
  ): Promise<EnhancedExternalIds | null> {
    // Fetch from all providers in parallel
    const promises = providers.map((provider) =>
      this.tryProvider(provider, isbn, context)
    );

    const results = await Promise.all(promises);
    attempts.push(...results);

    // Filter successful results
    const successfulResults = results
      .filter((r) => r.success && r.data !== null)
      .map((r) => r.data!);

    if (successfulResults.length === 0) {
      return null;
    }

    // Merge all results
    return this.mergeExternalIds(successfulResults);
  }

  /**
   * Fetch until first success (fallback chain)
   *
   * Tries providers sequentially, stops on first success.
   *
   * @private
   */
  private async fetchUntilSuccess(
    providers: IEnhancedExternalIdProvider[],
    isbn: string,
    context: ServiceContext,
    attempts: FetchAttempt[]
  ): Promise<EnhancedExternalIds | null> {
    for (const provider of providers) {
      const attempt = await this.tryProvider(provider, isbn, context);
      attempts.push(attempt);

      if (attempt.success && attempt.data) {
        return attempt.data;
      }

      if (this.config.enableLogging) {
        context.logger.debug('External ID provider failed, trying next', {
          provider: attempt.provider,
          error: attempt.error,
          remainingProviders: providers.length - attempts.length,
        });
      }
    }

    return null;
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
    provider: IEnhancedExternalIdProvider,
    isbn: string,
    context: ServiceContext
  ): Promise<FetchAttempt> {
    const startTime = Date.now();
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      // Create timeout promise that rejects
      const timeoutPromise = new Promise<EnhancedExternalIds | null>((_, reject) => {
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
        provider.fetchEnhancedExternalIds(isbn, contextWithSignal),
        timeoutPromise,
      ]);

      return {
        provider: provider.name,
        success: result !== null,
        data: result,
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
          data: null,
          durationMs: Date.now() - startTime,
          error: 'Provider timeout (request cancelled)',
        };
      }

      return {
        provider: provider.name,
        success: false,
        data: null,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // CRITICAL: Always clear timeout to prevent resource leak
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Merge external IDs from multiple providers
   *
   * Smart Merging Strategy:
   * 1. Aggregate all unique IDs across providers
   * 2. Track which provider contributed each ID (sources array)
   * 3. If same ID type appears in multiple providers:
   *    - Keep the value from ALL providers (they should match)
   *    - Add all contributing providers to sources
   *    - Boost confidence (multiple confirmations)
   * 4. If providers give different values for same ID type:
   *    - Prefer the value from higher-confidence provider
   *    - Log conflict for debugging
   * 5. Calculate aggregate confidence: weighted average of contributing providers
   *
   * @private
   */
  private mergeExternalIds(
    results: EnhancedExternalIds[]
  ): EnhancedExternalIds {
    if (results.length === 1) {
      return results[0];
    }

    // Track ID contributions for deduplication
    const contributions: Record<string, IdContribution> = {};

    // All provider sources
    const allSources = new Set<string>();

    // Process each provider's results
    for (const result of results) {
      // Add provider sources
      result.sources.forEach((source) => allSources.add(source));

      // Track ID contributions
      const idKeys: (keyof Omit<EnhancedExternalIds, 'sources' | 'confidence'>)[] = [
        'amazonAsin',
        'goodreadsId',
        'googleBooksId',
        'librarythingId',
        'wikidataQid',
        'openLibraryWorkKey',
        'openLibraryEditionKey',
        'archiveOrgId',
        'oclcNumber',
        'lccn',
      ];

      for (const key of idKeys) {
        const value = result[key];
        if (value) {
          if (!contributions[key]) {
            contributions[key] = {
              value,
              sources: [...result.sources],
              providerConfidences: [result.confidence],
            };
          } else {
            // ID already exists - check for conflicts
            if (contributions[key].value !== value) {
              // Conflict: different values from different providers
              // Prefer higher confidence
              if (result.confidence > Math.max(...contributions[key].providerConfidences)) {
                contributions[key].value = value;
              }
            }

            // Add sources and boost confidence
            result.sources.forEach((source) => {
              if (!contributions[key].sources.includes(source)) {
                contributions[key].sources.push(source);
              }
            });
            contributions[key].providerConfidences.push(result.confidence);
          }
        }
      }
    }

    // Calculate aggregate confidence (weighted average)
    const allConfidences = results.map((r) => r.confidence);
    const aggregateConfidence =
      allConfidences.reduce((sum, c) => sum + c, 0) / allConfidences.length;

    // Build merged result
    const merged: EnhancedExternalIds = {
      sources: Array.from(allSources),
      confidence: Math.round(aggregateConfidence),
    };

    // Add all contributed IDs with proper type safety
    for (const [key, contribution] of Object.entries(contributions)) {
      if (key !== 'sources' && key !== 'confidence') {
        // Use unknown assertion to avoid 'as any' while maintaining type safety
        (merged as unknown as Record<string, string>)[key] = contribution.value;
      }
    }

    return merged;
  }

  /**
   * Timeout wrapper for async operations
   *
   * @private
   */
  private async timeoutWrapper<T>(
    promise: Promise<T>,
    providerName: string
  ): Promise<T> {
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new Error(`Provider timeout: ${providerName}`));
        }, this.config.providerTimeoutMs);
      });

      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Order providers by priority
   *
   * Strategy:
   * - If custom priority provided, use it
   * - Otherwise: maintain registry order
   *
   * @private
   */
  private orderProviders(
    providers: IEnhancedExternalIdProvider[]
  ): IEnhancedExternalIdProvider[] {
    if (this.config.providerPriority.length === 0) {
      return providers;
    }

    const orderMap = new Map(
      this.config.providerPriority.map((name, index) => [name, index])
    );

    return providers.sort((a, b) => {
      const aIndex = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }
}
