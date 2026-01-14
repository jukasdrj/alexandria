/**
 * Service Provider Framework - Unified HTTP Client
 *
 * Eliminates boilerplate from individual service implementations by providing:
 * - Built-in rate limiting (KV-backed, distributed-safe)
 * - Response caching with configurable TTLs
 * - Automatic retry logic with exponential backoff
 * - Standardized error handling
 * - User-Agent management
 * - Observability hooks for performance monitoring
 *
 * WORKER CONSTRAINTS:
 * - Designed for Cloudflare Workers environment (sub-50ms CPU time for cold starts)
 * - Uses async KV operations (may add latency on cache miss)
 * - Global state (rate limit tracking) distributed via KV namespace
 * - Consider caching provider registry to minimize cold start overhead
 */

import type { ServiceContext } from './service-context.js';
import {
  enforceRateLimit,
  getCachedResponse,
  setCachedResponse,
  buildUserAgent,
  buildCacheKey,
  buildRateLimitKey,
  type Provider,
} from '../open-api-utils.js';
import {
  fetchWithRetry,
  HTTPError,
  JSONParseError,
  TimeoutError,
} from '../fetch-utils.js';
import { trackProviderRequest } from './analytics.js';

/**
 * HTTP Client Configuration
 */
export interface HttpClientConfig {
  /** Provider name (used for rate limiting and caching keys) */
  providerName: string;

  /** Rate limit delay in milliseconds (e.g., 1000 for 1 req/sec) */
  rateLimitMs: number;

  /** Cache TTL in seconds (e.g., 604800 for 7 days) */
  cacheTtlSeconds: number;

  /** Purpose description for User-Agent (e.g., 'Book metadata enrichment') */
  purpose: string;

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Default request timeout in milliseconds (default: 10000) */
  defaultTimeout?: number;

  /** HTTP status codes that should be retried (default: [408, 429, 500, 502, 503, 504]) */
  retryableStatuses?: number[];

  /**
   * Callback invoked after each successful API call for quota tracking
   * Used by ISBNdb provider to record API usage via QuotaManager
   *
   * @param provider - Provider name (e.g., 'isbndb')
   * @param url - Request URL
   * @returns Promise that resolves when tracking complete
   *
   * @example
   * ```typescript
   * onCall: async (provider, url) => {
   *   if (quotaManager && provider === 'isbndb') {
   *     await quotaManager.recordApiCall(1);
   *   }
   * }
   * ```
   */
  onCall?: (provider: string, url: string) => Promise<void>;
}

/**
 * Request metrics for observability
 */
export interface RequestMetrics {
  provider: string;
  url: string;
  success: boolean;
  cached: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  timestamp: number;
}

/**
 * Unified HTTP Client for Service Providers
 *
 * This eliminates ~60 LOC of boilerplate per service by centralizing:
 * - Rate limiting enforcement
 * - Response caching
 * - Retry logic
 * - User-Agent management
 * - Error handling
 *
 * @example
 * ```typescript
 * const client = new ServiceHttpClient({
 *   providerName: 'open-library',
 *   rateLimitMs: 3000,
 *   cacheTtlSeconds: 604800,
 *   purpose: 'Book metadata enrichment',
 * });
 *
 * const data = await client.fetch<OpenLibraryResponse>(
 *   'https://openlibrary.org/search.json?isbn=9780553293357',
 *   {},
 *   context
 * );
 * ```
 */
export class ServiceHttpClient {
  private readonly config: Required<HttpClientConfig>;

  constructor(config: HttpClientConfig) {
    this.config = {
      ...config,
      maxRetries: config.maxRetries ?? 3,
      defaultTimeout: config.defaultTimeout ?? 10000,
      retryableStatuses: config.retryableStatuses ?? [408, 429, 500, 502, 503, 504],
      onCall: config.onCall ?? (async () => {}), // Default no-op for optional quota tracking
    };
  }

  /**
   * Fetch data from a URL with built-in rate limiting, caching, and retry logic
   *
   * ERROR HANDLING:
   * - Returns `null` on any failure (HTTP error, timeout, JSON parse error)
   * - This is graceful degradation - providers MUST handle null responses explicitly
   * - All errors are logged via context.logger for debugging
   * - Retryable errors (429, 500-504) are automatically retried with exponential backoff
   *
   * ABORT SIGNAL SUPPORT:
   * - Pass `options.signal` to cancel requests (e.g., orchestrator timeouts)
   * - Request will abort when EITHER timeout OR external signal fires
   * - Aborted requests are logged as cancelled (not timed out)
   *
   * @param url - URL to fetch
   * @param options - Fetch options (headers, method, body, signal, etc.)
   * @param context - Service context (env, logger, cache/rate limit strategies)
   * @returns Parsed JSON data or null on failure (providers must handle null)
   */
  async fetch<T>(
    url: string,
    options: RequestInit,
    context: ServiceContext
  ): Promise<T | null> {
    const { logger } = context;
    const startTime = Date.now();

    // 1. Check cache (if enabled)
    if (this.shouldReadCache(context)) {
      const cached = await this.getFromCache<T>(url, context);
      if (cached) {
        const latencyMs = Date.now() - startTime;

        // Track cache hit analytics
        trackProviderRequest(
          {
            provider: this.config.providerName,
            operation: this.extractOperation(url),
            status: 'cache_hit',
            latencyMs,
            cacheHit: 1,
          },
          context.env,
          context.ctx
        );

        logger.debug('Cache hit', { provider: this.config.providerName, url, latencyMs });
        return cached;
      }
    }

    // 2. Enforce rate limit (if enabled)
    if (this.shouldEnforceRateLimit(context)) {
      await this.enforceRateLimit(context);
    }

    // 3. Execute request with retry logic
    try {
      const response = await fetchWithRetry(
        url,
        {
          ...options,
          headers: {
            ...options.headers,
            'User-Agent': buildUserAgent(
              this.config.providerName as Provider,
              this.config.purpose
            ),
            Accept: 'application/json',
          },
          // Pass through AbortSignal from context (if provided by orchestrator)
          signal: context.signal,
        },
        {
          maxRetries: this.config.maxRetries,
          timeoutMs: context.timeoutMs ?? this.config.defaultTimeout,
          retryableStatuses: this.config.retryableStatuses,
        }
      );

      if (!response.ok) {
        const latencyMs = Date.now() - startTime;

        // Track failed request analytics
        trackProviderRequest(
          {
            provider: this.config.providerName,
            operation: this.extractOperation(url),
            status: 'error',
            errorType: `HTTP_${response.status}`,
            latencyMs,
            cacheHit: 0,
          },
          context.env,
          context.ctx
        );

        logger.warn('HTTP request failed', {
          provider: this.config.providerName,
          url,
          status: response.status,
          statusText: response.statusText,
          latencyMs,
        });
        return null;
      }

      // Parse JSON response
      let data: T;
      try {
        data = (await response.json()) as T;
      } catch (parseError) {
        const latencyMs = Date.now() - startTime;
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);

        // Track JSON parse error analytics
        trackProviderRequest(
          {
            provider: this.config.providerName,
            operation: this.extractOperation(url),
            status: 'error',
            errorType: 'JSON_PARSE_ERROR',
            latencyMs,
            cacheHit: 0,
          },
          context.env,
          context.ctx
        );

        logger.error('JSON parse error', {
          provider: this.config.providerName,
          url,
          error: errorMsg,
          latencyMs,
        });
        return null;
      }

      // 4. Cache response (if enabled)
      if (this.shouldWriteCache(context)) {
        await this.saveToCache(url, data, context);
      }

      const latencyMs = Date.now() - startTime;

      // 5. Invoke quota tracking callback (if provided)
      if (this.config.onCall) {
        try {
          await this.config.onCall(this.config.providerName, url);
        } catch (callbackError) {
          // Graceful degradation: don't fail requests if quota tracking fails
          logger.warn('Quota tracking callback failed', {
            provider: this.config.providerName,
            url,
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          });
        }
      }

      // Track successful request analytics
      trackProviderRequest(
        {
          provider: this.config.providerName,
          operation: this.extractOperation(url),
          status: 'success',
          latencyMs,
          cacheHit: 0,
        },
        context.env,
        context.ctx
      );

      logger.debug('HTTP request success', {
        provider: this.config.providerName,
        url,
        cached: false,
        latencyMs,
      });

      return data;
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // Track fetch error analytics
      const errorType = error instanceof TimeoutError ? 'TIMEOUT' :
                        error instanceof HTTPError ? `HTTP_${error.status}` :
                        error instanceof JSONParseError ? 'JSON_PARSE_ERROR' :
                        'FETCH_ERROR';

      trackProviderRequest(
        {
          provider: this.config.providerName,
          operation: this.extractOperation(url),
          status: errorType === 'TIMEOUT' ? 'timeout' : 'error',
          errorType,
          latencyMs,
          cacheHit: 0,
        },
        context.env,
        context.ctx
      );

      this.handleFetchError(error, url, logger);
      return null;
    }
  }

  /**
   * Fetch data without caching (useful for one-off requests)
   *
   * @param url - URL to fetch
   * @param options - Fetch options
   * @param context - Service context
   * @returns Parsed JSON data or null on failure
   */
  async fetchWithoutCache<T>(
    url: string,
    options: RequestInit,
    context: ServiceContext
  ): Promise<T | null> {
    return this.fetch<T>(url, options, {
      ...context,
      cacheStrategy: 'disabled',
    });
  }

  /**
   * Batch fetch multiple URLs in parallel
   * Does NOT use caching (use sparingly)
   *
   * @param urls - Array of URLs to fetch
   * @param options - Fetch options (applied to all requests)
   * @param context - Service context
   * @returns Map of URL to data (failed requests omitted)
   */
  async batchFetch<T>(
    urls: string[],
    options: RequestInit,
    context: ServiceContext
  ): Promise<Map<string, T>> {
    const { logger } = context;
    const results = new Map<string, T>();

    logger.info('Starting batch fetch', {
      provider: this.config.providerName,
      count: urls.length,
    });

    const promises = urls.map(async (url) => {
      const data = await this.fetchWithoutCache<T>(url, options, context);
      if (data) {
        results.set(url, data);
      }
    });

    await Promise.all(promises);

    logger.info('Batch fetch complete', {
      provider: this.config.providerName,
      requested: urls.length,
      successful: results.size,
      failed: urls.length - results.size,
    });

    return results;
  }

  /**
   * Invalidate cache for a specific URL
   *
   * @param url - URL to invalidate
   * @param context - Service context
   */
  async invalidateCache(url: string, context: ServiceContext): Promise<void> {
    const cacheKey = await this.buildCacheKey(url);
    try {
      await context.env.CACHE.delete(cacheKey);
      context.logger.debug('Cache invalidated', {
        provider: this.config.providerName,
        cacheKey,
      });
    } catch (error) {
      context.logger.warn('Cache invalidation failed', {
        provider: this.config.providerName,
        cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // =================================================================================
  // Private Helper Methods
  // =================================================================================

  private async enforceRateLimit(context: ServiceContext): Promise<void> {
    const rateLimitKey = buildRateLimitKey(this.config.providerName as Provider);
    await enforceRateLimit(
      context.env.CACHE,
      rateLimitKey,
      this.config.rateLimitMs,
      context.logger
    );
  }

  private async getFromCache<T>(
    url: string,
    context: ServiceContext
  ): Promise<T | null> {
    const cacheKey = await this.buildCacheKey(url);
    return getCachedResponse<T>(context.env.CACHE, cacheKey, context.logger);
  }

  private async saveToCache<T>(
    url: string,
    data: T,
    context: ServiceContext
  ): Promise<void> {
    const cacheKey = await this.buildCacheKey(url);
    await setCachedResponse(
      context.env.CACHE,
      cacheKey,
      data,
      this.config.cacheTtlSeconds,
      context.logger
    );
  }

  /**
   * Build cache key with automatic SHA-256 hashing for long URLs
   *
   * Cloudflare KV has a 512-byte key length limit. URLs exceeding this limit
   * (e.g., Wikidata SPARQL queries with 1000+ characters) must be hashed.
   *
   * Strategy:
   * - URLs <512 bytes: Use URL directly (human-readable)
   * - URLs >=512 bytes: Use SHA-256 hash (prevents KV errors)
   *
   * Hash Format: `${provider}:http:sha256:${hexHash}`
   *
   * @param url - Request URL
   * @returns Cache key (plain or hashed) under 512 bytes
   *
   * @example
   * ```typescript
   * // Short URL (no hashing)
   * buildCacheKey('https://openlibrary.org/isbn/9780553293357')
   * // Returns: "open-library:http:https://openlibrary.org/isbn/9780553293357"
   *
   * // Long URL (with hashing)
   * buildCacheKey('https://query.wikidata.org/sparql?query=SELECT...[1500 chars]')
   * // Returns: "wikidata:http:sha256:a1b2c3d4..."
   * ```
   */
  private async buildCacheKey(url: string): Promise<string> {
    const plainKey = buildCacheKey(this.config.providerName as Provider, 'http', url);

    // If key fits within KV limit, use it directly
    if (plainKey.length < 512) {
      return plainKey;
    }

    // Hash long URLs using native Web Crypto API (SHA-256)
    try {
      const msgBuffer = new TextEncoder().encode(url);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      return buildCacheKey(this.config.providerName as Provider, 'http', `sha256:${hashHex}`);
    } catch (hashError) {
      // Fallback: truncate URL if hashing fails (shouldn't happen in Workers)
      const truncated = url.substring(0, 400);
      return buildCacheKey(this.config.providerName as Provider, 'http', truncated);
    }
  }

  private shouldReadCache(context: ServiceContext): boolean {
    const strategy = context.cacheStrategy ?? 'read-write';
    return strategy === 'read-write' || strategy === 'read-only';
  }

  private shouldWriteCache(context: ServiceContext): boolean {
    // Don't cache if TTL is 0 (AI providers, ephemeral data)
    if (this.config.cacheTtlSeconds === 0) {
      return false;
    }
    const strategy = context.cacheStrategy ?? 'read-write';
    return strategy === 'read-write' || strategy === 'write-only';
  }

  private shouldEnforceRateLimit(context: ServiceContext): boolean {
    const strategy = context.rateLimitStrategy ?? 'enforce';
    return strategy === 'enforce';
  }

  /**
   * Extract operation name from URL for analytics
   *
   * Attempts to extract a meaningful operation name from the URL path.
   * Falls back to 'fetch' if extraction fails.
   *
   * @param url - Request URL
   * @returns Operation name (e.g., 'search', 'metadata', 'cover')
   */
  private extractOperation(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);

      // For API endpoints, use last segment (e.g., /api/search → 'search')
      if (pathSegments.length > 0) {
        return pathSegments[pathSegments.length - 1].toLowerCase();
      }

      return 'fetch';
    } catch {
      return 'fetch';
    }
  }

  private handleFetchError(error: unknown, url: string, logger: any): void {
    if (error instanceof HTTPError) {
      logger.error('HTTP error', {
        provider: this.config.providerName,
        url,
        status: error.status,
        statusText: error.statusText,
      });
    } else if (error instanceof JSONParseError) {
      logger.error('JSON parse error', {
        provider: this.config.providerName,
        url,
        error: error.message,
      });
    } else if (error instanceof TimeoutError) {
      logger.error('Request timeout', {
        provider: this.config.providerName,
        url,
        timeoutMs: error.timeoutMs,
      });
    } else if (error instanceof Error && error.message.includes('cancelled by caller')) {
      // Request was aborted by orchestrator (not a timeout)
      logger.warn('Request cancelled', {
        provider: this.config.providerName,
        url,
        reason: 'orchestrator_timeout',
      });
    } else {
      logger.error('Fetch error', {
        provider: this.config.providerName,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
