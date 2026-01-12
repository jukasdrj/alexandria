/**
 * AI Comparison Test Routes
 *
 * Compare responses from different AI providers (Gemini vs x.ai Grok)
 * for book metadata generation tasks.
 *
 * @module routes/ai-comparison
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import { GeminiProvider } from '../../lib/external-services/providers/gemini-provider.js';
import { XaiProvider } from '../../lib/external-services/providers/xai-provider.js';
import { createServiceContext } from '../../lib/external-services/service-context.js';

// =================================================================================
// Schemas
// =================================================================================

const ComparisonRequestSchema = z.object({
  prompt: z.string().min(10).max(500).openapi({
    description: 'Prompt for book generation (e.g., "significant books published in January 2020")',
    example: 'significant science fiction books published in 2020',
  }),
  count: z.number().int().min(1).max(20).default(5).openapi({
    description: 'Number of books to generate',
    example: 5,
  }),
}).openapi('AIComparisonRequest');

const GeneratedBookSchema = z.object({
  title: z.string(),
  author: z.string(),
  publisher: z.string().optional(),
  publishDate: z.string(),
  description: z.string().optional(),
  confidence: z.number(),
  source: z.string(),
}).openapi('GeneratedBook');

const ComparisonResultSchema = z.object({
  prompt: z.string(),
  count: z.number(),
  gemini: z.object({
    books: z.array(GeneratedBookSchema),
    duration_ms: z.number(),
    model: z.string().default('gemini-2.5-flash'),
    error: z.string().optional(),
  }),
  xai: z.object({
    books: z.array(GeneratedBookSchema),
    duration_ms: z.number(),
    model: z.string().default('grok-beta'),
    error: z.string().optional(),
  }),
  analysis: z.object({
    gemini_count: z.number(),
    xai_count: z.number(),
    gemini_faster: z.boolean(),
    speed_difference_ms: z.number(),
    unique_titles: z.object({
      gemini: z.array(z.string()),
      xai: z.array(z.string()),
      overlap: z.array(z.string()),
    }),
  }),
}).openapi('AIComparisonResult');

// =================================================================================
// Routes
// =================================================================================

const compareRoute = createRoute({
  method: 'post',
  path: '/api/test/ai-comparison',
  tags: ['Testing', 'AI'],
  summary: 'Compare Gemini vs x.ai Grok for book generation',
  description: 'Generate books using both Gemini and Grok, compare results side-by-side',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ComparisonRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Comparison results',
      content: {
        'application/json': {
          schema: ComparisonResultSchema,
        },
      },
    },
    500: {
      description: 'Both providers failed',
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(compareRoute, async (c) => {
  const { prompt, count } = c.req.valid('json');
  const sql = c.get('sql');
  const logger = c.get('logger');
  const env = c.env;

  const context = createServiceContext(env, logger, { sql });

  // Initialize providers
  const geminiProvider = new GeminiProvider();
  const xaiProvider = new XaiProvider();

  // Check availability
  const [geminiAvailable, xaiAvailable] = await Promise.all([
    geminiProvider.isAvailable(env),
    xaiProvider.isAvailable(env),
  ]);

  logger.info('Provider availability check', {
    gemini: geminiAvailable,
    xai: xaiAvailable,
  });

  if (!geminiAvailable && !xaiAvailable) {
    return c.json({
      error: 'Both Gemini and x.ai API keys are not configured',
    }, 500);
  }

  // Run both providers in parallel
  const startTime = Date.now();
  const [geminiResult, xaiResult] = await Promise.all([
    geminiAvailable
      ? (async () => {
          const geminiStart = Date.now();
          try {
            const books = await geminiProvider.generateBooks(prompt, count, context);
            return {
              books,
              duration_ms: Date.now() - geminiStart,
              model: 'gemini-2.5-flash',
            };
          } catch (error) {
            return {
              books: [],
              duration_ms: Date.now() - geminiStart,
              model: 'gemini-2.5-flash',
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })()
      : {
          books: [],
          duration_ms: 0,
          model: 'gemini-2.5-flash',
          error: 'API key not configured',
        },
    xaiAvailable
      ? (async () => {
          const xaiStart = Date.now();
          try {
            const books = await xaiProvider.generateBooks(prompt, count, context);
            return {
              books,
              duration_ms: Date.now() - xaiStart,
              model: 'grok-4-1-fast-non-reasoning',
            };
          } catch (error) {
            return {
              books: [],
              duration_ms: Date.now() - xaiStart,
              model: 'grok-4-1-fast-non-reasoning',
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })()
      : {
          books: [],
          duration_ms: 0,
          model: 'grok-4-1-fast-non-reasoning',
          error: 'API key not configured',
        },
  ]);

  // Analyze results
  const geminiTitles = new Set(geminiResult.books.map((b) => b.title.toLowerCase()));
  const xaiTitles = new Set(xaiResult.books.map((b) => b.title.toLowerCase()));

  const overlap: string[] = [];
  const geminiUnique: string[] = [];
  const xaiUnique: string[] = [];

  geminiResult.books.forEach((book) => {
    const titleLower = book.title.toLowerCase();
    if (xaiTitles.has(titleLower)) {
      overlap.push(book.title);
    } else {
      geminiUnique.push(book.title);
    }
  });

  xaiResult.books.forEach((book) => {
    const titleLower = book.title.toLowerCase();
    if (!geminiTitles.has(titleLower)) {
      xaiUnique.push(book.title);
    }
  });

  const totalDuration = Date.now() - startTime;

  logger.info('AI comparison complete', {
    prompt,
    gemini_count: geminiResult.books.length,
    xai_count: xaiResult.books.length,
    gemini_duration: geminiResult.duration_ms,
    xai_duration: xaiResult.duration_ms,
    total_duration: totalDuration,
    overlap_count: overlap.length,
  });

  return c.json({
    prompt,
    count,
    gemini: geminiResult,
    xai: xaiResult,
    analysis: {
      gemini_count: geminiResult.books.length,
      xai_count: xaiResult.books.length,
      gemini_faster: geminiResult.duration_ms < xaiResult.duration_ms,
      speed_difference_ms: Math.abs(geminiResult.duration_ms - xaiResult.duration_ms),
      unique_titles: {
        gemini: geminiUnique,
        xai: xaiUnique,
        overlap,
      },
    },
  });
});

export default app;
