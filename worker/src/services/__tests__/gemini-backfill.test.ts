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
  PROMPT_VARIANTS,
  type PromptVariantName,
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

describe('Prompt Variant Registry', () => {
  it('should have all documented variants registered', () => {
    const expectedVariants: PromptVariantName[] = [
      'baseline',
      'diversity-emphasis',
      'overlooked-significance',
      'genre-rotation',
      'era-contextualized',
      'isbn-format-aware',
    ];

    for (const variant of expectedVariants) {
      expect(variant in PROMPT_VARIANTS).toBe(true);
      expect(typeof PROMPT_VARIANTS[variant]).toBe('function');
    }
  });

  it('should generate valid prompts for all variants', () => {
    const year = 2024;
    const month = 6;
    const batchSize = 20;

    for (const [name, builder] of Object.entries(PROMPT_VARIANTS)) {
      const prompt = builder(year, month, batchSize);

      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100); // Prompts should be substantial
      expect(prompt).toContain('June'); // Month name should be included
      expect(prompt).toContain('2024'); // Year should be included
      expect(prompt).toContain(`${batchSize}`); // Batch size should be included
    }
  });

  it('should generate different prompts for different variants', () => {
    const year = 2024;
    const month = 6;
    const batchSize = 20;

    const baselinePrompt = PROMPT_VARIANTS.baseline(year, month, batchSize);
    const diversityPrompt = PROMPT_VARIANTS['diversity-emphasis'](year, month, batchSize);
    const overlookedPrompt = PROMPT_VARIANTS['overlooked-significance'](year, month, batchSize);

    // Baseline should differ from diversity
    expect(baselinePrompt).not.toBe(diversityPrompt);

    // Diversity should contain specific keywords
    expect(diversityPrompt).toContain('Non-English');
    expect(diversityPrompt).toContain('independent publishers');

    // Overlooked should contain specific keywords
    expect(overlookedPrompt).toContain('NOT commercial bestsellers');
    expect(overlookedPrompt).toContain('cult classics');
  });

  it('should adapt era-contextualized prompt based on year', () => {
    const month = 6;
    const batchSize = 20;

    const prompt1960s = PROMPT_VARIANTS['era-contextualized'](1965, month, batchSize);
    const prompt2020s = PROMPT_VARIANTS['era-contextualized'](2022, month, batchSize);

    // Different eras should have different context
    expect(prompt1960s).toContain('counterculture');
    expect(prompt2020s).toContain('pandemic');
    expect(prompt1960s).not.toBe(prompt2020s);
  });
});
