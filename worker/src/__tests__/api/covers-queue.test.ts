
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleQueueCovers } from '../../routes/covers.js';

// Mock dependencies
vi.mock('../../lib/isbn-utils.js', () => ({
  normalizeISBN: (isbn: string) => isbn === 'invalid' ? null : isbn.replace(/-/g, ''),
}));

describe('handleQueueCovers', () => {
  let mockContext: any;
  let mockQueue: any;
  let mockLogger: any;

  beforeEach(() => {
    mockQueue = {
      send: vi.fn().mockResolvedValue(undefined),
      sendBatch: vi.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    mockContext = {
      req: {
        valid: vi.fn(),
      },
      env: {
        COVER_QUEUE: mockQueue,
      },
      get: (key: string) => {
        if (key === 'logger') return mockLogger;
        return null;
      },
      json: vi.fn((data, status) => ({ data, status })),
    };
  });

  it('should process multiple books using sendBatch (optimized)', async () => {
    const books = [
      { isbn: '978-0-123456-47-2', title: 'Book 1' },
      { isbn: '978-0-987654-32-1', title: 'Book 2' },
    ];

    mockContext.req.valid.mockReturnValue({ books });

    const result = await handleQueueCovers(mockContext);

    // Verify sendBatch was called once
    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1);
    expect(mockQueue.send).not.toHaveBeenCalled();

    // Verify arguments
    const calls = mockQueue.sendBatch.mock.calls[0];
    const messages = calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0].body).toEqual(expect.objectContaining({
      isbn: '9780123456472',
      title: 'Book 1',
    }));
    expect(messages[1].body).toEqual(expect.objectContaining({
      isbn: '9780987654321',
      title: 'Book 2',
    }));

    // Verify response
    expect(result.data.queued).toBe(2);
    expect(result.data.failed).toBe(0);
  });

  it('should handle partial failures in validation but still send valid ones in batch', async () => {
    const books = [
      { isbn: '978-0-123456-47-2', title: 'Valid Book' },
      { isbn: 'invalid', title: 'Invalid Book' },
    ];

    mockContext.req.valid.mockReturnValue({ books });

    const result = await handleQueueCovers(mockContext);

    // Verify sendBatch was called once
    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1);
    const messages = mockQueue.sendBatch.mock.calls[0][0];
    expect(messages).toHaveLength(1);
    expect(messages[0].body.isbn).toBe('9780123456472');

    // Verify response
    expect(result.data.queued).toBe(1);
    expect(result.data.failed).toBe(1);
    expect(result.data.errors[0].isbn).toBe('invalid');
  });

  it('should handle batch failure', async () => {
    const books = [
      { isbn: '978-0-123456-47-2', title: 'Valid Book' },
    ];

    mockContext.req.valid.mockReturnValue({ books });
    mockQueue.sendBatch.mockRejectedValue(new Error('Queue full'));

    const result = await handleQueueCovers(mockContext);

    // Verify sendBatch was called
    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1);

    // Verify response
    expect(result.data.queued).toBe(0);
    expect(result.data.failed).toBe(1);
    expect(result.data.errors[0].isbn).toBe('9780123456472');
    expect(result.data.errors[0].error).toContain('Batch queue operation failed');
    expect(result.data.errors[0].error).toContain('NO messages were queued');
  });

  it('should return 400 error when books array is empty', async () => {
    const books: any[] = [];

    mockContext.req.valid.mockReturnValue({ books });

    const result = await handleQueueCovers(mockContext);

    // Verify sendBatch was NOT called
    expect(mockQueue.sendBatch).not.toHaveBeenCalled();
    expect(mockQueue.send).not.toHaveBeenCalled();

    // Verify response
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('books array required');
  });

  it('should return 400 error when more than 100 books are provided', async () => {
    const books = Array.from({ length: 101 }, (_, i) => ({
      isbn: `978-0-12345-${String(i).padStart(3, '0')}-0`,
      title: `Book ${i}`,
    }));

    mockContext.req.valid.mockReturnValue({ books });

    const result = await handleQueueCovers(mockContext);

    // Verify sendBatch was NOT called
    expect(mockQueue.sendBatch).not.toHaveBeenCalled();
    expect(mockQueue.send).not.toHaveBeenCalled();

    // Verify response
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('Max 100 books per request');
  });

  it('should handle all invalid ISBNs without calling sendBatch', async () => {
    const books = [
      { isbn: 'invalid', title: 'Invalid Book 1' },
      { isbn: 'invalid', title: 'Invalid Book 2' },
    ];

    mockContext.req.valid.mockReturnValue({ books });

    const result = await handleQueueCovers(mockContext);

    // Verify sendBatch was NOT called (no valid messages)
    expect(mockQueue.sendBatch).not.toHaveBeenCalled();
    expect(mockQueue.send).not.toHaveBeenCalled();

    // Verify response
    expect(result.data.queued).toBe(0);
    expect(result.data.failed).toBe(2);
    expect(result.data.errors).toHaveLength(2);
    expect(result.data.errors[0].isbn).toBe('invalid');
    expect(result.data.errors[0].error).toBe('Invalid ISBN format');
    expect(result.data.errors[1].isbn).toBe('invalid');
    expect(result.data.errors[1].error).toBe('Invalid ISBN format');
  });

  it('should handle undefined ISBN field', async () => {
    const books = [
      { title: 'Book without ISBN' } as any,
    ];

    mockContext.req.valid.mockReturnValue({ books });

    const result = await handleQueueCovers(mockContext);

    // Verify sendBatch was NOT called
    expect(mockQueue.sendBatch).not.toHaveBeenCalled();
    expect(mockQueue.send).not.toHaveBeenCalled();

    // Verify response
    expect(result.data.queued).toBe(0);
    expect(result.data.failed).toBe(1);
    expect(result.data.errors).toHaveLength(1);
    expect(result.data.errors[0].isbn).toBe('undefined');
    expect(result.data.errors[0].error).toContain('Invalid ISBN format');
  });

  it('should log success message on successful batch', async () => {
    const books = [
      { isbn: '978-0-123456-47-2', title: 'Book 1' },
      { isbn: '978-0-987654-32-1', title: 'Book 2' },
    ];

    mockContext.req.valid.mockReturnValue({ books });

    await handleQueueCovers(mockContext);

    // Verify logger.info was called with success message
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Cover queue batch sent successfully'),
      expect.objectContaining({
        batch_size: 2,
        sample_isbns: expect.any(Array),
      })
    );
  });

  it('should log enhanced error details on batch failure', async () => {
    const books = [
      { isbn: '978-0-123456-47-2', title: 'Book 1' },
      { isbn: '978-0-987654-32-1', title: 'Book 2' },
    ];

    mockContext.req.valid.mockReturnValue({ books });

    const mockError = new Error('Queue capacity exceeded');
    mockError.stack = 'Error stack trace';
    mockQueue.sendBatch.mockRejectedValue(mockError);

    await handleQueueCovers(mockContext);

    // Verify logger.error was called with enhanced details
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('NO messages were queued'),
      expect.objectContaining({
        error: 'Queue capacity exceeded',
        error_type: 'Error',
        stack: expect.stringContaining('Error stack trace'),
        batch_size: 2,
        sample_isbns: expect.any(Array),
      })
    );
  });
});
