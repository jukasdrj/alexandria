import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiProvider } from '../gemini-provider.js';
import { ServiceCapability } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

// Create a mock fetch function
const mockFetch = vi.fn();

// Mock the ServiceHttpClient
vi.mock('../../http-client.js', () => ({
  ServiceHttpClient: class MockServiceHttpClient {
    fetch = mockFetch;
  },
}));

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let mockContext: ServiceContext;
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new GeminiProvider();

    // Mock KV binding for GEMINI_API_KEY
    const mockApiKeyBinding = {
      get: vi.fn().mockResolvedValue('test-api-key-123'),
    };

    mockEnv = {
      GEMINI_API_KEY: mockApiKeyBinding,
    } as any as Env;

    mockContext = {
      env: mockEnv,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };
  });

  describe('provider metadata', () => {
    it('should have correct name', () => {
      expect(provider.name).toBe('gemini');
    });

    it('should be an AI provider', () => {
      expect(provider.providerType).toBe('ai');
    });

    it('should support book generation capability', () => {
      expect(provider.capabilities).toEqual([
        ServiceCapability.BOOK_GENERATION,
      ]);
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is present', async () => {
      const available = await provider.isAvailable(mockEnv);
      expect(available).toBe(true);
    });

    it('should return false when API key is missing', async () => {
      const envWithoutKey = {
        GEMINI_API_KEY: {
          get: vi.fn().mockResolvedValue(null),
        },
      } as any as Env;

      const available = await provider.isAvailable(envWithoutKey);
      expect(available).toBe(false);
    });

    it('should return false when GEMINI_API_KEY binding is undefined', async () => {
      const envWithoutBinding = {} as any as Env;
      const available = await provider.isAvailable(envWithoutBinding);
      expect(available).toBe(false);
    });
  });

  describe('generateBooks', () => {
    it('should return empty array when API key is missing', async () => {
      const envWithoutKey = {
        GEMINI_API_KEY: {
          get: vi.fn().mockResolvedValue(null),
        },
      } as any as Env;

      const contextWithoutKey = { ...mockContext, env: envWithoutKey };
      const result = await provider.generateBooks(
        'books from January 2020',
        5,
        contextWithoutKey
      );

      expect(result).toEqual([]);
      expect(contextWithoutKey.logger.error).toHaveBeenCalledWith(
        'Gemini API key not configured'
      );
    });

    it('should successfully generate books with correct schema', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      title: 'The Midnight Library',
                      author: 'Matt Haig',
                      publisher: 'Canongate Books',
                      publication_year: 2020,
                      significance: 'Bestselling novel exploring parallel lives',
                    },
                    {
                      title: 'The Vanishing Half',
                      author: 'Brit Bennett',
                      publisher: 'Riverhead Books',
                      publication_year: 2020,
                      significance: 'Novel about twin sisters with different life paths',
                    },
                  ]),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      const result = await provider.generateBooks(
        'significant books from 2020',
        2,
        mockContext
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        title: 'The Midnight Library',
        author: 'Matt Haig',
        publisher: 'Canongate Books',
        publishDate: '2020',
        description: 'Bestselling novel exploring parallel lives',
        confidence: 30,
        source: 'gemini',
      });
      expect(result[1]).toEqual({
        title: 'The Vanishing Half',
        author: 'Brit Bennett',
        publisher: 'Riverhead Books',
        publishDate: '2020',
        description: 'Novel about twin sisters with different life paths',
        confidence: 30,
        source: 'gemini',
      });

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Gemini books generated',
        {
          prompt: 'significant books from 2020',
          requested: 2,
          generated: 2,
        }
      );
    });

    it('should handle books without optional fields', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      title: 'Minimal Book',
                      author: 'Unknown Author',
                      publication_year: 2020,
                    },
                  ]),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: 'Minimal Book',
        author: 'Unknown Author',
        publisher: undefined,
        publishDate: '2020',
        description: undefined,
        confidence: 30,
        source: 'gemini',
      });
    });

    it('should use gemini-2.5-flash model', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: '[]' }],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      await provider.generateBooks('test', 1, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        expect.any(Object),
        mockContext
      );
    });

    it('should include count in prompt', async () => {
      const mockGeminiResponse = {
        candidates: [{ content: { parts: [{ text: '[]' }] } }],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      await provider.generateBooks('books from 2020', 10, mockContext);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.contents[0].parts[0].text).toContain('Generate exactly 10 books');
    });

    it('should include structured output schema', async () => {
      const mockGeminiResponse = {
        candidates: [{ content: { parts: [{ text: '[]' }] } }],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      await provider.generateBooks('test', 1, mockContext);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.generationConfig.responseMimeType).toBe('application/json');
      expect(requestBody.generationConfig.responseSchema).toEqual({
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
      });
    });

    it('should include API key in secure header', async () => {
      const mockGeminiResponse = {
        candidates: [{ content: { parts: [{ text: '[]' }] } }],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      await provider.generateBooks('test', 1, mockContext);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['x-goog-api-key']).toBe('test-api-key-123');
    });

    it('should return empty array when response has no content', async () => {
      mockFetch.mockResolvedValueOnce({});

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'No content in Gemini response'
      );
    });

    it('should return empty array when response has no candidates', async () => {
      mockFetch.mockResolvedValueOnce({ candidates: [] });

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'No content in Gemini response'
      );
    });

    it('should return empty array when response has no parts', async () => {
      mockFetch.mockResolvedValueOnce({
        candidates: [{ content: { parts: [] } }],
      });

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'No content in Gemini response'
      );
    });
  });

  describe('error handling', () => {
    it('should return empty array on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API timeout'));

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Gemini generation failed',
        {
          prompt: 'test',
          count: 1,
          error: 'API timeout',
        }
      );
    });

    it('should handle JSON parse errors gracefully', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'invalid json {]' }],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Gemini generation failed',
        expect.objectContaining({
          prompt: 'test',
          count: 1,
        })
      );
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Gemini generation failed',
        expect.objectContaining({
          error: 'Failed to fetch',
        })
      );
    });

    it('should handle non-Error exceptions', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      const result = await provider.generateBooks('test', 1, mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Gemini generation failed',
        expect.objectContaining({
          error: 'string error',
        })
      );
    });
  });

  describe('confidence scoring', () => {
    it('should assign confidence score of 30 to all generated books', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      title: 'Book 1',
                      author: 'Author 1',
                      publication_year: 2020,
                    },
                    {
                      title: 'Book 2',
                      author: 'Author 2',
                      publication_year: 2021,
                    },
                  ]),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      const result = await provider.generateBooks('test', 2, mockContext);

      expect(result[0].confidence).toBe(30);
      expect(result[1].confidence).toBe(30);
    });
  });

  describe('integration scenarios', () => {
    it('should handle large batch generation', async () => {
      const books = Array.from({ length: 50 }, (_, i) => ({
        title: `Book ${i + 1}`,
        author: `Author ${i + 1}`,
        publication_year: 2020,
      }));

      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(books) }],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      const result = await provider.generateBooks('test', 50, mockContext);

      expect(result).toHaveLength(50);
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Gemini books generated',
        {
          prompt: 'test',
          requested: 50,
          generated: 50,
        }
      );
    });

    it('should handle mismatch between requested and generated count', async () => {
      // API returns fewer books than requested
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      title: 'Only Book',
                      author: 'Only Author',
                      publication_year: 2020,
                    },
                  ]),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockGeminiResponse);

      const result = await provider.generateBooks('test', 10, mockContext);

      expect(result).toHaveLength(1);
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Gemini books generated',
        {
          prompt: 'test',
          requested: 10,
          generated: 1,
        }
      );
    });
  });
});
