// =================================================================================
// Type Definitions for Enrichment Services
// =================================================================================

/**
 * Cover image URLs structure
 */
export interface CoverUrls {
  large?: string;
  medium?: string;
  small?: string;
  original?: string;
}

/**
 * Edition enrichment request
 */
export interface EnrichEditionRequest {
  isbn: string;
  alternate_isbns?: string[];
  work_key?: string;
  title?: string;
  subtitle?: string;
  publisher?: string;
  publication_date?: string;
  page_count?: number;
  format?: string;
  language?: string;
  cover_urls?: CoverUrls;
  cover_source?: string;
  openlibrary_edition_id?: string;
  amazon_asins?: string[];
  google_books_volume_ids?: string[];
  goodreads_edition_ids?: string[];
  primary_provider: string;
  confidence?: number;
  work_match_confidence?: number;
  work_match_source?: string;
  subjects?: string[];
  dewey_decimal?: string[];
  binding?: string;
  related_isbns?: Record<string, string>;
}

/**
 * Work enrichment request
 */
export interface EnrichWorkRequest {
  work_key: string;
  title: string;
  subtitle?: string;
  description?: string;
  original_language?: string;
  first_publication_year?: number;
  subject_tags?: string[];
  cover_urls?: CoverUrls;
  cover_source?: string;
  openlibrary_work_id?: string;
  goodreads_work_ids?: string[];
  amazon_asins?: string[];
  google_books_volume_ids?: string[];
  primary_provider: string;
  confidence?: number;
}

/**
 * Author enrichment request
 */
export interface EnrichAuthorRequest {
  author_key: string;
  name: string;
  gender?: string;
  nationality?: string;
  birth_year?: number;
  death_year?: number;
  bio?: string;
  bio_source?: string;
  author_photo_url?: string;
  openlibrary_author_id?: string;
  goodreads_author_ids?: string[];
  wikidata_id?: string;
  primary_provider: string;
}

/**
 * Enrichment response data
 */
export interface EnrichmentData {
  isbn?: string;
  work_key?: string;
  author_key?: string;
  action: 'created' | 'updated';
  quality_improvement?: number;
  stored_at: string;
  cover_urls?: CoverUrls; // NEW: Include cover URLs in response
}

/**
 * Queue enrichment request
 */
export interface QueueEnrichmentRequest {
  entity_type: 'work' | 'edition' | 'author';
  entity_key: string;
  providers_to_try: string[];
  priority?: number | string;
}

/**
 * Queue enrichment response
 */
export interface QueueEnrichmentResponse {
  queue_id: string;
  position_in_queue: number;
  estimated_processing_time: string;
}

/**
 * Enrichment job status
 */
export interface EnrichmentJobStatus {
  id: string;
  entity_type: string;
  entity_key: string;
  status: string;
  providers_attempted?: string[];
  providers_succeeded?: string[];
  retry_count?: number;
  created_at: Date;
  completed_at?: Date;
  error_message?: string;
}

/**
 * Enrichment log entry
 */
export interface EnrichmentLogEntry {
  entity_type: string;
  entity_key: string;
  provider: string;
  operation: string;
  success: boolean;
  fields_updated?: string[];
  error_message?: string;
  response_time_ms?: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * ISBN validation result
 */
export interface ISBNValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Cover queue message
 */
export interface CoverQueueMessage {
  isbn?: string;
  work_key?: string;
  provider_url?: string;
  priority?: string;
  source?: string;
  queued_at?: string;
}

/**
 * Enrichment queue message
 */
export interface EnrichmentQueueMessage {
  isbn: string;
  priority?: string;
  source?: string;
}

/**
 * Cover processing result (from jsquash-processor)
 */
export interface CoverProcessingResult {
  status: 'processed' | 'error';
  isbn: string;
  error?: string;
  metrics: {
    isbn: string;
    initMs: number;
    fetchMs: number;
    decodeMs: number;
    resizeMs: number;
    encodeMs: number;
    uploadMs: number;
    totalMs: number;
    originalSize: number;
    webpSizes?: Record<string, number>;
    dimensions?: Record<string, { width: number; height: number; scaled: boolean }>;
    webpSkipped?: boolean;
  };
  compression?: {
    originalSize: number;
    totalWebpSize: number;
    ratio: string;
    webpSkipped?: boolean;
  };
  urls?: {
    large: string;
    medium: string;
    small: string;
  };
  r2Keys?: string[];
}

/**
 * Cover queue results
 */
export interface CoverQueueResults {
  processed: number;
  cached: number;
  failed: number;
  dbUpdated: number;
  errors: Array<{ isbn: string; error: string }>;
  compressionStats: {
    totalOriginalBytes: number;
    totalWebpBytes: number;
  };
}

/**
 * Enrichment queue results
 */
export interface EnrichmentQueueResults {
  enriched: number;
  cached: number;
  failed: number;
  errors: Array<{ isbn: string; error: string }>;
  api_calls_saved: number;
}

/**
 * Image size dimensions
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Image sizes configuration
 */
export type ImageSizes = Record<'large' | 'medium' | 'small', ImageDimensions>;

/**
 * Download image result
 */
export interface DownloadImageResult {
  buffer: ArrayBuffer;
  contentType: string;
}

/**
 * Cloudflare Queue Message interface
 */
export interface Message<T = unknown> {
  id: string;
  timestamp: Date;
  body: T;
  retry(): void;
  ack(): void;
}

/**
 * Cloudflare MessageBatch interface
 */
export interface MessageBatch<T = unknown> {
  queue: string;
  messages: Message<T>[];
  retryAll(): void;
  ackAll(): void;
}
