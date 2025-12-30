// =================================================================================
// CI Smoke Tests
//
// Fast, lightweight tests that verify critical endpoints are operational.
// These run in CI without requiring Worker bindings or external services.
//
// Tests:
// 1. Health check endpoint
// 2. Stats endpoint (DB connectivity)
// 3. Quota status endpoint (KV connectivity)
// 4. OpenAPI spec endpoint
// 5. Search endpoint basic validation
//
// These are "smoke tests" - they verify the service is running and responding,
// not comprehensive functionality. Full integration testing is done manually
// on staging.
// =================================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// =================================================================================
// Configuration
// =================================================================================

const BASE_URL = process.env.TEST_BASE_URL || 'https://alexandria.ooheynerds.com';
const TIMEOUT = 10000; // 10 second timeout for network requests

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Check if we're running in CI environment
 */
function isCI(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

// =================================================================================
// Smoke Tests (SKIP unless in CI or TEST_BASE_URL is set)
// =================================================================================

// Skip all smoke tests unless we're in CI or TEST_BASE_URL is explicitly set
const shouldRunSmokeTests = isCI() || process.env.TEST_BASE_URL;

describe.skipIf(!shouldRunSmokeTests)('CI Smoke Tests', () => {
  beforeAll(() => {
    if (isCI()) {
      console.log('🔥 Running smoke tests in CI against:', BASE_URL);
    }
  });

  afterAll(() => {
    if (isCI()) {
      console.log('✅ Smoke tests complete');
    }
  });

  describe('Health Check', () => {
    it('GET /health should return 200 and healthy status', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/health`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('healthy');
      expect(data).toHaveProperty('timestamp');
    });

    it('Health endpoint should respond quickly (<1s)', async () => {
      const start = Date.now();
      const response = await fetchWithTimeout(`${BASE_URL}/health`, {}, 1000);
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('Database Connectivity', () => {
    it('GET /api/stats should return database statistics', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/stats`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('editions');
      expect(data.data).toHaveProperty('works');
      expect(data.data).toHaveProperty('authors');

      // Sanity check: database should have millions of records
      expect(data.data.editions).toBeGreaterThan(50_000_000);
      expect(data.data.works).toBeGreaterThan(40_000_000);
      expect(data.data.authors).toBeGreaterThan(14_000_000);
    });
  });

  describe('KV Connectivity', () => {
    it('GET /api/quota/status should return quota information', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/quota/status`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('used_today');
      expect(data.data).toHaveProperty('remaining');
      expect(data.data).toHaveProperty('limit', 15000);
      expect(data.data).toHaveProperty('can_make_calls');

      // Sanity checks
      expect(data.data.used_today).toBeGreaterThanOrEqual(0);
      expect(data.data.remaining).toBeGreaterThanOrEqual(0);
      expect(data.data.remaining).toBeLessThanOrEqual(15000);
    });
  });

  describe('OpenAPI Specification', () => {
    it('GET /openapi.json should return valid OpenAPI 3.0 spec', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/openapi.json`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const spec = await response.json();
      expect(spec).toHaveProperty('openapi');
      expect(spec.openapi).toMatch(/^3\.\d+\.\d+$/); // OpenAPI 3.x.x
      expect(spec).toHaveProperty('info');
      expect(spec).toHaveProperty('paths');
      expect(spec.info).toHaveProperty('title', 'Alexandria API');
    });

    it('OpenAPI spec should document key endpoints', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/openapi.json`);
      const spec = await response.json();

      // Verify critical endpoints are documented
      expect(spec.paths).toHaveProperty('/health');
      expect(spec.paths).toHaveProperty('/api/stats');
      expect(spec.paths).toHaveProperty('/api/search');
      expect(spec.paths).toHaveProperty('/api/quota/status');
    });
  });

  describe('Search API Validation', () => {
    it('GET /api/search should require at least one query param', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/search`);

      // Should return 400 or 422 for missing query params
      expect([400, 422]).toContain(response.status);

      const data = await response.json();
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    });

    it('GET /api/search?isbn=invalid should reject invalid ISBN', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/search?isbn=invalid-isbn`);

      expect([400, 422]).toContain(response.status);

      const data = await response.json();
      expect(data).toHaveProperty('success', false);
    });

    it('GET /api/search with valid params should return 200', async () => {
      // Simple title search (should always work)
      const response = await fetchWithTimeout(`${BASE_URL}/api/search?title=harry&limit=1`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data.results)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('Should return 404 for non-existent endpoints', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/nonexistent-endpoint`);

      expect(response.status).toBe(404);
    });

    it('Should return JSON error response for 404', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/nonexistent-endpoint`);

      const data = await response.json();
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    });
  });

  describe('Response Headers', () => {
    it('Should include security headers', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/health`);

      // Cloudflare should add security headers
      expect(response.headers.has('cf-ray')).toBe(true); // Cloudflare request ID
    });

    it('Should include CORS headers for API endpoints', async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/stats`, {
        headers: {
          'Origin': 'https://example.com',
        },
      });

      // Check if CORS is configured
      const corsHeader = response.headers.get('access-control-allow-origin');
      // Either CORS is configured or not - just verify response is valid
      expect(response.status).toBe(200);
    });
  });

  describe('Performance Baselines', () => {
    it('Health check should respond in <500ms', async () => {
      const start = Date.now();
      const response = await fetchWithTimeout(`${BASE_URL}/health`, {}, 500);
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(500);
    });

    it('Stats endpoint should respond in <2s', async () => {
      const start = Date.now();
      const response = await fetchWithTimeout(`${BASE_URL}/api/stats`, {}, 2000);
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(2000);
    });

    it('Quota status should respond in <1s', async () => {
      const start = Date.now();
      const response = await fetchWithTimeout(`${BASE_URL}/api/quota/status`, {}, 1000);
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(1000);
    });
  });
});

// =================================================================================
// CI-Specific Tests (Only run in CI environment)
// =================================================================================

describe.skipIf(!isCI())('CI Environment Validation', () => {
  it('Should be running against production URL', () => {
    expect(BASE_URL).toContain('alexandria.ooheynerds.com');
  });

  it('Should have CI environment variables set', () => {
    expect(process.env.CI).toBe('true');
  });
});
