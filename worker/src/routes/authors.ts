import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import type { DatabaseRow } from '../types/database.js';
import {
  TopAuthorsQuerySchema,
  AuthorKeyParamSchema,
  BibliographyRequestSchema,
  EnrichBibliographyRequestSchema,
  EnrichWikidataRequestSchema,
  TopAuthorsResponseSchema,
  AuthorDetailsSchema,
  BibliographyResponseSchema,
  EnrichBibliographyResponseSchema,
  EnrichWikidataResponseSchema,
  EnrichStatusResponseSchema,
  AuthorErrorSchema,
} from '../schemas/authors.js';
import { enrichWork, enrichEdition } from '../services/enrichment-service.js';
import { fetchWikidataMultipleBatches } from '../../services/wikidata-client.js';
import { findOrCreateWork, linkWorkToAuthors } from '../services/work-utils.js';

// =================================================================================
// ISBNdb Types
// =================================================================================

interface ISBNdbAuthorBook {
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

interface ISBNdbAuthorResponse {
  books?: ISBNdbAuthorBook[];
  total?: number;
}

// =================================================================================
// Route Definitions
// =================================================================================

const topAuthorsRoute = createRoute({
  method: 'get',
  path: '/api/authors/top',
  tags: ['Authors'],
  summary: 'Get top authors by work count',
  description: 'Returns top authors sorted by number of works. Excludes institutional/corporate authors. Results are cached for 24 hours.',
  request: {
    query: TopAuthorsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of top authors',
      content: {
        'application/json': {
          schema: TopAuthorsResponseSchema,
        },
      },
    },
    500: {
      description: 'Database query failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const authorDetailsRoute = createRoute({
  method: 'get',
  path: '/api/authors/:key',
  tags: ['Authors'],
  summary: 'Get author details by key',
  description: 'Get detailed author information including diversity data from Wikidata. Supports both formats: "OL7234434A" and "/authors/OL7234434A".',
  request: {
    params: AuthorKeyParamSchema,
  },
  responses: {
    200: {
      description: 'Author details',
      content: {
        'application/json': {
          schema: AuthorDetailsSchema,
        },
      },
    },
    404: {
      description: 'Author not found',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    500: {
      description: 'Database query failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const bibliographyRoute = createRoute({
  method: 'post',
  path: '/api/authors/bibliography',
  tags: ['Authors'],
  summary: 'Get author bibliography from ISBNdb',
  description: 'Fetch author bibliography from ISBNdb API. Returns list of books with ISBNs. Uses ISBNdb Premium endpoint (3 req/sec).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BibliographyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Author bibliography retrieved',
      content: {
        'application/json': {
          schema: BibliographyResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    429: {
      description: 'Rate limited by ISBNdb',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    500: {
      description: 'API error',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const enrichBibliographyRoute = createRoute({
  method: 'post',
  path: '/api/authors/enrich-bibliography',
  tags: ['Authors'],
  summary: 'Fetch and enrich author bibliography',
  description: 'Fetch author bibliography from ISBNdb AND directly enrich Alexandria database with metadata. 50-90% more efficient than separate fetch + enrich. Queues cover downloads for background processing.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichBibliographyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Bibliography fetched and enriched',
      content: {
        'application/json': {
          schema: EnrichBibliographyResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    429: {
      description: 'Rate limited by ISBNdb',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
    500: {
      description: 'Enrichment failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const enrichWikidataRoute = createRoute({
  method: 'post',
  path: '/api/authors/enrich-wikidata',
  tags: ['Authors'],
  summary: 'Enrich authors from Wikidata',
  description: 'Enrich author diversity data (gender, nationality, birth/death info) from Wikidata. Processes authors that have wikidata_id but not yet enriched.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: EnrichWikidataRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Authors enriched from Wikidata',
      content: {
        'application/json': {
          schema: EnrichWikidataResponseSchema,
        },
      },
    },
    500: {
      description: 'Enrichment failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

const enrichStatusRoute = createRoute({
  method: 'get',
  path: '/api/authors/enrich-status',
  tags: ['Authors'],
  summary: 'Get enrichment queue status',
  description: 'Get statistics on author enrichment progress: total authors, Wikidata coverage, diversity field coverage.',
  responses: {
    200: {
      description: 'Enrichment status',
      content: {
        'application/json': {
          schema: EnrichStatusResponseSchema,
        },
      },
    },
    500: {
      description: 'Status check failed',
      content: {
        'application/json': {
          schema: AuthorErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

// GET /api/authors/top
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(topAuthorsRoute, async (c) => {
  const startTime = Date.now();

  try {
    const sql = c.get('sql');
    const { offset, limit, nocache } = c.req.valid('query');

    // Check cache first (expensive query ~20s)
    const cacheKey = `top_authors:${offset}:${limit}`;
    if (!nocache) {
      const cached = await c.env.CACHE.get(cacheKey, 'json');
      if (cached) {
        return c.json({
          ...cached,
          cached: true,
          query_duration_ms: Date.now() - startTime
        });
      }
    }

    // Query authors sorted by work count (faster than edition count)
    // Excludes institutional/corporate authors that won't have ISBNdb entries
    const authors = await sql`
      SELECT
        a.key as author_key,
        a.data->>'name' as author_name,
        COUNT(*)::int as work_count
      FROM authors a
      JOIN author_works aw ON aw.author_key = a.key
      WHERE a.data->>'name' IS NOT NULL
        AND LENGTH(a.data->>'name') > 3
        AND a.data->>'name' !~* '^(United States|Great Britain|Anonymous|Congress|House|Senate|Committee|Department|Ministry|Government|Office|Board|Bureau|Commission|Council|Agency|Institute|Corporation|Company|Ltd|Inc|Corp|Association|Society|Foundation|University|College|Library|Museum|Press|Publishing|Rand McNally|ICON Group|Philip M\. Parker|\[name missing\])'
        AND a.data->>'name' NOT LIKE '%Congress%'
        AND a.data->>'name' NOT LIKE '%Parliament%'
        AND a.data->>'name' NOT LIKE '%Government%'
        AND a.data->>'name' NOT LIKE '%Ministry%'
      GROUP BY a.key, a.data->>'name'
      ORDER BY COUNT(*) DESC
      OFFSET ${offset}
      LIMIT ${limit}
    `;

    const result = {
      authors: authors.map(a => ({
        author_key: a.author_key,
        author_name: a.author_name,
        work_count: a.work_count
      })),
      pagination: {
        offset,
        limit,
        returned: authors.length
      }
    };

    // Cache for 24 hours (expensive query)
    await c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });

    return c.json({
      ...result,
      cached: false,
      query_duration_ms: Date.now() - startTime
    });
  } catch (error) {
    c.get('logger')?.error('Top authors query error', { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to query top authors', message }, 500);
  }
});

// GET /api/authors/:key
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(authorDetailsRoute, async (c) => {
  const startTime = Date.now();

  try {
    const sql = c.get('sql');
    let { key: authorKey } = c.req.valid('param');

    // Handle both formats: "OL7234434A" and "/authors/OL7234434A"
    if (!authorKey.startsWith('/authors/')) {
      authorKey = `/authors/${authorKey}`;
    }

    const results = await sql`
      SELECT
        author_key,
        name,
        gender,
        gender_qid,
        nationality,
        citizenship_qid,
        birth_year,
        death_year,
        birth_place,
        birth_place_qid,
        birth_country,
        birth_country_qid,
        death_place,
        death_place_qid,
        bio,
        bio_source,
        wikidata_id,
        openlibrary_author_id,
        goodreads_author_ids,
        author_photo_url,
        book_count,
        wikidata_enriched_at
      FROM enriched_authors
      WHERE author_key = ${authorKey}
      LIMIT 1
    `;

    if (results.length === 0) {
      return c.json({
        error: 'Author not found',
        author_key: authorKey
      }, 404);
    }

    const author = results[0];

    return c.json({
      author_key: author.author_key,
      name: author.name,
      gender: author.gender ?? null,
      gender_qid: author.gender_qid ?? null,
      nationality: author.nationality ?? null,
      citizenship_qid: author.citizenship_qid ?? null,
      birth_year: author.birth_year ?? null,
      death_year: author.death_year ?? null,
      birth_place: author.birth_place ?? null,
      birth_place_qid: author.birth_place_qid ?? null,
      birth_country: author.birth_country ?? null,
      birth_country_qid: author.birth_country_qid ?? null,
      death_place: author.death_place ?? null,
      death_place_qid: author.death_place_qid ?? null,
      bio: author.bio ?? null,
      bio_source: author.bio_source ?? null,
      wikidata_id: author.wikidata_id ?? null,
      openlibrary_author_id: author.openlibrary_author_id ?? null,
      goodreads_author_ids: author.goodreads_author_ids ?? null,
      author_photo_url: author.author_photo_url ?? null,
      book_count: author.book_count ?? 0,
      wikidata_enriched_at: author.wikidata_enriched_at?.toISOString() ?? null,
      query_duration_ms: Date.now() - startTime
    });
  } catch (error) {
    c.get('logger')?.error('Author details error', { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to fetch author details', message }, 500);
  }
});

// POST /api/authors/bibliography
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(bibliographyRoute, async (c) => {
  try {
    const { author_name, max_pages = 10 } = c.req.valid('json');

    const apiKey = await c.env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      return c.json({ error: 'ISBNdb API key not configured' }, 500);
    }

    const pageSize = 100;
    const books: Array<{isbn: string; title: string; author: string; publisher?: string; date_published?: string}> = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= max_pages) {
      // Use Premium endpoint for 3x throughput (3 req/sec vs 1 req/sec)
      const response = await fetch(
        `https://api.premium.isbndb.com/author/${encodeURIComponent(author_name)}?page=${page}&pageSize=${pageSize}`,
        {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 404) {
        // Author not found
        break;
      }

      if (response.status === 429) {
        return c.json({ error: 'Rate limited by ISBNdb' }, 429);
      }

      if (!response.ok) {
        return c.json({ error: `ISBNdb API error: ${response.status}` }, 500);
      }

      const data = await response.json() as ISBNdbAuthorResponse;

      // Debug: log the pagination info from ISBNdb
      c.get('logger')?.info('[Bibliography] Page info', { page, total: data.total, books_in_response: data.books?.length || 0 });

      if (data.books && Array.isArray(data.books)) {
        for (const book of data.books) {
          const isbn = book.isbn13 || book.isbn;
          if (isbn) {
            books.push({
              isbn,
              title: book.title || 'Unknown',
              author: book.authors?.[0] || author_name,
              publisher: book.publisher,
              date_published: book.date_published
            });
          }
        }
      }

      // ISBNdb pagination: if we got a full page, there might be more
      // Also check data.total if available
      const booksInResponse = data.books?.length || 0;
      const total = data.total || 0;

      // Continue if: we got a full page OR total indicates more pages exist
      hasMore = booksInResponse === pageSize || (total > 0 && books.length < total);

      c.get('logger')?.info('[Bibliography] After page', { page, collected: books.length, hasMore });

      page++;

      // Rate limit between pagination requests (ISBNdb Premium: 3 req/sec)
      if (hasMore && page <= max_pages) {
        await new Promise(resolve => setTimeout(resolve, 350)); // 350ms delay for 3 req/sec
      }
    }

    return c.json({
      author: author_name,
      books_found: books.length,
      pages_fetched: page - 1,
      books
    });
  } catch (error) {
    c.get('logger')?.error('Author bibliography error', { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to fetch author bibliography', message }, 500);
  }
});

// POST /api/authors/enrich-bibliography
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(enrichBibliographyRoute, async (c) => {
  const startTime = Date.now();

  try {
    const { author_name, max_pages = 10, skip_existing = true } = c.req.valid('json');

    const apiKey = await c.env.ISBNDB_API_KEY.get();
    if (!apiKey) {
      return c.json({ error: 'ISBNdb API key not configured' }, 500);
    }

    // Check KV cache for this author (avoid redundant API calls)
    const cacheKey = `author_bibliography:${author_name.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = await c.env.CACHE.get(cacheKey, 'json');

    if (cached) {
      c.get('logger')?.info('[EnrichBibliography] Cache hit', { author_name });
      return c.json({
        ...cached,
        cached: true,
        duration_ms: Date.now() - startTime
      });
    }

    const sql = c.get('sql');
    const pageSize = 100;

    // Track results
    const results = {
      author: author_name,
      books_found: 0,
      already_existed: 0,
      enriched: 0,
      covers_queued: 0,
      failed: 0,
      pages_fetched: 0,
      api_calls: 0,  // Track ISBNdb API calls
      errors: [] as Array<{ isbn: string; error: string }>,
      duration_ms: 0
    };

    // Collect all books from ISBNdb author endpoint (with full metadata!)
    const allBooks: Array<{
      isbn: string;
      title: string;
      authors: string[];
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
    }> = [];

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= max_pages) {
      const response = await fetch(
        `https://api.premium.isbndb.com/author/${encodeURIComponent(author_name)}?page=${page}&pageSize=${pageSize}`,
        {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      results.api_calls++;

      if (response.status === 404) {
        break;
      }

      if (response.status === 429) {
        return c.json({ error: 'Rate limited by ISBNdb', partial_results: results }, 429);
      }

      if (!response.ok) {
        return c.json({ error: `ISBNdb API error: ${response.status}`, partial_results: results }, 500);
      }

      const data = await response.json() as ISBNdbAuthorResponse;
      results.pages_fetched = page;

      if (data.books && Array.isArray(data.books)) {
        for (const book of data.books) {
          const isbn = book.isbn13 || book.isbn;
          if (isbn) {
            allBooks.push({
              isbn,
              title: book.title_long || book.title || 'Unknown',
              authors: book.authors || [author_name],
              publisher: book.publisher,
              date_published: book.date_published,
              pages: book.pages,
              language: book.language,
              synopsis: book.synopsis,
              image: book.image,
              image_original: book.image_original, // High-quality cover (2hr expiry!)
              subjects: book.subjects,
              binding: book.binding,
              dewey_decimal: book.dewey_decimal,
              related: book.related,
            });
          }
        }
      }

      const booksInResponse = data.books?.length || 0;
      const total = data.total || 0;
      hasMore = booksInResponse === pageSize || (total > 0 && allBooks.length < total);

      page++;

      // Rate limit between pagination requests (ISBNdb Premium: 3 req/sec)
      if (hasMore && page <= max_pages) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    results.books_found = allBooks.length;
    c.get('logger')?.info('[EnrichBibliography] Found books', { books_found: allBooks.length, author_name, api_calls: results.api_calls });

    if (allBooks.length === 0) {
      // Cache empty result to avoid repeated lookups
      await c.env.CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: 86400 });
      results.duration_ms = Date.now() - startTime;
      return c.json(results);
    }

    // Check which ISBNs already exist (if skip_existing is true)
    let isbnsToEnrich = allBooks;

    if (skip_existing) {
      const allISBNs = allBooks.map(b => b.isbn);
      const existingResult = await sql`
        SELECT isbn FROM enriched_editions
        WHERE isbn IN ${sql(allISBNs)}
      `;
      const existingSet = new Set(existingResult.map((r: DatabaseRow) => r.isbn));
      results.already_existed = existingSet.size;

      isbnsToEnrich = allBooks.filter(b => !existingSet.has(b.isbn));
      c.get('logger')?.info('[EnrichBibliography] Existing vs new', { already_existed: existingSet.size, to_enrich: isbnsToEnrich.length });
    }

    // DIRECTLY enrich from the data we already have (NO re-fetch from ISBNdb!)
    for (const book of isbnsToEnrich) {
      try {
        // Find or create work (deduplication via consensus-driven algorithm)
        // Order: ISBN lookup → Author-scoped fuzzy title → Exact title → Generate new
        const { workKey, isNew: isNewWork } = await findOrCreateWork(
          sql,
          book.isbn,
          book.title,
          book.authors
        );

        // Only create enriched_work if it's genuinely new
        if (isNewWork) {
          await enrichWork(sql, {
            work_key: workKey,
            title: book.title,
            description: book.synopsis,
            subject_tags: book.subjects,
            primary_provider: 'isbndb',
          }, c.get('logger'));
        }

        // ALWAYS link work to authors (idempotent via ON CONFLICT DO NOTHING)
        // This fixes the 99.8% orphaned works bug
        if (book.authors && book.authors.length > 0) {
          await linkWorkToAuthors(sql, workKey, book.authors);
        }

        // Create enriched_edition with all the metadata we already have
        // Prefer image_original for highest quality (but it expires in 2hrs!)
        const hasCover = book.image_original || book.image;
        const coverUrls = hasCover ? {
          original: book.image_original, // High-quality original (best for R2)
          large: book.image,
          medium: book.image,
          small: book.image,
        } : undefined;

        await enrichEdition(sql, {
          isbn: book.isbn,
          title: book.title,
          publisher: book.publisher,
          publication_date: book.date_published,
          page_count: book.pages,
          language: book.language,
          primary_provider: 'isbndb',
          cover_urls: coverUrls,
          cover_source: hasCover ? 'isbndb' : undefined,
          work_key: workKey,
          subjects: book.subjects,
          binding: book.binding,
          dewey_decimal: book.dewey_decimal,
          related_isbns: book.related,
        }, c.get('logger'), c.env);

        results.enriched++;

        // Queue cover download - prefer image_original (expires in 2hrs!) for best quality
        if (hasCover) {
          try {
            const bestCoverUrl = book.image_original || book.image;
            await c.env.COVER_QUEUE.send({
              isbn: book.isbn,
              work_key: workKey,
              provider_url: bestCoverUrl,
              priority: 'high', // Bump priority since image_original expires!
              source: 'author_bibliography'
            });
            results.covers_queued++;
          } catch (queueError) {
            // Don't fail enrichment if cover queue fails
            c.get('logger')?.warn('[EnrichBibliography] Cover queue failed', { isbn: book.isbn, error: queueError });
          }
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.failed++;
        results.errors.push({ isbn: book.isbn, error: message });
      }
    }

    results.duration_ms = Date.now() - startTime;

    // Cache successful result (24 hours)
    const cacheResult = { ...results, errors: [] }; // Don't cache individual errors
    await c.env.CACHE.put(cacheKey, JSON.stringify(cacheResult), { expirationTtl: 86400 });

    c.get('logger')?.info('[EnrichBibliography] Complete', {
      author_name,
      enriched: results.enriched,
      already_existed: results.already_existed,
      failed: results.failed,
      duration_ms: results.duration_ms
    });

    return c.json(results);

  } catch (error) {
    c.get('logger')?.error('[EnrichBibliography] Error', { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      error: 'Failed to enrich author bibliography',
      message,
      duration_ms: Date.now() - startTime
    }, 500);
  }
});

// POST /api/authors/enrich-wikidata
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(enrichWikidataRoute, async (c) => {
  const sql = c.get('sql');

  try {
    const { limit = 100, force_refresh = false } = c.req.valid('json');

    // Get authors with wikidata_id but not yet enriched
    const authorsToEnrich = await sql`
      SELECT author_key, wikidata_id, name
      FROM enriched_authors
      WHERE wikidata_id IS NOT NULL
        AND (wikidata_enriched_at IS NULL OR ${force_refresh})
      ORDER BY
        CASE WHEN birth_year IS NOT NULL THEN 0 ELSE 1 END, -- Prioritize those with some data
        author_key
      LIMIT ${limit}
    `;

    if (authorsToEnrich.length === 0) {
      return c.json({
        message: 'No authors to enrich',
        processed: 0,
        enriched: 0
      });
    }

    // Extract Q-IDs for Wikidata batch fetch
    const qids = authorsToEnrich.map((a) => a.wikidata_id).filter(Boolean);

    // Fetch from Wikidata
    const wikidataResults = await fetchWikidataMultipleBatches(qids);

    // Update database
    let enrichedCount = 0;
    const results: { author_key: string; wikidata_id: string; fields_updated: string[]; error?: string }[] = [];

    for (const author of authorsToEnrich) {
      const data = wikidataResults.get(author.wikidata_id);

      if (data) {
        const fieldsUpdated: string[] = [];

        // Build update fields
        if (data.gender) fieldsUpdated.push('gender');
        if (data.gender_qid) fieldsUpdated.push('gender_qid');
        if (data.citizenship) fieldsUpdated.push('nationality');
        if (data.citizenship_qid) fieldsUpdated.push('citizenship_qid');
        if (data.birth_year) fieldsUpdated.push('birth_year');
        if (data.death_year) fieldsUpdated.push('death_year');
        if (data.birth_place) fieldsUpdated.push('birth_place');
        if (data.birth_place_qid) fieldsUpdated.push('birth_place_qid');
        if (data.birth_country) fieldsUpdated.push('birth_country');
        if (data.birth_country_qid) fieldsUpdated.push('birth_country_qid');
        if (data.death_place) fieldsUpdated.push('death_place');
        if (data.death_place_qid) fieldsUpdated.push('death_place_qid');
        if (data.occupations?.length) fieldsUpdated.push('occupations');
        if (data.image_url) fieldsUpdated.push('author_photo_url');

        // Convert undefined to null for postgres
        const gender = data.gender ?? null;
        const gender_qid = data.gender_qid ?? null;
        const citizenship = data.citizenship ?? null;
        const citizenship_qid = data.citizenship_qid ?? null;
        const birth_year = data.birth_year ?? null;
        const death_year = data.death_year ?? null;
        const birth_place = data.birth_place ?? null;
        const birth_place_qid = data.birth_place_qid ?? null;
        const birth_country = data.birth_country ?? null;
        const birth_country_qid = data.birth_country_qid ?? null;
        const death_place = data.death_place ?? null;
        const death_place_qid = data.death_place_qid ?? null;
        // TODO: Add occupations to UPDATE query when enriched_authors table has the column
        const image_url = data.image_url ?? null;

        await sql`
          UPDATE enriched_authors
          SET
            gender = COALESCE(${gender}, gender),
            gender_qid = COALESCE(${gender_qid}, gender_qid),
            nationality = COALESCE(${citizenship}, nationality),
            citizenship_qid = COALESCE(${citizenship_qid}, citizenship_qid),
            birth_year = COALESCE(${birth_year}, birth_year),
            death_year = COALESCE(${death_year}, death_year),
            birth_place = COALESCE(${birth_place}, birth_place),
            birth_place_qid = COALESCE(${birth_place_qid}, birth_place_qid),
            birth_country = COALESCE(${birth_country}, birth_country),
            birth_country_qid = COALESCE(${birth_country_qid}, birth_country_qid),
            death_place = COALESCE(${death_place}, death_place),
            death_place_qid = COALESCE(${death_place_qid}, death_place_qid),
            author_photo_url = COALESCE(${image_url}, author_photo_url),
            wikidata_enriched_at = NOW(),
            enrichment_source = 'wikidata',
            updated_at = NOW()
          WHERE author_key = ${author.author_key}
        `;

        enrichedCount++;
        results.push({
          author_key: author.author_key,
          wikidata_id: author.wikidata_id,
          fields_updated: fieldsUpdated
        });
      } else {
        // Mark as attempted even if no data found
        await sql`
          UPDATE enriched_authors
          SET
            wikidata_enriched_at = NOW(),
            enrichment_source = 'wikidata_empty',
            updated_at = NOW()
          WHERE author_key = ${author.author_key}
        `;

        results.push({
          author_key: author.author_key,
          wikidata_id: author.wikidata_id,
          fields_updated: [],
          error: 'No data returned from Wikidata'
        });
      }
    }

    return c.json({
      processed: authorsToEnrich.length,
      enriched: enrichedCount,
      wikidata_fetched: wikidataResults.size,
      results
    });

  } catch (error) {
    c.get('logger')?.error('Wikidata enrichment error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Enrichment failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/authors/enrich-status
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(enrichStatusRoute, async (c) => {
  const sql = c.get('sql');

  try {
    const stats = await sql`
      SELECT
        COUNT(*) as total_authors,
        COUNT(wikidata_id) as has_wikidata_id,
        COUNT(wikidata_enriched_at) as wikidata_enriched,
        COUNT(CASE WHEN gender IS NOT NULL AND gender != 'Unknown' THEN 1 END) as has_gender,
        COUNT(nationality) as has_nationality,
        COUNT(birth_place) as has_birth_place,
        COUNT(CASE WHEN wikidata_id IS NOT NULL AND wikidata_enriched_at IS NULL THEN 1 END) as pending_enrichment
      FROM enriched_authors
    `;

    return c.json({
      total_authors: Number(stats[0].total_authors),
      has_wikidata_id: Number(stats[0].has_wikidata_id),
      wikidata_enriched: Number(stats[0].wikidata_enriched),
      pending_enrichment: Number(stats[0].pending_enrichment),
      diversity_fields: {
        has_gender: Number(stats[0].has_gender),
        has_nationality: Number(stats[0].has_nationality),
        has_birth_place: Number(stats[0].has_birth_place)
      }
    });

  } catch (error) {
    c.get('logger')?.error('Enrichment status error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Status check failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app;
