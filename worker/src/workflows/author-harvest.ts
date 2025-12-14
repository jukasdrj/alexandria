/**
 * Alexandria Author Harvest Workflow
 *
 * Cloudflare Workflow for durable, auto-recovering author bibliography harvesting.
 * Migrated from scripts/bulk-author-harvest.js to solve:
 * - Local machine dependency (laptop must stay running)
 * - Manual checkpoint management
 * - ISBNdb JWT expiry (cover URLs expire after 2 hours)
 * - No auto-recovery from crashes
 *
 * IMPORTANT: Cloudflare Workflows has a 1000 subrequest limit per invocation.
 * We batch authors to stay under this limit (10 authors per batch = ~300 subrequests).
 *
 * @see https://developers.cloudflare.com/workflows/
 * @see https://developers.cloudflare.com/workers/platform/limits/#how-many-subrequests-can-i-make
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import postgres from 'postgres';
import type { Env } from '../env.js';
import { fetchAuthorBibliography } from '../services/isbndb-author.js';
import { enrichWork, enrichEdition } from '../services/enrichment-service.js';
import { formatPgArray } from '../services/utils.js';

// Cloudflare Workflows has a 1000 subrequest limit per INVOCATION (not per step)
// Each author = ~1 ISBNdb call + ~8 DB operations + ~5 queue sends = ~14 subrequests
// Safe limit: 40 authors * 14 = ~560 subrequests, plus workflow overhead = ~700 total
const MAX_AUTHORS_PER_WORKFLOW = 40;
const AUTHORS_PER_BATCH = 10;

// Cache for author lookups within a batch (reduces DB queries)
const authorKeyCache = new Map<string, string>();

// Cache for work lookups (ISBN → work_key)
const workKeyCache = new Map<string, string>();

/**
 * Find or create an author by name, returning the author_key
 * EXPORTED for use in routes/authors.ts
 */
export async function findOrCreateAuthor(
  sql: ReturnType<typeof postgres>,
  authorName: string
): Promise<string> {
  // Check cache first
  const cached = authorKeyCache.get(authorName.toLowerCase());
  if (cached) return cached;

  // Try exact match first (fast)
  const exactMatch = await sql`
    SELECT author_key FROM enriched_authors
    WHERE LOWER(name) = ${authorName.toLowerCase()}
    LIMIT 1
  `;

  if (exactMatch.length > 0) {
    const key = (exactMatch[0] as { author_key: string }).author_key;
    authorKeyCache.set(authorName.toLowerCase(), key);
    return key;
  }

  // Try fuzzy match with pg_trgm (slower but catches variations)
  const fuzzyMatch = await sql`
    SELECT author_key, name, similarity(LOWER(name), ${authorName.toLowerCase()}) as sim
    FROM enriched_authors
    WHERE LOWER(name) % ${authorName.toLowerCase()}
    ORDER BY sim DESC
    LIMIT 1
  `;

  if (fuzzyMatch.length > 0 && (fuzzyMatch[0] as { sim: number }).sim > 0.7) {
    const key = (fuzzyMatch[0] as { author_key: string }).author_key;
    authorKeyCache.set(authorName.toLowerCase(), key);
    return key;
  }

  // Create new author
  const newKey = `/authors/isbndb-${crypto.randomUUID().slice(0, 8)}`;
  await sql`
    INSERT INTO enriched_authors (author_key, name, primary_provider, created_at, updated_at)
    VALUES (${newKey}, ${authorName}, 'isbndb', NOW(), NOW())
    ON CONFLICT (author_key) DO NOTHING
  `;

  authorKeyCache.set(authorName.toLowerCase(), newKey);
  return newKey;
}

/**
 * Link a work to its authors in work_authors_enriched
 * Uses ON CONFLICT DO NOTHING for idempotency (safe to call multiple times)
 * EXPORTED for use in routes/authors.ts
 */
export async function linkWorkToAuthors(
  sql: ReturnType<typeof postgres>,
  workKey: string,
  authorNames: string[]
): Promise<void> {
  for (let i = 0; i < authorNames.length; i++) {
    const authorKey = await findOrCreateAuthor(sql, authorNames[i]);
    await sql`
      INSERT INTO work_authors_enriched (work_key, author_key, author_order)
      VALUES (${workKey}, ${authorKey}, ${i + 1})
      ON CONFLICT (work_key, author_key) DO NOTHING
    `;
  }
}

/**
 * Find or create a work by ISBN/title/authors, returning work_key and whether it's new
 *
 * Resolution order (consensus-driven):
 * 1. ISBN lookup - check if edition already exists with work_key (most accurate)
 * 2. Author-scoped fuzzy title match - find work by same author with similar title (0.8 threshold)
 * 3. Exact title match - fallback for works without author links yet (risky for common titles)
 * 4. Generate new synthetic key - only if no match found
 *
 * EXPORTED for use in routes/authors.ts
 */
export async function findOrCreateWork(
  sql: ReturnType<typeof postgres>,
  isbn: string,
  title: string,
  authorNames: string[]
): Promise<{ workKey: string; isNew: boolean }> {
  // Check cache first (ISBN → work_key)
  const cached = workKeyCache.get(isbn);
  if (cached) {
    return { workKey: cached, isNew: false };
  }

  // Step 0: Check if edition already exists with a work_key (ISBN is most accurate)
  const existingEdition = await sql`
    SELECT work_key FROM enriched_editions
    WHERE isbn = ${isbn} AND work_key IS NOT NULL
    LIMIT 1
  `;
  if (existingEdition.length > 0) {
    const workKey = (existingEdition[0] as { work_key: string }).work_key;
    workKeyCache.set(isbn, workKey);
    return { workKey, isNew: false };
  }

  // Step 1: Author-scoped fuzzy title match (if we have authors)
  if (authorNames && authorNames.length > 0) {
    // Get or create author keys first
    const authorKeys = await Promise.all(
      authorNames.slice(0, 3).map(name => findOrCreateAuthor(sql, name)) // Limit to first 3 authors
    );

    // Format author keys as PostgreSQL array literal for ANY() clause
    const authorKeysArray = formatPgArray(authorKeys);
    const existingWork = authorKeysArray ? await sql`
      SELECT ew.work_key, similarity(LOWER(ew.title), ${title.toLowerCase()}) as sim
      FROM enriched_works ew
      JOIN work_authors_enriched wae ON ew.work_key = wae.work_key
      WHERE wae.author_key = ANY(${authorKeysArray}::text[])
        AND similarity(LOWER(ew.title), ${title.toLowerCase()}) > 0.8
      ORDER BY sim DESC
      LIMIT 1
    ` : [];
    if (existingWork.length > 0) {
      const workKey = (existingWork[0] as { work_key: string }).work_key;
      workKeyCache.set(isbn, workKey);
      return { workKey, isNew: false };
    }
  }

  // Step 2: Exact title match fallback (use with caution - common titles may collide)
  // Only use exact match, not fuzzy, to reduce false positives
  const exactMatch = await sql`
    SELECT work_key FROM enriched_works
    WHERE LOWER(title) = ${title.toLowerCase()}
    LIMIT 1
  `;
  if (exactMatch.length > 0) {
    const workKey = (exactMatch[0] as { work_key: string }).work_key;
    workKeyCache.set(isbn, workKey);
    return { workKey, isNew: false };
  }

  // Step 3: Generate new synthetic key
  const newKey = `/works/isbndb-${crypto.randomUUID().slice(0, 8)}`;
  workKeyCache.set(isbn, newKey);
  return { workKey: newKey, isNew: true };
}

// Tier definitions based on edition count
const TIERS = {
  'top-10': { offset: 0, limit: 10 },
  'top-100': { offset: 0, limit: 100 },
  'top-1000': { offset: 0, limit: 1000 },
  '1000-5000': { offset: 1000, limit: 4000 },
  '5000-20000': { offset: 5000, limit: 15000 },
  'curated': { offset: 0, limit: 0 }, // Special tier for curated lists
} as const;

type TierName = keyof typeof TIERS;

export interface AuthorHarvestParams {
  /** Tier to process (top-10, top-100, top-1000, curated, etc.) */
  tier: TierName;
  /** Override offset from tier default */
  offset?: number;
  /** Override limit from tier default */
  limit?: number;
  /** Maximum pages per author (default: 1 for breadth-first) */
  maxPagesPerAuthor?: number;
  /** Resume from specific batch index (for crash recovery) */
  resumeFromBatch?: number;
  /** Curated list of author names (used when tier='curated') */
  curatedAuthors?: string[];
  /** Name of the curated list for logging */
  curatedListName?: string;
}

interface Author {
  author_name: string;
  work_count: number;
}

interface AuthorResult {
  author: string;
  books_found: number;
  newly_enriched: number;
  covers_queued: number;
  error?: string;
}

interface BatchResult {
  authors_processed: number;
  authors_failed: number;
  total_books_found: number;
  total_enriched: number;
  total_covers_queued: number;
  quota_exhausted: boolean;
  errors: Array<{ author: string; error: string }>;
}

interface WorkflowResult {
  status: 'complete' | 'partial' | 'failed';
  tier: TierName;
  authors_processed: number;
  authors_failed: number;
  authors_skipped: number;
  total_books_found: number;
  total_enriched: number;
  total_covers_queued: number;
  cache_hits: number;
  duration_ms: number;
  errors: Array<{ author: string; error: string }>;
  next_offset?: number;
}

/**
 * AuthorHarvestWorkflow - Durable workflow for bulk author harvesting
 *
 * Each step is automatically persisted and retried on failure.
 * The workflow can be paused and resumed across Worker restarts.
 *
 * Authors are processed in batches to stay under Cloudflare's 1000 subrequest limit.
 */
export class AuthorHarvestWorkflow extends WorkflowEntrypoint<Env, AuthorHarvestParams> {
  async run(event: WorkflowEvent<AuthorHarvestParams>, step: WorkflowStep): Promise<WorkflowResult> {
    const startTime = Date.now();
    const {
      tier,
      offset: overrideOffset,
      limit: overrideLimit,
      maxPagesPerAuthor = 1,
      resumeFromBatch = 0,
      curatedAuthors,
      curatedListName,
    } = event.payload;

    // Validate tier
    if (!TIERS[tier]) {
      throw new Error(`Invalid tier: ${tier}. Valid tiers: ${Object.keys(TIERS).join(', ')}`);
    }

    // Validate curated list if tier is 'curated'
    if (tier === 'curated' && (!curatedAuthors || curatedAuthors.length === 0)) {
      throw new Error('curatedAuthors array is required when tier is "curated"');
    }

    const tierConfig = TIERS[tier];
    const offset = overrideOffset ?? tierConfig.offset;
    const limit = overrideLimit ?? tierConfig.limit;

    // Track statistics
    let authorsProcessed = 0;
    let authorsFailed = 0;
    let totalBooksFound = 0;
    let totalEnriched = 0;
    let totalCoversQueued = 0;
    const errors: Array<{ author: string; error: string }> = [];

    // For curated lists, use the provided author names directly
    const listName = curatedListName || tier;

    // Step 1: Fetch author list (from DB or use curated list)
    const authors = await step.do(
      `fetch-authors-${listName}`,
      {
        retries: {
          limit: 3,
          delay: '5 seconds',
          backoff: 'exponential',
        },
        timeout: '2 minutes',
      },
      async () => {
        // For curated lists, use the provided author names directly
        if (tier === 'curated' && curatedAuthors) {
          console.log(`[AuthorHarvestWorkflow] Using curated list: ${listName} (${curatedAuthors.length} authors)`);

          // Apply offset and limit to curated list if provided
          const startIdx = offset;
          const endIdx = limit > 0 ? offset + limit : curatedAuthors.length;
          const slicedAuthors = curatedAuthors.slice(startIdx, endIdx);

          return slicedAuthors.map(name => ({
            author_name: name.trim(),
            work_count: 0, // Unknown for curated lists
          }));
        }

        // For tier-based selection, query the database
        console.log(`[AuthorHarvestWorkflow] Querying authors directly via Hyperdrive (offset=${offset}, limit=${limit})`);

        // Use Hyperdrive directly instead of HTTP to bypass Cloudflare Access
        const sql = postgres(this.env.HYPERDRIVE.connectionString, {
          max: 1,
          fetch_types: false,
          prepare: false,
        });

        try {
          // Query authors sorted by work count with comprehensive filters
          // Excludes: government entities, publishers, auto-generated content farms,
          // corporate authors, and bad data entries
          const results = await sql`
            SELECT
              a.key AS author_key,
              COALESCE(a.data->>'name', '[name missing]') AS author_name,
              COUNT(aw.work_key) AS work_count
            FROM authors a
            JOIN author_works aw ON aw.author_key = a.key
            WHERE a.data->>'name' IS NOT NULL
              AND LENGTH(a.data->>'name') > 3
              -- Exclude institutional/corporate authors (regex pattern)
              AND a.data->>'name' !~* '^(United States|Great Britain|Anonymous|Congress|House|Senate|Committee|Department|Ministry|Government|Office|Board|Bureau|Commission|Council|Agency|Institute|Corporation|Company|Ltd|Inc|Corp|Association|Society|Foundation|University|College|Library|Museum|Press|Publishing|Rand McNally|ICON Group|Philip M\. Parker|\[name missing\]|Scott Foresman|McGraw|Houghton|Pearson|Cengage|Wiley|Springer|Elsevier|Oxford University|Cambridge University|Harvard University)'
              -- Exclude common junk patterns
              AND a.data->>'name' NOT LIKE '%Staff%'
              AND a.data->>'name' NOT LIKE '%Collectif%'
              AND a.data->>'name' NOT LIKE '%Congress%'
              AND a.data->>'name' NOT LIKE '%Parliament%'
              AND a.data->>'name' NOT LIKE '%Government%'
              AND a.data->>'name' NOT LIKE '%Ministry%'
              AND a.data->>'name' NOT LIKE '%Committee%'
              AND a.data->>'name' NOT LIKE '%Commission%'
              AND a.data->>'name' NOT LIKE '%Department%'
              AND a.data->>'name' NOT LIKE '%Accounting Office%'
              AND a.data->>'name' NOT LIKE '%Monetary Fund%'
              AND a.data->>'name' NOT LIKE '%(Firm)%'
              -- Exclude auto-generated content farms
              AND a.data->>'name' NOT IN ('Various', 'various', 'Anonymous', 'Etchbooks', 'Blue Cloud Novelty', 'Suzanne Marshall', 'Viele Termine Publikationen', 'Irb Media', 'Global Doggy', 'Distinctive Journals', 'Gilad Soffer', 'Nick Snels', 'Diego Steiger', 'Julien Coallier', 'Livia Isoma', 'Alex Medvedev', 'Ronald Russell', 'James McFee', 'Hôtel Drouot', 'Sotheby''s (Firm)', 'Christie''s (Firm)', 'Scotland', 'Organisation for Economic Co-operation and Development')
            GROUP BY a.key, a.data->>'name'
            ORDER BY work_count DESC
            OFFSET ${offset}
            LIMIT ${limit}
          `;

          const authors = results.map(row => ({
            author_name: row.author_name as string,
            work_count: Number(row.work_count),
          }));

          console.log(`[AuthorHarvestWorkflow] Fetched ${authors.length} authors from database`);
          return authors;
        } finally {
          await sql.end();
        }
      }
    );

    console.log(`[AuthorHarvestWorkflow] Fetched ${authors.length} authors for tier ${tier}`);

    // Enforce max authors per workflow to stay under 1000 subrequest limit
    const authorsToProcess = authors.slice(0, MAX_AUTHORS_PER_WORKFLOW);
    if (authors.length > MAX_AUTHORS_PER_WORKFLOW) {
      console.log(
        `[AuthorHarvestWorkflow] WARNING: Limiting to ${MAX_AUTHORS_PER_WORKFLOW} authors ` +
        `(requested ${authors.length}). Start another workflow with offset=${offset + MAX_AUTHORS_PER_WORKFLOW} ` +
        `to continue.`
      );
    }

    // Split authors into batches
    const batches: Author[][] = [];
    for (let i = 0; i < authorsToProcess.length; i += AUTHORS_PER_BATCH) {
      batches.push(authorsToProcess.slice(i, i + AUTHORS_PER_BATCH));
    }

    console.log(`[AuthorHarvestWorkflow] Split ${authorsToProcess.length} authors into ${batches.length} batches of ${AUTHORS_PER_BATCH}`);

    // Process each batch starting from resumeFromBatch
    for (let batchIndex = resumeFromBatch; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const stepName = `batch-${batchIndex}-of-${batches.length}`;

      // Step N: Process a batch of authors
      const batchResult = await step.do(
        stepName,
        {
          retries: {
            limit: 2,
            delay: '5 seconds',
            backoff: 'exponential',
          },
          timeout: '10 minutes',
        },
        async (): Promise<BatchResult> => {
          console.log(`[AuthorHarvestWorkflow] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} authors)`);

          const result: BatchResult = {
            authors_processed: 0,
            authors_failed: 0,
            total_books_found: 0,
            total_enriched: 0,
            total_covers_queued: 0,
            quota_exhausted: false,
            errors: [],
          };

          // Process each author in this batch (with internal rate limiting)
          for (let i = 0; i < batch.length; i++) {
            const author = batch[i];

            // Rate limit between authors within batch (ISBNdb 3 req/sec)
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }

            try {
              const authorResult = await this.processAuthor(author, maxPagesPerAuthor);

              if (authorResult.error === 'quota_exhausted') {
                result.quota_exhausted = true;
                result.errors.push({ author: author.author_name, error: 'quota_exhausted' });
                break; // Stop processing this batch
              }

              if (authorResult.error) {
                result.authors_failed++;
                result.errors.push({ author: author.author_name, error: authorResult.error });
              } else {
                result.authors_processed++;
                result.total_books_found += authorResult.books_found;
                result.total_enriched += authorResult.newly_enriched;
                result.total_covers_queued += authorResult.covers_queued;

                console.log(
                  `[AuthorHarvestWorkflow] ENRICHED: ${author.author_name} - ` +
                  `${authorResult.books_found} books, ${authorResult.newly_enriched} new, ${authorResult.covers_queued} covers`
                );
              }
            } catch (err) {
              result.authors_failed++;
              result.errors.push({
                author: author.author_name,
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            }
          }

          return result;
        }
      );

      // Accumulate batch results
      authorsProcessed += batchResult.authors_processed;
      authorsFailed += batchResult.authors_failed;
      totalBooksFound += batchResult.total_books_found;
      totalEnriched += batchResult.total_enriched;
      totalCoversQueued += batchResult.total_covers_queued;
      errors.push(...batchResult.errors);

      // Stop if quota exhausted
      if (batchResult.quota_exhausted) {
        console.log(`[AuthorHarvestWorkflow] ISBNdb quota exhausted at batch ${batchIndex + 1}/${batches.length}`);
        const authorsSkipped = authors.length - authorsToProcess.length;
        return {
          status: 'partial',
          tier,
          authors_processed: authorsProcessed,
          authors_failed: authorsFailed,
          authors_skipped: authorsSkipped,
          total_books_found: totalBooksFound,
          total_enriched: totalEnriched,
          total_covers_queued: totalCoversQueued,
          cache_hits: 0,
          duration_ms: Date.now() - startTime,
          errors,
          next_offset: authorsSkipped > 0 ? offset + MAX_AUTHORS_PER_WORKFLOW : undefined,
        };
      }

      console.log(
        `[AuthorHarvestWorkflow] Batch ${batchIndex + 1}/${batches.length} complete: ` +
        `${batchResult.authors_processed} processed, ${batchResult.authors_failed} failed`
      );

      // Rate limit between batches (brief pause)
      if (batchIndex < batches.length - 1) {
        await step.sleep(`batch-sleep-${batchIndex}`, '3 seconds');
      }
    }

    // Return final results
    const authorsSkipped = authors.length - authorsToProcess.length;
    return {
      status: authorsFailed === authorsToProcess.length ? 'failed' : 'complete',
      tier,
      authors_processed: authorsProcessed,
      authors_failed: authorsFailed,
      authors_skipped: authorsSkipped,
      total_books_found: totalBooksFound,
      total_enriched: totalEnriched,
      total_covers_queued: totalCoversQueued,
      cache_hits: 0,
      duration_ms: Date.now() - startTime,
      errors,
      next_offset: authorsSkipped > 0 ? offset + MAX_AUTHORS_PER_WORKFLOW : undefined,
    };
  }

  /**
   * Process a single author - fetch from ISBNdb and enrich books
   */
  private async processAuthor(
    author: Author,
    maxPagesPerAuthor: number
  ): Promise<AuthorResult> {
    // Fetch from ISBNdb directly
    const isbndbResult = await fetchAuthorBibliography(
      author.author_name,
      this.env,
      maxPagesPerAuthor
    );

    // Handle errors from ISBNdb
    if (isbndbResult.error === 'rate_limited') {
      // Retry by throwing - step.do will retry
      throw new Error('Rate limited - will retry');
    }

    if (isbndbResult.error === 'quota_exhausted') {
      return {
        author: author.author_name,
        books_found: 0,
        newly_enriched: 0,
        covers_queued: 0,
        error: 'quota_exhausted',
      };
    }

    if (isbndbResult.error) {
      return {
        author: author.author_name,
        books_found: 0,
        newly_enriched: 0,
        covers_queued: 0,
        error: isbndbResult.error,
      };
    }

    if (isbndbResult.books.length === 0) {
      return {
        author: author.author_name,
        books_found: 0,
        newly_enriched: 0,
        covers_queued: 0,
      };
    }

    // Create DB connection for enrichment
    const sql = postgres(this.env.HYPERDRIVE.connectionString, {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    let enriched = 0;
    let coversQueued = 0;

    try {
      // Check existing ISBNs and their cover status
      const allISBNs = isbndbResult.books.map(b => b.isbn);
      const existingResult = await sql`
        SELECT isbn, cover_source, work_key
        FROM enriched_editions
        WHERE isbn IN ${sql(allISBNs)}
      `;

      // Build map of existing editions: isbn -> { cover_source, work_key }
      const existingMap = new Map<string, { cover_source: string | null; work_key: string | null }>();
      for (const row of existingResult as Array<{ isbn: string; cover_source: string | null; work_key: string | null }>) {
        existingMap.set(row.isbn, { cover_source: row.cover_source, work_key: row.work_key });
      }

      // Process ALL books from ISBNdb
      for (const book of isbndbResult.books) {
        try {
          const existing = existingMap.get(book.isbn);
          const hasCover = book.image_original || book.image;

          // Determine if we need to queue a cover
          // Queue if: has ISBNdb cover AND (no existing cover OR existing cover is external URL)
          const needsCover = hasCover && (
            !existing ||                                    // New edition
            !existing.cover_source ||                       // Existing but no cover
            existing.cover_source === 'isbndb' ||           // Has ISBNdb URL (not yet processed to R2)
            existing.cover_source === 'openlibrary' ||      // External OpenLibrary URL
            existing.cover_source === 'google_books'        // External Google Books URL
            // Skip if cover_source is 'r2' or 'alexandria' (already in our storage)
          );

          if (!existing) {
            // NEW EDITION: Find or create work (deduplication!) + edition + author links
            const { workKey, isNew: isNewWork } = await findOrCreateWork(
              sql,
              book.isbn,
              book.title,
              book.authors || []
            );

            // Only create work if it's genuinely new
            if (isNewWork) {
              await enrichWork(sql, {
                work_key: workKey,
                title: book.title,
                description: book.synopsis,
                subject_tags: book.subjects,
                primary_provider: 'isbndb',
              });
            }

            // ALWAYS link work to authors (idempotent via ON CONFLICT DO NOTHING)
            // This ensures author links exist even for existing works
            if (book.authors && book.authors.length > 0) {
              await linkWorkToAuthors(sql, workKey, book.authors);
            }

            await enrichEdition(sql, {
              isbn: book.isbn,
              title: book.title,
              publisher: book.publisher,
              publication_date: book.date_published,
              page_count: book.pages,
              language: book.language,
              primary_provider: 'isbndb',
              cover_urls: hasCover ? {
                original: book.image_original,
                large: book.image,
                medium: book.image,
                small: book.image,
              } : undefined,
              cover_source: hasCover ? 'isbndb' : undefined,
              work_key: workKey,
              subjects: book.subjects,
              binding: book.binding,
              dewey_decimal: book.dewey_decimal,
              related_isbns: book.related,
            }, this.env);

            enriched++;

            // Queue cover for new edition
            if (needsCover) {
              try {
                await this.env.COVER_QUEUE.send({
                  isbn: book.isbn,
                  work_key: workKey,
                  provider_url: book.image_original || book.image,
                  source: 'workflow_harvest',
                  priority: 'low',
                });
                coversQueued++;
              } catch {
                console.log(`[AuthorHarvestWorkflow] Cover queue failed for ${book.isbn}`);
              }
            }
          } else if (needsCover) {
            // EXISTING EDITION: Update cover info and queue for processing
            const workKey = existing.work_key || `/works/isbndb-${crypto.randomUUID().slice(0, 8)}`;

            // Update edition with ISBNdb cover URL (will be replaced with R2 URL after processing)
            await sql`
              UPDATE enriched_editions
              SET
                cover_url_original = ${book.image_original || null},
                cover_url_large = ${book.image || null},
                cover_url_medium = ${book.image || null},
                cover_url_small = ${book.image || null},
                cover_source = 'isbndb',
                updated_at = NOW()
              WHERE isbn = ${book.isbn}
            `;

            // Queue cover for processing through WebP system
            try {
              await this.env.COVER_QUEUE.send({
                isbn: book.isbn,
                work_key: workKey,
                provider_url: book.image_original || book.image,
                source: 'workflow_harvest_refresh',
                priority: 'low',
              });
              coversQueued++;
            } catch {
              console.log(`[AuthorHarvestWorkflow] Cover queue failed for ${book.isbn}`);
            }
          }
          // else: existing with Alexandria/R2 cover - skip
        } catch (bookErr) {
          // Log but continue with other books
          console.log(`[AuthorHarvestWorkflow] Failed to process ${book.isbn}: ${bookErr}`);
        }
      }
    } finally {
      await sql.end();
    }

    return {
      author: author.author_name,
      books_found: isbndbResult.books_found,
      newly_enriched: enriched,
      covers_queued: coversQueued,
    };
  }
}
