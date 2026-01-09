import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchArchiveOrgCover, fetchArchiveOrgMetadata } from '../archive-org.js';
import type { Env } from '../../src/env.js';

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
    `Alexandria/2.3.0 (test@test.com; ${purpose}; https://test.com)`,
  trackOpenApiUsage: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    'archive.org': 1000,
  },
  CACHE_TTLS: {
    'archive.org': 604800,
  },
}));

import { fetchWithRetry } from '../../lib/fetch-utils.js';

const mockFetchWithRetry = fetchWithRetry as any;

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

describe('archive-org', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchArchiveOrgCover', () => {
    it('should fetch cover URL from Archive.org by ISBN', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock Archive.org metadata API response
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            cover: {
              small: 'https://covers.openlibrary.org/b/id/12345-S.jpg',
              medium: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
              large: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
            },
          },
        }),
      });

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result).toBeTruthy();
      expect(result?.url).toBe('https://covers.openlibrary.org/b/id/12345-L.jpg');
      expect(result?.source).toBe('archive-org');
      expect(result?.quality).toBe('high');
      expect(logger.info).toHaveBeenCalledWith(
        'Archive.org: Cover found',
        expect.objectContaining({ isbn: '9780439064873' })
      );
    });

    it('should return null when no cover found', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9999999999999': {}, // No cover field
        }),
      });

      const result = await fetchArchiveOrgCover('9999999999999', env, logger);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'Archive.org: No cover data found',
        expect.objectContaining({ isbn: '9999999999999' })
      );
    });

    it('should return cached cover when available', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      const cachedCover = {
        url: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
        source: 'archive-org' as const,
        quality: 'high' as const,
      };

      (env.CACHE.get as any).mockResolvedValueOnce(JSON.stringify(cachedCover));

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result).toEqual(cachedCover);
      expect(logger.debug).toHaveBeenCalledWith(
        'Archive.org: Using cached cover',
        expect.any(Object)
      );
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });

    it('should prefer large size over medium/small', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            cover: {
              small: 'https://covers.openlibrary.org/b/id/12345-S.jpg',
              medium: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
              large: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
            },
          },
        }),
      });

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result?.url).toBe('https://covers.openlibrary.org/b/id/12345-L.jpg');
      expect(result?.quality).toBe('high');
    });

    it('should fall back to medium size when large not available', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            cover: {
              small: 'https://covers.openlibrary.org/b/id/12345-S.jpg',
              medium: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
            },
          },
        }),
      });

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result?.url).toBe('https://covers.openlibrary.org/b/id/12345-M.jpg');
      expect(result?.quality).toBe('medium');
    });

    it('should fall back to small size when only small available', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            cover: {
              small: 'https://covers.openlibrary.org/b/id/12345-S.jpg',
            },
          },
        }),
      });

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result?.url).toBe('https://covers.openlibrary.org/b/id/12345-S.jpg');
      expect(result?.quality).toBe('low');
    });

    it('should handle API errors gracefully', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Archive.org: API error',
        expect.objectContaining({ status: 503 })
      );
    });

    it('should handle network errors gracefully', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Archive.org fetch error',
        expect.objectContaining({ error: 'Network timeout' })
      );
    });

    it('should handle invalid JSON responses', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await fetchArchiveOrgCover('9780439064873', env, logger);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('fetchArchiveOrgMetadata', () => {
    it('should fetch book metadata from Archive.org', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            title: 'Harry Potter and the Sorcerer\'s Stone',
            authors: [{ name: 'J. K. Rowling' }],
            publish_date: '1998',
            publishers: [{ name: 'Scholastic Inc.' }],
            number_of_pages: 309,
            subjects: [
              { name: 'Fiction' },
              { name: 'Fantasy' },
              { name: 'Magic' },
            ],
            cover: {
              large: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
            },
          },
        }),
      });

      const result = await fetchArchiveOrgMetadata('9780439064873', env, logger);

      expect(result).toBeTruthy();
      expect(result?.title).toBe('Harry Potter and the Sorcerer\'s Stone');
      expect(result?.authors).toEqual(['J. K. Rowling']);
      expect(result?.publish_date).toBe('1998');
      expect(result?.publishers).toEqual(['Scholastic Inc.']);
      expect(result?.number_of_pages).toBe(309);
      expect(result?.subjects).toEqual(['Fiction', 'Fantasy', 'Magic']);
      expect(result?.cover_url).toBe('https://covers.openlibrary.org/b/id/12345-L.jpg');
    });

    it('should return null when book not found', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // Empty response
      });

      const result = await fetchArchiveOrgMetadata('9999999999999', env, logger);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'Archive.org: No metadata found',
        expect.objectContaining({ isbn: '9999999999999' })
      );
    });

    it('should use cached metadata when available', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      const cachedMetadata = {
        title: 'Cached Book',
        authors: ['Test Author'],
        publish_date: '2020',
      };

      (env.CACHE.get as any).mockResolvedValueOnce(JSON.stringify(cachedMetadata));

      const result = await fetchArchiveOrgMetadata('9780439064873', env, logger);

      expect(result).toEqual(cachedMetadata);
      expect(logger.debug).toHaveBeenCalledWith(
        'Archive.org: Using cached metadata',
        expect.any(Object)
      );
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });

    it('should handle partial metadata gracefully', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            title: 'Harry Potter',
            // Missing authors, publishers, etc.
          },
        }),
      });

      const result = await fetchArchiveOrgMetadata('9780439064873', env, logger);

      expect(result).toBeTruthy();
      expect(result?.title).toBe('Harry Potter');
      expect(result?.authors).toBeUndefined();
      expect(result?.publishers).toBeUndefined();
    });

    it('should extract author names from author objects', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            title: 'Test Book',
            authors: [
              { name: 'Author One' },
              { name: 'Author Two' },
            ],
          },
        }),
      });

      const result = await fetchArchiveOrgMetadata('9780439064873', env, logger);

      expect(result?.authors).toEqual(['Author One', 'Author Two']);
    });

    it('should extract subject names from subject objects', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'ISBN:9780439064873': {
            title: 'Test Book',
            subjects: [
              { name: 'Fiction' },
              { name: 'Adventure' },
              { name: 'Young Adult' },
            ],
          },
        }),
      });

      const result = await fetchArchiveOrgMetadata('9780439064873', env, logger);

      expect(result?.subjects).toEqual(['Fiction', 'Adventure', 'Young Adult']);
    });
  });
});
