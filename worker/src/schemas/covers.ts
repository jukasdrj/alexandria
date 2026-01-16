/**
 * Cover API Schemas
 *
 * Zod schemas for cover processing endpoints with OpenAPI documentation
 */

import { z } from 'zod';

// =================================================================================
// Request Schemas
// =================================================================================

/**
 * Process Cover Schema
 * Processes a cover image from a provider URL and stores in R2
 *
 * Storage: Uses isbn/{isbn}/ path (consolidated - Issue #95)
 */
export const ProcessCoverSchema = z
  .object({
    isbn: z.string().openapi({
      description: 'ISBN-10 or ISBN-13 (REQUIRED - used as storage key)',
      example: '9780439064873',
    }),
    provider_url: z.string().url().openapi({
      description: 'Provider cover image URL',
      example: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
    }),
    work_key: z.string().optional().openapi({
      description: 'OpenLibrary work key (optional, for metadata)',
      example: '/works/OL45804W',
    }),
  })
  .openapi('ProcessCoverRequest');

/**
 * Queue Cover Schema
 * Queues multiple cover processing jobs for background processing
 */
export const QueueCoverBookSchema = z.object({
  isbn: z.string().openapi({
    description: 'ISBN-10 or ISBN-13',
    example: '9780439064873',
  }),
  work_key: z.string().optional().openapi({
    description: 'OpenLibrary work key',
    example: '/works/OL45804W',
  }),
  priority: z.enum(['low', 'normal', 'high']).optional().default('normal').openapi({
    description: 'Processing priority',
    example: 'normal',
  }),
  source: z.string().optional().default('unknown').openapi({
    description: 'Source of the request (for analytics)',
    example: 'user_add',
  }),
  title: z.string().optional().openapi({
    description: 'Book title (optional, for logging)',
    example: 'Harry Potter and the Philosopher\'s Stone',
  }),
  author: z.string().optional().openapi({
    description: 'Author name (optional, for logging)',
    example: 'J.K. Rowling',
  }),
});

export const QueueCoverSchema = z
  .object({
    books: z.array(QueueCoverBookSchema).min(1).max(100).openapi({
      description: 'Array of books to queue for cover processing (max 100)',
    }),
  })
  .openapi('QueueCoverRequest');

/**
 * Serve Cover Path Parameters
 */
export const ServeCoverParamsSchema = z.object({
  work_key: z.string().openapi({
    description: 'OpenLibrary work key (without /works/ prefix)',
    example: 'OL45804W',
  }),
  size: z.enum(['large', 'medium', 'small']).openapi({
    description: 'Cover size to serve',
    example: 'medium',
  }),
});

// =================================================================================
// Response Schemas
// =================================================================================

/**
 * Cover URLs Schema
 * Uses ISBN-based paths (consolidated - Issue #95)
 */
const CoverURLsSchema = z.object({
  large: z.string().url().openapi({
    description: 'Large cover URL (512x768)',
    example: 'https://alexandria.ooheynerds.com/covers/9780439064873/large',
  }),
  medium: z.string().url().openapi({
    description: 'Medium cover URL (256x384)',
    example: 'https://alexandria.ooheynerds.com/covers/9780439064873/medium',
  }),
  small: z.string().url().openapi({
    description: 'Small cover URL (128x192)',
    example: 'https://alexandria.ooheynerds.com/covers/9780439064873/small',
  }),
}).openapi('CoverURLs');

/**
 * Cover Metadata Schema
 * Uses ISBN-based storage paths (consolidated - Issue #95)
 */
const CoverMetadataSchema = z.object({
  processedAt: z.string().openapi({
    description: 'ISO timestamp of processing',
    example: '2025-12-13T10:30:00.000Z',
  }),
  originalSize: z.number().openapi({
    description: 'Original image size in bytes',
    example: 245678,
  }),
  r2Key: z.string().openapi({
    description: 'R2 storage key (ISBN-based path)',
    example: 'isbn/9780439064873/original.jpg',
  }),
  sourceUrl: z.string().url().openapi({
    description: 'Original provider URL',
    example: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
  }),
  workKey: z.string().nullable().openapi({
    description: 'OpenLibrary work key (optional)',
    example: '/works/OL45804W',
  }),
  isbn: z.string().openapi({
    description: 'ISBN used as storage key',
    example: '9780439064873',
  }),
}).openapi('CoverMetadata');

/**
 * Process Cover Success Response
 */
export const ProcessCoverSuccessSchema = z
  .object({
    success: z.literal(true),
    urls: CoverURLsSchema,
    metadata: CoverMetadataSchema,
  })
  .openapi('ProcessCoverSuccess');

/**
 * Process Cover Error Response
 */
export const ProcessCoverErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.string().openapi({
      description: 'Error message',
      example: 'Domain not allowed: example.com',
    }),
    urls: CoverURLsSchema.openapi({
      description: 'Placeholder URLs returned on error',
    }),
  })
  .openapi('ProcessCoverError');

/**
 * Queue Cover Result Schema
 */
export const QueueCoverResultSchema = z
  .object({
    queued: z.number().openapi({
      description: 'Number of covers queued successfully',
      example: 8,
    }),
    failed: z.number().openapi({
      description: 'Number of covers that failed to queue',
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
        description: 'Details of failed items',
        example: [{ isbn: '1234567890', error: 'Invalid ISBN format' }],
      }),
  })
  .openapi('QueueCoverResult');

/**
 * Cover Status Path Parameters
 */
export const CoverStatusParamsSchema = z.object({
  isbn: z.string().openapi({
    description: 'ISBN-10 or ISBN-13',
    example: '9780439064873',
  }),
});

/**
 * Cover Status Response Schema
 */
export const CoverStatusResponseSchema = z
  .object({
    exists: z.boolean().openapi({
      description: 'Whether cover exists in R2 storage',
      example: true,
    }),
    isbn: z.string().openapi({
      description: 'Normalized ISBN',
      example: '9780439064873',
    }),
    format: z.enum(['webp', 'legacy']).optional().openapi({
      description: 'Storage format (webp = jSquash processed, legacy = original)',
      example: 'webp',
    }),
    sizes: z
      .object({
        large: z.number().optional(),
        medium: z.number().optional(),
        small: z.number().optional(),
      })
      .optional()
      .openapi({
        description: 'File sizes in bytes for each available size',
        example: { large: 45678, medium: 23456, small: 12345 },
      }),
    uploaded: z.string().optional().openapi({
      description: 'ISO timestamp when cover was uploaded',
      example: '2026-01-15T12:00:00.000Z',
    }),
    urls: z
      .object({
        large: z.string(),
        medium: z.string(),
        small: z.string(),
      })
      .optional()
      .openapi({
        description: 'URLs to serve each cover size',
        example: {
          large: '/covers/9780439064873/large',
          medium: '/covers/9780439064873/medium',
          small: '/covers/9780439064873/small',
        },
      }),
  })
  .openapi('CoverStatusResponse');

/**
 * Generic Error Response
 */
export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      description: 'Error message',
      example: 'Queue operation failed',
    }),
    message: z.string().optional().openapi({
      description: 'Detailed error message',
      example: 'Unknown error',
    }),
  })
  .openapi('ErrorResponse');
