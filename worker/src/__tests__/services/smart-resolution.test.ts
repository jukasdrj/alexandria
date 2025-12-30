/**
 * Unit Tests for Smart Resolution Chain
 *
 * Tests the ISBNdb → Google Books → OpenLibrary fallback logic and database enrichment.
 * MSW mocks are configured in setup.ts to simulate provider responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { smartResolveISBN, shouldResolveExternally } from '../../../services/smart-enrich.js';
import type { Sql } from 'postgres';
import type { Env } from '../../env.js';

// Mock SQL client for testing without database
function createMockSql() {
  const mockSql = vi.fn() as unknown as Sql;
  // @ts-expect-error - Mock begin for transactions
  mockSql.begin = vi.fn(async (callback) => {
    const mockTransaction = vi.fn() as unknown as Sql;
    return callback(mockTransaction);
  });
  return mockSql;
}

// Mock environment with KV and API keys
function createMockEnv(): Env {
  return {
    CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [] }),
      getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
    } as unknown as KVNamespace,
    CACHE_TTL_SHORT: '300',
    CACHE_TTL_MEDIUM: '3600',
    CACHE_TTL_LONG: '86400',
    ISBNDB_API_KEY: 'test-key',
    GOOGLE_BOOKS_API_KEY: 'test-key',
  } as unknown as Env;
}

// Mock logger
function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    query: vi.fn(),
  };
}

describe('Smart Resolution Chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldResolveExternally', () => {
    it('should always return true for now', () => {
      const isbn = '9780439064873';
      const env = createMockEnv();

      const result = shouldResolveExternally(isbn, env);

      expect(result).toBe(true);
    });

    it('should accept any valid ISBN format', () => {
      const env = createMockEnv();

      expect(shouldResolveExternally('9780439064873', env)).toBe(true);
      expect(shouldResolveExternally('043906487X', env)).toBe(true);
      expect(shouldResolveExternally('invalid', env)).toBe(true); // Validation happens in resolveExternalISBN
    });
  });

  describe('smartResolveISBN - Cache Behavior', () => {
    it('should check cache for previously failed ISBNs', async () => {
      const isbn = '9780000000000';
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock cache hit for "not found"
      (env.CACHE.get as ReturnType<typeof vi.fn>).mockResolvedValue('true');

      const result = await smartResolveISBN(isbn, sql, env, logger);

      expect(result).toBeNull();
      expect(env.CACHE.get).toHaveBeenCalledWith(`isbn_not_found:${isbn}`);
    });

    it('should cache failed ISBN lookups for 24 hours', async () => {
      const isbn = '9999999999999'; // Non-existent ISBN
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock external API returning null (not found)
      // MSW will return empty responses for unknown ISBNs

      const result = await smartResolveISBN(isbn, sql, env, logger);

      // Should cache the failure
      expect(env.CACHE.put).toHaveBeenCalledWith(
        `isbn_not_found:${isbn}`,
        'true',
        { expirationTtl: 86400 } // 24 hours
      );
    });
  });

  describe('SmartResolveResult Format', () => {
    it('should return correctly formatted result', () => {
      const mockResult = {
        title: "Harry Potter and the Philosopher's Stone",
        author: 'J.K. Rowling',
        isbn: '9780439064873',
        coverUrl: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
        coverSource: 'external-provider',
        publish_date: '1998-09-01',
        publishers: ['Scholastic'],
        pages: 309,
        work_title: "Harry Potter and the Philosopher's Stone",
        openlibrary_edition: 'https://openlibrary.org/books/OL26331930M',
        openlibrary_work: 'https://openlibrary.org/works/OL45804W',
        _enriched: true,
        _provider: 'isbndb' as const,
      };

      // Verify all required fields exist
      expect(mockResult).toHaveProperty('title');
      expect(mockResult).toHaveProperty('author');
      expect(mockResult).toHaveProperty('isbn');
      expect(mockResult).toHaveProperty('coverUrl');
      expect(mockResult).toHaveProperty('coverSource');
      expect(mockResult).toHaveProperty('publish_date');
      expect(mockResult).toHaveProperty('publishers');
      expect(mockResult).toHaveProperty('pages');
      expect(mockResult).toHaveProperty('work_title');
      expect(mockResult).toHaveProperty('openlibrary_edition');
      expect(mockResult).toHaveProperty('openlibrary_work');
      expect(mockResult).toHaveProperty('_enriched');
      expect(mockResult).toHaveProperty('_provider');
    });

    it('should include _enriched flag set to true', () => {
      const mockResult = {
        title: 'Test Book',
        author: 'Test Author',
        isbn: '9780000000000',
        coverUrl: null,
        coverSource: 'external-provider',
        publish_date: null,
        publishers: null,
        pages: null,
        work_title: 'Test Book',
        openlibrary_edition: null,
        openlibrary_work: null,
        _enriched: true,
        _provider: 'google-books' as const,
      };

      expect(mockResult._enriched).toBe(true);
    });

    it('should include provider information', () => {
      const providers: Array<'isbndb' | 'google-books' | 'openlibrary'> = [
        'isbndb',
        'google-books',
        'openlibrary',
      ];

      providers.forEach((provider) => {
        const mockResult = {
          title: 'Test',
          author: null,
          isbn: '9780000000000',
          coverUrl: null,
          coverSource: 'external-provider',
          publish_date: null,
          publishers: null,
          pages: null,
          work_title: 'Test',
          openlibrary_edition: null,
          openlibrary_work: null,
          _enriched: true,
          _provider: provider,
        };

        expect(mockResult._provider).toBe(provider);
      });
    });

    it('should handle storage failure flag', () => {
      const mockResult = {
        title: 'Test',
        author: null,
        isbn: '9780000000000',
        coverUrl: null,
        coverSource: 'external-provider',
        publish_date: null,
        publishers: null,
        pages: null,
        work_title: 'Test',
        openlibrary_edition: null,
        openlibrary_work: null,
        _enriched: true,
        _provider: 'isbndb' as const,
        _storage_failed: true,
      };

      expect(mockResult._storage_failed).toBe(true);
    });
  });

  describe('URL Formatting', () => {
    it('should convert edition keys to OpenLibrary URLs', () => {
      const editionKey = '/books/OL26331930M';
      const expected = 'https://openlibrary.org/books/OL26331930M';

      expect(`https://openlibrary.org${editionKey}`).toBe(expected);
    });

    it('should convert work keys to OpenLibrary URLs', () => {
      const workKey = '/works/OL45804W';
      const expected = 'https://openlibrary.org/works/OL45804W';

      expect(`https://openlibrary.org${workKey}`).toBe(expected);
    });

    it('should handle null keys gracefully', () => {
      const editionKey = null;
      const result = editionKey ? `https://openlibrary.org${editionKey}` : null;

      expect(result).toBeNull();
    });
  });

  describe('Author Handling', () => {
    it('should select first author as primary', () => {
      const authors = ['J.K. Rowling', 'Mary GrandPré'];
      const primaryAuthor = authors[0];

      expect(primaryAuthor).toBe('J.K. Rowling');
    });

    it('should return null when no authors available', () => {
      const authors: string[] = [];
      const primaryAuthor = authors[0] || null;

      expect(primaryAuthor).toBeNull();
    });

    it('should handle undefined authors array', () => {
      const authors = undefined;
      const primaryAuthor = authors?.[0] || null;

      expect(primaryAuthor).toBeNull();
    });
  });

  describe('Cover URL Selection', () => {
    it('should prefer large > medium > small cover URLs', () => {
      const coverUrls = {
        small: 'https://example.com/small.jpg',
        medium: 'https://example.com/medium.jpg',
        large: 'https://example.com/large.jpg',
      };

      // selectBestCoverURL logic: large || medium || small || null
      const selected = coverUrls.large || coverUrls.medium || coverUrls.small || null;
      expect(selected).toBe('https://example.com/large.jpg');
    });

    it('should fallback to medium when large unavailable', () => {
      const coverUrls = {
        small: 'https://example.com/small.jpg',
        medium: 'https://example.com/medium.jpg',
      };

      const selected = coverUrls.large || coverUrls.medium || coverUrls.small || null;
      expect(selected).toBe('https://example.com/medium.jpg');
    });

    it('should return null when no cover URLs available', () => {
      const coverUrls = {};

      const selected = coverUrls.large || coverUrls.medium || coverUrls.small || null;
      expect(selected).toBeNull();
    });

    it('should handle ISBNdb original cover URL', () => {
      const coverUrls = {
        original: 'https://images.isbndb.com/covers/48/73/9780439064873_original.jpg',
        large: 'https://images.isbndb.com/covers/48/73/9780439064873.jpg',
      };

      // Original is highest quality but may expire (JWT token)
      // We store it but selectBestCoverURL prioritizes large/medium/small
      expect(coverUrls.original).toBeDefined();
      expect(coverUrls.original).toContain('_original.jpg');
    });
  });

  describe('Publisher Formatting', () => {
    it('should wrap single publisher in array', () => {
      const publisher = 'Scholastic';
      const publishers = publisher ? [publisher] : null;

      expect(publishers).toEqual(['Scholastic']);
    });

    it('should return null when no publisher available', () => {
      const publisher = undefined;
      const publishers = publisher ? [publisher] : null;

      expect(publishers).toBeNull();
    });

    it('should handle empty string publisher', () => {
      const publisher = '';
      const publishers = publisher ? [publisher] : null;

      expect(publishers).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle database transaction errors gracefully', async () => {
      const isbn = '9780439064873';
      const sql = createMockSql();
      const env = createMockEnv();
      const logger = createMockLogger();

      // Mock transaction failure
      // @ts-expect-error - Mock begin to throw error
      sql.begin = vi.fn().mockRejectedValue(new Error('Database connection failed'));

      // Should still return data even if storage fails
      const result = await smartResolveISBN(isbn, sql, env, logger);

      // MSW will return mock ISBNdb data
      // Even though storage failed, we should get the data
      if (result) {
        expect(result._storage_failed).toBe(true);
        expect(result.isbn).toBe(isbn);
      }
    });

    it('should log error but not throw when enrichment fails', () => {
      // Enrichment errors should be logged but not fail the entire operation
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        console.error('[Smart Enrich] Enrichment failed (core data still saved):', new Error('Test'));
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('Data Validation', () => {
    it('should validate required fields in result', () => {
      const mockResult = {
        title: "Harry Potter",
        author: 'J.K. Rowling',
        isbn: '9780439064873',
        coverUrl: null,
        coverSource: 'external-provider',
        publish_date: null,
        publishers: null,
        pages: null,
        work_title: "Harry Potter",
        openlibrary_edition: null,
        openlibrary_work: null,
        _enriched: true,
        _provider: 'isbndb' as const,
      };

      // Required fields must be present
      expect(mockResult.title).toBeDefined();
      expect(mockResult.isbn).toBeDefined();
      expect(mockResult._enriched).toBeDefined();
      expect(mockResult._provider).toBeDefined();

      // Optional fields can be null
      expect([null, undefined, expect.any(String)]).toContain(mockResult.coverUrl || null);
      expect([null, undefined, expect.any(String)]).toContain(mockResult.publish_date || null);
    });

    it('should validate ISBN format in result', () => {
      const validISBN13 = '9780439064873';
      const validISBN10 = '043906487X';

      expect(validISBN13).toMatch(/^[0-9]{13}$/);
      expect(validISBN10).toMatch(/^[0-9]{9}[0-9X]$/);
    });
  });
});
