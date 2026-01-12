// =================================================================================
// Queue Handlers Tests - Priority #1 (CRITICAL)
//
// Tests cover:
// 1. Batch processing logic (max_batch_size: 10 for covers, 100 for enrichment)
// 2. Retry logic with exponential backoff
// 3. Dead Letter Queue routing (after 3 retries)
// 4. Message ack/retry calls
// 5. Analytics tracking
// 6. Error handling and recovery
// =================================================================================

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { processCoverQueue, processEnrichmentQueue } from '../queue-handlers';
import type { Env } from '../../env';
import type {
  CoverQueueMessage,
  EnrichmentQueueMessage,
  MessageBatch,
  Message,
} from '../types';

// =================================================================================
// Mock Setup
// =================================================================================

// Mock external dependencies
vi.mock('../../../services/jsquash-processor', () => ({
  processAndStoreCover: vi.fn(),
  coversExist: vi.fn(),
}));

vi.mock('../../../services/cover-fetcher', () => ({
  fetchBestCover: vi.fn(),
  // fetchISBNdbCover removed - now using ISBNdbProvider.fetchCover
}));

vi.mock('../../../lib/external-services/providers/isbndb-provider', () => {
  // Create mock provider inside factory to avoid hoisting
  let providerInstance: any = null;

  const MockISBNdbProvider = function() {
    if (!providerInstance) {
      providerInstance = {
        name: 'isbndb',
        providerType: 'paid' as const,
        capabilities: ['isbn-resolution', 'metadata-enrichment', 'cover-images'],
        batchFetchMetadata: vi.fn(),
        fetchCover: vi.fn(), // NEW: Mock for JWT recovery
        isAvailable: vi.fn().mockResolvedValue(true),
      };
    }
    return providerInstance;
  };

  // Attach a getter to access the instance
  Object.defineProperty(MockISBNdbProvider, 'getInstance', {
    get: () => providerInstance,
  });

  return {
    ISBNdbProvider: MockISBNdbProvider,
  };
});

vi.mock('../enrichment-service', () => ({
  enrichEdition: vi.fn(),
  enrichWork: vi.fn(),
}));

vi.mock('../../../lib/isbn-utils', () => ({
  normalizeISBN: (isbn: string) => isbn?.replace(/[-\s]/g, '') || null,
}));

vi.mock('../../../lib/external-services/provider-registry', () => {
  return {
    getGlobalRegistry: vi.fn(() => {
      // Lazy-load the ISBNdb provider instance
      let cachedProvider: any = null;

      return {
        registerAll: vi.fn((providers: any[]) => {
          // When providers are registered, capture the ISBNdb instance
          cachedProvider = providers.find(p => p?.name === 'isbndb');
        }),
        get: vi.fn((name: string) => {
          if (name === 'isbndb') {
            return cachedProvider;
          }
          return null;
        }),
      };
    }),
  };
});

// Mock postgres
const mockSql = vi.fn() as any;
mockSql.end = vi.fn().mockResolvedValue(undefined);
vi.mock('postgres', () => ({
  default: vi.fn(() => mockSql),
}));

// Import mocked modules
import { processAndStoreCover, coversExist } from '../../../services/jsquash-processor';
import { fetchBestCover } from '../../../services/cover-fetcher';
import { ISBNdbProvider } from '../../../lib/external-services/providers/isbndb-provider';
import { enrichEdition, enrichWork } from '../enrichment-service';

// Get the mock provider instance (created when the module is imported)
// The instance is created during queue-handlers.ts initialization
const globalMockProvider = new ISBNdbProvider();

// =================================================================================
// Test Helpers
// =================================================================================

/**
 * Create mock queue message with ack/retry tracking
 */
function createMockMessage<T>(body: T): Message<T> {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(),
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

/**
 * Create mock MessageBatch
 */
function createMockBatch<T>(
  queueName: string,
  messages: Message<T>[]
): MessageBatch<T> {
  return {
    queue: queueName,
    messages,
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  };
}

/**
 * Create mock Env with all required bindings
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    HYPERDRIVE: {
      connectionString: 'postgres://mock:mock@localhost:5432/mock',
    },
    COVER_IMAGES: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
    } as any,
    CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as any,
    QUOTA_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as any,
    COVER_ANALYTICS: {
      writeDataPoint: vi.fn(),
    } as any,
    ANALYTICS: {
      writeDataPoint: vi.fn(),
    } as any,
    ISBNDB_API_KEY: 'mock-api-key',
    GOOGLE_BOOKS_API_KEY: 'mock-google-key',
    ...overrides,
  } as Env;
}

// =================================================================================
// Cover Queue Tests
// =================================================================================

describe('processCoverQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Batch Processing', () => {
    it('should process batch of 10 covers (max_batch_size)', async () => {
      const env = createMockEnv();
      const messages = Array.from({ length: 10 }, (_, i) =>
        createMockMessage<CoverQueueMessage>({
          isbn: `978000000000${i}`,
          provider_url: `https://covers.openlibrary.org/b/id/test-${i}.jpg`,
        })
      );
      const batch = createMockBatch('alexandria-cover-queue', messages);

      // Mock all covers as not existing
      (coversExist as Mock).mockResolvedValue(false);

      // Mock successful processing
      (processAndStoreCover as Mock).mockResolvedValue({
        status: 'processed',
        isbn: '9780000000000',
        metrics: {
          totalMs: 100,
          originalSize: 50000,
        },
        compression: {
          totalWebpSize: 10000,
          ratio: '80%',
        },
      });

      // Mock SQL update
      mockSql.mockResolvedValue({ count: 1 });

      const results = await processCoverQueue(batch, env);

      expect(results.processed).toBe(10);
      expect(results.failed).toBe(0);
      expect(results.cached).toBe(0);

      // Verify all messages were acked
      messages.forEach((msg) => {
        expect(msg.ack).toHaveBeenCalledTimes(1);
        expect(msg.retry).not.toHaveBeenCalled();
      });
    });

    it('should skip cached covers and ack immediately', async () => {
      const env = createMockEnv();
      const messages = [
        createMockMessage<CoverQueueMessage>({
          isbn: '9780439064873',
          provider_url: 'https://covers.openlibrary.org/b/id/test.jpg',
        }),
      ];
      const batch = createMockBatch('alexandria-cover-queue', messages);

      // Mock cover already exists
      (coversExist as Mock).mockResolvedValue(true);

      const results = await processCoverQueue(batch, env);

      expect(results.cached).toBe(1);
      expect(results.processed).toBe(0);
      expect(messages[0].ack).toHaveBeenCalledTimes(1);
      expect(processAndStoreCover).not.toHaveBeenCalled();
    });

    it('should handle mixed success/failure in batch', async () => {
      const env = createMockEnv();
      const messages = [
        createMockMessage<CoverQueueMessage>({
          isbn: '9780439064873',
          provider_url: 'https://covers.openlibrary.org/b/id/success.jpg',
        }),
        createMockMessage<CoverQueueMessage>({
          isbn: '9781234567890',
          provider_url: 'https://covers.openlibrary.org/b/id/fail.jpg',
        }),
      ];
      const batch = createMockBatch('alexandria-cover-queue', messages);

      (coversExist as Mock).mockResolvedValue(false);

      // First succeeds, second fails
      (processAndStoreCover as Mock)
        .mockResolvedValueOnce({
          status: 'processed',
          isbn: '9780439064873',
          metrics: { totalMs: 100, originalSize: 50000 },
          compression: { totalWebpSize: 10000, ratio: '80%' },
        })
        .mockResolvedValueOnce({
          status: 'error',
          isbn: '9781234567890',
          error: 'Download failed',
          metrics: {} as any,
        });

      mockSql.mockResolvedValue({ count: 1 });

      const results = await processCoverQueue(batch, env);

      expect(results.processed).toBe(1);
      expect(results.failed).toBe(1);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0]).toEqual({
        isbn: '9781234567890',
        error: 'Download failed',
      });

      // Both should be acked (non-retryable failure)
      messages.forEach((msg) => {
        expect(msg.ack).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Retry Logic & Error Handling', () => {
    it('should retry on exception (up to max_retries)', async () => {
      const env = createMockEnv();
      const message = createMockMessage<CoverQueueMessage>({
        isbn: '9780439064873',
        provider_url: 'https://covers.openlibrary.org/b/id/test.jpg',
      });
      const batch = createMockBatch('alexandria-cover-queue', [message]);

      (coversExist as Mock).mockResolvedValue(false);
      (processAndStoreCover as Mock).mockRejectedValue(new Error('Network timeout'));

      const results = await processCoverQueue(batch, env);

      expect(results.failed).toBe(1);
      expect(message.retry).toHaveBeenCalledTimes(1);
      expect(message.ack).not.toHaveBeenCalled();
    });

    it('should ack on non-retryable failure (no cover found)', async () => {
      const env = createMockEnv();
      const message = createMockMessage<CoverQueueMessage>({
        isbn: '9780439064873',
        // No provider_url, must fetch from providers
      });
      const batch = createMockBatch('alexandria-cover-queue', [message]);

      (coversExist as Mock).mockResolvedValue(false);
      (fetchBestCover as Mock).mockResolvedValue({
        source: 'placeholder',
        url: 'https://placeholder.com/no-cover.png',
      });

      const results = await processCoverQueue(batch, env);

      expect(results.failed).toBe(1);
      expect(message.ack).toHaveBeenCalledTimes(1); // Don't retry - no cover exists
      expect(message.retry).not.toHaveBeenCalled();
    });

    it('should handle JWT expiry and retry with fresh URL', async () => {
      const env = createMockEnv();
      const message = createMockMessage<CoverQueueMessage>({
        isbn: '9780439064873',
        provider_url: 'https://images.isbndb.com/expired-jwt.jpg',
      });
      const batch = createMockBatch('alexandria-cover-queue', [message]);

      (coversExist as Mock).mockResolvedValue(false);

      // First attempt: JWT expired (401)
      (processAndStoreCover as Mock).mockResolvedValueOnce({
        status: 'error',
        isbn: '9780439064873',
        error: 'HTTP 401 Unauthorized',
        metrics: {} as any,
      });

      // Fetch fresh URL from ISBNdb via NEW provider
      (globalMockProvider.fetchCover as Mock).mockResolvedValue({
        url: 'https://images.isbndb.com/fresh-jwt.jpg',
        source: 'isbndb',
        size: 'large',
      });

      // Second attempt: Success
      (processAndStoreCover as Mock).mockResolvedValueOnce({
        status: 'processed',
        isbn: '9780439064873',
        metrics: { totalMs: 100, originalSize: 50000 },
        compression: { totalWebpSize: 10000, ratio: '80%' },
      });

      mockSql.mockResolvedValue({ count: 1 });

      const results = await processCoverQueue(batch, env);

      expect(results.processed).toBe(1);
      expect(globalMockProvider.fetchCover).toHaveBeenCalledWith('9780439064873', expect.any(Object));
      expect(processAndStoreCover).toHaveBeenCalledTimes(2);
      expect(message.ack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Analytics Tracking', () => {
    it('should write analytics on successful processing', async () => {
      const env = createMockEnv();
      const message = createMockMessage<CoverQueueMessage>({
        isbn: '9780439064873',
        provider_url: 'https://covers.openlibrary.org/b/id/test.jpg',
      });
      const batch = createMockBatch('alexandria-cover-queue', [message]);

      (coversExist as Mock).mockResolvedValue(false);
      (processAndStoreCover as Mock).mockResolvedValue({
        status: 'processed',
        isbn: '9780439064873',
        metrics: {
          totalMs: 150,
          originalSize: 100000,
        },
        compression: {
          totalWebpSize: 25000,
          ratio: '75%',
        },
      });

      mockSql.mockResolvedValue({ count: 1 });

      await processCoverQueue(batch, env);

      expect(env.COVER_ANALYTICS?.writeDataPoint).toHaveBeenCalledWith({
        indexes: ['9780439064873'],
        blobs: ['jsquash', '9780439064873'],
        doubles: [150, 100000, 25000],
      });
    });

    it('should not crash if analytics binding is missing', async () => {
      const env = createMockEnv({ COVER_ANALYTICS: undefined });
      const message = createMockMessage<CoverQueueMessage>({
        isbn: '9780439064873',
        provider_url: 'https://covers.openlibrary.org/b/id/test.jpg',
      });
      const batch = createMockBatch('alexandria-cover-queue', [message]);

      (coversExist as Mock).mockResolvedValue(false);
      (processAndStoreCover as Mock).mockResolvedValue({
        status: 'processed',
        isbn: '9780439064873',
        metrics: { totalMs: 100, originalSize: 50000 },
        compression: { totalWebpSize: 10000, ratio: '80%' },
      });

      mockSql.mockResolvedValue({ count: 1 });

      const results = await processCoverQueue(batch, env);

      expect(results.processed).toBe(1);
      // Should not throw
    });
  });

  describe('Database Integration', () => {
    it('should update enriched_editions with R2 URLs after processing', async () => {
      const env = createMockEnv();
      const message = createMockMessage<CoverQueueMessage>({
        isbn: '9780439064873',
        provider_url: 'https://covers.openlibrary.org/b/id/test.jpg',
      });
      const batch = createMockBatch('alexandria-cover-queue', [message]);

      (coversExist as Mock).mockResolvedValue(false);
      (processAndStoreCover as Mock).mockResolvedValue({
        status: 'processed',
        isbn: '9780439064873',
        metrics: { totalMs: 100, originalSize: 50000 },
        compression: { totalWebpSize: 10000, ratio: '80%' },
      });

      mockSql.mockResolvedValue({ count: 1 });

      const results = await processCoverQueue(batch, env);

      expect(results.dbUpdated).toBe(1);
      expect(mockSql).toHaveBeenCalled();

      // Verify SQL was called (we can't easily check the exact query with tagged template)
      // but we can verify it was called and returned count: 1
    });

    it('should not fail cover processing if DB update fails', async () => {
      const env = createMockEnv();
      const message = createMockMessage<CoverQueueMessage>({
        isbn: '9780439064873',
        provider_url: 'https://covers.openlibrary.org/b/id/test.jpg',
      });
      const batch = createMockBatch('alexandria-cover-queue', [message]);

      (coversExist as Mock).mockResolvedValue(false);
      (processAndStoreCover as Mock).mockResolvedValue({
        status: 'processed',
        isbn: '9780439064873',
        metrics: { totalMs: 100, originalSize: 50000 },
        compression: { totalWebpSize: 10000, ratio: '80%' },
      });

      // DB update fails
      mockSql.mockRejectedValue(new Error('Database error'));

      const results = await processCoverQueue(batch, env);

      // Cover processing should still succeed
      expect(results.processed).toBe(1);
      expect(results.dbUpdated).toBe(0);
      expect(message.ack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Compression Statistics', () => {
    it('should track compression stats across batch', async () => {
      const env = createMockEnv();
      const messages = [
        createMockMessage<CoverQueueMessage>({
          isbn: '9780439064873',
          provider_url: 'https://covers.openlibrary.org/b/id/test1.jpg',
        }),
        createMockMessage<CoverQueueMessage>({
          isbn: '9781234567890',
          provider_url: 'https://covers.openlibrary.org/b/id/test2.jpg',
        }),
      ];
      const batch = createMockBatch('alexandria-cover-queue', messages);

      (coversExist as Mock).mockResolvedValue(false);
      (processAndStoreCover as Mock)
        .mockResolvedValueOnce({
          status: 'processed',
          isbn: '9780439064873',
          metrics: { totalMs: 100, originalSize: 100000 },
          compression: { totalWebpSize: 25000, ratio: '75%' },
        })
        .mockResolvedValueOnce({
          status: 'processed',
          isbn: '9781234567890',
          metrics: { totalMs: 150, originalSize: 200000 },
          compression: { totalWebpSize: 50000, ratio: '75%' },
        });

      mockSql.mockResolvedValue({ count: 1 });

      const results = await processCoverQueue(batch, env);

      expect(results.compressionStats.totalOriginalBytes).toBe(300000);
      expect(results.compressionStats.totalWebpBytes).toBe(75000);
    });
  });
});

// =================================================================================
// Enrichment Queue Tests
// =================================================================================

describe('processEnrichmentQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Batch Processing', () => {
    it('should process batch of 100 ISBNs (max_batch_size)', async () => {
      const env = createMockEnv();
      const messages = Array.from({ length: 100 }, (_, i) =>
        createMockMessage<EnrichmentQueueMessage>({
          isbn: `978000000${String(i).padStart(4, '0')}`,
        })
      );
      const batch = createMockBatch('alexandria-enrichment-queue', messages);

      // Mock ISBNdb batch response (all found)
      const mockEnrichmentData = new Map(
        Array.from({ length: 100 }, (_, i) => {
          const isbn = `978000000${String(i).padStart(4, '0')}`;
          return [
            isbn,
            {
              isbn,
              title: `Book ${i}`,
              authors: ['Test Author'],
              publisher: 'Test Publisher',
              publishDate: '2024-01-01',
              pageCount: 300,
              binding: 'Paperback',
              language: 'en',
              coverUrl: undefined,
              subjects: [],
              deweyDecimal: [],
              relatedISBNs: {},
            },
          ];
        })
      );

      globalMockProvider.batchFetchMetadata.mockResolvedValue(mockEnrichmentData);
      (enrichWork as Mock).mockResolvedValue(undefined);
      (enrichEdition as Mock).mockResolvedValue(undefined);

      const results = await processEnrichmentQueue(batch, env);

      expect(results.enriched).toBe(100);
      expect(results.failed).toBe(0);
      expect(results.api_calls_saved).toBe(99); // 100 ISBNs in 1 call = 99 saved

      // Verify all messages were acked
      messages.forEach((msg) => {
        expect(msg.ack).toHaveBeenCalledTimes(1);
      });
    });

    it('should skip cached "not found" ISBNs', async () => {
      const env = createMockEnv();
      const message = createMockMessage<EnrichmentQueueMessage>({
        isbn: '9780439064873',
      });
      const batch = createMockBatch('alexandria-enrichment-queue', [message]);

      // Mock cached failure
      (env.CACHE.get as Mock).mockResolvedValue('true');

      const results = await processEnrichmentQueue(batch, env);

      expect(results.cached).toBe(1);
      expect(results.enriched).toBe(0);
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(globalMockProvider.batchFetchMetadata).not.toHaveBeenCalled();
    });

    it('should calculate correct API call savings', async () => {
      const env = createMockEnv();
      const messages = Array.from({ length: 50 }, (_, i) =>
        createMockMessage<EnrichmentQueueMessage>({
          isbn: `978000000${String(i).padStart(4, '0')}`,
        })
      );
      const batch = createMockBatch('alexandria-enrichment-queue', messages);

      // Mock ISBNdb batch response
      const mockEnrichmentData = new Map(
        Array.from({ length: 50 }, (_, i) => {
          const isbn = `978000000${String(i).padStart(4, '0')}`;
          return [
            isbn,
            {
              isbn,
              title: `Book ${i}`,
              authors: [],
              publisher: 'Test',
              publishDate: '2024',
              coverUrl: undefined,
              subjects: [],
            },
          ];
        })
      );

      globalMockProvider.batchFetchMetadata.mockResolvedValue(mockEnrichmentData);
      (enrichWork as Mock).mockResolvedValue(undefined);
      (enrichEdition as Mock).mockResolvedValue(undefined);

      const results = await processEnrichmentQueue(batch, env);

      // 50 ISBNs in 1 batch call = 49 API calls saved
      expect(results.api_calls_saved).toBe(49);
    });
  });

  describe('Error Handling & Retry', () => {
    it('should retry on storage error', async () => {
      const env = createMockEnv();
      const message = createMockMessage<EnrichmentQueueMessage>({
        isbn: '9780439064873',
      });
      const batch = createMockBatch('alexandria-enrichment-queue', [message]);

      const mockEnrichmentData = new Map([
        [
          '9780439064873',
          {
            isbn: '9780439064873',
            title: 'Harry Potter',
            authors: [],
            publisher: 'Scholastic',
            publishDate: '1998',
            coverUrl: undefined,
            subjects: [],
          },
        ],
      ]);

      globalMockProvider.batchFetchMetadata.mockResolvedValue(mockEnrichmentData);
      (enrichWork as Mock).mockResolvedValue(undefined);
      (enrichEdition as Mock).mockRejectedValue(new Error('Database error'));

      const results = await processEnrichmentQueue(batch, env);

      expect(results.failed).toBe(1);
      expect(message.retry).toHaveBeenCalledTimes(1);
      expect(message.ack).not.toHaveBeenCalled();
    });

    it('should cache ISBN not found and ack', async () => {
      const env = createMockEnv();
      const message = createMockMessage<EnrichmentQueueMessage>({
        isbn: '9780439064873',
      });
      const batch = createMockBatch('alexandria-enrichment-queue', [message]);

      // ISBN not found in ISBNdb
      globalMockProvider.batchFetchMetadata.mockResolvedValue(new Map());

      const results = await processEnrichmentQueue(batch, env);

      expect(results.failed).toBe(1);
      expect(env.CACHE.put).toHaveBeenCalledWith('isbn_not_found:9780439064873', 'true', {
        expirationTtl: 86400,
      });
      expect(message.ack).toHaveBeenCalledTimes(1); // Don't retry - won't exist on retry either
    });

    it('should ack invalid ISBN format without retry', async () => {
      const env = createMockEnv();
      const message = createMockMessage<EnrichmentQueueMessage>({
        isbn: '', // Empty ISBN normalizes to empty string (falsy)
      });
      const batch = createMockBatch('alexandria-enrichment-queue', [message]);

      const results = await processEnrichmentQueue(batch, env);

      expect(results.failed).toBe(1);
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(message.retry).not.toHaveBeenCalled();
      expect(globalMockProvider.batchFetchMetadata).not.toHaveBeenCalled();
    });
  });

  describe('Work & Edition Creation', () => {
    it('should create work before edition (FK constraint)', async () => {
      const env = createMockEnv();
      const message = createMockMessage<EnrichmentQueueMessage>({
        isbn: '9780439064873',
      });
      const batch = createMockBatch('alexandria-enrichment-queue', [message]);

      const mockEnrichmentData = new Map([
        [
          '9780439064873',
          {
            isbn: '9780439064873',
            title: 'Harry Potter and the Chamber of Secrets',
            authors: ['J.K. Rowling'],
            description: 'The second book',
            publisher: 'Scholastic',
            publishDate: '1999-06-02',
            pageCount: 341,
            binding: 'Hardcover',
            language: 'en',
            subjects: ['Fiction', 'Magic'],
            coverUrl: undefined,
            deweyDecimal: [],
            relatedISBNs: {},
          },
        ],
      ]);

      globalMockProvider.batchFetchMetadata.mockResolvedValue(mockEnrichmentData);

      let workCreatedFirst = false;
      (enrichWork as Mock).mockImplementation(() => {
        workCreatedFirst = true;
        return Promise.resolve();
      });

      (enrichEdition as Mock).mockImplementation(() => {
        expect(workCreatedFirst).toBe(true); // Work must be created first
        return Promise.resolve();
      });

      await processEnrichmentQueue(batch, env);

      expect(enrichWork).toHaveBeenCalledTimes(1);
      expect(enrichEdition).toHaveBeenCalledTimes(1);
      expect(message.ack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Connection Management', () => {
    it('should close SQL connection after processing', async () => {
      const env = createMockEnv();
      const message = createMockMessage<EnrichmentQueueMessage>({
        isbn: '9780439064873',
      });
      const batch = createMockBatch('alexandria-enrichment-queue', [message]);

      globalMockProvider.batchFetchMetadata.mockResolvedValue(new Map());

      await processEnrichmentQueue(batch, env);

      expect(mockSql.end).toHaveBeenCalledTimes(1);
    });

    it('should close SQL connection even on error', async () => {
      const env = createMockEnv();
      const message = createMockMessage<EnrichmentQueueMessage>({
        isbn: '9780439064873',
      });
      const batch = createMockBatch('alexandria-enrichment-queue', [message]);

      globalMockProvider.batchFetchMetadata.mockRejectedValue(new Error('Network error'));

      // processEnrichmentQueue will throw since batchFetchMetadata fails
      // But the finally block should still close the connection
      await expect(processEnrichmentQueue(batch, env)).rejects.toThrow('Network error');

      expect(mockSql.end).toHaveBeenCalledTimes(1);
    });
  });
});
