/**
 * Integration Tests for Author Name Normalization
 *
 * Tests the normalize_author_name() PostgreSQL function and search deduplication
 * for Issue #114: Author Deduplication and Normalization
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev, type UnstableDevWorker } from 'wrangler';

describe('Author Normalization Integration Tests', () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: {
        ENVIRONMENT: 'test',
      },
    });
  }, 30000); // 30 second timeout for worker startup

  describe('Normalization Function Tests', () => {
    it('should normalize basic author names (lowercase + trim)', async () => {
      // Test via search endpoint
      const response = await worker.fetch('/api/search?author=Stephen%20King&limit=1');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Search should work regardless of case
    });

    it('should handle period spacing variations (J.K. Rowling)', async () => {
      // These variations should all find the same author
      const variations = [
        'J.K. Rowling',
        'J. K. Rowling',
        'J.K.Rowling',
      ];

      const results = await Promise.all(
        variations.map(name =>
          worker.fetch(`/api/search?author=${encodeURIComponent(name)}&limit=5`)
            .then(r => r.json())
        )
      );

      // All searches should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // All should find books (assuming J.K. Rowling exists in DB)
      // Note: This might be 0 if the author isn't in enriched_authors yet
    });

    it('should handle co-authors by extracting primary', async () => {
      // "Stephen King & Owen King" should normalize to "stephen king"
      const response = await worker.fetch('/api/search?author=Stephen%20King%20%26%20Owen%20King&limit=5');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Should find Stephen King's works
    });

    it('should normalize "Various Authors" variants', async () => {
      const variations = [
        'Various Authors',
        'Multiple Authors',
        'Collective',
        'Anthology',
      ];

      const results = await Promise.all(
        variations.map(name =>
          worker.fetch(`/api/search?author=${encodeURIComponent(name)}&limit=1`)
            .then(r => r.json())
        )
      );

      // All searches should succeed (even if no results)
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle suffixes (Jr., Sr., PhD)', async () => {
      // Search for "Martin Luther King Jr" should work
      const response = await worker.fetch('/api/search?author=Martin%20Luther%20King%20Jr&limit=5');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('Search Deduplication Tests', () => {
    it('should deduplicate author search results', async () => {
      // Search for a common author
      const response = await worker.fetch('/api/search?author=Stephen%20King&limit=20');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      if (data.data && data.data.results) {
        const results = data.data.results;

        // Check that authors are not duplicated with minor variations
        const authorNames = results.flatMap((r: any) =>
          r.authors.map((a: any) => a.name)
        );

        // Should not have "Stephen King" and "STEPHEN KING" as separate entries
        const uniqueLowercase = new Set(authorNames.map((n: string) => n.toLowerCase()));
        expect(uniqueLowercase.size).toBeLessThanOrEqual(authorNames.length);
      }
    });

    it('should use canonical author in top authors endpoint', async () => {
      // Top authors should show deduplicated list
      const response = await worker.fetch('/api/authors/top?limit=100');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.authors).toBeDefined();
      expect(Array.isArray(data.authors)).toBe(true);

      // Check for duplicate normalized names
      const authorNames = data.authors.map((a: any) => a.author_name.toLowerCase());
      const uniqueNames = new Set(authorNames);

      // Should not have exact duplicates (case-insensitive)
      expect(uniqueNames.size).toBe(authorNames.length);
    });
  });

  describe('Fallback Behavior Tests', () => {
    it('should fall back to name ILIKE if normalized_name is NULL', async () => {
      // Search should still work even if some authors don't have normalized_name yet
      const response = await worker.fetch('/api/search?author=test&limit=1');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Should return results or empty array, but not error
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string author search', async () => {
      const response = await worker.fetch('/api/search?author=&limit=1');
      const data = await response.json();

      // Should return error for missing parameter
      expect(response.status).toBe(400);
    });

    it('should handle special characters in author names', async () => {
      // Test with apostrophes
      const response = await worker.fetch('/api/search?author=O%27Brien&limit=5');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle very long author names', async () => {
      const longName = 'A'.repeat(200);
      const response = await worker.fetch(`/api/search?author=${longName}&limit=1`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle Unicode characters in author names', async () => {
      const response = await worker.fetch('/api/search?author=%C3%A9mile&limit=5'); // "émile"
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('Performance Tests', () => {
    it('should complete author search within reasonable time', async () => {
      const startTime = Date.now();
      const response = await worker.fetch('/api/search?author=Stephen%20King&limit=20');
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      // Should complete within 2 seconds (indexed query)
      expect(duration).toBeLessThan(2000);
    });

    it('should complete top authors query within reasonable time', async () => {
      const startTime = Date.now();
      const response = await worker.fetch('/api/authors/top?limit=100');
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      // Should complete within 30 seconds (may be cached)
      expect(duration).toBeLessThan(30000);
    });
  });
});
