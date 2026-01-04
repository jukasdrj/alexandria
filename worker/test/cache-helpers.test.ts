import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	buildCombinedCacheKey,
	getCacheTTL,
	invalidateCombinedCache,
	batchInvalidateCache,
	generatePaginationKeys,
} from '../src/lib/cache-helpers.js';

describe('cache-helpers', () => {
	describe('buildCombinedCacheKey', () => {
		it('builds key for ISBN query', () => {
			const key = buildCombinedCacheKey('isbn', '9780439064873', 10, 0);
			expect(key).toBe('combined:v1:isbn:9780439064873:l10:o0');
		});

		it('builds key for author query', () => {
			const key = buildCombinedCacheKey('author', 'j. k. rowling', 10, 0);
			expect(key).toBe('combined:v1:author:j._k._rowling:l10:o0');
		});

		it('builds key for title query', () => {
			const key = buildCombinedCacheKey('title', 'harry potter', 10, 0);
			expect(key).toBe('combined:v1:title:harry_potter:l10:o0');
		});

		it('includes limit in cache key', () => {
			const key = buildCombinedCacheKey('title', 'fantasy', 20, 0);
			expect(key).toBe('combined:v1:title:fantasy:l20:o0');
		});

		it('includes offset in cache key', () => {
			const key = buildCombinedCacheKey('title', 'fantasy', 10, 30);
			expect(key).toBe('combined:v1:title:fantasy:l10:o30');
		});

		it('normalizes spaces to underscores', () => {
			const key = buildCombinedCacheKey(
				'title',
				'the great gatsby',
				10,
				0
			);
			expect(key).toBe('combined:v1:title:the_great_gatsby:l10:o0');
		});

		it('converts to lowercase', () => {
			const key = buildCombinedCacheKey('title', 'HARRY POTTER', 10, 0);
			expect(key).toBe('combined:v1:title:harry_potter:l10:o0');
		});

		it('removes special characters', () => {
			const key = buildCombinedCacheKey(
				'title',
				'harry potter & the goblet!',
				10,
				0
			);
			// Special chars removed, spaces to underscores
			expect(key).toBe('combined:v1:title:harry_potter__the_goblet:l10:o0');
		});

		it('handles multiple spaces', () => {
			const key = buildCombinedCacheKey(
				'title',
				'harry    potter',
				10,
				0
			);
			expect(key).toBe('combined:v1:title:harry_potter:l10:o0');
		});

		it('preserves hyphens and dots in normalized query', () => {
			const key = buildCombinedCacheKey('author', 'j.k. row-ling', 10, 0);
			expect(key).toBe('combined:v1:author:j.k._row-ling:l10:o0');
		});

		it('creates different keys for different pagination', () => {
			const key1 = buildCombinedCacheKey('title', 'fantasy', 10, 0);
			const key2 = buildCombinedCacheKey('title', 'fantasy', 10, 10);
			const key3 = buildCombinedCacheKey('title', 'fantasy', 20, 0);

			expect(key1).not.toBe(key2);
			expect(key1).not.toBe(key3);
			expect(key2).not.toBe(key3);
		});

		it('creates same key for identical parameters', () => {
			const key1 = buildCombinedCacheKey('title', 'fantasy', 10, 0);
			const key2 = buildCombinedCacheKey('title', 'fantasy', 10, 0);
			expect(key1).toBe(key2);
		});
	});

	describe('getCacheTTL', () => {
		it('returns 24 hours (86400s) for ISBN queries', () => {
			expect(getCacheTTL('isbn')).toBe(86400);
		});

		it('returns 1 hour (3600s) for author queries', () => {
			expect(getCacheTTL('author')).toBe(3600);
		});

		it('returns 1 hour (3600s) for title queries', () => {
			expect(getCacheTTL('title')).toBe(3600);
		});

		it('returns consistent TTLs for same query type', () => {
			const ttl1 = getCacheTTL('isbn');
			const ttl2 = getCacheTTL('isbn');
			expect(ttl1).toBe(ttl2);
		});

		it('returns different TTLs for different query types', () => {
			const isbnTTL = getCacheTTL('isbn');
			const authorTTL = getCacheTTL('author');
			const titleTTL = getCacheTTL('title');

			expect(isbnTTL).toBeGreaterThan(authorTTL);
			expect(authorTTL).toBe(titleTTL);
		});
	});

	describe('invalidateCombinedCache', () => {
		let mockCache: any;

		beforeEach(() => {
			mockCache = {
				delete: vi.fn().mockResolvedValue(undefined),
			};
		});

		it('deletes cache entry with correct key', async () => {
			await invalidateCombinedCache(
				mockCache,
				'isbn',
				'9780439064873',
				10,
				0
			);

			expect(mockCache.delete).toHaveBeenCalledWith(
				'combined:v1:isbn:9780439064873:l10:o0'
			);
			expect(mockCache.delete).toHaveBeenCalledTimes(1);
		});

		it('uses default limit and offset when not provided', async () => {
			await invalidateCombinedCache(mockCache, 'title', 'harry potter');

			expect(mockCache.delete).toHaveBeenCalledWith(
				'combined:v1:title:harry_potter:l10:o0'
			);
		});

		it('handles custom limit and offset', async () => {
			await invalidateCombinedCache(
				mockCache,
				'author',
				'stephen king',
				20,
				40
			);

			expect(mockCache.delete).toHaveBeenCalledWith(
				'combined:v1:author:stephen_king:l20:o40'
			);
		});

		it('normalizes query before building key', async () => {
			await invalidateCombinedCache(
				mockCache,
				'title',
				'The Great Gatsby'
			);

			expect(mockCache.delete).toHaveBeenCalledWith(
				'combined:v1:title:the_great_gatsby:l10:o0'
			);
		});
	});

	describe('batchInvalidateCache', () => {
		let mockCache: any;

		beforeEach(() => {
			mockCache = {
				delete: vi.fn().mockResolvedValue(undefined),
			};
		});

		it('deletes multiple cache entries', async () => {
			const keys = [
				'combined:v1:title:harry_potter:l10:o0',
				'combined:v1:title:harry_potter:l10:o10',
				'combined:v1:title:harry_potter:l10:o20',
			];

			await batchInvalidateCache(mockCache, keys);

			expect(mockCache.delete).toHaveBeenCalledTimes(3);
			expect(mockCache.delete).toHaveBeenCalledWith(keys[0]);
			expect(mockCache.delete).toHaveBeenCalledWith(keys[1]);
			expect(mockCache.delete).toHaveBeenCalledWith(keys[2]);
		});

		it('handles empty array', async () => {
			await batchInvalidateCache(mockCache, []);
			expect(mockCache.delete).not.toHaveBeenCalled();
		});

		it('handles single key', async () => {
			const keys = ['combined:v1:isbn:9780439064873:l10:o0'];
			await batchInvalidateCache(mockCache, keys);

			expect(mockCache.delete).toHaveBeenCalledTimes(1);
			expect(mockCache.delete).toHaveBeenCalledWith(keys[0]);
		});

		it('deletes all keys even if some fail', async () => {
			const keys = ['key1', 'key2', 'key3'];
			mockCache.delete = vi
				.fn()
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(new Error('Delete failed'))
				.mockResolvedValueOnce(undefined);

			// Should not throw, Promise.all will reject but we can catch
			await expect(
				batchInvalidateCache(mockCache, keys)
			).rejects.toThrow();

			// All deletes attempted
			expect(mockCache.delete).toHaveBeenCalledTimes(3);
		});
	});

	describe('generatePaginationKeys', () => {
		it('generates keys for all pages', () => {
			const keys = generatePaginationKeys(
				'title',
				'harry potter',
				10,
				47
			);

			expect(keys).toHaveLength(5); // 47 results / 10 per page = 5 pages
			expect(keys[0]).toBe('combined:v1:title:harry_potter:l10:o0');
			expect(keys[1]).toBe('combined:v1:title:harry_potter:l10:o10');
			expect(keys[2]).toBe('combined:v1:title:harry_potter:l10:o20');
			expect(keys[3]).toBe('combined:v1:title:harry_potter:l10:o30');
			expect(keys[4]).toBe('combined:v1:title:harry_potter:l10:o40');
		});

		it('generates single key for results fitting in one page', () => {
			const keys = generatePaginationKeys('isbn', '9780439064873', 10, 1);

			expect(keys).toHaveLength(1);
			expect(keys[0]).toBe('combined:v1:isbn:9780439064873:l10:o0');
		});

		it('generates correct number of keys for exact page boundary', () => {
			const keys = generatePaginationKeys('title', 'fantasy', 10, 30);

			expect(keys).toHaveLength(3); // Exactly 3 pages
			expect(keys[0]).toBe('combined:v1:title:fantasy:l10:o0');
			expect(keys[1]).toBe('combined:v1:title:fantasy:l10:o10');
			expect(keys[2]).toBe('combined:v1:title:fantasy:l10:o20');
		});

		it('handles zero results', () => {
			const keys = generatePaginationKeys('title', 'nonexistent', 10, 0);
			expect(keys).toHaveLength(0);
		});

		it('handles large result sets', () => {
			const keys = generatePaginationKeys('title', 'love', 10, 1234);

			expect(keys).toHaveLength(124); // 1234 / 10 = 123.4 -> 124 pages
			expect(keys[0]).toBe('combined:v1:title:love:l10:o0');
			expect(keys[123]).toBe('combined:v1:title:love:l10:o1230');
		});

		it('respects custom limit sizes', () => {
			const keys = generatePaginationKeys('title', 'fantasy', 20, 47);

			expect(keys).toHaveLength(3); // 47 / 20 = 2.35 -> 3 pages
			expect(keys[0]).toBe('combined:v1:title:fantasy:l20:o0');
			expect(keys[1]).toBe('combined:v1:title:fantasy:l20:o20');
			expect(keys[2]).toBe('combined:v1:title:fantasy:l20:o40');
		});

		it('generates keys for different query types', () => {
			const isbnKeys = generatePaginationKeys(
				'isbn',
				'9780439064873',
				10,
				1
			);
			const authorKeys = generatePaginationKeys(
				'author',
				'stephen king',
				10,
				25
			);
			const titleKeys = generatePaginationKeys(
				'title',
				'harry potter',
				10,
				47
			);

			expect(isbnKeys[0]).toContain(':isbn:');
			expect(authorKeys[0]).toContain(':author:');
			expect(titleKeys[0]).toContain(':title:');
		});
	});
});
