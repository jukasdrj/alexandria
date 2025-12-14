/**
 * New Releases Harvest Workflow
 *
 * Durable workflow for harvesting new book releases from ISBNdb by date range.
 * Designed to fill the gap between OpenLibrary dump and today.
 *
 * Features:
 * - Processes month-by-month for manageable batches
 * - Automatic retry on transient failures
 * - Cover queue integration
 * - Rate limiting (350ms between ISBNdb calls)
 * - Skips existing ISBNs
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import postgres from 'postgres';
import type { Env } from '../env.js';
import { enrichWork, enrichEdition } from '../services/enrichment-service.js';
import { findOrCreateWork, linkWorkToAuthors } from './author-harvest.js';

// Maximum books per workflow invocation (stay under 1000 subrequest limit)
// Each book = ~6 subrequests (DB ops + queue), so 1000/6 ≈ 166, use 150 for safety
const MAX_BOOKS_PER_WORKFLOW = 150;
const BOOKS_PER_BATCH = 25;

interface ISBNdbBook {
  isbn?: string;
  isbn13?: string;
  title?: string;
  title_long?: string;
  authors?: string[];
  publisher?: string;
  date_published?: string;
  pages?: number;
  language?: string;
  synopsis?: string;
  image?: string;
  image_original?: string;
  subjects?: string[];
  binding?: string;
  dewey_decimal?: string[];
  related?: Record<string, string>;
}

interface ISBNdbSearchResponse {
  books?: ISBNdbBook[];
  total?: number;
}

export interface NewReleasesHarvestParams {
  /** Start month (YYYY-MM format) */
  start_month: string;
  /** End month (YYYY-MM format) */
  end_month: string;
  /** Maximum pages per month (100 books per page) */
  max_pages_per_month?: number;
  /** Skip books that already exist in enriched_editions */
  skip_existing?: boolean;
  /** Continue from specific month index (for resumption) */
  resume_from_month?: number;
  /** Continue from specific page within month */
  resume_from_page?: number;
}

interface MonthResult {
  month: string;
  books_found: number;
  books_enriched: number;
  covers_queued: number;
  failed: number;
  api_calls: number;
}

interface HarvestResult {
  status: 'complete' | 'quota_exhausted' | 'continuation_needed';
  start_month: string;
  end_month: string;
  months_processed: number;
  total_books_found: number;
  total_enriched: number;
  total_covers_queued: number;
  total_failed: number;
  total_api_calls: number;
  duration_ms: number;
  next_month?: string;
  next_month_index?: number;
  next_page?: number;
  continuation_spawned?: boolean;
  continuation_id?: string;
  errors: string[];
}

export class NewReleasesHarvestWorkflow extends WorkflowEntrypoint<Env, NewReleasesHarvestParams> {
  async run(event: WorkflowEvent<NewReleasesHarvestParams>, step: WorkflowStep): Promise<HarvestResult> {
    const startTime = Date.now();
    const params = event.payload;
    const {
      start_month,
      end_month,
      max_pages_per_month = 100, // Effectively unlimited - ISBNdb caps at 10k results anyway
      skip_existing = true,
      resume_from_month = 0,
      resume_from_page = 1,
    } = params;

    // Generate list of months
    const months = this.generateMonths(start_month, end_month);
    console.log(`[NewReleasesHarvest] Processing ${months.length} months: ${start_month} to ${end_month}`);

    const results: HarvestResult = {
      status: 'complete',
      start_month,
      end_month,
      months_processed: 0,
      total_books_found: 0,
      total_enriched: 0,
      total_covers_queued: 0,
      total_failed: 0,
      total_api_calls: 0,
      duration_ms: 0,
      errors: [],
    };

    let totalBooksProcessed = 0;

    // Process each month
    for (let monthIdx = resume_from_month; monthIdx < months.length; monthIdx++) {
      const monthStr = months[monthIdx];
      const startPage = monthIdx === resume_from_month ? resume_from_page : 1;

      // Fetch books for this month
      const monthResult = await step.do(`fetch-${monthStr}`, async () => {
        return await this.fetchAndEnrichMonth(
          monthStr,
          startPage,
          max_pages_per_month,
          skip_existing
        );
      });

      // Accumulate results
      results.total_books_found += monthResult.books_found;
      results.total_enriched += monthResult.books_enriched;
      results.total_covers_queued += monthResult.covers_queued;
      results.total_failed += monthResult.failed;
      results.total_api_calls += monthResult.api_calls;
      results.months_processed++;
      totalBooksProcessed += monthResult.books_enriched;

      // Handle quota exhaustion - stop and report
      if (monthResult.status === 'quota_exhausted') {
        results.status = 'quota_exhausted';
        results.next_month = monthStr;
        results.next_month_index = monthIdx;
        results.next_page = monthResult.last_page;
        break;
      }

      // Handle intra-month continuation (hit book limit mid-month)
      if (monthResult.status === 'continuation_needed') {
        results.status = 'continuation_needed';
        results.next_month = monthStr; // Resume SAME month
        results.next_month_index = monthIdx;
        results.next_page = monthResult.last_page + 1; // Next page in same month
        break;
      }

      // Check if we need to continue in another workflow (finished this month, more to go)
      if (totalBooksProcessed >= MAX_BOOKS_PER_WORKFLOW && monthIdx < months.length - 1) {
        results.status = 'continuation_needed';
        results.next_month = months[monthIdx + 1];
        results.next_month_index = monthIdx + 1;
        results.next_page = 1;
        break;
      }

      console.log(`[NewReleasesHarvest] Month ${monthStr} complete: ${monthResult.books_enriched} enriched, ${monthResult.covers_queued} covers`);
    }

    results.duration_ms = Date.now() - startTime;

    // Self-spawn continuation workflow if needed (fully automated)
    if (results.status === 'continuation_needed' && results.next_month) {
      const continuationId = `new-releases-${results.next_month}-${Date.now()}`;

      try {
        await step.do('spawn-continuation', async () => {
          await this.env.NEW_RELEASES_HARVEST.create({
            id: continuationId,
            params: {
              start_month: params.start_month,
              end_month: params.end_month,
              max_pages_per_month: params.max_pages_per_month,
              skip_existing: params.skip_existing,
              resume_from_month: results.next_month_index,
              resume_from_page: results.next_page,
            },
          });
          console.log(`[NewReleasesHarvest] Spawned continuation workflow: ${continuationId}`);
        });
        results.continuation_spawned = true;
        results.continuation_id = continuationId;
      } catch (error) {
        console.error(`[NewReleasesHarvest] Failed to spawn continuation: ${error}`);
        results.errors.push(`Continuation spawn failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`[NewReleasesHarvest] Complete: ${results.total_enriched} enriched, ${results.total_covers_queued} covers, ${results.duration_ms}ms`);

    return results;
  }

  private generateMonths(start: string, end: string): string[] {
    const months: string[] = [];
    const [startYear, startMo] = start.split('-').map(Number);
    const [endYear, endMo] = end.split('-').map(Number);

    let year = startYear;
    let month = startMo;
    while (year < endYear || (year === endYear && month <= endMo)) {
      months.push(`${year}-${String(month).padStart(2, '0')}`);
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    return months;
  }

  private async fetchAndEnrichMonth(
    monthStr: string,
    startPage: number,
    maxPages: number,
    skipExisting: boolean
  ): Promise<MonthResult & { status: string; last_page: number }> {
    const result: MonthResult & { status: string; last_page: number } = {
      month: monthStr,
      books_found: 0,
      books_enriched: 0,
      covers_queued: 0,
      failed: 0,
      api_calls: 0,
      status: 'complete',
      last_page: startPage,
    };

    const apiKey = await this.env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      throw new Error('ISBNdb API key not configured');
    }

    const sql = postgres(this.env.HYPERDRIVE.connectionString, {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    try {
      const pageSize = 100;
      let page = startPage;
      let hasMore = true;
      const allBooks: ISBNdbBook[] = [];

      // Fetch all pages for this month
      while (hasMore && page <= maxPages) {
        const url = `https://api.premium.isbndb.com/books/${encodeURIComponent(monthStr)}?page=${page}&pageSize=${pageSize}&column=date_published`;

        const response = await fetch(url, {
          headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
        });

        result.api_calls++;
        result.last_page = page;

        if (response.status === 404) break;
        if (response.status === 429 || response.status === 403) {
          console.log(`[NewReleasesHarvest] Quota/rate limit at month ${monthStr}, page ${page}`);
          result.status = 'quota_exhausted';
          break;
        }
        if (!response.ok) break;

        const data = await response.json() as ISBNdbSearchResponse;

        if (data.books && Array.isArray(data.books)) {
          allBooks.push(...data.books.filter(b => b.isbn13 || b.isbn));
        }

        const booksInResponse = data.books?.length || 0;
        hasMore = booksInResponse === pageSize && allBooks.length < 10000;
        page++;

        if (hasMore) await new Promise(r => setTimeout(r, 350));
      }

      result.books_found = allBooks.length;

      // Filter existing ISBNs
      let booksToEnrich = allBooks;
      if (skipExisting && allBooks.length > 0) {
        const allISBNs = allBooks.map(b => b.isbn13 || b.isbn).filter(Boolean) as string[];
        const existingResult = await sql<{ isbn: string }[]>`
          SELECT isbn FROM enriched_editions WHERE isbn IN ${sql(allISBNs)}
        `;
        const existingSet = new Set(existingResult.map(r => r.isbn));
        booksToEnrich = allBooks.filter(b => {
          const isbn = b.isbn13 || b.isbn;
          return isbn && !existingSet.has(isbn);
        });
      }

      // Limit to MAX_BOOKS_PER_WORKFLOW
      if (booksToEnrich.length > MAX_BOOKS_PER_WORKFLOW) {
        booksToEnrich = booksToEnrich.slice(0, MAX_BOOKS_PER_WORKFLOW);
        result.status = 'continuation_needed';
      }

      // Batch enrich books
      for (let i = 0; i < booksToEnrich.length; i += BOOKS_PER_BATCH) {
        const batch = booksToEnrich.slice(i, i + BOOKS_PER_BATCH);

        for (const book of batch) {
          const isbn = book.isbn13 || book.isbn;
          if (!isbn) continue;

          try {
            const { workKey, isNew: isNewWork } = await findOrCreateWork(
              sql, isbn, book.title || 'Unknown', book.authors || []
            );

            if (isNewWork) {
              await enrichWork(sql, {
                work_key: workKey,
                title: book.title || 'Unknown',
                description: book.synopsis,
                subject_tags: book.subjects,
                primary_provider: 'isbndb',
              });
            }

            if (book.authors && book.authors.length > 0) {
              await linkWorkToAuthors(sql, workKey, book.authors);
            }

            const hasCover = !!(book.image_original || book.image);
            await enrichEdition(sql, {
              isbn,
              title: book.title || 'Unknown',
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

            result.books_enriched++;

            if (hasCover) {
              try {
                await this.env.COVER_QUEUE.send({
                  isbn,
                  work_key: workKey,
                  provider_url: book.image_original || book.image,
                  priority: 'low',
                  source: 'new_releases_workflow',
                });
                result.covers_queued++;
              } catch {
                // Cover queue failure is non-fatal
              }
            }
          } catch (error) {
            console.log(`[NewReleasesHarvest] Failed to process ${isbn}: ${error instanceof Error ? error.message : String(error)}`);
            result.failed++;
          }
        }
      }

    } finally {
      await sql.end();
    }

    return result;
  }
}
