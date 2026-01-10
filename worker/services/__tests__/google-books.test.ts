/**
 * Unit Tests for Google Books Subject Enrichment Service
 *
 * Tests:
 * - Metadata fetching with categories
 * - Category extraction and normalization
 * - Caching behavior
 * - Rate limiting integration
 * - Error handling and graceful degradation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchGoogleBooksMetadata,
  extractGoogleBooksCategories,
  batchExtractCategories,
} from '../google-books.js';
import type { Env } from '../../src/env.js';

// =================================================================================
// Mock Setup
// =================================================================================

/**
 * Create mock environment with KV namespaces and secrets
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  const mockKV = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
  };

  const mockSecret = {
    get: vi.fn().mockResolvedValue('test-api-key'),
  };

  return {
    CACHE: mockKV as any,
    QUOTA_KV: mockKV as any,
    GOOGLE_BOOKS_API_KEY: mockSecret as any,
    ...overrides,
  } as Env;
}

/**
 * Mock Google Books API response
 */
const mockGoogleBooksResponse = {
  items: [
    {
      id: 'test-volume-id',
      volumeInfo: {
        title: 'Harry Potter and the Philosopher\'s Stone',
        authors: ['J.K. Rowling'],
        publisher: 'Bloomsbury',
        publishedDate: '1997-06-26',
        pageCount: 223,
        language: 'en',
        description: 'First book in the Harry Potter series',
        categories: ['Fiction', 'Fantasy', 'Young Adult'],
        imageLinks: {
          thumbnail: 'https://books.google.com/thumbnail.jpg',
          smallThumbnail: 'https://books.google.com/small.jpg',
        },
        industryIdentifiers: [
          { type: 'ISBN_13', identifier: '9780747532743' },
          { type: 'ISBN_10', identifier: '0747532745' },
        ],
      },
    },
  ],
};

/**
 * Mock Google Books response with split categories
 */
const mockSplitCategoriesResponse = {
  items: [
    {
      id: 'test-volume-id-2',
      volumeInfo: {
        title: 'Test Book',
        authors: ['Test Author'],
        categories: ['Fiction / Fantasy', 'Young Adult / Adventure'],
      },
    },
  ],
};

/**
 * Mock empty Google Books response (no results)
 */
const mockEmptyResponse = {
  items: [],
};

// =================================================================================
// Tests
// =================================================================================

describe('Google Books Subject Enrichment Service', () => {
  let mockEnv: Env;
  let fetchMock: typeof global.fetch;

  beforeEach(() => {
    mockEnv = createMockEnv();
    fetchMock = vi.fn() as any;
    global.fetch = fetchMock;

    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('fetchGoogleBooksMetadata', () => {
    it('should fetch and parse Google Books metadata with categories', async () => {
      // Mock successful API response
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGoogleBooksResponse,
      });

      const result = await fetchGoogleBooksMetadata('9780747532743', mockEnv);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Harry Potter and the Philosopher\'s Stone');
      expect(result?.authors).toEqual(['J.K. Rowling']);
      expect(result?.categories).toEqual(['Fiction', 'Fantasy', 'Young Adult']);
      expect(result?.confidence).toBeGreaterThan(0);
      expect(result?.fetchedAt).toBeDefined();
    });

    it('should normalize split categories (Fiction / Fantasy)', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSplitCategoriesResponse,
      });

      const result = await fetchGoogleBooksMetadata('9780747532743', mockEnv);

      expect(result).not.toBeNull();
      expect(result?.categories).toEqual(['Fiction', 'Fantasy', 'Young Adult', 'Adventure']);
    });

    it('should return cached result on second call', async () => {
      // Mock cache hit on second call
      const cachedData = {
        volumeId: 'cached-id',
        title: 'Cached Book',
        categories: ['Cached', 'Category'],
        confidence: 85,
        fetchedAt: new Date().toISOString(),
      };

      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGoogleBooksResponse,
      });

      // First call - cache miss
      (mockEnv.CACHE.get as any).mockResolvedValueOnce(null);
      const result1 = await fetchGoogleBooksMetadata('9780747532743', mockEnv);
      expect(result1).not.toBeNull();
      expect(result1?.title).toBe('Harry Potter and the Philosopher\'s Stone');

      // Second call - cache hit (return stringified cached data)
      (mockEnv.CACHE.get as any).mockResolvedValueOnce(JSON.stringify(cachedData));
      const result2 = await fetchGoogleBooksMetadata('9780747532743', mockEnv);
      expect(result2?.title).toBe('Cached Book');
      expect(result2?.categories).toEqual(['Cached', 'Category']);
    });

    it('should return null for invalid ISBN', async () => {
      const result = await fetchGoogleBooksMetadata('invalid-isbn', mockEnv);
      expect(result).toBeNull();
    });

    it('should return null when API key is not configured', async () => {
      const envWithoutKey = createMockEnv({
        GOOGLE_BOOKS_API_KEY: {
          get: vi.fn().mockResolvedValue(null),
        } as any,
      });

      const result = await fetchGoogleBooksMetadata('9780747532743', envWithoutKey);
      expect(result).toBeNull();
    });

    it('should return null when API returns 404', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await fetchGoogleBooksMetadata('9780000000000', mockEnv);
      expect(result).toBeNull();
    });

    it('should return null when no items in response', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockEmptyResponse,
      });

      const result = await fetchGoogleBooksMetadata('9780000000000', mockEnv);
      expect(result).toBeNull();
    });

    it('should handle books without categories gracefully', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'test-id',
              volumeInfo: {
                title: 'Book Without Categories',
                authors: ['Test Author'],
              },
            },
          ],
        }),
      });

      const result = await fetchGoogleBooksMetadata('9780747532743', mockEnv);
      expect(result).not.toBeNull();
      expect(result?.categories).toBeUndefined();
    });

    it('should calculate confidence score correctly', async () => {
      // High confidence: has everything
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGoogleBooksResponse,
      });

      const result1 = await fetchGoogleBooksMetadata('9780747532743', mockEnv);
      expect(result1?.confidence).toBeGreaterThanOrEqual(90);

      // Lower confidence: missing categories
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'test-id',
              volumeInfo: {
                title: 'Minimal Book',
              },
            },
          ],
        }),
      });

      const result2 = await fetchGoogleBooksMetadata('9780000000001', mockEnv);
      expect(result2?.confidence).toBeLessThan(90);
    });

    it('should store result in cache with correct TTL', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGoogleBooksResponse,
      });

      await fetchGoogleBooksMetadata('9780747532743', mockEnv);

      expect(mockEnv.CACHE.put).toHaveBeenCalledWith(
        expect.stringContaining('google-books:metadata:9780747532743'),
        expect.any(String),
        { expirationTtl: 2592000 } // 30 days
      );
    });
  });

  describe('extractGoogleBooksCategories', () => {
    it('should extract only categories from metadata', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGoogleBooksResponse,
      });

      const categories = await extractGoogleBooksCategories('9780747532743', mockEnv);

      expect(categories).toEqual(['Fiction', 'Fantasy', 'Young Adult']);
    });

    it('should return empty array when no categories available', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'test-id',
              volumeInfo: {
                title: 'Book Without Categories',
              },
            },
          ],
        }),
      });

      const categories = await extractGoogleBooksCategories('9780747532743', mockEnv);

      expect(categories).toEqual([]);
    });

    it('should return empty array on API error', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const categories = await extractGoogleBooksCategories('9780747532743', mockEnv);

      expect(categories).toEqual([]);
    });
  });

  describe('batchExtractCategories', () => {
    it('should process multiple ISBNs and return Map', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGoogleBooksResponse,
      });

      const isbns = ['9780747532743', '9780747532750', '9780747532767'];
      const results = await batchExtractCategories(isbns, mockEnv);

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(3);
      expect(results.get('9780747532743')).toEqual(['Fiction', 'Fantasy', 'Young Adult']);
    });

    it('should handle failures gracefully in batch processing', async () => {
      let callCount = 0;
      (fetchMock as any).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          // Second call fails
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockGoogleBooksResponse,
        });
      });

      const isbns = ['9780747532743', '9780000000000', '9780747532767'];
      const results = await batchExtractCategories(isbns, mockEnv);

      expect(results.size).toBe(3);
      expect(results.get('9780747532743')).toEqual(['Fiction', 'Fantasy', 'Young Adult']);
      expect(results.get('9780000000000')).toEqual([]); // Failed ISBN
      expect(results.get('9780747532767')).toEqual(['Fiction', 'Fantasy', 'Young Adult']);
    });

    it('should call rate limiter for each ISBN in batch', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGoogleBooksResponse,
      });

      const isbns = ['9780747532743', '9780747532750', '9780747532767'];
      await batchExtractCategories(isbns, mockEnv);

      // Verify rate limiting was checked for each ISBN
      // Note: KV.get called twice per ISBN (once for rate limit, once for cache check)
      expect(mockEnv.CACHE.get).toHaveBeenCalledTimes(isbns.length * 2);
    });
  });

  describe('Category Normalization', () => {
    it('should deduplicate categories', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'test-id',
              volumeInfo: {
                title: 'Test Book',
                categories: ['Fiction', 'Fantasy', 'Fiction'], // Duplicate
              },
            },
          ],
        }),
      });

      const result = await fetchGoogleBooksMetadata('9780747532743', mockEnv);

      expect(result?.categories).toEqual(['Fiction', 'Fantasy']); // No duplicate
    });

    it('should trim whitespace from categories', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'test-id',
              volumeInfo: {
                title: 'Test Book',
                categories: ['  Fiction  ', ' Fantasy ', 'Young Adult'],
              },
            },
          ],
        }),
      });

      const result = await fetchGoogleBooksMetadata('9780747532743', mockEnv);

      expect(result?.categories).toEqual(['Fiction', 'Fantasy', 'Young Adult']);
    });

    it('should filter out empty categories', async () => {
      (fetchMock as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'test-id',
              volumeInfo: {
                title: 'Test Book',
                categories: ['Fiction', '', '  ', 'Fantasy'],
              },
            },
          ],
        }),
      });

      const result = await fetchGoogleBooksMetadata('9780747532743', mockEnv);

      expect(result?.categories).toEqual(['Fiction', 'Fantasy']);
    });
  });
});
