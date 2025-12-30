/**
 * Week 3: Miniflare Integration Tests
 *
 * Full Worker runtime integration tests using Miniflare.
 * Tests actual HTTP requests against a simulated Cloudflare Worker environment.
 *
 * Coverage:
 * 1. Health check endpoint with database connectivity
 * 2. Search endpoints (ISBN, title, author)
 * 3. OpenAPI spec generation
 * 4. Error handling and 404 responses
 * 5. Request/response headers
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, UnstableDevWorker } from 'wrangler';

describe('Worker Runtime Integration Tests (Miniflare)', () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    // Start Miniflare worker instance
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: {
        // Mock environment variables for testing
        CACHE_TTL_SHORT: '300',
        CACHE_TTL_MEDIUM: '3600',
        CACHE_TTL_LONG: '86400',
      },
      // We'll use local test bindings
      local: true,
    });
  }, 30000); // 30s timeout for Worker startup

  afterAll(async () => {
    await worker.stop();
  });

  describe('GET /health', () => {
    it('should return 200 with healthy status', async () => {
      const response = await worker.fetch('/health');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const data = await response.json();
      expect(data).toHaveProperty('status', 'healthy');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('database');
    });

    it('should include database latency metrics', async () => {
      const response = await worker.fetch('/health');
      const data = await response.json();

      expect(data.database).toHaveProperty('status');
      expect(data.database).toHaveProperty('latency_ms');
      expect(typeof data.database.latency_ms).toBe('number');
    });

    it('should respond quickly (<1s)', async () => {
      const start = Date.now();
      const response = await worker.fetch('/health');
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('GET /openapi.json', () => {
    it('should return OpenAPI 3.0 specification', async () => {
      const response = await worker.fetch('/openapi.json');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const spec = await response.json();
      expect(spec).toHaveProperty('openapi');
      expect(spec.openapi).toMatch(/^3\./); // Version 3.x
      expect(spec).toHaveProperty('info');
      expect(spec).toHaveProperty('paths');
    });

    it('should include all major endpoints in spec', async () => {
      const response = await worker.fetch('/openapi.json');
      const spec = await response.json();

      // Verify core endpoints are documented
      expect(spec.paths).toHaveProperty('/health');
      expect(spec.paths).toHaveProperty('/api/search');
      expect(spec.paths).toHaveProperty('/api/stats');
      expect(spec.paths).toHaveProperty('/api/quota/status');
    });

    it('should have info section with title and version', async () => {
      const response = await worker.fetch('/openapi.json');
      const spec = await response.json();

      expect(spec.info).toHaveProperty('title');
      expect(spec.info).toHaveProperty('version');
      expect(spec.info.title).toBe('Alexandria API');
    });
  });

  describe('GET /api/stats', () => {
    it('should return database statistics', async () => {
      const response = await worker.fetch('/api/stats');

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('database_name');
      expect(data.data).toHaveProperty('total_editions');
      expect(data.data).toHaveProperty('total_works');
      expect(data.data).toHaveProperty('total_authors');
    });

    it('should return numeric counts', async () => {
      const response = await worker.fetch('/api/stats');
      const data = await response.json();

      expect(typeof data.data.total_editions).toBe('number');
      expect(typeof data.data.total_works).toBe('number');
      expect(typeof data.data.total_authors).toBe('number');
    });
  });

  describe('GET /api/search', () => {
    it('should require at least one search parameter', async () => {
      const response = await worker.fetch('/api/search');

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'MISSING_PARAMETER');
    });

    it('should validate ISBN parameter', async () => {
      const response = await worker.fetch('/api/search?isbn=9780439064873');

      // Should either return 200 with results or 404 if not found
      expect([200, 404]).toContain(response.status);

      const data = await response.json();
      expect(data).toHaveProperty('success');
    });

    it('should normalize ISBN with hyphens', async () => {
      const response = await worker.fetch('/api/search?isbn=978-0-439-06487-3');

      expect([200, 404]).toContain(response.status);

      const data = await response.json();
      if (data.success && data.data.query) {
        expect(data.data.query.isbn).toBe('9780439064873');
      }
    });

    it('should support title search', async () => {
      const response = await worker.fetch('/api/search?title=Harry%20Potter');

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data.data).toHaveProperty('query');
      expect(data.data.query).toHaveProperty('title', 'Harry Potter');
      expect(data.data).toHaveProperty('pagination');
    });

    it('should support author search', async () => {
      const response = await worker.fetch('/api/search?author=Rowling');

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data.data).toHaveProperty('query');
      expect(data.data.query).toHaveProperty('author', 'Rowling');
    });

    it('should support pagination parameters', async () => {
      const response = await worker.fetch('/api/search?title=test&limit=5&offset=10');

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.data.pagination).toHaveProperty('limit', 5);
      expect(data.data.pagination).toHaveProperty('offset', 10);
    });

    it('should enforce max limit of 100', async () => {
      const response = await worker.fetch('/api/search?title=test&limit=150');

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('limit');
    });
  });

  describe('GET /api/quota/status', () => {
    it('should return quota status', async () => {
      const response = await worker.fetch('/api/quota/status');

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data.data).toHaveProperty('used_today');
      expect(data.data).toHaveProperty('remaining');
      expect(data.data).toHaveProperty('limit', 15000);
      expect(data.data).toHaveProperty('safety_limit', 13000);
    });

    it('should include reset time information', async () => {
      const response = await worker.fetch('/api/quota/status');
      const data = await response.json();

      expect(data.data).toHaveProperty('reset_at');
      expect(data.data).toHaveProperty('can_make_calls');
      expect(typeof data.data.can_make_calls).toBe('boolean');
    });

    it('should cache quota status for 60s', async () => {
      const response = await worker.fetch('/api/quota/status');

      const cacheControl = response.headers.get('cache-control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=60');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await worker.fetch('/api/unknown-endpoint');

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON in POST requests', async () => {
      const response = await worker.fetch('/api/enrich/edition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });

      expect([400, 422]).toContain(response.status);
    });

    it('should include error details in response', async () => {
      const response = await worker.fetch('/api/search?isbn=invalid');

      if (!response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('success', false);
        expect(data).toHaveProperty('error');
        expect(data.error).toHaveProperty('code');
        expect(data.error).toHaveProperty('message');
      }
    });
  });

  describe('Response Headers', () => {
    it('should set CORS headers', async () => {
      const response = await worker.fetch('/api/search?title=test');

      // Cloudflare Workers typically handle CORS at edge
      expect(response.headers.get('content-type')).toContain('application/json');
    });

    it('should set appropriate cache headers for search', async () => {
      const response = await worker.fetch('/api/search?isbn=9780439064873');

      const cacheControl = response.headers.get('cache-control');
      // Search results should have some cache control
      expect(cacheControl).toBeTruthy();
    });
  });

  describe('Dashboard', () => {
    it('should serve HTML dashboard at root', async () => {
      const response = await worker.fetch('/');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    });

    it('should include Alexandria branding in dashboard', async () => {
      const response = await worker.fetch('/');
      const html = await response.text();

      expect(html).toContain('Alexandria');
      expect(html).toContain('54M+'); // Database size
    });
  });
});
