/**
 * Cache Utilities for Alexandria Search Queries
 *
 * Strategy:
 * - ISBN queries: 24h TTL (exact matches, static data)
 * - Title/Author queries: 1h TTL (fuzzy matches, may change with new data)
 * - Cache key: hash of normalized query params
 */

import type { Env } from '../src/env.js';

export interface CacheConfig {
  ttlSeconds: number;
  enabled: boolean;
}

/**
 * Generate a cache key from search parameters
 * Format: search:{type}:{hash}
 */
export function generateCacheKey(
  queryType: 'isbn' | 'title' | 'author',
  value: string,
  limit: number,
  offset: number
): string {
  // Normalize the value (lowercase, trim)
  const normalized = value.toLowerCase().trim();

  // Simple hash for readability (KV keys are limited to 512 bytes)
  return `search:${queryType}:${normalized.slice(0, 50)}:${limit}:${offset}`;
}

/**
 * Get cached search results from KV
 */
export async function getCachedResults(
  cache: KVNamespace,
  cacheKey: string
): Promise<any | null> {
  if (!cache) {
    return null;
  }

  try {
    const cached = await cache.get(cacheKey, 'json');
    if (cached) {
      console.log(`[Cache] HIT: ${cacheKey}`);
      return cached;
    }
    console.log(`[Cache] MISS: ${cacheKey}`);
    return null;
  } catch (error) {
    console.error(`[Cache] Error reading cache:`, error);
    return null;
  }
}

/**
 * Store search results in KV cache
 */
export async function setCachedResults(
  cache: KVNamespace,
  cacheKey: string,
  data: any,
  ttlSeconds: number
): Promise<void> {
  if (!cache) {
    return;
  }

  try {
    // Add cache metadata
    const cacheData = {
      ...data,
      cached_at: new Date().toISOString(),
      cache_ttl: ttlSeconds,
    };

    await cache.put(cacheKey, JSON.stringify(cacheData), {
      expirationTtl: ttlSeconds,
    });
    console.log(`[Cache] SET: ${cacheKey} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error(`[Cache] Error writing cache:`, error);
    // Don't throw - caching is non-critical
  }
}

/**
 * Get cache TTL based on query type
 */
export function getCacheTTL(
  queryType: 'isbn' | 'title' | 'author',
  env: Env
): number {
  switch (queryType) {
    case 'isbn':
      // ISBN queries are exact - cache longer
      return parseInt(env.CACHE_TTL_LONG || '86400', 10); // 24 hours
    case 'title':
    case 'author':
      // Fuzzy queries - cache shorter
      return parseInt(env.CACHE_TTL_MEDIUM || '3600', 10); // 1 hour
    default:
      return parseInt(env.CACHE_TTL_SHORT || '300', 10); // 5 minutes
  }
}

/**
 * Check if query caching is enabled
 */
export function isCacheEnabled(env: Env): boolean {
  return env.ENABLE_QUERY_CACHE === 'true';
}
