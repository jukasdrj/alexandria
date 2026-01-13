/**
 * x.ai (Grok) Service Provider
 *
 * Uses xAI's Grok models for generating curated book lists for historical backfill.
 * Similar to GeminiProvider, this generates synthetic book metadata based on prompts.
 *
 * Implements:
 * - IBookGenerator: Generate book metadata from prompts
 *
 * Features:
 * - OpenAI-compatible chat completions API
 * - JSON mode for structured output
 * - Confidence scoring to track accuracy
 * - Hybrid approach: Grok generates title/author, ISBNdb resolves ISBN
 *
 * Model Selection:
 * - Default: grok-4-1-fast-non-reasoning ($0.20/M input, $0.50/M output)
 * - With reasoning: grok-4-1-fast ($0.50/M input, $2.00/M output)
 *
 * API Documentation: https://docs.x.ai/docs/overview
 * API Reference: https://docs.x.ai/docs/api-reference
 *
 * @module lib/external-services/providers/xai-provider
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

const XAI_API_BASE = 'https://api.x.ai/v1';

// =================================================================================
// Types
// =================================================================================

interface XaiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface XaiChatRequest {
  model: string;
  messages: XaiChatMessage[];
  temperature?: number;
  response_format?: {
    type: 'json_object';
  };
}

interface XaiChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface XaiGeneratedBook {
  title: string;
  author: string;
  publisher?: string;
  format?: string;
  publication_year: number;
  significance?: string;
}

// =================================================================================
// x.ai Provider
// =================================================================================

export class XaiProvider implements IBookGenerator {
  readonly name = 'xai';
  readonly providerType = 'ai' as const;
  readonly capabilities = [ServiceCapability.BOOK_GENERATION];

  private client = new ServiceHttpClient({
    providerName: 'xai',
    rateLimitMs: 0, // No rate limiting (pay-per-use)
    cacheTtlSeconds: 0, // No caching for AI generation
    purpose: 'Book metadata generation for backfill (comparison testing)',
  });

  async isAvailable(env: Env): Promise<boolean> {
    const apiKey = await env.XAI_API_KEY?.get();
    return !!apiKey;
  }

  async generateBooks(
    prompt: string,
    count: number,
    context: ServiceContext
  ): Promise<GeneratedBook[]> {
    const { logger, env } = context;

    try {
      const apiKey = await env.XAI_API_KEY.get();
      if (!apiKey) {
        logger.error('x.ai API key not configured');
        return [];
      }

      // Use grok-4-1-fast-non-reasoning (fast inference model)
      const model = 'grok-4-1-fast-non-reasoning';
      const url = `${XAI_API_BASE}/chat/completions`;

      const requestBody: XaiChatRequest = {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a knowledgeable book expert. Generate a JSON array of books matching the user\'s request. Each book must include: title (string), author (string), publisher (string, optional), publication_year (integer), and significance (string, explaining why the book is notable).',
          },
          {
            role: 'user',
            content: `${prompt}\n\nGenerate exactly ${count} books in JSON format. Return only a valid JSON array with no additional text.`,
          },
        ],
        temperature: 0.7,
        response_format: {
          type: 'json_object',
        },
      };

      const response = await this.client.fetch<XaiChatResponse>(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        },
        context
      );

      if (!response?.choices?.[0]?.message?.content) {
        logger.error('No content in x.ai response');
        return [];
      }

      // Parse JSON response (sanitize Markdown code fences)
      const content = response.choices[0].message.content;
      const sanitized = content
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      // Handle both array and object responses
      let books: XaiGeneratedBook[];
      const parsed = JSON.parse(sanitized);

      if (Array.isArray(parsed)) {
        books = parsed;
      } else if (parsed.books && Array.isArray(parsed.books)) {
        books = parsed.books;
      } else {
        logger.error('Unexpected x.ai response format', { content });
        return [];
      }

      // Convert to GeneratedBook format
      const results: GeneratedBook[] = books.map((book) => ({
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        publishDate: book.publication_year.toString(),
        description: book.significance,
        confidence: 30, // Low confidence - needs ISBN resolution
        source: 'xai',
      }));

      // Log token usage for comparison
      if (response.usage) {
        logger.info('x.ai token usage', {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
          model,
        });
      }

      logger.info('x.ai books generated', {
        prompt,
        requested: count,
        generated: results.length,
        model,
      });

      return results;
    } catch (error) {
      logger.error('x.ai generation failed', {
        prompt,
        count,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
