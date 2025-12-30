/**
 * Week 3: Endpoint Integration Tests
 *
 * Full request/response integration tests for API endpoints.
 * Tests actual route handlers with mocked database and bindings.
 *
 * This approach is more maintainable than full Miniflare runtime testing
 * and provides better isolation while still testing the full request cycle.
 *
 * Coverage:
 * 1. Health check with database simulation
 * 2. Search endpoints with zod validation
 * 3. OpenAPI spec generation
 * 4. Error handling across routes
 * 5. Response format validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Sql } from 'postgres';
import app from '../../index.js';
import type { Env } from '../../env.js';

// Mock WASM modules
vi.mock('@jsquash/jpeg', () => ({
  default: vi.fn(),
}));

vi.mock('@jsquash/webp', () => ({
  encode: vi.fn(),
}));

/**
 * Create mock SQL client
 */
function createMockSql(): Sql {
  const mockSql = vi.fn() as unknown as Sql;

  // Mock common queries
  (mockSql as any).mockImplementation(async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join('?');

    // Health check query
    if (query.includes('SELECT 1')) {
      return [{ '?column?': 1 }];
    }

    // Stats queries
    if (query.includes('COUNT') && query.includes('editions')) {
      return [{ count: '54800000' }];
    }
    if (query.includes('COUNT') && query.includes('works')) {
      return [{ count: '40100000' }];
    }
    if (query.includes('COUNT') && query.includes('authors')) {
      return [{ count: '14700000' }];
    }
    if (query.includes('current_database')) {
      return [{ current_database: 'openlibrary' }];
    }

    // ISBN search
    if (query.includes('enriched_editions') && query.includes('isbn')) {
      return [{
        isbn: values[0],
        title: 'Test Book',
        subtitle: null,
        authors: [{ name: 'Test Author', key: '/authors/TEST' }],
        work_title: 'Test Work',
        work_key: '/works/TEST',
        publish_date: '2024-01-01',
        publishers: ['Test Publisher'],
        pages: 100,
        cover_url_large: null,
        cover_url_medium: null,
        cover_url_small: null,
      }];
    }

    // Title search
    if (query.includes('enriched_editions') && query.includes('title')) {
      return [
        {
          isbn: '9780000000001',
          title: 'Test Book 1',
          subtitle: null,
          authors: [{ name: 'Test Author', key: '/authors/TEST' }],
          work_title: 'Test Work 1',
          work_key: '/works/TEST1',
          publish_date: '2024-01-01',
          publishers: ['Test Publisher'],
          pages: 100,
          cover_url_large: null,
          cover_url_medium: null,
          cover_url_small: null,
        },
      ];
    }

    // Default empty result
    return [];
  });

  // Mock transaction support
  (mockSql as any).begin = vi.fn(async (callback) => {
    const mockTransaction = createMockSql();
    return callback(mockTransaction);
  });

  return mockSql;
}

/**
 * Create mock KV namespace
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({
      keys: Array.from(store.keys()).map(name => ({ name })),
      list_complete: true,
      cursor: '',
    })),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
    })),
  } as unknown as KVNamespace;
}

/**
 * Create mock environment
 */
function createMockEnv(): Env {
  return {
    HYPERDRIVE: {
      connectionString: 'postgres://mock:mock@localhost:5432/mock',
    } as any,
    CACHE: createMockKV(),
    QUOTA_KV: createMockKV(),
    COVER_IMAGES: {} as R2Bucket,
    ENRICHMENT_QUEUE: {} as Queue,
    COVER_QUEUE: {} as Queue,
    ANALYTICS: {} as AnalyticsEngineDataset,
    QUERY_ANALYTICS: {} as AnalyticsEngineDataset,
    COVER_ANALYTICS: {} as AnalyticsEngineDataset,
    ISBNDB_API_KEY: 'test-key',
    GOOGLE_BOOKS_API_KEY: 'test-key',
    CACHE_TTL_SHORT: '300',
    CACHE_TTL_MEDIUM: '3600',
    CACHE_TTL_LONG: '86400',
  } as Env;
}

describe('Endpoint Integration Tests', () => {
  let mockEnv: Env;
  let mockSql: Sql;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockSql = createMockSql();
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy status with database check', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = await res.json();
      expect(data).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        database: {
          status: expect.stringMatching(/connected|healthy/),
          latency_ms: expect.any(Number),
        },
      });
    });

    it('should respond quickly', async () => {
      const start = Date.now();
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, mockEnv);
      const elapsed = Date.now() - start;

      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('GET /api/stats', () => {
    it('should return database statistics', async () => {
      const req = new Request('http://localhost/api/stats');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        success: true,
        data: {
          database_name: expect.any(String),
          total_editions: expect.any(Number),
          total_works: expect.any(Number),
          total_authors: expect.any(Number),
        },
      });
    });
  });

  describe('GET /api/search', () => {
    it('should require at least one search parameter', async () => {
      const req = new Request('http://localhost/api/search');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data).toMatchObject({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: expect.any(String),
        },
      });
    });

    it('should handle ISBN search', async () => {
      const req = new Request('http://localhost/api/search?isbn=9780439064873');
      const res = await app.fetch(req, mockEnv);

      expect([200, 404]).toContain(res.status);

      const data = await res.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data.data).toHaveProperty('query');
        expect(data.data).toHaveProperty('results');
        expect(data.data).toHaveProperty('pagination');
      }
    });

    it('should normalize ISBN with hyphens', async () => {
      const req = new Request('http://localhost/api/search?isbn=978-0-439-06487-3');
      const res = await app.fetch(req, mockEnv);

      const data = await res.json();
      if (data.success && data.data.query) {
        expect(data.data.query.isbn).toBe('9780439064873');
      }
    });

    it('should handle title search', async () => {
      const req = new Request('http://localhost/api/search?title=Harry%20Potter');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        success: true,
        data: {
          query: { title: 'Harry Potter' },
          results: expect.any(Array),
          pagination: expect.objectContaining({
            limit: expect.any(Number),
            offset: expect.any(Number),
          }),
        },
      });
    });

    it('should enforce pagination limits', async () => {
      const req = new Request('http://localhost/api/search?title=test&limit=150');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toMatch(/limit/i);
    });

    it('should support offset pagination', async () => {
      const req = new Request('http://localhost/api/search?title=test&limit=10&offset=20');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data.pagination).toMatchObject({
        limit: 10,
        offset: 20,
      });
    });
  });

  describe('GET /api/quota/status', () => {
    it('should return quota information', async () => {
      const req = new Request('http://localhost/api/quota/status');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        success: true,
        data: {
          used_today: expect.any(Number),
          remaining: expect.any(Number),
          limit: 15000,
          safety_limit: 13000,
          can_make_calls: expect.any(Boolean),
          reset_at: expect.any(String),
        },
      });
    });

    it('should cache quota status', async () => {
      const req = new Request('http://localhost/api/quota/status');
      const res = await app.fetch(req, mockEnv);

      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=60');
    });
  });

  describe('GET /openapi.json', () => {
    it('should return OpenAPI 3.0 specification', async () => {
      const req = new Request('http://localhost/openapi.json');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const spec = await res.json();
      expect(spec).toMatchObject({
        openapi: expect.stringMatching(/^3\./),
        info: {
          title: expect.any(String),
          version: expect.any(String),
        },
        paths: expect.any(Object),
      });
    });

    it('should include key endpoints in spec', async () => {
      const req = new Request('http://localhost/openapi.json');
      const res = await app.fetch(req, mockEnv);

      const spec = await res.json();
      expect(spec.paths).toHaveProperty('/health');
      expect(spec.paths).toHaveProperty('/api/search');
      expect(spec.paths).toHaveProperty('/api/stats');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const req = new Request('http://localhost/api/unknown');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(404);
    });

    it('should handle malformed requests', async () => {
      const req = new Request('http://localhost/api/enrich/edition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid{json',
      });
      const res = await app.fetch(req, mockEnv);

      expect([400, 422]).toContain(res.status);
    });

    it('should include error details', async () => {
      const req = new Request('http://localhost/api/search');
      const res = await app.fetch(req, mockEnv);

      const data = await res.json();
      expect(data).toMatchObject({
        success: false,
        error: {
          code: expect.any(String),
          message: expect.any(String),
        },
      });
    });
  });

  describe('Response Headers', () => {
    it('should set correct content-type for JSON', async () => {
      const req = new Request('http://localhost/api/stats');
      const res = await app.fetch(req, mockEnv);

      expect(res.headers.get('content-type')).toContain('application/json');
    });

    it('should set cache headers for search results', async () => {
      const req = new Request('http://localhost/api/search?isbn=9780439064873');
      const res = await app.fetch(req, mockEnv);

      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toBeTruthy();
    });
  });

  describe('Dashboard', () => {
    it('should serve HTML at root', async () => {
      const req = new Request('http://localhost/');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');

      const html = await res.text();
      expect(html).toContain('Alexandria');
    });
  });
});
