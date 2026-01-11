import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WikipediaProvider } from '../wikipedia-provider.js';
import { ServiceCapability } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';
import type { Sql } from 'postgres';

// Mock the wikipedia service
vi.mock('../../../../services/wikipedia.js', () => ({
  fetchAuthorBiography: vi.fn(),
}));

import { fetchAuthorBiography } from '../../../../services/wikipedia.js';

const mockFetchAuthorBiography = fetchAuthorBiography as any;

describe('WikipediaProvider', () => {
  let provider: WikipediaProvider;
  let mockContext: ServiceContext;
  let mockSql: Sql;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new WikipediaProvider();

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
      expect(provider.name).toBe('wikipedia');
    });

    it('should be a free provider', () => {
      expect(provider.providerType).toBe('free');
    });

    it('should support correct capabilities', () => {
      expect(provider.capabilities).toEqual([
        ServiceCapability.AUTHOR_BIOGRAPHY,
      ]);
    });
  });

  describe('isAvailable', () => {
    it('should always return true (no API key required)', async () => {
      const available = await provider.isAvailable({} as Env);
      expect(available).toBe(true);
    });
  });

  describe('fetchBiography', () => {
    it('should return null when database connection is missing', async () => {
      const contextWithoutSql = {
        ...mockContext,
        sql: undefined,
      };

      const result = await provider.fetchBiography('/authors/OL23919A', contextWithoutSql);

      expect(result).toBeNull();
      expect(contextWithoutSql.logger.error).toHaveBeenCalledWith(
        'Wikipedia provider requires database connection',
        { authorKey: '/authors/OL23919A' }
      );
    });

    it('should return null when no biography is found', async () => {
      mockFetchAuthorBiography.mockResolvedValueOnce(null);

      const result = await provider.fetchBiography('/authors/OL23919A', mockContext);

      expect(result).toBeNull();
      expect(mockFetchAuthorBiography).toHaveBeenCalledWith(
        mockSql,
        '/authors/OL23919A',
        mockContext.env
      );
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'No Wikipedia biography found',
        { authorKey: '/authors/OL23919A' }
      );
    });

    it('should successfully fetch and map biography data', async () => {
      const mockWikiData = {
        source: 'wikipedia' as const,
        article_title: 'J. K. Rowling',
        extract: 'Joanne Rowling, known by her pen name J. K. Rowling...',
        birth_year: 1965,
        death_year: undefined,
        nationality: ['British'],
        image_url: 'https://example.com/jkrowling.jpg',
        fetched_at: '2024-01-01T00:00:00Z',
        wikipedia_url: 'https://en.wikipedia.org/wiki/J._K._Rowling',
        wikidata_qid: 'Q34660',
        confidence: 95,
      };

      mockFetchAuthorBiography.mockResolvedValueOnce(mockWikiData);

      const result = await provider.fetchBiography('/authors/OL23919A', mockContext);

      expect(result).not.toBeNull();
      expect(result).toEqual({
        authorKey: '/authors/OL23919A',
        name: 'J. K. Rowling',
        biography: 'Joanne Rowling, known by her pen name J. K. Rowling...',
        birthDate: '1965',
        deathDate: undefined,
        wikidataQid: 'Q34660',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/J._K._Rowling',
        source: 'wikipedia',
      });

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Wikipedia biography fetched successfully',
        {
          authorKey: '/authors/OL23919A',
          confidence: 95,
          hasWikidataQid: true,
        }
      );
    });

    it('should handle biography with death year', async () => {
      const mockWikiData = {
        source: 'wikipedia' as const,
        article_title: 'Douglas Adams',
        extract: 'Douglas Noel Adams was an English author...',
        birth_year: 1952,
        death_year: 2001,
        wikipedia_url: 'https://en.wikipedia.org/wiki/Douglas_Adams',
        fetched_at: '2024-01-01T00:00:00Z',
        confidence: 90,
      };

      mockFetchAuthorBiography.mockResolvedValueOnce(mockWikiData);

      const result = await provider.fetchBiography('/authors/OL24936A', mockContext);

      expect(result).not.toBeNull();
      expect(result?.birthDate).toBe('1952');
      expect(result?.deathDate).toBe('2001');
    });

    it('should handle errors gracefully', async () => {
      mockFetchAuthorBiography.mockRejectedValueOnce(new Error('API error'));

      const result = await provider.fetchBiography('/authors/OL23919A', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Wikipedia biography fetch failed',
        {
          authorKey: '/authors/OL23919A',
          error: 'API error',
        }
      );
    });

    it('should handle biography without Wikidata QID', async () => {
      const mockWikiData = {
        source: 'wikipedia' as const,
        article_title: 'Unknown Author',
        extract: 'An author with no Wikidata entry...',
        wikipedia_url: 'https://en.wikipedia.org/wiki/Unknown_Author',
        fetched_at: '2024-01-01T00:00:00Z',
        confidence: 60,
      };

      mockFetchAuthorBiography.mockResolvedValueOnce(mockWikiData);

      const result = await provider.fetchBiography('/authors/OL00000A', mockContext);

      expect(result).not.toBeNull();
      expect(result?.wikidataQid).toBeUndefined();
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Wikipedia biography fetched successfully',
        {
          authorKey: '/authors/OL00000A',
          confidence: 60,
          hasWikidataQid: false,
        }
      );
    });
  });
});
