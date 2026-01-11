import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAuthorBiography } from '../wikipedia.js';
import type { Env } from '../../src/env.js';
import type { Sql } from 'postgres';

// Mock fetchWithRetry
vi.mock('../../lib/fetch-utils.js', () => ({
  fetchWithRetry: vi.fn(),
}));

// Mock open-api-utils
vi.mock('../../lib/open-api-utils.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
  buildRateLimitKey: (api: string) => `rate_limit:${api}`,
  buildCacheKey: (provider: string, type: string, identifier: string) =>
    `${provider}:${type}:${identifier}`,
  buildUserAgent: (provider: string, purpose: string) =>
    `Alexandria/2.3.0 (test@test.com; ${purpose})`,
  trackOpenApiUsage: vi.fn().mockResolvedValue(undefined),
  getCachedResponse: vi.fn().mockResolvedValue(null),
  setCachedResponse: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    'wikipedia': 1000,
  },
  CACHE_TTLS: {
    'wikipedia': 2592000,
  },
}));

import { fetchWithRetry } from '../../lib/fetch-utils.js';
import { getCachedResponse } from '../../lib/open-api-utils.js';

const mockFetchWithRetry = fetchWithRetry as any;
const mockGetCachedResponse = getCachedResponse as any;

// Mock SQL
const createMockSql = () => {
  const mock = vi.fn() as any;
  return mock;
};

// Mock environment
const createMockEnv = (): Env => ({
  CACHE: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  } as any,
  ANALYTICS: {
    writeDataPoint: vi.fn().mockResolvedValue(undefined),
  } as any,
} as any);

// Mock logger
const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('wikipedia', () => {
  beforeEach(() => {
    // Reset fetch mock between tests to avoid interference
    mockFetchWithRetry.mockReset();
  });

  describe('fetchAuthorBiography', () => {
    it('should fetch biography using Wikidata ID from enriched_authors', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock database query
      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL23919A',
          wikidata_id: 'Q34660',
          name: 'J. K. Rowling',
        },
      ]);

      // Mock Wikidata API call (get Wikipedia page title)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q34660: {
              sitelinks: {
                enwiki: {
                  title: 'J._K._Rowling',
                },
              },
            },
          },
        }),
      });

      // Mock Wikipedia API call (get extract)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '143751': {
                title: 'J. K. Rowling',
                extract: 'Joanne Rowling, known by her pen name J. K. Rowling, is a British author and philanthropist...',
                categories: [
                  { title: 'Category:1965 births' },
                  { title: 'Category:English novelists' },
                  { title: 'Category:British writers' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      expect(result).toBeTruthy();
      expect(result?.extract).toContain('Joanne Rowling');
      expect(result?.article_title).toBe('J. K. Rowling');
      expect(result?.wikidata_qid).toBe('Q34660');
      expect(result?.birth_year).toBe(1965);
      expect(result?.confidence).toBeGreaterThan(50);
    });

    it('should fallback to name-based search when no Wikidata ID', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      // Ensure cache returns null for this test
      mockGetCachedResponse.mockResolvedValueOnce(null);

      // Mock database query (no Wikidata ID)
      sql.mockImplementation(async () => [
        {
          author_key: '/authors/OL999999A',
          wikidata_id: null,
          name: 'Unknown Author',
        },
      ]);

      // Mock Wikipedia OpenSearch
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ['Unknown Author', ['Unknown Author'], [], []],
      });

      // Mock Wikipedia API call (get extract)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '123456': {
                title: 'Unknown Author',
                extract: 'Unknown Author is a writer who has published numerous works across multiple genres...',
                categories: [
                  { title: 'Category:Living people' },
                  { title: 'Category:American writers' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL999999A', env);

      expect(result).toBeTruthy();
      expect(result?.extract).toContain('Unknown Author is a writer who has published');
      expect(result?.article_title).toBe('Unknown Author');
      expect(result?.wikidata_qid).toBeUndefined();
    });

    it('should return null when author not found in database', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([]); // No results

      const result = await fetchAuthorBiography(sql, '/authors/OL999999A', env);

      expect(result).toBeNull();
    });

    it('should return null when Wikipedia page not found', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock database query
      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL23919A',
          wikidata_id: 'Q34660',
          name: 'J. K. Rowling',
        },
      ]);

      // Mock Wikidata API call (no Wikipedia page)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q34660: {
              sitelinks: {}, // No Wikipedia link
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      expect(result).toBeNull();
    });

    it('should extract birth year from categories', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL23919A',
          wikidata_id: 'Q34660',
          name: 'J. K. Rowling',
        },
      ]);

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q34660: { sitelinks: { enwiki: { title: 'J._K._Rowling' } } },
          },
        }),
      });

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '143751': {
                title: 'J. K. Rowling',
                extract: 'British author and writer of the Harry Potter fantasy series...',
                categories: [
                  { title: 'Category:1965 births' },
                  { title: 'Category:Living people' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      expect(result?.birth_year).toBe(1965);
    });

    it('should extract death year from categories', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL12345A',
          wikidata_id: 'Q12345',
          name: 'Historical Author',
        },
      ]);

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q12345: { sitelinks: { enwiki: { title: 'Historical_Author' } } },
          },
        }),
      });

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '987654': {
                title: 'Historical Author',
                extract: 'Was a writer and historian who published many important works during the 20th century...',
                categories: [
                  { title: 'Category:1920 births' },
                  { title: 'Category:2005 deaths' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL12345A', env);

      expect(result?.birth_year).toBe(1920);
      expect(result?.death_year).toBe(2005);
    });

    it('should extract nationality from categories', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL23919A',
          wikidata_id: 'Q34660',
          name: 'J. K. Rowling',
        },
      ]);

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q34660: { sitelinks: { enwiki: { title: 'J._K._Rowling' } } },
          },
        }),
      });

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '143751': {
                title: 'J. K. Rowling',
                extract: 'British author and writer of the Harry Potter fantasy series...',
                categories: [
                  { title: 'Category:1965 births' },
                  { title: 'Category:English novelists' },
                  { title: 'Category:British writers' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      expect(result?.nationality).toEqual(expect.arrayContaining(['English', 'British']));
    });

    it('should calculate confidence score correctly', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL23919A',
          wikidata_id: 'Q34660',
          name: 'J. K. Rowling',
        },
      ]);

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q34660: { sitelinks: { enwiki: { title: 'J._K._Rowling' } } },
          },
        }),
      });

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '143751': {
                title: 'J. K. Rowling',
                extract: 'Joanne Rowling is a British author and philanthropist known for writing the Harry Potter fantasy series...',
                categories: [
                  { title: 'Category:1965 births' },
                  { title: 'Category:English novelists' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      // High confidence: Wikidata ID (50) + extract (20) + birth year (15) + categories (10)
      expect(result?.confidence).toBeGreaterThanOrEqual(95);
    });

    it('should use cached data when available', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      const cachedData = {
        source: 'wikipedia' as const,
        article_title: 'Cached_Author',
        extract: 'Cached bio',
        wikidata_qid: 'Q12345',
        birth_year: 1965,
        confidence: 90,
        fetched_at: new Date().toISOString(),
        wikipedia_url: 'https://en.wikipedia.org/wiki/Cached_Author',
      };

      // Mock getCachedResponse to return cached data for this test
      mockGetCachedResponse.mockResolvedValueOnce(cachedData);

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      expect(result).toEqual(cachedData);
      // Note: Service uses console.log, not logger parameter
      expect(sql).not.toHaveBeenCalled();
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });

    it('should handle disambiguation pages gracefully', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL999999A',
          wikidata_id: null,
          name: 'John Smith',
        },
      ]);

      // Mock Wikipedia OpenSearch returns disambiguation page
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ['John Smith', ['John Smith (disambiguation)'], [], []],
      });

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '123': {
                title: 'John Smith (disambiguation)',
                extract: 'John Smith may refer to...',
                categories: [
                  { title: 'Category:Disambiguation pages' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL999999A', env);

      expect(result).toBeNull();
      // Note: Service uses console.log instead of logger parameter
    });

    it('should handle API errors gracefully', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL23919A',
          wikidata_id: 'Q34660',
          name: 'J. K. Rowling',
        },
      ]);

      mockFetchWithRetry.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      expect(result).toBeNull();
      // Note: Service uses console.error for errors
    });

    it('should handle missing categories gracefully', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([
        {
          author_key: '/authors/OL23919A',
          wikidata_id: 'Q34660',
          name: 'J. K. Rowling',
        },
      ]);

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q34660: { sitelinks: { enwiki: { title: 'J._K._Rowling' } } },
          },
        }),
      });

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '143751': {
                title: 'J. K. Rowling',
                extract: 'British author and writer of the Harry Potter fantasy series...',
                // No categories field
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env);

      expect(result).toBeTruthy();
      expect(result?.birth_year).toBeUndefined();
      expect(result?.death_year).toBeUndefined();
      expect(result?.nationality).toBeUndefined();
    });
  });
});
