/**
 * Public Domain Orchestrator
 *
 * Registry-based orchestrator for public domain detection using the Service Provider Framework.
 * Replaces hard-coded checks with dynamic provider discovery.
 *
 * Priority Chain:
 * 1. Google Books (free, API-verified, high confidence)
 * 2. Archive.org (free, heuristic-based on publication date)
 *
 * Features:
 * - Dynamic provider discovery via registry
 * - Free-first priority ordering (all PD checks are free)
 * - Timeout protection per provider (10s default)
 * - Smart result selection when multiple providers consulted
 * - Confidence-based conflict resolution (API-verified > heuristic)
 *
 * @module lib/external-services/orchestrators/public-domain-orchestrator
 */

import type { PublicDomainResult, IPublicDomainProvider } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Public Domain Orchestrator Configuration
 */
export interface PublicDomainConfig {
  /** Timeout per provider in milliseconds (default: 10000) */
  providerTimeoutMs?: number;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;

  /** Provider priority order (default: ['google-books', 'archive-org']) */
  providerPriority?: string[];

  /** Stop on first success or query all providers (default: true) */
  stopOnFirstSuccess?: boolean;

  /** Prefer free providers first (default: true - all PD checks are free) */
  preferFreeProviders?: boolean;
}

/**
 * Public domain check attempt result (internal tracking)
 */
interface PublicDomainAttempt {
  provider: string;
  success: boolean;
  result: PublicDomainResult | null;
  durationMs: number;
  error?: string;
}

// =================================================================================
// Public Domain Orchestrator
// =================================================================================

/**
 * Public Domain Orchestrator
 *
 * Uses Service Provider Registry for dynamic public domain detection with cascading fallback.
 * Prioritizes API-verified results over heuristic-based detection.
 *
 * Smart Result Selection:
 * - Prefer API-verified (Google Books) over heuristic (Archive.org)
 * - If both positive, prefer higher confidence
 * - If conflict (one says PD, other says not), prefer Google Books (API-verified)
 * - Return highest confidence result when multiple providers consulted
 *
 * @example
 * ```typescript
 * const registry = new ServiceProviderRegistry();
 * registry.register(new GoogleBooksProvider());
 * registry.register(new ArchiveOrgProvider());
 *
 * const orchestrator = new PublicDomainOrchestrator(registry);
 * const result = await orchestrator.checkPublicDomain(
 *   '9780486284736', // Vintage book
 *   { env, logger }
 * );
 *
 * if (result && result.isPublicDomain) {
 *   console.log(`Public domain (${result.reason}): ${result.downloadUrl || 'N/A'}`);
 * }
 * ```
 */
export class PublicDomainOrchestrator {
  private config: Required<PublicDomainConfig>;

  constructor(
    private registry: ServiceProviderRegistry,
    config: PublicDomainConfig = {}
  ) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? 10000,
      enableLogging: config.enableLogging ?? true,
      providerPriority: config.providerPriority ?? ['google-books', 'archive-org'],
      stopOnFirstSuccess: config.stopOnFirstSuccess ?? true,
      preferFreeProviders: config.preferFreeProviders ?? true,
    };
  }

  /**
   * Check if book is in public domain
   *
   * Tries providers in priority order (API-verified first) until success or all fail.
   * If stopOnFirstSuccess=false, queries all providers and returns best result.
   *
   * @param isbn - ISBN-13 to check
   * @param context - Service context (env, logger)
   * @returns Public domain result with confidence and reason, or null if all fail
   */
  async checkPublicDomain(
    isbn: string,
    context: ServiceContext
  ): Promise<PublicDomainResult | null> {
    const { logger } = context;
    const startTime = Date.now();
    const attempts: PublicDomainAttempt[] = [];

    try {
      // Get available public domain providers from registry
      const providers = await this.registry.getAvailableProviders<IPublicDomainProvider>(
        ServiceCapability.PUBLIC_DOMAIN,
        context
      );

      if (providers.length === 0) {
        logger.warn('No public domain providers available');
        return null;
      }

      // Order providers (free-first by default, or custom priority)
      const orderedProviders = this.orderProviders(providers, context);

      if (this.config.enableLogging) {
        logger.info('Starting public domain check', {
          isbn,
          availableProviders: orderedProviders.map(p => p.name),
          stopOnFirstSuccess: this.config.stopOnFirstSuccess,
        });
      }

      // Try each provider
      for (const provider of orderedProviders) {
        const attempt = await this.tryProvider(provider, isbn, context);
        attempts.push(attempt);

        // If stopOnFirstSuccess and we got a result, return immediately
        if (this.config.stopOnFirstSuccess && attempt.success && attempt.result) {
          if (this.config.enableLogging) {
            logger.info('Public domain check completed', {
              isbn,
              provider: attempt.provider,
              isPublicDomain: attempt.result.isPublicDomain,
              confidence: attempt.result.confidence,
              reason: attempt.result.reason,
              durationMs: attempt.durationMs,
              totalDurationMs: Date.now() - startTime,
              attemptedProviders: attempts.length,
            });
          }

          return attempt.result;
        }

        // Log progress and continue
        if (this.config.enableLogging) {
          logger.debug('Provider attempt completed', {
            provider: attempt.provider,
            success: attempt.success,
            error: attempt.error,
            remainingProviders: orderedProviders.length - attempts.length,
          });
        }
      }

      // All providers attempted - select best result
      const bestResult = this.selectBestResult(attempts);

      if (bestResult) {
        if (this.config.enableLogging) {
          logger.info('Public domain check completed (best result)', {
            isbn,
            selectedProvider: bestResult.source,
            isPublicDomain: bestResult.isPublicDomain,
            confidence: bestResult.confidence,
            reason: bestResult.reason,
            totalDurationMs: Date.now() - startTime,
            attemptedProviders: attempts.length,
          });
        }

        return bestResult;
      }

      // All providers failed
      if (this.config.enableLogging) {
        logger.warn('All public domain providers failed', {
          isbn,
          attemptedProviders: attempts.length,
          totalDurationMs: Date.now() - startTime,
        });
      }

      return null;
    } catch (error) {
      logger.error('Public domain orchestrator error', {
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
    provider: IPublicDomainProvider,
    isbn: string,
    context: ServiceContext
  ): Promise<PublicDomainAttempt> {
    const startTime = Date.now();
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      // Create timeout promise that rejects
      const timeoutPromise = new Promise<PublicDomainResult | null>((_, reject) => {
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
        provider.checkPublicDomain(isbn, contextWithSignal),
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
   * Order providers by priority
   *
   * Strategy:
   * - If custom priority order provided, use it
   * - If preferFreeProviders=true (default), prioritize free providers
   * - Otherwise maintain registry order
   *
   * Default priority: Google Books (API-verified) > Archive.org (heuristic)
   *
   * @private
   */
  private orderProviders(
    providers: IPublicDomainProvider[],
    _context: ServiceContext
  ): IPublicDomainProvider[] {
    // If custom priority specified, use it
    if (this.config.providerPriority.length > 0) {
      return this.sortByCustomOrder(providers, this.config.providerPriority);
    }

    // Free providers first (default - all PD checks are free)
    if (this.config.preferFreeProviders) {
      return providers.sort((a, b) => {
        // Free providers first
        if (a.providerType === 'free' && b.providerType !== 'free') return -1;
        if (a.providerType !== 'free' && b.providerType === 'free') return 1;

        // Within same tier, maintain existing order
        return 0;
      });
    }

    // Use registry order as-is
    return providers;
  }

  /**
   * Sort providers by custom priority order
   *
   * @private
   */
  private sortByCustomOrder(
    providers: IPublicDomainProvider[],
    order: string[]
  ): IPublicDomainProvider[] {
    const orderMap = new Map(order.map((name, index) => [name, index]));

    return providers.sort((a, b) => {
      const aIndex = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }

  /**
   * Select best result from multiple provider attempts
   *
   * Selection logic:
   * 1. Prefer API-verified (reason='api-verified') over heuristic (reason='publication-date')
   * 2. If both API-verified or both heuristic, prefer higher confidence
   * 3. If conflict (one says PD, other says not), prefer API-verified result
   * 4. Return null if all attempts failed
   *
   * This ensures we trust Google Books (API-verified) over Archive.org (publication-date heuristic)
   * when they disagree.
   *
   * @private
   */
  private selectBestResult(
    attempts: PublicDomainAttempt[]
  ): PublicDomainResult | null {
    // Filter successful attempts with results
    const successfulAttempts = attempts.filter(
      (a): a is PublicDomainAttempt & { result: PublicDomainResult } =>
        a.success && a.result !== null
    );

    if (successfulAttempts.length === 0) {
      return null;
    }

    // Sort by preference: API-verified > heuristic, then by confidence
    const sorted = successfulAttempts.sort((a, b) => {
      const aIsApiVerified = a.result.reason === 'api-verified';
      const bIsApiVerified = b.result.reason === 'api-verified';

      // Prefer API-verified results
      if (aIsApiVerified && !bIsApiVerified) return -1;
      if (!aIsApiVerified && bIsApiVerified) return 1;

      // Within same verification tier, prefer higher confidence
      return b.result.confidence - a.result.confidence;
    });

    return sorted[0].result;
  }
}
