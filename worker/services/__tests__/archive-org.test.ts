import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchArchiveOrgCover, fetchArchiveOrgMetadata } from '../archive-org.js';
import type { Env } from '../../src/env.js';

// Mock fetchWithRetry
vi.mock('../../lib/fetch-utils.js', () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock('../../lib/open-api-utils.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
  buildRateLimitKey: (api: string) => `rate_limit:${api}`,
  buildCacheKey: (provider: string, type: string, identifier: string) =>
    `${provider}:${type}:${identifier}`,
  buildUserAgent: (provider: string, purpose: string) =>
    `Alexandria/2.3.0 (test@test.com; ${purpose}; https://test.com)`,
  trackOpenApiUsage: vi.fn().mockResolvedValue(undefined),
  getCachedResponse: vi.fn().mockResolvedValue(null),
  setCachedResponse: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    'archive.org': 1000,
  },
  CACHE_TTLS: {
    'archive.org': 604800,
  },
}));

import { fetchWithRetry } from '../../lib/fetch-utils.js';
import { getCachedResponse } from '../../lib/open-api-utils.js';

const mockFetchWithRetry = fetchWithRetry as any;
const mockGetCachedResponse = getCachedResponse as any;

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
    it('should fetch cover using image service (fast path)', async () => {
      const env = createMockEnv();

      // Step 1: Search API (ISBN → identifier)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            docs: [{ identifier: 'harrypotterphilo00rowl' }],
          },
        }),
      });

      // Step 2: Image service HEAD request (identifier → cover URL)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'content-type') return 'image/jpeg';
            if (key === 'content-length') return '150000'; // 150KB
            return null;
          },
        },
      });

      const result = await fetchArchiveOrgCover('9780439064873', env);

      expect(result).toBeTruthy();
      expect(result?.url).toBe('https://archive.org/services/img/harrypotterphilo00rowl');
      expect(result?.source).toBe('archive-org');
      expect(result?.quality).toBe('high');
    });

    it('should return null when search finds no identifier', async () => {
      const env = createMockEnv();

      // Mock search API returning no results
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: { docs: [] },
        }),
      });

      const result = await fetchArchiveOrgCover('9999999999999', env);

      expect(result).toBeNull();
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1); // Only search, no image service
    });

    it('should use cached cover when available', async () => {
      const env = createMockEnv();

      const cachedCover = {
        url: 'https://archive.org/services/img/test',
        source: 'archive-org' as const,
        quality: 'high' as const,
      };

      mockGetCachedResponse.mockResolvedValueOnce(cachedCover);

      const result = await fetchArchiveOrgCover('9780439064873', env);

      expect(result).toEqual(cachedCover);
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });

    it('should detect quality based on file size', async () => {
      const env = createMockEnv();

      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: { docs: [{ identifier: 'test_id' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (key: string) => {
              if (key === 'content-type') return 'image/jpeg';
              if (key === 'content-length') return '50000'; // 50KB - medium quality
              return null;
            },
          },
        });

      const result = await fetchArchiveOrgCover('9780439064873', env);

      expect(result?.quality).toBe('medium');
    });

    it('should return null when image service fails and no metadata fallback', async () => {
      const env = createMockEnv();

      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: { docs: [{ identifier: 'test_id' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: false, // Image service HEAD fails
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [], // No cover files in metadata
          }),
        });

      const result = await fetchArchiveOrgCover('9780439064873', env);

      expect(result).toBeNull();
    });

    it('should handle search API errors gracefully', async () => {
      const env = createMockEnv();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await fetchArchiveOrgCover('9780439064873', env);

      expect(result).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      const env = createMockEnv();

      mockFetchWithRetry.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await fetchArchiveOrgCover('9780439064873', env);

      expect(result).toBeNull();
    });

    it('should handle invalid ISBN gracefully', async () => {
      const env = createMockEnv();

      const result = await fetchArchiveOrgCover('invalid', env);

      expect(result).toBeNull();
      expect(mockFetchWithRetry).not.toHaveBeenCalled(); // Short-circuit on invalid ISBN
    });
  });

  describe('fetchArchiveOrgMetadata', () => {
    it('should fetch metadata using 2-step process (search → metadata)', async () => {
      const env = createMockEnv();

      // Step 1: Mock search API (ISBN → identifier)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            docs: [{ identifier: 'tokillmockingbir00leeh' }],
          },
        }),
      });

      // Step 2: Mock metadata API (identifier → metadata)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            title: 'To Kill a Mockingbird',
            creator: 'Harper Lee',
            publisher: 'J. B. Lippincott & Co.',
            date: '1960',
            isbn: ['9780060935467', '0060935464'],
            subject: ['Fiction', 'Southern Gothic', 'Legal drama'],
            description: [
              'A novel set in the 1930s Deep South.',
              'Deals with serious issues of rape and racial inequality.',
            ],
            language: 'eng',
            openlibrary_edition: 'OL37027463M',
            openlibrary_work: 'OL45883W',
          },
        }),
      });

      const result = await fetchArchiveOrgMetadata('9780060935467', env);

      expect(result).toBeTruthy();
      expect(result?.identifier).toBe('tokillmockingbir00leeh');
      expect(result?.title).toBe('To Kill a Mockingbird');
      expect(result?.creator).toBe('Harper Lee');
      expect(result?.publisher).toBe('J. B. Lippincott & Co.');
      expect(result?.date).toBe('1960');
      expect(result?.isbn).toEqual(['9780060935467', '0060935464']);
      expect(result?.subject).toEqual(['Fiction', 'Southern Gothic', 'Legal drama']);
      expect(result?.description).toEqual([
        'A novel set in the 1930s Deep South.',
        'Deals with serious issues of rape and racial inequality.',
      ]);
      expect(result?.language).toBe('eng');
      expect(result?.openlibrary_edition).toBe('OL37027463M');
      expect(result?.openlibrary_work).toBe('OL45883W');

      // Verify both API calls happened
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
    });

    it('should return null when search finds no identifier', async () => {
      const env = createMockEnv();

      // Mock search API returning no results
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: { docs: [] }, // No results
        }),
      });

      const result = await fetchArchiveOrgMetadata('9999999999999', env);

      expect(result).toBeNull();
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1); // Only search, no metadata call
    });

    it('should return null when metadata API returns no result', async () => {
      const env = createMockEnv();

      // Step 1: Search succeeds
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: { docs: [{ identifier: 'test_identifier' }] },
        }),
      });

      // Step 2: Metadata API returns empty result
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No result field
      });

      const result = await fetchArchiveOrgMetadata('9780439064873', env);

      expect(result).toBeNull();
    });

    it('should handle arrays and strings for creator/publisher fields', async () => {
      const env = createMockEnv();

      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: { docs: [{ identifier: 'test_id' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: {
              title: 'Test Book',
              creator: ['Author One', 'Author Two'], // Array
              publisher: 'Single Publisher', // String
            },
          }),
        });

      const result = await fetchArchiveOrgMetadata('9780439064873', env);

      expect(result?.creator).toEqual(['Author One', 'Author Two']);
      expect(result?.publisher).toBe('Single Publisher');
    });

    it('should normalize single-value subject/description/isbn to arrays', async () => {
      const env = createMockEnv();

      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: { docs: [{ identifier: 'test_id' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: {
              title: 'Test Book',
              subject: 'Single Subject', // String, not array
              description: 'Single description', // String, not array
              isbn: '9780439064873', // String, not array
            },
          }),
        });

      const result = await fetchArchiveOrgMetadata('9780439064873', env);

      expect(result?.subject).toEqual(['Single Subject']);
      expect(result?.description).toEqual(['Single description']);
      expect(result?.isbn).toEqual(['9780439064873']);
    });

    it('should handle partial metadata gracefully', async () => {
      const env = createMockEnv();

      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: { docs: [{ identifier: 'test_id' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: {
              title: 'Minimal Book',
              // Missing most fields
            },
          }),
        });

      const result = await fetchArchiveOrgMetadata('9780439064873', env);

      expect(result).toBeTruthy();
      expect(result?.title).toBe('Minimal Book');
      expect(result?.creator).toBeUndefined();
      expect(result?.publisher).toBeUndefined();
      expect(result?.subject).toBeUndefined();
    });

    it('should handle search API errors gracefully', async () => {
      const env = createMockEnv();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const result = await fetchArchiveOrgMetadata('9780439064873', env);

      expect(result).toBeNull();
    });

    it('should handle metadata API errors gracefully', async () => {
      const env = createMockEnv();

      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: { docs: [{ identifier: 'test_id' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        });

      const result = await fetchArchiveOrgMetadata('9780439064873', env);

      expect(result).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      const env = createMockEnv();

      mockFetchWithRetry.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await fetchArchiveOrgMetadata('9780439064873', env);

      expect(result).toBeNull();
    });
  });
});
