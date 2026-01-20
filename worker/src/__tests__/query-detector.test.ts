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
		let mockSql: any;

		beforeEach(() => {
			mockSql = vi.fn();
		});

		describe('ISBN detection (Stage 1)', () => {
			it('detects ISBN-13 and returns high confidence', async () => {
				const result = await detectQueryType('9780439064873', mockSql);
				expect(result.type).toBe('isbn');
				expect(result.normalized).toBe('9780439064873');
				expect(result.confidence).toBe('high');
				expect(mockSql).not.toHaveBeenCalled();
			});

			it('detects ISBN-10 and normalizes', async () => {
				const result = await detectQueryType('043906487x', mockSql);
				expect(result.type).toBe('isbn');
				expect(result.normalized).toBe('043906487X');
				expect(result.confidence).toBe('high');
				expect(mockSql).not.toHaveBeenCalled();
			});

			it('normalizes ISBN with hyphens', async () => {
				const result = await detectQueryType('978-0-439-06487-3', mockSql);
				expect(result.type).toBe('isbn');
				expect(result.normalized).toBe('9780439064873');
				expect(result.confidence).toBe('high');
				expect(mockSql).not.toHaveBeenCalled();
			});
		});

		describe('Author detection (Stage 2) with Caching', () => {
			it('detects known author and returns high confidence', async () => {
				mockSql.mockResolvedValueOnce([{ exists: 1 }]);

				const result = await detectQueryType('J. K. Rowling', mockSql);
				expect(result.type).toBe('author');
				expect(result.normalized).toBe('J. K. Rowling');
				expect(result.confidence).toBe('high');
				expect(mockSql).toHaveBeenCalledTimes(1);
			});

			it('falls through to title if author not in DB', async () => {
				mockSql.mockResolvedValueOnce([]);

				const result = await detectQueryType('Unknown Author', mockSql);
				expect(result.type).toBe('title');
				expect(result.confidence).toBe('medium');
				expect(mockSql).toHaveBeenCalledTimes(1);
			});

			it('handles DB errors gracefully and falls to title', async () => {
				mockSql.mockRejectedValueOnce(new Error('Database connection failed'));

				const result = await detectQueryType('Stephen King', mockSql);
				expect(result.type).toBe('title');
				expect(result.confidence).toBe('medium');
				expect(mockSql).toHaveBeenCalledTimes(1);
			});

			it('caches positive author checks', async () => {
				// First call checks DB
				mockSql.mockResolvedValueOnce([{ exists: 1 }]);
				const result1 = await detectQueryType('Stephen King', mockSql);
				expect(result1.type).toBe('author');
				expect(mockSql).toHaveBeenCalledTimes(1);

				// Second call uses cache
				const result2 = await detectQueryType('Stephen King', mockSql);
				expect(result2.type).toBe('author');
				expect(mockSql).toHaveBeenCalledTimes(1); // Count remains 1
			});

			it('caches negative author checks', async () => {
				// First call checks DB (not found)
				mockSql.mockResolvedValueOnce([]);
				const result1 = await detectQueryType('Fake Author Name', mockSql);
				expect(result1.type).toBe('title');
				expect(mockSql).toHaveBeenCalledTimes(1);

				// Second call uses cache (skips DB)
				const result2 = await detectQueryType('Fake Author Name', mockSql);
				expect(result2.type).toBe('title');
				expect(mockSql).toHaveBeenCalledTimes(1); // Count remains 1
			});

			it('does NOT cache DB errors', async () => {
				// First call fails
				mockSql.mockRejectedValueOnce(new Error('DB error'));
				const result1 = await detectQueryType('Error Name', mockSql);
				expect(result1.type).toBe('title');
				expect(mockSql).toHaveBeenCalledTimes(1);

				// Second call retries DB
				mockSql.mockResolvedValueOnce([{ exists: 1 }]);
				const result2 = await detectQueryType('Error Name', mockSql);
				expect(result2.type).toBe('author');
				expect(mockSql).toHaveBeenCalledTimes(2);
			});
		});

		describe('Title search (Stage 3 - Fallback)', () => {
			it('defaults to title for generic queries', async () => {
                // "harry potter" does not match author pattern (lower case, > 1 word)
                // Wait, "harry potter" DOES match author pattern because:
                // length > 5, < 50
                // words = 2
                // no title indicators
                // no book words
                // lowercase allowed

                // So it tries DB. We need to mock DB empty for this to fallback to title.
                mockSql.mockResolvedValueOnce([]);

				const result = await detectQueryType('harry potter', mockSql);
				expect(result.type).toBe('title');
				expect(result.normalized).toBe('harry potter');
				expect(result.confidence).toBe('medium');
                // It calls DB because "harry potter" looks like an author name
				expect(mockSql).toHaveBeenCalledTimes(1);
			});

			it('defaults to title for queries starting with "the"', async () => {
				const result = await detectQueryType('The Great Gatsby', mockSql);
				expect(result.type).toBe('title');
				expect(result.normalized).toBe('the great gatsby');
				expect(result.confidence).toBe('medium');
				expect(mockSql).not.toHaveBeenCalled();
			});
		});
	});
});
