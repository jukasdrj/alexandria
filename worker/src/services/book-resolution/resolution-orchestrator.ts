/**
 * Resolution Orchestrator - Cascading ISBN Resolver
 *
 * Manages the 5-tier fallback chain for ISBN resolution when ISBNdb quota exhausted.
 * Each resolver implements Search → Validate pattern to ensure data quality.
 *
 * Fallback Chain:
 * 1. ISBNdb (primary - fast, accurate, quota-limited)
 * 2. Google Books (1st fallback - fast, good coverage)
 * 3. OpenLibrary (2nd fallback - free, reliable)
 * 4. Archive.org (3rd fallback - excellent for pre-2000 books)
 * 5. Wikidata (last resort - comprehensive, slow SPARQL queries)
 *
 * @module services/book-resolution/resolution-orchestrator
 * @since 2.5.0
 */

import type { IBookResolver, ISBNResolutionResult } from './interfaces.js';
import type { Env } from '../../env.js';
import type { Logger } from '../../../lib/logger.js';
import { OpenLibraryResolver } from './resolvers/open-library-resolver.js';

// Note: Other resolvers will be implemented in subsequent steps
// import { GoogleBooksResolver } from './resolvers/google-books-resolver.js';
// import { ArchiveOrgResolver } from './resolvers/archive-org-resolver.js';
// import { WikidataResolver } from './resolvers/wikidata-resolver.js';

/**
 * Resolution Orchestrator Configuration
 */
interface OrchestratorConfig {
  /** Timeout per resolver in milliseconds (default: 15 seconds) */
  resolverTimeoutMs?: number;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;
}

/**
 * Resolution Orchestrator
 *
 * Manages cascading fallback through multiple ISBN resolvers.
 * Each resolver has 15-second timeout to prevent stalls.
 *
 * **Performance**:
 * - Best case: ISBNdb success (~1-2 seconds)
 * - Worst case: All 5 resolvers fail (~75 seconds with timeouts)
 * - Typical (quota exhausted): 3-6 seconds (OpenLibrary success)
 *
 * **Observability**:
 * - Logs which resolver succeeded for each book
 * - Tracks resolver failure patterns
 * - Enables future optimization of fallback chain order
 *
 * @example
 * ```typescript
 * const orchestrator = new ResolutionOrchestrator();
 * const result = await orchestrator.findISBN(
 *   'The Splendid and the Vile',
 *   'Erik Larson',
 *   env,
 *   logger,
 *   quotaManager
 * );
 *
 * if (result.isbn) {
 *   console.log(`Resolved via ${result.source}: ${result.isbn}`);
 * } else {
 *   console.log('All resolvers failed, creating synthetic work');
 * }
 * ```
 */
export class ResolutionOrchestrator {
  private resolvers: IBookResolver[];
  private config: Required<OrchestratorConfig>;

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      resolverTimeoutMs: config.resolverTimeoutMs ?? 15000,
      enableLogging: config.enableLogging ?? true,
    };

    // Initialize resolver chain
    // Note: ISBNdb resolver will be implemented separately to preserve quota logic
    this.resolvers = [
      // new GoogleBooksResolver(),  // TODO: Implement in next step
      new OpenLibraryResolver(),     // Currently implemented
      // new ArchiveOrgResolver(),    // TODO: Implement in next step
      // new WikidataResolver(),      // TODO: Implement in next step
    ];
  }

  /**
   * Find ISBN using cascading fallback chain
   *
   * Tries each resolver in order until one succeeds or all fail.
   * Each resolver has 15-second timeout to prevent stalls.
   *
   * @param title - Book title from Gemini
   * @param author - Author name from Gemini
   * @param env - Worker environment
   * @param logger - Optional logger
   * @returns Resolution result with ISBN or null
   */
  async findISBN(
    title: string,
    author: string,
    env: Env,
    logger?: Logger
  ): Promise<ISBNResolutionResult> {
    const startTime = Date.now();

    if (this.config.enableLogging && logger) {
      logger.info('Resolution orchestrator starting', {
        title,
        author,
        resolverCount: this.resolvers.length,
      });
    }

    // Try each resolver in the fallback chain
    for (const resolver of this.resolvers) {
      const resolverStartTime = Date.now();

      try {
        if (this.config.enableLogging && logger) {
          logger.debug('Trying resolver', { resolver: resolver.name, title, author });
        }

        // Execute resolver with timeout
        const result = await this.executeWithTimeout(
          () => resolver.resolve(title, author, env, logger),
          this.config.resolverTimeoutMs
        );

        const resolverDuration = Date.now() - resolverStartTime;

        if (result.isbn) {
          // Success! Log and return
          if (this.config.enableLogging && logger) {
            logger.info('ISBN resolved successfully', {
              title,
              author,
              isbn: result.isbn,
              source: result.source,
              resolver: resolver.name,
              confidence: result.confidence,
              resolverDurationMs: resolverDuration,
              totalDurationMs: Date.now() - startTime,
            });
          }

          return result;
        } else {
          // Resolver returned no result, try next
          if (this.config.enableLogging && logger) {
            logger.debug('Resolver found no ISBN', {
              resolver: resolver.name,
              title,
              author,
              durationMs: resolverDuration,
            });
          }
        }
      } catch (error) {
        // Resolver failed (timeout or error), try next
        const resolverDuration = Date.now() - resolverStartTime;

        if (this.config.enableLogging && logger) {
          logger.warn('Resolver failed', {
            resolver: resolver.name,
            title,
            author,
            error: error instanceof Error ? error.message : String(error),
            durationMs: resolverDuration,
          });
        }

        // Continue to next resolver
      }
    }

    // All resolvers failed
    const totalDuration = Date.now() - startTime;

    if (this.config.enableLogging && logger) {
      logger.warn('All resolvers failed', {
        title,
        author,
        resolverCount: this.resolvers.length,
        totalDurationMs: totalDuration,
      });
    }

    return {
      isbn: null,
      confidence: 0,
      source: 'not_found',
    };
  }

  /**
   * Execute a promise with timeout
   *
   * Races the promise against a timeout timer.
   * If timeout reached, rejects with timeout error.
   *
   * @param promiseFn - Function that returns a promise
   * @param timeoutMs - Timeout in milliseconds
   * @returns Result of promise if completed before timeout
   * @throws Error if timeout reached
   */
  private async executeWithTimeout<T>(
    promiseFn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promiseFn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Resolver timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Get resolver statistics (for debugging/monitoring)
   *
   * @returns Resolver chain configuration
   */
  getResolverChain(): Array<{ name: string; order: number }> {
    return this.resolvers.map((resolver, index) => ({
      name: resolver.name,
      order: index + 1,
    }));
  }
}
