import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchBookByISBN,
  fetchWikidataCover,
  fetchAuthorBibliography,
  fetchAuthorMetadata,
} from '../wikidata.js';
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
  getCachedResponse: vi.fn(),
  setCachedResponse: vi.fn(),
  RATE_LIMITS: {
    'wikidata': 500,
  },
  CACHE_TTLS: {
    'wikidata': 2592000,
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
  // Add other required Env properties as needed
} as any);

// Mock logger
const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// =============================================================================
// MIGRATION NOTE: These legacy tests are being replaced by WikidataProvider tests
// New provider tests: worker/lib/external-services/providers/__tests__/wikidata-provider.test.ts
//
// Status:
// ✅ fetchBookByISBN → WikidataProvider.fetchMetadata (6 tests migrated)
// ✅ fetchWikidataCover → WikidataProvider.fetchCover (3 tests migrated)
// ✅ fetchAuthorBibliography → WikidataProvider.fetchAuthorBibliography (4 tests migrated)
// ❌ fetchAuthorMetadata → Not exposed by WikidataProvider (not used in production, 4 tests skipped)
//
// Total: 13/17 tests migrated. 4 tests for unused fetchAuthorMetadata skipped intentionally.
// =============================================================================

describe.skip('wikidata (LEGACY - migrated to WikidataProvider)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchBookByISBN', () => {
    it('should fetch book metadata by ISBN-13', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock SPARQL response
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                book: { value: 'http://www.wikidata.org/entity/Q43361' },
                bookLabel: { value: 'Harry Potter and the Philosopher\'s Stone' },
                isbn13: { value: '9780747532743' },
                pubDate: { value: '1997-06-26T00:00:00Z' },
                image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg' },
                authors: { value: 'J. K. Rowling' },
                authorQids: { value: 'http://www.wikidata.org/entity/Q34660' },
                genres: { value: 'Fantasy|Young adult literature' },
              },
            ],
          },
        }),
      });

      const result = await fetchBookByISBN('9780747532743', env, logger);

      expect(result).toBeTruthy();
      expect(result?.qid).toBe('Q43361');
      expect(result?.title).toBe('Harry Potter and the Philosopher\'s Stone');
      expect(result?.isbn13).toBe('9780747532743');
      expect(result?.publication_date).toBe('1997-06-26');
      expect(result?.image_url).toBe('http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg');
      expect(result?.author_names).toEqual(['J. K. Rowling']);
      expect(result?.author_qids).toEqual(['Q34660']);
      expect(result?.genre_names).toEqual(['Fantasy', 'Young adult literature']);
      expect(result?.confidence).toBeGreaterThan(0);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should return null when book not found', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [],
          },
        }),
      });

      const result = await fetchBookByISBN('9999999999999', env, logger);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikidata: No results for ISBN',
        expect.objectContaining({ isbn: '9999999999999' })
      );
    });

    it('should return cached data when available', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      const cachedData = {
        qid: 'Q43361',
        title: 'Harry Potter (Cached)',
        isbn13: '9780747532743',
        confidence: 80,
        fetched_at: new Date().toISOString(),
      };

      (env.CACHE.get as any).mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await fetchBookByISBN('9780747532743', env, logger);

      expect(result).toEqual(cachedData);
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikidata: Using cached book data',
        expect.any(Object)
      );
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await fetchBookByISBN('9780747532743', env, logger);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Wikidata: API error',
        expect.objectContaining({ status: 500 })
      );
    });

    it('should handle network errors gracefully', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await fetchBookByISBN('9780747532743', env, logger);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Wikidata fetch error',
        expect.objectContaining({ error: 'Network timeout' })
      );
    });

    it('should calculate confidence score correctly', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      // Minimal data (low confidence)
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                book: { value: 'http://www.wikidata.org/entity/Q12345' },
                bookLabel: { value: 'Test Book' },
                isbn13: { value: '9780000000000' },
              },
            ],
          },
        }),
      });

      const result = await fetchBookByISBN('9780000000000', env, logger);

      expect(result?.confidence).toBeGreaterThanOrEqual(10); // Base score
      expect(result?.confidence).toBeLessThan(50);
    });
  });

  describe('fetchWikidataCover', () => {
    it('should fetch cover URL from Wikidata', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                book: { value: 'http://www.wikidata.org/entity/Q43361' },
                bookLabel: { value: 'Harry Potter' },
                isbn13: { value: '9780747532743' },
                image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg' },
              },
            ],
          },
        }),
      });

      const result = await fetchWikidataCover('9780747532743', env, logger);

      expect(result).toBeTruthy();
      expect(result?.url).toBe('http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg');
      expect(result?.source).toBe('wikidata');
      expect(result?.quality).toBe('medium');
    });

    it('should return null when no cover found', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                book: { value: 'http://www.wikidata.org/entity/Q12345' },
                bookLabel: { value: 'Book without cover' },
                isbn13: { value: '9780000000000' },
                // No image field
              },
            ],
          },
        }),
      });

      const result = await fetchWikidataCover('9780000000000', env, logger);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikidata: Book found but no cover image',
        expect.any(Object)
      );
    });

    it('should determine quality based on confidence', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      // High confidence book
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                book: { value: 'http://www.wikidata.org/entity/Q43361' },
                bookLabel: { value: 'Harry Potter' },
                isbn13: { value: '9780747532743' },
                pubDate: { value: '1997-06-26T00:00:00Z' },
                image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg' },
                authors: { value: 'J. K. Rowling' },
                genres: { value: 'Fantasy|Young adult' },
              },
            ],
          },
        }),
      });

      const result = await fetchWikidataCover('9780747532743', env, logger);

      expect(result?.quality).toBe('high'); // Confidence >= 70
    });
  });

  describe('fetchAuthorBibliography', () => {
    it('should fetch author bibliography by Wikidata QID', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                work: { value: 'http://www.wikidata.org/entity/Q43361' },
                workLabel: { value: 'Harry Potter and the Philosopher\'s Stone' },
                publicationDate: { value: '1997-01-01T00:00:00Z' },
                isbn13: { value: '9780747532743' },
                image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg' },
              },
              {
                work: { value: 'http://www.wikidata.org/entity/Q47209' },
                workLabel: { value: 'Harry Potter and the Chamber of Secrets' },
                publicationDate: { value: '1998-01-01T00:00:00Z' },
                isbn13: { value: '9780747538493' },
              },
            ],
          },
        }),
      });

      const result = await fetchAuthorBibliography('Q34660', env, logger);

      expect(result).toHaveLength(2);
      expect(result[0].qid).toBe('Q43361');
      expect(result[0].title).toBe('Harry Potter and the Philosopher\'s Stone');
      expect(result[0].publication_year).toBe(1997);
      expect(result[0].isbn13).toBe('9780747532743');
      expect(result[0].cover_url).toBe('http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg');
      expect(result[1].qid).toBe('Q47209');
      expect(logger.info).toHaveBeenCalled();
    });

    it('should return empty array when no works found', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [],
          },
        }),
      });

      const result = await fetchAuthorBibliography('Q99999', env, logger);

      expect(result).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikidata: No bibliography results',
        expect.objectContaining({ authorQid: 'Q99999' })
      );
    });

    it('should limit results to 100 works', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      const manyWorks = Array.from({ length: 150 }, (_, i) => ({
        work: { value: `http://www.wikidata.org/entity/Q${i}` },
        workLabel: { value: `Book ${i}` },
        publicationDate: { value: `${1990 + i}-01-01T00:00:00Z` },
      }));

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: manyWorks,
          },
        }),
      });

      const result = await fetchAuthorBibliography('Q34660', env, logger);

      expect(result).toHaveLength(100);
    });

    it('should use cached data when available', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      const cachedData = [
        {
          qid: 'Q43361',
          title: 'Cached Book',
          publication_year: 1997,
        },
      ];

      (env.CACHE.get as any).mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await fetchAuthorBibliography('Q34660', env, logger);

      expect(result).toEqual(cachedData);
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikidata: Using cached bibliography',
        expect.any(Object)
      );
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });
  });

  describe('fetchAuthorMetadata', () => {
    it('should fetch comprehensive author metadata', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                author: { value: 'http://www.wikidata.org/entity/Q34660' },
                authorLabel: { value: 'J. K. Rowling' },
                birthDate: { value: '1965-07-31T00:00:00Z' },
                gender: { value: 'http://www.wikidata.org/entity/Q6581072' },
                genderLabel: { value: 'female' },
                nationality: { value: 'http://www.wikidata.org/entity/Q145' },
                nationalityLabel: { value: 'United Kingdom' },
                image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/JKR.jpg' },
                movements: { value: 'Literary realism' },
                awards: { value: 'Hugo Award|Nebula Award' },
                wikipediaTitle: { value: 'J._K._Rowling' },
              },
            ],
          },
        }),
      });

      const result = await fetchAuthorMetadata('Q34660', env, logger);

      expect(result).toBeTruthy();
      expect(result?.qid).toBe('Q34660');
      expect(result?.name).toBe('J. K. Rowling');
      expect(result?.birth_year).toBe(1965);
      expect(result?.gender).toBe('female');
      expect(result?.nationality).toBe('United Kingdom');
      expect(result?.image_url).toBe('http://commons.wikimedia.org/wiki/Special:FilePath/JKR.jpg');
      expect(result?.literary_movements).toEqual(['Literary realism']);
      expect(result?.awards).toEqual(['Hugo Award', 'Nebula Award']);
      expect(result?.wikipedia_page_title).toBe('J._K._Rowling');
      expect(result?.confidence).toBeGreaterThan(0);
    });

    it('should return null when author not found', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [],
          },
        }),
      });

      const result = await fetchAuthorMetadata('Q99999', env, logger);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'Wikidata: No author metadata found',
        expect.objectContaining({ authorQid: 'Q99999' })
      );
    });

    it('should calculate confidence based on data completeness', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      // Minimal data
      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                author: { value: 'http://www.wikidata.org/entity/Q12345' },
                authorLabel: { value: 'Unknown Author' },
              },
            ],
          },
        }),
      });

      const result = await fetchAuthorMetadata('Q12345', env, logger);

      expect(result?.confidence).toBeLessThan(50); // Low confidence
    });

    it('should handle missing optional fields gracefully', async () => {
      const env = createMockEnv();
      const logger = createMockLogger();

      mockFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                author: { value: 'http://www.wikidata.org/entity/Q34660' },
                authorLabel: { value: 'J. K. Rowling' },
                birthDate: { value: '1965-07-31T00:00:00Z' },
                // Missing gender, nationality, image, etc.
              },
            ],
          },
        }),
      });

      const result = await fetchAuthorMetadata('Q34660', env, logger);

      expect(result).toBeTruthy();
      expect(result?.name).toBe('J. K. Rowling');
      expect(result?.birth_year).toBe(1965);
      expect(result?.gender).toBeUndefined();
      expect(result?.nationality).toBeUndefined();
      expect(result?.image_url).toBeUndefined();
    });
  });
});
