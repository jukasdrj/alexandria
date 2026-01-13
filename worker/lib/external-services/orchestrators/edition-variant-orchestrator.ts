/**
 * Edition Variant Orchestrator
 *
 * Registry-based orchestrator for discovering edition variants using the Service Provider Framework.
 * Finds related ISBNs representing different formats, editions, and translations of the same work.
 *
 * Priority Chain:
 * 1. ISBNdb (paid, quota-protected, highest quality format metadata)
 * 2. LibraryThing (free, community-validated, excellent coverage)
 * 3. Wikidata (free, comprehensive but may require work ID lookup)
 *
 * Features:
 * - Dynamic provider discovery via registry
 * - Automatic quota-aware provider selection
 * - Timeout protection per provider (10s default)
 * - Deduplication of ISBNs across providers
 * - Aggregation mode for comprehensive variant discovery
 * - Observability logging for optimization
 *
 * @module lib/external-services/orchestrators/edition-variant-orchestrator
 */

import type { EditionVariant, IEditionVariantProvider } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Edition Variant Orchestrator Configuration
 */
export interface EditionVariantOrchestratorConfig {
  /** Timeout per provider in milliseconds (default: 10000) */
  providerTimeoutMs?: number;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;

  /** Provider priority order (default: ['isbndb', 'librarything', 'wikidata']) */
  providerPriority?: string[];

  /** Stop on first successful result (default: false - aggregate from all providers) */
  stopOnFirstSuccess?: boolean;

  /** Deduplicate variants by ISBN (default: true) */
  deduplicateByIsbn?: boolean;
}

/**
 * Edition variant fetch attempt result (internal tracking)
 */
interface EditionVariantAttempt {
  provider: string;
  success: boolean;
  variants: EditionVariant[];
  durationMs: number;
  error?: string;
}

// =================================================================================
// Edition Variant Orchestrator
// =================================================================================

/**
 * Edition Variant Orchestrator
 *
 * Uses Service Provider Registry for dynamic edition variant discovery with aggregation.
 * Automatically selects providers based on quota availability and capability.
 *
 * Unlike other orchestrators, this one defaults to aggregating results from ALL providers
 * to maximize edition coverage (stopOnFirstSuccess=false by default).
 *
 * @example
 * ```typescript
 * const registry = new ServiceProviderRegistry();
 * registry.register(new ISBNdbProvider());
 * registry.register(new LibraryThingProvider());
 *
 * const orchestrator = new EditionVariantOrchestrator(registry);
 * const variants = await orchestrator.fetchEditionVariants(
 *   '9780547928227', // The Hobbit
 *   { env, logger }
 * );
 *
 * console.log(`Found ${variants.length} edition variants`);
 * for (const variant of variants) {
 *   console.log(`${variant.isbn} - ${variant.format} (${variant.source})`);
 * }
 * ```
 */
export class EditionVariantOrchestrator {
  private config: Required<EditionVariantOrchestratorConfig>;

  constructor(
    private registry: ServiceProviderRegistry,
    config: EditionVariantOrchestratorConfig = {}
  ) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? 10000,
      enableLogging: config.enableLogging ?? true,
      providerPriority: config.providerPriority ?? ['isbndb', 'librarything', 'wikidata'],
      stopOnFirstSuccess: config.stopOnFirstSuccess ?? false, // Default: aggregate from all
      deduplicateByIsbn: config.deduplicateByIsbn ?? true,
    };
  }

  /**
   * Fetch edition variants for a single ISBN
   *
   * Tries providers in priority order. By default, aggregates results from ALL providers
   * for comprehensive edition coverage. Set stopOnFirstSuccess=true for first-match behavior.
   *
   * @param isbn - ISBN-13 to fetch edition variants for
   * @param context - Service context (env, logger, quotaManager)
   * @returns Array of edition variants (empty if none found)
   */
  async fetchEditionVariants(
    isbn: string,
    context: ServiceContext
  ): Promise<EditionVariant[]> {
    const { logger } = context;
    const startTime = Date.now();
    const attempts: EditionVariantAttempt[] = [];
    const aggregatedVariants = new Map<string, EditionVariant>(); // ISBN → Variant

    try {
      // Get available edition variant providers from registry
      const providers = await this.registry.getAvailableProviders<IEditionVariantProvider>(
        ServiceCapability.EDITION_VARIANTS,
        context
      );

      if (providers.length === 0) {
        logger.warn('No edition variant providers available');
        return [];
      }

      // Order providers by priority
      const orderedProviders = this.orderProviders(providers, context);

      if (this.config.enableLogging) {
        logger.info('Starting edition variant fetch', {
          isbn,
          availableProviders: orderedProviders.map(p => p.name),
          aggregateMode: !this.config.stopOnFirstSuccess,
        });
      }

      // Try each provider
      for (const provider of orderedProviders) {
        const attempt = await this.tryProvider(provider, isbn, context);
        attempts.push(attempt);

        if (attempt.success && attempt.variants.length > 0) {
          // Aggregate variants (deduplicate by ISBN)
          for (const variant of attempt.variants) {
            if (this.config.deduplicateByIsbn) {
              // Keep variant from highest-priority provider
              if (!aggregatedVariants.has(variant.isbn)) {
                aggregatedVariants.set(variant.isbn, variant);
              }
            } else {
              // Keep all variants (even duplicates from different sources)
              aggregatedVariants.set(`${variant.isbn}-${provider.name}`, variant);
            }
          }

          if (this.config.enableLogging) {
            logger.debug('Edition variants fetched from provider', {
              provider: attempt.provider,
              variantCount: attempt.variants.length,
              totalAggregated: aggregatedVariants.size,
              durationMs: attempt.durationMs,
            });
          }

          // Stop if configured (uncommon for edition variants)
          if (this.config.stopOnFirstSuccess) {
            logger.info('Edition variants fetched (first match)', {
              isbn,
              provider: attempt.provider,
              variantCount: attempt.variants.length,
              durationMs: attempt.durationMs,
              totalDurationMs: Date.now() - startTime,
            });
            return attempt.variants;
          }
        } else if (this.config.enableLogging && !attempt.success) {
          logger.debug('Edition variant provider failed, trying next', {
            provider: attempt.provider,
            error: attempt.error,
            remainingProviders: orderedProviders.length - attempts.length,
          });
        }
      }

      // Return aggregated results
      const finalVariants = Array.from(aggregatedVariants.values());

      if (this.config.enableLogging) {
        const successfulProviders = attempts.filter(a => a.success && a.variants.length > 0);
        logger.info('Edition variant aggregation complete', {
          isbn,
          totalVariants: finalVariants.length,
          providersUsed: successfulProviders.map(a => a.provider),
          attemptedProviders: attempts.length,
          totalDurationMs: Date.now() - startTime,
        });
      }

      return finalVariants;
    } catch (error) {
      logger.error('Edition variant orchestrator error', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
        attempts: attempts.length,
      });
      return [];
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
    provider: IEditionVariantProvider,
    isbn: string,
    context: ServiceContext
  ): Promise<EditionVariantAttempt> {
    const startTime = Date.now();
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      // Create timeout promise that rejects
      const timeoutPromise = new Promise<EditionVariant[]>((_, reject) => {
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
      const variants = await Promise.race([
        provider.fetchEditionVariants(isbn, contextWithSignal),
        timeoutPromise,
      ]);

      return {
        provider: provider.name,
        success: variants.length > 0,
        variants,
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
          variants: [],
          durationMs: Date.now() - startTime,
          error: 'Provider timeout (request cancelled)',
        };
      }

      return {
        provider: provider.name,
        success: false,
        variants: [],
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
   * - If custom order provided, use it
   * - Otherwise: paid providers first (if quota available), then free providers
   *
   * @private
   */
  private orderProviders(
    providers: IEditionVariantProvider[],
    _context: ServiceContext
  ): IEditionVariantProvider[] {
    // If custom order specified, use it
    if (this.config.providerPriority.length > 0) {
      return this.sortByCustomOrder(providers, this.config.providerPriority);
    }

    // Default ordering: paid first (if quota), then free, then AI
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
    providers: IEditionVariantProvider[],
    order: string[]
  ): IEditionVariantProvider[] {
    const orderMap = new Map(order.map((name, index) => [name, index]));

    return providers.sort((a, b) => {
      const aIndex = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }
}
