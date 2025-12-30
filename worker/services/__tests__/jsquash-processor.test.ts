// =================================================================================
// Cover Pipeline Tests (jsquash-processor)
//
// Tests cover:
// 1. Domain whitelist validation (security-critical)
// 2. Image decode → resize → encode pipeline (mock WASM outputs)
// 3. R2 upload logic (mock R2.put)
// 4. Error handling (network failures, invalid images)
// 5. WebP compression and size thresholds
// 6. Image dimension constraints
// =================================================================================

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Env } from '../../src/env';

// =================================================================================
// Mock WASM Modules
// =================================================================================

// Mock jSquash WASM modules
vi.mock('@jsquash/jpeg/decode', () => ({
  default: vi.fn(),
  init: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@jsquash/png/decode', () => ({
  default: vi.fn(),
  init: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@jsquash/webp/encode', () => ({
  default: vi.fn(),
  init: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@jsquash/resize', () => ({
  default: vi.fn(),
  initResize: vi.fn().mockResolvedValue(undefined),
}));

// Mock WASM binary imports
vi.mock('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm', () => ({
  default: new ArrayBuffer(0),
}));

vi.mock('@jsquash/png/codec/pkg/squoosh_png_bg.wasm', () => ({
  default: new ArrayBuffer(0),
}));

vi.mock('@jsquash/webp/codec/enc/webp_enc.wasm', () => ({
  default: new ArrayBuffer(0),
}));

vi.mock('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm', () => ({
  default: new ArrayBuffer(0),
}));

// Import mocked modules
import decodeJpeg from '@jsquash/jpeg/decode';
import decodePng from '@jsquash/png/decode';
import encodeWebp from '@jsquash/webp/encode';
import resize from '@jsquash/resize';

// Import module under test
import { processAndStoreCover, coversExist } from '../jsquash-processor';

// =================================================================================
// Test Helpers
// =================================================================================

/**
 * Create mock ImageData object
 */
function createMockImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  };
}

/**
 * Create mock JPEG buffer with valid magic bytes
 */
function createMockJpegBuffer(size: number = 50000): ArrayBuffer {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  // JPEG magic bytes: FF D8 FF
  view[0] = 0xFF;
  view[1] = 0xD8;
  view[2] = 0xFF;
  return buffer;
}

/**
 * Create mock PNG buffer with valid magic bytes
 */
function createMockPngBuffer(size: number = 50000): ArrayBuffer {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  // PNG magic bytes: 89 50 4E 47
  view[0] = 0x89;
  view[1] = 0x50;
  view[2] = 0x4E;
  view[3] = 0x47;
  return buffer;
}

/**
 * Create mock WebP buffer
 */
function createMockWebpBuffer(size: number = 10000): ArrayBuffer {
  return new ArrayBuffer(size);
}

/**
 * Create mock Env with R2 binding
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    COVER_IMAGES: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      head: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as any,
    HYPERDRIVE: {
      connectionString: 'postgres://mock',
    },
    CACHE: {
      get: vi.fn(),
      put: vi.fn(),
    } as any,
    ISBNDB_API_KEY: 'mock-key',
    GOOGLE_BOOKS_API_KEY: 'mock-key',
    ...overrides,
  } as Env;
}

// =================================================================================
// Domain Whitelist Tests (Security-Critical)
// =================================================================================

describe('Domain Whitelist Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const ALLOWED_DOMAINS = [
    'https://books.google.com/cover.jpg',
    'https://covers.openlibrary.org/b/id/12345-L.jpg',
    'https://images.isbndb.com/covers/12/34/1234567890.jpg',
    'https://images-na.ssl-images-amazon.com/images/P/1234567890.jpg',
    'https://pictures.abebooks.com/covers/12345.jpg',
    'https://m.media-amazon.com/images/I/12345.jpg',
  ];

  const BLOCKED_DOMAINS = [
    'https://evil.com/malicious.jpg',
    'https://random-site.net/image.png',
    'https://user-uploads.example.com/suspicious.jpg',
    'http://localhost:8080/test.jpg',
  ];

  it.each(ALLOWED_DOMAINS)('should allow whitelisted domain: %s', async (url) => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(50000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(600, 800));
    (resize as Mock).mockResolvedValue(createMockImageData(512, 683));
    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    const result = await processAndStoreCover('9780439064873', url, env);

    expect(result.status).toBe('processed');
    expect(global.fetch).toHaveBeenCalledWith(url, expect.any(Object));
  });

  it.each(BLOCKED_DOMAINS)('should block non-whitelisted domain: %s', async (url) => {
    const env = createMockEnv();

    const result = await processAndStoreCover('9780439064873', url, env);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Domain not allowed');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should reject malformed URLs', async () => {
    const env = createMockEnv();

    const result = await processAndStoreCover('9780439064873', 'not-a-valid-url', env);

    expect(result.status).toBe('error');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// =================================================================================
// Image Processing Pipeline Tests
// =================================================================================

describe('Image Processing Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should process JPEG image successfully', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(50000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    const sourceImage = createMockImageData(600, 800);
    (decodeJpeg as Mock).mockResolvedValue(sourceImage);

    // Mock resize for each size (large, medium, small)
    (resize as Mock)
      .mockResolvedValueOnce(createMockImageData(512, 683)) // large
      .mockResolvedValueOnce(createMockImageData(256, 341)) // medium
      .mockResolvedValueOnce(createMockImageData(128, 170)); // small

    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('processed');
    expect(result.compression?.ratio).toBeDefined();
    expect(decodeJpeg).toHaveBeenCalledWith(mockJpegBuffer);
    expect(resize).toHaveBeenCalledTimes(3);
    expect(encodeWebp).toHaveBeenCalledTimes(3);
  });

  it('should process PNG image successfully', async () => {
    const env = createMockEnv();
    const mockPngBuffer = createMockPngBuffer(60000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockPngBuffer,
    });

    const sourceImage = createMockImageData(800, 1200);
    (decodePng as Mock).mockResolvedValue(sourceImage);

    (resize as Mock)
      .mockResolvedValueOnce(createMockImageData(512, 768)) // large
      .mockResolvedValueOnce(createMockImageData(256, 384)) // medium
      .mockResolvedValueOnce(createMockImageData(128, 192)); // small

    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(12000));

    const result = await processAndStoreCover(
      '9781234567890',
      'https://books.google.com/cover.png',
      env
    );

    expect(result.status).toBe('processed');
    expect(decodePng).toHaveBeenCalledWith(mockPngBuffer);
  });

  it('should reject images larger than 10MB', async () => {
    const env = createMockEnv();
    const hugeBuffer = new ArrayBuffer(11 * 1024 * 1024); // 11MB

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => hugeBuffer,
    });

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Image too large');
  });

  it('should reject images smaller than 100 bytes (placeholders)', async () => {
    const env = createMockEnv();
    const tinyBuffer = new ArrayBuffer(50);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => tinyBuffer,
    });

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Image too small');
  });

  it('should reject unknown image formats', async () => {
    const env = createMockEnv();
    const unknownBuffer = new ArrayBuffer(1000);
    // Fill with random bytes (not JPEG/PNG/WebP magic bytes)
    const view = new Uint8Array(unknownBuffer);
    view[0] = 0x00;
    view[1] = 0x00;
    view[2] = 0x00;

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => unknownBuffer,
    });

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Unknown image format');
  });
});

// =================================================================================
// WebP Size Threshold Tests
// =================================================================================

describe('WebP Size Threshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should skip WebP conversion for small images (<5KB)', async () => {
    const env = createMockEnv();
    const smallJpegBuffer = createMockJpegBuffer(3000); // 3KB

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => smallJpegBuffer,
    });

    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(200, 300));

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('processed');
    expect(result.metrics.webpSkipped).toBe(true);
    expect(result.compression?.webpSkipped).toBe(true);

    // Should upload original format, not WebP
    expect(env.COVER_IMAGES.put).toHaveBeenCalledTimes(3); // All 3 sizes
    expect(encodeWebp).not.toHaveBeenCalled();

    // Verify JPEG content type
    const putCalls = (env.COVER_IMAGES.put as Mock).mock.calls;
    putCalls.forEach((call) => {
      const [_key, _buffer, options] = call;
      expect(options.httpMetadata.contentType).toBe('image/jpeg');
    });
  });

  it('should convert to WebP for normal-sized images (>5KB)', async () => {
    const env = createMockEnv();
    const normalJpegBuffer = createMockJpegBuffer(50000); // 50KB

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => normalJpegBuffer,
    });

    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(600, 800));
    (resize as Mock).mockResolvedValue(createMockImageData(512, 683));
    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('processed');
    expect(result.metrics.webpSkipped).toBeUndefined();
    expect(encodeWebp).toHaveBeenCalledTimes(3);

    // Verify WebP content type
    const putCalls = (env.COVER_IMAGES.put as Mock).mock.calls;
    putCalls.forEach((call) => {
      const [_key, _buffer, options] = call;
      expect(options.httpMetadata.contentType).toBe('image/webp');
    });
  });
});

// =================================================================================
// R2 Storage Tests
// =================================================================================

describe('R2 Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should upload 3 sizes to R2 with correct paths', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(50000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(600, 800));
    (resize as Mock).mockResolvedValue(createMockImageData(512, 683));
    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(env.COVER_IMAGES.put).toHaveBeenCalledTimes(3);

    const putCalls = (env.COVER_IMAGES.put as Mock).mock.calls;
    const keys = putCalls.map((call) => call[0]);

    expect(keys).toContain('isbn/9780439064873/large.webp');
    expect(keys).toContain('isbn/9780439064873/medium.webp');
    expect(keys).toContain('isbn/9780439064873/small.webp');
  });

  it('should set correct R2 metadata and cache headers', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(50000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(600, 800));
    (resize as Mock).mockResolvedValue(createMockImageData(512, 683));
    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    const putCalls = (env.COVER_IMAGES.put as Mock).mock.calls;
    putCalls.forEach((call) => {
      const [_key, _buffer, options] = call;

      expect(options.httpMetadata.contentType).toBe('image/webp');
      expect(options.httpMetadata.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(options.customMetadata.uploadedAt).toBeDefined();
      expect(options.customMetadata.sourceUrl).toBe(
        'https://covers.openlibrary.org/b/id/test.jpg'
      );
      expect(options.customMetadata.originalSize).toBe('50000');
      expect(options.customMetadata.quality).toBe('85');
    });
  });

  it('should normalize ISBN for R2 keys', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(50000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(600, 800));
    (resize as Mock).mockResolvedValue(createMockImageData(512, 683));
    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    await processAndStoreCover(
      '978-0-439-06487-3', // ISBN with hyphens
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    const putCalls = (env.COVER_IMAGES.put as Mock).mock.calls;
    const keys = putCalls.map((call) => call[0]);

    // All keys should use normalized ISBN (no hyphens)
    keys.forEach((key) => {
      expect(key).toContain('isbn/9780439064873/');
      expect(key).not.toContain('-');
    });
  });
});

// =================================================================================
// Error Handling Tests
// =================================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should handle network fetch failures', async () => {
    const env = createMockEnv();

    (global.fetch as Mock).mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/nonexistent.jpg',
      env
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Failed to fetch image');
    expect(result.error).toContain('404');
  });

  it('should handle WASM decode errors', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(50000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    (decodeJpeg as Mock).mockRejectedValue(new Error('WASM decode failed'));

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('WASM decode failed');
  });

  it('should handle R2 upload failures', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(50000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(600, 800));
    (resize as Mock).mockResolvedValue(createMockImageData(512, 683));
    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    (env.COVER_IMAGES.put as Mock).mockRejectedValue(new Error('R2 storage full'));

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('R2 storage full');
  });

  it('should return metrics even on failure', async () => {
    const env = createMockEnv();

    (global.fetch as Mock).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('error');
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalMs).toBeGreaterThanOrEqual(0); // Can be 0 in fast tests
    expect(result.metrics.isbn).toBe('9780439064873');
  });
});

// =================================================================================
// coversExist() Tests
// =================================================================================

describe('coversExist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when cover exists', async () => {
    const env = createMockEnv();

    (env.COVER_IMAGES.head as Mock).mockResolvedValue({
      key: 'isbn/9780439064873/large.webp',
      size: 10000,
    });

    const exists = await coversExist(env, '9780439064873');

    expect(exists).toBe(true);
    expect(env.COVER_IMAGES.head).toHaveBeenCalledWith('isbn/9780439064873/large.webp');
  });

  it('should return false when cover does not exist', async () => {
    const env = createMockEnv();

    (env.COVER_IMAGES.head as Mock).mockResolvedValue(null);

    const exists = await coversExist(env, '9780439064873');

    expect(exists).toBe(false);
  });

  it('should normalize ISBN before checking', async () => {
    const env = createMockEnv();

    (env.COVER_IMAGES.head as Mock).mockResolvedValue(null);

    await coversExist(env, '978-0-439-06487-3');

    expect(env.COVER_IMAGES.head).toHaveBeenCalledWith('isbn/9780439064873/large.webp');
  });
});

// =================================================================================
// Dimension Scaling Tests
// =================================================================================

describe('Image Dimension Scaling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should downscale large images to fit target bounds', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(100000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    // Large source image
    (decodeJpeg as Mock).mockResolvedValue(createMockImageData(1200, 1800));

    (resize as Mock)
      .mockResolvedValueOnce(createMockImageData(512, 768)) // large (scaled down)
      .mockResolvedValueOnce(createMockImageData(256, 384)) // medium (scaled down)
      .mockResolvedValueOnce(createMockImageData(128, 192)); // small (scaled down)

    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(10000));

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('processed');
    expect(result.metrics.dimensions?.large.scaled).toBe(true);
    expect(result.metrics.dimensions?.medium.scaled).toBe(true);
    expect(result.metrics.dimensions?.small.scaled).toBe(true);
  });

  it('should NOT upscale small images (use source dimensions)', async () => {
    const env = createMockEnv();
    const mockJpegBuffer = createMockJpegBuffer(20000);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockJpegBuffer,
    });

    // Small source image (100x150 - smaller than all targets)
    const smallImage = createMockImageData(100, 150);
    (decodeJpeg as Mock).mockResolvedValue(smallImage);

    // Resize should NOT be called for images smaller than target
    (encodeWebp as Mock).mockResolvedValue(createMockWebpBuffer(5000));

    const result = await processAndStoreCover(
      '9780439064873',
      'https://covers.openlibrary.org/b/id/test.jpg',
      env
    );

    expect(result.status).toBe('processed');
    expect(result.metrics.dimensions?.large.scaled).toBe(false);
    expect(result.metrics.dimensions?.medium.scaled).toBe(false);
    expect(result.metrics.dimensions?.small.scaled).toBe(false);

    // All dimensions should match source
    expect(result.metrics.dimensions?.large.width).toBe(100);
    expect(result.metrics.dimensions?.large.height).toBe(150);
  });
});
