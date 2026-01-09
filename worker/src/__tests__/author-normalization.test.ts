/**
 * Unit Tests for Author Name Normalization Logic
 *
 * Tests the author normalization logic for search deduplication
 * for Issue #114: Author Deduplication and Normalization
 *
 * Note: These tests focus on business logic validation, not database integration.
 * Database integration is tested manually against staging/production.
 */

import { describe, it, expect } from 'vitest';

/**
 * Normalize author name for matching (mirrors PostgreSQL normalize_author_name function)
 */
function normalizeAuthorName(name: string): string {
  if (!name) return '';

  const result = name
    .toLowerCase()
    .trim()
    // Extract primary author from co-author strings
    .replace(/\s*(&|and|with)\s+.*/i, '')
    // Normalize "Various Authors" variants
    .replace(/^(various|multiple|collective|anthology)\s*(authors?)?$/i, 'various authors')
    // Remove common suffixes
    .replace(/\s*(jr\.?|sr\.?|phd|md|esq\.?)$/i, '')
    // Normalize period spacing (J.K. → jk)
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Handle edge case where only delimiter remains
  if (result === '&' || result === 'and' || result === 'with') {
    return '';
  }

  return result;
}

describe('Author Normalization Logic', () => {
  describe('normalizeAuthorName function', () => {
    it('should normalize basic author names (lowercase + trim)', () => {
      expect(normalizeAuthorName('Stephen King')).toBe('stephen king');
      expect(normalizeAuthorName('  STEPHEN KING  ')).toBe('stephen king');
      expect(normalizeAuthorName('stephen king')).toBe('stephen king');
    });

    it('should handle period spacing variations (J.K. Rowling)', () => {
      expect(normalizeAuthorName('J.K. Rowling')).toBe('jk rowling');
      expect(normalizeAuthorName('J. K. Rowling')).toBe('j k rowling');
      expect(normalizeAuthorName('J.K.Rowling')).toBe('jkrowling');

      // All should normalize similarly (periods removed)
      const normalized1 = normalizeAuthorName('J.K. Rowling');
      const normalized2 = normalizeAuthorName('JK Rowling');
      expect(normalized1.replace(/\s/g, '')).toBe(normalized2.replace(/\s/g, ''));
    });

    it('should handle co-authors by extracting primary', () => {
      expect(normalizeAuthorName('Stephen King & Owen King')).toBe('stephen king');
      expect(normalizeAuthorName('Stephen King and Owen King')).toBe('stephen king');
      expect(normalizeAuthorName('Stephen King with Owen King')).toBe('stephen king');
    });

    it('should normalize "Various Authors" variants', () => {
      expect(normalizeAuthorName('Various Authors')).toBe('various authors');
      expect(normalizeAuthorName('Multiple Authors')).toBe('various authors');
      expect(normalizeAuthorName('Collective')).toBe('various authors');
      expect(normalizeAuthorName('Anthology')).toBe('various authors');
    });

    it('should handle suffixes (Jr., Sr., PhD)', () => {
      expect(normalizeAuthorName('Martin Luther King Jr')).toBe('martin luther king');
      expect(normalizeAuthorName('Martin Luther King Jr.')).toBe('martin luther king');
      expect(normalizeAuthorName('John Smith Sr')).toBe('john smith');
      expect(normalizeAuthorName('Jane Doe PhD')).toBe('jane doe');
    });

    it('should handle empty strings', () => {
      expect(normalizeAuthorName('')).toBe('');
      expect(normalizeAuthorName('   ')).toBe('');
    });

    it('should handle special characters', () => {
      expect(normalizeAuthorName("O'Brien")).toBe("o'brien");
      expect(normalizeAuthorName("François")).toBe("françois");
    });

    it('should handle very long names', () => {
      const longName = 'A'.repeat(200);
      const normalized = normalizeAuthorName(longName);
      expect(normalized).toBe(longName.toLowerCase());
    });

    it('should handle Unicode characters', () => {
      expect(normalizeAuthorName('Émile Zola')).toBe('émile zola');
      expect(normalizeAuthorName('José Saramago')).toBe('josé saramago');
    });
  });

  describe('Deduplication Logic', () => {
    it('should identify duplicate author names', () => {
      const authors = [
        'Stephen King',
        'STEPHEN KING',
        'stephen king',
        '  Stephen King  ',
      ];

      const normalized = authors.map(normalizeAuthorName);
      const unique = new Set(normalized);

      expect(unique.size).toBe(1);
      expect(unique.has('stephen king')).toBe(true);
    });

    it('should identify unique authors despite variations', () => {
      const authors = [
        'J.K. Rowling',
        'J. K. Rowling',
        'JK Rowling',
      ];

      const normalized = authors.map(normalizeAuthorName);
      // When periods are removed and spaces normalized, these should be similar
      const withoutSpaces = normalized.map(n => n.replace(/\s/g, ''));
      const unique = new Set(withoutSpaces);

      expect(unique.size).toBe(1);
    });

    it('should handle co-author variations', () => {
      const authors = [
        'Stephen King & Owen King',
        'Stephen King and Owen King',
        'Stephen King with Owen King',
        'Stephen King',
      ];

      const normalized = authors.map(normalizeAuthorName);
      const unique = new Set(normalized);

      expect(unique.size).toBe(1);
      expect(unique.has('stephen king')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed input', () => {
      expect(normalizeAuthorName('   &   ')).toBe('');
      expect(normalizeAuthorName('& Someone')).toBe('');
      expect(normalizeAuthorName('....')).toBe('');
    });

    it('should preserve important characters', () => {
      // Apostrophes should be kept
      expect(normalizeAuthorName("O'Brien")).toContain("'");
      // Hyphens should be kept
      expect(normalizeAuthorName("Mary-Jane")).toContain("-");
    });

    it('should handle mixed case suffixes', () => {
      expect(normalizeAuthorName('Smith JR.')).toBe('smith');
      expect(normalizeAuthorName('Smith jr')).toBe('smith');
      expect(normalizeAuthorName('Smith JR')).toBe('smith');
    });
  });
});
