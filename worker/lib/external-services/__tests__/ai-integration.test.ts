/**
 * AI Integration Test Suite
 *
 * Dedicated integration tests for AI book generation providers (Gemini, Xai/Grok).
 * These tests require real KV bindings for API keys and are separate from Sprint 0
 * to avoid mock environment limitations.
 *
 * **Prerequisites**:
 * - Real Cloudflare Worker environment (not mocked)
 * - GEMINI_API_KEY and XAI_API_KEY configured in wrangler.toml
 * - Run with: npm run test:integration
 *
 * @module lib/external-services/__tests__/ai-integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  ServiceProviderRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from '../provider-registry.js';
import { ServiceCapability } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { BookGenerationOrchestrator } from '../orchestrators/book-generation-orchestrator.js';
import { GeminiProvider } from '../providers/gemini-provider.js';
import { XaiProvider } from '../providers/xai-provider.js';
import { areTitlesSimilar } from '../../utils/string-similarity.js';

// =================================================================================
// Test Configuration
// =================================================================================

/**
 * AI Generation Test Prompts
 * Diverse historical periods for maximum variety
 */
const AI_TEST_PROMPTS = [
  'Significant books published in January 2020',
  'Classic science fiction from the 1960s',
];

// =================================================================================
// Environment Setup
// =================================================================================

/**
 * Create integration test environment with real KV bindings
 *
 * IMPORTANT: This requires actual Cloudflare bindings.
 * Use getMiniflareBindings() or real Worker environment.
 */
function createIntegrationEnv(): Env {
  // This will be populated by Miniflare or real Worker runtime
  // For now, we'll throw if bindings aren't available
  if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) {
    throw new Error(
      'AI integration tests require GEMINI_API_KEY or XAI_API_KEY environment variables. ' +
      'Run with: GEMINI_API_KEY=xxx XAI_API_KEY=yyy npm run test:integration'
    );
  }

  return {
    // Mock KV-style API key access
    GEMINI_API_KEY: {
      get: async () => process.env.GEMINI_API_KEY || null,
    } as any,
    XAI_API_KEY: {
      get: async () => process.env.XAI_API_KEY || null,
    } as any,
    // Other bindings can be mocked or omitted for AI-only tests
  } as Env;
}

function createIntegrationContext(env: Env): ServiceContext {
  return {
    env,
    logger: {
      debug: (msg: string, meta?: any) => console.log(`[DEBUG] ${msg}`, meta),
      info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta),
      warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta),
      error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta),
    } as any,
    cacheStrategy: 'disabled',
    rateLimitStrategy: 'disabled',
  };
}

// =================================================================================
// Test Suite
// =================================================================================

describe('AI Integration Tests - Book Generation', () => {
  let registry: ServiceProviderRegistry;
  let context: ServiceContext;
  let env: Env;

  beforeAll(() => {
    // Setup registry with AI providers
    resetGlobalRegistry();
    registry = getGlobalRegistry();

    registry.registerAll([
      new GeminiProvider(),
      new XaiProvider(),
    ]);

    // Create integration context with real bindings
    env = createIntegrationEnv();
    context = createIntegrationContext(env);
  });

  describe('Provider Availability', () => {
    it('should detect Gemini availability based on API key', async () => {
      const provider = registry.get('gemini');
      expect(provider).toBeDefined();

      const isAvailable = await provider!.isAvailable(env);
      console.log(`Gemini available: ${isAvailable}`);

      // Test passes if API key is configured, otherwise skip
      if (process.env.GEMINI_API_KEY) {
        expect(isAvailable).toBe(true);
      } else {
        console.log('⏭️  Skipping Gemini test - no API key configured');
      }
    });

    it('should detect Xai (Grok) availability based on API key', async () => {
      const provider = registry.get('xai');
      expect(provider).toBeDefined();

      const isAvailable = await provider!.isAvailable(env);
      console.log(`Xai (Grok) available: ${isAvailable}`);

      // Test passes if API key is configured, otherwise skip
      if (process.env.XAI_API_KEY) {
        expect(isAvailable).toBe(true);
      } else {
        console.log('⏭️  Skipping Xai test - no API key configured');
      }
    });
  });

  describe('Individual Provider Generation', () => {
    it('should generate books with Gemini provider', async () => {
      const provider = registry.get('gemini') as any;
      expect(provider).toBeDefined();

      const isAvailable = await provider.isAvailable(env);
      if (!isAvailable) {
        console.log('⏭️  Skipping Gemini generation test - provider not available');
        return;
      }

      const prompt = AI_TEST_PROMPTS[0];
      const result = await provider.generateBooks(prompt, 5, context);

      console.log(`Gemini generated ${result.length} books`);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(5);

      // Validate book structure
      result.forEach((book: any) => {
        expect(book.title).toBeDefined();
        expect(book.author).toBeDefined();
        expect(typeof book.title).toBe('string');
        expect(typeof book.author).toBe('string');
      });
    }, 60000); // 60s timeout for AI generation

    it('should generate books with Xai (Grok) provider', async () => {
      const provider = registry.get('xai') as any;
      expect(provider).toBeDefined();

      const isAvailable = await provider.isAvailable(env);
      if (!isAvailable) {
        console.log('⏭️  Skipping Xai generation test - provider not available');
        return;
      }

      const prompt = AI_TEST_PROMPTS[1];
      const result = await provider.generateBooks(prompt, 5, context);

      console.log(`Xai (Grok) generated ${result.length} books`);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(5);

      // Validate book structure
      result.forEach((book: any) => {
        expect(book.title).toBeDefined();
        expect(book.author).toBeDefined();
        expect(typeof book.title).toBe('string');
        expect(typeof book.author).toBe('string');
      });
    }, 60000); // 60s timeout for AI generation
  });

  describe('Concurrent Generation with Deduplication', () => {
    it('should generate books concurrently from both providers and deduplicate', async () => {
      // Check provider availability
      const geminiAvailable = await registry.get('gemini')?.isAvailable(env);
      const xaiAvailable = await registry.get('xai')?.isAvailable(env);

      if (!geminiAvailable && !xaiAvailable) {
        console.log('⏭️  Skipping concurrent test - no AI providers available');
        return;
      }

      const orchestrator = new BookGenerationOrchestrator(registry, {
        enableLogging: true,
        providerTimeoutMs: 60000,
        concurrentExecution: true, // Run both providers in parallel
        deduplicationThreshold: 0.6, // 60% title similarity
      });

      const prompt = AI_TEST_PROMPTS[0];
      const startTime = Date.now();

      const results = await orchestrator.generateBooks(
        prompt,
        10, // Request 10 books per provider
        context
      );

      const duration = Date.now() - startTime;

      console.log(`
=== Concurrent AI Generation Results ===
Duration: ${duration}ms
Total books generated: ${results.length}
Gemini available: ${geminiAvailable}
Xai available: ${xaiAvailable}
      `);

      // Validation
      expect(results.length).toBeGreaterThan(0); // At least some books generated
      expect(duration).toBeLessThan(120000); // Should complete within 2 minutes

      // Check for duplicates (deduplication should have removed them)
      const titles = results.map((b: any) => b.title.toLowerCase());
      const uniqueTitles = new Set(titles);

      console.log(`Unique titles: ${uniqueTitles.size} / ${titles.length}`);

      // Allow for some similarity but not exact duplicates
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          const similar = areTitlesSimilar(results[i].title, results[j].title, 0.9);
          if (similar) {
            console.warn(
              `⚠️  High similarity detected: "${results[i].title}" vs "${results[j].title}"`
            );
          }
          expect(similar).toBe(false); // No near-duplicates at 90% threshold
        }
      }

      // Validate book structure
      results.forEach((book: any) => {
        expect(book.title).toBeDefined();
        expect(book.author).toBeDefined();
        expect(book.source).toBeDefined(); // Should have provider source
      });
    }, 120000); // 120s timeout for concurrent generation
  });

  describe('Error Handling', () => {
    it('should handle invalid prompts gracefully', async () => {
      const provider = registry.get('gemini') as any;
      if (!provider || !(await provider.isAvailable(env))) {
        console.log('⏭️  Skipping error handling test - Gemini not available');
        return;
      }

      const result = await provider.generateBooks('', 5, context);
      console.log(`Empty prompt result: ${result.length} books`);

      // Should return empty array or handle gracefully, not throw
      expect(Array.isArray(result)).toBe(true);
    }, 30000);

    it('should handle excessive book count requests', async () => {
      const provider = registry.get('gemini') as any;
      if (!provider || !(await provider.isAvailable(env))) {
        console.log('⏭️  Skipping error handling test - Gemini not available');
        return;
      }

      // Test with 50 books (excessive but completable within timeout)
      // Real production limits should be enforced at orchestrator/API level
      const result = await provider.generateBooks(AI_TEST_PROMPTS[0], 50, context);
      console.log(`Large count result: ${result.length} books`);

      // Should generate requested books or return what it can
      expect(result.length).toBeGreaterThanOrEqual(0);
      expect(result.length).toBeLessThanOrEqual(50);
    }, 60000);
  });
});
