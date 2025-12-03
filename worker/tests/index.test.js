import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Setup mocks BEFORE importing the module under test
// Mock the postgres module itself (not a local file)
vi.mock('postgres', async () => {
    const mockSql = vi.fn();
    mockSql.mockImplementation(() => Promise.resolve([]));
    const postgres = vi.fn(() => mockSql);
    return { default: postgres };
});

// Mock local dependencies
vi.mock('../enrich-handlers.js', () => ({
    handleEnrichEdition: vi.fn((c) => c.json({ status: 'ok' })),
    handleEnrichWork: vi.fn(),
    handleEnrichAuthor: vi.fn(),
    handleQueueEnrichment: vi.fn(),
    handleGetEnrichmentStatus: vi.fn(),
}));

vi.mock('../services/image-processor.js', () => ({
    processCoverImage: vi.fn(),
    processCoverBatch: vi.fn(),
    coverExists: vi.fn(),
    getCoverMetadata: vi.fn(),
    getPlaceholderCover: vi.fn(() => 'http://placeholder'),
}));

vi.mock('../cover-handlers.js', () => ({
    handleProcessCover: vi.fn(),
    handleServeCover: vi.fn(),
}));

// 2. Import the module under test
import worker from '../index.js';
import postgres from 'postgres'; // This is now our mocked version

describe('Worker Routes', () => {
    let env;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        env = {
            HYPERDRIVE: { connectionString: 'postgres://...' },
            COVER_IMAGES: {
                get: vi.fn(),
            },
            CACHE: {}
        };
    });

    it('GET /health should return 200 and database status', async () => {
        const req = new Request('http://localhost/health');

        // We need the SQL query inside /health to succeed.
        // The middleware sets c.set('sql', sql).
        // The route calls `await sql\SELECT 1\`.

        // Our mocked `postgres` returns `mockSql`.
        // We need to make sure that `mockSql` returns a promise that resolves.
        // The default implementation in our mock factory above does `Promise.resolve([])`.

        const res = await worker.fetch(req, env);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.status).toBe('ok');
    });

    it('GET /api/search should return 400 if no parameters', async () => {
        const req = new Request('http://localhost/api/search');
        const res = await worker.fetch(req, env);
        expect(res.status).toBe(400);
    });

    it('GET /api/search with ISBN should execute SQL', async () => {
        const req = new Request('http://localhost/api/search?isbn=9780439064873');

        // Use the postgres mock we imported to access the mockSql function
        // `postgres` is the factory function. `postgres()` returns `mockSql`.
        // But `worker/index.js` calls `postgres(...)` in the middleware.

        // Let's verify that fetch works without crashing.
        const res = await worker.fetch(req, env);

        // Expect 404 because our mock returns [] (empty results)
        expect(res.status).toBe(404);
    });

    describe('GET /covers/:isbn/:size', () => {
        it('should return 400 for invalid size', async () => {
            const req = new Request('http://localhost/covers/9780439064873/invalid_size');
            const res = await worker.fetch(req, env);
            expect(res.status).toBe(400);
        });

        it('should return 400 for invalid ISBN', async () => {
            const req = new Request('http://localhost/covers/invalid-isbn/small');
            const res = await worker.fetch(req, env);
            expect(res.status).toBe(400);
        });

        it('should redirect to placeholder if cover not found in R2', async () => {
            env.COVER_IMAGES.get.mockResolvedValue(null);

            const req = new Request('http://localhost/covers/9780439064873/small');
            const res = await worker.fetch(req, env);

            expect(res.status).toBe(302);
            expect(res.headers.get('Location')).toBe('http://placeholder');
        });

        it('should return image if found in R2', async () => {
            env.COVER_IMAGES.get.mockResolvedValue({
                body: 'image-data',
                httpMetadata: { contentType: 'image/jpeg' }
            });

            const req = new Request('http://localhost/covers/9780439064873/small');
            const res = await worker.fetch(req, env);

            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('image/jpeg');
        });
    });
});
