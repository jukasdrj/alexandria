// =================================================================================
// Utility Functions for Enrichment
// =================================================================================

/**
 * Calculate quality score for an edition enrichment
 * @param {import('./types').EnrichEditionRequest} edition
 * @returns {number} Quality score (0-100)
 */
export function calculateEditionQuality(edition) {
  let score = 0;

  // Provider weights (40 points max)
  const providerScores = {
    'isbndb': 40,
    'google-books': 30,
    'openlibrary': 20,
    'user-correction': 50,  // User corrections are highest quality
  };
  score += providerScores[edition.primary_provider] || 0;

  // Completeness weights (60 points max)
  if (edition.title) score += 10;
  if (edition.publisher) score += 5;
  if (edition.publication_date) score += 5;
  if (edition.page_count) score += 5;
  if (edition.cover_urls?.large) score += 10;
  if (edition.cover_urls?.medium) score += 3;
  if (edition.cover_urls?.small) score += 2;
  if (edition.language) score += 5;
  if (edition.format) score += 5;

  // External ID weights (5 points each)
  if (edition.openlibrary_edition_id) score += 5;
  if (edition.google_books_volume_ids?.length) score += 5;
  if (edition.amazon_asins?.length) score += 5;

  return Math.min(score, 100);
}

/**
 * Calculate quality score for a work enrichment
 * @param {import('./types').EnrichWorkRequest} work
 * @returns {number} Quality score (0-100)
 */
export function calculateWorkQuality(work) {
  let score = 0;

  // Provider weights (40 points max)
  const providerScores = {
    'isbndb': 40,
    'google-books': 30,
    'openlibrary': 20,
    'user-correction': 50,
  };
  score += providerScores[work.primary_provider] || 0;

  // Completeness weights
  if (work.title) score += 10;
  if (work.description && work.description.length > 50) score += 15;
  if (work.description && work.description.length > 200) score += 5; // Bonus for long description
  if (work.original_language) score += 5;
  if (work.first_publication_year) score += 5;
  if (work.subject_tags?.length) score += 10;
  if (work.cover_urls?.large) score += 10;

  return Math.min(score, 100);
}

/**
 * Calculate completeness score (percentage of filled fields)
 * @param {Object} data - Data object to evaluate
 * @param {string[]} fields - List of field names to check
 * @returns {number} Completeness percentage (0-100)
 */
export function calculateCompleteness(data, fields) {
  const filledFields = fields.filter(field => {
    const value = data[field];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(v => v != null && v !== '');
    }
    return value != null && value !== '';
  });

  return Math.round((filledFields.length / fields.length) * 100);
}

/**
 * Validate ISBN format
 * @param {string} isbn - ISBN to validate
 * @returns {{valid: boolean, normalized: string, error?: string}}
 */
export function validateISBN(isbn) {
  if (!isbn) {
    return { valid: false, normalized: '', error: 'ISBN is required' };
  }

  // Normalize: remove hyphens, spaces, and uppercase
  const normalized = isbn.replace(/[^0-9X]/gi, '').toUpperCase();

  if (normalized.length !== 10 && normalized.length !== 13) {
    return {
      valid: false,
      normalized,
      error: `Invalid ISBN length: ${normalized.length}. Must be 10 or 13 digits.`
    };
  }

  return { valid: true, normalized };
}

/**
 * Validate enrichment request
 * @param {Object} body - Request body
 * @param {'edition'|'work'|'author'} type - Entity type
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEnrichmentRequest(body, type) {
  const errors = [];

  if (!body) {
    return { valid: false, errors: ['Request body is required'] };
  }

  // Maximum field lengths to prevent database errors
  const maxLengths = {
    title: 500,
    subtitle: 500,
    description: 5000,
    bio: 5000,
    publisher: 200,
    format: 50,
    language: 20
  };

  // Validate string field lengths
  const validateLength = (field, value, max) => {
    if (value && typeof value === 'string' && value.length > max) {
      errors.push(`${field} exceeds maximum length of ${max} characters`);
    }
  };

  if (type === 'edition') {
    if (!body.isbn) errors.push('isbn is required');
    if (!body.primary_provider) errors.push('primary_provider is required');

    if (body.isbn) {
      const isbnValidation = validateISBN(body.isbn);
      if (!isbnValidation.valid) {
        errors.push(isbnValidation.error);
      }
    }

    if (body.confidence && (body.confidence < 0 || body.confidence > 100)) {
      errors.push('confidence must be between 0 and 100');
    }

    // Length validations for edition fields
    validateLength('title', body.title, maxLengths.title);
    validateLength('subtitle', body.subtitle, maxLengths.subtitle);
    validateLength('publisher', body.publisher, maxLengths.publisher);
    validateLength('format', body.format, maxLengths.format);
    validateLength('language', body.language, maxLengths.language);
  }

  if (type === 'work') {
    if (!body.work_key) errors.push('work_key is required');
    if (!body.title) errors.push('title is required');
    if (!body.primary_provider) errors.push('primary_provider is required');

    // Length validations for work fields
    validateLength('title', body.title, maxLengths.title);
    validateLength('subtitle', body.subtitle, maxLengths.subtitle);
    validateLength('description', body.description, maxLengths.description);
    validateLength('original_language', body.original_language, maxLengths.language);
  }

  if (type === 'author') {
    if (!body.author_key) errors.push('author_key is required');
    if (!body.name) errors.push('name is required');
    if (!body.primary_provider) errors.push('primary_provider is required');

    // Length validations for author fields
    validateLength('name', body.name, maxLengths.title);
    validateLength('bio', body.bio, maxLengths.bio);
    validateLength('nationality', body.nationality, maxLengths.publisher);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format PostgreSQL array literal
 * @param {string[]|null|undefined} arr - Array to format
 * @returns {string|null} PostgreSQL array literal or null
 */
export function formatPgArray(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    return null;
  }
  // Filter out null/undefined values
  const cleanArr = arr.filter(item => item != null && item !== '');
  if (cleanArr.length === 0) return null;

  return cleanArr;
}
