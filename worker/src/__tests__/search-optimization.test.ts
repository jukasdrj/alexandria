import { describe, it, expect, vi } from 'vitest';
import { searchByTitle } from '../routes/search-combined.js';

// Mock dependencies to avoid import issues
vi.mock('../lib/query-detector.js', () => ({
  detectQueryType: vi.fn(),
}));

vi.mock('../lib/cache-helpers.js', () => ({
  buildCombinedCacheKey: vi.fn(),
  getCacheTTL: vi.fn(),
}));

describe('searchByTitle', () => {
  it('should use transaction and pipeline commands', async () => {
    const mockResult = [{ isbn: '123', title: 'Test Book' }];

    // Track calls to sql`...`
    const sqlCalls: string[] = [];

    // Implementation of the mock sql function
    const mockSqlFn: any = (strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.raw ? String.raw(strings, ...values) : strings[0];
      sqlCalls.push(query);

      if (query.includes('SELECT')) {
        const res = [...mockResult];
        return Promise.resolve(res);
      }
      return Promise.resolve([]);
    };

    // Add .begin method to the mock
    mockSqlFn.begin = vi.fn(async (callback: any) => {
        // Pass the same mockSqlFn to the callback
        return await callback(mockSqlFn);
    });

    const result = await searchByTitle(mockSqlFn, 'test', 10, 0);

    // Verify .begin was called
    expect(mockSqlFn.begin).toHaveBeenCalledTimes(1);

    // Verify sql was called 3 times inside begin
    expect(sqlCalls.length).toBe(3);

    // Verify order of calls
    expect(sqlCalls[0]).toContain('SET LOCAL work_mem');
    expect(sqlCalls[1]).toContain('SET LOCAL pg_trgm.similarity_threshold');
    expect(sqlCalls[2]).toContain('SELECT');

    // Verify result
    expect(result.data).toEqual(mockResult);
    expect(result.total).toBe(1); // offset 0 + data.length (1) = 1
  });
});
