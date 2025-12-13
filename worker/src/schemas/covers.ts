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
 */
export const ProcessCoverSchema = z
  .object({
    work_key: z.string().openapi({
      description: 'OpenLibrary work key',
      example: '/works/OL45804W',
    }),
    provider_url: z.string().url().openapi({
      description: 'Provider cover image URL',
      example: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
    }),
    isbn: z.string().optional().openapi({
      description: 'ISBN-10 or ISBN-13 (optional, for logging)',
      example: '9780439064873',
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
 */
const CoverURLsSchema = z.object({
  large: z.string().url().openapi({
    description: 'Large cover URL (512x768)',
    example: 'https://alexandria.ooheynerds.com/api/covers/OL45804W/large',
  }),
  medium: z.string().url().openapi({
    description: 'Medium cover URL (256x384)',
    example: 'https://alexandria.ooheynerds.com/api/covers/OL45804W/medium',
  }),
  small: z.string().url().openapi({
    description: 'Small cover URL (128x192)',
    example: 'https://alexandria.ooheynerds.com/api/covers/OL45804W/small',
  }),
});

/**
 * Cover Metadata Schema
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
    description: 'R2 storage key',
    example: 'covers/OL45804W/abc123def456',
  }),
  sourceUrl: z.string().url().openapi({
    description: 'Original provider URL',
    example: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
  }),
  workKey: z.string().openapi({
    description: 'OpenLibrary work key',
    example: '/works/OL45804W',
  }),
});

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
