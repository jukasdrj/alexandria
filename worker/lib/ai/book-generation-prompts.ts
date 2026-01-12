/**
 * Shared Book Generation Prompts & Structured Response Schemas
 *
 * Centralized prompt engineering and schema definitions for AI book generation.
 * Used by all AI providers (Gemini, Grok, future models) to ensure:
 * - Consistent prompting across providers for fair A/B testing
 * - Single source of truth for structured output schemas
 * - Easy prompt variant experimentation
 * - Provider-agnostic book metadata generation
 *
 * @module lib/ai/book-generation-prompts
 */

import { z } from 'zod';

// =================================================================================
// Structured Response Schema (Provider-Agnostic)
// =================================================================================

/**
 * Zod schema for individual book entries from AI providers
 *
 * HYBRID APPROACH:
 * - AI generates: title, author, publisher, format, publication_year, significance
 * - ISBNdb resolves: Authoritative ISBN via title/author search
 *
 * This avoids LLM ISBN hallucination while maintaining high-quality metadata
 */
export const BookMetadataSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().min(1).max(300),
  publisher: z.string().optional(),
  format: z.enum(['Hardcover', 'Paperback', 'eBook', 'Audiobook', 'Unknown']).default('Unknown'),
  publication_year: z.number().int().min(1900).max(2100),
  significance: z.string().max(500).optional(),
});

export type BookMetadata = z.infer<typeof BookMetadataSchema>;

/**
 * Response schema (array of books)
 */
export const BookMetadataArraySchema = z.array(BookMetadataSchema);

/**
 * Native structured output schema for Gemini API
 *
 * RESPONSE FORMAT: Flat array of books
 * Example: [{ title: "...", author: "...", ... }, { title: "...", ... }]
 *
 * USAGE:
 * - Set responseMimeType: 'application/json'
 * - Set responseSchema: GEMINI_RESPONSE_SCHEMA
 * - Parse response: JSON.parse(response.candidates[0].content.parts[0].text)
 * - Result is directly BookMetadata[] (no wrapper object)
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
 * JSON Schema for x.ai (Grok) structured output
 *
 * RESPONSE FORMAT: Object wrapper with books array
 * Example: { books: [{ title: "...", author: "...", ... }, { title: "...", ... }] }
 *
 * USAGE:
 * - Set response_format: { type: 'json_schema', json_schema: GROK_RESPONSE_SCHEMA }
 * - Parse response: JSON.parse(response.choices[0].message.content)
 * - Extract array: parsed.books (wrapper object with 'books' property)
 *
 * PROVIDER HANDLING:
 * - XaiProvider handles both formats: checks if parsed.books exists, otherwise uses parsed directly
 * - This provides resilience if Grok's response format changes or varies by model
 */
export const GROK_RESPONSE_SCHEMA = {
  name: 'book_metadata_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      books: {
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
          additionalProperties: false,
        },
      },
    },
    required: ['books'],
    additionalProperties: false,
  },
};

// =================================================================================
// System Instructions (Provider-Agnostic)
// =================================================================================

/**
 * System instruction for all AI book generation providers
 * Establishes role, output format, and accuracy expectations
 */
export const BOOK_GENERATION_SYSTEM_INSTRUCTION = `You are an expert bibliographic archivist specialized in book metadata extraction.

Your role is to generate accurate, complete book metadata based on historical significance and cultural impact.

CRITICAL REQUIREMENTS:
1. **Accuracy First**: Only include books you can confidently identify with complete metadata
2. **No Hallucinations**: Do not invent ISBNs, publishers, or formats if uncertain
3. **Complete Metadata**: Every book must have title, author, format, and publication year
4. **Historical Accuracy**: Focus on books that were actually published in the specified time period
5. **Cultural Significance**: Prioritize books with lasting impact, awards, or critical acclaim

OUTPUT FORMAT:
- Return ONLY valid JSON (no markdown, no code blocks, no explanations)
- Array of book objects with specified fields
- Use "Unknown" for format if uncertain (don't guess)`;

// =================================================================================
// Prompt Variants (Provider-Agnostic)
// =================================================================================

/**
 * Baseline prompt for monthly book generation
 * Optimized for 90% ISBN resolution rate with ISBNdb
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
3. **publisher**: Publishing house name
4. **publication_year**: ${year}
5. **significance** (optional): Why this book is historically important (1-2 sentences)

Return ONLY a valid JSON array of exactly ${batchSize} books.`;
}

/**
 * Annual significance prompt for year-based generation
 * Used for large-scale backfills (100+ books per year)
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

Return ONLY a valid JSON array of exactly ${batchSize} books.`;
}

/**
 * Diversity-emphasis prompt variant
 * Prioritizes non-English, indie publishers, underrepresented regions
 */
function buildDiversityPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
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

Return ONLY a valid JSON array of exactly ${batchSize} books.`;
}

/**
 * Overlooked significance prompt variant
 * Focus on culturally important but not commercially successful books
 */
function buildOverlookedPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1];

  return `Generate a curated list of exactly ${batchSize} books from ${monthName} ${year} that were culturally or historically significant but NOT commercial bestsellers.

TARGET BOOKS:
- Critical darlings that didn't sell well initially
- Award-nominated works that weren't bestsellers
- Genre-influential books that shaped later trends
- Academic or intellectual works with lasting impact
- Cult classics discovered later
- Books that mattered to specific communities but not mainstream

AVOID:
- NYT Bestseller list books
- Books with massive print runs (>100K first printing)
- Movie tie-ins or celebrity books
- Books everyone has heard of

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house name
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why this book matters despite low sales (1-2 sentences)

Return ONLY a valid JSON array of exactly ${batchSize} books.`;
}

/**
 * Genre-rotation prompt variant
 * Cycles through genres for balanced diversity
 */
function buildGenrePrompt(year: number, month: number, batchSize: number = 20, genre?: string): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1];

  // Auto-rotate genre based on month if not specified
  const genres = ['literary fiction', 'mystery', 'science fiction', 'fantasy', 'romance', 'thriller',
                  'historical fiction', 'non-fiction', 'biography', 'science', 'self-help', 'history'];
  const selectedGenre = genre || genres[month % genres.length];

  return `Generate a curated list of exactly ${batchSize} ${selectedGenre} books from ${monthName} ${year} that represent the best and most significant works in this genre.

GENRE FOCUS: ${selectedGenre}
- Include award winners and nominees for genre-specific awards
- Include breakout hits that defined or expanded the genre
- Include critically acclaimed works even if not commercial successes
- Include international works if they reached English-speaking markets

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house name
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): Why this book matters in the ${selectedGenre} genre (1-2 sentences)

Return ONLY a valid JSON array of exactly ${batchSize} books.`;
}

/**
 * Era-contextualized prompt variant
 * Emphasizes books that reflected or shaped their era's cultural moment
 */
function buildEraPrompt(year: number, month: number, batchSize: number = 20): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1];

  // Era context based on decade
  const decade = Math.floor(year / 10) * 10;
  let eraContext = '';
  if (year >= 2020) {
    eraContext = 'responded to the COVID-19 pandemic, social justice movements, or digital transformation';
  } else if (year >= 2010) {
    eraContext = 'engaged with the digital age, social media culture, or economic uncertainty';
  } else if (year >= 2000) {
    eraContext = 'addressed post-9/11 concerns, the War on Terror, or early internet culture';
  } else if (year >= 1990) {
    eraContext = 'reflected the end of the Cold War, tech boom, or cultural shifts of the 1990s';
  } else if (year >= 1980) {
    eraContext = 'captured the Reagan era, Cold War tensions, or emergence of personal computing';
  } else {
    eraContext = `captured the cultural and political landscape of the ${decade}s`;
  }

  return `Generate a curated list of exactly ${batchSize} books from ${monthName} ${year} that ${eraContext}.

ERA EMPHASIS:
- Books that directly engaged with contemporary events
- Works that shaped cultural conversations of their time
- Books that now serve as historical documents of the era
- Genre fiction that reflected societal anxieties or hopes
- Non-fiction that addressed pressing issues of the period

METADATA REQUIREMENTS for each book:
1. **title**: Full book title (exact as published)
2. **author**: Primary author's name (full name preferred)
3. **publisher**: Publishing house name
4. **format**: Primary format ("Hardcover", "Paperback", "eBook", "Audiobook", or "Unknown")
5. **publication_year**: ${year}
6. **significance** (optional): How this book reflected or shaped the era (1-2 sentences)

Return ONLY a valid JSON array of exactly ${batchSize} books.`;
}

// =================================================================================
// Prompt Variant Registry
// =================================================================================

/**
 * Registered prompt variants for A/B testing
 * All variants available to all AI providers (Gemini, Grok, etc.)
 */
export const PROMPT_VARIANTS = {
  baseline: buildMonthlyPrompt,
  annual: buildAnnualPrompt,
  'diversity-emphasis': buildDiversityPrompt,
  'overlooked-significance': buildOverlookedPrompt,
  'genre-rotation': buildGenrePrompt,
  'era-contextualized': buildEraPrompt,
} as const;

export type PromptVariantName = keyof typeof PROMPT_VARIANTS;

// =================================================================================
// Provider Configuration (Model-Specific Tuning)
// =================================================================================

/**
 * Generation configuration per provider
 * Optimized based on provider-specific testing
 */
export const PROVIDER_GENERATION_CONFIG = {
  gemini: {
    temperature: 0.1, // Ultra-low for factual metadata
    topP: 0.95,
    maxOutputTokens: 16384, // ~800 tokens/book × 20 books
  },
  xai: {
    temperature: 0.2, // Slightly higher based on Grok testing
    topP: 0.95,
    maxTokens: 16384,
  },
} as const;

// =================================================================================
// Utility Functions
// =================================================================================

/**
 * Resolve prompt from registered variant name
 *
 * SECURITY: Only accepts registered variant names to prevent prompt injection attacks.
 * Custom prompts are NOT supported to maintain data quality and prevent malicious input.
 *
 * @param promptVariant - Variant name (e.g., "baseline", "diversity-emphasis")
 * @param year - Year for prompt generation
 * @param month - Month for prompt generation (1-12)
 * @param batchSize - Number of books to generate
 * @returns Resolved prompt string
 * @throws Error if variant name is invalid
 */
export function resolvePrompt(
  promptVariant: string | undefined,
  year: number,
  month: number,
  batchSize: number
): string {
  // Default to baseline if not specified
  if (!promptVariant) {
    return buildMonthlyPrompt(year, month, batchSize);
  }

  // ONLY allow registered variants (security: prevent prompt injection)
  const variantName = promptVariant as PromptVariantName;
  if (variantName in PROMPT_VARIANTS) {
    // Special handling for annual prompt which requires batchNumber
    if (variantName === 'annual') {
      // For monthly calls, use batch 1
      return PROMPT_VARIANTS.annual(year, 1, batchSize);
    }
    return PROMPT_VARIANTS[variantName](year, month, batchSize);
  }

  // Reject unknown variants to prevent prompt injection
  const validVariants = Object.keys(PROMPT_VARIANTS).join(', ');
  throw new Error(
    `Invalid prompt variant: "${promptVariant}". Valid variants: ${validVariants}`
  );
}

/**
 * Get generation config for specific provider
 *
 * @param provider - Provider name ('gemini' or 'xai')
 * @returns Generation configuration object
 */
export function getGenerationConfig(provider: 'gemini' | 'xai') {
  return PROVIDER_GENERATION_CONFIG[provider];
}
