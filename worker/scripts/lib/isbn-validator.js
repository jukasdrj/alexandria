/**
 * ISBN Validation and Normalization
 * Handles both ISBN-10 and ISBN-13 formats
 */

/**
 * Normalize an ISBN by removing non-alphanumeric characters (except X)
 * @param {string} isbn - Raw ISBN string
 * @returns {string|null} - Normalized ISBN or null if invalid
 */
export function normalizeISBN(isbn) {
  if (!isbn) return null;

  // Remove all non-alphanumeric except X (for ISBN-10)
  const cleaned = isbn.replace(/[^0-9X]/gi, '').toUpperCase();

  // Validate length (10 or 13 digits)
  if (cleaned.length === 10 || cleaned.length === 13) {
    return cleaned;
  }

  return null;
}

/**
 * Validate and normalize a list of books with ISBNs
 * @param {Array} books - Array of book objects with isbn property
 * @returns {{valid: Array, invalid: Array}} - Separated valid and invalid books
 */
export function validateISBNs(books) {
  const valid = [];
  const invalid = [];

  for (const book of books) {
    const normalized = normalizeISBN(book.isbn);

    if (normalized) {
      valid.push({ ...book, isbn: normalized });
    } else {
      invalid.push(book);
    }
  }

  return { valid, invalid };
}
