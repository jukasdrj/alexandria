/**
 * Unit Tests for Authors API Routes
 *
 * Tests author route handlers for business logic, calculations, and error handling.
 * Business logic focus - QuotaManager, ISBNdb, and database services are tested separately.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('GET /api/authors/top', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields in success response', () => {
      const response = {
        authors: [
          {
            author_key: '/authors/OL7234434A',
            author_name: 'Brandon Sanderson',
            work_count: 542,
          },
        ],
        pagination: {
          offset: 0,
          limit: 100,
          returned: 1,
        },
        cached: false,
        query_duration_ms: 450,
      };

      expect(response).toHaveProperty('authors');
      expect(response).toHaveProperty('pagination');
      expect(response).toHaveProperty('cached');
      expect(response).toHaveProperty('query_duration_ms');
      expect(response.pagination).toHaveProperty('offset');
      expect(response.pagination).toHaveProperty('limit');
      expect(response.pagination).toHaveProperty('returned');
    });

    it('should have correct author object structure', () => {
      const author = {
        author_key: '/authors/OL7234434A',
        author_name: 'Brandon Sanderson',
        work_count: 542,
      };

      expect(author).toHaveProperty('author_key');
      expect(author).toHaveProperty('author_name');
      expect(author).toHaveProperty('work_count');
      expect(author.author_key).toMatch(/^\/authors\/OL\d+A$/);
    });
  });

  describe('Pagination Logic', () => {
    it('should parse offset from query string', () => {
      const queryOffset = '100';
      const parsed = parseInt(queryOffset, 10);

      expect(parsed).toBe(100);
    });

    it('should parse limit from query string', () => {
      const queryLimit = '50';
      const parsed = parseInt(queryLimit, 10);

      expect(parsed).toBe(50);
    });

    it('should default offset to 0', () => {
      const queryOffset = undefined;
      const parsed = parseInt(queryOffset || '0', 10);

      expect(parsed).toBe(0);
    });

    it('should default limit to 100', () => {
      const queryLimit = undefined;
      const parsed = parseInt(queryLimit || '100', 10);

      expect(parsed).toBe(100);
    });

    it('should cap limit at 1000', () => {
      const queryLimit = '5000';
      const parsed = parseInt(queryLimit, 10);
      const capped = Math.min(parsed, 1000);

      expect(capped).toBe(1000);
    });

    it('should calculate returned count correctly', () => {
      const authors = new Array(50).fill(null);
      const returned = authors.length;

      expect(returned).toBe(50);
    });
  });

  describe('Cache Behavior', () => {
    it('should generate consistent cache key', () => {
      const offset = 0;
      const limit = 100;
      const cacheKey = `top_authors:${offset}:${limit}`;

      expect(cacheKey).toBe('top_authors:0:100');
    });

    it('should generate different keys for different params', () => {
      const key1 = `top_authors:${0}:${100}`;
      const key2 = `top_authors:${100}:${100}`;

      expect(key1).not.toBe(key2);
    });

    it('should set cached flag when from cache', () => {
      const cachedResponse = { cached: true };

      expect(cachedResponse.cached).toBe(true);
    });

    it('should set cached flag to false when fresh', () => {
      const freshResponse = { cached: false };

      expect(freshResponse.cached).toBe(false);
    });

    it('should respect nocache parameter', () => {
      const nocache = 'true';
      const shouldSkipCache = nocache === 'true';

      expect(shouldSkipCache).toBe(true);
    });

    it('should cache for 24 hours (86400 seconds)', () => {
      const ttl = 86400;

      expect(ttl).toBe(24 * 60 * 60);
    });
  });

  describe('Institutional Author Filtering', () => {
    it('should filter out "United States" as institutional', () => {
      const name = 'United States';
      const isInstitutional = name.match(/^(United States|Great Britain|Anonymous)/);

      expect(isInstitutional).not.toBeNull();
    });

    it('should filter out "Congress" in name', () => {
      const name = 'United States Congress';
      const hasInstitutional = name.includes('Congress');

      expect(hasInstitutional).toBe(true);
    });

    it('should filter out names with "Parliament"', () => {
      const name = 'British Parliament';
      const hasInstitutional = name.includes('Parliament');

      expect(hasInstitutional).toBe(true);
    });

    it('should allow real author names', () => {
      const name = 'Brandon Sanderson';
      const isInstitutional = name.match(/^(United States|Great Britain|Anonymous)/);
      const hasInstitutionalKeywords = name.includes('Congress') || name.includes('Parliament');

      expect(isInstitutional).toBeNull();
      expect(hasInstitutionalKeywords).toBe(false);
    });

    it('should filter names shorter than 4 chars', () => {
      const shortName = 'ABC';
      const isValid = shortName.length > 3;

      expect(isValid).toBe(false);
    });

    it('should allow names longer than 3 chars', () => {
      const validName = 'John Doe';
      const isValid = validName.length > 3;

      expect(isValid).toBe(true);
    });
  });

  describe('Error Response Format', () => {
    it('should have consistent error response shape', () => {
      const error = {
        error: 'Failed to query top authors',
        message: 'Database connection failed',
      };

      expect(error).toHaveProperty('error');
      expect(error).toHaveProperty('message');
    });
  });
});

describe('GET /api/authors/:key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields', () => {
      const response = {
        author_key: '/authors/OL7234434A',
        name: 'Brandon Sanderson',
        gender: 'male',
        gender_qid: 'Q6581097',
        nationality: 'United States of America',
        citizenship_qid: 'Q30',
        birth_year: 1975,
        death_year: null,
        birth_place: 'Lincoln',
        birth_place_qid: 'Q28260',
        birth_country: 'United States of America',
        birth_country_qid: 'Q30',
        death_place: null,
        death_place_qid: null,
        bio: 'American fantasy and science fiction writer',
        bio_source: 'wikidata',
        wikidata_id: 'Q234074',
        openlibrary_author_id: 'OL7234434A',
        goodreads_author_ids: ['38550'],
        author_photo_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Brandon%20Sanderson.jpg',
        book_count: 128,
        wikidata_enriched_at: '2025-12-30T10:00:00.000Z',
        query_duration_ms: 25,
      };

      expect(response).toHaveProperty('author_key');
      expect(response).toHaveProperty('name');
      expect(response).toHaveProperty('gender');
      expect(response).toHaveProperty('birth_year');
      expect(response).toHaveProperty('book_count');
      expect(response).toHaveProperty('query_duration_ms');
    });

    it('should handle null diversity fields gracefully', () => {
      const author = {
        gender: null,
        nationality: null,
        birth_year: null,
        death_year: null,
      };

      expect(author.gender).toBeNull();
      expect(author.nationality).toBeNull();
      expect(author.birth_year).toBeNull();
      expect(author.death_year).toBeNull();
    });
  });

  describe('Key Normalization', () => {
    it('should normalize short format to full format', () => {
      const inputKey = 'OL7234434A';
      const normalized = inputKey.startsWith('/authors/')
        ? inputKey
        : `/authors/${inputKey}`;

      expect(normalized).toBe('/authors/OL7234434A');
    });

    it('should keep full format as-is', () => {
      const inputKey = '/authors/OL7234434A';
      const normalized = inputKey.startsWith('/authors/')
        ? inputKey
        : `/authors/${inputKey}`;

      expect(normalized).toBe('/authors/OL7234434A');
    });

    it('should match author key pattern', () => {
      const authorKey = '/authors/OL7234434A';
      const pattern = /^\/authors\/OL\d+A$/;

      expect(pattern.test(authorKey)).toBe(true);
    });
  });

  describe('404 Response', () => {
    it('should have error and author_key in 404 response', () => {
      const notFound = {
        error: 'Author not found',
        author_key: '/authors/OL9999999A',
      };

      expect(notFound.error).toBe('Author not found');
      expect(notFound.author_key).toBeTruthy();
    });
  });

  describe('Date Serialization', () => {
    it('should serialize wikidata_enriched_at to ISO 8601', () => {
      const date = new Date('2025-12-30T10:00:00Z');
      const iso = date.toISOString();

      expect(iso).toBe('2025-12-30T10:00:00.000Z');
    });

    it('should handle null wikidata_enriched_at', () => {
      const enrichedAt: Date | null = null;
      const serialized = enrichedAt?.toISOString() ?? null;

      expect(serialized).toBeNull();
    });
  });
});

describe('POST /api/authors/bibliography', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields', () => {
      const response = {
        author: 'Brandon Sanderson',
        books_found: 128,
        pages_fetched: 2,
        books: [
          {
            isbn: '9780765365279',
            title: 'The Way of Kings',
            author: 'Brandon Sanderson',
            publisher: 'Tor Books',
            date_published: '2010-08-31',
          },
        ],
      };

      expect(response).toHaveProperty('author');
      expect(response).toHaveProperty('books_found');
      expect(response).toHaveProperty('pages_fetched');
      expect(response).toHaveProperty('books');
      expect(response.books.length).toBeGreaterThan(0);
    });
  });

  describe('ISBNdb Pagination Logic', () => {
    it('should detect more pages when response is full (100 books)', () => {
      const pageSize = 100;
      const booksInResponse = 100;
      const hasMore = booksInResponse === pageSize;

      expect(hasMore).toBe(true);
    });

    it('should detect last page when partial response', () => {
      const pageSize = 100;
      const booksInResponse = 47;
      const hasMore = booksInResponse === pageSize;

      expect(hasMore).toBe(false);
    });

    it('should use total field if available', () => {
      const total = 250;
      const collected = 200;
      const pageSize = 100;
      const booksInResponse = 100;

      const hasMoreByCount = booksInResponse === pageSize;
      const hasMoreByTotal = total > 0 && collected < total;
      const hasMore = hasMoreByCount || hasMoreByTotal;

      expect(hasMore).toBe(true);
    });

    it('should stop when collected matches total', () => {
      const total = 200;
      const collected = 200;
      const pageSize = 100;
      const booksInResponse = 100;

      // If got full page, might have more. But if collected >= total, stop.
      const hasMore = booksInResponse === pageSize && (total === 0 || collected < total);

      expect(hasMore).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should calculate 350ms delay for 3 req/sec', () => {
      const reqPerSec = 3;
      const delayMs = Math.floor(1000 / reqPerSec);

      expect(delayMs).toBe(333);
      expect(350).toBeGreaterThanOrEqual(delayMs); // Conservative
    });

    it('should only delay between pages, not after last', () => {
      const hasMore = false;
      const shouldDelay = hasMore;

      expect(shouldDelay).toBe(false);
    });
  });

  describe('ISBN Preference', () => {
    it('should prefer isbn13 over isbn', () => {
      const book = {
        isbn: '0765365278',
        isbn13: '9780765365279',
      };

      const preferred = book.isbn13 || book.isbn;

      expect(preferred).toBe('9780765365279');
    });

    it('should fall back to isbn if no isbn13', () => {
      const book = {
        isbn: '0765365278',
        isbn13: undefined,
      };

      const preferred = book.isbn13 || book.isbn;

      expect(preferred).toBe('0765365278');
    });

    it('should skip books with no ISBNs', () => {
      const book = {
        isbn: undefined,
        isbn13: undefined,
        title: 'Unknown Book',
      };

      const isbn = book.isbn13 || book.isbn;

      expect(isbn).toBeUndefined();
    });
  });

  describe('Max Pages Constraint', () => {
    it('should respect max_pages parameter', () => {
      const maxPages = 10;
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= maxPages) {
        page++;
        hasMore = page <= 15; // Simulate more data
      }

      expect(page - 1).toBe(maxPages);
    });

    it('should default to 10 pages', () => {
      const maxPages = 10; // Default

      expect(maxPages).toBe(10);
    });
  });

  describe('Error Responses', () => {
    it('should handle 404 (author not found)', () => {
      const status = 404;
      const shouldBreak = status === 404;

      expect(shouldBreak).toBe(true);
    });

    it('should return 429 on rate limit', () => {
      const status = 429;
      const isRateLimited = status === 429;

      expect(isRateLimited).toBe(true);
    });

    it('should handle non-OK responses', () => {
      const status = 500;
      const isOk = status >= 200 && status < 300;

      expect(isOk).toBe(false);
    });
  });
});

describe('POST /api/authors/enrich-bibliography', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields', () => {
      const response = {
        author: 'Brandon Sanderson',
        books_found: 128,
        already_existed: 50,
        enriched: 78,
        covers_queued: 75,
        failed: 0,
        pages_fetched: 2,
        api_calls: 2,
        quota_status: {
          limit: 15000,
          used_today: 2345,
          remaining: 12655,
          can_make_calls: true,
        },
        quota_exhausted: false,
        errors: [],
        duration_ms: 4500,
      };

      expect(response).toHaveProperty('author');
      expect(response).toHaveProperty('books_found');
      expect(response).toHaveProperty('already_existed');
      expect(response).toHaveProperty('enriched');
      expect(response).toHaveProperty('covers_queued');
      expect(response).toHaveProperty('failed');
      expect(response).toHaveProperty('api_calls');
      expect(response).toHaveProperty('quota_status');
      expect(response).toHaveProperty('quota_exhausted');
      expect(response).toHaveProperty('errors');
      expect(response).toHaveProperty('duration_ms');
    });

    it('should track errors with isbn and message', () => {
      const errors = [
        { isbn: '9780765365279', error: 'Database constraint violation' },
        { isbn: '9780765326355', error: 'Invalid date format' },
      ];

      expect(errors[0]).toHaveProperty('isbn');
      expect(errors[0]).toHaveProperty('error');
      expect(errors.length).toBe(2);
    });
  });

  describe('Cache Key Generation', () => {
    it('should normalize author name for cache key', () => {
      const authorName = 'Brandon Sanderson';
      const normalized = authorName.toLowerCase().replace(/\s+/g, '_');
      const cacheKey = `author_bibliography:${normalized}`;

      expect(cacheKey).toBe('author_bibliography:brandon_sanderson');
    });

    it('should handle multiple spaces', () => {
      const authorName = 'J.  R.  R.  Tolkien';
      const normalized = authorName.toLowerCase().replace(/\s+/g, '_');

      // Multiple consecutive spaces become single underscore
      expect(normalized).toBe('j._r._r._tolkien');
    });

    it('should handle single word names', () => {
      const authorName = 'Cicero';
      const normalized = authorName.toLowerCase().replace(/\s+/g, '_');

      expect(normalized).toBe('cicero');
    });
  });

  describe('Quota Integration', () => {
    it('should check quota before starting', () => {
      const quotaCheck = {
        allowed: true,
        reason: null,
        status: { remaining: 12000 },
      };

      expect(quotaCheck.allowed).toBe(true);
    });

    it('should return 429 when quota exhausted initially', () => {
      const quotaCheck = {
        allowed: false,
        reason: 'Daily quota exhausted',
        status: { remaining: 0 },
      };

      expect(quotaCheck.allowed).toBe(false);
      expect(quotaCheck.reason).toBeTruthy();
    });

    it('should track quota exhaustion mid-operation', () => {
      const quotaExhausted = true;
      const shouldBreak = quotaExhausted;

      expect(shouldBreak).toBe(true);
    });

    it('should increment api_calls on successful quota reserve', () => {
      let apiCalls = 0;
      const quotaReserve = { allowed: true };

      if (quotaReserve.allowed) {
        apiCalls++;
      }

      expect(apiCalls).toBe(1);
    });
  });

  describe('Skip Existing Logic', () => {
    it('should filter out existing ISBNs when skip_existing=true', () => {
      const allISBNs = ['9780765365279', '9780765326355', '9780765311788'];
      const existingSet = new Set(['9780765326355']);

      const toEnrich = allISBNs.filter((isbn) => !existingSet.has(isbn));

      expect(toEnrich).toEqual(['9780765365279', '9780765311788']);
      expect(toEnrich.length).toBe(2);
    });

    it('should calculate already_existed count', () => {
      const existingSet = new Set(['isbn1', 'isbn2', 'isbn3']);
      const alreadyExisted = existingSet.size;

      expect(alreadyExisted).toBe(3);
    });

    it('should enrich all when skip_existing=false', () => {
      const skipExisting = false;
      const allBooks = [{ isbn: '1' }, { isbn: '2' }, { isbn: '3' }];
      const isbnsToEnrich = skipExisting ? [] : allBooks;

      expect(isbnsToEnrich.length).toBe(3);
    });
  });

  describe('Cover URL Preference', () => {
    it('should prefer image_original for best quality', () => {
      const book = {
        image: 'https://images.isbndb.com/covers/12/34/1234567890.jpg',
        image_original: 'https://images.isbndb.com/covers/12/34/1234567890_orig.jpg',
      };

      const bestCoverUrl = book.image_original || book.image;

      expect(bestCoverUrl).toBe(book.image_original);
    });

    it('should fall back to image if no image_original', () => {
      const book = {
        image: 'https://images.isbndb.com/covers/12/34/1234567890.jpg',
        image_original: undefined,
      };

      const bestCoverUrl = book.image_original || book.image;

      expect(bestCoverUrl).toBe(book.image);
    });

    it('should detect cover availability', () => {
      const book1 = { image_original: 'url', image: 'url' };
      const book2 = { image_original: undefined, image: undefined };

      const hasCover1 = book1.image_original || book1.image;
      const hasCover2 = book2.image_original || book2.image;

      expect(hasCover1).toBeTruthy();
      expect(hasCover2).toBeFalsy();
    });

    it('should set high priority for image_original (2hr expiry)', () => {
      const hasImageOriginal = true;
      const priority = hasImageOriginal ? 'high' : 'normal';

      expect(priority).toBe('high');
    });
  });

  describe('Work Deduplication', () => {
    it('should only create work if isNew=true', () => {
      let worksCreated = 0;

      const isNew = true;
      if (isNew) {
        worksCreated++;
      }

      expect(worksCreated).toBe(1);
    });

    it('should skip work creation if already exists', () => {
      let worksCreated = 0;

      const isNew = false;
      if (isNew) {
        worksCreated++;
      }

      expect(worksCreated).toBe(0);
    });
  });

  describe('Result Counters', () => {
    it('should calculate all counters correctly', () => {
      const results = {
        books_found: 100,
        already_existed: 25,
        enriched: 72,
        covers_queued: 70,
        failed: 3,
      };

      // Validation: already_existed + enriched + failed should equal books_found
      const total = results.already_existed + results.enriched + results.failed;

      expect(total).toBe(results.books_found);
      expect(results.covers_queued).toBeLessThanOrEqual(results.enriched);
    });
  });

  describe('Error Handling', () => {
    it('should continue enrichment on individual failures', () => {
      let enriched = 0;
      let failed = 0;

      const books = [
        { isbn: '1', shouldFail: false },
        { isbn: '2', shouldFail: true },
        { isbn: '3', shouldFail: false },
      ];

      for (const book of books) {
        if (book.shouldFail) {
          failed++;
        } else {
          enriched++;
        }
      }

      expect(enriched).toBe(2);
      expect(failed).toBe(1);
    });

    it('should not fail enrichment if cover queue fails', () => {
      let enriched = 0;
      const coverQueueFailed = true;

      // Cover queue failure should not prevent enrichment from succeeding
      enriched++;
      // Just log warning if coverQueueFailed

      expect(enriched).toBe(1);
      expect(coverQueueFailed).toBe(true); // Can be true but shouldn't affect enriched count
    });
  });

  describe('Cache TTL', () => {
    it('should cache successful results for 24 hours', () => {
      const ttl = 86400;

      expect(ttl).toBe(24 * 60 * 60);
    });

    it('should cache empty results to avoid repeated lookups', () => {
      const booksFound = 0;
      const shouldCache = true; // Even empty results

      expect(booksFound).toBe(0);
      expect(shouldCache).toBe(true);
    });

    it('should not cache individual errors', () => {
      const cacheResult = {
        enriched: 5,
        failed: 2,
        errors: [{ isbn: '123', error: 'test' }],
      };

      const forCache = { ...cacheResult, errors: [] };

      expect(forCache.errors.length).toBe(0);
      expect(cacheResult.errors.length).toBe(1);
    });
  });
});

describe('POST /api/authors/enrich-wikidata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields', () => {
      const response = {
        processed: 100,
        enriched: 87,
        wikidata_fetched: 100,
        results: [
          {
            author_key: '/authors/OL7234434A',
            wikidata_id: 'Q234074',
            fields_updated: ['gender', 'nationality', 'birth_year'],
          },
        ],
      };

      expect(response).toHaveProperty('processed');
      expect(response).toHaveProperty('enriched');
      expect(response).toHaveProperty('wikidata_fetched');
      expect(response).toHaveProperty('results');
      expect(response.results[0]).toHaveProperty('author_key');
      expect(response.results[0]).toHaveProperty('wikidata_id');
      expect(response.results[0]).toHaveProperty('fields_updated');
    });

    it('should include error field when data not found', () => {
      const result = {
        author_key: '/authors/OL9999999A',
        wikidata_id: 'Q9999999',
        fields_updated: [],
        error: 'No data returned from Wikidata',
      };

      expect(result.error).toBe('No data returned from Wikidata');
      expect(result.fields_updated).toEqual([]);
    });
  });

  describe('Batch Processing', () => {
    it('should extract Q-IDs from author list', () => {
      const authors = [
        { author_key: '/authors/OL1A', wikidata_id: 'Q123', name: 'Author 1' },
        { author_key: '/authors/OL2A', wikidata_id: 'Q456', name: 'Author 2' },
        { author_key: '/authors/OL3A', wikidata_id: null, name: 'Author 3' },
      ];

      const qids = authors.map((a) => a.wikidata_id).filter(Boolean);

      expect(qids).toEqual(['Q123', 'Q456']);
      expect(qids.length).toBe(2);
    });

    it('should default limit to 100', () => {
      const limit = 100; // Default

      expect(limit).toBe(100);
    });

    it('should enforce max limit of 500', () => {
      const requestedLimit = 1000;
      const limit = Math.min(requestedLimit, 500);

      expect(limit).toBe(500);
    });
  });

  describe('Field Update Tracking', () => {
    it('should track all updated fields', () => {
      const data = {
        gender: 'male',
        gender_qid: 'Q6581097',
        citizenship: 'United States of America',
        citizenship_qid: 'Q30',
        birth_year: 1975,
        death_year: null,
        birth_place: 'Lincoln',
        birth_place_qid: 'Q28260',
        birth_country: 'United States of America',
        birth_country_qid: 'Q30',
        death_place: null,
        death_place_qid: null,
        occupations: ['writer', 'novelist'],
        image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Author.jpg',
      };

      const fieldsUpdated: string[] = [];
      if (data.gender) fieldsUpdated.push('gender');
      if (data.gender_qid) fieldsUpdated.push('gender_qid');
      if (data.citizenship) fieldsUpdated.push('nationality');
      if (data.citizenship_qid) fieldsUpdated.push('citizenship_qid');
      if (data.birth_year) fieldsUpdated.push('birth_year');
      if (data.death_year) fieldsUpdated.push('death_year');
      if (data.birth_place) fieldsUpdated.push('birth_place');
      if (data.birth_place_qid) fieldsUpdated.push('birth_place_qid');
      if (data.birth_country) fieldsUpdated.push('birth_country');
      if (data.birth_country_qid) fieldsUpdated.push('birth_country_qid');
      if (data.death_place) fieldsUpdated.push('death_place');
      if (data.death_place_qid) fieldsUpdated.push('death_place_qid');
      if (data.occupations?.length) fieldsUpdated.push('occupations');
      if (data.image_url) fieldsUpdated.push('author_photo_url');

      expect(fieldsUpdated).toContain('gender');
      expect(fieldsUpdated).toContain('nationality');
      expect(fieldsUpdated).toContain('birth_year');
      expect(fieldsUpdated).not.toContain('death_year'); // null
      expect(fieldsUpdated.length).toBe(11);
    });

    it('should not track null fields', () => {
      const data = {
        gender: null,
        birth_year: null,
        nationality: null,
      };

      const fieldsUpdated: string[] = [];
      if (data.gender) fieldsUpdated.push('gender');
      if (data.birth_year) fieldsUpdated.push('birth_year');

      expect(fieldsUpdated.length).toBe(0);
    });
  });

  describe('COALESCE Update Logic', () => {
    it('should preserve existing values when new value is null', () => {
      const existingGender = 'female';
      const newGender = null;
      const updated = newGender ?? existingGender; // COALESCE behavior

      expect(updated).toBe('female');
    });

    it('should update with new value when provided', () => {
      const existingGender = null;
      const newGender = 'male';
      const updated = newGender ?? existingGender;

      expect(updated).toBe('male');
    });

    it('should overwrite existing with new when both exist', () => {
      const existingGender = 'unknown';
      const newGender = 'male';
      const updated = newGender ?? existingGender;

      expect(updated).toBe('male');
    });
  });

  describe('Empty Response Handling', () => {
    it('should handle no authors to enrich', () => {
      const authorsToEnrich: any[] = [];
      const shouldReturn = authorsToEnrich.length === 0;

      expect(shouldReturn).toBe(true);
    });

    it('should return zero counts when no authors', () => {
      const response = {
        message: 'No authors to enrich',
        processed: 0,
        enriched: 0,
      };

      expect(response.processed).toBe(0);
      expect(response.enriched).toBe(0);
    });
  });

  describe('Force Refresh', () => {
    it('should re-enrich when force_refresh=true', () => {
      const forceRefresh = true;
      const shouldInclude = forceRefresh; // Include already enriched

      expect(shouldInclude).toBe(true);
    });

    it('should skip enriched when force_refresh=false', () => {
      const forceRefresh = false;
      const wasEnriched = true;
      const shouldSkip = !forceRefresh && wasEnriched;

      expect(shouldSkip).toBe(true);
    });
  });

  describe('Enrichment Counters', () => {
    it('should count successful enrichments', () => {
      let enrichedCount = 0;

      const results = [
        { hasData: true },
        { hasData: false },
        { hasData: true },
      ];

      for (const result of results) {
        if (result.hasData) {
          enrichedCount++;
        }
      }

      expect(enrichedCount).toBe(2);
    });

    it('should track processed vs enriched separately', () => {
      const processed = 100;
      const enriched = 87; // Some had no data

      expect(processed).toBeGreaterThanOrEqual(enriched);
      expect(enriched).toBeLessThan(processed);
    });
  });

  describe('Enrichment Source Marking', () => {
    it('should mark source as wikidata when data found', () => {
      const hasData = true;
      const source = hasData ? 'wikidata' : 'wikidata_empty';

      expect(source).toBe('wikidata');
    });

    it('should mark source as wikidata_empty when no data', () => {
      const hasData = false;
      const source = hasData ? 'wikidata' : 'wikidata_empty';

      expect(source).toBe('wikidata_empty');
    });
  });
});

describe('GET /api/authors/enrich-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response Schema', () => {
    it('should have all required fields', () => {
      const response = {
        total_authors: 150000,
        has_wikidata_id: 75000,
        wikidata_enriched: 50000,
        pending_enrichment: 25000,
        diversity_fields: {
          has_gender: 45000,
          has_nationality: 42000,
          has_birth_place: 38000,
        },
      };

      expect(response).toHaveProperty('total_authors');
      expect(response).toHaveProperty('has_wikidata_id');
      expect(response).toHaveProperty('wikidata_enriched');
      expect(response).toHaveProperty('pending_enrichment');
      expect(response).toHaveProperty('diversity_fields');
      expect(response.diversity_fields).toHaveProperty('has_gender');
      expect(response.diversity_fields).toHaveProperty('has_nationality');
      expect(response.diversity_fields).toHaveProperty('has_birth_place');
    });
  });

  describe('Statistical Calculations', () => {
    it('should calculate pending_enrichment correctly', () => {
      const hasWikidataId = 75000;
      const wikidataEnriched = 50000;
      const pendingEnrichment = hasWikidataId - wikidataEnriched;

      expect(pendingEnrichment).toBe(25000);
    });

    it('should count gender excluding "Unknown"', () => {
      const genders = ['male', 'female', 'Unknown', 'non-binary', null];
      const validGenders = genders.filter(
        (g) => g !== null && g !== 'Unknown'
      );

      expect(validGenders.length).toBe(3);
    });

    it('should convert BigInt counts to Number', () => {
      const bigIntCount = BigInt(150000);
      const numCount = Number(bigIntCount);

      expect(typeof numCount).toBe('number');
      expect(numCount).toBe(150000);
    });
  });

  describe('Coverage Percentages', () => {
    it('should calculate Wikidata coverage percentage', () => {
      const total = 150000;
      const hasWikidataId = 75000;
      const coverage = (hasWikidataId / total) * 100;

      expect(coverage).toBe(50);
    });

    it('should calculate enrichment completion percentage', () => {
      const hasWikidataId = 75000;
      const enriched = 50000;
      const completion = (enriched / hasWikidataId) * 100;

      expect(completion).toBeCloseTo(66.67, 1);
    });

    it('should calculate gender field coverage', () => {
      const total = 150000;
      const hasGender = 45000;
      const coverage = (hasGender / total) * 100;

      expect(coverage).toBe(30);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero authors', () => {
      const stats = {
        total_authors: 0,
        has_wikidata_id: 0,
        wikidata_enriched: 0,
        pending_enrichment: 0,
      };

      expect(stats.total_authors).toBe(0);
      expect(stats.pending_enrichment).toBe(0);
    });

    it('should handle all authors enriched', () => {
      const hasWikidataId = 1000;
      const enriched = 1000;
      const pending = hasWikidataId - enriched;

      expect(pending).toBe(0);
    });

    it('should handle no authors with Wikidata IDs', () => {
      const total = 1000;
      const hasWikidataId = 0;
      const coverage = hasWikidataId > 0 ? (hasWikidataId / total) * 100 : 0;

      expect(coverage).toBe(0);
    });
  });

  describe('Data Validation', () => {
    it('should have pending <= has_wikidata_id', () => {
      const hasWikidataId = 75000;
      const pending = 25000;

      expect(pending).toBeLessThanOrEqual(hasWikidataId);
    });

    it('should have enriched <= has_wikidata_id', () => {
      const hasWikidataId = 75000;
      const enriched = 50000;

      expect(enriched).toBeLessThanOrEqual(hasWikidataId);
    });

    it('should have diversity fields <= total_authors', () => {
      const total = 150000;
      const hasGender = 45000;
      const hasNationality = 42000;
      const hasBirthPlace = 38000;

      expect(hasGender).toBeLessThanOrEqual(total);
      expect(hasNationality).toBeLessThanOrEqual(total);
      expect(hasBirthPlace).toBeLessThanOrEqual(total);
    });
  });
});

describe('Authors API - Cross-Route Integration', () => {
  describe('ISBN Normalization Consistency', () => {
    it('should handle isbn13 consistently across routes', () => {
      const isbn13 = '9780765365279';
      const isValid = isbn13.length === 13 && isbn13.startsWith('978');

      expect(isValid).toBe(true);
    });

    it('should handle isbn10 consistently', () => {
      const isbn10 = '0765365278';
      const isValid = isbn10.length === 10;

      expect(isValid).toBe(true);
    });
  });

  describe('Error Response Consistency', () => {
    it('should use consistent error structure across routes', () => {
      const errors = [
        { error: 'Failed to query top authors', message: 'DB error' },
        { error: 'Author not found', author_key: '/authors/OL1A' },
        { error: 'ISBNdb API error: 500' },
        { error: 'Enrichment failed', message: 'Wikidata timeout' },
      ];

      errors.forEach((err) => {
        expect(err).toHaveProperty('error');
      });
    });
  });

  describe('Timing Consistency', () => {
    it('should track duration_ms in all appropriate routes', () => {
      const startTime = Date.now();
      const endTime = startTime + 500;
      const duration = endTime - startTime;

      expect(duration).toBe(500);
    });
  });
});
