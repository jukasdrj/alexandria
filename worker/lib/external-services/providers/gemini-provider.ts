/**
 * Gemini Service Provider
 *
 * Uses Google's Gemini AI for generating curated book lists for historical backfill.
 * This is not a traditional metadata provider - it generates synthetic book metadata
 * based on prompts (e.g., "significant books published in January 2020").
 *
 * Implements:
 * - IBookGenerator: Generate book metadata from prompts
 *
 * Features:
 * - Native structured output (responseSchema + responseMimeType)
 * - Confidence scoring to track accuracy
 * - Hybrid approach: Gemini generates title/author, ISBNdb resolves ISBN
 *
 * Model Selection:
 * - Monthly backfill: gemini-2.5-flash (fast, cost-effective)
 * - Annual backfill: gemini-3-flash-preview (better reasoning)
 *
 * @module lib/external-services/providers/gemini-provider
 */

import type {
  IBookGenerator,
  GeneratedBook,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';

// =================================================================================
// Constants
// =================================================================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// =================================================================================
// Types
// =================================================================================

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface GeminiGeneratedBook {
  title: string;
  author: string;
  publisher?: string;
  format?: string;
  publication_year: number;
  significance?: string;
}

// =================================================================================
// Gemini Provider
// =================================================================================

export class GeminiProvider implements IBookGenerator {
  readonly name = 'gemini';
  readonly providerType = 'ai' as const;
  readonly capabilities = [ServiceCapability.BOOK_GENERATION];

  private client = new ServiceHttpClient({
    providerName: 'gemini',
    rateLimitMs: 0, // No rate limiting (pay-per-use)
    cacheTtlSeconds: 0, // No caching for AI generation
    purpose: 'Book metadata generation for backfill',
  });

  async isAvailable(env: Env): Promise<boolean> {
    const apiKey = await env.GEMINI_API_KEY?.get();
    return !!apiKey;
  }

  async generateBooks(
    prompt: string,
    count: number,
    context: ServiceContext
  ): Promise<GeneratedBook[]> {
    const { logger, env } = context;

    try {
      const apiKey = await env.GEMINI_API_KEY.get();
      if (!apiKey) {
        logger.error('Gemini API key not configured');
        return [];
      }

      // Use gemini-2.5-flash for standard backfill
      const model = 'gemini-2.5-flash';
      const url = `${GEMINI_API_BASE}/${model}:generateContent`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `${prompt}\n\nGenerate exactly ${count} books. For each book, provide: title, author, publisher (if known), publication_year, and significance (why it's notable).`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                author: { type: 'string' },
                publisher: { type: 'string' },
                publication_year: { type: 'integer' },
                significance: { type: 'string' },
              },
              required: ['title', 'author', 'publication_year'],
            },
          },
        },
      };

      const response = await this.client.fetch<GeminiResponse>(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey, // Move API key to secure header
          },
          body: JSON.stringify(requestBody),
        },
        context
      );

      if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        logger.error('No content in Gemini response');
        return [];
      }

      // Parse JSON response (sanitize Markdown code fences)
      const text = response.candidates[0].content.parts[0].text;
      const sanitized = text
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const books: GeminiGeneratedBook[] = JSON.parse(sanitized);

      // Convert to GeneratedBook format
      const results: GeneratedBook[] = books.map((book) => ({
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        publishDate: book.publication_year.toString(),
        description: book.significance,
        confidence: 30, // Low confidence - needs ISBN resolution
        source: 'gemini',
      }));

      logger.info('Gemini books generated', {
        prompt,
        requested: count,
        generated: results.length,
      });

      return results;
    } catch (error) {
      logger.error('Gemini generation failed', {
        prompt,
        count,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
