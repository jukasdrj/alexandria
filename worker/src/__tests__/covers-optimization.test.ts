import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock WASM modules
vi.mock('@jsquash/jpeg', () => ({ default: vi.fn() }));
vi.mock('@jsquash/webp', () => ({ encode: vi.fn() }));

// Mock cover handlers
vi.mock('../services/cover-handlers.js', () => ({
  handleProcessCover: vi.fn(),
  handleServeCover: vi.fn(),
}));

import coversApp from '../routes/covers.js';

describe('Cover Status Optimization', () => {
  const listSpy = vi.fn();
  const headSpy = vi.fn();

  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const mockEnv = {
    COVER_IMAGES: {
      list: listSpy,
      head: headSpy,
    },
  };

  // Mount the app to inject logger
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('logger', mockLogger);
    await next();
  });
  app.route('/', coversApp);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use list instead of head for webp check', async () => {
    const isbn = '9780123456789';
    // Mock list response with large.webp
    listSpy.mockResolvedValue({
      objects: [
        { key: `isbn/${isbn}/large.webp`, size: 1000, uploaded: new Date() },
        { key: `isbn/${isbn}/medium.webp`, size: 500, uploaded: new Date() },
        { key: `isbn/${isbn}/small.webp`, size: 200, uploaded: new Date() },
      ],
      truncated: false,
      delimitedPrefixes: []
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/covers/status/${isbn}`),
      mockEnv
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(true);

    // Verify list was called
    expect(listSpy).toHaveBeenCalledWith({ prefix: `isbn/${isbn}/` });
    // Verify head was NOT called
    expect(headSpy).not.toHaveBeenCalled();

    // Check body details
    expect(body.format).toBe('webp');
    expect(body.sizes.large).toBe(1000);
  });

  it('should fallback to legacy if webp missing in list', async () => {
    const isbn = '9789876543210';
     // Mock list response with legacy original.jpg
     listSpy.mockResolvedValue({
      objects: [
        { key: `isbn/${isbn}/original.jpg`, size: 2000, uploaded: new Date() },
      ],
      truncated: false,
      delimitedPrefixes: []
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/covers/status/${isbn}`),
      mockEnv
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(true);

     // Verify list was called
     expect(listSpy).toHaveBeenCalledWith({ prefix: `isbn/${isbn}/` });
     // Verify head was NOT called
     expect(headSpy).not.toHaveBeenCalled();

     expect(body.format).toBe('legacy');
  });

  it('should return not found if list is empty', async () => {
    const isbn = '9780000000000';
    listSpy.mockResolvedValue({
      objects: [],
      truncated: false,
      delimitedPrefixes: []
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/covers/status/${isbn}`),
      mockEnv
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(false);

    // Verify list was called
    expect(listSpy).toHaveBeenCalledWith({ prefix: `isbn/${isbn}/` });
    // Verify head was NOT called
    expect(headSpy).not.toHaveBeenCalled();
  });
});
