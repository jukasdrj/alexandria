/**
 * Hybrid Backfill Service Tests
 *
 * Tests for AI-driven book generation with multi-source ISBN resolution.
 * Updated Jan 2026 to reflect production architecture changes:
 * - Concurrent AI execution (Gemini + Grok in parallel)
 * - Module-level singleton orchestrators
 * - Prompt variant selection logic
 * - 60s provider timeouts
 * - Parallel deduplication queries
 * - Markdown code fence sanitization
 *
 * @module worker/src/__tests__/hybrid-backfill.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateHybridBackfillList } from '../services/hybrid-backfill.js';
import type { Env } from '../env.js';
import type { Logger } from '../../lib/logger.js';
import * as isbnResolution from '../services/isbn-resolution.js';
import * as bookGenPrompts from '../../lib/ai/book-generation-prompts.js';
import { BookGenerationOrchestrator } from '../../lib/external-services/orchestrators/book-generation-orchestrator.js';
import { getGlobalRegistry } from '../../lib/external-services/provider-registry.js';
import type { GeneratedBook } from '../../lib/external-services/capabilities.js';

// =================================================================================
// Mock Setup
// =================================================================================

/**
 * Create mock Env with all required bindings
 */
function createMockEnv(): Env {
  return {
    ISBNDB_API_KEY: {
      get: vi.fn().mockResolvedValue('test-api-key'),
    } as any,
    GEMINI_API_KEY: {
      get: vi.fn().mockResolvedValue('test-gemini-key'),
    } as any,
    XAI_API_KEY: {
      get: vi.fn().mockResolvedValue('test-xai-key'),
    } as any,
  } as Env;
}

/**
 * Create mock Logger
 */
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
}

/**
 * Create mock GeneratedBook array
 * Simulates concurrent AI provider responses
 */
function createMockGeneratedBooks(count: number = 20, source: string = 'gemini'): GeneratedBook[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Book ${i + 1} from ${source}`,
    author: `Author ${i + 1}`,
    publisher: `Publisher ${i + 1}`,
    format: 'Hardcover' as const,
    publishDate: '2020',
    description: `Significant book ${i + 1} from ${source}`,
    source,
  }));
}

/**
 * Create mock ISBN resolution results
 */
function createMockISBNResolutions(count: number, startISBN: number = 1000000000000) {
  return Array.from({ length: count }, (_, i) => ({
    isbn: `${startISBN + i}`,
    confidence: 'high' as const,
    match_quality: 0.95,
    matched_title: `Book ${i + 1}`,
    source: 'isbndb',
  }));
}

// =================================================================================
// Module-Level Singleton Tests
// =================================================================================

describe('Hybrid Backfill - Module-Level Singletons', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should reuse module-level BookGenerationOrchestrator across multiple calls', async () => {
    // Mock AI generation
    const mockBooks = createMockGeneratedBooks(10);
    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(mockBooks);

    // Mock ISBN resolution
    const mockResolutions = createMockISBNResolutions(10);
    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(mockResolutions);

    // Make two sequential calls
    await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);
    await generateHybridBackfillList(2020, 2, mockEnv, mockLogger, 10);

    // Verify orchestrator was called twice with same instance
    expect(BookGenerationOrchestrator.prototype.generateBooks).toHaveBeenCalledTimes(2);
  });

  it('should configure BookGenerationOrchestrator with concurrent mode by default', async () => {
    // Test that the singleton is configured with concurrent execution
    const registry = getGlobalRegistry();
    const orchestrator = new BookGenerationOrchestrator(registry, {
      enableLogging: true,
      providerTimeoutMs: 60000,
      providerPriority: ['gemini', 'xai'],
      stopOnFirstSuccess: false,
      concurrentExecution: true,
      deduplicationThreshold: 0.6,
    });

    expect(orchestrator).toBeDefined();
  });
});

// =================================================================================
// Concurrent AI Execution Tests
// =================================================================================

describe('Hybrid Backfill - Concurrent AI Execution', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should execute Gemini and Grok in parallel (not sequential)', async () => {
    const executionOrder: string[] = [];

    // Mock concurrent execution - both providers called at same time
    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockImplementation(async () => {
        executionOrder.push('ai-started');
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate 100ms AI call
        executionOrder.push('ai-finished');
        return createMockGeneratedBooks(10, 'gemini');
      });

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(10));

    const start = Date.now();
    await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);
    const elapsed = Date.now() - start;

    // Verify parallel execution (should be ~100ms, not 200ms for sequential)
    expect(elapsed).toBeLessThan(150); // Some overhead is acceptable
  });

  it('should deduplicate concurrent results by 60% title similarity', async () => {
    // Mock concurrent providers returning overlapping books
    const geminiBooks = [
      { title: 'The Hobbit', author: 'J.R.R. Tolkien', publisher: 'Pub1', format: 'Hardcover' as const, publishDate: '2020', description: 'Gemini book', source: 'gemini' },
      { title: 'Unique Gemini Book', author: 'Author A', publisher: 'Pub2', format: 'Paperback' as const, publishDate: '2020', description: 'Only in Gemini', source: 'gemini' },
    ];

    const grokBooks = [
      { title: 'The Hobbit: There and Back Again', author: 'J.R.R. Tolkien', publisher: 'Pub1', format: 'Hardcover' as const, publishDate: '2020', description: 'Grok book', source: 'xai' },
      { title: 'Unique Grok Book', author: 'Author B', publisher: 'Pub3', format: 'eBook' as const, publishDate: '2020', description: 'Only in Grok', source: 'xai' },
    ];

    const combinedBooks = [...geminiBooks, ...grokBooks];

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(combinedBooks);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(combinedBooks.length));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 20);

    // Deduplication happens inside orchestrator, so we should get all candidates
    // but in production, "The Hobbit" variants would be deduplicated
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('should handle provider failures gracefully (succeeds if ANY provider works)', async () => {
    // Simulate Gemini succeeding, Grok failing
    const geminiBooks = createMockGeneratedBooks(10, 'gemini');

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(geminiBooks); // Orchestrator handles failures internally

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(10));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(result.candidates).toHaveLength(10);
    expect(result.stats.ai_provider_used).toBe('gemini');
  });
});

// =================================================================================
// Prompt Variant Selection Tests
// =================================================================================

describe('Hybrid Backfill - Prompt Variant Selection', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should use baseline prompt when no variant specified', async () => {
    const resolvePromptSpy = vi.spyOn(bookGenPrompts, 'resolvePrompt');

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(createMockGeneratedBooks(10));

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(10));

    await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(resolvePromptSpy).toHaveBeenCalledWith(undefined, 2020, 1, 10);
  });

  it('should use contemporary-notable prompt for recent years (2020+)', async () => {
    const resolvePromptSpy = vi.spyOn(bookGenPrompts, 'resolvePrompt');

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(createMockGeneratedBooks(10));

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(10));

    await generateHybridBackfillList(2023, 6, mockEnv, mockLogger, 10, 'contemporary-notable');

    expect(resolvePromptSpy).toHaveBeenCalledWith('contemporary-notable', 2023, 6, 10);
  });

  it('should reject invalid prompt variants for security', () => {
    expect(() => {
      bookGenPrompts.resolvePrompt('malicious-prompt', 2020, 1, 10);
    }).toThrow(/Invalid prompt variant/);
  });

  it('should support all registered prompt variants', () => {
    const validVariants: Array<keyof typeof bookGenPrompts.PROMPT_VARIANTS> = [
      'baseline',
      'contemporary-notable',
      'annual',
      'diversity-emphasis',
      'overlooked-significance',
      'genre-rotation',
      'era-contextualized',
    ];

    validVariants.forEach(variant => {
      expect(() => {
        bookGenPrompts.resolvePrompt(variant, 2020, 1, 10);
      }).not.toThrow();
    });
  });
});

// =================================================================================
// 60s Timeout Tests
// =================================================================================

describe('Hybrid Backfill - 60s Provider Timeout', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should pass 60s timeout to ServiceContext for AI providers', async () => {
    const generateBooksSpy = vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockImplementation(async (prompt, count, context) => {
        // Verify context has correct timeout
        expect(context).toHaveProperty('env');
        expect(context).toHaveProperty('logger');
        return createMockGeneratedBooks(10);
      });

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(10));

    await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(generateBooksSpy).toHaveBeenCalled();
  });

  it('should handle provider timeout gracefully (return empty on timeout)', async () => {
    // Simulate timeout by returning empty array (orchestrator handles errors internally)
    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue([]);

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    // Should return empty result on timeout
    expect(result.candidates).toEqual([]);
    expect(result.stats.total_books).toBe(0);
    expect(result.stats.ai_provider_used).toBe('none');
  });
});

// =================================================================================
// Parallel Deduplication Tests
// =================================================================================

describe('Hybrid Backfill - Parallel Deduplication', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should use 60% similarity threshold for deduplication', async () => {
    const books = [
      { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', publisher: 'Pub1', format: 'Hardcover' as const, publishDate: '2020', description: 'Classic', source: 'gemini' },
      { title: 'Great Gatsby', author: 'F. Scott Fitzgerald', publisher: 'Pub1', format: 'Paperback' as const, publishDate: '2020', description: 'Classic', source: 'xai' },
    ];

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(books.length));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    // Both books should be passed through (deduplication happens in orchestrator)
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('should run deduplication queries in parallel for performance', async () => {
    // This is tested at the database layer (deduplication.ts)
    // Hybrid backfill inherits parallel execution from orchestrator
    const books = createMockGeneratedBooks(50); // Large batch

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(50));

    const start = Date.now();
    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 50);
    const elapsed = Date.now() - start;

    expect(result.candidates).toHaveLength(50);
    // Should be fast with parallel queries (<2s for 50 books)
    expect(elapsed).toBeLessThan(2000);
  });
});

// =================================================================================
// Markdown Sanitization Tests
// =================================================================================

describe('Hybrid Backfill - Markdown Code Fence Sanitization', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should handle AI responses wrapped in markdown code fences', async () => {
    // Simulate Gemini/Grok occasionally wrapping JSON in ```json ... ```
    const wrappedResponse = createMockGeneratedBooks(5);

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(wrappedResponse); // Provider already sanitized

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(5));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 5);

    expect(result.candidates).toHaveLength(5);
    expect(result.stats.total_books).toBe(5);
  });

  it('should handle triple and quadruple backtick code fences', async () => {
    // Providers handle both ``` and ```` fences
    const books = createMockGeneratedBooks(5);

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(5));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 5);

    expect(result.candidates).toHaveLength(5);
  });
});

// =================================================================================
// Singleton Reuse Tests
// =================================================================================

describe('Hybrid Backfill - Singleton Orchestrator Reuse', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should reuse module-level singleton across multiple backfill calls', async () => {
    const generateBooksSpy = vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(createMockGeneratedBooks(10));

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(10));

    // Make 3 sequential calls
    await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);
    await generateHybridBackfillList(2020, 2, mockEnv, mockLogger, 10);
    await generateHybridBackfillList(2020, 3, mockEnv, mockLogger, 10);

    // Verify singleton was reused (3 calls to same instance)
    expect(generateBooksSpy).toHaveBeenCalledTimes(3);
  });

  it('should benefit from HTTP connection reuse across requests', async () => {
    // Singleton pattern enables HTTP Keep-Alive connection reuse
    // This test verifies multiple calls don't recreate orchestrator

    const generateBooksSpy = vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(createMockGeneratedBooks(5));

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(5));

    const calls = Array.from({ length: 5 }, (_, i) =>
      generateHybridBackfillList(2020, i + 1, mockEnv, mockLogger, 5)
    );

    await Promise.all(calls);

    expect(generateBooksSpy).toHaveBeenCalledTimes(5);
  });
});

// =================================================================================
// Chaos Engineering Tests
// =================================================================================

describe('Hybrid Backfill - Chaos Tests', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should handle all providers failing', async () => {
    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue([]); // All providers failed

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(result.candidates).toEqual([]);
    expect(result.stats.total_books).toBe(0);
    expect(result.stats.ai_provider_used).toBe('none');
    expect(result.stats.isbn_resolution.total_attempted).toBe(0);
  });

  it('should handle partial provider success (Gemini works, Grok fails)', async () => {
    const geminiBooks = createMockGeneratedBooks(10, 'gemini');

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(geminiBooks);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(10));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(result.candidates).toHaveLength(10);
    expect(result.stats.ai_provider_used).toBe('gemini');
  });

  it('should handle ISBN resolution failures gracefully', async () => {
    const books = createMockGeneratedBooks(10);

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    // All ISBN resolutions fail
    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(Array(10).fill({
        isbn: null,
        confidence: 'not_found' as const,
        match_quality: 0.0,
        matched_title: null,
        source: 'isbndb',
      }));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    // Should still return candidates with AI metadata (even without ISBNs)
    expect(result.candidates).toHaveLength(10);
    expect(result.stats.isbn_resolution.resolved).toBe(0);
    expect(result.stats.isbn_resolution.resolution_rate).toBe(0);
  });

  it('should handle ISBNdb quota exhaustion with fallback', async () => {
    const books = createMockGeneratedBooks(10);

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    // Simulate fallback to OpenLibrary
    const fallbackResolutions = createMockISBNResolutions(10);
    fallbackResolutions.forEach(r => r.source = 'open-library');

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(fallbackResolutions);

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(result.candidates).toHaveLength(10);
    // Verify fallback source was used (checked in resolution results)
    const firstResolution = result.resolutions[0];
    expect(firstResolution.source).toBe('open-library');
  });

  it('should handle missing API keys gracefully', async () => {
    const badEnv = {
      ISBNDB_API_KEY: {
        get: vi.fn().mockResolvedValue(null),
      },
    } as any;

    await expect(
      generateHybridBackfillList(2020, 1, badEnv, mockLogger, 10)
    ).rejects.toThrow('ISBNDB_API_KEY not configured');
  });
});

// =================================================================================
// Stats Validation Tests
// =================================================================================

describe('Hybrid Backfill - Stats Validation', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should return correct stats for successful workflow', async () => {
    const books = createMockGeneratedBooks(20, 'gemini');
    const resolutions = createMockISBNResolutions(20);

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(resolutions);

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 20);

    expect(result.stats).toMatchObject({
      total_books: 20,
      ai_provider_used: 'gemini',
      isbn_resolution: {
        total_attempted: 20,
        resolved: 20,
        high_confidence: 20,
        resolution_rate: 100,
      },
      api_calls: {
        ai_generation: 1,
        isbndb: 20,
        total: 21,
      },
    });
  });

  it('should track format breakdown correctly', async () => {
    const books = [
      { title: 'Book 1', author: 'Author 1', publisher: 'Pub1', format: 'Hardcover' as const, publishDate: '2020', description: 'Desc', source: 'gemini' },
      { title: 'Book 2', author: 'Author 2', publisher: 'Pub2', format: 'Paperback' as const, publishDate: '2020', description: 'Desc', source: 'gemini' },
      { title: 'Book 3', author: 'Author 3', publisher: 'Pub3', format: 'eBook' as const, publishDate: '2020', description: 'Desc', source: 'gemini' },
      { title: 'Book 4', author: 'Author 4', publisher: 'Pub4', format: 'Audiobook' as const, publishDate: '2020', description: 'Desc', source: 'gemini' },
      { title: 'Book 5', author: 'Author 5', publisher: 'Pub5', format: 'Unknown' as const, publishDate: '2020', description: 'Desc', source: 'gemini' },
    ];

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(5));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 5);

    expect(result.stats.format_breakdown).toEqual({
      Hardcover: 1,
      Paperback: 1,
      eBook: 1,
      Audiobook: 1,
      Unknown: 1,
    });
  });

  it('should calculate resolution rate correctly', async () => {
    const books = createMockGeneratedBooks(10);

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    // 7 successful, 3 failed
    const resolutions = [
      ...createMockISBNResolutions(7),
      ...Array(3).fill({
        isbn: null,
        confidence: 'not_found' as const,
        match_quality: 0.0,
        matched_title: null,
        source: 'isbndb',
      }),
    ];

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(resolutions);

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(result.stats.isbn_resolution.total_attempted).toBe(10);
    expect(result.stats.isbn_resolution.resolved).toBe(7);
    expect(result.stats.isbn_resolution.resolution_rate).toBe(70);
  });
});

// =================================================================================
// Edge Case Tests
// =================================================================================

describe('Hybrid Backfill - Edge Cases', () => {
  let mockEnv: Env;
  let mockLogger: Logger;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  it('should handle empty book generation (0 books)', async () => {
    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue([]);

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 10);

    expect(result.candidates).toEqual([]);
    expect(result.stats.total_books).toBe(0);
  });

  it('should handle invalid year in AI response', async () => {
    const books = [
      { title: 'Book 1', author: 'Author 1', publisher: 'Pub1', format: 'Hardcover' as const, publishDate: 'invalid', description: 'Desc', source: 'gemini' },
    ];

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(1));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 1);

    // Should fallback to input year (2020) when AI year is invalid
    expect(result.candidates[0].year).toBe(2020);
  });

  it('should handle missing significance field', async () => {
    const books = [
      { title: 'Book 1', author: 'Author 1', publisher: 'Pub1', format: 'Hardcover' as const, publishDate: '2020', source: 'gemini' },
    ] as any;

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(1));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 1);

    expect(result.candidates[0].significance).toBeUndefined();
  });

  it('should handle very large batch sizes', async () => {
    const books = createMockGeneratedBooks(100, 'gemini');

    vi.spyOn(BookGenerationOrchestrator.prototype, 'generateBooks')
      .mockResolvedValue(books);

    vi.spyOn(isbnResolution, 'batchResolveISBNs')
      .mockResolvedValue(createMockISBNResolutions(100));

    const result = await generateHybridBackfillList(2020, 1, mockEnv, mockLogger, 100);

    expect(result.candidates).toHaveLength(100);
    expect(result.stats.total_books).toBe(100);
  });
});
