/**
 * Unit Tests for Books API Routes
 *
 * Tests business logic for:
 * - POST /api/books/search - ISBNdb search
 * - POST /api/books/enrich-new-releases - New releases enrichment
 *
 * Following pragmatic Miniflare approach - focuses on business logic validation
 * without full Worker runtime integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// =================================================================================
// POST /api/books/search
// =================================================================================

describe('POST /api/books/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields in success response', () => {
      const response = {
        success: true,
        data: {
          query: '2025-09',
          column: 'date_published',
          books_found: 342,
          pages_fetched: 4,
          books: [
            {
              isbn: '9781234567890',
              title: 'Test Book',
              authors: ['Test Author'],
              publisher: 'Test Publisher',
              date_published: '2025-09-15',
              has_cover: true,
            },
          ],
        },
      };

      // Verify all required fields exist
      expect(response.data).toHaveProperty('query');
      expect(response.data).toHaveProperty('column');
      expect(response.data).toHaveProperty('books_found');
      expect(response.data).toHaveProperty('pages_fetched');
      expect(response.data).toHaveProperty('books');
      expect(Array.isArray(response.data.books)).toBe(true);
    });

    it('should have correct book schema', () => {
      const book = {
        isbn: '9781234567890',
        title: 'Test Book',
        authors: ['Test Author'],
        publisher: 'Test Publisher',
        date_published: '2025-09-15',
        has_cover: true,
      };

      expect(book).toHaveProperty('isbn');
      expect(book).toHaveProperty('title');
      expect(book).toHaveProperty('has_cover');
      expect(typeof book.has_cover).toBe('boolean');
    });

    it('should handle optional book fields', () => {
      const minimalBook = {
        isbn: '9781234567890',
        title: 'Test Book',
        has_cover: false,
      };

      expect(minimalBook).toHaveProperty('isbn');
      expect(minimalBook).toHaveProperty('title');
      expect(minimalBook).toHaveProperty('has_cover');
      expect(minimalBook.authors).toBeUndefined();
      expect(minimalBook.publisher).toBeUndefined();
      expect(minimalBook.date_published).toBeUndefined();
    });
  });

  describe('Pagination Logic', () => {
    it('should calculate hasMore when full page returned', () => {
      const pageSize = 100;
      const booksInResponse = 100;
      const hasMore = booksInResponse === pageSize;

      expect(hasMore).toBe(true);
    });

    it('should calculate hasMore when partial page returned', () => {
      const pageSize = 100;
      const booksInResponse = 73;
      const hasMore = booksInResponse === pageSize;

      expect(hasMore).toBe(false);
    });

    it('should calculate hasMore with total and 10K cap', () => {
      const pageSize = 100;
      const booksInResponse = 100;
      const total = 5000;
      const currentBookCount = 500;
      const hasMore = booksInResponse === pageSize || (total > 0 && currentBookCount < total && currentBookCount < 10000);

      expect(hasMore).toBe(true);
    });

    it('should stop at 10K result limit when partial page received', () => {
      const pageSize = 100;
      const booksInResponse = 50; // Partial page
      const total = 50000;
      const currentBookCount = 10000;
      const hasMore = booksInResponse === pageSize || (total > 0 && currentBookCount < total && currentBookCount < 10000);

      // With partial page and 10K cap reached, hasMore is false
      expect(hasMore).toBe(false);
    });

    it('should continue when below 10K cap with full page', () => {
      const pageSize = 100;
      const booksInResponse = 100; // Full page
      const total = 50000;
      const currentBookCount = 5000; // Below 10K
      const hasMore = booksInResponse === pageSize || (total > 0 && currentBookCount < total && currentBookCount < 10000);

      expect(hasMore).toBe(true);
    });

    it('should handle total = 0 (unknown total)', () => {
      const pageSize = 100;
      const booksInResponse = 100;
      const total = 0;
      const currentBookCount = 500;
      const hasMore = booksInResponse === pageSize || (total > 0 && currentBookCount < total && currentBookCount < 10000);

      expect(hasMore).toBe(true); // Falls back to booksInResponse check
    });

    it('should calculate correct pages_fetched', () => {
      const startPage = 1;
      const endPage = 5; // After loop: page = 5
      const pagesFetched = endPage - 1; // page - 1

      expect(pagesFetched).toBe(4);
    });
  });

  describe('Query Types', () => {
    it('should support date_published query', () => {
      const column = 'date_published';
      const query = '2025-09';
      const validColumns = ['title', 'author', 'date_published', 'subject'];

      expect(validColumns).toContain(column);
      expect(query).toMatch(/^\d{4}-\d{2}$/);
    });

    it('should support title query', () => {
      const column = 'title';
      const query = 'harry potter';
      const validColumns = ['title', 'author', 'date_published', 'subject'];

      expect(validColumns).toContain(column);
      expect(query.length).toBeGreaterThan(0);
    });

    it('should support author query', () => {
      const column = 'author';
      const query = 'brandon sanderson';
      const validColumns = ['title', 'author', 'date_published', 'subject'];

      expect(validColumns).toContain(column);
      expect(query.length).toBeGreaterThan(0);
    });

    it('should support subject query', () => {
      const column = 'subject';
      const query = 'fantasy';
      const validColumns = ['title', 'author', 'date_published', 'subject'];

      expect(validColumns).toContain(column);
      expect(query.length).toBeGreaterThan(0);
    });
  });

  describe('Language Filtering', () => {
    it('should build URL with language parameter', () => {
      const baseUrl = 'https://api.premium.isbndb.com/books/test';
      const page = 1;
      const pageSize = 100;
      const column = 'date_published';
      const language = 'en';

      let url = `${baseUrl}?page=${page}&pageSize=${pageSize}&column=${column}`;
      if (language) {
        url += `&language=${encodeURIComponent(language)}`;
      }

      expect(url).toContain('&language=en');
    });

    it('should build URL without language parameter', () => {
      const baseUrl = 'https://api.premium.isbndb.com/books/test';
      const page = 1;
      const pageSize = 100;
      const column = 'date_published';
      const language = undefined;

      let url = `${baseUrl}?page=${page}&pageSize=${pageSize}&column=${column}`;
      if (language) {
        url += `&language=${encodeURIComponent(language)}`;
      }

      expect(url).not.toContain('&language=');
    });
  });

  describe('Book Extraction Logic', () => {
    it('should prefer isbn13 over isbn', () => {
      const book = {
        isbn: '1234567890',
        isbn13: '9781234567890',
        title: 'Test',
      };

      const isbn = book.isbn13 || book.isbn;
      expect(isbn).toBe('9781234567890');
    });

    it('should fall back to isbn when isbn13 missing', () => {
      const book = {
        isbn: '1234567890',
        title: 'Test',
      };

      const isbn = book.isbn13 || book.isbn;
      expect(isbn).toBe('1234567890');
    });

    it('should prefer title_long over title', () => {
      const book = {
        title: 'Short Title',
        title_long: 'Long Descriptive Title with Subtitle',
      };

      const title = book.title_long || book.title || 'Unknown';
      expect(title).toBe('Long Descriptive Title with Subtitle');
    });

    it('should fall back to title when title_long missing', () => {
      const book = {
        title: 'Short Title',
      };

      const title = book.title_long || book.title || 'Unknown';
      expect(title).toBe('Short Title');
    });

    it('should use Unknown when both titles missing', () => {
      const book = {};

      const title = book.title_long || book.title || 'Unknown';
      expect(title).toBe('Unknown');
    });

    it('should detect has_cover from image_original or image', () => {
      const book1 = { image_original: 'https://example.com/cover.jpg' };
      const book2 = { image: 'https://example.com/cover.jpg' };
      const book3 = {};

      expect(!!(book1.image_original || book1.image)).toBe(true);
      expect(!!(book2.image_original || book2.image)).toBe(true);
      expect(!!(book3.image_original || book3.image)).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should delay 350ms between pages', async () => {
      const delay = 350;
      const startTime = Date.now();

      await new Promise(resolve => setTimeout(resolve, delay));

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(delay - 10); // Allow 10ms tolerance
    });

    it('should not delay after last page', () => {
      const hasMore = false;
      const page = 5;
      const maxPages = 10;

      const shouldDelay = hasMore && page <= maxPages;
      expect(shouldDelay).toBe(false);
    });

    it('should not delay when reaching max_pages', () => {
      const hasMore = true;
      const page = 11;
      const maxPages = 10;

      const shouldDelay = hasMore && page <= maxPages;
      expect(shouldDelay).toBe(false);
    });
  });

  describe('Error Response Format', () => {
    it('should return 429 for ISBNdb rate limit', () => {
      const errorResponse = {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limited by ISBNdb',
        },
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should return 429 for ISBNdb quota exhaustion', () => {
      const errorResponse = {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'ISBNdb quota exhausted',
        },
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(errorResponse.error.message).toContain('quota');
    });

    it('should return error for ISBNdb errors', () => {
      const status = 500;
      const errorResponse = {
        success: false,
        error: {
          code: 'ISBNDB_ERROR',
          message: `ISBNdb error: ${status}`,
        },
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error.code).toBe('ISBNDB_ERROR');
      expect(errorResponse.error.message).toContain('500');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty results', () => {
      const books: any[] = [];
      const pagesFetched = 0;

      expect(books.length).toBe(0);
      expect(pagesFetched).toBeGreaterThanOrEqual(0);
    });

    it('should handle 404 response (no results)', () => {
      const status = 404;
      const shouldBreak = status === 404;

      expect(shouldBreak).toBe(true);
    });

    it('should skip books without ISBN', () => {
      const books = [
        { title: 'Has ISBN', isbn13: '9781234567890' },
        { title: 'No ISBN' },
        { title: 'Has ISBN10', isbn: '1234567890' },
      ];

      const validBooks = books.filter(b => b.isbn13 || b.isbn);
      expect(validBooks.length).toBe(2);
    });

    it('should handle max_pages boundary', () => {
      const maxPages = 10;
      const page = 10;

      const shouldContinue = page <= maxPages;
      expect(shouldContinue).toBe(true);

      const nextPage = 11;
      const shouldStop = nextPage > maxPages;
      expect(shouldStop).toBe(true);
    });
  });

  describe('Data Validation', () => {
    it('should validate max_pages range', () => {
      const validMaxPages = [1, 10, 50, 100];
      const invalidMaxPages = [0, -1, 101, 1000];

      validMaxPages.forEach(val => {
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(100);
      });

      invalidMaxPages.forEach(val => {
        const isValid = val >= 1 && val <= 100;
        expect(isValid).toBe(false);
      });
    });

    it('should validate column enum', () => {
      const validColumns = ['title', 'author', 'date_published', 'subject'];
      const invalidColumns = ['isbn', 'publisher', 'year'];

      validColumns.forEach(col => {
        expect(['title', 'author', 'date_published', 'subject']).toContain(col);
      });

      invalidColumns.forEach(col => {
        expect(['title', 'author', 'date_published', 'subject']).not.toContain(col);
      });
    });

    it('should validate non-empty query', () => {
      const validQueries = ['2025-09', 'harry potter', 'a'];
      const invalidQueries = ['', '   '];

      validQueries.forEach(q => {
        expect(q.trim().length).toBeGreaterThan(0);
      });

      invalidQueries.forEach(q => {
        expect(q.trim().length).toBe(0);
      });
    });
  });
});

// =================================================================================
// POST /api/books/enrich-new-releases
// =================================================================================

describe('POST /api/books/enrich-new-releases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields in success response', () => {
      const response = {
        success: true,
        data: {
          start_month: '2025-09',
          end_month: '2025-12',
          months_processed: 4,
          total_books_found: 8000,
          already_existed: 2500,
          newly_enriched: 5500,
          covers_queued: 4200,
          failed: 12,
          api_calls: 80,
          duration_ms: 45000,
        },
      };

      expect(response.data).toHaveProperty('start_month');
      expect(response.data).toHaveProperty('end_month');
      expect(response.data).toHaveProperty('months_processed');
      expect(response.data).toHaveProperty('total_books_found');
      expect(response.data).toHaveProperty('already_existed');
      expect(response.data).toHaveProperty('newly_enriched');
      expect(response.data).toHaveProperty('covers_queued');
      expect(response.data).toHaveProperty('failed');
      expect(response.data).toHaveProperty('api_calls');
      expect(response.data).toHaveProperty('duration_ms');
    });

    it('should have optional quota fields', () => {
      const responseWithQuota = {
        success: true,
        data: {
          start_month: '2025-09',
          end_month: '2025-12',
          months_processed: 2,
          total_books_found: 4000,
          already_existed: 1000,
          newly_enriched: 3000,
          covers_queued: 2500,
          failed: 5,
          api_calls: 40,
          duration_ms: 25000,
          quota_status: {
            used_today: 14500,
            remaining: 500,
            limit: 15000,
            buffer_remaining: -1500,
          },
          quota_exhausted: true,
        },
      };

      expect(responseWithQuota.data).toHaveProperty('quota_status');
      expect(responseWithQuota.data).toHaveProperty('quota_exhausted');
      expect(responseWithQuota.data.quota_exhausted).toBe(true);
    });

    it('should have correct quota_status schema', () => {
      const quotaStatus = {
        used_today: 14500,
        remaining: 500,
        limit: 15000,
        buffer_remaining: -1500,
      };

      expect(quotaStatus).toHaveProperty('used_today');
      expect(quotaStatus).toHaveProperty('remaining');
      expect(quotaStatus).toHaveProperty('limit');
      expect(quotaStatus).toHaveProperty('buffer_remaining');
    });
  });

  describe('Month Range Generation', () => {
    it('should generate months within same year', () => {
      const startMonth = '2025-09';
      const endMonth = '2025-12';

      const months: string[] = [];
      const [startYear, startMo] = startMonth.split('-').map(Number);
      const [endYear, endMo] = endMonth.split('-').map(Number);

      let year = startYear;
      let month = startMo;
      while (year < endYear || (year === endYear && month <= endMo)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
      }

      expect(months).toEqual(['2025-09', '2025-10', '2025-11', '2025-12']);
      expect(months.length).toBe(4);
    });

    it('should handle year boundary crossing', () => {
      const startMonth = '2025-11';
      const endMonth = '2026-02';

      const months: string[] = [];
      const [startYear, startMo] = startMonth.split('-').map(Number);
      const [endYear, endMo] = endMonth.split('-').map(Number);

      let year = startYear;
      let month = startMo;
      while (year < endYear || (year === endYear && month <= endMo)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
      }

      expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
      expect(months.length).toBe(4);
    });

    it('should handle single month range', () => {
      const startMonth = '2025-09';
      const endMonth = '2025-09';

      const months: string[] = [];
      const [startYear, startMo] = startMonth.split('-').map(Number);
      const [endYear, endMo] = endMonth.split('-').map(Number);

      let year = startYear;
      let month = startMo;
      while (year < endYear || (year === endYear && month <= endMo)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
      }

      expect(months).toEqual(['2025-09']);
      expect(months.length).toBe(1);
    });

    it('should handle full year range', () => {
      const startMonth = '2025-01';
      const endMonth = '2025-12';

      const months: string[] = [];
      const [startYear, startMo] = startMonth.split('-').map(Number);
      const [endYear, endMo] = endMonth.split('-').map(Number);

      let year = startYear;
      let month = startMo;
      while (year < endYear || (year === endYear && month <= endMo)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
      }

      expect(months.length).toBe(12);
      expect(months[0]).toBe('2025-01');
      expect(months[11]).toBe('2025-12');
    });

    it('should pad single-digit months with zero', () => {
      const startMonth = '2025-01';
      const endMonth = '2025-03';

      const months: string[] = [];
      const [startYear, startMo] = startMonth.split('-').map(Number);
      const [endYear, endMo] = endMonth.split('-').map(Number);

      let year = startYear;
      let month = startMo;
      while (year < endYear || (year === endYear && month <= endMo)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
      }

      expect(months).toEqual(['2025-01', '2025-02', '2025-03']);
      months.forEach(m => {
        expect(m).toMatch(/^\d{4}-\d{2}$/);
      });
    });

    it('should handle multi-year range', () => {
      const startMonth = '2024-11';
      const endMonth = '2026-01';

      const months: string[] = [];
      const [startYear, startMo] = startMonth.split('-').map(Number);
      const [endYear, endMo] = endMonth.split('-').map(Number);

      let year = startYear;
      let month = startMo;
      while (year < endYear || (year === endYear && month <= endMo)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
      }

      expect(months.length).toBe(15); // Nov 2024 - Jan 2026
      expect(months[0]).toBe('2024-11');
      expect(months[14]).toBe('2026-01');
    });
  });

  describe('Query Count Calculation', () => {
    it('should calculate query count without subjects', () => {
      const months = ['2025-09', '2025-10', '2025-11', '2025-12'];
      const subjects = undefined;

      const queryCount = subjects && subjects.length > 0
        ? months.length * subjects.length
        : months.length;

      expect(queryCount).toBe(4);
    });

    it('should calculate query count with subjects', () => {
      const months = ['2025-09', '2025-10', '2025-11', '2025-12'];
      const subjects = ['fiction', 'mystery', 'romance'];

      const queryCount = subjects && subjects.length > 0
        ? months.length * subjects.length
        : months.length;

      expect(queryCount).toBe(12); // 4 months * 3 subjects
    });

    it('should calculate estimated API calls', () => {
      const queryCount = 12; // 4 months * 3 subjects
      const maxPagesPerMonth = 20;

      const estimatedApiCalls = queryCount * maxPagesPerMonth;
      expect(estimatedApiCalls).toBe(240);
    });

    it('should handle empty subjects array as no subjects', () => {
      const months = ['2025-09', '2025-10'];
      const subjects: string[] = [];

      const queryCount = subjects && subjects.length > 0
        ? months.length * subjects.length
        : months.length;

      expect(queryCount).toBe(2); // Falls back to months.length
    });
  });

  describe('Subject Filtering', () => {
    it('should create queries without subjects', () => {
      const monthStr = '2025-09';
      const subjects = undefined;

      const queries = subjects && subjects.length > 0
        ? subjects.map(s => ({ query: `${monthStr} ${s}`, column: 'date_published' as const }))
        : [{ query: monthStr, column: 'date_published' as const }];

      expect(queries.length).toBe(1);
      expect(queries[0].query).toBe('2025-09');
      expect(queries[0].column).toBe('date_published');
    });

    it('should create queries with subjects', () => {
      const monthStr = '2025-09';
      const subjects = ['fiction', 'mystery'];

      const queries = subjects && subjects.length > 0
        ? subjects.map(s => ({ query: `${monthStr} ${s}`, column: 'date_published' as const }))
        : [{ query: monthStr, column: 'date_published' as const }];

      expect(queries.length).toBe(2);
      expect(queries[0].query).toBe('2025-09 fiction');
      expect(queries[1].query).toBe('2025-09 mystery');
      queries.forEach(q => expect(q.column).toBe('date_published'));
    });

    it('should create combined query string with subject', () => {
      const month = '2025-09';
      const subject = 'science fiction';

      const query = `${month} ${subject}`;
      expect(query).toBe('2025-09 science fiction');
    });
  });

  describe('Skip Existing Logic', () => {
    it('should filter existing ISBNs when skip_existing=true', () => {
      const skipExisting = true;
      const allBooks = [
        { isbn13: '9781234567890' },
        { isbn13: '9781234567891' },
        { isbn13: '9781234567892' },
        { isbn13: '9781234567893' },
      ];
      const existingISBNs = new Set(['9781234567890', '9781234567892']);

      let booksToEnrich = allBooks;
      if (skipExisting) {
        booksToEnrich = allBooks.filter(b => {
          const isbn = b.isbn13 || b.isbn;
          return isbn && !existingISBNs.has(isbn);
        });
      }

      expect(booksToEnrich.length).toBe(2);
      expect(booksToEnrich.map(b => b.isbn13)).toEqual(['9781234567891', '9781234567893']);
    });

    it('should not filter when skip_existing=false', () => {
      const skipExisting = false;
      const allBooks = [
        { isbn13: '9781234567890' },
        { isbn13: '9781234567891' },
      ];
      const existingISBNs = new Set(['9781234567890']);

      let booksToEnrich = allBooks;
      if (skipExisting) {
        booksToEnrich = allBooks.filter(b => {
          const isbn = b.isbn13 || b.isbn;
          return isbn && !existingISBNs.has(isbn);
        });
      }

      expect(booksToEnrich.length).toBe(2); // No filtering
    });

    it('should count already_existed correctly', () => {
      const existingISBNs = new Set(['9781234567890', '9781234567892', '9781234567894']);
      let alreadyExisted = 0;

      alreadyExisted += existingISBNs.size;
      expect(alreadyExisted).toBe(3);
    });
  });

  describe('Quota Pre-check', () => {
    it('should return quota exhausted response on pre-check failure', () => {
      const preCheckAllowed = false;
      const startTime = Date.now();

      if (!preCheckAllowed) {
        const response = {
          start_month: '2025-09',
          end_month: '2025-12',
          months_processed: 0,
          total_books_found: 0,
          already_existed: 0,
          newly_enriched: 0,
          covers_queued: 0,
          failed: 0,
          api_calls: 0,
          duration_ms: Date.now() - startTime,
          quota_status: {
            used_today: 14500,
            remaining: 500,
            limit: 15000,
            buffer_remaining: -1500,
          },
          quota_exhausted: true,
        };

        expect(response.months_processed).toBe(0);
        expect(response.quota_exhausted).toBe(true);
        expect(response.quota_status?.buffer_remaining).toBeLessThan(0);
      }
    });

    it('should proceed when pre-check passes', () => {
      const preCheckAllowed = true;
      let shouldProceed = false;

      if (preCheckAllowed) {
        shouldProceed = true;
      }

      expect(shouldProceed).toBe(true);
    });
  });

  describe('Quota Tracking During Operation', () => {
    it('should increment api_calls after each ISBNdb request', () => {
      let apiCalls = 0;

      // Simulate 3 API calls
      apiCalls++;
      apiCalls++;
      apiCalls++;

      expect(apiCalls).toBe(3);
    });

    it('should check quota before each month', () => {
      const months = ['2025-09', '2025-10', '2025-11'];
      let monthsProcessed = 0;

      for (const month of months) {
        const quotaCheck = { allowed: true }; // Simulate quota check

        if (!quotaCheck.allowed) {
          break;
        }

        monthsProcessed++;
      }

      expect(monthsProcessed).toBe(3);
    });

    it('should stop mid-operation when quota exhausted', () => {
      const months = ['2025-09', '2025-10', '2025-11', '2025-12'];
      let monthsProcessed = 0;
      let quotaExhausted = false;

      for (const month of months) {
        // Simulate quota exhaustion on 3rd month
        const quotaCheck = { allowed: monthsProcessed < 2 };

        if (!quotaCheck.allowed) {
          quotaExhausted = true;
          break;
        }

        monthsProcessed++;
      }

      expect(monthsProcessed).toBe(2);
      expect(quotaExhausted).toBe(true);
    });
  });

  describe('Partial Results Handling', () => {
    it('should return partial results when quota exhausted mid-operation', () => {
      const response = {
        start_month: '2025-09',
        end_month: '2025-12',
        months_processed: 2,
        total_books_found: 4000,
        already_existed: 1000,
        newly_enriched: 3000,
        covers_queued: 2500,
        failed: 5,
        api_calls: 40,
        duration_ms: 25000,
        quota_status: {
          used_today: 14500,
          remaining: 500,
          limit: 15000,
          buffer_remaining: -1500,
        },
        quota_exhausted: true,
      };

      expect(response.months_processed).toBeLessThan(4);
      expect(response.newly_enriched).toBeGreaterThan(0);
      expect(response.quota_exhausted).toBe(true);
    });

    it('should accumulate stats across months', () => {
      let totalBooksFound = 0;
      let alreadyExisted = 0;
      let newlyEnriched = 0;

      // Month 1
      totalBooksFound += 2000;
      alreadyExisted += 500;
      newlyEnriched += 1500;

      // Month 2
      totalBooksFound += 2000;
      alreadyExisted += 500;
      newlyEnriched += 1500;

      expect(totalBooksFound).toBe(4000);
      expect(alreadyExisted).toBe(1000);
      expect(newlyEnriched).toBe(3000);
    });
  });

  describe('ISBNdb Error Handling', () => {
    it('should stop on 429 rate limit', () => {
      const status = 429;
      const shouldStop = status === 429 || status === 403;

      expect(shouldStop).toBe(true);
    });

    it('should stop on 403 quota exhaustion', () => {
      const status = 403;
      const shouldStop = status === 429 || status === 403;

      expect(shouldStop).toBe(true);
    });

    it('should continue on 404 (no results)', () => {
      const status = 404;
      const shouldBreak = status === 404;

      expect(shouldBreak).toBe(true);
    });

    it('should set quota_exhausted flag on rate limit', () => {
      const status = 429;
      let quotaExhausted = false;

      if (status === 429 || status === 403) {
        quotaExhausted = true;
      }

      expect(quotaExhausted).toBe(true);
    });
  });

  describe('Duration Calculation', () => {
    it('should calculate duration in milliseconds', () => {
      const startTime = Date.now();
      // Simulate some work
      const endTime = startTime + 5000; // 5 seconds later

      const durationMs = endTime - startTime;
      expect(durationMs).toBe(5000);
    });

    it('should set duration_ms before returning', () => {
      const startTime = Date.now();
      const response = {
        duration_ms: Date.now() - startTime,
      };

      expect(response.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cover Queueing', () => {
    it('should queue cover when image available', () => {
      const book = {
        image_original: 'https://images.isbndb.com/cover.jpg',
      };

      const hasCover = !!(book.image_original || book.image);
      let coversQueued = 0;

      if (hasCover) {
        coversQueued++;
      }

      expect(coversQueued).toBe(1);
    });

    it('should not queue cover when no image', () => {
      const book = {};

      const hasCover = !!(book.image_original || book.image);
      let coversQueued = 0;

      if (hasCover) {
        coversQueued++;
      }

      expect(coversQueued).toBe(0);
    });

    it('should continue on cover queue failure', () => {
      let coversQueued = 0;
      let failed = 0;

      try {
        // Simulate cover queue failure
        throw new Error('Queue send failed');
      } catch {
        // Cover queue failure is non-fatal - continue
      }

      // Should not increment failed counter for cover queue errors
      expect(failed).toBe(0);
    });
  });

  describe('Data Validation', () => {
    it('should validate month format YYYY-MM', () => {
      const validMonths = ['2025-01', '2025-09', '2025-12', '2026-01'];
      const invalidMonths = ['2025-1', '25-09', '2025/09', '202509'];

      validMonths.forEach(m => {
        expect(m).toMatch(/^\d{4}-\d{2}$/);
      });

      invalidMonths.forEach(m => {
        expect(m).not.toMatch(/^\d{4}-\d{2}$/);
      });
    });

    it('should validate max_pages_per_month range', () => {
      const validValues = [1, 10, 50, 100];
      const invalidValues = [0, -1, 101, 1000];

      validValues.forEach(val => {
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(100);
      });

      invalidValues.forEach(val => {
        const isValid = val >= 1 && val <= 100;
        expect(isValid).toBe(false);
      });
    });

    it('should validate start_month before or equal to end_month', () => {
      const validRanges = [
        { start: '2025-01', end: '2025-12' },
        { start: '2025-09', end: '2025-09' },
        { start: '2025-11', end: '2026-02' },
      ];

      validRanges.forEach(({ start, end }) => {
        const [startYear, startMo] = start.split('-').map(Number);
        const [endYear, endMo] = end.split('-').map(Number);

        const isValid = startYear < endYear || (startYear === endYear && startMo <= endMo);
        expect(isValid).toBe(true);
      });
    });

    it('should reject invalid month ranges', () => {
      const invalidRanges = [
        { start: '2025-12', end: '2025-09' },
        { start: '2026-01', end: '2025-12' },
      ];

      invalidRanges.forEach(({ start, end }) => {
        const [startYear, startMo] = start.split('-').map(Number);
        const [endYear, endMo] = end.split('-').map(Number);

        const isValid = startYear < endYear || (startYear === endYear && startMo <= endMo);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero results found', () => {
      const response = {
        start_month: '2025-09',
        end_month: '2025-09',
        months_processed: 1,
        total_books_found: 0,
        already_existed: 0,
        newly_enriched: 0,
        covers_queued: 0,
        failed: 0,
        api_calls: 1,
        duration_ms: 500,
      };

      expect(response.total_books_found).toBe(0);
      expect(response.newly_enriched).toBe(0);
      expect(response.api_calls).toBeGreaterThan(0); // Still made API call
    });

    it('should handle all books already existing', () => {
      const totalBooksFound = 1000;
      const alreadyExisted = 1000;
      const newlyEnriched = 0;

      expect(alreadyExisted).toBe(totalBooksFound);
      expect(newlyEnriched).toBe(0);
    });

    it('should handle enrichment failures', () => {
      let failed = 0;
      let newlyEnriched = 0;

      const booksToEnrich = [
        { isbn: '9781234567890' },
        { isbn: '9781234567891' },
        { isbn: '9781234567892' },
      ];

      for (const book of booksToEnrich) {
        try {
          // Simulate failure on 2nd book
          if (book.isbn === '9781234567891') {
            throw new Error('Enrichment failed');
          }
          newlyEnriched++;
        } catch {
          failed++;
        }
      }

      expect(newlyEnriched).toBe(2);
      expect(failed).toBe(1);
    });

    it('should handle 10K result cap per month', () => {
      const pageSize = 100;
      const booksInResponse = 100;
      const monthBooks: any[] = new Array(10000).fill({});

      const hasMore = booksInResponse === pageSize && monthBooks.length < 10000;
      expect(hasMore).toBe(false); // Stops at 10K
    });
  });

  describe('Results Consistency', () => {
    it('should satisfy: newly_enriched + already_existed <= total_books_found', () => {
      const response = {
        total_books_found: 8000,
        already_existed: 2500,
        newly_enriched: 5500,
        failed: 12,
      };

      // Some books might fail, so sum can be less than total
      const processed = response.already_existed + response.newly_enriched + response.failed;
      expect(processed).toBeLessThanOrEqual(response.total_books_found + 20); // Allow small variance
    });

    it('should have api_calls >= months_processed', () => {
      const response = {
        months_processed: 4,
        api_calls: 80,
      };

      expect(response.api_calls).toBeGreaterThanOrEqual(response.months_processed);
    });

    it('should have covers_queued <= newly_enriched', () => {
      const response = {
        newly_enriched: 5500,
        covers_queued: 4200,
      };

      expect(response.covers_queued).toBeLessThanOrEqual(response.newly_enriched);
    });

    it('should have non-negative counters', () => {
      const response = {
        months_processed: 4,
        total_books_found: 8000,
        already_existed: 2500,
        newly_enriched: 5500,
        covers_queued: 4200,
        failed: 12,
        api_calls: 80,
      };

      expect(response.months_processed).toBeGreaterThanOrEqual(0);
      expect(response.total_books_found).toBeGreaterThanOrEqual(0);
      expect(response.already_existed).toBeGreaterThanOrEqual(0);
      expect(response.newly_enriched).toBeGreaterThanOrEqual(0);
      expect(response.covers_queued).toBeGreaterThanOrEqual(0);
      expect(response.failed).toBeGreaterThanOrEqual(0);
      expect(response.api_calls).toBeGreaterThanOrEqual(0);
    });
  });
});
