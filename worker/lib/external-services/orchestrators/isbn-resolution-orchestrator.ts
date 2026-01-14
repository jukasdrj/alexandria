/**
 * ISBN Resolution Orchestrator
 *
 * Registry-based orchestrator for ISBN resolution using the Service Provider Framework.
 * Replaces hard-coded fallback chains with dynamic provider discovery.
 *
 * Fallback Strategy:
 * 1. ISBNdb (paid, quota-limited) - highest accuracy
 * 2. Google Books (free) - fast, good coverage
 * 3. OpenLibrary (free) - reliable fallback
 * 4. Archive.org (free) - excellent for pre-2000 books
 * 5. Wikidata (free) - comprehensive SPARQL queries (slowest)
 *
 * Features:
 * - Dynamic provider discovery via registry
 * - Automatic quota-aware provider selection
 * - Timeout protection per provider (15s default)
 * - Observability logging for optimization
 *
 * @module lib/external-services/orchestrators/isbn-resolution-orchestrator
 */

import type { ISBNResolutionResult, IISBNResolver } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';
import { trackOrchestratorFallback } from '../analytics.js';

// =================================================================================
// Types
// =================================================================================

/**
 * ISBN Resolution Orchestrator Configuration
 */
export interface ISBNResolutionConfig {
  /** Timeout per provider in milliseconds (default: 15000) */
  providerTimeoutMs?: number;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;

  /** Provider priority order (default: quota-aware auto-ordering) */
  providerOrder?: string[];
}

/**
 * Resolution attempt result (internal tracking)
 */
interface ResolutionAttempt {
  provider: string;
  success: boolean;
  isbn: string | null;
  confidence: number;
  durationMs: number;
  error?: string;
}

// =================================================================================
// ISBN Resolution Orchestrator
// =================================================================================

/**
 * ISBN Resolution Orchestrator
 *
 * Uses Service Provider Registry for dynamic ISBN resolution with cascading fallback.
 * Automatically selects providers based on quota availability and capability.
 *
 * @example
 * ```typescript
 * const registry = new ServiceProviderRegistry();
 * registry.register(new ISBNdbProvider());
 * registry.register(new OpenLibraryProvider());
 *
 * const orchestrator = new ISBNResolutionOrchestrator(registry);
 * const result = await orchestrator.resolveISBN(
 *   'The Splendid and the Vile',
 *   'Erik Larson',
 *   { env, logger, quotaManager }
 * );
 *
 * if (result.isbn) {
 *   console.log(`Resolved via ${result.source}: ${result.isbn}`);
 * }
 * ```
 */
export class ISBNResolutionOrchestrator {
  private config: Required<ISBNResolutionConfig>;

  constructor(
    private registry: ServiceProviderRegistry,
    config: ISBNResolutionConfig = {}
  ) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? 15000,
      enableLogging: config.enableLogging ?? true,
      providerOrder: config.providerOrder ?? [], // Empty = auto-order by quota
    };
  }

  /**
   * Resolve ISBN from title and author
   *
   * Tries providers in priority order until success or all fail.
   * Paid providers checked for quota before attempting.
   *
   * @param title - Book title
   * @param author - Author name
   * @param context - Service context (env, logger, quotaManager)
   * @returns ISBN resolution result with source provider
   */
  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const { logger } = context;
    const startTime = Date.now();
    const attempts: ResolutionAttempt[] = [];

    try {
      // Get available ISBN resolvers from registry
      const resolvers = await this.registry.getAvailableProviders<IISBNResolver>(
        ServiceCapability.ISBN_RESOLUTION,
        context
      );

      if (resolvers.length === 0) {
        logger.warn('No ISBN resolvers available');
        return { isbn: null, confidence: 0, source: 'none' };
      }

      // Order providers by priority (paid first if quota available, then free)
      const orderedResolvers = this.orderProviders(resolvers, context);

      if (this.config.enableLogging) {
        logger.info('Starting ISBN resolution', {
          title,
          author,
          availableResolvers: orderedResolvers.map(r => r.name),
        });
      }

      // Try each resolver until success
      for (const resolver of orderedResolvers) {
        const attempt = await this.tryResolver(resolver, title, author, context);
        attempts.push(attempt);

        if (attempt.success && attempt.isbn) {
          // Success! Log and return
          const totalDurationMs = Date.now() - startTime;

          if (this.config.enableLogging) {
            logger.info('ISBN resolved successfully', {
              title,
              author,
              isbn: attempt.isbn,
              provider: attempt.provider,
              confidence: attempt.confidence,
              durationMs: attempt.durationMs,
              totalDurationMs,
              attemptedProviders: attempts.length,
            });
          }

          // Track orchestrator fallback analytics
          trackOrchestratorFallback(
            {
              orchestrator: 'isbn_resolution',
              providerChain: attempts.map(a => a.provider).join('→'),
              successfulProvider: attempt.provider,
              operation: `resolveISBN("${title}", "${author}")`,
              attemptsCount: attempts.length,
              totalLatencyMs: totalDurationMs,
              success: 1,
            },
            context.env,
            context.ctx
          );

          return {
            isbn: attempt.isbn,
            confidence: attempt.confidence,
            source: attempt.provider,
          };
        }

        // Log failure and continue to next provider
        if (this.config.enableLogging) {
          logger.debug('ISBN resolver failed, trying next', {
            provider: attempt.provider,
            error: attempt.error,
            remainingResolvers: orderedResolvers.length - attempts.length,
          });
        }
      }

      // All resolvers failed
      const totalDurationMs = Date.now() - startTime;

      if (this.config.enableLogging) {
        logger.warn('All ISBN resolvers failed', {
          title,
          author,
          attemptedProviders: attempts.length,
          totalDurationMs,
          attempts: attempts.map(a => ({ provider: a.provider, error: a.error })),
        });
      }

      // Track orchestrator fallback analytics (failure case)
      trackOrchestratorFallback(
        {
          orchestrator: 'isbn_resolution',
          providerChain: attempts.map(a => a.provider).join('→'),
          successfulProvider: null,
          operation: `resolveISBN("${title}", "${author}")`,
          attemptsCount: attempts.length,
          totalLatencyMs: totalDurationMs,
          success: 0,
        },
        context.env,
        context.ctx
      );

      return { isbn: null, confidence: 0, source: 'all-failed' };
    } catch (error) {
      logger.error('ISBN resolution orchestrator error', {
        title,
        author,
        error: error instanceof Error ? error.message : String(error),
        attempts: attempts.length,
      });
      return { isbn: null, confidence: 0, source: 'error' };
    }
  }

  /**
   * Try a single resolver with timeout protection
   *
   * Creates an AbortController to properly cancel timed-out requests.
   * Uses Promise.race to ensure timeout rejects even if provider doesn't respect signal.
   *
   * @private
   */
  private async tryResolver(
    resolver: IISBNResolver,
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ResolutionAttempt> {
    const startTime = Date.now();
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      // Create timeout promise that rejects
      const timeoutPromise = new Promise<ISBNResolutionResult>((_, reject) => {
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

      // Race between resolver and timeout
      const result = await Promise.race([
        resolver.resolveISBN(title, author, contextWithSignal),
        timeoutPromise,
      ]);

      return {
        provider: resolver.name,
        success: result.isbn !== null,
        isbn: result.isbn,
        confidence: result.confidence,
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
          provider: resolver.name,
          success: false,
          isbn: null,
          confidence: 0,
          durationMs: Date.now() - startTime,
          error: 'Provider timeout (request cancelled)',
        };
      }

      return {
        provider: resolver.name,
        success: false,
        isbn: null,
        confidence: 0,
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
    resolvers: IISBNResolver[],
    _context: ServiceContext
  ): IISBNResolver[] {
    // If custom order specified, use it
    if (this.config.providerOrder.length > 0) {
      return this.sortByCustomOrder(resolvers, this.config.providerOrder);
    }

    // Default ordering: paid first (if quota), then free
    return resolvers.sort((a, b) => {
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
    resolvers: IISBNResolver[],
    order: string[]
  ): IISBNResolver[] {
    const orderMap = new Map(order.map((name, index) => [name, index]));

    return resolvers.sort((a, b) => {
      const aIndex = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }
}
