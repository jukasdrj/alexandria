/**
 * Book Generation Orchestrator
 *
 * Orchestrates AI-powered book metadata generation for backfill operations.
 * Uses Service Provider Registry for dynamic provider discovery and fallback.
 *
 * Features:
 * - Automatic provider discovery (Gemini, x.ai Grok)
 * - Quota-aware fallback (if primary provider unavailable)
 * - Priority ordering (Gemini first for cost, Grok as fallback)
 * - Performance tracking per provider
 *
 * @module lib/external-services/orchestrators/book-generation-orchestrator
 */

import type { ServiceProviderRegistry } from '../provider-registry.js';
import type { IBookGenerator, GeneratedBook } from '../capabilities.js';
import { ServiceCapability } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';

// =================================================================================
// Configuration
// =================================================================================

export interface BookGenerationConfig {
  /**
   * Enable detailed logging of provider attempts and failures
   * @default false
   */
  enableLogging?: boolean;

  /**
   * Timeout in milliseconds for each provider
   * Prevents slow providers from delaying the entire workflow
   * @default 60000 (60 seconds)
   */
  providerTimeoutMs?: number;

  /**
   * Provider priority order
   * Determines which providers to try first
   * @default ['gemini', 'xai'] (Gemini first for cost, Grok as fallback)
   */
  providerPriority?: string[];

  /**
   * Stop after first successful provider
   * If false, tries all available providers and returns first success
   * @default true
   */
  stopOnFirstSuccess?: boolean;
}

const DEFAULT_CONFIG: Required<BookGenerationConfig> = {
  enableLogging: false,
  providerTimeoutMs: 60000, // 60 seconds for AI generation
  providerPriority: ['gemini', 'xai'], // Gemini first (cheaper), Grok as fallback
  stopOnFirstSuccess: true,
};

// =================================================================================
// Orchestrator
// =================================================================================

export class BookGenerationOrchestrator {
  private registry: ServiceProviderRegistry;
  private config: Required<BookGenerationConfig>;

  constructor(
    registry: ServiceProviderRegistry,
    config: BookGenerationConfig = {}
  ) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate book metadata using available AI providers
   *
   * WORKFLOW:
   * 1. Discover available book generation providers (checks API keys, quota)
   * 2. Sort by priority (Gemini first, Grok second)
   * 3. Try each provider with timeout protection
   * 4. Return first successful result or empty array
   *
   * FALLBACK BEHAVIOR:
   * - If Gemini quota exhausted → Try Grok automatically
   * - If Gemini fails → Try Grok automatically
   * - If all providers fail → Return empty array (graceful degradation)
   *
   * @param prompt - Generation prompt (e.g., "significant books published in January 2020")
   * @param count - Number of books to generate
   * @param context - Service context with environment and logger
   * @returns Array of generated books (empty if all providers fail)
   */
  async generateBooks(
    prompt: string,
    count: number,
    context: ServiceContext
  ): Promise<GeneratedBook[]> {
    const { logger } = context;
    const startTime = Date.now();

    if (this.config.enableLogging) {
      logger.info('[BookGenOrchestrator] Starting book generation', {
        prompt_length: prompt.length,
        count,
      });
    }

    // Step 1: Get available providers (checks API keys, quota)
    const availableProviders = await this.registry.getAvailableProviders<IBookGenerator>(
      ServiceCapability.BOOK_GENERATION,
      context
    );

    if (availableProviders.length === 0) {
      logger.error('[BookGenOrchestrator] No book generation providers available');
      return [];
    }

    if (this.config.enableLogging) {
      logger.info('[BookGenOrchestrator] Available providers', {
        providers: availableProviders.map((p) => p.name),
        count: availableProviders.length,
      });
    }

    // Step 2: Sort by priority
    const sortedProviders = this.sortProvidersByPriority(availableProviders);

    if (this.config.enableLogging) {
      logger.info('[BookGenOrchestrator] Provider order', {
        order: sortedProviders.map((p) => p.name),
      });
    }

    // Step 3: Try each provider with timeout protection
    for (const provider of sortedProviders) {
      const providerStart = Date.now();

      try {
        if (this.config.enableLogging) {
          logger.info('[BookGenOrchestrator] Trying provider', {
            provider: provider.name,
          });
        }

        // Add timeout protection with proper cleanup
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<GeneratedBook[]>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Provider timeout')),
            this.config.providerTimeoutMs
          );
        });

        const booksPromise = provider.generateBooks(prompt, count, context);

        try {
          const books = await Promise.race([booksPromise, timeoutPromise]);
          // Clear timeout on successful completion
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }

          const duration = Date.now() - providerStart;

          if (books.length > 0) {
            logger.info('[BookGenOrchestrator] Provider succeeded', {
              provider: provider.name,
              books_generated: books.length,
              duration_ms: duration,
              total_duration_ms: Date.now() - startTime,
            });

            if (this.config.stopOnFirstSuccess) {
              return books;
            }
          } else {
            if (this.config.enableLogging) {
              logger.warn('[BookGenOrchestrator] Provider returned empty result', {
                provider: provider.name,
                duration_ms: duration,
              });
            }
          }
        } finally {
          // Ensure timeout is always cleared
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
        }
      } catch (error) {
        const duration = Date.now() - providerStart;

        logger.warn('[BookGenOrchestrator] Provider failed', {
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
          duration_ms: duration,
        });

        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    logger.error('[BookGenOrchestrator] All providers failed', {
      attempted_providers: sortedProviders.map((p) => p.name),
      total_duration_ms: Date.now() - startTime,
    });

    return [];
  }

  /**
   * Sort providers by configured priority
   *
   * Providers not in priority list are added at the end in discovery order
   */
  private sortProvidersByPriority(providers: IBookGenerator[]): IBookGenerator[] {
    const priorityMap = new Map(
      this.config.providerPriority.map((name, index) => [name, index])
    );

    return [...providers].sort((a, b) => {
      const aPriority = priorityMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bPriority = priorityMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aPriority - bPriority;
    });
  }

  /**
   * Get list of available provider names
   *
   * Useful for debugging and logging which providers are configured
   */
  async getAvailableProviderNames(context: ServiceContext): Promise<string[]> {
    const providers = await this.registry.getAvailableProviders<IBookGenerator>(
      ServiceCapability.BOOK_GENERATION,
      context
    );
    return providers.map((p) => p.name);
  }
}
