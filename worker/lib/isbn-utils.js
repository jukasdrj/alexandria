/**
 * ISBN Validation and Filtering Utilities
 *
 * Provides ISBN validation, normalization, and filtering functions
 * to reduce unnecessary API calls to ISBNdb and other providers.
 *
 * @module lib/isbn-utils
 */

/**
 * Foreign ISBN prefixes (non-English language markets)
 * These ISBNs have low success rates in ISBNdb (English-focused database)
 *
 * Format: 'prefix': 'Language/Region'
 */
const FOREIGN_ISBN_PREFIXES = {
  // Romance languages
  '978-2': 'French',
  '978-84': 'Spanish',
  '978-88': 'Italian',
  '978-972': 'Portuguese',
  '978-989': 'Portuguese',

  // Germanic languages
  '978-3': 'German/Austrian/Swiss',
  '978-90': 'Dutch',
  '978-87': 'Danish',
  '978-82': 'Norwegian',
  '978-91': 'Swedish',

  // Slavic languages
  '978-83': 'Polish',
  '978-80': 'Czech/Slovak',
  '978-86': 'Serbian',
  '978-953': 'Croatian',

  // Asian languages
  '978-7': 'Chinese',
  '978-89': 'Korean',
  '978-4': 'Japanese',
  '978-81': 'Indian',

  // Other
  '978-975': 'Turkish',
  '978-966': 'Ukrainian',
  '978-985': 'Belarusian',
  '978-9944': 'Azerbaijan',
};

/**
 * English ISBN prefixes (US, UK, Canada, Australia, etc.)
 * These have the highest success rates in ISBNdb
 */
const ENGLISH_ISBN_PREFIXES = [
  '978-0',   // English language - international
  '978-1',   // English language - international
  '0',       // ISBN-10 English
  '1',       // ISBN-10 English
];

/**
 * Normalize ISBN to standard format (remove hyphens, spaces, validate)
 * @param {string} isbn - ISBN-10 or ISBN-13
 * @returns {string|null} Normalized ISBN or null if invalid
 */
export function normalizeISBN(isbn) {
  if (!isbn) return null;

  // Remove hyphens, spaces, and convert to uppercase
  const cleaned = isbn.replace(/[-\s]/g, '').toUpperCase();

  // Validate ISBN-10 (9 digits + checksum digit or X)
  if (cleaned.length === 10) {
    if (!/^[0-9]{9}[0-9X]$/.test(cleaned)) return null;
    return cleaned;
  }

  // Validate ISBN-13 (13 digits)
  if (cleaned.length === 13) {
    if (!/^[0-9]{13}$/.test(cleaned)) return null;
    return cleaned;
  }

  return null;
}

/**
 * Check if ISBN is likely from an English language market
 * @param {string} isbn - Normalized ISBN
 * @returns {boolean} True if likely English, false otherwise
 */
export function isLikelyEnglishISBN(isbn) {
  if (!isbn) return false;

  const normalized = normalizeISBN(isbn);
  if (!normalized) return false;

  // Check if starts with English prefix
  return ENGLISH_ISBN_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

/**
 * Check if ISBN is from a known foreign (non-English) market
 * @param {string} isbn - Normalized ISBN
 * @returns {boolean} True if foreign language, false otherwise
 */
export function isForeignISBN(isbn) {
  if (!isbn) return false;

  const normalized = normalizeISBN(isbn);
  if (!normalized) return false;

  // Check against foreign prefixes
  for (const prefix of Object.keys(FOREIGN_ISBN_PREFIXES)) {
    if (normalized.startsWith(prefix.replace('-', ''))) {
      return true;
    }
  }

  return false;
}

/**
 * Get the language/region for an ISBN based on prefix
 * @param {string} isbn - Normalized ISBN
 * @returns {string|null} Language/region name or null if unknown
 */
export function getISBNLanguage(isbn) {
  if (!isbn) return null;

  const normalized = normalizeISBN(isbn);
  if (!normalized) return null;

  // Check English prefixes first
  if (isLikelyEnglishISBN(normalized)) {
    return 'English';
  }

  // Check foreign prefixes
  for (const [prefix, language] of Object.entries(FOREIGN_ISBN_PREFIXES)) {
    if (normalized.startsWith(prefix.replace('-', ''))) {
      return language;
    }
  }

  return 'Unknown';
}

/**
 * Filter a list of ISBNs to only English language ISBNs
 * @param {string[]} isbns - Array of ISBNs
 * @param {Object} options - Filtering options
 * @param {boolean} options.allowUnknown - Allow ISBNs with unknown language (default: true)
 * @returns {string[]} Filtered array of ISBNs
 */
export function filterEnglishISBNs(isbns, options = {}) {
  const { allowUnknown = true } = options;

  return isbns.filter(isbn => {
    const normalized = normalizeISBN(isbn);
    if (!normalized) return false;

    // Definitely English
    if (isLikelyEnglishISBN(normalized)) return true;

    // Definitely foreign
    if (isForeignISBN(normalized)) return false;

    // Unknown - respect allowUnknown option
    return allowUnknown;
  });
}

/**
 * @typedef {Object} ISBNValidationResult
 * @property {string[]} valid - Array of valid normalized ISBNs
 * @property {string[]} invalid - Array of invalid ISBNs
 */

/**
 * Validate and normalize a batch of ISBNs
 * @param {string[]} isbns - Array of ISBNs
 * @returns {ISBNValidationResult} Object with valid and invalid ISBNs
 */
export function validateISBNBatch(isbns) {
  const valid = [];
  const invalid = [];

  for (const isbn of isbns) {
    const normalized = normalizeISBN(isbn);
    if (normalized) {
      valid.push(normalized);
    } else {
      invalid.push(isbn);
    }
  }

  return { valid, invalid };
}

/**
 * Deduplicate ISBNs (case-insensitive, normalized)
 * @param {string[]} isbns - Array of ISBNs
 * @returns {string[]} Deduplicated array of normalized ISBNs
 */
export function deduplicateISBNs(isbns) {
  const seen = new Set();
  const result = [];

  for (const isbn of isbns) {
    const normalized = normalizeISBN(isbn);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

/**
 * Check if ISBN should be sent to ISBNdb API
 * Filters out foreign ISBNs and invalid formats
 * @param {string} isbn - ISBN to check
 * @returns {boolean} True if should query ISBNdb, false otherwise
 */
export function shouldQueryISBNdb(isbn) {
  const normalized = normalizeISBN(isbn);
  if (!normalized) return false;

  // Don't query known foreign ISBNs
  if (isForeignISBN(normalized)) return false;

  // Query English ISBNs
  if (isLikelyEnglishISBN(normalized)) return true;

  // For unknown ISBNs, allow query but log
  console.log(`[ISBN Filter] Unknown ISBN prefix: ${normalized.substring(0, 6)}`);
  return true;
}

/**
 * Partition ISBNs into batches of specified size
 * @param {string[]} isbns - Array of ISBNs
 * @param {number} batchSize - Size of each batch (default: 100)
 * @returns {string[][]} Array of ISBN batches
 */
export function partitionISBNs(isbns, batchSize = 100) {
  const batches = [];

  for (let i = 0; i < isbns.length; i += batchSize) {
    batches.push(isbns.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * @typedef {Object} ISBNBatchStats
 * @property {number} total - Total ISBNs in batch
 * @property {number} valid - Valid ISBNs count
 * @property {number} invalid - Invalid ISBNs count
 * @property {number} english - English ISBNs count
 * @property {number} foreign - Foreign ISBNs count
 * @property {number} unknown - Unknown language ISBNs count
 * @property {Record<string, number>} languages - Count by language
 */

/**
 * Get statistics about ISBN batch composition
 * @param {string[]} isbns - Array of ISBNs
 * @returns {ISBNBatchStats} Statistics object
 */
export function getISBNBatchStats(isbns) {
  const stats = {
    total: isbns.length,
    valid: 0,
    invalid: 0,
    english: 0,
    foreign: 0,
    unknown: 0,
    languages: {}
  };

  for (const isbn of isbns) {
    const normalized = normalizeISBN(isbn);

    if (!normalized) {
      stats.invalid++;
      continue;
    }

    stats.valid++;

    if (isLikelyEnglishISBN(normalized)) {
      stats.english++;
    } else if (isForeignISBN(normalized)) {
      stats.foreign++;
      const language = getISBNLanguage(normalized);
      stats.languages[language] = (stats.languages[language] || 0) + 1;
    } else {
      stats.unknown++;
    }
  }

  return stats;
}
