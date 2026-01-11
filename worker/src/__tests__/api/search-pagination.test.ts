import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Sql } from 'postgres';
import searchApp from '../../routes/search.js';
import type { AppBindings } from '../../env.js';
import { OpenAPIHono } from '@hono/zod-openapi';

// Helper to create mock context for testing
function createMockContext(path: string) {
  const mockSql = vi.fn() as unknown as Sql;
  const mockEnv = {
    CACHE: {} as KVNamespace,
    HYPERDRIVE: {
      connectionString: 'postgres://mock',
    },
    ENABLE_CACHE: 'false',
  } as AppBindings['Bindings'];

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    query: vi.fn(),
  };

  return {
    mockSql,
    mockEnv,
    mockLogger,
  };
}

describe('Search Pagination Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Hono does not automatically make the passed Env available via c.get('logger') if it's not middleware.
  // We need to inject the logger into the app context or mock the retrieval.
  // The route handler retrieves:
  // const logger = c.get('logger');
  // const sql = c.get('sql');

  // Since we are using app.request, we need to ensure these variables are available in the context.
  // We can wrap the app with a middleware that injects them for testing.

  const createTestApp = (mockSql: any, mockLogger: any) => {
    const testApp = new OpenAPIHono();

    testApp.use('*', async (c, next) => {
      c.set('logger', mockLogger);
      c.set('sql', mockSql);
      c.set('startTime', Date.now());
      await next();
    });

    testApp.route('/', searchApp);
    return testApp;
  };

  it('should use limit+1 strategy for title search to avoid COUNT(*)', async () => {
    const { mockSql, mockEnv, mockLogger } = createMockContext('/api/search');
    const testApp = createTestApp(mockSql, mockLogger);

    const mockSqlFn = mockSql as unknown as ReturnType<typeof vi.fn>;

    const limit = 10;
    const extraItemCount = limit + 1;
    const mockRows = Array.from({ length: extraItemCount }, (_, i) => ({
      title: `Book ${i}`,
      isbn: `123456789${i}`,
      authors: [],
    }));

    mockSqlFn.mockResolvedValue(mockRows);

    const res = await testApp.request(
      `http://localhost/api/search?title=test&limit=${limit}&offset=0`,
      {},
      mockEnv
    );

    if (res.status !== 200) {
      console.error(await res.text());
    }
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.results.length).toBe(limit);
    expect(body.data.pagination.hasMore).toBe(true);
    expect(body.data.pagination.total).toBe(limit + 1);
    expect(body.data.pagination.totalEstimated).toBe(true);
  });

  it('should handle title search with no more results correctly', async () => {
    const { mockSql, mockEnv, mockLogger } = createMockContext('/api/search');
    const testApp = createTestApp(mockSql, mockLogger);
    const mockSqlFn = mockSql as unknown as ReturnType<typeof vi.fn>;

    const limit = 10;
    const mockRows = Array.from({ length: limit }, (_, i) => ({
      title: `Book ${i}`,
      isbn: `123456789${i}`,
      authors: [],
    }));

    mockSqlFn.mockResolvedValue(mockRows);

    const res = await testApp.request(
      `http://localhost/api/search?title=test&limit=${limit}&offset=0`,
      {},
      mockEnv
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.results.length).toBe(limit);
    expect(body.data.pagination.hasMore).toBe(false);
    expect(body.data.pagination.total).toBe(limit);
    expect(body.data.pagination.totalEstimated).toBe(true);
  });

  it('should handle title search with less than limit results correctly', async () => {
    const { mockSql, mockEnv, mockLogger } = createMockContext('/api/search');
    const testApp = createTestApp(mockSql, mockLogger);
    const mockSqlFn = mockSql as unknown as ReturnType<typeof vi.fn>;

    const limit = 10;
    const count = 5;
    const mockRows = Array.from({ length: count }, (_, i) => ({
      title: `Book ${i}`,
      isbn: `123456789${i}`,
      authors: [],
    }));

    mockSqlFn.mockResolvedValue(mockRows);

    const res = await testApp.request(
      `http://localhost/api/search?title=test&limit=${limit}&offset=0`,
      {},
      mockEnv
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.results.length).toBe(count);
    expect(body.data.pagination.hasMore).toBe(false);
    expect(body.data.pagination.total).toBe(count);
    expect(body.data.pagination.totalEstimated).toBe(true);
  });
});
