/**
 * Harvest API Routes - Scheduled Cover Harvesting
 *
 * Provides:
 * - GET /api/harvest/quota - Check ISBNdb quota status
 * - Scheduled handler for cover harvesting (cron trigger)
 *
 * Note: POST /api/harvest/covers is in enrich.ts to keep all enrichment logic together
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppBindings, Env } from '../env.js';
import postgres from 'postgres';
import { fetchISBNdbBatch } from '../../services/batch-isbndb.js';
import { QuotaManager } from '../services/quota-manager.js';
import { parseHarvestConfig, buildISBNPrefixFilter } from '../lib/harvest-config.js';
import { batchUpdateCoverUrls } from '../services/batch-operations.js';
import type { Logger } from '../../lib/logger.js';
import { HarvestState } from '../services/harvest-state.js';
import { deduplicateISBNs, type ISBNCandidate } from '../services/deduplication.js';
import { enrichEdition } from '../services/enrichment-service.js';
import type { EnrichEditionRequest } from '../services/types.js';

const app = new OpenAPIHono<AppBindings>();

// =================================================================================
// Schemas
// =================================================================================

const QuotaStatusResponseSchema = z.object({
  used_today: z.number(),
  remaining: z.number(),
  limit: z.number(),
  last_reset: z.string().nullable(),
  next_reset_in_hours: z.number(),
});

const BackfillStatusResponseSchema = z.object({
  summary: z.object({
    years_total: z.number(),
    years_completed: z.number(),
    years_in_progress: z.number(),
    total_books: z.number(),
    total_covers: z.number(),
    total_quota_used: z.number(),
  }),
  incomplete_years: z.array(z.number()),
  next_target: z.object({
    year: z.number(),
    month: z.number(),
  }).nullable(),
});

const BackfillRequestSchema = z.object({
  year: z.number().int().min(2005).max(2030).optional()
    .describe('Specific year to backfill (2005-2030). If omitted, processes next incomplete year.'),
  month: z.number().int().min(1).max(12).optional()
    .describe('Specific month to backfill (1-12). If omitted, processes next incomplete month.'),
  max_quota: z.number().int().min(1).max(1000).default(100)
    .describe('Maximum ISBNdb API calls to use for this backfill (default: 100)'),
});

const BackfillResponseSchema = z.object({
  success: z.boolean(),
  year: z.number(),
  month: z.number(),
  stats: z.object({
    total_isbns: z.number(),
    unique_isbns: z.number(),
    duplicate_exact: z.number(),
    duplicate_related: z.number(),
    duplicate_fuzzy: z.number(),
    editions_enriched: z.number(),
    covers_queued: z.number(),
    quota_used: z.number(),
  }),
  progress: z.object({
    months_completed: z.array(z.number()),
    year_is_complete: z.boolean(),
  }),
  quota_status: z.object({
    used_today: z.number(),
    remaining: z.number(),
  }),
  duration_ms: z.number(),
});

// =================================================================================
// GET /api/harvest/quota - Check quota status
// =================================================================================

const quotaStatusRoute = createRoute({
  method: 'get',
  path: '/api/harvest/quota',
  tags: ['Harvest'],
  summary: 'Check Quota Status',
  description: 'Returns current ISBNdb API quota usage and remaining calls for the day.',
  responses: {
    200: {
      description: 'Quota status',
      content: {
        'application/json': {
          schema: QuotaStatusResponseSchema,
        },
      },
    },
  },
});

app.openapi(quotaStatusRoute, async (c) => {
  const quotaManager = new QuotaManager(c.env.QUOTA_KV);
  const status = await quotaManager.getQuotaStatus();

  return c.json({
    used_today: status.used_today,
    remaining: status.remaining,
    limit: status.limit,
    last_reset: status.last_reset,
    next_reset_in_hours: status.next_reset_in_hours,
  });
});

// =================================================================================
// GET /api/harvest/backfill/status - Check backfill progress
// =================================================================================

const backfillStatusRoute = createRoute({
  method: 'get',
  path: '/api/harvest/backfill/status',
  tags: ['Harvest'],
  summary: 'Check Backfill Status',
  description: 'Returns progress summary for historical book backfill (2005-present).',
  responses: {
    200: {
      description: 'Backfill status',
      content: {
        'application/json': {
          schema: BackfillStatusResponseSchema,
        },
      },
    },
  },
});

app.openapi(backfillStatusRoute, async (c) => {
  const logger = c.get('logger');
  const harvestState = new HarvestState(c.env.QUOTA_KV, logger);

  // Get summary statistics
  const summary = await harvestState.getSummary();

  // Get incomplete years
  const incompleteYears = await harvestState.getIncompleteYears(2005, new Date().getFullYear());

  // Determine next target
  let nextTarget = null;
  if (incompleteYears.length > 0) {
    const nextYear = incompleteYears[0];
    const nextMonth = await harvestState.getNextMonth(nextYear);
    if (nextMonth) {
      nextTarget = { year: nextYear, month: nextMonth };
    }
  }

  return c.json({
    summary,
    incomplete_years: incompleteYears,
    next_target: nextTarget,
  });
});

// =================================================================================
// POST /api/harvest/backfill - Historical book backfill
// =================================================================================

const backfillRoute = createRoute({
  method: 'post',
  path: '/api/harvest/backfill',
  tags: ['Harvest'],
  summary: 'Backfill Historical Books',
  description: 'Fetch and enrich top 1,000 books for a specific year/month using Gemini-curated lists. Uses 3-tier deduplication to avoid re-enriching existing books.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BackfillRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Backfill completed successfully',
      content: {
        'application/json': {
          schema: BackfillResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request (month already complete, quota exhausted, etc.)',
    },
    500: {
      description: 'Internal server error',
    },
  },
});

app.openapi(backfillRoute, async (c) => {
  const startTime = Date.now();
  const logger = c.get('logger');
  const sql = c.get('sql');

  // Parse request
  const body = c.req.valid('json');
  const requestedYear = body.year;
  const requestedMonth = body.month;
  const maxQuota = body.max_quota || 100;

  // Initialize services
  const quotaManager = new QuotaManager(c.env.QUOTA_KV);
  const harvestState = new HarvestState(c.env.QUOTA_KV, logger);

  // Check quota before starting
  const quotaCheck = await quotaManager.shouldAllowOperation('backfill', maxQuota);
  if (!quotaCheck.allowed) {
    logger.warn('[Backfill] Quota check failed', {
      reason: quotaCheck.reason,
      max_quota: maxQuota,
    });
    return c.json({
      success: false,
      error: 'Insufficient quota',
      quota_status: quotaCheck.status,
    }, 400);
  }

  // Determine year/month to process
  let year = requestedYear;
  let month = requestedMonth;

  if (!year) {
    // Get next incomplete year
    const incompleteYears = await harvestState.getIncompleteYears(2005, new Date().getFullYear());
    if (incompleteYears.length === 0) {
      return c.json({
        success: false,
        error: 'All years complete (2005-present)',
      }, 400);
    }
    year = incompleteYears[0];
  }

  if (!month) {
    // Get next incomplete month for this year
    const nextMonth = await harvestState.getNextMonth(year);
    if (!nextMonth) {
      return c.json({
        success: false,
        error: `Year ${year} is already complete`,
      }, 400);
    }
    month = nextMonth;
  }

  // Check if month already completed (idempotency)
  const isComplete = await harvestState.isMonthComplete(year, month);
  if (isComplete) {
    logger.warn('[Backfill] Month already complete', { year, month });
    return c.json({
      success: false,
      error: `${year}-${month.toString().padStart(2, '0')} already backfilled`,
    }, 400);
  }

  logger.info('[Backfill] Starting backfill', { year, month, max_quota: maxQuota });

  try {
    // Call Gemini API to get curated book list for year/month
    const curatedBooks: ISBNCandidate[] = await generateCuratedBookList(
      year,
      month,
      c.env,
      logger
    );

    if (curatedBooks.length === 0) {
      logger.warn('[Backfill] No books found for period', { year, month });
      return c.json({
        success: false,
        error: 'No books found for this period',
      }, 400);
    }

    logger.info('[Backfill] Generated book list', {
      year,
      month,
      total_books: curatedBooks.length,
    });

    // Step 1: Deduplicate (3-tier: exact → related → fuzzy)
    const dedupResult = await deduplicateISBNs(sql, curatedBooks, logger);

    logger.info('[Backfill] Deduplication complete', {
      total: dedupResult.stats.total,
      unique: dedupResult.stats.unique,
      duplicates: dedupResult.stats.total - dedupResult.stats.unique,
    });

    // Step 2: Fetch ISBNdb data in batches (1000 ISBNs per call)
    const isbnsToEnrich = dedupResult.toEnrich;
    const batchSize = 1000;
    const batches = Math.ceil(isbnsToEnrich.length / batchSize);
    const quotaToUse = Math.min(batches, maxQuota);

    logger.info('[Backfill] Fetching ISBNdb data', {
      total_isbns: isbnsToEnrich.length,
      batches_needed: batches,
      quota_to_use: quotaToUse,
    });

    let editionsEnriched = 0;
    let coversQueued = 0;
    let quotaUsed = 0;

    for (let i = 0; i < quotaToUse; i++) {
      const batchStart = i * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, isbnsToEnrich.length);
      const batchIsbns = isbnsToEnrich.slice(batchStart, batchEnd);

      // Fetch from ISBNdb
      const batchData = await fetchISBNdbBatch(batchIsbns, c.env);

      // Record quota usage immediately (before processing) to avoid loss on crash
      await quotaManager.recordApiCall(1);
      quotaUsed++;

      // Enrich editions
      for (const [isbn, externalData] of batchData) {
        try {
          // Convert ExternalBookData to EnrichEditionRequest
          const editionRequest: EnrichEditionRequest = {
            isbn: externalData.isbn,
            work_key: externalData.workKey,
            title: externalData.title,
            subtitle: externalData.subtitle,
            publisher: externalData.publisher,
            publication_date: externalData.publicationDate,
            page_count: externalData.pageCount,
            format: externalData.binding, // ISBNdb uses 'binding' field
            language: externalData.language,
            cover_urls: externalData.coverUrls,
            cover_source: externalData.provider,
            primary_provider: externalData.provider,
          };

          await enrichEdition(sql, editionRequest, logger, c.env);
          editionsEnriched++;

          // Queue cover download if available
          const coverUrl = externalData.coverUrls?.original || externalData.coverUrls?.large;
          if (coverUrl) {
            await c.env.COVER_QUEUE.send({
              isbn,
              provider_url: coverUrl,
              priority: 'low', // Backfill has lower priority than user requests
              source: 'backfill',
            });
            coversQueued++;
          }
        } catch (error) {
          logger.error('[Backfill] Failed to enrich edition', {
            isbn,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Step 3: Record month completion
    const progressResult = await harvestState.recordMonthComplete(year, month, {
      total_isbns: curatedBooks.length,
      unique_isbns: dedupResult.toEnrich.length,
      duplicate_isbns: curatedBooks.length - dedupResult.toEnrich.length,
      covers_harvested: coversQueued,
      quota_used: quotaUsed,
    });

    // Get updated year progress to retrieve actual months_completed
    const yearProgress = await harvestState.getYearProgress(year);

    // Get updated quota status
    const updatedQuota = await quotaManager.getQuotaStatus();

    const duration = Date.now() - startTime;

    logger.info('[Backfill] Complete', {
      year,
      month,
      total_isbns: curatedBooks.length,
      unique_isbns: dedupResult.toEnrich.length,
      editions_enriched: editionsEnriched,
      covers_queued: coversQueued,
      quota_used: quotaUsed,
      year_is_complete: progressResult.year_is_complete,
      duration_ms: duration,
    });

    return c.json({
      success: true,
      year,
      month,
      stats: {
        total_isbns: curatedBooks.length,
        unique_isbns: dedupResult.toEnrich.length,
        duplicate_exact: dedupResult.stats.duplicate_exact,
        duplicate_related: dedupResult.stats.duplicate_related,
        duplicate_fuzzy: dedupResult.stats.duplicate_fuzzy,
        editions_enriched: editionsEnriched,
        covers_queued: coversQueued,
        quota_used: quotaUsed,
      },
      progress: {
        months_completed: yearProgress?.months_completed || [],
        year_is_complete: progressResult.year_is_complete,
      },
      quota_status: {
        used_today: updatedQuota.used_today,
        remaining: updatedQuota.buffer_remaining,
      },
      duration_ms: duration,
    });

  } catch (error) {
    logger.error('[Backfill] Failed', {
      year,
      month,
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Zod schema for validating Gemini API book responses
 */
const GeminiBookSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().min(1).max(200),
  isbn: z.string().regex(/^\d{10,13}$/).optional(),
});

const GeminiResponseSchema = z.array(GeminiBookSchema);

/**
 * Generate curated book list for a specific year/month using Gemini API
 *
 * Prompts Gemini to suggest ~100 culturally significant, bestselling, or
 * award-winning books from the specified period.
 *
 * @param year - Year to generate list for
 * @param month - Month to generate list for (1-12)
 * @param env - Environment with GEMINI_API_KEY secret
 * @param logger - Logger instance
 * @returns Array of ISBNCandidate objects
 */
async function generateCuratedBookList(
  year: number,
  month: number,
  env: Env,
  logger: Logger
): Promise<ISBNCandidate[]> {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1];

  const prompt = `Generate a curated list of approximately 100 culturally significant, bestselling, or award-winning books published or prominently featured in ${monthName} ${year}.

Include:
- NYT Bestsellers from this period
- Award winners (Pulitzer, Booker, National Book Award, etc.)
- Debut novels that made an impact
- Popular genre fiction (mystery, romance, sci-fi, fantasy)
- Notable non-fiction (memoirs, history, science)
- International literature that gained prominence in English-speaking markets

For each book, provide:
- title (required)
- author (required, use primary author for multi-author works)
- isbn (ISBN-13 preferred, ISBN-10 acceptable, omit if unknown)

Return ONLY a JSON array of book objects. No markdown formatting, no explanations.
Example format:
[
  {"title": "The Martian", "author": "Andy Weir", "isbn": "9780553418026"},
  {"title": "All the Light We Cannot See", "author": "Anthony Doerr"}
]`;

  try {
    // Get Gemini API key from secrets
    const geminiApiKey = await env.GEMINI_API_KEY.get();
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No response text from Gemini API');
    }

    // Strip markdown code blocks if present (Gemini sometimes wraps JSON)
    const cleanedText = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    // Parse and validate JSON response with Zod
    let books: z.infer<typeof GeminiResponseSchema>;
    try {
      const parsed = JSON.parse(cleanedText);
      books = GeminiResponseSchema.parse(parsed);
    } catch (parseError) {
      logger.error('[GenerateCuratedList] Invalid Gemini response format', {
        year,
        month,
        text: cleanedText.substring(0, 200), // Log first 200 chars for debugging
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return [];
    }

    // Convert to ISBNCandidate format
    const candidates: ISBNCandidate[] = books
      .filter(b => b.isbn) // Only include books with ISBNs
      .map(b => ({
        isbn: b.isbn!,
        title: b.title,
        authors: [b.author],
        source: `gemini-${year}-${month.toString().padStart(2, '0')}`,
      }));

    logger.info('[GenerateCuratedList] Generated book list', {
      year,
      month,
      total_books: books.length,
      with_isbn: candidates.length,
    });

    return candidates;

  } catch (error) {
    logger.error('[GenerateCuratedList] Failed to generate list', {
      year,
      month,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// =================================================================================
// Scheduled Handler (called by cron every 5 minutes)
// =================================================================================

/**
 * Handle scheduled cover harvest
 * Runs every 5 minutes via cron trigger (every-5-minutes pattern)
 *
 * Strategy:
 * - Initialize QuotaManager to check ISBNdb quota
 * - Queries enriched_editions for OpenLibrary editions missing covers
 * - Filters to 2000-present (past 25 years)
 * - Batches 1000 ISBNs per ISBNdb API call
 * - Updates editions with cover URLs
 * - Queues cover downloads for WebP processing
 * - Records API calls in quota manager
 */
export async function handleScheduledCoverHarvest(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[CoverHarvest:Scheduled] Starting scheduled harvest');

  // Parse harvest configuration
  const harvestConfig = parseHarvestConfig(env);

  // Initialize QuotaManager
  const quotaManager = new QuotaManager(env.QUOTA_KV);

  // Check quota before starting
  const quotaCheck = await quotaManager.shouldAllowOperation('cron', 1);
  if (!quotaCheck.allowed) {
    console.warn('[CoverHarvest:Scheduled] Quota check failed, skipping', {
      reason: quotaCheck.reason,
      status: quotaCheck.status,
    });
    return;
  }

  console.log('[CoverHarvest:Scheduled] Quota check passed', {
    used_today: quotaCheck.status.used_today,
    remaining: quotaCheck.status.buffer_remaining,
    limit: quotaCheck.status.limit,
  });

  // Create database connection
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  try {
    // Build ISBN prefix filter
    const isbnPrefixFilter = buildISBNPrefixFilter(harvestConfig.isbnPrefixes);

    // Build year pattern for regex
    const yearPattern = `^(${Array.from(
      { length: harvestConfig.maxYear - harvestConfig.minYear + 1 },
      (_, i) => harvestConfig.minYear + i
    ).join('|')})$`;

    // Query OpenLibrary editions without covers
    const editionsResult = await sql`
      SELECT isbn
      FROM enriched_editions
      WHERE primary_provider = 'openlibrary'
        AND cover_url_large IS NULL
        AND isbn IS NOT NULL
        AND LENGTH(isbn) = 13
        AND (${sql.unsafe(isbnPrefixFilter)})
        AND publication_date ~ ${yearPattern}
      ORDER BY ${sql.unsafe(harvestConfig.sortBy)} DESC NULLS LAST
      LIMIT ${harvestConfig.batchSize}
    `;

    const isbns = (editionsResult as unknown as { isbn: string }[]).map(row => row.isbn);

    if (isbns.length === 0) {
      console.log('[CoverHarvest:Scheduled] No editions found needing covers');
      return;
    }

    console.log('[CoverHarvest:Scheduled] Found editions to process', { count: isbns.length });

    // Fetch from ISBNdb (single API call for up to 1000 ISBNs)
    const batchData = await fetchISBNdbBatch(isbns, env);

    // Record API call in quota manager
    await quotaManager.recordApiCall(1);

    let coversQueued = 0;
    let noCoverUrl = 0;

    // Prepare batch updates
    const updates = [];
    for (const [isbn, data] of batchData) {
      const coverUrl = data.coverUrls?.original || data.coverUrls?.large;

      if (!coverUrl) {
        noCoverUrl++;
        continue;
      }

      updates.push({
        isbn,
        cover_url_large: data.coverUrls?.large || coverUrl,
        cover_url_medium: data.coverUrls?.medium || coverUrl,
        cover_url_small: data.coverUrls?.small || coverUrl,
        cover_url_original: data.coverUrls?.original || null,
        cover_source: 'isbndb',
      });
    }

    // Batch update all editions
    const simpleLogger: Logger = {
      info: (msg: string, meta?: unknown) => console.log(`[INFO] ${msg}`, meta),
      error: (msg: string, meta?: unknown) => console.error(`[ERROR] ${msg}`, meta),
      warn: (msg: string, meta?: unknown) => console.warn(`[WARN] ${msg}`, meta),
      debug: (msg: string, meta?: unknown) => console.debug(`[DEBUG] ${msg}`, meta),
    };

    const batchResult = await batchUpdateCoverUrls(sql, updates, simpleLogger);

    // Queue cover downloads
    for (const update of updates) {
      try {
        await env.COVER_QUEUE.send({
          isbn: update.isbn,
          provider_url: update.cover_url_original || update.cover_url_large,
          priority: 'normal',
          source: 'scheduled_harvest',
        });
        coversQueued++;
      } catch (error) {
        console.error('[CoverHarvest:Scheduled] Queue failed', {
          isbn: update.isbn,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Get updated quota status for logging
    const updatedQuota = await quotaManager.getQuotaStatus();

    console.log('[CoverHarvest:Scheduled] Complete', {
      isbns_queried: isbns.length,
      found_in_isbndb: batchData.size,
      editions_updated: batchResult.rows_affected,
      covers_queued: coversQueued,
      no_cover_url: noCoverUrl,
      batch_duration_ms: batchResult.duration_ms,
      chunks_processed: batchResult.chunks_processed,
      duration_ms: Date.now() - startTime,
      quota_used_today: updatedQuota.used_today,
      quota_remaining: updatedQuota.buffer_remaining,
    });

  } catch (error) {
    console.error('[CoverHarvest:Scheduled] Failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await sql.end();
  }
}

export default app;
