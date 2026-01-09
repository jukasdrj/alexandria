/**
 * Open API Utilities - Shared utilities for Archive.org, Wikipedia, and Wikidata
 *
 * Provides:
 * - KV-backed rate limiting (distributed across Worker isolates)
 * - User-Agent construction with donation links
 * - Response caching with configurable TTLs
 * - Structured error handling following Alexandria patterns
 *
 * @module lib/open-api-utils
 */

import type { Logger } from './logger.js';

// Note: KVNamespace is a global type from Cloudflare Workers runtime
// No explicit import needed - TypeScript automatically recognizes it from wrangler.toml types

// =================================================================================
// Constants & Configuration
// =================================================================================

/**
 * Provider-specific rate limits (milliseconds between requests)
 * These are conservative limits to be good API citizens
 *
 * Based on expert review recommendations:
 * - Archive.org: 1 req/sec (no hard limit, but respectful)
 * - Wikipedia: 1 req/sec (bot policy: max 200 req/sec, we use 1/sec)
 * - Wikidata: 2 req/sec (SPARQL endpoint: max 60 req/min)
 */
export const RATE_LIMITS = {
  'archive.org': 1000,       // 1 second
  'wikipedia': 1000,         // 1 second
  'wikidata': 500,           // 500ms (2 req/sec)
} as const;

/**
 * Provider-specific cache TTLs (seconds)
 */
export const CACHE_TTLS = {
  'archive.org': 604800,     // 7 days (covers may update)
  'wikipedia': 2592000,      // 30 days (biographies rarely change)
  'wikidata': 2592000,       // 30 days (metadata stable)
} as const;

/**
 * Donation URLs for User-Agent strings
 */
export const DONATION_URLS = {
  'archive.org': 'https://archive.org/donate',
  'wikipedia': 'https://donate.wikimedia.org',
  'wikidata': 'https://donate.wikimedia.org',
} as const;

/**
 * Provider types
 */
export type Provider = keyof typeof RATE_LIMITS;

/**
 * Contact information for User-Agent
 */
const CONTACT_EMAIL = 'nerd@ooheynerds.com';

/**
 * Alexandria version (from package.json)
 */
const ALEXANDRIA_VERSION = '2.3.0';

// =================================================================================
// Rate Limiting
// =================================================================================

/**
 * Enforce rate limit using KV storage for distributed coordination
 *
 * Follows the pattern from cover-fetcher.ts (lines 84-109):
 * - Uses KV to track last request timestamp across Worker isolates
 * - Waits if necessary to respect rate limit
 * - Gracefully handles KV unavailability (logs warning, continues)
 * - Uses 60s TTL on KV entries for automatic cleanup
 *
 * @param kv - KV namespace for rate limiting state
 * @param kvKey - Unique key for this rate limit (e.g., 'rate_limit:wikipedia')
 * @param minDelayMs - Minimum delay between requests in milliseconds
 * @param logger - Optional logger for warnings/debug
 * @returns Promise that resolves when rate limit allows request
 *
 * @example
 * ```typescript
 * await enforceRateLimit(env.CACHE, 'rate_limit:wikipedia', RATE_LIMITS['wikipedia'], logger);
 * // Now safe to make Wikipedia API request
 * ```
 */
export async function enforceRateLimit(
  kv: KVNamespace,
  kvKey: string,
  minDelayMs: number,
  logger?: Logger
): Promise<void> {
  const now = Date.now();

  try {
    // Fetch last request timestamp from KV
    const lastRequestStr = await kv.get(kvKey);
    const lastRequest = lastRequestStr ? parseInt(lastRequestStr, 10) : 0;
    const timeSinceLastRequest = now - lastRequest;

    // If not enough time has passed, wait
    if (timeSinceLastRequest < minDelayMs) {
      const waitTime = minDelayMs - timeSinceLastRequest;

      if (logger) {
        logger.debug(`Rate limit: waiting ${waitTime}ms`, { kvKey, minDelayMs });
      }

      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Update KV with current timestamp (60s TTL for auto-cleanup)
    await kv.put(kvKey, Date.now().toString(), { expirationTtl: 60 });

  } catch (error) {
    // Graceful degradation: log warning and continue without rate limiting
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (logger) {
      logger.warn('KV rate limiting unavailable, proceeding without delay', {
        kvKey,
        error: errorMsg
      });
    } else {
      console.warn(`[OpenAPI] KV rate limiting unavailable (${kvKey}): ${errorMsg}`);
    }
  }
}

// =================================================================================
// User-Agent Construction
// =================================================================================

/**
 * Build provider-specific User-Agent string with donation link
 *
 * Follows best practices for API citizenship:
 * - Identifies our application and version
 * - Provides contact email for API operators
 * - Describes our purpose
 * - Includes donation link to support the service
 *
 * Format: "Alexandria/{version} ({contact}; {purpose}; Donate: {donation_url})"
 *
 * @param provider - Provider name (archive.org, wikipedia, wikidata)
 * @param purpose - Brief description of how we use the API
 * @returns Formatted User-Agent string
 *
 * @example
 * ```typescript
 * buildUserAgent('wikipedia', 'Author biographies')
 * // Returns: "Alexandria/2.3.0 (nerd@ooheynerds.com; Author biographies; Donate: https://donate.wikimedia.org)"
 * ```
 */
export function buildUserAgent(provider: Provider, purpose: string): string {
  const donationUrl = DONATION_URLS[provider];
  return `Alexandria/${ALEXANDRIA_VERSION} (${CONTACT_EMAIL}; ${purpose}; Donate: ${donationUrl})`;
}

// =================================================================================
// Response Caching
// =================================================================================

/**
 * Cache key pattern for responses
 * Format: "{provider}:{type}:{identifier}"
 *
 * Examples:
 * - "wikipedia:bio:J._K._Rowling" (Biography from page title)
 * - "archive.org:cover:9780553293357" (Cover from ISBN)
 * - "wikidata:entity:Q42" (Entity data for Douglas Adams)
 */

/**
 * Get cached response from KV
 *
 * @param kv - KV namespace for caching
 * @param cacheKey - Cache key (e.g., "wikipedia:bio:J._K._Rowling")
 * @param logger - Optional logger for debug info
 * @returns Parsed JSON data from cache, or null if not found/invalid
 *
 * @example
 * ```typescript
 * const cached = await getCachedResponse<WikipediaBio>(env.CACHE, 'wikipedia:bio:J._K._Rowling', logger);
 * if (cached) {
 *   return cached; // Cache hit
 * }
 * ```
 */
export async function getCachedResponse<T = any>(
  kv: KVNamespace,
  cacheKey: string,
  logger?: Logger
): Promise<T | null> {
  try {
    const cachedData = await kv.get(cacheKey, 'text');

    if (!cachedData) {
      if (logger) {
        logger.debug('Cache miss', { cacheKey });
      }
      return null;
    }

    // Parse JSON response
    const parsed = JSON.parse(cachedData) as T;

    if (logger) {
      logger.debug('Cache hit', { cacheKey });
    }

    return parsed;

  } catch (error) {
    // Graceful degradation: log warning and return null (cache miss)
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (logger) {
      logger.warn('Cache read failed', { cacheKey, error: errorMsg });
    } else {
      console.warn(`[OpenAPI] Cache read failed (${cacheKey}): ${errorMsg}`);
    }

    return null;
  }
}

/**
 * Store response in KV cache
 *
 * @param kv - KV namespace for caching
 * @param cacheKey - Cache key (e.g., "wikipedia:bio:J._K._Rowling")
 * @param data - Data to cache (will be JSON stringified)
 * @param ttlSeconds - TTL in seconds (use CACHE_TTLS constants)
 * @param logger - Optional logger for debug info
 * @returns Promise that resolves when cache write completes (or fails gracefully)
 *
 * @example
 * ```typescript
 * await setCachedResponse(
 *   env.CACHE,
 *   'wikipedia:bio:J._K._Rowling',
 *   bioData,
 *   CACHE_TTLS['wikipedia'],
 *   logger
 * );
 * ```
 */
export async function setCachedResponse(
  kv: KVNamespace,
  cacheKey: string,
  data: any,
  ttlSeconds: number,
  logger?: Logger
): Promise<void> {
  try {
    const serialized = JSON.stringify(data);
    await kv.put(cacheKey, serialized, { expirationTtl: ttlSeconds });

    if (logger) {
      logger.debug('Cache write success', {
        cacheKey,
        ttlSeconds,
        sizeBytes: serialized.length
      });
    }

  } catch (error) {
    // Graceful degradation: log warning and continue (cache write failure is non-fatal)
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (logger) {
      logger.warn('Cache write failed', { cacheKey, error: errorMsg });
    } else {
      console.warn(`[OpenAPI] Cache write failed (${cacheKey}): ${errorMsg}`);
    }
  }
}

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Build cache key following Alexandria pattern
 *
 * @param provider - Provider name
 * @param type - Data type (e.g., 'bio', 'cover', 'entity')
 * @param identifier - Unique identifier (ISBN, page title, Wikidata QID, etc.)
 * @returns Formatted cache key
 *
 * @example
 * ```typescript
 * buildCacheKey('wikipedia', 'bio', 'J._K._Rowling')
 * // Returns: "wikipedia:bio:J._K._Rowling"
 * ```
 */
export function buildCacheKey(provider: Provider, type: string, identifier: string): string {
  return `${provider}:${type}:${identifier}`;
}

/**
 * Build KV rate limit key following Alexandria pattern
 *
 * @param provider - Provider name
 * @returns Formatted rate limit KV key
 *
 * @example
 * ```typescript
 * buildRateLimitKey('wikipedia')
 * // Returns: "rate_limit:wikipedia"
 * ```
 */
export function buildRateLimitKey(provider: Provider): string {
  return `rate_limit:${provider}`;
}
