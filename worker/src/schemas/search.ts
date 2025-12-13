import { z } from 'zod';
import { PaginationQuerySchema } from './common.js';
import { createSuccessSchema, ErrorResponseSchema } from './response.js';

// =================================================================================
// Search Query Schemas
// =================================================================================

export const SearchQuerySchema = z.object({
  isbn: z.string()
    .transform((val) => {
      if (!val) return undefined;
      const clean = val.replace(/[^0-9X]/gi, '').toUpperCase();
      if (clean.length !== 10 && clean.length !== 13) {
        throw new Error("Invalid ISBN format. Must be 10 or 13 characters (digits and 'X' for ISBN-10 check digit)");
      }
      return val;
    })
    .optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  nocache: z.string().optional().transform((val) => val === 'true'),
}).merge(PaginationQuerySchema).openapi('SearchQuery');

// =================================================================================
// Search Response Schemas
// =================================================================================

export const AuthorReferenceSchema = z.object({
  name: z.string(),
  key: z.string().describe('e.g., "/authors/OL7234434A"'),
  openlibrary: z.string().nullable().describe('e.g., "https://openlibrary.org/authors/OL7234434A"'),
}).openapi('AuthorReference');

export const BookResultSchema = z.object({
  title: z.string(),
  authors: z.array(AuthorReferenceSchema),
  isbn: z.string().nullable(),
  coverUrl: z.string().nullable(),
  coverSource: z.enum(['r2', 'external', 'external-fallback', 'enriched-cached']).nullable(),
  publish_date: z.string().nullable(),
  publishers: z.string().nullable().describe('Publisher name as string'),
  pages: z.number().nullable().describe('Page count as number'),
  work_title: z.string().nullable(),
  openlibrary_edition: z.string().nullable(),
  openlibrary_work: z.string().nullable(),
}).openapi('BookResult');

export const PaginationMetadataSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
  hasMore: z.boolean(),
  returnedCount: z.number(),
  totalEstimated: z.boolean().optional().describe('For author queries using estimated totals'),
}).openapi('PaginationMetadata');

// Search data (inner payload)
export const SearchDataSchema = z.object({
  query: z.object({
    isbn: z.string().optional(),
    title: z.string().optional(),
    author: z.string().optional(),
  }),
  results: z.array(BookResultSchema),
  pagination: PaginationMetadataSchema,
  cache_hit: z.boolean().optional(),
  cache_age_seconds: z.number().optional(),
}).openapi('SearchData');

// Success response with envelope
export const SearchSuccessSchema = createSuccessSchema(SearchDataSchema, 'SearchSuccess');

// Re-export ErrorResponseSchema for convenience
export { ErrorResponseSchema as SearchErrorSchema };

// =================================================================================
// Type Exports
// =================================================================================

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type AuthorReference = z.infer<typeof AuthorReferenceSchema>;
export type BookResult = z.infer<typeof BookResultSchema>;
export type PaginationMetadata = z.infer<typeof PaginationMetadataSchema>;
export type SearchData = z.infer<typeof SearchDataSchema>;
