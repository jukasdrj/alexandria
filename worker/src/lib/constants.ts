/**
 * Alexandria Constants
 *
 * Centralized constants for magic numbers throughout the codebase.
 * These values are tuned for production performance and should only be changed
 * after careful testing and benchmarking.
 *
 * @module lib/constants
 */

// =================================================================================
// ISBNdb API Quota Management
// =================================================================================

/**
 * ISBNdb Premium daily quota limit (calls per day)
 *
 * ISBNdb Premium plan provides 15,000 API calls per day.
 * Resets daily at midnight UTC. Does NOT roll over unused calls.
 *
 * Note: Each API call can batch up to 1000 ISBNs, so effective capacity
 * is 15M ISBNs per day if using batch endpoints.
 */
export const ISBNDB_DAILY_QUOTA = 15000 as const;

/**
 * ISBNdb quota safety buffer (reserved calls)
 *
 * Keep 2000 calls in reserve for:
 * - Manual operations and debugging
 * - Emergency fixes and data corrections
 * - User-initiated enrichment requests
 * - Cover fetch operations that fall back to ISBNdb
 *
 * Effective daily limit: 13,000 calls (15,000 - 2,000 buffer)
 */
export const ISBNDB_QUOTA_BUFFER = 2000 as const;

/**
 * Bulk operation size limit (API calls per operation)
 *
 * Maximum API calls allowed in a single bulk operation.
 * Prevents runaway operations from exhausting daily quota.
 */
export const BULK_OPERATION_MAX_CALLS = 100 as const;

/**
 * Cron operation quota multiplier
 *
 * Cron jobs require 2x buffer remaining before proceeding.
 * This ensures manual operations always have available quota.
 *
 * Example: Cron needs 50 calls → requires 100 calls buffer remaining
 */
export const CRON_QUOTA_MULTIPLIER = 2 as const;

// =================================================================================
// String Similarity & Matching Thresholds
// =================================================================================

/**
 * Fuzzy title similarity threshold for deduplication
 *
 * Threshold: 60% similarity (0.6)
 *
 * Used by deduplication service to detect existing books via title matching.
 * Lower threshold = more duplicates caught, but higher false positive rate.
 * Higher threshold = fewer false positives, but more duplicates missed.
 *
 * Rationale: 60% allows for subtitle variations, edition differences, and
 * formatting changes while preventing unrelated books from matching.
 *
 * @see worker/src/services/deduplication.ts
 */
export const FUZZY_TITLE_SIMILARITY_THRESHOLD = 0.6 as const;

/**
 * ISBN resolution validation threshold
 *
 * Threshold: 70% similarity (0.7)
 *
 * Used by ISBN resolvers to validate that fetched metadata matches the
 * original query. Both title AND author must meet this threshold.
 *
 * Higher than deduplication threshold because we're validating a specific
 * match, not searching for potential duplicates.
 *
 * @see worker/src/services/book-resolution/interfaces.ts
 */
export const ISBN_RESOLUTION_SIMILARITY_THRESHOLD = 0.7 as const;

// =================================================================================
// Query Detection Patterns
// =================================================================================

/**
 * Author name pattern: minimum length
 *
 * Minimum characters for a valid author name query.
 * Filters out single-word queries that are likely titles.
 *
 * Examples:
 * - "King" (4 chars) → Rejected (too short, could be title)
 * - "J. K. Rowling" (13 chars) → Accepted
 */
export const AUTHOR_NAME_MIN_LENGTH = 5 as const;

/**
 * Author name pattern: maximum length
 *
 * Maximum characters for a valid author name query.
 * Filters out long phrases that are likely titles or descriptions.
 *
 * Rationale: Real author names rarely exceed 50 characters.
 * "Gabriel García Márquez" is 23 chars, even with multiple names.
 */
export const AUTHOR_NAME_MAX_LENGTH = 50 as const;

/**
 * Author name pattern: minimum word count
 *
 * Minimum words in a valid author name.
 * Filters out single-word queries (likely titles or genres).
 *
 * Examples:
 * - "Tolkien" (1 word) → Rejected
 * - "J. K. Rowling" (3 words) → Accepted
 * - "Stephen King" (2 words) → Accepted
 */
export const AUTHOR_NAME_MIN_WORDS = 2 as const;

/**
 * Author name pattern: maximum word count
 *
 * Maximum words in a valid author name.
 * Filters out long phrases that are likely book titles.
 *
 * Rationale: Most author names are 2-3 words. Even hyphenated or
 * multi-part names rarely exceed 4 words.
 */
export const AUTHOR_NAME_MAX_WORDS = 4 as const;

/**
 * Author name pattern: maximum book-like words
 *
 * Maximum count of common book title words (of, and, in, for, with).
 * More than 1 such word indicates likely a title, not an author name.
 *
 * Examples:
 * - "Lord of the Rings" → 1 book word ("of") → Rejected
 * - "J. R. R. Tolkien" → 0 book words → Accepted
 */
export const AUTHOR_NAME_MAX_BOOK_WORDS = 1 as const;

// =================================================================================
// Cache TTLs (Time To Live in seconds)
// =================================================================================

/**
 * ISBN search cache TTL: 24 hours
 *
 * ISBNs are immutable identifiers. Edition data rarely changes.
 * Long cache lifetime reduces database load and improves response time.
 */
export const CACHE_TTL_ISBN = 86400 as const; // 24 hours

/**
 * Author search cache TTL: 1 hour
 *
 * Author data relatively stable but new works added occasionally.
 * Moderate cache lifetime balances freshness with performance.
 */
export const CACHE_TTL_AUTHOR = 3600 as const; // 1 hour

/**
 * Title search cache TTL: 1 hour
 *
 * Title searches may include new books from ongoing enrichment.
 * Moderate cache lifetime ensures recent additions appear in search.
 */
export const CACHE_TTL_TITLE = 3600 as const; // 1 hour

// =================================================================================
// Quality Scoring Weights
// =================================================================================

/**
 * Quality score: maximum value
 *
 * All quality scores capped at 100.
 * Scores represent percentage completeness and data confidence.
 */
export const QUALITY_SCORE_MAX = 100 as const;

/**
 * Provider quality scores (out of 40 points)
 *
 * Different providers have different data quality and reliability.
 * These scores reflect observed accuracy and completeness.
 */
export const PROVIDER_QUALITY_SCORES = {
	/** User corrections are highest quality - verified by humans */
	'user-correction': 50,
	/** ISBNdb Premium - highest quality automated provider */
	'isbndb': 40,
	/** Google Books - good quality, comprehensive coverage */
	'google-books': 30,
	/** OpenLibrary - community data, moderate quality */
	'openlibrary': 20,
} as const;

/**
 * Edition field quality weights (out of 60 points total)
 *
 * Different fields have different importance for edition quality.
 * Total of all weights should not exceed 60 (allows room for provider score).
 */
export const EDITION_FIELD_WEIGHTS = {
	/** Title is most critical field */
	title: 10,
	/** Cover images significantly improve user experience */
	cover_large: 10,
	/** Publisher information important for book identification */
	publisher: 5,
	/** Publication date helps with edition identification */
	publication_date: 5,
	/** Page count useful for physical book identification */
	page_count: 5,
	/** Language important for international catalog */
	language: 5,
	/** Format distinguishes paperback/hardcover/ebook */
	format: 5,
	/** Medium-size covers for list views */
	cover_medium: 3,
	/** Small covers for compact displays */
	cover_small: 2,
} as const;

/**
 * Work field quality weights (out of 60 points total)
 *
 * Works are more abstract than editions, different fields matter.
 */
export const WORK_FIELD_WEIGHTS = {
	/** Title is most critical */
	title: 10,
	/** Long description significantly improves work quality */
	description_long: 15, // >200 chars
	/** Any description is valuable */
	description: 15, // >50 chars
	/** Cover images important for visual identification */
	cover_large: 10,
	/** Subject tags enable discovery and categorization */
	subject_tags: 10,
	/** Original language for translation tracking */
	original_language: 5,
	/** First publication year for chronological browsing */
	first_publication_year: 5,
} as const;

/**
 * Description quality threshold: long description
 *
 * Descriptions over 200 characters receive bonus points for richness.
 * Comprehensive descriptions significantly improve user experience.
 */
export const DESCRIPTION_LONG_THRESHOLD = 200 as const;

/**
 * Description quality threshold: minimum description
 *
 * Descriptions over 50 characters are considered meaningful.
 * Too-short descriptions often just repeat the title.
 */
export const DESCRIPTION_MIN_THRESHOLD = 50 as const;

/**
 * External ID quality weight (5 points each)
 *
 * Each external ID mapping (Amazon, Goodreads, Google Books) adds 5 points.
 * These IDs enable cross-referencing and data enrichment from other sources.
 */
export const EXTERNAL_ID_WEIGHT = 5 as const;

// =================================================================================
// Queue Processing Limits
// =================================================================================

/**
 * Cover queue: batch size limit
 *
 * Maximum covers processed per batch.
 * Lower than enrichment queue because image processing is CPU-intensive.
 *
 * Cloudflare Workers CPU limit: 300 seconds (5 minutes) per request
 * Cover processing: ~5-10 seconds per image
 * Safe batch size: 5 images = 25-50 seconds max
 */
export const COVER_QUEUE_MAX_BATCH_SIZE = 5 as const;

/**
 * Cover queue: timeout per provider
 *
 * Maximum time to wait for cover fetch from a single provider.
 * Prevents slow providers from blocking the entire batch.
 *
 * Rationale: Most cover fetches complete in <2 seconds.
 * 10 second timeout allows for slow networks while preventing hangs.
 */
export const COVER_PROVIDER_TIMEOUT_MS = 10000 as const; // 10 seconds

/**
 * Enrichment queue: batch size limit
 *
 * Maximum editions enriched per batch.
 * Cloudflare Queue hard limit is 100 messages per batch.
 *
 * ISBNdb batch API can handle 1000 ISBNs per call, but we use smaller
 * batches for better error isolation and quota management.
 */
export const ENRICHMENT_QUEUE_MAX_BATCH_SIZE = 10 as const;

/**
 * Fuzzy match: batch size limit
 *
 * Maximum candidates processed per fuzzy match batch.
 * Prevents overwhelming database with trigram similarity queries.
 *
 * Rationale: Trigram queries are expensive (full table scan with similarity).
 * Processing in 50-item batches keeps query time <1 second per batch.
 */
export const FUZZY_MATCH_BATCH_SIZE = 50 as const;

/**
 * Fuzzy match: result limit
 *
 * Maximum similar results returned per query.
 * We only need the top 3 matches to find duplicates.
 *
 * Rationale: If the book exists in our database, it should be in top 3 results.
 * More results waste CPU without improving accuracy.
 */
export const FUZZY_MATCH_RESULT_LIMIT = 3 as const;

// =================================================================================
// Completeness Calculation
// =================================================================================

/**
 * Completeness percentage multiplier
 *
 * Convert fraction of filled fields to percentage (0-100).
 */
export const COMPLETENESS_PERCENTAGE = 100 as const;

// =================================================================================
// Priority Values
// =================================================================================

/**
 * Priority: default value
 *
 * Default priority for enrichment operations when not specified.
 * Medium priority (5) balances urgency with resource usage.
 */
export const PRIORITY_DEFAULT = 5 as const;

/**
 * Priority range: minimum
 *
 * Minimum priority value (1 = most urgent).
 * Lower numbers processed first.
 */
export const PRIORITY_MIN = 1 as const;

/**
 * Priority range: maximum
 *
 * Maximum priority value (10 = least urgent).
 * Higher numbers processed last.
 */
export const PRIORITY_MAX = 10 as const;

/**
 * Priority levels map
 *
 * Human-readable priority names mapped to numeric values.
 * Used by queue management and enrichment scheduling.
 */
export const PRIORITY_LEVELS = {
	urgent: 1,
	high: 3,
	medium: 5,
	normal: 5,
	low: 7,
	background: 9,
} as const;

// =================================================================================
// Estimated Processing Times
// =================================================================================

/**
 * Queue position thresholds for time estimates
 *
 * Used to provide user-facing estimates of processing time.
 * Based on observed queue processing rates in production.
 */
export const QUEUE_POSITION_THRESHOLDS = {
	/** Top 10 in queue: 1-5 minutes */
	fast: 10,
	/** Top 50 in queue: 5-15 minutes */
	medium: 50,
	/** Beyond 50: 15-30 minutes */
} as const;

/**
 * Estimated processing time ranges (human-readable)
 */
export const PROCESSING_TIME_ESTIMATES = {
	fast: '1-5 minutes',
	medium: '5-15 minutes',
	slow: '15-30 minutes',
} as const;

// =================================================================================
// Validation Limits
// =================================================================================

/**
 * Maximum field lengths for database validation
 *
 * These limits prevent database errors from oversized fields.
 * Based on PostgreSQL TEXT column limits and practical considerations.
 */
export const MAX_FIELD_LENGTHS = {
	title: 500,
	subtitle: 500,
	description: 5000,
	bio: 5000,
	publisher: 200,
	format: 50,
	language: 20,
} as const;

/**
 * Confidence score range
 *
 * Work match confidence must be 0-100.
 * Represents percentage certainty of the match.
 */
export const CONFIDENCE_SCORE_MIN = 0 as const;
export const CONFIDENCE_SCORE_MAX = 100 as const;

/**
 * ISBN format lengths
 *
 * Valid ISBN lengths after normalization (removing hyphens/spaces).
 */
export const ISBN_LENGTH_10 = 10 as const;
export const ISBN_LENGTH_13 = 13 as const;

// =================================================================================
// Rate Limiting (see also: docs/operations/RATE-LIMITS.md)
// =================================================================================

/**
 * Archive.org rate limit: delay between requests
 *
 * 1 request per second (1000ms delay)
 * Conservative limit to respect Archive.org's resources.
 */
export const ARCHIVE_ORG_DELAY_MS = 1000 as const;

/**
 * Wikipedia rate limit: delay between requests
 *
 * 1 request per second (1000ms delay)
 * Wikimedia API guidelines recommend 1 req/sec for anonymous clients.
 */
export const WIKIPEDIA_DELAY_MS = 1000 as const;

/**
 * Wikidata rate limit: delay between requests
 *
 * 2 requests per second (500ms delay)
 * Wikidata SPARQL endpoint allows higher rate than Wikipedia.
 */
export const WIKIDATA_DELAY_MS = 500 as const;

/**
 * OpenLibrary rate limit: delay between requests
 *
 * 1 request per 3 seconds (3000ms delay)
 * OpenLibrary enforces 100 requests per 5 minutes = 1 req per 3 seconds.
 */
export const OPEN_LIBRARY_DELAY_MS = 3000 as const;

// =================================================================================
// Cache Versions
// =================================================================================

/**
 * Cache key version
 *
 * Increment this to invalidate all cached queries after schema changes.
 * Format: combined:v{VERSION}:{type}:{query}
 */
export const CACHE_KEY_VERSION = 1 as const;

// =================================================================================
// Synthetic Work Completeness Scores
// =================================================================================

/**
 * Synthetic work: initial completeness score
 *
 * Score assigned when Gemini creates a synthetic work without ISBN.
 * Low score (30%) indicates minimal metadata (title, author, year only).
 */
export const SYNTHETIC_WORK_INITIAL_SCORE = 30 as const;

/**
 * Synthetic work: failed enrichment score
 *
 * Score assigned when ISBN resolution fails but we have basic metadata.
 * Medium score (40%) indicates some metadata but no full enrichment.
 */
export const SYNTHETIC_WORK_FAILED_SCORE = 40 as const;

/**
 * Synthetic work: completeness threshold
 *
 * Synthetic works with score <50 are candidates for enhancement.
 * This threshold distinguishes "needs enrichment" from "sufficiently complete".
 */
export const SYNTHETIC_WORK_ENHANCEMENT_THRESHOLD = 50 as const;

/**
 * Synthetic work: enhanced score
 *
 * Score assigned after successful ISBN resolution and enrichment.
 * High score (80%) indicates full metadata from ISBNdb + Open APIs.
 */
export const SYNTHETIC_WORK_ENHANCED_SCORE = 80 as const;

/**
 * Daily synthetic enhancement batch size
 *
 * Maximum synthetic works to enhance per day.
 * Limited by ISBNdb quota (~500 works ≈ 505 API calls).
 */
export const SYNTHETIC_ENHANCEMENT_BATCH_SIZE = 500 as const;

// =================================================================================
// Quota Calculation Helpers
// =================================================================================

/**
 * Calculate effective ISBNdb quota limit (with buffer)
 */
export function getEffectiveQuotaLimit(): number {
	return ISBNDB_DAILY_QUOTA - ISBNDB_QUOTA_BUFFER;
}

/**
 * Calculate conservative batch size (half of remaining quota)
 */
export function getConservativeBatchSize(remainingQuota: number, maxBatchSize: number = 1000): number {
	const conservativeQuota = Math.floor(remainingQuota / 2);
	return Math.min(maxBatchSize, conservativeQuota * 1000);
}
