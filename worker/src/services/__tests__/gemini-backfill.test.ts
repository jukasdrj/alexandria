/**
 * Tests for Gemini Backfill Service
 * 
 * Tests ISBN validation and normalization functions
 */

import { describe, it, expect } from 'vitest';
import {
  isValidISBN13,
  isValidISBN10,
  isValidISBN,
  isbn10ToIsbn13,
  normalizeISBN,
} from '../gemini-backfill.js';

describe('ISBN Validation', () => {
  describe('isValidISBN13', () => {
    it('should validate correct ISBN-13', () => {
      // The Martian by Andy Weir
      expect(isValidISBN13('9780553418026')).toBe(true);
      // Harry Potter and the Sorcerer's Stone
      expect(isValidISBN13('9780590353427')).toBe(true);
      // 1984 by George Orwell
      expect(isValidISBN13('9780451524935')).toBe(true);
    });

    it('should reject invalid ISBN-13 checksums', () => {
      // Wrong check digit (last digit should be 6, not 7)
      expect(isValidISBN13('9780553418027')).toBe(false);
      // Random invalid ISBN
      expect(isValidISBN13('9780000000000')).toBe(false);
    });

    it('should reject malformed ISBN-13', () => {
      expect(isValidISBN13('978055341802')).toBe(false);  // Too short
      expect(isValidISBN13('97805534180267')).toBe(false); // Too long
      expect(isValidISBN13('978055341802X')).toBe(false);  // Non-numeric
      // Note: Hyphens are stripped internally, so '978-0553418026' validates as true
    });
  });

  describe('isValidISBN10', () => {
    it('should validate correct ISBN-10', () => {
      // The Catcher in the Rye
      expect(isValidISBN10('0316769487')).toBe(true);
      // To Kill a Mockingbird
      expect(isValidISBN10('0061120081')).toBe(true);
      // With X check digit
      expect(isValidISBN10('155860832X')).toBe(true);
    });

    it('should reject invalid ISBN-10 checksums', () => {
      // Wrong check digit
      expect(isValidISBN10('0316769488')).toBe(false);
    });

    it('should reject malformed ISBN-10', () => {
      expect(isValidISBN10('031676948')).toBe(false);   // Too short
      expect(isValidISBN10('03167694878')).toBe(false); // Too long
    });
  });

  describe('isValidISBN', () => {
    it('should validate both ISBN-10 and ISBN-13', () => {
      expect(isValidISBN('9780553418026')).toBe(true);  // ISBN-13
      expect(isValidISBN('0316769487')).toBe(true);     // ISBN-10
    });

    it('should handle hyphens and spaces', () => {
      expect(isValidISBN('978-0-553-41802-6')).toBe(true);
      expect(isValidISBN('978 0 553 41802 6')).toBe(true);
    });
  });

  describe('isbn10ToIsbn13', () => {
    it('should convert ISBN-10 to ISBN-13', () => {
      // 0316769487 → 9780316769488
      expect(isbn10ToIsbn13('0316769487')).toBe('9780316769488');
    });

    it('should handle ISBN-10 with X check digit', () => {
      // 155860832X → 9781558608320
      expect(isbn10ToIsbn13('155860832X')).toBe('9781558608320');
    });

    it('should return original if not ISBN-10', () => {
      expect(isbn10ToIsbn13('9780553418026')).toBe('9780553418026');
    });
  });

  describe('normalizeISBN', () => {
    it('should normalize ISBN-10 to ISBN-13', () => {
      expect(normalizeISBN('0316769487')).toBe('9780316769488');
    });

    it('should pass through valid ISBN-13', () => {
      expect(normalizeISBN('9780553418026')).toBe('9780553418026');
    });

    it('should strip hyphens', () => {
      expect(normalizeISBN('978-0-553-41802-6')).toBe('9780553418026');
    });

    it('should strip spaces', () => {
      expect(normalizeISBN('978 0 553 41802 6')).toBe('9780553418026');
    });
  });
});

describe('ISBN Hallucination Detection', () => {
  it('should detect common hallucination patterns', () => {
    // Sequential digits (likely hallucinated)
    expect(isValidISBN13('9781234567890')).toBe(false);
    
    // All zeros (definitely hallucinated)
    expect(isValidISBN13('9780000000000')).toBe(false);
    
    // Repeated digits (likely hallucinated)
    expect(isValidISBN13('9781111111111')).toBe(false);
  });
});
