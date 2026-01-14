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
import type { Logger } from '../../../src/env.js';
import {
  normalizeTitle,
  calculateSimilarity,
  FUZZY_SIMILARITY_THRESHOLD,
} from '../../utils/string-similarity.js';

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
   * Determines which providers to try first (for sequential mode)
   * @default ['gemini', 'xai'] (Gemini first for cost, Grok as fallback)
   */
  providerPriority?: string[];

  /**
   * Stop after first successful provider (sequential mode)
   * If false, tries all available providers and returns first success
   * @default false (concurrent mode is default for book generation)
   */
  stopOnFirstSuccess?: boolean;

  /**
   * Run providers concurrently instead of sequentially
   * When true, all providers run in parallel and results are deduplicated
   * @default true (maximize diversity and speed)
   */
  concurrentExecution?: boolean;

  /**
   * Title similarity threshold for deduplication (0.0-1.0)
   * Books with title similarity above this threshold are considered duplicates
   * @default 0.6 (60% similar = duplicate, aligned with database fuzzy matching)
   */
  deduplicationThreshold?: number;
}

const DEFAULT_CONFIG: Required<BookGenerationConfig> = {
  enableLogging: false,
  providerTimeoutMs: 60000, // 60 seconds for AI generation
  providerPriority: ['gemini', 'xai'], // Gemini first (cheaper), Grok as fallback
  stopOnFirstSuccess: false, // Use concurrent mode by default
  concurrentExecution: true, // Run all providers in parallel
  deduplicationThreshold: FUZZY_SIMILARITY_THRESHOLD, // 0.6 = 60% (aligned with database)
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
   * CONCURRENT MODE (default):
   * 1. Discover available book generation providers (checks API keys, quota)
   * 2. Run all providers in parallel with timeout protection
   * 3. Deduplicate results by title similarity (80% threshold)
   * 4. Return combined, deduplicated list
   *
   * SEQUENTIAL MODE (stopOnFirstSuccess=true):
   * 1. Discover available providers
   * 2. Sort by priority (Gemini first, Grok second)
   * 3. Try each provider until one succeeds
   * 4. Return first successful result
   *
   * BENEFITS OF CONCURRENT MODE:
   * - Maximum diversity (0% overlap observed between Gemini & Grok)
   * - Faster completion (both run in parallel)
   * - Resilience (succeeds if ANY provider works)
   * - Deduplication prevents redundant books
   *
   * @param prompt - Generation prompt (e.g., "significant books published in January 2020")
   * @param count - Number of books to generate PER PROVIDER
   * @param context - Service context with environment and logger
   * @returns Array of generated books (deduplicated if concurrent)
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

    // Step 3: Choose execution strategy
    if (this.config.concurrentExecution) {
      return this.generateBooksConcurrent(sortedProviders, prompt, count, context, startTime);
    } else {
      return this.generateBooksSequential(sortedProviders, prompt, count, context, startTime);
    }
  }

  /**
   * Generate books concurrently from all providers and deduplicate
   *
   * Runs all providers in parallel for maximum diversity and speed.
   * Deduplicates results by title similarity to prevent redundancy.
   */
  private async generateBooksConcurrent(
    providers: IBookGenerator[],
    prompt: string,
    count: number,
    context: ServiceContext,
    startTime: number
  ): Promise<GeneratedBook[]> {
    const { logger } = context;

    logger.info('[BookGenOrchestrator] Running providers concurrently', {
      providers: providers.map((p) => p.name),
      count_per_provider: count,
    });

    // Filter to only available providers before attempting generation
    const availableProviders: IBookGenerator[] = [];
    for (const provider of providers) {
      try {
        const available = await provider.isAvailable(context.env, context.quotaManager);
        if (available) {
          availableProviders.push(provider);
        } else {
          logger.warn('[BookGenOrchestrator] Provider unavailable, skipping', {
            provider: provider.name,
            reason: 'isAvailable() returned false',
          });
        }
      } catch (error) {
        logger.error('[BookGenOrchestrator] Error checking provider availability', {
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (availableProviders.length === 0) {
      logger.error('[BookGenOrchestrator] No available providers for concurrent generation', {
        attempted_providers: providers.map((p) => p.name),
        total_duration_ms: Date.now() - startTime,
      });
      return [];
    }

    logger.info('[BookGenOrchestrator] Available providers after filtering', {
      available: availableProviders.map((p) => p.name),
      filtered_out: providers.length - availableProviders.length,
    });

    // Run all available providers in parallel with individual timeout protection
    const providerPromises = availableProviders.map(async (provider) => {
      const providerStart = Date.now();

      try {
        // Add timeout protection
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
            logger.info('[BookGenOrchestrator] Provider succeeded (concurrent)', {
              provider: provider.name,
              books_generated: books.length,
              duration_ms: duration,
            });
            return books;
          } else {
            logger.warn('[BookGenOrchestrator] Provider returned empty result (concurrent)', {
              provider: provider.name,
              duration_ms: duration,
            });
            return [];
          }
        } finally {
          // Ensure timeout is always cleared
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
        }
      } catch (error) {
        const duration = Date.now() - providerStart;
        logger.warn('[BookGenOrchestrator] Provider failed (concurrent)', {
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
          duration_ms: duration,
        });
        return [];
      }
    });

    // Wait for all providers to complete
    const allResults = await Promise.all(providerPromises);

    // Flatten and deduplicate
    const allBooks = allResults.flat();

    if (allBooks.length === 0) {
      logger.error('[BookGenOrchestrator] All concurrent providers failed', {
        attempted_providers: availableProviders.map((p) => p.name),
        total_duration_ms: Date.now() - startTime,
      });
      return [];
    }

    // Deduplicate by title similarity
    const deduplicated = this.deduplicateBooks(allBooks, logger);

    logger.info('[BookGenOrchestrator] Concurrent generation complete', {
      total_generated: allBooks.length,
      after_deduplication: deduplicated.length,
      duplicates_removed: allBooks.length - deduplicated.length,
      total_duration_ms: Date.now() - startTime,
    });

    return deduplicated;
  }

  /**
   * Generate books sequentially with fallback (original behavior)
   */
  private async generateBooksSequential(
    sortedProviders: IBookGenerator[],
    prompt: string,
    count: number,
    context: ServiceContext,
    startTime: number
  ): Promise<GeneratedBook[]> {
    const { logger } = context;

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
   * Deduplicate books by title similarity using shared fuzzy matching logic
   *
   * Keeps the first occurrence of each unique book (by provider order).
   * Uses Alexandria's standard fuzzy matching:
   * - Normalize titles (lowercase, remove punctuation/articles)
   * - Calculate Levenshtein similarity
   * - Threshold: 0.6 (60%, aligned with database deduplication)
   */
  private deduplicateBooks(books: GeneratedBook[], logger: Logger): GeneratedBook[] {
    if (books.length === 0) return [];

    const unique: GeneratedBook[] = [];
    const seenTitles = new Set<string>();

    for (const book of books) {
      const normalized = normalizeTitle(book.title);

      // Check for exact match first (fast path)
      if (seenTitles.has(normalized)) {
        logger.debug('[BookGenOrchestrator] Exact duplicate detected', {
          title: book.title,
          source: book.source,
        });
        continue;
      }

      // Check for fuzzy similarity with existing titles
      let isDuplicate = false;
      for (const seenTitle of seenTitles) {
        const similarity = calculateSimilarity(normalized, seenTitle);
        if (similarity >= this.config.deduplicationThreshold) {
          isDuplicate = true;
          logger.debug('[BookGenOrchestrator] Fuzzy duplicate detected', {
            title: book.title,
            similar_to: seenTitle,
            similarity: similarity.toFixed(2),
            source: book.source,
          });
          break;
        }
      }

      if (!isDuplicate) {
        unique.push(book);
        seenTitles.add(normalized);
      }
    }

    return unique;
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
