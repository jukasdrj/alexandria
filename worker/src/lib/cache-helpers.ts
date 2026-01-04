/**
 * Cache helper utilities for combined search endpoint
 * Provides consistent cache key generation and TTL management
 */

import type { QueryType } from './query-detector.js';

/**
 * Builds consistent cache key for combined search
 * Format: combined:v1:{type}:{normalized_query}:l{limit}:o{offset}
 *
 * @param type - Detected query type (isbn, author, title)
 * @param query - Normalized query string
 * @param limit - Results per page
 * @param offset - Pagination offset
 * @returns Cache key string
 *
 * @example
 * buildCombinedCacheKey('isbn', '9780439064873', 10, 0)
 * // 'combined:v1:isbn:9780439064873:l10:o0'
 *
 * buildCombinedCacheKey('author', 'j. k. rowling', 20, 40)
 * // 'combined:v1:author:j._k._rowling:l20:o40'
 *
 * buildCombinedCacheKey('title', 'harry potter', 10, 0)
 * // 'combined:v1:title:harry_potter:l10:o0'
 */
export function buildCombinedCacheKey(
	type: QueryType,
	query: string,
	limit: number,
	offset: number
): string {
	// Normalize query for cache key consistency
	// - Convert to lowercase
	// - Replace spaces with underscores
	// - Remove special characters that might cause issues
	const normalized = query
		.toLowerCase()
		.replace(/\s+/g, '_')
		.replace(/[^a-z0-9_.-]/g, '');

	return `combined:v1:${type}:${normalized}:l${limit}:o${offset}`;
}

/**
 * Returns TTL (Time To Live) in seconds based on query type
 *
 * Strategy:
 * - ISBN: 24 hours (86400s) - Edition data rarely changes
 * - Author: 1 hour (3600s) - New works added occasionally
 * - Title: 1 hour (3600s) - Content updates and new books
 *
 * @param type - Query type
 * @returns TTL in seconds
 *
 * @example
 * getCacheTTL('isbn')    // 86400 (24 hours)
 * getCacheTTL('author')  // 3600 (1 hour)
 * getCacheTTL('title')   // 3600 (1 hour)
 */
export function getCacheTTL(type: QueryType): number {
	switch (type) {
		case 'isbn':
			return 86400; // 24 hours - ISBNs are immutable, editions rarely change

		case 'author':
			return 3600; // 1 hour - Author data relatively stable

		case 'title':
			return 3600; // 1 hour - Title searches may include new books

		default:
			return 3600; // Default: 1 hour
	}
}

/**
 * Optional cache invalidation helper
 * Deletes cache entries for a specific query
 *
 * Note: Cloudflare KV doesn't support wildcard deletion,
 * so this only invalidates the exact key provided.
 * For pagination variants, you'd need to track keys separately.
 *
 * @param cache - KV namespace
 * @param type - Query type
 * @param query - Normalized query string
 * @param limit - Optional limit (defaults to 10)
 * @param offset - Optional offset (defaults to 0)
 *
 * @example
 * await invalidateCombinedCache(env.CACHE, 'isbn', '9780439064873')
 * // Deletes: combined:v1:isbn:9780439064873:l10:o0
 */
export async function invalidateCombinedCache(
	cache: KVNamespace,
	type: QueryType,
	query: string,
	limit: number = 10,
	offset: number = 0
): Promise<void> {
	const key = buildCombinedCacheKey(type, query, limit, offset);
	await cache.delete(key);
}

/**
 * Batch cache invalidation helper
 * Invalidates multiple cache entries at once
 *
 * Useful when enrichment updates affect multiple queries
 * or when clearing cache for all pagination variants
 *
 * @param cache - KV namespace
 * @param keys - Array of cache keys to invalidate
 *
 * @example
 * const keys = [
 *   buildCombinedCacheKey('title', 'harry potter', 10, 0),
 *   buildCombinedCacheKey('title', 'harry potter', 10, 10),
 *   buildCombinedCacheKey('title', 'harry potter', 10, 20),
 * ];
 * await batchInvalidateCache(env.CACHE, keys);
 */
export async function batchInvalidateCache(
	cache: KVNamespace,
	keys: string[]
): Promise<void> {
	// KV delete operations are fast and can be done in parallel
	await Promise.all(keys.map((key) => cache.delete(key)));
}

/**
 * Generates all pagination cache keys for a query
 * Useful for pre-warming cache or batch invalidation
 *
 * @param type - Query type
 * @param query - Normalized query string
 * @param limit - Results per page
 * @param totalResults - Total number of results
 * @returns Array of cache keys for all pages
 *
 * @example
 * generatePaginationKeys('title', 'harry potter', 10, 47)
 * // Returns 5 keys: offset 0, 10, 20, 30, 40
 */
export function generatePaginationKeys(
	type: QueryType,
	query: string,
	limit: number,
	totalResults: number
): string[] {
	const keys: string[] = [];
	const totalPages = Math.ceil(totalResults / limit);

	for (let page = 0; page < totalPages; page++) {
		const offset = page * limit;
		keys.push(buildCombinedCacheKey(type, query, limit, offset));
	}

	return keys;
}
