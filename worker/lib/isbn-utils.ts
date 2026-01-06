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
 */
const FOREIGN_ISBN_PREFIXES: Record<string, string> = {
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
const ENGLISH_ISBN_PREFIXES: string[] = [
  '978-0',   // English language - international
  '978-1',   // English language - international
  '0',       // ISBN-10 English
  '1',       // ISBN-10 English
];

/**
 * Normalize ISBN to standard format (remove hyphens, spaces, validate)
 * @param isbn - ISBN-10 or ISBN-13
 * @returns Normalized ISBN or null if invalid
 */
export function normalizeISBN(isbn: string | null | undefined): string | null {
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
 * @param isbn - Normalized ISBN
 * @returns True if likely English, false otherwise
 */
export function isLikelyEnglishISBN(isbn: string | null | undefined): boolean {
  if (!isbn) return false;

  const normalized = normalizeISBN(isbn);
  if (!normalized) return false;

  // Check if starts with English prefix
  return ENGLISH_ISBN_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

/**
 * Check if ISBN is from a known foreign (non-English) market
 * @param isbn - Normalized ISBN
 * @returns True if foreign language, false otherwise
 */
export function isForeignISBN(isbn: string | null | undefined): boolean {
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
 * @param isbn - Normalized ISBN
 * @returns Language/region name or null if unknown
 */
export function getISBNLanguage(isbn: string | null | undefined): string | null {
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
 * Options for filtering English ISBNs
 */
export interface FilterEnglishISBNsOptions {
  /** Allow ISBNs with unknown language (default: true) */
  allowUnknown?: boolean;
}

/**
 * Filter a list of ISBNs to only English language ISBNs
 * @param isbns - Array of ISBNs
 * @param options - Filtering options
 * @returns Filtered array of ISBNs
 */
export function filterEnglishISBNs(
  isbns: string[],
  options: FilterEnglishISBNsOptions = {}
): string[] {
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
 * Result of ISBN validation batch operation
 */
export interface ISBNValidationResult {
  /** Array of valid normalized ISBNs */
  valid: string[];
  /** Array of invalid ISBNs */
  invalid: string[];
}

/**
 * Validate and normalize a batch of ISBNs
 * @param isbns - Array of ISBNs
 * @returns Object with valid and invalid ISBNs
 */
export function validateISBNBatch(isbns: string[]): ISBNValidationResult {
  const valid: string[] = [];
  const invalid: string[] = [];

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
 * @param isbns - Array of ISBNs
 * @returns Deduplicated array of normalized ISBNs
 */
export function deduplicateISBNs(isbns: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

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
 * @param isbn - ISBN to check
 * @returns True if should query ISBNdb, false otherwise
 */
export function shouldQueryISBNdb(isbn: string | null | undefined): boolean {
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
 * @param isbns - Array of ISBNs
 * @param batchSize - Size of each batch (default: 100)
 * @returns Array of ISBN batches
 */
export function partitionISBNs(isbns: string[], batchSize: number = 100): string[][] {
  const batches: string[][] = [];

  for (let i = 0; i < isbns.length; i += batchSize) {
    batches.push(isbns.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Statistics about ISBN batch composition
 */
export interface ISBNBatchStats {
  /** Total ISBNs in batch */
  total: number;
  /** Valid ISBNs count */
  valid: number;
  /** Invalid ISBNs count */
  invalid: number;
  /** English ISBNs count */
  english: number;
  /** Foreign ISBNs count */
  foreign: number;
  /** Unknown language ISBNs count */
  unknown: number;
  /** Count by language */
  languages: Record<string, number>;
}

/**
 * Get statistics about ISBN batch composition
 * @param isbns - Array of ISBNs
 * @returns Statistics object
 */
export function getISBNBatchStats(isbns: string[]): ISBNBatchStats {
  const stats: ISBNBatchStats = {
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
      if (language) {
        stats.languages[language] = (stats.languages[language] || 0) + 1;
      }
    } else {
      stats.unknown++;
    }
  }

  return stats;
}
