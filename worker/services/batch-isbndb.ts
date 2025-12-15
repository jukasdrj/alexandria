/**
 * Batched ISBNdb Service (Premium Plan)
 *
 * Provides efficient batch processing of ISBN enrichment requests.
 * Uses ISBNdb's Premium POST /books endpoint to fetch up to 1000 ISBNs in a single API call.
 *
 * Premium Plan Benefits:
 * - 1000 results per call (10x increase from Basic's 100)
 * - 3 requests per second (3x throughput from Basic's 1/sec)
 * - 15,000 daily searches
 * - Premium endpoint: api.premium.isbndb.com
 *
 * This reduces API call waste from 7.1x to near 1.0x efficiency.
 *
 * @module services/batch-isbndb
 */

import type { Env } from '../src/env.js';
import type { ExternalBookData } from './external-apis.js';
import { shouldQueryISBNdb, deduplicateISBNs, normalizeISBN, getISBNBatchStats } from '../lib/isbn-utils.js';

/**
 * ISBNdb batch response structure (Premium API format)
 * Response: { total: N, requested: N, data: [...books] }
 */
interface ISBNdbBatchResponse {
  total: number;
  requested: number;
  data: Array<{
    isbn: string;
    isbn13?: string;
    title: string;
    title_long?: string;
    authors?: string[];
    publisher?: string;
    date_published?: string;
    pages?: number;
    language?: string;
    synopsis?: string;
    image?: string;
    image_original?: string;
    // Enrichment fields
    subjects?: string[];
    dewey_decimal?: string[];
    binding?: string;
    related?: Record<string, string>;
  }>;
}

/**
 * Fetch metadata for multiple ISBNs from ISBNdb in a single batch request
 *
 * @param isbns - Array of ISBNs to fetch (max 100)
 * @param env - Worker environment with ISBNDB_API_KEY
 * @returns Map of ISBN -> ExternalBookData (only successful fetches)
 */
export async function fetchISBNdbBatch(
  isbns: string[],
  env: Env
): Promise<Map<string, ExternalBookData>> {
  const results = new Map<string, ExternalBookData>();

  // Validate inputs
  if (!isbns || isbns.length === 0) {
    console.warn('[ISBNdb Batch] No ISBNs provided');
    return results;
  }

  // Normalize and deduplicate ISBNs
  const normalizedISBNs = deduplicateISBNs(isbns);

  // Filter for English ISBNs only (ISBNdb is English-focused)
  const filteredISBNs = normalizedISBNs.filter(isbn => shouldQueryISBNdb(isbn));

  if (filteredISBNs.length === 0) {
    console.log('[ISBNdb Batch] No valid English ISBNs to query');
    return results;
  }

  // Log batch statistics
  const stats = getISBNBatchStats(isbns);
  console.log(`[ISBNdb Batch] Batch stats:`, {
    total: stats.total,
    valid: stats.valid,
    english: stats.english,
    foreign_filtered: stats.foreign,
    querying: filteredISBNs.length
  });

  // Enforce ISBNdb Premium batch limit (1000 ISBNs max)
  if (filteredISBNs.length > 1000) {
    console.warn(`[ISBNdb Batch] Batch size ${filteredISBNs.length} exceeds Premium limit, truncating to 1000`);
    filteredISBNs.splice(1000);
  }

  try {
    // Get API key from Secrets Store
    const apiKey = await env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      console.error('[ISBNdb Batch] API key not configured');
      return results;
    }

    console.log(`[ISBNdb Batch] Fetching ${filteredISBNs.length} ISBNs in single API call`);

    // Call ISBNdb Premium batch endpoint (1000 ISBNs/call, 3 req/sec)
    const startTime = Date.now();
    const response = await fetch('https://api.premium.isbndb.com/books', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'Alexandria/2.0 (Batch Processing)',
      },
      body: JSON.stringify({ isbns: filteredISBNs }),
    });

    const fetchDuration = Date.now() - startTime;

    // Handle rate limiting
    if (response.status === 429) {
      console.warn('[ISBNdb Batch] Rate limited - batch request failed');
      return results;
    }

    if (!response.ok) {
      console.error(`[ISBNdb Batch] API error ${response.status}: ${response.statusText}`);
      // Consume response body to prevent stalled connection
      try {
        await response.text();
      } catch (e) {
        // Ignore
      }
      return results;
    }

    // Parse response
    const data: ISBNdbBatchResponse = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      console.warn('[ISBNdb Batch] Invalid response format');
      return results;
    }

    console.log(`[ISBNdb Batch] Received ${data.data.length}/${filteredISBNs.length} books in ${fetchDuration}ms`);

    // Transform ISBNdb response to ExternalBookData format
    for (const book of data.data) {
      const isbn = book.isbn13 || book.isbn;
      if (!isbn || !book.title) continue;

      // Extract cover URLs (prefer image over image_original to avoid memory issues)
      // image_original can be 3000x4000+ which crashes jSquash WASM decoder
      let coverUrls: ExternalBookData['coverUrls'];
      if (book.image) {
        coverUrls = {
          original: book.image,  // Use standard image (pre-sized, ~500x700)
          large: book.image,
          medium: book.image,
          small: book.image,
        };
      }

      results.set(isbn, {
        isbn,
        title: book.title_long || book.title,
        authors: book.authors || [],
        publisher: book.publisher,
        publicationDate: book.date_published,
        pageCount: book.pages,
        language: book.language,
        description: book.synopsis,
        coverUrls,
        // ISBNdb enrichment fields
        subjects: book.subjects || [],
        deweyDecimal: book.dewey_decimal || [],
        binding: book.binding,
        relatedISBNs: book.related,
        provider: 'isbndb',
      });
    }

    console.log(`[ISBNdb Batch] Successfully processed ${results.size}/${filteredISBNs.length} ISBNs`);

    // Write analytics if available
    if (env.ANALYTICS) {
      try {
        env.ANALYTICS.writeDataPoint({
          indexes: ['isbndb_batch'],
          blobs: [
            `batch_size_${filteredISBNs.length}`,
            `success_${results.size}`
          ],
          doubles: [filteredISBNs.length, results.size, fetchDuration]
        });
      } catch (analyticsError) {
        console.error('[ISBNdb Batch] Analytics write failed:', analyticsError);
      }
    }

    return results;

  } catch (error) {
    console.error('[ISBNdb Batch] Fetch error:', error instanceof Error ? error.message : String(error));
    return results;
  }
}

/**
 * Partition ISBNs into batches and fetch all in parallel (respecting rate limits)
 *
 * @param isbns - Array of ISBNs to fetch
 * @param env - Worker environment
 * @param options - Batch configuration
 * @returns Map of ISBN -> ExternalBookData (all successful fetches)
 */
export async function fetchISBNdbBatches(
  isbns: string[],
  env: Env,
  options: {
    batchSize?: number;
    delayBetweenBatches?: number;
  } = {}
): Promise<Map<string, ExternalBookData>> {
  const {
    batchSize = 1000,           // Premium: 1000 ISBNs per call (10x increase!)
    delayBetweenBatches = 333   // Premium: 3 req/sec = 333ms delay (3x throughput!)
  } = options;

  const allResults = new Map<string, ExternalBookData>();

  // Partition ISBNs into batches
  const batches: string[][] = [];
  for (let i = 0; i < isbns.length; i += batchSize) {
    batches.push(isbns.slice(i, i + batchSize));
  }

  console.log(`[ISBNdb Batches] Processing ${isbns.length} ISBNs in ${batches.length} batches`);

  // Process batches sequentially (to respect rate limits)
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[ISBNdb Batches] Processing batch ${i + 1}/${batches.length} (${batch.length} ISBNs)`);

    const batchResults = await fetchISBNdbBatch(batch, env);

    // Merge results
    for (const [isbn, data] of batchResults) {
      allResults.set(isbn, data);
    }

    // Wait before next batch (Premium rate limit: 3 req/sec = 333ms)
    if (i < batches.length - 1) {
      console.log(`[ISBNdb Batches] Waiting ${delayBetweenBatches}ms before next batch (Premium: 3 req/sec)`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  console.log(`[ISBNdb Batches] Complete: ${allResults.size}/${isbns.length} ISBNs enriched`);

  return allResults;
}
