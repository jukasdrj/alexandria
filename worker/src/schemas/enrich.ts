/**
 * Enrichment API Schemas
 *
 * Zod schemas for enrichment endpoints with OpenAPI documentation
 */

import { z } from 'zod';

// =================================================================================
// Request Schemas
// =================================================================================

/**
 * Enrich Edition Schema
 * Stores or updates edition metadata in enriched_editions table
 */
export const EnrichEditionSchema = z
  .object({
    isbn: z.string().openapi({
      description: 'ISBN-10 or ISBN-13 (will be normalized)',
      example: '9780439064873',
    }),
    title: z.string().optional().openapi({
      description: 'Book title',
      example: 'Harry Potter and the Philosopher\'s Stone',
    }),
    subtitle: z.string().optional().openapi({
      description: 'Book subtitle',
      example: 'The First Book in the Series',
    }),
    publisher: z.string().optional().openapi({
      description: 'Publisher name',
      example: 'Bloomsbury',
    }),
    publication_date: z.string().optional().openapi({
      description: 'Publication date (any format)',
      example: '1997-06-26',
    }),
    page_count: z.number().int().optional().openapi({
      description: 'Number of pages',
      example: 223,
    }),
    format: z.string().optional().openapi({
      description: 'Book format (Hardcover, Paperback, etc.)',
      example: 'Hardcover',
    }),
    language: z.string().optional().openapi({
      description: 'Language code (ISO 639-1)',
      example: 'en',
    }),
    primary_provider: z.enum(['isbndb', 'google-books', 'openlibrary', 'user-correction']).openapi({
      description: 'Data source provider',
      example: 'isbndb',
    }),
    cover_urls: z
      .object({
        large: z.string().url().optional(),
        medium: z.string().url().optional(),
        small: z.string().url().optional(),
        original: z.string().url().optional(),
      })
      .optional()
      .openapi({
        description: 'Cover image URLs by size',
        example: {
          large: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
          medium: 'https://covers.openlibrary.org/b/id/8091323-M.jpg',
          small: 'https://covers.openlibrary.org/b/id/8091323-S.jpg',
        },
      }),
    cover_source: z.string().optional().openapi({
      description: 'Source of cover images',
      example: 'openlibrary',
    }),
    work_key: z.string().optional().openapi({
      description: 'OpenLibrary work key',
      example: '/works/OL45804W',
    }),
    openlibrary_edition_id: z.string().optional().openapi({
      description: 'OpenLibrary edition ID',
      example: '/books/OL7353617M',
    }),
    amazon_asins: z.array(z.string()).optional().openapi({
      description: 'Amazon ASIN identifiers',
      example: ['B000FC1MCS'],
    }),
    google_books_volume_ids: z.array(z.string()).optional().openapi({
      description: 'Google Books volume IDs',
      example: ['wrOQLV6xB-wC'],
    }),
    goodreads_edition_ids: z.array(z.string()).optional().openapi({
      description: 'Goodreads edition IDs',
      example: ['1234567'],
    }),
    alternate_isbns: z.array(z.string()).optional().openapi({
      description: 'Alternative ISBNs for this edition',
      example: ['0439064872', '9780439064873'],
    }),
    subjects: z.array(z.string()).optional().openapi({
      description: 'Subject/genre tags',
      example: ['Fantasy', 'Young Adult', 'Magic'],
    }),
    dewey_decimal: z.array(z.string()).optional().openapi({
      description: 'Dewey Decimal Classification codes',
      example: ['823.914'],
    }),
    binding: z.string().optional().openapi({
      description: 'Book binding type',
      example: 'Hardcover',
    }),
    related_isbns: z
      .object({})
      .catchall(z.string())
      .optional()
      .openapi({
        description: 'Related ISBNs (e.g., ePub, audiobook)',
        example: { epub: '9780439139601', audio: '9780307281937' },
      }),
    work_match_confidence: z.number().min(0).max(1).optional().openapi({
      description: 'Confidence score for work matching (0-1)',
      example: 0.95,
    }),
    work_match_source: z.string().optional().openapi({
      description: 'Source of work match',
      example: 'isbndb-direct',
    }),
  })
  .openapi('EnrichEditionRequest');

/**
 * Enrich Work Schema
 * Stores or updates work metadata in enriched_works table
 */
export const EnrichWorkSchema = z
  .object({
    work_key: z.string().openapi({
      description: 'Unique work identifier',
      example: '/works/OL45804W',
    }),
    title: z.string().openapi({
      description: 'Work title',
      example: 'Harry Potter and the Philosopher\'s Stone',
    }),
    subtitle: z.string().optional().openapi({
      description: 'Work subtitle',
      example: 'Book 1',
    }),
    description: z.string().optional().openapi({
      description: 'Work description/synopsis',
      example: 'Harry Potter is an ordinary boy who lives in a cupboard under the stairs...',
    }),
    original_language: z.string().optional().openapi({
      description: 'Original language of the work',
      example: 'en',
    }),
    first_publication_year: z.number().int().optional().openapi({
      description: 'First publication year',
      example: 1997,
    }),
    subject_tags: z.array(z.string()).optional().openapi({
      description: 'Subject/genre tags',
      example: ['Fantasy', 'Young Adult', 'Magic', 'Wizards'],
    }),
    primary_provider: z.enum(['isbndb', 'google-books', 'openlibrary']).openapi({
      description: 'Data source provider',
      example: 'isbndb',
    }),
    cover_urls: z
      .object({
        large: z.string().url().optional(),
        medium: z.string().url().optional(),
        small: z.string().url().optional(),
      })
      .optional()
      .openapi({
        description: 'Cover image URLs by size',
      }),
    cover_source: z.string().optional().openapi({
      description: 'Source of cover images',
      example: 'openlibrary',
    }),
    openlibrary_work_id: z.string().optional().openapi({
      description: 'OpenLibrary work ID',
      example: '/works/OL45804W',
    }),
    goodreads_work_ids: z.array(z.string()).optional().openapi({
      description: 'Goodreads work IDs',
      example: ['12345678'],
    }),
    amazon_asins: z.array(z.string()).optional().openapi({
      description: 'Amazon ASINs',
      example: ['B000FC1MCS'],
    }),
    google_books_volume_ids: z.array(z.string()).optional().openapi({
      description: 'Google Books volume IDs',
      example: ['wrOQLV6xB-wC'],
    }),
  })
  .openapi('EnrichWorkRequest');

/**
 * Enrich Author Schema
 * Stores or updates author biographical data in enriched_authors table
 */
export const EnrichAuthorSchema = z
  .object({
    author_key: z.string().openapi({
      description: 'Unique author identifier',
      example: '/authors/OL23919A',
    }),
    name: z.string().openapi({
      description: 'Author name',
      example: 'J.K. Rowling',
    }),
    gender: z.string().optional().openapi({
      description: 'Gender',
      example: 'female',
    }),
    nationality: z.string().optional().openapi({
      description: 'Nationality',
      example: 'British',
    }),
    birth_year: z.number().int().optional().openapi({
      description: 'Birth year',
      example: 1965,
    }),
    death_year: z.number().int().optional().openapi({
      description: 'Death year (if applicable)',
      example: null,
    }),
    bio: z.string().optional().openapi({
      description: 'Author biography',
      example: 'Joanne Rowling, better known by her pen name J.K. Rowling...',
    }),
    bio_source: z.string().optional().openapi({
      description: 'Source of biography',
      example: 'wikidata',
    }),
    author_photo_url: z.string().url().optional().openapi({
      description: 'Author photo URL',
      example: 'https://upload.wikimedia.org/wikipedia/commons/5/5d/J._K._Rowling_2010.jpg',
    }),
    primary_provider: z.enum(['isbndb', 'openlibrary', 'wikidata']).openapi({
      description: 'Data source provider',
      example: 'wikidata',
    }),
    openlibrary_author_id: z.string().optional().openapi({
      description: 'OpenLibrary author ID',
      example: '/authors/OL23919A',
    }),
    goodreads_author_ids: z.array(z.string()).optional().openapi({
      description: 'Goodreads author IDs',
      example: ['1077326'],
    }),
    wikidata_id: z.string().optional().openapi({
      description: 'Wikidata ID',
      example: 'Q34660',
    }),
  })
  .openapi('EnrichAuthorRequest');

/**
 * Queue Enrichment Schema
 * Queues background enrichment job
 */
export const QueueEnrichmentSchema = z
  .object({
    entity_type: z.enum(['work', 'edition', 'author']).openapi({
      description: 'Type of entity to enrich',
      example: 'edition',
    }),
    entity_key: z.string().openapi({
      description: 'Entity identifier (ISBN for editions, work_key for works, author_key for authors)',
      example: '9780439064873',
    }),
    providers_to_try: z.array(z.string()).min(1).openapi({
      description: 'List of providers to query (isbndb, google-books, openlibrary)',
      example: ['isbndb', 'google-books', 'openlibrary'],
    }),
    priority: z
      .union([
        z.number().int().min(1).max(10),
        z.enum(['urgent', 'high', 'medium', 'normal', 'low', 'background']),
      ])
      .default(5)
      .openapi({
        description: 'Priority level (1-10 or string: urgent/high/medium/normal/low/background)',
        example: 'high',
      }),
  })
  .openapi('QueueEnrichmentRequest');

/**
 * Queue Batch Schema
 * Queues multiple enrichment jobs (max 100)
 */
export const QueueBatchSchema = z
  .object({
    books: z
      .array(
        z.object({
          isbn: z.string(),
          priority: z
            .enum(['urgent', 'high', 'medium', 'normal', 'low', 'background'])
            .default('normal')
            .optional(),
          source: z.string().default('unknown').optional(),
          title: z.string().optional(),
          author: z.string().optional(),
        })
      )
      .max(100)
      .openapi({
        description: 'Array of books to queue (max 100)',
        example: [
          { isbn: '9780439064873', priority: 'high', source: 'user-import' },
          { isbn: '9780545010221', priority: 'normal', source: 'user-import' },
        ],
      }),
  })
  .openapi('QueueBatchRequest');

/**
 * Batch Direct Schema
 * Direct batch enrichment (bypasses queue, up to 1000 ISBNs)
 */
export const BatchDirectSchema = z
  .object({
    isbns: z.array(z.string()).min(1).max(1000).openapi({
      description: 'Array of ISBNs to enrich (max 1000)',
      example: ['9780439064873', '9780545010221', '9781492666868'],
    }),
    source: z.string().default('batch-direct').optional().openapi({
      description: 'Source identifier for analytics',
      example: 'bulk-import',
    }),
  })
  .openapi('BatchDirectRequest');

// =================================================================================
// Response Schemas
// =================================================================================

/**
 * Enrichment Result Schema
 * Response from edition/work/author enrichment
 */
export const EnrichmentResultSchema = z
  .object({
    success: z.boolean().openapi({
      description: 'Whether the operation succeeded',
      example: true,
    }),
    data: z
      .object({
        isbn: z.string().optional(),
        work_key: z.string().optional(),
        author_key: z.string().optional(),
        action: z.enum(['created', 'updated']).openapi({
          description: 'Whether the record was created or updated',
          example: 'created',
        }),
        quality_improvement: z.number().optional().openapi({
          description: 'Quality score improvement (editions only)',
          example: 15,
        }),
        stored_at: z.string().openapi({
          description: 'Timestamp of storage',
          example: '2025-12-13T10:30:00.000Z',
        }),
      })
      .optional(),
    error: z.string().optional(),
    details: z.array(z.string()).optional(),
    message: z.string().optional(),
  })
  .openapi('EnrichmentResult');

/**
 * Queue Result Schema
 * Response from queue enrichment endpoint
 */
export const QueueResultSchema = z
  .object({
    success: z.boolean().openapi({
      description: 'Whether the operation succeeded',
      example: true,
    }),
    data: z
      .object({
        queue_id: z.string().openapi({
          description: 'Queue job ID',
          example: '550e8400-e29b-41d4-a716-446655440000',
        }),
        position_in_queue: z.number().int().openapi({
          description: 'Position in queue',
          example: 5,
        }),
        estimated_processing_time: z.string().openapi({
          description: 'Estimated time to process',
          example: '1-5 minutes',
        }),
      })
      .optional(),
    error: z.string().optional(),
    details: z.array(z.string()).optional(),
    message: z.string().optional(),
  })
  .openapi('QueueResult');

/**
 * Queue Batch Result Schema
 * Response from batch queue endpoint
 */
export const QueueBatchResultSchema = z
  .object({
    queued: z.number().int().openapi({
      description: 'Number of ISBNs queued',
      example: 98,
    }),
    failed: z.number().int().openapi({
      description: 'Number of failures',
      example: 2,
    }),
    errors: z
      .array(
        z.object({
          isbn: z.string(),
          error: z.string(),
        })
      )
      .openapi({
        description: 'Array of errors',
        example: [{ isbn: '1234567890', error: 'Invalid ISBN format' }],
      }),
  })
  .openapi('QueueBatchResult');

/**
 * Enrichment Status Schema
 * Job status response
 */
export const EnrichmentStatusSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        id: z.string(),
        entity_type: z.string(),
        entity_key: z.string(),
        status: z.string(),
        providers_attempted: z.array(z.string()).nullable(),
        providers_succeeded: z.array(z.string()).nullable(),
        retry_count: z.number().int(),
        created_at: z.string(),
        completed_at: z.string().nullable(),
        error_message: z.string().nullable(),
      })
      .optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .openapi('EnrichmentStatus');

/**
 * Batch Direct Result Schema
 * Response from batch-direct endpoint
 */
export const BatchDirectResultSchema = z
  .object({
    requested: z.number().int().openapi({
      description: 'Number of ISBNs requested',
      example: 100,
    }),
    found: z.number().int().openapi({
      description: 'Number found in ISBNdb',
      example: 95,
    }),
    enriched: z.number().int().openapi({
      description: 'Number successfully enriched',
      example: 93,
    }),
    failed: z.number().int().openapi({
      description: 'Number of failures',
      example: 2,
    }),
    not_found: z.number().int().openapi({
      description: 'Number not found in ISBNdb',
      example: 5,
    }),
    covers_queued: z.number().int().openapi({
      description: 'Number of covers queued for download',
      example: 87,
    }),
    errors: z
      .array(
        z.object({
          isbn: z.string(),
          error: z.string(),
        })
      )
      .openapi({
        description: 'Array of errors',
        example: [{ isbn: '9781234567890', error: 'Database operation failed' }],
      }),
    api_calls: z.number().int().openapi({
      description: 'Number of ISBNdb API calls made',
      example: 1,
    }),
    duration_ms: z.number().int().openapi({
      description: 'Total duration in milliseconds',
      example: 2340,
    }),
  })
  .openapi('BatchDirectResult');

// Re-export centralized ErrorResponseSchema
export { ErrorResponseSchema } from './response.js';
