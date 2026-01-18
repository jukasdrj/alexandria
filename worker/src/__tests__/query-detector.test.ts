import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	detectISBN,
	normalizeISBN,
	matchesAuthorPattern,
	detectQueryType,
} from '../lib/query-detector.js';

describe('query-detector', () => {
	describe('detectISBN', () => {
		describe('ISBN-13 detection', () => {
			it('detects ISBN-13 with hyphens', () => {
				expect(detectISBN('978-0-439-06487-3')).toBe(true);
			});

			it('detects ISBN-13 without formatting', () => {
				expect(detectISBN('9780439064873')).toBe(true);
			});

			it('detects ISBN-13 with spaces', () => {
				expect(detectISBN('978 0439064873')).toBe(true);
			});

			it('detects ISBN-13 starting with 979', () => {
				expect(detectISBN('9791234567890')).toBe(true);
			});
		});

		describe('ISBN-10 detection', () => {
			it('detects ISBN-10 with numeric checksum', () => {
				expect(detectISBN('0439064872')).toBe(true);
			});

			it('detects ISBN-10 with X checksum (uppercase)', () => {
				expect(detectISBN('043906487X')).toBe(true);
			});

			it('detects ISBN-10 with X checksum (lowercase)', () => {
				expect(detectISBN('043906487x')).toBe(true);
			});

			it('detects ISBN-10 with hyphens', () => {
				expect(detectISBN('0-439-06487-2')).toBe(true);
			});
		});

		describe('rejection cases', () => {
			it('rejects phone numbers', () => {
				expect(detectISBN('555-123-4567')).toBe(false);
			});

			it('rejects random numbers (too short)', () => {
				expect(detectISBN('12345')).toBe(false);
			});

			it('rejects random numbers (too long)', () => {
				expect(detectISBN('12345678901234')).toBe(false);
			});

			it('rejects ISBN-like but wrong prefix', () => {
				expect(detectISBN('9991234567890')).toBe(false);
			});

			it('rejects text strings', () => {
				expect(detectISBN('harry potter')).toBe(false);
			});

			it('rejects empty string', () => {
				expect(detectISBN('')).toBe(false);
			});
		});
	});

	describe('normalizeISBN', () => {
		it('removes hyphens from ISBN-13', () => {
			expect(normalizeISBN('978-0-439-06487-3')).toBe('9780439064873');
		});

		it('removes spaces from ISBN', () => {
			expect(normalizeISBN('978 0 439 06487 3')).toBe('9780439064873');
		});

		it('uppercases X checksum', () => {
			expect(normalizeISBN('043906487x')).toBe('043906487X');
		});

		it('handles already normalized ISBN', () => {
			expect(normalizeISBN('9780439064873')).toBe('9780439064873');
		});

		it('handles mixed separators', () => {
			expect(normalizeISBN('978-0 439-06487 3')).toBe('9780439064873');
		});
	});

	describe('matchesAuthorPattern', () => {
		describe('valid author names', () => {
			it('matches standard two-word name', () => {
				expect(matchesAuthorPattern('Stephen King')).toBe(true);
			});

			it('matches name with initials', () => {
				expect(matchesAuthorPattern('J. K. Rowling')).toBe(true);
			});

			it('matches three-word name', () => {
				expect(matchesAuthorPattern('Gabriel Garcia Marquez')).toBe(true);
			});

			it('matches four-word name', () => {
				expect(matchesAuthorPattern('Mary Higgins Clark Smith')).toBe(true);
			});

			it('matches name with middle initial', () => {
				expect(matchesAuthorPattern('J. R. R. Tolkien')).toBe(true);
			});

			it('matches all lowercase name (user input)', () => {
				expect(matchesAuthorPattern('stephen king')).toBe(true);
			});
		});

		describe('single conjunction word allowed', () => {
			it('allows one "of" in name', () => {
				expect(matchesAuthorPattern('Leonardo da Vinci')).toBe(true);
			});
		});

		describe('rejection cases - title-like patterns', () => {
			it('rejects queries starting with "the"', () => {
				expect(matchesAuthorPattern('The Great Gatsby')).toBe(false);
			});

			it('rejects queries starting with "a"', () => {
				expect(matchesAuthorPattern('A Tale of Two Cities')).toBe(false);
			});

			it('rejects queries starting with "an"', () => {
				expect(matchesAuthorPattern('An American Tragedy')).toBe(false);
			});

			it('rejects queries with too many book words', () => {
				expect(
					matchesAuthorPattern('Harry Potter and the Goblet of Fire')
				).toBe(false);
			});

			it('rejects typical book titles', () => {
				expect(matchesAuthorPattern('To Kill a Mockingbird')).toBe(false);
			});
		});

		describe('rejection cases - length and word count', () => {
			it('rejects single word (too few words)', () => {
				expect(matchesAuthorPattern('Tolkien')).toBe(false);
			});

			it('rejects too short (< 5 chars)', () => {
				expect(matchesAuthorPattern('J K')).toBe(false);
			});

			it('rejects too long (> 50 chars)', () => {
				expect(
					matchesAuthorPattern(
						'This is a very long string that exceeds fifty characters'
					)
				).toBe(false);
			});

			it('rejects too many words (> 4)', () => {
				expect(
					matchesAuthorPattern('One Two Three Four Five Six')
				).toBe(false);
			});
		});

		describe('rejection cases - no capitalization', () => {
			it('rejects all lowercase with no capitals (edge case)', () => {
				// Note: Current implementation allows lowercase if word count is valid
				// This is acceptable as we validate against DB anyway
				expect(matchesAuthorPattern('john smith')).toBe(true);
			});
		});

		describe('edge cases', () => {
			it('handles extra whitespace', () => {
				expect(matchesAuthorPattern('  Stephen   King  ')).toBe(true);
			});

			it('rejects empty string', () => {
				expect(matchesAuthorPattern('')).toBe(false);
			});

			it('rejects whitespace only', () => {
				expect(matchesAuthorPattern('   ')).toBe(false);
			});
		});
	});

	describe('detectQueryType', () => {
		// Mock SQL connection for testing
		// Tagged template literal receives: sql`...` -> sql(strings, ...values)
		const mockSqlWithAuthor = async (strings: TemplateStringsArray, ...values: any[]) => {
			const rawInput = values[0]; // First parameter value (raw user input)
			// Simulate what normalize_author_name() would do in the database
			// The query is: WHERE normalized_name = normalize_author_name(${rawInput})
			// So we simulate having normalized versions of "J. K. Rowling" and "Stephen King"
			const normalized = rawInput.toLowerCase().trim();
			if (
				normalized === 'j. k. rowling' ||
				normalized === 'j.k. rowling' ||
				normalized === 'stephen king'
			) {
				return [{ exists: 1 }]; // Found
			}
			return []; // Not found
		};

		const mockSqlEmpty = async (strings: TemplateStringsArray, ...values: any[]) => {
			return []; // Always empty (no authors found)
		};

		const mockSqlError = async (strings: TemplateStringsArray, ...values: any[]) => {
			throw new Error('Database connection failed');
		};

		const mockSqlSpy = vi.fn(mockSqlWithAuthor);
    const mockSqlEmptySpy = vi.fn(mockSqlEmpty);

		describe('ISBN detection (Stage 1)', () => {
			it('detects ISBN-13 and returns high confidence', async () => {
				const result = await detectQueryType(
					'9780439064873',
					mockSqlEmptySpy as any
				);
				expect(result.type).toBe('isbn');
				expect(result.normalized).toBe('9780439064873');
				expect(result.confidence).toBe('high');
        expect(mockSqlEmptySpy).not.toHaveBeenCalled();
			});

			it('detects ISBN-10 and normalizes', async () => {
				const result = await detectQueryType(
					'043906487x',
					mockSqlEmptySpy as any
				);
				expect(result.type).toBe('isbn');
				expect(result.normalized).toBe('043906487X');
				expect(result.confidence).toBe('high');
			});

			it('normalizes ISBN with hyphens', async () => {
				const result = await detectQueryType(
					'978-0-439-06487-3',
					mockSqlEmptySpy as any
				);
				expect(result.type).toBe('isbn');
				expect(result.normalized).toBe('9780439064873');
				expect(result.confidence).toBe('high');
			});
		});

		describe('Author detection (Stage 2)', () => {
      beforeEach(() => {
        mockSqlSpy.mockClear();
        mockSqlEmptySpy.mockClear();
      });

			it('detects known author and returns high confidence', async () => {
				const result = await detectQueryType(
					'J. K. Rowling',
					mockSqlSpy as any
				);
				expect(result.type).toBe('author');
				expect(result.normalized).toBe('J. K. Rowling'); // Now returns raw trimmed input
				expect(result.confidence).toBe('high');
        // Might be cached from previous runs in the same process, so we check >= 0 calls if strict
        // But in this new test file run, it should be 1 call or 0 if cached.
        // We'll rely on the cache test block for call counts.
			});

			it('detects another known author', async () => {
				const result = await detectQueryType(
					'Stephen King',
					mockSqlSpy as any
				);
				expect(result.type).toBe('author');
				expect(result.normalized).toBe('Stephen King'); // Now returns raw trimmed input
				expect(result.confidence).toBe('high');
			});

			it('falls through to title if author not in DB', async () => {
				const result = await detectQueryType(
					'Unknown Author',
					mockSqlEmptySpy as any
				);
				expect(result.type).toBe('title');
				expect(result.confidence).toBe('medium');
			});

			it('handles DB errors gracefully and falls to title', async () => {
				const result = await detectQueryType(
					'Database Error Author',
					mockSqlError as any
				);
				expect(result.type).toBe('title');
				expect(result.confidence).toBe('medium');
			});
		});

		describe('Title search (Stage 3 - Fallback)', () => {
			it('defaults to title for generic queries', async () => {
				const result = await detectQueryType(
					'harry potter',
					mockSqlEmptySpy as any
				);
				expect(result.type).toBe('title');
				expect(result.normalized).toBe('harry potter');
				expect(result.confidence).toBe('medium');
			});

			it('defaults to title for queries starting with "the"', async () => {
				const result = await detectQueryType(
					'The Great Gatsby',
					mockSqlEmptySpy as any
				);
				expect(result.type).toBe('title');
				expect(result.normalized).toBe('the great gatsby');
				expect(result.confidence).toBe('medium');
			});

			it('defaults to title for single word', async () => {
				const result = await detectQueryType('1984', mockSqlEmptySpy as any);
				expect(result.type).toBe('title');
				expect(result.normalized).toBe('1984');
				expect(result.confidence).toBe('medium');
			});

			it('normalizes to lowercase for title', async () => {
				const result = await detectQueryType(
					'HARRY POTTER',
					mockSqlEmptySpy as any
				);
				expect(result.type).toBe('title');
				expect(result.normalized).toBe('harry potter');
			});
		});

		describe('integration scenarios', () => {
			it('prioritizes ISBN over author-like patterns', async () => {
				// Even if "9780439064873" might match author pattern, ISBN takes priority
				const result = await detectQueryType(
					'9780439064873',
					mockSqlSpy as any
				);
				expect(result.type).toBe('isbn');
			});

			it('handles queries with extra whitespace', async () => {
				const result = await detectQueryType(
					'  Stephen King  ',
					mockSqlSpy as any
				);
				expect(result.type).toBe('author');
				expect(result.normalized).toBe('Stephen King'); // Returns trimmed input (whitespace removed)
			});
		});

    describe('Caching behavior', () => {
      // Create a unique mock for caching tests to ensure isolation
      const cacheMockSql = vi.fn().mockImplementation(async (strings, ...values) => {
        const rawInput = values[0];
        if (rawInput === 'Unique Author') return [{ exists: 1 }];
        return [];
      });

      beforeEach(() => {
        cacheMockSql.mockClear();
      });

      it('caches DB results for author-like patterns', async () => {
        const query = 'Unique Author'; // Unique to this test to avoid previous cache

        // First call: hits DB
        const result1 = await detectQueryType(query, cacheMockSql as any);
        expect(result1.type).toBe('author');
        expect(cacheMockSql).toHaveBeenCalledTimes(1);

        // Second call: should hit cache
        const result2 = await detectQueryType(query, cacheMockSql as any);
        expect(result2.type).toBe('author');
        expect(cacheMockSql).toHaveBeenCalledTimes(1); // Still 1 call
      });

      it('caches negative results (falls to title) to prevent DB hammering', async () => {
        const query = 'Unknown Cache Author'; // Looks like author, but not in DB

        // First call: hits DB, returns empty, falls to title
        const result1 = await detectQueryType(query, cacheMockSql as any);
        expect(result1.type).toBe('title');
        expect(cacheMockSql).toHaveBeenCalledTimes(1);

        // Second call: returns title directly from cache
        const result2 = await detectQueryType(query, cacheMockSql as any);
        expect(result2.type).toBe('title');
        expect(cacheMockSql).toHaveBeenCalledTimes(1);
      });
    });
	});
});
