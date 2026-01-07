/**
 * Gemini Backfill Service - Native Structured Output for Historical Book Harvesting
 * 
 * Uses Gemini's native structured output (responseSchema + responseMimeType) to:
 * - Generate curated book lists for specific year/month periods
 * - Ensure consistent JSON output without markdown stripping hacks
 * - Include confidence scoring to track ISBN accuracy
 * 
 * Model Selection Strategy:
 * - Primary: Gemini 3 Flash (gemini-3-flash-preview) - Latest, fastest, strong reasoning
 * - Fallback: Gemini 2.5 Flash (gemini-2.5-flash) - Stable, good for general use
 * - Historical data (pre-2015): Gemini 2.5 Pro (gemini-2.5-pro) - Better long-term memory
 * 
 * Based on optimization recommendations and Gemini 3 Pro analysis.
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
 */
export const GEMINI_MODELS = {
  // Primary: Gemini 3 Flash - Latest, fastest, best for general use
  PRIMARY: 'gemini-3-flash-preview',
  // Fallback: Gemini 2.5 Flash - Stable, good performance
  FALLBACK: 'gemini-2.5-flash',
  // Historical: Gemini 2.5 Pro - Better for pre-2015 data
  HISTORICAL: 'gemini-2.5-pro',
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
  
  return `You are a specialized bibliographic archivist. Generate a comprehensive list of exactly 100 books that were published or reached significant cultural prominence in ${monthName} ${year}.

Organize your internal retrieval by these categories to ensure variety:
- NYT Bestsellers (Fiction & Non-fiction)
- Award winners or finalists (Pulitzer, Booker, Hugo, National Book Award, etc.)
- High-impact debuts and indie hits
- Popular genre fiction (mystery, romance, sci-fi, fantasy, thriller)
- Notable non-fiction (memoirs, history, science, self-help)
- International translations that reached English-speaking markets

For each book:
1. Provide the ISBN-13 (strongly preferred) or ISBN-10
2. If you are CERTAIN of the ISBN from your training data, set confidence_isbn to "high"
3. If you are estimating based on typical edition patterns, set to "low"
4. If no ISBN is available or you're unsure, provide an empty string and set to "unknown"

IMPORTANT: Only include ISBNs you have high confidence in. It's better to mark confidence as "low" or "unknown" than to guess incorrectly.

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
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Select appropriate model based on year
 * - Historical data (pre-2015) benefits from Pro model's deeper knowledge
 * - Recent data works well with faster Flash models
 */
function selectModel(year: number): string {
  if (year < 2015) {
    return GEMINI_MODELS.HISTORICAL;
  }
  return GEMINI_MODELS.PRIMARY;
}

/**
 * Call Gemini API with native structured output
 */
async function callGeminiApi(
  prompt: string,
  apiKey: string,
  model: string,
  logger: Logger
): Promise<GeminiBook[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const requestBody = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.3, // Lower temperature for factual accuracy
      maxOutputTokens: 16384, // Allow for large lists
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
  
  logger.info('[GeminiBackfill] Calling API', { model, prompt_length: prompt.length });
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }
  
  const data = await response.json() as GeminiApiResponse;
  
  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
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
 * @returns Object containing candidates and generation stats
 */
export async function generateCuratedBookList(
  year: number,
  month: number,
  env: Env,
  logger: Logger
): Promise<{ candidates: ISBNCandidate[]; stats: GenerationStats }> {
  const startTime = Date.now();
  
  // Get API key
  const apiKey = await env.GEMINI_API_KEY.get();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  
  // Select model based on year
  const model = selectModel(year);
  
  // Build prompt
  const prompt = buildMonthlyPrompt(year, month);
  
  logger.info('[GeminiBackfill] Starting generation', { year, month, model });
  
  // Call API with primary model
  let books: GeminiBook[] = [];
  let modelUsed = model;
  
  try {
    books = await callGeminiApi(prompt, apiKey, model, logger);
  } catch (error) {
    // Fallback to stable model on error
    logger.warn('[GeminiBackfill] Primary model failed, trying fallback', {
      primary_model: model,
      error: error instanceof Error ? error.message : String(error),
    });
    
    modelUsed = GEMINI_MODELS.FALLBACK;
    books = await callGeminiApi(prompt, apiKey, GEMINI_MODELS.FALLBACK, logger);
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
  
  const model = selectModel(year);
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
  };
  
  for (let batch = 1; batch <= batches; batch++) {
    logger.info('[GeminiBackfill] Processing batch', { year, batch, total_batches: batches });
    
    const prompt = buildAnnualPrompt(year, batch, 100);
    
    try {
      const books = await callGeminiApi(prompt, apiKey, model, logger);
      
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
      
      // Rate limit: Gemini 3 allows 1000 RPM, but let's be conservative
      if (batch < batches) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      logger.error('[GeminiBackfill] Batch failed', {
        year,
        batch,
        error: error instanceof Error ? error.message : String(error),
      });
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
    const model = GEMINI_MODELS.PRIMARY;
    
    const books = await callGeminiApi(testPrompt, apiKey, model, logger);
    
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