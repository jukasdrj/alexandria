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
 * Zod schema for individual book entries from Gemini (Hybrid Workflow)
 *
 * HYBRID APPROACH:
 * - Gemini generates: title, author, publisher, format, publication_year
 * - ISBNdb resolves: Authoritative ISBN via title/author search
 *
 * This avoids LLM ISBN hallucination while maintaining high-quality metadata
 */
export const GeminiBookSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().min(1).max(300),
  publisher: z.string().optional(),
  format: z.enum(['Hardcover', 'Paperback', 'eBook', 'Audiobook', 'Unknown']).default('Unknown'),
  publication_year: z.number().int().min(1900).max(2100),
  significance: z.string().max(500).optional(),
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
      publisher: { type: 'string' },
      format: {
        type: 'string',
        enum: ['Hardcover', 'Paperback', 'eBook', 'Audiobook', 'Unknown']
      },
      publication_year: { type: 'integer' },
      significance: { type: 'string' },
    },
    required: ['title', 'author', 'publication_year', 'format'],
    propertyOrdering: ['title', 'author', 'publisher', 'format', 'publication_year', 'significance'],
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
 * Generation statistics (Hybrid Workflow)
 *
 * Note: ISBN resolution happens via ISBNdb, not Gemini
 * These stats track the quality of book metadata from Gemini
 */
export interface GenerationStats {
  model_used: string;
  total_books: number;
  books_with_publisher: number;
  books_with_significance: number;
  format_breakdown: {
    Hardcover: number;
    Paperback: number;
    eBook: number;
    Audiobook: number;
    Unknown: number;
  };
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
 * Prompt variant registry for A/B testing
 * Maps variant names to prompt builder functions
 */
export const PROMPT_VARIANTS = {
  baseline: (year: number, month: number, batchSize: number) => buildMonthlyPrompt(year, month, batchSize),
  'diversity-emphasis': (year: number, month: number, batchSize: number) => buildDiversityPrompt(year, month, batchSize),
  'overlooked-significance': (year: number, month: number, batchSize: number) => buildOverlookedPrompt(year, month, batchSize),
  'genre-rotation': (year: number, month: number, batchSize: number) => buildGenrePrompt(year, month, batchSize),
  'era-contextualized': (year: number, month: number, batchSize: number) => buildEraPrompt(year, month, batchSize),
  'isbn-format-aware': (year: number, month: number, batchSize: number) => buildISBNFormatPrompt(year, month, batchSize),
} as const;

export type PromptVariantName = keyof typeof PROMPT_VARIANTS;

/**
 * High-quality batch prompt (Hybrid Workflow)
 *
 * STRATEGY SHIFT:
 * - Reduced batch size (100 → 20) for higher accuracy per book
 * - Focus on complete metadata: title, author, publisher, format, year
 * - ISBNs resolved separately via ISBNdb API (avoids LLM hallucination)
 */
function buildMonthlyPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1];

  return `Generate a curated list of exactly ${batchSize} historically significant books published in ${monthName} ${year}.

SELECTION CRITERIA - Prioritize quality over quantity:
- NYT Bestsellers (Fiction & Non-fiction)
- Literary awards: Pulitzer, Booker Prize, Hugo, National Book Award, etc.
- Critical acclaim or lasting cultural impact
- Breakthrough debuts that shaped their genre
- High-selling popular fiction (mystery, romance, sci-fi, fantasy, thriller)
- Influential non-fiction (memoir, history, science, self-help, politics)
- Notable international works reaching English-speaking markets

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house that released this specific edition (e.g., "Penguin Random House", "HarperCollins")
4. **format**: The primary format for this edition
   - "Hardcover": First hardcover release (most common for significant books)
   - "Paperback": Paperback-first releases or simultaneous release
   - "eBook": Digital-first publications
   - "Audiobook": Audiobook-first releases (rare)
   - "Unknown": If uncertain about primary format
5. **publication_year**: ${year}
6. **significance** (optional): Brief note on why this book is historically important (1-2 sentences)

ACCURACY GUIDELINES:
- Focus on books you can confidently identify with complete metadata
- Publisher and format help establish the specific edition
- If uncertain about publisher or format, use best judgment based on the book's profile
- For major bestsellers, assume hardcover unless known to be paperback-first

Return ONLY a valid JSON array of exactly ${batchSize} books. No markdown, no explanations, no code blocks.`;
}

/**
 * Annual significance prompt (Hybrid Workflow)
 * For getting the most culturally significant books from a year
 *
 * Reduced batch size for quality: 100 → 20
 */
function buildAnnualPrompt(year: number, batchNumber: number, batchSize: number = 20): string {
  const startRank = (batchNumber - 1) * batchSize + 1;
  const endRank = batchNumber * batchSize;

  return `You are a historical literary database extracting culturally significant works from ${year}.

BATCH CONTEXT: Provide books ranked ${startRank}-${endRank} by cultural significance.

SELECTION CRITERIA:
- Lasting cultural impact or critical acclaim
- High sales volume or commercial success
- Award winners (Pulitzer, Booker, Hugo, National Book Award, etc.)
- Genre-defining works
- Include diverse categories:
  - Literary fiction and award winners
  - Commercial bestsellers
  - Genre fiction (mystery, sci-fi, fantasy, romance, thriller)
  - Non-fiction (biography, history, science, self-help, politics)
  - Breakthrough debuts and breakout authors

METADATA REQUIREMENTS for each book:
1. **title**: Full title (exact as published)
2. **author**: Primary author's full name
3. **publisher**: Publishing house for this edition
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why this book matters (1-2 sentences)

ACCURACY NOTES:
- Focus on books with complete, verifiable metadata
- Publisher/format define the specific edition
- For major releases, hardcover is typical unless known otherwise

Return ONLY a valid JSON array of exactly ${batchSize} books. No markdown, no explanations.`;
}

/**
 * Variant B: Diversity Emphasis
 * Prioritize non-English, indie publishers, regional presses
 */
function buildDiversityPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1];

  return `Generate a curated list of exactly ${batchSize} historically or culturally significant books from ${monthName} ${year}.

PRIORITIZE (in order of importance):
1. Non-English language editions (Spanish, French, German, Japanese, Chinese, Arabic, etc.)
2. Small and independent publishers
3. Regional presses from underrepresented areas (Latin America, Africa, Asia, Eastern Europe)
4. Translated works that reached international audiences
5. Books that shaped specific communities or movements (not necessarily bestsellers)

AVOID:
- Mainstream bestsellers from major publishers (Random House, Penguin, HarperCollins, Simon & Schuster)
- Books that would be in every major library's collection
- US/UK-only perspectives

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house name (prioritize indie/regional publishers)
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why this book is culturally important (1-2 sentences)

Geographic diversity is critical. Aim for at least 30-40% non-English or non-US/UK titles.

Return ONLY a valid JSON array of exactly ${batchSize} books. No markdown, no explanations.`;
}

/**
 * Variant C: Overlooked Significance
 * Focus on culturally significant but not commercially successful books
 */
function buildOverlookedPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1];

  return `Generate a curated list of exactly ${batchSize} books from ${monthName} ${year} that were culturally or historically significant but NOT commercial bestsellers.

Focus on books that:
- Influenced specific academic fields (literature, philosophy, science, politics)
- Were debut works by later-famous authors
- Were controversial, banned, or censored at the time
- Shaped subcultures, movements, or communities
- Are considered "cult classics" or "hidden gems"
- Were published by university presses or small publishers
- Won critical acclaim but not commercial success

AVOID:
- NYT Bestseller list titles
- Blockbuster commercial fiction
- Books with major movie/TV adaptations
- Household-name authors (unless it's their obscure early work)

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house name (university presses, small publishers preferred)
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why historians/scholars consider this important (1-2 sentences)

Prioritize books that historians and scholars consider important but the general public may not know.

Return ONLY a valid JSON array of exactly ${batchSize} books. No markdown, no explanations.`;
}

/**
 * Variant D: Genre Rotation
 * Deep per-genre coverage (currently defaults to Fiction)
 * TODO: Add genre parameter to rotate through different genres
 */
function buildGenrePrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1];
  const genre = 'Fiction'; // Default genre, can be parameterized later

  return `Generate a curated list of exactly ${batchSize} ${genre} books from ${monthName} ${year} that represent the best and most significant works in this genre.

Genre Focus: ${genre}

For ${genre}, prioritize:
- Genre classics and award winners
- Works that defined or influenced the genre
- Breakout debuts and cult favorites
- Both mainstream and indie/small press
- International works that reached English readers
- Diverse voices and perspectives within the genre

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house name
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why this book is significant within ${genre} (1-2 sentences)

Go DEEP on this genre rather than breadth across many categories.

Return ONLY a valid JSON array of exactly ${batchSize} books. No markdown, no explanations.`;
}

/**
 * Variant E: Era Contextualized
 * Adapt prompt based on decade context
 */
function buildEraPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1];

  // Determine era context based on decade
  let eraContext = '';
  if (year >= 1920 && year < 1940) eraContext = 'defined the modernist movement and interwar period';
  else if (year >= 1940 && year < 1960) eraContext = 'captured post-war culture and the beginning of the contemporary era';
  else if (year >= 1960 && year < 1980) eraContext = 'embodied the social revolutions and counterculture movements';
  else if (year >= 1980 && year < 2000) eraContext = 'defined the late Cold War era and rise of globalization';
  else if (year >= 2000 && year < 2010) eraContext = 'captured the post-9/11 world and early digital age';
  else if (year >= 2010 && year < 2020) eraContext = 'defined the social media era and contemporary cultural debates';
  else if (year >= 2020) eraContext = 'represent the pandemic era and current global challenges';
  else eraContext = 'are historically significant';

  return `Generate a curated list of exactly ${batchSize} books from ${monthName} ${year} that ${eraContext}.

For ${year}, focus on books that:
- Reflected the zeitgeist of the time
- Addressed era-specific themes and concerns
- Became emblematic of the period (even if not immediate bestsellers)
- Represented diverse perspectives from that era
- Are considered essential to understanding ${year}

Categories to include:
- Literary fiction and genre fiction
- Non-fiction (current events, social commentary, memoirs)
- International works
- Debut authors who later became significant

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house name
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why this book represents ${year} (1-2 sentences)

Return ONLY a valid JSON array of exactly ${batchSize} books. No markdown, no explanations.`;
}

/**
 * Variant F: ISBN Format Aware
 * Explicitly guides ISBN format expectations based on year
 */
function buildISBNFormatPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1];

  return `Generate a curated list of exactly ${batchSize} historically significant books from ${monthName} ${year}.

Categories to ensure variety:
- Award winners and literary fiction
- Commercial bestsellers
- Genre fiction (mystery, sci-fi, fantasy, romance, thriller)
- Non-fiction (memoirs, history, science, current events)
- International and translated works
- Notable debuts and indie hits

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house that released this specific edition
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why this book is historically important (1-2 sentences)

ACCURACY GUIDELINES:
- Focus on books with complete, verifiable metadata
- Publisher and format help identify the specific edition
- For major releases, assume hardcover unless known to be paperback-first

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
 * System instruction for bibliographic metadata extraction (Hybrid Workflow)
 *
 * Following bendv3 pattern of separating system instruction from user prompt
 *
 * CRITICAL: This system does NOT generate ISBNs
 * - ISBNs are resolved separately via ISBNdb API (authoritative source)
 * - Focus is on accurate title, author, publisher, format, and year metadata
 */
const SYSTEM_INSTRUCTION = `You are an expert bibliographic archivist specialized in book metadata extraction.

Your core capabilities:
- Recall culturally significant books from specific time periods
- Accurately extract bibliographic metadata (title, author, publisher)
- Identify book formats (Hardcover, Paperback, eBook, Audiobook)
- Categorize books by genre and cultural significance
- Provide historical context for why books matter

METADATA ACCURACY RULES:
1. **Title**: Use the exact title as published (include subtitles if significant)
2. **Author**: Full author name (e.g., "J.K. Rowling" not "Rowling")
3. **Publisher**: Publishing house name (e.g., "Penguin Random House", "HarperCollins", "Scholastic")
   - For major publishers, use the parent company name
   - For imprints, use the most recognizable name
4. **Format**: Primary release format for the book
   - Most literary fiction and major releases: Hardcover
   - Mass market and genre fiction: Often Paperback
   - Digital-first publications: eBook
   - When uncertain: Use "Unknown"
5. **Significance**: Brief historical context (award wins, cultural impact, sales milestones)

QUALITY OVER QUANTITY:
- Prioritize complete, accurate metadata over volume
- If uncertain about publisher or format, use best judgment based on the book's profile
- Focus on books you can confidently identify

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
      temperature: 0.1, // Ultra-low temperature for factual metadata extraction (reduced from 0.5)
      topP: 0.95, // Nucleus sampling for quality
      maxOutputTokens: 16384, // Sufficient for 20 books with rich metadata (~800 tokens/book)
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      // Note: stopSequences removed - was causing premature truncation mid-JSON response
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
 * Resolve prompt from variant name or use full prompt string
 * Supports both variant names (e.g., "diversity-emphasis") and full prompt text
 *
 * @param promptOverride - Variant name or full prompt string
 * @param year - Year for prompt generation
 * @param month - Month for prompt generation
 * @param batchSize - Batch size for prompt generation
 * @returns Resolved prompt string
 */
function resolvePrompt(
  promptOverride: string | undefined,
  year: number,
  month: number,
  batchSize: number
): string {
  if (!promptOverride) {
    return buildMonthlyPrompt(year, month, batchSize);
  }

  // Check if it's a registered variant name
  const variantName = promptOverride as PromptVariantName;
  if (variantName in PROMPT_VARIANTS) {
    return PROMPT_VARIANTS[variantName](year, month, batchSize);
  }

  // Otherwise, treat as full prompt text
  return promptOverride;
}

/**
 * Generate curated book list for a specific year/month using Gemini API
 * with native structured output and ISBN validation
 *
 * @param year - Year to generate list for
 * @param month - Month to generate list for (1-12)
 * @param env - Environment with API key
 * @param logger - Logger instance
 * @param promptOverride - Optional variant name (e.g., "diversity-emphasis") or full custom prompt
 * @returns Object containing candidates and generation stats
 */
export async function generateCuratedBookList(
  year: number,
  month: number,
  env: Env,
  logger: Logger,
  promptOverride?: string,
  batchSize: number = 20,
  modelOverride?: string
): Promise<{ candidates: ISBNCandidate[]; stats: GenerationStats }> {
  const startTime = Date.now();

  // Get API key - GEMINI_API_KEY is bound to Google_books_hardoooe which has Generative Language API access
  const apiKey = await env.GEMINI_API_KEY.get();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Select model (use override if provided, otherwise use default for monthly ops)
  const model = modelOverride || selectModelForMonthly();

  // Resolve prompt (supports variant names or full prompt strings)
  const prompt = resolvePrompt(promptOverride, year, month, batchSize);

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
  
  // Process and validate books (Hybrid Workflow)
  // Note: ISBNs will be resolved via ISBNdb in a separate step
  const stats: GenerationStats = {
    model_used: modelUsed,
    total_books: books.length,
    books_with_publisher: 0,
    books_with_significance: 0,
    format_breakdown: {
      Hardcover: 0,
      Paperback: 0,
      eBook: 0,
      Audiobook: 0,
      Unknown: 0,
    },
    duration_ms: 0,
  };

  // Temporary candidates array (will be populated with ISBNs from ISBNdb later)
  // For now, we just pass through the metadata for ISBN resolution
  const candidates: ISBNCandidate[] = [];

  for (const book of books) {
    // Track metadata completeness
    if (book.publisher) {
      stats.books_with_publisher++;
    }

    if (book.significance) {
      stats.books_with_significance++;
    }

    // Track format distribution
    stats.format_breakdown[book.format]++;

    // Store book metadata for ISBN resolution step
    // ISBN will be resolved via ISBNdb title/author search
    candidates.push({
      isbn: '', // Will be populated by ISBNdb
      title: book.title,
      authors: [book.author],
      source: `gemini-${year}-${month.toString().padStart(2, '0')}`,
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
 * Generate annual book list in batches (Hybrid Workflow)
 * For larger backfill operations covering entire years
 *
 * Note: Batch size reduced from 100 → 20 for quality
 *
 * @param year - Year to generate list for
 * @param batches - Number of batches (each returns ~20 books)
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

  // Use Flash Preview model for annual backfill (next-gen flash)
  const model = selectModelForAnnual();
  const allCandidates: ISBNCandidate[] = [];

  const aggregatedStats: GenerationStats = {
    model_used: model,
    total_books: 0,
    books_with_publisher: 0,
    books_with_significance: 0,
    format_breakdown: {
      Hardcover: 0,
      Paperback: 0,
      eBook: 0,
      Audiobook: 0,
      Unknown: 0,
    },
    duration_ms: 0,
    failed_batches: 0,
    failed_batch_errors: [],
  };

  for (let batch = 1; batch <= batches; batch++) {
    logger.info('[GeminiBackfill] Processing batch', { year, batch, total_batches: batches });

    const prompt = buildAnnualPrompt(year, batch, 20);

    try {
      // Wrap API call in retry logic for transient failures
      const books = await retryWithBackoff(
        () => callGeminiApi(prompt, apiKey, model, logger),
        3,
        1000
      );

      for (const book of books) {
        aggregatedStats.total_books++;

        // Track metadata completeness
        if (book.publisher) {
          aggregatedStats.books_with_publisher++;
        }

        if (book.significance) {
          aggregatedStats.books_with_significance++;
        }

        // Track format distribution
        aggregatedStats.format_breakdown[book.format]++;

        // Store metadata for ISBN resolution
        allCandidates.push({
          isbn: '', // Will be resolved via ISBNdb
          title: book.title,
          authors: [book.author],
          source: `gemini-annual-${year}-batch${batch}`,
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
      model: GEMINI_MODELS.FLASH,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}