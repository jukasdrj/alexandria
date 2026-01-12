// =================================================================================
// Utility Functions for Enrichment
// =================================================================================

import type {
  EnrichEditionRequest,
  EnrichWorkRequest,
  ValidationResult,
  ISBNValidationResult,
} from './types.js';
import {
  PROVIDER_QUALITY_SCORES,
  EDITION_FIELD_WEIGHTS,
  WORK_FIELD_WEIGHTS,
  EXTERNAL_ID_WEIGHT,
  QUALITY_SCORE_MAX,
  DESCRIPTION_MIN_THRESHOLD,
  DESCRIPTION_LONG_THRESHOLD,
  COMPLETENESS_PERCENTAGE,
  MAX_FIELD_LENGTHS,
  CONFIDENCE_SCORE_MIN,
  CONFIDENCE_SCORE_MAX,
  ISBN_LENGTH_10,
  ISBN_LENGTH_13,
  PRIORITY_DEFAULT,
  PRIORITY_MIN,
  PRIORITY_MAX,
  PRIORITY_LEVELS,
} from '../lib/constants.js';

/**
 * Calculate quality score for an edition enrichment
 *
 * Scoring breakdown:
 * - Provider quality: 0-50 points (based on data source reliability)
 * - Field completeness: 0-50 points (based on available metadata)
 * - External IDs: 0-15 points (3 IDs × 5 points each)
 *
 * Maximum score: 100 points
 *
 * @param edition - Edition to score
 * @returns Quality score (0-100)
 *
 * @see {@link PROVIDER_QUALITY_SCORES} for provider weights
 * @see {@link EDITION_FIELD_WEIGHTS} for field weights
 */
export function calculateEditionQuality(edition: EnrichEditionRequest): number {
  let score = 0;

  // Provider weights (0-50 points)
  // Different providers have different quality levels based on data accuracy
  score += PROVIDER_QUALITY_SCORES[edition.primary_provider as keyof typeof PROVIDER_QUALITY_SCORES] || 0;

  // Completeness weights (0-50 points total)
  // Each field contributes based on its importance to edition identification
  if (edition.title) score += EDITION_FIELD_WEIGHTS.title;
  if (edition.publisher) score += EDITION_FIELD_WEIGHTS.publisher;
  if (edition.publication_date) score += EDITION_FIELD_WEIGHTS.publication_date;
  if (edition.page_count) score += EDITION_FIELD_WEIGHTS.page_count;
  if (edition.cover_urls?.large) score += EDITION_FIELD_WEIGHTS.cover_large;
  if (edition.cover_urls?.medium) score += EDITION_FIELD_WEIGHTS.cover_medium;
  if (edition.cover_urls?.small) score += EDITION_FIELD_WEIGHTS.cover_small;
  if (edition.language) score += EDITION_FIELD_WEIGHTS.language;
  if (edition.format) score += EDITION_FIELD_WEIGHTS.format;

  // External ID weights (5 points each, max 15 points)
  // These enable cross-referencing with other book databases
  if (edition.openlibrary_edition_id) score += EXTERNAL_ID_WEIGHT;
  if (edition.google_books_volume_ids?.length) score += EXTERNAL_ID_WEIGHT;
  if (edition.amazon_asins?.length) score += EXTERNAL_ID_WEIGHT;

  return Math.min(score, QUALITY_SCORE_MAX);
}

/**
 * Calculate quality score for a work enrichment
 *
 * Scoring breakdown:
 * - Provider quality: 0-50 points (based on data source reliability)
 * - Field completeness: 0-60 points (based on available metadata)
 *
 * Maximum score: 100 points
 *
 * Works emphasize description quality more than editions since works
 * represent the abstract concept of a book, not a specific printing.
 *
 * @param work - Work to score
 * @returns Quality score (0-100)
 *
 * @see {@link PROVIDER_QUALITY_SCORES} for provider weights
 * @see {@link WORK_FIELD_WEIGHTS} for field weights
 */
export function calculateWorkQuality(work: EnrichWorkRequest): number {
  let score = 0;

  // Provider weights (0-50 points)
  // Different providers have different quality levels based on data accuracy
  score += PROVIDER_QUALITY_SCORES[work.primary_provider as keyof typeof PROVIDER_QUALITY_SCORES] || 0;

  // Completeness weights (0-60 points total)
  // Works emphasize description and subject tags more than physical attributes
  if (work.title) score += WORK_FIELD_WEIGHTS.title;
  if (work.description && work.description.length > DESCRIPTION_MIN_THRESHOLD) {
    score += WORK_FIELD_WEIGHTS.description;
  }
  // Bonus for comprehensive descriptions (>200 chars)
  if (work.description && work.description.length > DESCRIPTION_LONG_THRESHOLD) {
    score += WORK_FIELD_WEIGHTS.description_long;
  }
  if (work.original_language) score += WORK_FIELD_WEIGHTS.original_language;
  if (work.first_publication_year) score += WORK_FIELD_WEIGHTS.first_publication_year;
  if (work.subject_tags?.length) score += WORK_FIELD_WEIGHTS.subject_tags;
  if (work.cover_urls?.large) score += WORK_FIELD_WEIGHTS.cover_large;

  return Math.min(score, QUALITY_SCORE_MAX);
}

/**
 * Calculate completeness score (percentage of filled fields)
 *
 * Evaluates what percentage of expected fields are populated with valid data.
 * Used to assess metadata completeness for editions, works, and authors.
 *
 * Scoring logic:
 * - Arrays: Must have at least one element
 * - Objects: Must have at least one non-empty value
 * - Primitives: Must be non-null and non-empty string
 *
 * @param data - Object to evaluate
 * @param fields - Array of field names to check
 * @returns Completeness percentage (0-100)
 *
 * @example
 * calculateCompleteness(
 *   { title: 'Book', publisher: null, page_count: 300 },
 *   ['title', 'publisher', 'page_count']
 * ) // Returns 67 (2 of 3 fields filled)
 */
export function calculateCompleteness(
  data: Record<string, unknown>,
  fields: string[]
): number {
  const filledFields = fields.filter((field) => {
    const value = data[field];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some((v) => v != null && v !== '');
    }
    return value != null && value !== '';
  });

  return Math.round((filledFields.length / fields.length) * COMPLETENESS_PERCENTAGE);
}

/**
 * Validate ISBN format
 *
 * Accepts ISBN-10 or ISBN-13 formats with optional hyphens/spaces.
 * Normalizes by removing separators and uppercasing the check digit.
 *
 * Valid formats:
 * - ISBN-10: 10 digits, last digit can be X (e.g., 043906487X)
 * - ISBN-13: 13 digits, must start with 978 or 979
 *
 * @param isbn - Raw ISBN string
 * @returns Validation result with normalized ISBN or error message
 *
 * @example
 * validateISBN('978-0-439-06487-3') // { valid: true, normalized: '9780439064873' }
 * validateISBN('043906487X') // { valid: true, normalized: '043906487X' }
 * validateISBN('12345') // { valid: false, error: 'Invalid ISBN length: 5...' }
 */
export function validateISBN(isbn: string | undefined): ISBNValidationResult {
  if (!isbn) {
    return { valid: false, normalized: '', error: 'ISBN is required' };
  }

  // Normalize: remove hyphens, spaces, and uppercase check digit
  const normalized = isbn.replace(/[^0-9X]/gi, '').toUpperCase();

  // Check length (must be exactly 10 or 13 digits)
  if (normalized.length !== ISBN_LENGTH_10 && normalized.length !== ISBN_LENGTH_13) {
    return {
      valid: false,
      normalized,
      error: `Invalid ISBN length: ${normalized.length}. Must be ${ISBN_LENGTH_10} or ${ISBN_LENGTH_13} digits.`,
    };
  }

  return { valid: true, normalized };
}

/**
 * Validate enrichment request
 *
 * Validates request body against schema requirements and database constraints.
 * Checks required fields, data types, and maximum lengths to prevent errors.
 *
 * @param body - Request body to validate
 * @param type - Entity type (edition, work, or author)
 * @returns Validation result with error messages if invalid
 *
 * @see {@link MAX_FIELD_LENGTHS} for field length constraints
 */
export function validateEnrichmentRequest(
  body: Record<string, unknown> | undefined,
  type: 'edition' | 'work' | 'author'
): ValidationResult {
  const errors: string[] = [];

  if (!body) {
    return { valid: false, errors: ['Request body is required'] };
  }

  // Validate string field lengths against database constraints
  const validateLength = (field: string, value: unknown, max: number): void => {
    if (value && typeof value === 'string' && value.length > max) {
      errors.push(`${field} exceeds maximum length of ${max} characters`);
    }
  };

  if (type === 'edition') {
    if (!body.isbn) errors.push('isbn is required');
    if (!body.primary_provider) errors.push('primary_provider is required');

    if (body.isbn) {
      const isbnValidation = validateISBN(body.isbn as string);
      if (!isbnValidation.valid) {
        errors.push(isbnValidation.error!);
      }
    }

    // Confidence score must be 0-100 percentage
    if (
      body.confidence &&
      ((body.confidence as number) < CONFIDENCE_SCORE_MIN || (body.confidence as number) > CONFIDENCE_SCORE_MAX)
    ) {
      errors.push(`confidence must be between ${CONFIDENCE_SCORE_MIN} and ${CONFIDENCE_SCORE_MAX}`);
    }

    // Length validations for edition fields
    validateLength('title', body.title, MAX_FIELD_LENGTHS.title);
    validateLength('subtitle', body.subtitle, MAX_FIELD_LENGTHS.subtitle);
    validateLength('publisher', body.publisher, MAX_FIELD_LENGTHS.publisher);
    validateLength('format', body.format, MAX_FIELD_LENGTHS.format);
    validateLength('language', body.language, MAX_FIELD_LENGTHS.language);
  }

  if (type === 'work') {
    if (!body.work_key) errors.push('work_key is required');
    if (!body.title) errors.push('title is required');
    if (!body.primary_provider) errors.push('primary_provider is required');

    // Length validations for work fields
    validateLength('title', body.title, MAX_FIELD_LENGTHS.title);
    validateLength('subtitle', body.subtitle, MAX_FIELD_LENGTHS.subtitle);
    validateLength('description', body.description, MAX_FIELD_LENGTHS.description);
    validateLength('original_language', body.original_language, MAX_FIELD_LENGTHS.language);
  }

  if (type === 'author') {
    if (!body.author_key) errors.push('author_key is required');
    if (!body.name) errors.push('name is required');
    if (!body.primary_provider) errors.push('primary_provider is required');

    // Length validations for author fields
    validateLength('name', body.name, MAX_FIELD_LENGTHS.title);
    validateLength('bio', body.bio, MAX_FIELD_LENGTHS.bio);
    validateLength('nationality', body.nationality, MAX_FIELD_LENGTHS.publisher);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format PostgreSQL array literal
 *
 * The postgres.js library doesn't automatically handle arrays when used with
 * Hyperdrive in Cloudflare Workers. We need to format arrays as PostgreSQL
 * array literals manually.
 */
export function formatPgArray(arr: unknown[] | null | undefined): string | null {
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    return null;
  }
  // Filter out null/undefined values
  const cleanArr = arr.filter((item) => item != null && item !== '');
  if (cleanArr.length === 0) return null;

  // Format as PostgreSQL array literal: {"value1","value2"}
  // Escape any double quotes or backslashes in values
  const escaped = cleanArr.map((item) => {
    const str = String(item);
    // Escape backslashes first, then double quotes
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  });

  return '{' + escaped.join(',') + '}';
}

/**
 * Flatten object keys for logging, expanding nested objects like cover_urls
 */
export function flattenFieldKeys(
  obj: Record<string, unknown>,
  excludeKeys: string[] = []
): string[] {
  const fields: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (excludeKeys.includes(key) || value == null) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Flatten nested objects (e.g., cover_urls.large, cover_urls.medium)
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (subValue != null) {
          fields.push(`${key}.${subKey}`);
        }
      }
    } else {
      fields.push(key);
    }
  }

  return fields;
}

/**
 * Convert priority from string or integer to integer (1-10)
 *
 * Priority levels (1 = most urgent, 10 = least urgent):
 * - urgent: 1
 * - high: 3
 * - medium/normal: 5 (default)
 * - low: 7
 * - background: 9
 *
 * Numeric priorities are clamped to 1-10 range.
 *
 * @param priority - Priority as string name or numeric value
 * @returns Normalized priority (1-10)
 *
 * @see {@link PRIORITY_LEVELS} for string-to-number mapping
 * @see {@link PRIORITY_DEFAULT} for default value
 *
 * @example
 * normalizePriority('urgent') // 1
 * normalizePriority(15) // 10 (clamped to max)
 * normalizePriority(undefined) // 5 (default)
 */
export function normalizePriority(priority: string | number | undefined): number {
  // Default to medium priority if not specified
  if (!priority) return PRIORITY_DEFAULT;

  // If already a number, validate range (clamp to 1-10)
  if (typeof priority === 'number') {
    return Math.max(PRIORITY_MIN, Math.min(PRIORITY_MAX, priority));
  }

  // Convert string to integer using predefined levels
  const normalized = PRIORITY_LEVELS[priority.toLowerCase() as keyof typeof PRIORITY_LEVELS];
  return normalized || PRIORITY_DEFAULT; // Default to medium if unknown string
}

/**
 * Select the best available cover URL from a set of possible sizes
 * Prioritizes: original -> large -> medium -> small
 */
export function selectBestCoverURL(coverUrls?: {
  small?: string;
  medium?: string;
  large?: string;
  original?: string;
}): string | null {
  if (!coverUrls) return null;
  return (
    coverUrls.original || 
    coverUrls.large || 
    coverUrls.medium || 
    coverUrls.small || 
    null
  );
}
