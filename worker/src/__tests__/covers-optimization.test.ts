import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCoverStatus } from '../routes/covers.js';
import type { Context } from 'hono';
import type { AppBindings } from '../env.js';

describe('Cover Status Optimization', () => {
  let mockContext: Context<AppBindings>;
  let mockR2: any;
  let mockLogger: any;

  beforeEach(() => {
    mockR2 = {
      head: vi.fn(),
      list: vi.fn(),
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };

    mockContext = {
      req: {
        valid: vi.fn().mockReturnValue({ isbn: '9780123456789' }),
      },
      get: vi.fn((key) => {
        if (key === 'logger') return mockLogger;
        return undefined;
      }),
      env: {
        COVER_IMAGES: mockR2,
      },
      json: vi.fn((data, status) => ({ data, status })),
    } as any;
  });

  it('should use single list call instead of multiple head calls (OPTIMIZED)', async () => {
    const isbn = '9780123456789';
    const prefix = `isbn/${isbn}/`;

    // Setup mock for list call
    mockR2.list.mockResolvedValue({
      objects: [
        { key: `${prefix}large.webp`, size: 1000, uploaded: new Date('2023-01-01T00:00:00Z') },
        { key: `${prefix}medium.webp`, size: 500, uploaded: new Date('2023-01-01T00:00:00Z') },
        { key: `${prefix}small.webp`, size: 200, uploaded: new Date('2023-01-01T00:00:00Z') },
      ]
    });

    const result = await handleCoverStatus(mockContext);

    // Verify successful response
    expect(result).toMatchObject({
      data: {
        exists: true,
        format: 'webp',
        sizes: {
          large: 1000,
          medium: 500,
          small: 200,
        }
      }
    });

    // Verify optimization: 1 list call, 0 head calls
    expect(mockR2.list).toHaveBeenCalledTimes(1);
    expect(mockR2.list).toHaveBeenCalledWith({
      prefix,
      include: ['customMetadata'],
    });
    expect(mockR2.head).toHaveBeenCalledTimes(0);
  });

  it('should handle legacy format with single list call', async () => {
    const isbn = '9780123456789';
    const prefix = `isbn/${isbn}/`;

    // Setup mock for list call with legacy files only
    mockR2.list.mockResolvedValue({
      objects: [
        { key: `${prefix}original.jpg`, size: 1500, uploaded: new Date('2023-01-01T00:00:00Z') },
      ]
    });

    const result = await handleCoverStatus(mockContext);

    // Verify successful response
    expect(result).toMatchObject({
      data: {
        exists: true,
        format: 'legacy',
        sizes: {
          large: 1500,
        }
      }
    });

    expect(mockR2.list).toHaveBeenCalledTimes(1);
    expect(mockR2.head).toHaveBeenCalledTimes(0);
  });
});
