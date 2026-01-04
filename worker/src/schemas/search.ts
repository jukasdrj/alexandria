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
  gender: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  birth_year: z.number().nullable().optional(),
  death_year: z.number().nullable().optional(),
  bio: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
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
  binding: z.string().nullable().optional(),
  related_isbns: z.record(z.string(), z.string()).nullable().optional(),
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
// Combined Search Schemas (Auto-Detection)
// =================================================================================

export const CombinedSearchQuerySchema = z.object({
  q: z.string()
    .min(1, 'Query must not be empty')
    .max(200, 'Query too long (max 200 characters)')
    .describe('Search query - automatically detects ISBN, author, or title'),
  nocache: z.string().optional().transform((val) => val === 'true'),
}).merge(PaginationQuerySchema).openapi('CombinedSearchQuery');

export const QueryInfoSchema = z.object({
  original: z.string().describe('Original query string from user'),
  detected_type: z.enum(['isbn', 'author', 'title']).describe('Auto-detected query type'),
  normalized: z.string().describe('Normalized query used for search'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Detection confidence level'),
}).openapi('QueryInfo');

export const SearchMetadataSchema = z.object({
  cache_hit: z.boolean().describe('Whether result was served from cache'),
  response_time_ms: z.number().describe('Total response time in milliseconds'),
  source: z.string().describe('Data source (e.g., "database", "cache")'),
}).openapi('SearchMetadata');

// Combined search data (inner payload)
export const CombinedSearchDataSchema = z.object({
  query: QueryInfoSchema,
  results: z.array(BookResultSchema),
  pagination: PaginationMetadataSchema,
  metadata: SearchMetadataSchema,
}).openapi('CombinedSearchData');

// Combined search success response with envelope
export const CombinedSearchSuccessSchema = createSuccessSchema(
  CombinedSearchDataSchema,
  'CombinedSearchSuccess'
);

// =================================================================================
// Type Exports
// =================================================================================

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type AuthorReference = z.infer<typeof AuthorReferenceSchema>;
export type BookResult = z.infer<typeof BookResultSchema>;
export type PaginationMetadata = z.infer<typeof PaginationMetadataSchema>;
export type SearchData = z.infer<typeof SearchDataSchema>;

// Combined search types
export type CombinedSearchQuery = z.infer<typeof CombinedSearchQuerySchema>;
export type QueryInfo = z.infer<typeof QueryInfoSchema>;
export type SearchMetadata = z.infer<typeof SearchMetadataSchema>;
export type CombinedSearchData = z.infer<typeof CombinedSearchDataSchema>;
