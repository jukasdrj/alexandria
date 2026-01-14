/**
 * Metadata Enrichment Orchestrator
 *
 * Registry-based orchestrator for comprehensive book metadata enrichment.
 * Aggregates data from multiple providers to create rich, complete records.
 *
 * Enrichment Strategy:
 * 1. Start with base metadata (title, authors, publisher)
 * 2. Enrich with subjects/categories from multiple sources
 * 3. Add cover images with fallback chain
 * 4. Merge data with conflict resolution
 *
 * Provider Priority (by data type):
 * - Metadata: ISBNdb > Google Books > OpenLibrary > Wikidata
 * - Subjects: Google Books > Wikidata > ISBNdb
 * - Covers: Google Books > OpenLibrary > Archive.org > Wikidata > ISBNdb
 *
 * Features:
 * - Parallel provider calls for speed
 * - Smart data merging with deduplication
 * - Confidence scoring for conflict resolution
 * - Graceful degradation (returns partial data on failures)
 *
 * @module lib/external-services/orchestrators/metadata-enrichment-orchestrator
 */

import type { BookMetadata, IMetadataProvider, ISubjectProvider } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import { ServiceProviderRegistry } from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';
import { trackOrchestratorFallback } from '../analytics.js';

// =================================================================================
// Types
// =================================================================================

/**
 * Metadata Enrichment Orchestrator Configuration
 */
export interface MetadataEnrichmentConfig {
  /** Timeout per provider in milliseconds (default: 10000) */
  providerTimeoutMs?: number;

  /** Whether to enable parallel fetching (default: true for free providers) */
  enableParallelFetch?: boolean;

  /** Whether to enable observability logging (default: true) */
  enableLogging?: boolean;

  /** Maximum number of subject providers to query (default: 3) */
  maxSubjectProviders?: number;
}

/**
 * Enrichment result with provider tracking
 */
export interface EnrichmentResult {
  metadata: BookMetadata | null;
  providers: {
    metadata: string[];
    subjects: string[];
    cover?: string;
  };
  durationMs: number;
  errors: Array<{ provider: string; error: string }>;
}

// =================================================================================
// Metadata Enrichment Orchestrator
// =================================================================================

/**
 * Metadata Enrichment Orchestrator
 *
 * Aggregates metadata from multiple providers to create comprehensive book records.
 * Uses parallel fetching and smart merging for optimal performance and data quality.
 *
 * @example
 * ```typescript
 * const registry = new ServiceProviderRegistry();
 * registry.register(new GoogleBooksProvider());
 * registry.register(new WikidataProvider());
 * registry.register(new ISBNdbProvider());
 *
 * const orchestrator = new MetadataEnrichmentOrchestrator(registry);
 * const result = await orchestrator.enrichMetadata(
 *   '9780385544153',
 *   { env, logger }
 * );
 *
 * console.log(`Enriched from ${result.providers.metadata.length} providers`);
 * console.log(`Title: ${result.metadata?.title}`);
 * console.log(`Subjects: ${result.metadata?.subjects?.join(', ')}`);
 * ```
 */
export class MetadataEnrichmentOrchestrator {
  private config: Required<MetadataEnrichmentConfig>;

  constructor(
    private registry: ServiceProviderRegistry,
    config: MetadataEnrichmentConfig = {}
  ) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? 10000,
      enableParallelFetch: config.enableParallelFetch ?? true,
      enableLogging: config.enableLogging ?? true,
      maxSubjectProviders: config.maxSubjectProviders ?? 3,
    };
  }

  /**
   * Enrich metadata for ISBN
   *
   * Queries multiple providers and merges results into comprehensive metadata.
   *
   * @param isbn - ISBN-13 to enrich
   * @param context - Service context (env, logger)
   * @returns Enrichment result with aggregated metadata and provider tracking
   */
  async enrichMetadata(
    isbn: string,
    context: ServiceContext
  ): Promise<EnrichmentResult> {
    const { logger } = context;
    const startTime = Date.now();
    const errors: Array<{ provider: string; error: string }> = [];

    try {
      // Get available metadata providers
      const metadataProviders = await this.registry.getAvailableProviders<IMetadataProvider>(
        ServiceCapability.METADATA_ENRICHMENT,
        context
      );

      // Get subject providers (subset of metadata providers)
      const subjectProviders = await this.registry.getAvailableProviders<ISubjectProvider>(
        ServiceCapability.SUBJECT_ENRICHMENT,
        context
      );

      if (metadataProviders.length === 0) {
        logger.warn('No metadata providers available');
        return {
          metadata: null,
          providers: { metadata: [], subjects: [] },
          durationMs: Date.now() - startTime,
          errors: [],
        };
      }

      if (this.config.enableLogging) {
        logger.info('Starting metadata enrichment', {
          isbn,
          metadataProviders: metadataProviders.length,
          subjectProviders: subjectProviders.length,
        });
      }

      // Fetch metadata from all providers (parallel if enabled)
      const metadataResults = this.config.enableParallelFetch
        ? await this.fetchMetadataParallel(metadataProviders, isbn, context, errors)
        : await this.fetchMetadataSequential(metadataProviders, isbn, context, errors);

      // Fetch subjects from specialized providers
      const subjectResults = await this.fetchSubjects(
        subjectProviders.slice(0, this.config.maxSubjectProviders),
        isbn,
        context,
        errors
      );

      // Merge all metadata
      const merged = this.mergeMetadata(metadataResults, subjectResults);

      const result: EnrichmentResult = {
        metadata: merged,
        providers: {
          metadata: metadataResults
            .filter(r => r.data !== null)
            .map(r => r.provider),
          subjects: subjectResults
            .filter(r => r.subjects.length > 0)
            .map(r => r.provider),
        },
        durationMs: Date.now() - startTime,
        errors,
      };

      if (this.config.enableLogging) {
        logger.info('Metadata enrichment complete', {
          isbn,
          metadataProviders: result.providers.metadata.length,
          subjectProviders: result.providers.subjects.length,
          totalSubjects: merged?.subjects?.length ?? 0,
          durationMs: result.durationMs,
        });
      }

      // Track orchestrator fallback analytics
      const allProviders = [...result.providers.metadata, ...result.providers.subjects];
      trackOrchestratorFallback(
        {
          orchestrator: 'metadata_enrichment',
          providerChain: allProviders.join('→'),
          successfulProvider: result.providers.metadata.length > 0 ? result.providers.metadata[0] : null,
          operation: `enrichMetadata("${isbn}")`,
          attemptsCount: allProviders.length,
          totalLatencyMs: result.durationMs,
          success: merged !== null ? 1 : 0,
        },
        context.env,
        context.ctx
      );

      return result;
    } catch (error) {
      logger.error('Metadata enrichment orchestrator error', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        metadata: null,
        providers: { metadata: [], subjects: [] },
        durationMs: Date.now() - startTime,
        errors: [{ provider: 'orchestrator', error: String(error) }],
      };
    }
  }

  /**
   * Fetch metadata from providers in parallel
   *
   * Creates an AbortController per provider to properly cancel timed-out requests.
   * This prevents timed-out HTTP requests from continuing in the background.
   *
   * @private
   */
  private async fetchMetadataParallel(
    providers: IMetadataProvider[],
    isbn: string,
    context: ServiceContext,
    errors: Array<{ provider: string; error: string }>
  ): Promise<Array<{ provider: string; data: BookMetadata | null }>> {
    const promises = providers.map(async (provider) => {
      const abortController = new AbortController();

      try {
        // Create timeout that aborts the request
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, this.config.providerTimeoutMs);

        // Create context with abort signal
        const contextWithSignal: ServiceContext = {
          ...context,
          signal: abortController.signal,
        };

        try {
          const data = await provider.fetchMetadata(isbn, contextWithSignal);
          clearTimeout(timeoutId);
          return { provider: provider.name, data };
        } catch (error) {
          clearTimeout(timeoutId);

          // Check if error was due to abort
          if (error instanceof Error && error.message.includes('cancelled by caller')) {
            errors.push({
              provider: provider.name,
              error: 'Provider timeout (request cancelled)',
            });
          } else {
            errors.push({
              provider: provider.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          return { provider: provider.name, data: null };
        }
      } catch (error) {
        errors.push({
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
        return { provider: provider.name, data: null };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Fetch metadata from providers sequentially
   *
   * Creates an AbortController per provider to properly cancel timed-out requests.
   * This prevents timed-out HTTP requests from continuing in the background.
   *
   * @private
   */
  private async fetchMetadataSequential(
    providers: IMetadataProvider[],
    isbn: string,
    context: ServiceContext,
    errors: Array<{ provider: string; error: string }>
  ): Promise<Array<{ provider: string; data: BookMetadata | null }>> {
    const results: Array<{ provider: string; data: BookMetadata | null }> = [];

    for (const provider of providers) {
      const abortController = new AbortController();

      try {
        // Create timeout that aborts the request
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, this.config.providerTimeoutMs);

        // Create context with abort signal
        const contextWithSignal: ServiceContext = {
          ...context,
          signal: abortController.signal,
        };

        try {
          const data = await provider.fetchMetadata(isbn, contextWithSignal);
          clearTimeout(timeoutId);
          results.push({ provider: provider.name, data });
        } catch (error) {
          clearTimeout(timeoutId);

          // Check if error was due to abort
          if (error instanceof Error && error.message.includes('cancelled by caller')) {
            errors.push({
              provider: provider.name,
              error: 'Provider timeout (request cancelled)',
            });
          } else {
            errors.push({
              provider: provider.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          results.push({ provider: provider.name, data: null });
        }
      } catch (error) {
        errors.push({
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({ provider: provider.name, data: null });
      }
    }

    return results;
  }

  /**
   * Fetch subjects from specialized providers
   *
   * Creates an AbortController per provider to properly cancel timed-out requests.
   * This prevents timed-out HTTP requests from continuing in the background.
   *
   * @private
   */
  private async fetchSubjects(
    providers: ISubjectProvider[],
    isbn: string,
    context: ServiceContext,
    errors: Array<{ provider: string; error: string }>
  ): Promise<Array<{ provider: string; subjects: string[] }>> {
    const promises = providers.map(async (provider) => {
      const abortController = new AbortController();

      try {
        // Create timeout that aborts the request
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, this.config.providerTimeoutMs);

        // Create context with abort signal
        const contextWithSignal: ServiceContext = {
          ...context,
          signal: abortController.signal,
        };

        try {
          const subjects = await provider.fetchSubjects(isbn, contextWithSignal);
          clearTimeout(timeoutId);
          return { provider: provider.name, subjects: subjects ?? [] };
        } catch (error) {
          clearTimeout(timeoutId);

          // Check if error was due to abort
          if (error instanceof Error && error.message.includes('cancelled by caller')) {
            errors.push({
              provider: provider.name,
              error: 'Provider timeout (request cancelled)',
            });
          } else {
            errors.push({
              provider: provider.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          return { provider: provider.name, subjects: [] };
        }
      } catch (error) {
        errors.push({
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
        return { provider: provider.name, subjects: [] };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Merge metadata from multiple providers
   *
   * Strategy:
   * - Use first non-null value for most fields
   * - Deduplicate and merge arrays (subjects, authors)
   * - Prefer longer descriptions
   * - Combine external IDs
   *
   * @private
   */
  private mergeMetadata(
    metadataResults: Array<{ provider: string; data: BookMetadata | null }>,
    subjectResults: Array<{ provider: string; subjects: string[] }>
  ): BookMetadata | null {
    const validMetadata = metadataResults
      .filter(r => r.data !== null)
      .map(r => r.data!);

    if (validMetadata.length === 0) {
      return null;
    }

    // Merge metadata (first non-null wins for most fields)
    const merged: BookMetadata = {
      title: this.firstNonNull(validMetadata.map(m => m.title)),
      authors: this.mergeArrays(validMetadata.map(m => m.authors)),
      publisher: this.firstNonNull(validMetadata.map(m => m.publisher)),
      publishDate: this.firstNonNull(validMetadata.map(m => m.publishDate)),
      pageCount: this.firstNonNull(validMetadata.map(m => m.pageCount)),
      language: this.firstNonNull(validMetadata.map(m => m.language)),
      isbn: this.firstNonNull(validMetadata.map(m => m.isbn)),
      isbn13: this.firstNonNull(validMetadata.map(m => m.isbn13)),
      coverUrl: this.firstNonNull(validMetadata.map(m => m.coverUrl)),

      // Prefer longest description
      description: this.longestString(validMetadata.map(m => m.description)),

      // Merge subjects from both metadata and subject providers
      subjects: this.mergeArrays([
        ...validMetadata.map(m => m.subjects),
        ...subjectResults.map(r => r.subjects),
      ]),

      // Combine external IDs
      externalIds: this.mergeExternalIds(validMetadata.map(m => m.externalIds)),
    };

    return merged;
  }

  /**
   * Get first non-null value from array
   *
   * @private
   */
  private firstNonNull<T>(values: Array<T | null | undefined>): T | undefined {
    return values.find(v => v != null) ?? undefined;
  }

  /**
   * Get longest non-null string from array
   *
   * @private
   */
  private longestString(values: Array<string | null | undefined>): string | undefined {
    const strings = values.filter((v): v is string => typeof v === 'string');
    if (strings.length === 0) return undefined;
    return strings.reduce((longest, current) =>
      current.length > longest.length ? current : longest
    );
  }

  /**
   * Merge and deduplicate arrays
   *
   * Uses O(n) Map-based deduplication to prevent CPU exhaustion
   * with large subject arrays (e.g., books with 100+ subjects).
   *
   * @private
   */
  private mergeArrays<T>(
    arrays: Array<T[] | null | undefined>
  ): T[] | undefined {
    const allItems = arrays
      .filter((arr): arr is T[] => Array.isArray(arr))
      .flat();

    if (allItems.length === 0) return undefined;

    // O(n) deduplication preserving first-seen casing
    const seen = new Set<string>();
    const result: T[] = [];

    for (const item of allItems) {
      const key = typeof item === 'string' ? item.toLowerCase() : String(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Merge external IDs from multiple sources
   *
   * @private
   */
  private mergeExternalIds(
    externalIds: Array<Record<string, string> | undefined>
  ): Record<string, string> | undefined {
    const merged: Record<string, string> = {};

    for (const ids of externalIds) {
      if (ids) {
        Object.assign(merged, ids);
      }
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  }
}
