import { z } from 'zod';
import { createSuccessSchema, ErrorResponseSchema } from './response.js';
import { AuthorReferenceSchema } from './search.js';

// =================================================================================
// Recommendation Request Schemas
// =================================================================================

/**
 * Schema for fetching subjects for multiple books
 * Accepts comma-separated ISBNs or work_keys
 */
export const SubjectsQuerySchema = z.object({
  ids: z.string()
    .min(1, 'At least one ID required')
    .transform((val) => val.split(',').map(id => id.trim()).filter(Boolean))
    .describe('Comma-separated ISBNs or work_keys (e.g., "9780439064873,/works/OL82563W")'),
  limit: z.string()
    .optional()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(10))
    .describe('Max results per ID (default: 1)'),
  nocache: z.string()
    .optional()
    .transform((val) => val === 'true')
    .describe('Bypass cache (default: false)'),
}).openapi('SubjectsQuery');

/**
 * Schema for finding similar books by subjects
 */
export const SimilarBooksQuerySchema = z.object({
  subjects: z.string()
    .min(1, 'At least one subject required')
    .transform((val) => val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    .describe('Comma-separated subject tags (e.g., "fantasy,magic,wizards")'),
  exclude: z.string()
    .optional()
    .transform((val) => val ? val.split(',').map(id => id.trim()).filter(Boolean) : [])
    .describe('Work keys to exclude (e.g., "/works/OL82563W,/works/OL123W")'),
  limit: z.string()
    .optional()
    .default('100')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(500))
    .describe('Max results (default: 100, max: 500)'),
  min_overlap: z.string()
    .optional()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1))
    .describe('Minimum subject overlap required (default: 1)'),
  nocache: z.string()
    .optional()
    .transform((val) => val === 'true')
    .describe('Bypass cache (default: false)'),
}).openapi('SimilarBooksQuery');

// =================================================================================
// Recommendation Response Schemas
// =================================================================================

/**
 * Single book subjects result
 */
export const BookSubjectsSchema = z.object({
  id: z.string().describe('Original ID from request'),
  type: z.enum(['isbn', 'work']).describe('Detected identifier type'),
  work_key: z.string().nullable().describe('OpenLibrary work key (e.g., "/works/OL82563W")'),
  title: z.string().nullable().describe('Book title'),
  subjects: z.array(z.string()).describe('Array of normalized subject tags'),
  match_source: z.enum(['enriched_works', 'works_fallback', 'not_found']).describe('Data source'),
}).openapi('BookSubjects');

/**
 * Response data for subjects endpoint
 */
export const SubjectsDataSchema = z.object({
  results: z.array(BookSubjectsSchema),
  total: z.number().int().describe('Number of IDs with subject data'),
  missing: z.array(z.string()).describe('IDs without subject data'),
  query: z.object({
    ids_count: z.number().int(),
    limit: z.number().int(),
  }),
}).openapi('SubjectsData');

/**
 * Similar book result (full metadata)
 */
export const SimilarBookSchema = z.object({
  work_key: z.string().describe('OpenLibrary work key'),
  title: z.string().describe('Book title'),
  isbn: z.string().nullable().describe('Primary ISBN for this work'),
  subjects: z.array(z.string()).describe('Array of normalized subject tags'),
  subject_match_count: z.number().int().describe('Number of matching subjects'),
  authors: z.array(AuthorReferenceSchema).describe('Book authors'),
  publish_date: z.string().nullable().describe('Publication date'),
  publishers: z.string().nullable().describe('Publisher name'),
  pages: z.number().int().nullable().describe('Page count'),
  cover_url: z.string().nullable().describe('Cover image URL'),
  cover_source: z.enum(['r2', 'external', 'external-fallback', 'enriched-cached']).nullable(),
  openlibrary_work: z.string().describe('OpenLibrary work URL'),
  openlibrary_edition: z.string().nullable().describe('OpenLibrary edition URL'),
}).openapi('SimilarBook');

/**
 * Response data for similar books endpoint
 */
export const SimilarBooksDataSchema = z.object({
  results: z.array(SimilarBookSchema),
  total: z.number().int().describe('Total matching works'),
  query: z.object({
    subjects: z.array(z.string()).describe('Normalized subjects from request'),
    excluded_count: z.number().int().describe('Number of excluded works'),
    min_overlap: z.number().int(),
  }),
}).openapi('SimilarBooksData');

// =================================================================================
// Success Response Schemas
// =================================================================================

export const SubjectsSuccessSchema = createSuccessSchema(SubjectsDataSchema, 'SubjectsSuccess');
export const SimilarBooksSuccessSchema = createSuccessSchema(SimilarBooksDataSchema, 'SimilarBooksSuccess');

// Re-export error schema for convenience
export { ErrorResponseSchema as RecommendationsErrorSchema };

// =================================================================================
// Type Exports
// =================================================================================

export type SubjectsQuery = z.infer<typeof SubjectsQuerySchema>;
export type SimilarBooksQuery = z.infer<typeof SimilarBooksQuerySchema>;
export type BookSubjects = z.infer<typeof BookSubjectsSchema>;
export type SubjectsData = z.infer<typeof SubjectsDataSchema>;
export type SimilarBook = z.infer<typeof SimilarBookSchema>;
export type SimilarBooksData = z.infer<typeof SimilarBooksDataSchema>;
