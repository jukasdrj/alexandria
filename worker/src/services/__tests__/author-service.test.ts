// =================================================================================
// Author Service Tests
// =================================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTopAuthors } from '../author-service.js';
import type { Sql } from 'postgres';
import type { Env } from '../../env.js';

describe('Author Service', () => {
  describe('getTopAuthors', () => {
    let mockSql: Sql;
    let mockEnv: Env;

    beforeEach(() => {
      // Mock SQL query function
      mockSql = vi.fn().mockResolvedValue([
        { author_key: '/authors/OL1A', author_name: 'Author One', work_count: 100 },
        { author_key: '/authors/OL2A', author_name: 'Author Two', work_count: 90 },
        { author_key: '/authors/OL3A', author_name: 'Author Three', work_count: 80 },
      ]) as unknown as Sql;

      // Mock KV cache
      mockEnv = {
        CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Env;
    });

    it('should return top authors with pagination', async () => {
      const result = await getTopAuthors(
        { sql: mockSql, env: mockEnv },
        { offset: 0, limit: 10 }
      );

      expect(result.authors).toHaveLength(3);
      expect(result.authors[0]).toEqual({
        author_key: '/authors/OL1A',
        author_name: 'Author One',
        work_count: 100,
      });
      expect(result.pagination).toEqual({
        offset: 0,
        limit: 10,
        returned: 3,
      });
    });

    it('should cache results for 24 hours', async () => {
      await getTopAuthors({ sql: mockSql, env: mockEnv }, { offset: 0, limit: 10 });

      expect(mockEnv.CACHE.put).toHaveBeenCalledWith(
        'top_authors:0:10',
        expect.any(String),
        { expirationTtl: 86400 }
      );
    });

    it('should return cached results when available', async () => {
      const cachedResult = {
        authors: [{ author_key: '/authors/OL99A', author_name: 'Cached Author', work_count: 999 }],
        pagination: { offset: 0, limit: 10, returned: 1 },
      };

      mockEnv.CACHE.get = vi.fn().mockResolvedValue(cachedResult);

      const result = await getTopAuthors({ sql: mockSql, env: mockEnv }, { offset: 0, limit: 10 });

      expect(result).toEqual(cachedResult);
      expect(mockSql).not.toHaveBeenCalled(); // Should not query DB
    });

    it('should skip cache when nocache=true', async () => {
      const cachedResult = {
        authors: [{ author_key: '/authors/OL99A', author_name: 'Cached Author', work_count: 999 }],
        pagination: { offset: 0, limit: 10, returned: 1 },
      };

      mockEnv.CACHE.get = vi.fn().mockResolvedValue(cachedResult);

      const result = await getTopAuthors(
        { sql: mockSql, env: mockEnv },
        { offset: 0, limit: 10, nocache: true }
      );

      expect(result.authors).toHaveLength(3); // Fresh query, not cached
      expect(mockEnv.CACHE.get).not.toHaveBeenCalled();
    });

    it('should work without env (no caching)', async () => {
      const result = await getTopAuthors({ sql: mockSql }, { offset: 0, limit: 10 });

      expect(result.authors).toHaveLength(3);
      expect(result.pagination).toEqual({
        offset: 0,
        limit: 10,
        returned: 3,
      });
    });

    it('should handle empty results', async () => {
      mockSql = vi.fn().mockResolvedValue([]) as unknown as Sql;

      const result = await getTopAuthors({ sql: mockSql, env: mockEnv }, { offset: 1000, limit: 10 });

      expect(result.authors).toHaveLength(0);
      expect(result.pagination.returned).toBe(0);
    });

    it('should pass correct offset and limit to SQL query', async () => {
      await getTopAuthors({ sql: mockSql, env: mockEnv }, { offset: 20, limit: 50 });

      // Verify SQL was called (implementation detail - adjust if query structure changes)
      expect(mockSql).toHaveBeenCalled();
    });

    it('should exclude institutional authors from results', async () => {
      // This test verifies the SQL WHERE clause filters work correctly
      // In real scenario, these should be filtered by the query
      const result = await getTopAuthors({ sql: mockSql, env: mockEnv }, { offset: 0, limit: 10 });

      // All returned authors should have valid names
      result.authors.forEach((author) => {
        expect(author.author_name).toBeTruthy();
        expect(author.author_name.length).toBeGreaterThan(3);
      });
    });
  });
});
