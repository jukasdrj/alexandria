/**
 * Gemini Backfill Service - Native Structured Output for Historical Book Harvesting
 *
 * Uses Gemini's native structured output (responseSchema + responseMimeType) to:
 * - Generate curated book lists for specific year/month periods
 * - Ensure consistent JSON output without markdown stripping hacks
 * - Include confidence scoring to track ISBN accuracy
 *
 * Model Selection Strategy:
 * - Monthly backfill (1-2 months): Gemini 2.5 Flash - Fast, cost-effective
 * - Annual backfill (large batches): Gemini 2.5 Pro - Better reasoning for bulk operations
 * - Fallback: Gemini 2.0 Flash - Stable fallback if primary models have issues
 *
 * Retry Logic:
 * - Exponential backoff with 3 retries for transient failures
 * - Does not retry 4xx errors (except 429 rate limits)
 * - 60-second timeout per API call
 *
 * @module services/gemini-backfill
 */

import { z } from 'zod';
import type { Env } from '../env.js';
import type { Logger } from '../../lib/logger.js';
import type { ISBNCandidate } from './deduplication.js';

// =================================================================================
// Types & Schemas
// =================================================================================

/**
 * Zod schema for individual book entries from Gemini
 */
export const GeminiBookSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().min(1).max(300),
  isbn: z.string().default(''),
  confidence_isbn: z.enum(['high', 'low', 'unknown']).default('unknown'),
});

export type GeminiBook = z.infer<typeof GeminiBookSchema>;

/**
 * Gemini response schema (array of books)
 */
export const GeminiResponseSchema = z.array(GeminiBookSchema);

/**
 * Native structured output schema for Gemini API
 * Used with responseMimeType: 'application/json'
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      author: { type: 'string' },
      isbn: { type: 'string' },
      confidence_isbn: { 
        type: 'string',
        enum: ['high', 'low', 'unknown']
      },
    },
    required: ['title', 'author', 'isbn', 'confidence_isbn'],
    propertyOrdering: ['title', 'author', 'isbn', 'confidence_isbn'],
  },
};

/**
 * Model configuration for different scenarios
 * - gemini-2.5-flash: Primary model for monthly batches (stable, cost-effective)
 * - gemini-3-flash-preview: Next-gen flash for annual/large batches (better reasoning)
 * - gemini-3-pro-preview: Experimental pro for complex reasoning tasks
 */
export const GEMINI_MODELS = {
  // Primary: Stable flash model for 1-2 month batches
  FLASH: 'gemini-2.5-flash',
  // Secondary: Next-gen flash for large batch operations (annual backfill)
  FLASH_PREVIEW: 'gemini-3-flash-preview',
  // Experimental: Pro model for testing and complex reasoning
  PRO_PREVIEW: 'gemini-3-pro-preview',
  // Legacy: Deprecated, kept for reference only
  // @deprecated Use FLASH_PREVIEW for large batches instead
  FALLBACK: 'gemini-2.5-flash',
} as const;

/**
 * Generation statistics
 */
export interface GenerationStats {
  model_used: string;
  total_books: number;
  books_with_isbn: number;
  books_without_isbn: number;
  high_confidence: number;
  low_confidence: number;
  unknown_confidence: number;
  valid_isbns: number;
  invalid_isbns: number;
  duration_ms: number;
  failed_batches?: number;
  failed_batch_errors?: Array<{ batch: number; error: string }>;
}

// =================================================================================
// ISBN Validation
// =================================================================================

/**
 * Validates ISBN-13 checksum
 * Returns true if the check digit matches the calculated value
 */
export function isValidISBN13(isbn: string): boolean {
  const clean = isbn.replace(/[- ]/g, '');
  
  if (clean.length !== 13 || !/^\d{13}$/.test(clean)) {
    return false;
  }
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(clean[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(clean[12], 10);
}

/**
 * Validates ISBN-10 checksum
 * Returns true if the check digit matches the calculated value
 */
export function isValidISBN10(isbn: string): boolean {
  const clean = isbn.replace(/[- ]/g, '');
  
  if (clean.length !== 10) {
    return false;
  }
  
  // First 9 digits must be numeric
  if (!/^\d{9}/.test(clean)) {
    return false;
  }
  
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean[i], 10) * (10 - i);
  }
  
  const last = clean[9].toUpperCase();
  const checkDigit = last === 'X' ? 10 : parseInt(last, 10);
  
  if (isNaN(checkDigit)) {
    return false;
  }
  
  return (sum + checkDigit) % 11 === 0;
}

/**
 * Validates any ISBN (10 or 13)
 */
export function isValidISBN(isbn: string): boolean {
  const clean = isbn.replace(/[- ]/g, '');
  
  if (clean.length === 13) {
    return isValidISBN13(clean);
  } else if (clean.length === 10) {
    return isValidISBN10(clean);
  }
  
  return false;
}

/**
 * Convert ISBN-10 to ISBN-13
 */
export function isbn10ToIsbn13(isbn10: string): string {
  const clean = isbn10.replace(/[- ]/g, '');
  
  if (clean.length !== 10) {
    return isbn10;
  }
  
  // Remove check digit and prepend 978
  const base = '978' + clean.substring(0, 9);
  
  // Calculate new check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  return base + checkDigit.toString();
}

/**
 * Normalize ISBN to ISBN-13 format
 */
export function normalizeISBN(isbn: string): string {
  const clean = isbn.replace(/[- ]/g, '');
  
  if (clean.length === 10 && isValidISBN10(clean)) {
    return isbn10ToIsbn13(clean);
  }
  
  return clean;
}

// =================================================================================
// Prompt Templates
// =================================================================================

/**
 * High-yield monthly batch prompt
 * Designed to maximize volume and variety for a specific month
 */
function buildMonthlyPrompt(year: number, month: number): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1];

  return `Generate a comprehensive list of exactly 100 books that were published or reached significant cultural prominence in ${monthName} ${year}.

Organize your internal retrieval by these categories to ensure variety:
- NYT Bestsellers (Fiction & Non-fiction)
- Award winners or finalists (Pulitzer, Booker, Hugo, National Book Award, etc.)
- High-impact debuts and indie hits
- Popular genre fiction (mystery, romance, sci-fi, fantasy, thriller)
- Notable non-fiction (memoirs, history, science, self-help)
- International translations that reached English-speaking markets

FEW-SHOT EXAMPLES:

Example 1 (High confidence ISBN):
{
  "title": "The Great Gatsby",
  "author": "F. Scott Fitzgerald",
  "isbn": "9780743273565",
  "confidence_isbn": "high"
}

Example 2 (No ISBN available):
{
  "title": "Beloved",
  "author": "Toni Morrison",
  "isbn": "",
  "confidence_isbn": "unknown"
}

Example 3 (ISBN-10 format):
{
  "title": "1984",
  "author": "George Orwell",
  "isbn": "0451524934",
  "confidence_isbn": "high"
}

For each book:
1. Provide the ISBN-13 (preferred) or ISBN-10 if you are CERTAIN of it
2. Set confidence_isbn: "high" if certain, "low" if estimated, "unknown" if unsure
3. Use empty string "" for isbn if unavailable (NOT null)

Return ONLY a valid JSON array. No markdown, no explanations, no code blocks.`;
}

/**
 * Annual significance prompt
 * For getting the most culturally significant books from a year
 */
function buildAnnualPrompt(year: number, batchNumber: number, batchSize: number = 100): string {
  const startRank = (batchNumber - 1) * batchSize + 1;
  const endRank = batchNumber * batchSize;
  
  return `Act as a historical literary database. Your task is to extract culturally significant works released in the year ${year}.

Task Instructions:
1. Focus on books with lasting impact, high sales volume, or critical acclaim
2. You must provide the primary ISBN-13 for the hardcover or first-edition release
3. Evaluate your certainty for each ISBN:
   - "high": You are confident this ISBN is correct for the ${year} edition
   - "low": The ISBN might be for a later reprint or different edition
   - "unknown": You cannot verify the ISBN

Batch Context: This is batch ${batchNumber}. Provide books ranked ${startRank} through ${endRank} by cultural significance.

Include diverse categories:
- Literary fiction and award winners
- Commercial bestsellers
- Genre fiction (mystery, sci-fi, fantasy, romance, thriller)
- Non-fiction (biography, history, science, self-help, politics)
- Notable debuts and breakout authors

Return ONLY a valid JSON array of exactly ${batchSize} books. No markdown, no explanations.`;
}

// =================================================================================
// Gemini API Client
// =================================================================================

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Gemini API request structure matching bendv3 patterns
 */
interface GeminiContentRequest {
  system_instruction: {
    parts: Array<{ text: string }>;
  };
  contents: Array<{
    parts: Array<{ text: string }>;
  }>;
  generationConfig: {
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    responseMimeType: string;
    responseSchema: typeof GEMINI_RESPONSE_SCHEMA;
  };
}

/**
 * System instruction for bibliographic archival tasks
 * Following bendv3 pattern of separating system instruction from user prompt
 */
const SYSTEM_INSTRUCTION = `You are an expert bibliographic archivist specialized in book metadata extraction.

Your core capabilities:
- Recall culturally significant books from specific time periods
- Accurately retrieve ISBN-13 identifiers from training data
- Distinguish between ISBN certainty levels (high/low/unknown)
- Categorize books across genres (fiction, non-fiction, mystery, sci-fi, etc.)

ISBN VALIDATION RULES (CRITICAL):
- Return ONLY valid ISBN-10 (exactly 10 characters) or ISBN-13 (exactly 13 digits starting with 978 or 979)
- Remove all hyphens, spaces, and separators before returning
- ISBN-10 may end with 'X' (checksum digit) - this is valid
- If ISBN appears incomplete, estimated, or uncertain, return empty string and set confidence to "low" or "unknown"
- NEVER return ISBNs with wrong digit counts - prefer empty string over invalid data

Always return ONLY a valid JSON array matching the provided schema. No explanatory text, no markdown code blocks.`;

/**
 * Select appropriate model for monthly backfill
 * gemini-2.5-flash is preferred for single month operations (stable, cost-effective)
 */
function selectModelForMonthly(): string {
  return GEMINI_MODELS.FLASH;
}

/**
 * Select appropriate model for annual backfill
 * gemini-3-flash-preview is used for large batch operations (better reasoning, faster than pro)
 */
function selectModelForAnnual(): string {
  return GEMINI_MODELS.FLASH_PREVIEW;
}

/**
 * Extended Error type with HTTP status code
 */
interface ApiError extends Error {
  statusCode?: number;
}

/**
 * Retry with exponential backoff (following bendv3 pattern)
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as ApiError;

      // Don't retry on 4xx errors (except 429 rate limit)
      if (lastError.statusCode && lastError.statusCode >= 400 && lastError.statusCode < 500 && lastError.statusCode !== 429) {
        throw lastError;
      }

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Call Gemini API with native structured output
 * Uses header-based API key authentication (x-goog-api-key) per working bendv3 implementation
 */
async function callGeminiApi(
  prompt: string,
  apiKey: string,
  model: string,
  logger: Logger
): Promise<GeminiBook[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  
  const requestBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1, // Maximum determinism for structured data extraction (following bendv3 pattern)
      topP: 0.95, // Nucleus sampling for quality
      maxOutputTokens: 8192, // Match bendv3's proven setting (100 books ~6K tokens)
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      stopSequences: ['\n\n\n'], // Stop on triple newline to prevent unnecessary continuation
    },
  };
  
  logger.info('[GeminiBackfill] Calling API', { model, prompt_length: prompt.length });
  
  // Add 60s timeout for large responses
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      // Sanitize error message (truncate to prevent leaking sensitive info)
      const safeErrorText = errorText.substring(0, 500);
      const error = new Error(`Gemini API error ${response.status}: ${safeErrorText}`) as ApiError;
      error.statusCode = response.status;
      throw error;
    }

    const data = await response.json() as GeminiApiResponse;

    if (data.error) {
      const error = new Error(`Gemini API error: ${data.error.message}`) as ApiError;
      error.statusCode = data.error.code;
      throw error;
    }
    
    // Log token usage for cost tracking
    if (data.usageMetadata) {
      logger.info('[GeminiBackfill] Token usage', {
        model,
        prompt_tokens: data.usageMetadata.promptTokenCount,
        output_tokens: data.usageMetadata.candidatesTokenCount,
        total_tokens: data.usageMetadata.totalTokenCount,
      });
    }
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      logger.warn('[GeminiBackfill] Empty response from API', { model });
      return [];
    }
    
    // With native structured output, response should be valid JSON
    // But we still validate with Zod for type safety
    try {
      const parsed = JSON.parse(text);
      const validated = GeminiResponseSchema.parse(parsed);
      logger.info('[GeminiBackfill] Parsed response', { 
        model, 
        book_count: validated.length 
      });
      return validated;
    } catch (parseError) {
      logger.error('[GeminiBackfill] Failed to parse response', {
        model,
        error: parseError instanceof Error ? parseError.message : String(parseError),
        text_preview: text.substring(0, 200),
      });
      return [];
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gemini API request timed out after 60 seconds');
    }
    throw error;
  }
}

// =================================================================================
// Main Export Functions
// =================================================================================

/**
 * Generate curated book list for a specific year/month using Gemini API
 * with native structured output and ISBN validation
 *
 * @param year - Year to generate list for
 * @param month - Month to generate list for (1-12)
 * @param env - Environment with API key
 * @param logger - Logger instance
 * @param promptOverride - Optional custom prompt for A/B testing
 * @returns Object containing candidates and generation stats
 */
export async function generateCuratedBookList(
  year: number,
  month: number,
  env: Env,
  logger: Logger,
  promptOverride?: string
): Promise<{ candidates: ISBNCandidate[]; stats: GenerationStats }> {
  const startTime = Date.now();

  // Get API key - GEMINI_API_KEY is bound to Google_books_hardoooe which has Generative Language API access
  const apiKey = await env.GEMINI_API_KEY.get();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Select Flash model for monthly operations (fast, cost-effective)
  const model = selectModelForMonthly();

  // Build prompt (use override if provided, otherwise use default)
  const prompt = promptOverride || buildMonthlyPrompt(year, month);

  logger.info('[GeminiBackfill] Starting generation', { year, month, model });
  
  // Call API with retry and fallback
  let books: GeminiBook[] = [];
  let modelUsed = model;
  
  try {
    // Wrap API call in retry logic for transient failures
    books = await retryWithBackoff(
      () => callGeminiApi(prompt, apiKey, model, logger),
      3, // maxRetries
      1000 // baseDelayMs
    );
  } catch (error) {
    // Fallback to stable model on error
    logger.warn('[GeminiBackfill] Primary model failed, trying fallback', {
      primary_model: model,
      error: error instanceof Error ? error.message : String(error),
    });
    
    modelUsed = GEMINI_MODELS.FALLBACK;
    books = await retryWithBackoff(
      () => callGeminiApi(prompt, apiKey, GEMINI_MODELS.FALLBACK, logger),
      3,
      1000
    );
  }
  
  // Process and validate books
  const stats: GenerationStats = {
    model_used: modelUsed,
    total_books: books.length,
    books_with_isbn: 0,
    books_without_isbn: 0,
    high_confidence: 0,
    low_confidence: 0,
    unknown_confidence: 0,
    valid_isbns: 0,
    invalid_isbns: 0,
    duration_ms: 0,
  };
  
  const candidates: ISBNCandidate[] = [];
  
  for (const book of books) {
    // Track confidence distribution
    switch (book.confidence_isbn) {
      case 'high':
        stats.high_confidence++;
        break;
      case 'low':
        stats.low_confidence++;
        break;
      case 'unknown':
        stats.unknown_confidence++;
        break;
    }
    
    // Check if book has ISBN
    if (!book.isbn || book.isbn.trim() === '') {
      stats.books_without_isbn++;
      continue;
    }
    
    stats.books_with_isbn++;
    
    // Validate ISBN checksum
    const cleanISBN = book.isbn.replace(/[- ]/g, '');
    if (!isValidISBN(cleanISBN)) {
      stats.invalid_isbns++;
      logger.debug('[GeminiBackfill] Invalid ISBN checksum', {
        title: book.title,
        isbn: book.isbn,
        confidence: book.confidence_isbn,
      });
      continue;
    }
    
    stats.valid_isbns++;
    
    // Normalize to ISBN-13
    const normalizedISBN = normalizeISBN(cleanISBN);
    
    candidates.push({
      isbn: normalizedISBN,
      title: book.title,
      authors: [book.author],
      source: `gemini-${year}-${month.toString().padStart(2, '0')}-${book.confidence_isbn}`,
    });
  }
  
  stats.duration_ms = Date.now() - startTime;
  
  logger.info('[GeminiBackfill] Generation complete', {
    year,
    month,
    model: modelUsed,
    ...stats,
  });
  
  return { candidates, stats };
}

/**
 * Generate annual book list in batches
 * For larger backfill operations covering entire years
 * 
 * @param year - Year to generate list for
 * @param batches - Number of batches (each returns ~100 books)
 * @param env - Environment with API key
 * @param logger - Logger instance
 * @returns Combined candidates and aggregated stats
 */
export async function generateAnnualBookList(
  year: number,
  batches: number,
  env: Env,
  logger: Logger
): Promise<{ candidates: ISBNCandidate[]; stats: GenerationStats }> {
  const startTime = Date.now();
  
  const apiKey = await env.GEMINI_API_KEY.get();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Use Pro model for annual backfill (better reasoning for large batches)
  const model = selectModelForAnnual();
  const allCandidates: ISBNCandidate[] = [];

  const aggregatedStats: GenerationStats = {
    model_used: model,
    total_books: 0,
    books_with_isbn: 0,
    books_without_isbn: 0,
    high_confidence: 0,
    low_confidence: 0,
    unknown_confidence: 0,
    valid_isbns: 0,
    invalid_isbns: 0,
    duration_ms: 0,
    failed_batches: 0,
    failed_batch_errors: [],
  };

  for (let batch = 1; batch <= batches; batch++) {
    logger.info('[GeminiBackfill] Processing batch', { year, batch, total_batches: batches });

    const prompt = buildAnnualPrompt(year, batch, 100);

    try {
      // Wrap API call in retry logic for transient failures
      const books = await retryWithBackoff(
        () => callGeminiApi(prompt, apiKey, model, logger),
        3,
        1000
      );
      
      for (const book of books) {
        aggregatedStats.total_books++;
        
        switch (book.confidence_isbn) {
          case 'high': aggregatedStats.high_confidence++; break;
          case 'low': aggregatedStats.low_confidence++; break;
          case 'unknown': aggregatedStats.unknown_confidence++; break;
        }
        
        if (!book.isbn || book.isbn.trim() === '') {
          aggregatedStats.books_without_isbn++;
          continue;
        }
        
        aggregatedStats.books_with_isbn++;
        
        const cleanISBN = book.isbn.replace(/[- ]/g, '');
        if (!isValidISBN(cleanISBN)) {
          aggregatedStats.invalid_isbns++;
          continue;
        }
        
        aggregatedStats.valid_isbns++;
        
        allCandidates.push({
          isbn: normalizeISBN(cleanISBN),
          title: book.title,
          authors: [book.author],
          source: `gemini-annual-${year}-batch${batch}-${book.confidence_isbn}`,
        });
      }
      
      // Rate limit: Gemini allows 1000 RPM, but let's be conservative
      if (batch < batches) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[GeminiBackfill] Batch failed', {
        year,
        batch,
        error: errorMessage,
      });

      // Track failed batch
      aggregatedStats.failed_batches = (aggregatedStats.failed_batches || 0) + 1;
      aggregatedStats.failed_batch_errors = aggregatedStats.failed_batch_errors || [];
      aggregatedStats.failed_batch_errors.push({ batch, error: errorMessage });
    }
  }
  
  aggregatedStats.duration_ms = Date.now() - startTime;
  
  logger.info('[GeminiBackfill] Annual generation complete', {
    year,
    batches,
    total_candidates: allCandidates.length,
    ...aggregatedStats,
  });
  
  return { candidates: allCandidates, stats: aggregatedStats };
}

/**
 * Test Gemini connection and configuration
 * Useful for validating API key and model access
 */
export async function testGeminiConnection(
  env: Env,
  logger: Logger
): Promise<{ success: boolean; model: string; error?: string }> {
  try {
    const apiKey = await env.GEMINI_API_KEY.get();
    if (!apiKey) {
      return { success: false, model: '', error: 'GEMINI_API_KEY not configured' };
    }
    
    const testPrompt = 'List 3 famous books with their ISBN-13. Return JSON array.';
    const model = GEMINI_MODELS.FLASH;

    // Use retry logic for more reliable connectivity tests
    const books = await retryWithBackoff(
      () => callGeminiApi(testPrompt, apiKey, model, logger),
      2, // Fewer retries for test
      500
    );

    return {
      success: books.length > 0,
      model,
      error: books.length === 0 ? 'Empty response' : undefined,
    };
    
  } catch (error) {
    return {
      success: false,
      model: GEMINI_MODELS.PRIMARY,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}