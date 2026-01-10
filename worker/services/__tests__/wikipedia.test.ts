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

const mockFetchWithRetry = fetchWithRetry as any;

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
    vi.clearAllMocks();
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

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

      expect(result).toBeTruthy();
      expect(result?.bio).toContain('Joanne Rowling');
      expect(result?.wikipedia_page_title).toBe('J._K._Rowling');
      expect(result?.wikidata_id).toBe('Q34660');
      expect(result?.birth_year).toBe(1965);
      expect(result?.confidence).toBeGreaterThan(50);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should fallback to name-based search when no Wikidata ID', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock database query (no Wikidata ID)
      sql.mockResolvedValueOnce([
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
                extract: 'Unknown Author is a writer...',
                categories: [
                  { title: 'Category:Living people' },
                  { title: 'Category:American writers' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL999999A', env, logger);

      expect(result).toBeTruthy();
      expect(result?.bio).toContain('Unknown Author is a writer');
      expect(result?.wikipedia_page_title).toBe('Unknown Author');
      expect(result?.wikidata_id).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Wikipedia: Using name-based lookup (no Wikidata ID)',
        expect.any(Object)
      );
    });

    it('should return null when author not found in database', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      sql.mockResolvedValueOnce([]); // No results

      const result = await fetchAuthorBiography(sql, '/authors/OL999999A', env, logger);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Wikipedia: Author not found',
        expect.objectContaining({ authorKey: '/authors/OL999999A' })
      );
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

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikipedia: No Wikipedia page found via Wikidata',
        expect.any(Object)
      );
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
                extract: 'British author...',
                categories: [
                  { title: 'Category:1965 births' },
                  { title: 'Category:Living people' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

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
                extract: 'Was a writer...',
                categories: [
                  { title: 'Category:1920 births' },
                  { title: 'Category:2005 deaths' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL12345A', env, logger);

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
                extract: 'British author...',
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

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

      expect(result?.nationality).toBe('English');
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
                extract: 'Joanne Rowling is a British author...',
                categories: [
                  { title: 'Category:1965 births' },
                  { title: 'Category:English novelists' },
                ],
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

      // High confidence: Wikidata ID (50) + extract (20) + birth year (15) + categories (10)
      expect(result?.confidence).toBeGreaterThanOrEqual(95);
    });

    it('should use cached data when available', async () => {
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      const cachedData = {
        bio: 'Cached bio',
        wikipedia_page_title: 'Cached_Author',
        wikidata_id: 'Q12345',
        birth_year: 1965,
        confidence: 90,
      };

      (env.CACHE.get as any).mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

      expect(result).toEqual(cachedData);
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikipedia: Using cached biography',
        expect.any(Object)
      );
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

      const result = await fetchAuthorBiography(sql, '/authors/OL999999A', env, logger);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Wikipedia: Disambiguation page detected, skipping',
        expect.any(Object)
      );
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

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Wikipedia fetch error',
        expect.objectContaining({ error: 'Network timeout' })
      );
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
                extract: 'British author...',
                // No categories field
              },
            },
          },
        }),
      });

      const result = await fetchAuthorBiography(sql, '/authors/OL23919A', env, logger);

      expect(result).toBeTruthy();
      expect(result?.birth_year).toBeNull();
      expect(result?.death_year).toBeNull();
      expect(result?.nationality).toBeNull();
    });
  });
});
