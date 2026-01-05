/**
 * Alexandria API Type Exports
 *
 * These types can be imported by other services (e.g., bendv3) for type-safe
 * integration with the Alexandria API.
 *
 * @example
 * ```typescript
 * import type { SearchQuery, SearchResult, BookResult } from '@ooheynerds/alexandria-worker';
 * ```
 */

import { z } from 'zod';

// =================================================================================
// Request Schemas (Zod)
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
  limit: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 10;
    return Math.max(1, Math.min(100, parsed));
  }),
  offset: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 0;
    return Math.max(0, parsed);
  }),
});

export const CombinedSearchQuerySchema = z.object({
  q: z.string().min(1, 'Query parameter "q" is required'),
  limit: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 10;
    return Math.max(1, Math.min(100, parsed));
  }),
  offset: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 0;
    return Math.max(0, parsed);
  }),
});

export const CoverBatchSchema = z.object({
  isbns: z.array(z.string()).min(1).max(10),
});

export const ProcessCoverSchema = z.object({
  work_key: z.string(),
  provider_url: z.string().url(),
  isbn: z.string().optional(),
});

export const EnrichEditionSchema = z.object({
  isbn: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  publisher: z.string().optional(),
  publication_date: z.string().optional(),
  page_count: z.number().optional(),
  format: z.string().optional(),
  language: z.string().optional(),
  primary_provider: z.enum(['isbndb', 'google-books', 'openlibrary', 'user-correction']),
  cover_urls: z.object({
    large: z.string().optional(),
    medium: z.string().optional(),
    small: z.string().optional(),
  }).optional(),
  cover_source: z.string().optional(),
  work_key: z.string().optional(),
  openlibrary_edition_id: z.string().optional(),
  amazon_asins: z.array(z.string()).optional(),
  google_books_volume_ids: z.array(z.string()).optional(),
  goodreads_edition_ids: z.array(z.string()).optional(),
  alternate_isbns: z.array(z.string()).optional(),
});

export const EnrichWorkSchema = z.object({
  work_key: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  original_language: z.string().optional(),
  first_publication_year: z.number().optional(),
  subject_tags: z.array(z.string()).optional(),
  primary_provider: z.enum(['isbndb', 'google-books', 'openlibrary']),
  cover_urls: z.object({
    large: z.string().optional(),
    medium: z.string().optional(),
    small: z.string().optional(),
  }).optional(),
  cover_source: z.string().optional(),
  openlibrary_work_id: z.string().optional(),
  goodreads_work_ids: z.array(z.string()).optional(),
  amazon_asins: z.array(z.string()).optional(),
  google_books_volume_ids: z.array(z.string()).optional(),
});

export const EnrichAuthorSchema = z.object({
  author_key: z.string(),
  name: z.string(),
  gender: z.string().optional(),
  gender_qid: z.string().optional(),           // Wikidata Q-ID for gender (e.g., Q6581097 = male)
  nationality: z.string().optional(),
  citizenship_qid: z.string().optional(),      // Wikidata Q-ID for citizenship
  birth_year: z.number().optional(),
  death_year: z.number().optional(),
  birth_place: z.string().optional(),          // City/town name
  birth_place_qid: z.string().optional(),      // Wikidata Q-ID for birth place
  birth_country: z.string().optional(),        // Country name (e.g., "United States")
  birth_country_qid: z.string().optional(),    // Wikidata Q-ID for country (e.g., Q30)
  death_place: z.string().optional(),
  death_place_qid: z.string().optional(),
  bio: z.string().optional(),
  bio_source: z.string().optional(),
  author_photo_url: z.string().optional(),
  primary_provider: z.enum(['isbndb', 'openlibrary', 'wikidata']),
  openlibrary_author_id: z.string().optional(),
  goodreads_author_ids: z.array(z.string()).optional(),
  wikidata_id: z.string().optional(),
});

export const QueueEnrichmentSchema = z.object({
  entity_type: z.enum(['work', 'edition', 'author']),
  entity_key: z.string(),
  providers_to_try: z.array(z.string()),
  priority: z.number().min(1).max(10).default(5),
});

// =================================================================================
// Inferred TypeScript Types from Zod Schemas
// =================================================================================

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type CombinedSearchQuery = z.infer<typeof CombinedSearchQuerySchema>;
export type CoverBatch = z.infer<typeof CoverBatchSchema>;
export type ProcessCover = z.infer<typeof ProcessCoverSchema>;
export type EnrichEdition = z.infer<typeof EnrichEditionSchema>;
export type EnrichWork = z.infer<typeof EnrichWorkSchema>;
export type EnrichAuthor = z.infer<typeof EnrichAuthorSchema>;
export type QueueEnrichment = z.infer<typeof QueueEnrichmentSchema>;

// =================================================================================
// Response Types
// =================================================================================

/**
 * Author reference in search results (enriched with metadata from enriched_authors table)
 * @since 2.2.3 - Added enriched author metadata fields
 */
export interface AuthorReference {
  name: string;
  key: string;                    // e.g., "/authors/OL7234434A"
  openlibrary: string;            // e.g., "https://openlibrary.org/authors/OL7234434A"

  // Enriched metadata (from enriched_authors table)
  bio?: string | null;            // Author biography
  gender?: string | null;         // e.g., "male", "female", "Unknown"
  nationality?: string | null;    // e.g., "United States", "British"
  birth_year?: number | null;     // Birth year
  death_year?: number | null;     // Death year
  wikidata_id?: string | null;    // Wikidata identifier (e.g., "Q35064")
  image?: string | null;          // Author photo URL (from author_photo_url column)
}

export interface BookResult {
  type?: 'edition' | 'work' | 'author';  // Present in combined search
  title: string;
  authors: AuthorReference[];     // Array of author objects with name, key, openlibrary URL
  isbn: string | null;

  // Cover images (dual format for backward compatibility)
  coverUrl: string | null;        // Legacy: Single cover URL (typically large)
  coverUrls?: {                   // Modern: Multiple sizes via /covers/:isbn/:size endpoint
    large: string;
    medium: string;
    small: string;
  } | null;
  coverSource: 'r2' | 'external' | 'external-fallback' | 'enriched-cached' | null;

  publish_date: string | null;
  publishers: string | null;      // Publisher name as string
  pages: number | null;           // Page count as number
  work_title: string | null;
  openlibrary_edition: string | null;
  openlibrary_work: string | null;
}

export interface PaginationMetadata {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  returnedCount: number;
  totalEstimated?: boolean;  // For combined text searches
}

export interface SearchResult {
  query: {
    isbn?: string;
    title?: string;
    author?: string;
  };
  query_duration_ms: number;
  count?: number;  // Deprecated - use pagination.total
  results: BookResult[];
  pagination: PaginationMetadata;
  cache_hit?: boolean;  // Whether result was served from cache
}

export interface CombinedSearchResult {
  query: string;
  search_type: 'isbn' | 'text';
  query_duration_ms: number;
  results: BookResult[];
  pagination: PaginationMetadata;
  cache_hit?: boolean;  // Whether result was served from cache
}

export interface HealthCheck {
  status: 'ok' | 'error';
  database: 'connected' | 'disconnected';
  r2_covers: 'bound' | 'not_configured';
  hyperdrive_latency_ms?: number;
  timestamp: string;
  message?: string;
}

export interface DatabaseStats {
  editions: number;
  isbns: number;
  works: number;
  authors: number;
  query_duration_ms: number;
}

export interface CoverMetadata {
  format: string;
  size: number;
  uploaded: string;
  provider?: string;
  isbn?: string;
}

export interface CoverStatus {
  exists: boolean;
  isbn: string;
  format?: string;
  size?: number;
  uploaded?: string;
  provider?: string;
  urls?: {
    original: string;
    large: string;
    medium: string;
    small: string;
  };
}

export interface CoverProcessResult {
  status: 'processed' | 'already_exists' | 'no_cover' | 'error';
  isbn: string;
  provider?: string;
  metadata?: CoverMetadata;
  message?: string;
  error?: string;
}

export interface BatchCoverResult {
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    isbn: string;
    status: 'success' | 'error';
    message?: string;
  }>;
}

export interface EnrichmentResult {
  status: 'created' | 'updated';
  entity_type: 'edition' | 'work' | 'author';
  entity_key: string;
  message?: string;
}

export interface EnrichmentQueueResult {
  status: 'queued';
  job_id: string;
  entity_type: 'work' | 'edition' | 'author';
  entity_key: string;
  priority: number;
  message: string;
}

export interface EnrichmentJobStatus {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  entity_type: 'work' | 'edition' | 'author';
  entity_key: string;
  created_at: string;
  updated_at: string;
  result?: unknown;
  error?: string;
}

export interface ErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
}

/**
 * Full author details including Wikidata diversity data
 * Returned by GET /api/authors/:key
 */
export interface AuthorDetails {
  author_key: string;             // e.g., "/authors/OL7234434A"
  name: string;

  // Diversity fields (from Wikidata)
  gender: string | null;          // e.g., "male", "female"
  gender_qid: string | null;      // e.g., "Q6581097" (male)
  nationality: string | null;     // e.g., "United States"
  citizenship_qid: string | null; // e.g., "Q30"

  // Birth/Death
  birth_year: number | null;
  death_year: number | null;
  birth_place: string | null;     // City/town name
  birth_place_qid: string | null;
  birth_country: string | null;   // Country name
  birth_country_qid: string | null;
  death_place: string | null;
  death_place_qid: string | null;

  // Biography
  bio: string | null;
  bio_source: string | null;

  // External IDs
  wikidata_id: string | null;     // e.g., "Q18590295"
  openlibrary_author_id: string | null;
  goodreads_author_ids: string[] | null;

  // Metadata
  author_photo_url: string | null;
  book_count: number;
  wikidata_enriched_at: string | null;  // ISO timestamp
}

// =================================================================================
// API Client Types (for consumers like bendv3)
// =================================================================================

/**
 * Alexandria API client configuration
 */
export interface AlexandriaClientConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * Type-safe API endpoint paths
 */
export const ENDPOINTS = {
  HEALTH: '/health',
  STATS: '/api/stats',
  SEARCH: '/api/search',
  SEARCH_COMBINED: '/api/search/combined',
  AUTHOR_DETAILS: '/api/authors/:key',      // Author diversity data
  ENRICH_EDITION: '/api/enrich/edition',
  ENRICH_WORK: '/api/enrich/work',
  ENRICH_AUTHOR: '/api/enrich/author',
  ENRICH_QUEUE: '/api/enrich/queue',
  ENRICH_STATUS: '/api/enrich/status',
  COVER_PROCESS: '/api/covers/process',
  COVER_SERVE: '/api/covers',
  COVER_ISBN_STATUS: '/covers/:isbn/status',
  COVER_ISBN_PROCESS: '/covers/:isbn/process',
  COVER_ISBN_SERVE: '/covers/:isbn/:size',
  COVER_BATCH: '/covers/batch',
} as const;

/**
 * HTTP methods used by Alexandria API
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * API route definitions with types
 */
export interface APIRoute<TRequest = unknown, TResponse = unknown> {
  method: HTTPMethod;
  path: string;
  requestSchema?: z.ZodSchema<TRequest>;
  responseType?: TResponse;
}

/**
 * Complete API surface area for type-safe integration
 */
export const API_ROUTES = {
  search: {
    method: 'GET',
    path: ENDPOINTS.SEARCH,
    requestSchema: SearchQuerySchema,
  } as APIRoute<SearchQuery, SearchResult>,

  searchCombined: {
    method: 'GET',
    path: ENDPOINTS.SEARCH_COMBINED,
    requestSchema: CombinedSearchQuerySchema,
  } as APIRoute<CombinedSearchQuery, CombinedSearchResult>,

  authorDetails: {
    method: 'GET',
    path: ENDPOINTS.AUTHOR_DETAILS,
  } as APIRoute<{ key: string }, AuthorDetails>,

  health: {
    method: 'GET',
    path: ENDPOINTS.HEALTH,
  } as APIRoute<void, HealthCheck>,

  stats: {
    method: 'GET',
    path: ENDPOINTS.STATS,
  } as APIRoute<void, DatabaseStats>,

  enrichEdition: {
    method: 'POST',
    path: ENDPOINTS.ENRICH_EDITION,
    requestSchema: EnrichEditionSchema,
  } as APIRoute<EnrichEdition, EnrichmentResult>,

  enrichWork: {
    method: 'POST',
    path: ENDPOINTS.ENRICH_WORK,
    requestSchema: EnrichWorkSchema,
  } as APIRoute<EnrichWork, EnrichmentResult>,

  enrichAuthor: {
    method: 'POST',
    path: ENDPOINTS.ENRICH_AUTHOR,
    requestSchema: EnrichAuthorSchema,
  } as APIRoute<EnrichAuthor, EnrichmentResult>,

  queueEnrichment: {
    method: 'POST',
    path: ENDPOINTS.ENRICH_QUEUE,
    requestSchema: QueueEnrichmentSchema,
  } as APIRoute<QueueEnrichment, EnrichmentQueueResult>,

  processCover: {
    method: 'POST',
    path: ENDPOINTS.COVER_PROCESS,
    requestSchema: ProcessCoverSchema,
  } as APIRoute<ProcessCover, CoverProcessResult>,

  batchCovers: {
    method: 'POST',
    path: ENDPOINTS.COVER_BATCH,
    requestSchema: CoverBatchSchema,
  } as APIRoute<CoverBatch, BatchCoverResult>,
} as const;

// =================================================================================
// Re-export Zod for consumers who want to use schemas directly
// =================================================================================

export { z };
