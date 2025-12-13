import { z } from 'zod';

// =================================================================================
// Authors Query Schemas
// =================================================================================

export const TopAuthorsQuerySchema = z.object({
  offset: z.string().optional().transform((val) => parseInt(val || '0', 10)),
  limit: z.string().optional().transform((val) => {
    const parsed = parseInt(val || '100', 10);
    return Math.min(parsed, 1000); // Max 1000
  }),
  nocache: z.string().optional().transform((val) => val === 'true'),
}).openapi('TopAuthorsQuery');

export const AuthorKeyParamSchema = z.object({
  key: z.string().describe('Author key (e.g., "OL7234434A" or "/authors/OL7234434A")'),
}).openapi('AuthorKeyParam');

export const BibliographyRequestSchema = z.object({
  author_name: z.string().min(1).describe('Author name to search for in ISBNdb'),
  max_pages: z.number().int().min(1).max(100).default(10).optional()
    .describe('Maximum pages to fetch from ISBNdb (default: 10, max: 100)'),
}).openapi('BibliographyRequest');

export const EnrichBibliographyRequestSchema = z.object({
  author_name: z.string().min(1).describe('Author name to search for in ISBNdb'),
  max_pages: z.number().int().min(1).max(100).default(10).optional()
    .describe('Maximum pages to fetch from ISBNdb (default: 10, max: 100)'),
  skip_existing: z.boolean().default(true).optional()
    .describe('Skip ISBNs already in database (default: true)'),
}).openapi('EnrichBibliographyRequest');

export const EnrichWikidataRequestSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100).optional()
    .describe('Number of authors to enrich (default: 100, max: 500)'),
  force_refresh: z.boolean().default(false).optional()
    .describe('Re-enrich authors that were already enriched (default: false)'),
}).openapi('EnrichWikidataRequest');

// =================================================================================
// Authors Response Schemas
// =================================================================================

export const TopAuthorSchema = z.object({
  author_key: z.string().describe('e.g., "/authors/OL7234434A"'),
  author_name: z.string(),
  work_count: z.number().int().describe('Number of works by this author'),
}).openapi('TopAuthor');

export const TopAuthorsResponseSchema = z.object({
  authors: z.array(TopAuthorSchema),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    returned: z.number(),
  }),
  cached: z.boolean(),
  query_duration_ms: z.number(),
}).openapi('TopAuthorsResponse');

export const AuthorDetailsSchema = z.object({
  author_key: z.string(),
  name: z.string(),
  gender: z.string().nullable(),
  gender_qid: z.string().nullable(),
  nationality: z.string().nullable(),
  citizenship_qid: z.string().nullable(),
  birth_year: z.number().nullable(),
  death_year: z.number().nullable(),
  birth_place: z.string().nullable(),
  birth_place_qid: z.string().nullable(),
  birth_country: z.string().nullable(),
  birth_country_qid: z.string().nullable(),
  death_place: z.string().nullable(),
  death_place_qid: z.string().nullable(),
  bio: z.string().nullable(),
  bio_source: z.string().nullable(),
  wikidata_id: z.string().nullable(),
  openlibrary_author_id: z.string().nullable(),
  goodreads_author_ids: z.array(z.string()).nullable(),
  author_photo_url: z.string().nullable(),
  book_count: z.number().int(),
  wikidata_enriched_at: z.string().nullable(),
  query_duration_ms: z.number(),
}).openapi('AuthorDetails');

export const BibliographyBookSchema = z.object({
  isbn: z.string(),
  title: z.string(),
  author: z.string(),
  publisher: z.string().optional(),
  date_published: z.string().optional(),
}).openapi('BibliographyBook');

export const BibliographyResponseSchema = z.object({
  author: z.string(),
  books_found: z.number().int(),
  pages_fetched: z.number().int(),
  books: z.array(BibliographyBookSchema),
}).openapi('BibliographyResponse');

export const EnrichBibliographyResponseSchema = z.object({
  author: z.string(),
  books_found: z.number().int(),
  already_existed: z.number().int(),
  enriched: z.number().int(),
  covers_queued: z.number().int(),
  failed: z.number().int(),
  pages_fetched: z.number().int(),
  api_calls: z.number().int().describe('Number of ISBNdb API calls made'),
  errors: z.array(z.object({
    isbn: z.string(),
    error: z.string(),
  })),
  duration_ms: z.number(),
  cached: z.boolean().optional(),
}).openapi('EnrichBibliographyResponse');

export const EnrichWikidataResultSchema = z.object({
  author_key: z.string(),
  wikidata_id: z.string(),
  fields_updated: z.array(z.string()),
  error: z.string().optional(),
}).openapi('EnrichWikidataResult');

export const EnrichWikidataResponseSchema = z.object({
  processed: z.number().int(),
  enriched: z.number().int(),
  wikidata_fetched: z.number().int(),
  results: z.array(EnrichWikidataResultSchema),
}).openapi('EnrichWikidataResponse');

export const EnrichStatusResponseSchema = z.object({
  total_authors: z.number().int(),
  has_wikidata_id: z.number().int(),
  wikidata_enriched: z.number().int(),
  pending_enrichment: z.number().int(),
  diversity_fields: z.object({
    has_gender: z.number().int(),
    has_nationality: z.number().int(),
    has_birth_place: z.number().int(),
  }),
}).openapi('EnrichStatusResponse');

export const AuthorErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  author_key: z.string().optional(),
  partial_results: z.object({}).passthrough().optional(),
}).openapi('AuthorError');

// =================================================================================
// Type Exports
// =================================================================================

export type TopAuthorsQuery = z.infer<typeof TopAuthorsQuerySchema>;
export type AuthorKeyParam = z.infer<typeof AuthorKeyParamSchema>;
export type BibliographyRequest = z.infer<typeof BibliographyRequestSchema>;
export type EnrichBibliographyRequest = z.infer<typeof EnrichBibliographyRequestSchema>;
export type EnrichWikidataRequest = z.infer<typeof EnrichWikidataRequestSchema>;
export type TopAuthor = z.infer<typeof TopAuthorSchema>;
export type TopAuthorsResponse = z.infer<typeof TopAuthorsResponseSchema>;
export type AuthorDetails = z.infer<typeof AuthorDetailsSchema>;
export type BibliographyBook = z.infer<typeof BibliographyBookSchema>;
export type BibliographyResponse = z.infer<typeof BibliographyResponseSchema>;
export type EnrichBibliographyResponse = z.infer<typeof EnrichBibliographyResponseSchema>;
export type EnrichWikidataResult = z.infer<typeof EnrichWikidataResultSchema>;
export type EnrichWikidataResponse = z.infer<typeof EnrichWikidataResponseSchema>;
export type EnrichStatusResponse = z.infer<typeof EnrichStatusResponseSchema>;
export type AuthorError = z.infer<typeof AuthorErrorSchema>;
