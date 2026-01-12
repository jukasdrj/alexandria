import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WikidataProvider } from '../wikidata-provider.js';
import { ServiceCapability } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';
import type { Sql } from 'postgres';

// Mock ServiceHttpClient
const mockFetch = vi.fn();
vi.mock('../../http-client.js', () => ({
  ServiceHttpClient: class {
    fetch = mockFetch;
  },
}));

describe('WikidataProvider', () => {
  let provider: WikidataProvider;
  let mockContext: ServiceContext;
  let mockSql: Sql;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new WikidataProvider();

    mockSql = {} as Sql;

    mockContext = {
      env: {} as Env,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
      sql: mockSql,
    };
  });

  describe('provider metadata', () => {
    it('should have correct name', () => {
      expect(provider.name).toBe('wikidata');
    });

    it('should be a free provider', () => {
      expect(provider.providerType).toBe('free');
    });

    it('should support correct capabilities', () => {
      expect(provider.capabilities).toEqual([
        ServiceCapability.METADATA_ENRICHMENT,
        ServiceCapability.COVER_IMAGES,
        ServiceCapability.ISBN_RESOLUTION,
      ]);
    });
  });

  describe('isAvailable', () => {
    it('should always return true (no API key required)', async () => {
      const available = await provider.isAvailable({} as Env);
      expect(available).toBe(true);
    });
  });

  describe('fetchMetadata', () => {
    it('should fetch book metadata by ISBN-13', async () => {
      // Mock SPARQL response
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [
            {
              book: { value: 'http://www.wikidata.org/entity/Q43361' },
              bookLabel: { value: 'Harry Potter and the Philosopher\'s Stone' },
              author: { value: 'http://www.wikidata.org/entity/Q34660' },
              authorLabel: { value: 'J. K. Rowling' },
              publishDate: { value: '1997-06-26T00:00:00Z' },
              genre: { value: 'http://www.wikidata.org/entity/Q132311' },
              genreLabel: { value: 'Fantasy' },
            },
          ],
        },
      });

      const result = await provider.fetchMetadata('9780747532743', mockContext);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Harry Potter and the Philosopher\'s Stone');
      expect(result?.authors).toEqual(['J. K. Rowling']);
      expect(result?.publishDate).toBe('1997-06-26T00:00:00Z');
      expect(result?.subjects).toEqual(['Fantasy']);
    });

    it('should return null when book not found', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [],
        },
      });

      const result = await provider.fetchMetadata('9999999999999', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'No Wikidata metadata found',
        expect.objectContaining({ isbn: '9999999999999' })
      );
    });

    it('should return null for invalid ISBN format', async () => {
      const result = await provider.fetchMetadata('invalid-isbn', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'Invalid ISBN format, skipping Wikidata query',
        { isbn: 'invalid-isbn' }
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('SPARQL timeout'));

      const result = await provider.fetchMetadata('9780747532743', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Wikidata metadata fetch failed',
        expect.objectContaining({
          isbn: '9780747532743',
          error: 'SPARQL timeout'
        })
      );
    });

    it('should handle minimal data (missing optional fields)', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [
            {
              book: { value: 'http://www.wikidata.org/entity/Q12345' },
              bookLabel: { value: 'Test Book' },
              // No author, publishDate, or genre
            },
          ],
        },
      });

      const result = await provider.fetchMetadata('9780000000000', mockContext);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Book');
      expect(result?.authors).toBeUndefined();
      expect(result?.publishDate).toBeUndefined();
      expect(result?.subjects).toBeUndefined();
    });

    it('should sanitize ISBN for SPARQL injection prevention', async () => {
      mockFetch.mockResolvedValueOnce({
        results: { bindings: [] },
      });

      await provider.fetchMetadata('978-0-7475-3274-3', mockContext);

      // Verify the query was made with sanitized ISBN (no hyphens in the ISBN itself)
      expect(mockFetch).toHaveBeenCalled();
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('9780747532743'); // Normalized ISBN without hyphens
      // Decode URL and check that ISBN in SPARQL query has no hyphens
      const decodedUrl = decodeURIComponent(callUrl).replace(/\+/g, ' ');
      expect(decodedUrl).toMatch(/P212\s+"9780747532743"/); // ISBN without hyphens in SPARQL
    });
  });

  describe('fetchCover', () => {
    it('should fetch cover URL from Wikidata', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [
            {
              image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg' },
            },
          ],
        },
      });

      const result = await provider.fetchCover('9780747532743', mockContext);

      expect(result).not.toBeNull();
      expect(result?.url).toBe('http://commons.wikimedia.org/wiki/Special:FilePath/HP1.jpg');
      expect(result?.source).toBe('wikidata');
      expect(result?.size).toBe('large');
    });

    it('should return null when no cover found', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [
            {
              // No image field
            },
          ],
        },
      });

      const result = await provider.fetchCover('9780000000000', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'No Wikidata cover found',
        { isbn: '9780000000000' }
      );
    });

    it('should handle errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.fetchCover('9780747532743', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Wikidata cover fetch failed',
        expect.objectContaining({
          isbn: '9780747532743',
          error: 'Network error',
        })
      );
    });
  });

  describe('fetchAuthorBibliography', () => {
    it('should fetch author bibliography by Wikidata QID', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [
            {
              work: { value: 'http://www.wikidata.org/entity/Q43361' },
              workLabel: { value: 'Harry Potter and the Philosopher\'s Stone' },
            },
            {
              work: { value: 'http://www.wikidata.org/entity/Q47209' },
              workLabel: { value: 'Harry Potter and the Chamber of Secrets' },
            },
          ],
        },
      });

      const result = await provider.fetchAuthorBibliography('Q34660', mockContext);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Harry Potter and the Philosopher\'s Stone');
      expect(result[1]).toBe('Harry Potter and the Chamber of Secrets');
    });

    it('should return empty array when no works found', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [],
        },
      });

      const result = await provider.fetchAuthorBibliography('Q99999', mockContext);

      expect(result).toEqual([]);
    });

    it('should sanitize invalid Wikidata QID format', async () => {
      const result = await provider.fetchAuthorBibliography('invalid-qid', mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        'Invalid Wikidata QID format',
        { authorQid: 'invalid-qid' }
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should filter out works without labels', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          bindings: [
            {
              work: { value: 'http://www.wikidata.org/entity/Q43361' },
              workLabel: { value: 'Harry Potter' },
            },
            {
              work: { value: 'http://www.wikidata.org/entity/Q99999' },
              // No workLabel
            },
          ],
        },
      });

      const result = await provider.fetchAuthorBibliography('Q34660', mockContext);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Harry Potter');
    });
  });
});
