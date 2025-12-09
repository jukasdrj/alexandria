// =================================================================================
// Queue Consumer - Background Enrichment Job Processor
// =================================================================================
// Processes pending jobs from enrichment_queue table.
// Triggered by cron every 5 minutes.
// =================================================================================

import postgres from 'postgres';
import { enrichEdition, enrichWork, enrichAuthor } from './enrichment-service.js';
import { fetchWithRetry, fetchJSON } from './lib/fetch-utils.js';

// Configuration
const BATCH_SIZE = 10;  // Max jobs to process per cron invocation
const JOB_TIMEOUT_MS = 30000;  // 30 second timeout per job

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - Promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} message - Error message on timeout
 * @returns {Promise} - Original promise or rejection on timeout
 */
function withTimeout(promise, ms, message) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Main queue consumer - called by scheduled handler
 * @param {Object} env - Worker environment bindings
 * @returns {Promise<{processed: number, succeeded: number, failed: number, errors: string[]}>}
 */
export async function processEnrichmentQueue(env) {
  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: []
  };

  // Create database connection
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false
  });

  try {
    // Fetch pending jobs with row locking to prevent concurrent processing
    // Using FOR UPDATE SKIP LOCKED for safe concurrent access
    const jobs = await sql`
      SELECT *
      FROM enrichment_queue
      WHERE status = 'pending'
        AND (retry_count < max_retries OR max_retries IS NULL)
      ORDER BY priority DESC, created_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;

    if (jobs.length === 0) {
      console.log('Queue consumer: No pending jobs');
      return results;
    }

    console.log(`Queue consumer: Processing ${jobs.length} jobs`);

    // Process each job with timeout
    for (const job of jobs) {
      results.processed++;

      try {
        await withTimeout(processJob(sql, job, env), JOB_TIMEOUT_MS, `Job ${job.id} timed out`);
        results.succeeded++;
      } catch (error) {
        results.failed++;
        results.errors.push(`Job ${job.id}: ${error.message}`);
        console.error(`Queue consumer: Job ${job.id} failed:`, error.message);
      }
    }

    console.log(`Queue consumer: Processed ${results.processed}, succeeded ${results.succeeded}, failed ${results.failed}`);

  } catch (error) {
    console.error('Queue consumer: Fatal error:', error);
    results.errors.push(`Fatal: ${error.message}`);
  } finally {
    // Close the connection
    await sql.end();
  }

  return results;
}

/**
 * Parse PostgreSQL array string into JavaScript array
 * Handles format: {item1,item2,item3} or {"quoted","items"} with escaped quotes
 * @param {string|string[]} pgArray - PostgreSQL array string or JS array
 * @returns {string[]} Parsed array
 */
function parsePgArray(pgArray) {
  // Already an array
  if (Array.isArray(pgArray)) {
    return pgArray;
  }

  // Null or undefined
  if (!pgArray) {
    return [];
  }

  // PostgreSQL array format: {item1,item2,item3}
  if (typeof pgArray === 'string' && pgArray.startsWith('{') && pgArray.endsWith('}')) {
    const inner = pgArray.slice(1, -1);
    if (!inner) return [];

    // Parse with proper handling of quoted strings and escaped characters
    const items = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < inner.length) {
      const char = inner[i];

      if (char === '"' && !inQuotes) {
        // Start of quoted string
        inQuotes = true;
        i++;
      } else if (char === '\\' && inQuotes && i + 1 < inner.length) {
        // Escaped character inside quotes (e.g., \" or \\)
        current += inner[i + 1];
        i += 2;
      } else if (char === '"' && inQuotes) {
        // End of quoted string
        inQuotes = false;
        i++;
      } else if (char === ',' && !inQuotes) {
        // Item separator
        items.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
    if (current) items.push(current);

    return items;
  }

  // Unknown format - return as single-item array
  return [pgArray];
}

/**
 * Process a single enrichment job
 * @param {import('postgres').Sql} sql - Database connection
 * @param {Object} job - Job from enrichment_queue
 * @param {Object} env - Worker environment
 */
async function processJob(sql, job, env) {
  const { id, entity_type, entity_key } = job;
  const providers_to_try = parsePgArray(job.providers_to_try);

  // Mark job as processing
  await sql`
    UPDATE enrichment_queue
    SET status = 'processing', started_at = NOW()
    WHERE id = ${id}
  `;

  const providersAttempted = [];
  const providersSucceeded = [];
  let lastError = null;

  try {
    // Try each provider in order
    for (const provider of providers_to_try || []) {
      providersAttempted.push(provider);

      try {
        const success = await tryProvider(sql, entity_type, entity_key, provider, env);

        if (success) {
          providersSucceeded.push(provider);
          console.log(`Job ${id}: ${provider} succeeded for ${entity_type} ${entity_key}`);
        } else {
          console.log(`Job ${id}: ${provider} returned no data for ${entity_type} ${entity_key}`);
        }
      } catch (providerError) {
        console.error(`Job ${id}: ${provider} failed:`, providerError.message);
        lastError = providerError;
      }
    }

    // Determine final status
    if (providersSucceeded.length > 0) {
      // At least one provider succeeded
      await sql`
        UPDATE enrichment_queue
        SET
          status = 'completed',
          completed_at = NOW(),
          providers_attempted = ${sql.array(providersAttempted)},
          providers_succeeded = ${sql.array(providersSucceeded)}
        WHERE id = ${id}
      `;
    } else {
      // All providers failed or returned no data
      throw new Error(lastError?.message || 'No providers returned data');
    }

  } catch (error) {
    // Mark job as failed (or retry if under limit)
    const newRetryCount = (job.retry_count || 0) + 1;
    const maxRetries = job.max_retries || 3;

    if (newRetryCount < maxRetries) {
      // Return to pending for retry
      await sql`
        UPDATE enrichment_queue
        SET
          status = 'pending',
          retry_count = ${newRetryCount},
          providers_attempted = ${sql.array(providersAttempted)},
          error_message = ${error.message}
        WHERE id = ${id}
      `;
      console.log(`Job ${id}: Queued for retry (${newRetryCount}/${maxRetries})`);
    } else {
      // Max retries exceeded - mark as failed
      await sql`
        UPDATE enrichment_queue
        SET
          status = 'failed',
          completed_at = NOW(),
          retry_count = ${newRetryCount},
          providers_attempted = ${sql.array(providersAttempted)},
          error_message = ${error.message}
        WHERE id = ${id}
      `;
      console.log(`Job ${id}: Failed permanently after ${newRetryCount} attempts`);
    }

    throw error;
  }
}

/**
 * Try to enrich from a specific provider
 * @param {import('postgres').Sql} sql - Database connection
 * @param {string} entityType - 'edition', 'work', or 'author'
 * @param {string} entityKey - ISBN, work_key, or author_key
 * @param {string} provider - Provider name (isbndb, google-books, openlibrary)
 * @param {Object} env - Worker environment
 * @returns {Promise<boolean>} - True if enrichment succeeded
 */
async function tryProvider(sql, entityType, entityKey, provider, env) {
  switch (entityType) {
    case 'edition':
      return await enrichEditionFromProvider(sql, entityKey, provider, env);
    case 'work':
      return await enrichWorkFromProvider(sql, entityKey, provider, env);
    case 'author':
      return await enrichAuthorFromProvider(sql, entityKey, provider, env);
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}

/**
 * Enrich an edition from a specific provider
 * @param {import('postgres').Sql} sql - Database connection
 * @param {string} isbn - ISBN to enrich
 * @param {string} provider - Provider name
 * @param {Object} env - Worker environment
 * @returns {Promise<boolean>} - True if data was found and stored
 */
async function enrichEditionFromProvider(sql, isbn, provider, env) {
  let data = null;

  switch (provider) {
    case 'isbndb':
      data = await fetchISBNdbEdition(isbn, env);
      break;
    case 'google-books':
      data = await fetchGoogleBooksEdition(isbn, env);
      break;
    case 'openlibrary':
      data = await fetchOpenLibraryEdition(isbn);
      break;
    default:
      console.warn(`Unknown provider: ${provider}`);
      return false;
  }

  if (!data) {
    return false;
  }

  // Store the enriched data
  await enrichEdition(sql, {
    isbn,
    primary_provider: provider,
    ...data
  }, env);

  return true;
}

/**
 * Fetch edition data from ISBNdb API
 * @param {string} isbn - ISBN to lookup
 * @param {Object} env - Worker environment
 * @returns {Promise<Object|null>} - Edition data or null
 */
async function fetchISBNdbEdition(isbn, env) {
  try {
    const apiKey = await env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      console.error('ISBNdb API key not configured');
      return null;
    }

    const response = await fetchWithRetry(
      `https://api2.isbndb.com/book/${isbn}`,
      {
        headers: {
          'Authorization': apiKey,
          'User-Agent': 'Alexandria/1.0 (enrichment)'
        }
      },
      { timeoutMs: 10000, maxRetries: 2 }  // 10s timeout, 2 retries
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`ISBNdb API error: ${response.status}`);
    }

    const json = await response.json();
    const book = json.book;

    if (!book) return null;

    return {
      title: book.title,
      subtitle: book.title_long !== book.title ? book.title_long : null,
      publisher: book.publisher,
      publication_date: book.date_published,
      page_count: book.pages,
      format: book.binding,
      language: book.language,
      cover_urls: book.image ? { large: book.image } : null,
      cover_source: book.image ? 'isbndb' : null,
      alternate_isbns: [book.isbn, book.isbn13].filter(Boolean)
    };
  } catch (error) {
    console.error('ISBNdb fetch error:', error.message);
    throw error;
  }
}

/**
 * Fetch edition data from Google Books API
 * @param {string} isbn - ISBN to lookup
 * @param {Object} env - Worker environment
 * @returns {Promise<Object|null>} - Edition data or null
 */
async function fetchGoogleBooksEdition(isbn, env) {
  try {
    let url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;

    // Add API key if available
    try {
      const apiKey = await env.GOOGLE_BOOKS_API_KEY.get();
      if (apiKey) url += `&key=${apiKey}`;
    } catch (e) {
      // API key optional
    }

    const response = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': 'Alexandria/1.0 (enrichment)' } },
      { timeoutMs: 10000, maxRetries: 2 }  // 10s timeout, 2 retries
    );

    if (!response.ok) {
      throw new Error(`Google Books API error: ${response.status}`);
    }

    const json = await response.json();

    if (!json.items || json.items.length === 0) {
      return null;
    }

    const volume = json.items[0].volumeInfo;

    // Build cover URLs
    let coverUrls = null;
    if (volume.imageLinks) {
      coverUrls = {
        large: volume.imageLinks.extraLarge || volume.imageLinks.large,
        medium: volume.imageLinks.medium,
        small: volume.imageLinks.thumbnail || volume.imageLinks.smallThumbnail
      };
      // Clean up undefined values
      Object.keys(coverUrls).forEach(k => !coverUrls[k] && delete coverUrls[k]);
      if (Object.keys(coverUrls).length === 0) coverUrls = null;
    }

    return {
      title: volume.title,
      subtitle: volume.subtitle,
      publisher: volume.publisher,
      publication_date: volume.publishedDate,
      page_count: volume.pageCount,
      language: volume.language,
      cover_urls: coverUrls,
      cover_source: coverUrls ? 'google-books' : null,
      google_books_volume_ids: [json.items[0].id]
    };
  } catch (error) {
    console.error('Google Books fetch error:', error.message);
    throw error;
  }
}

/**
 * Fetch edition data from OpenLibrary API
 * @param {string} isbn - ISBN to lookup
 * @returns {Promise<Object|null>} - Edition data or null
 */
async function fetchOpenLibraryEdition(isbn) {
  try {
    const response = await fetchWithRetry(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      { headers: { 'User-Agent': 'Alexandria/1.0 (enrichment)' } },
      { timeoutMs: 10000, maxRetries: 2 }  // 10s timeout, 2 retries
    );

    if (!response.ok) {
      throw new Error(`OpenLibrary API error: ${response.status}`);
    }

    const json = await response.json();
    const book = json[`ISBN:${isbn}`];

    if (!book) return null;

    // Build cover URLs
    let coverUrls = null;
    if (book.cover) {
      coverUrls = {
        large: book.cover.large,
        medium: book.cover.medium,
        small: book.cover.small
      };
    }

    return {
      title: book.title,
      subtitle: book.subtitle,
      publisher: book.publishers?.[0]?.name,
      publication_date: book.publish_date,
      page_count: book.number_of_pages,
      cover_urls: coverUrls,
      cover_source: coverUrls ? 'openlibrary' : null,
      openlibrary_edition_id: book.key?.replace('/books/', ''),
      work_key: book.works?.[0]?.key
    };
  } catch (error) {
    console.error('OpenLibrary fetch error:', error.message);
    throw error;
  }
}

/**
 * Enrich a work from a specific provider
 * Currently only OpenLibrary supports work-level data
 * @param {import('postgres').Sql} sql - Database connection
 * @param {string} workKey - Work key (e.g., '/works/OL45804W')
 * @param {string} provider - Provider name
 * @param {Object} env - Worker environment
 * @returns {Promise<boolean>} - True if data was found and stored
 */
async function enrichWorkFromProvider(sql, workKey, provider, env) {
  if (provider !== 'openlibrary') {
    console.warn(`Work enrichment only supported for openlibrary, got: ${provider}`);
    return false;
  }

  try {
    // Normalize work key
    const key = workKey.startsWith('/works/') ? workKey : `/works/${workKey}`;

    const response = await fetchWithRetry(
      `https://openlibrary.org${key}.json`,
      { headers: { 'User-Agent': 'Alexandria/1.0 (enrichment)' } },
      { timeoutMs: 10000, maxRetries: 2 }  // 10s timeout, 2 retries
    );

    if (!response.ok) {
      if (response.status === 404) return false;
      throw new Error(`OpenLibrary work API error: ${response.status}`);
    }

    const work = await response.json();

    if (!work) return false;

    // Extract description
    let description = null;
    if (typeof work.description === 'string') {
      description = work.description;
    } else if (work.description?.value) {
      description = work.description.value;
    }

    // Build cover URL if cover ID exists
    let coverUrls = null;
    if (work.covers && work.covers.length > 0) {
      const coverId = work.covers[0];
      coverUrls = {
        large: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`,
        medium: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`,
        small: `https://covers.openlibrary.org/b/id/${coverId}-S.jpg`
      };
    }

    await enrichWork(sql, {
      work_key: key,
      title: work.title,
      subtitle: work.subtitle,
      description,
      subject_tags: work.subjects?.slice(0, 20),  // Limit subjects
      first_publication_year: work.first_publish_date ? parseInt(work.first_publish_date) : null,
      cover_urls: coverUrls,
      cover_source: coverUrls ? 'openlibrary' : null,
      openlibrary_work_id: work.key?.replace('/works/', ''),
      primary_provider: 'openlibrary'
    });

    return true;
  } catch (error) {
    console.error('OpenLibrary work fetch error:', error.message);
    throw error;
  }
}

/**
 * Enrich an author from a specific provider
 * Currently only OpenLibrary supports author-level data
 * @param {import('postgres').Sql} sql - Database connection
 * @param {string} authorKey - Author key (e.g., '/authors/OL23919A')
 * @param {string} provider - Provider name
 * @param {Object} env - Worker environment
 * @returns {Promise<boolean>} - True if data was found and stored
 */
async function enrichAuthorFromProvider(sql, authorKey, provider, env) {
  if (provider !== 'openlibrary') {
    console.warn(`Author enrichment only supported for openlibrary, got: ${provider}`);
    return false;
  }

  try {
    // Normalize author key
    const key = authorKey.startsWith('/authors/') ? authorKey : `/authors/${authorKey}`;

    const response = await fetchWithRetry(
      `https://openlibrary.org${key}.json`,
      { headers: { 'User-Agent': 'Alexandria/1.0 (enrichment)' } },
      { timeoutMs: 10000, maxRetries: 2 }  // 10s timeout, 2 retries
    );

    if (!response.ok) {
      if (response.status === 404) return false;
      throw new Error(`OpenLibrary author API error: ${response.status}`);
    }

    const author = await response.json();

    if (!author) return false;

    // Extract bio
    let bio = null;
    if (typeof author.bio === 'string') {
      bio = author.bio;
    } else if (author.bio?.value) {
      bio = author.bio.value;
    }

    // Build photo URL if photo ID exists
    let photoUrl = null;
    if (author.photos && author.photos.length > 0) {
      const photoId = author.photos[0];
      if (typeof photoId === 'number' && photoId > 0) {
        photoUrl = `https://covers.openlibrary.org/a/id/${photoId}-L.jpg`;
      }
    }

    // Parse birth/death dates
    let birthYear = null;
    let deathYear = null;
    if (author.birth_date) {
      const match = author.birth_date.match(/\d{4}/);
      if (match) birthYear = parseInt(match[0]);
    }
    if (author.death_date) {
      const match = author.death_date.match(/\d{4}/);
      if (match) deathYear = parseInt(match[0]);
    }

    await enrichAuthor(sql, {
      author_key: key,
      name: author.name,
      bio,
      bio_source: bio ? 'openlibrary' : null,
      birth_year: birthYear,
      death_year: deathYear,
      author_photo_url: photoUrl,
      openlibrary_author_id: author.key?.replace('/authors/', ''),
      primary_provider: 'openlibrary'
    });

    return true;
  } catch (error) {
    console.error('OpenLibrary author fetch error:', error.message);
    throw error;
  }
}
