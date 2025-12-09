/**
 * Database Client for ISBN Deduplication
 * Uses Alexandria Worker API to check which ISBNs already exist
 */

export class DatabaseClient {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = apiBaseUrl || 'https://alexandria.ooheynerds.com';
  }

  /**
   * Check which ISBNs exist in the database
   * @param {Array<string>} isbns - Array of ISBNs to check
   * @returns {Promise<Set<string>>} - Set of ISBNs that exist
   */
  async getExistingISBNs(isbns) {
    if (!isbns || isbns.length === 0) {
      return new Set();
    }

    try {
      // Use Worker API to check ISBNs (max 1000 per request)
      const response = await fetch(`${this.apiBaseUrl}/api/isbns/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbns })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return new Set(data.existing || []);
    } catch (error) {
      console.error('ISBN check error:', error.message);
      return new Set();
    }
  }

  /**
   * Filter out ISBNs that already exist in the database
   * @param {Array<Object>} books - Array of book objects with isbn property
   * @returns {Promise<Array<Object>>} - Books that don't exist in database
   */
  async filterNewBooks(books) {
    if (!books || books.length === 0) {
      return [];
    }

    const isbns = books.map(book => book.isbn);
    const existingISBNs = await this.getExistingISBNs(isbns);

    return books.filter(book => !existingISBNs.has(book.isbn));
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/stats`);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        enriched_editions: data.editions || 0,
        total_isbns: data.isbns || 0
      };
    } catch (error) {
      console.error('Stats query error:', error.message);
      return { enriched_editions: 0, total_isbns: 0 };
    }
  }

  /**
   * Check if a single ISBN exists
   * @param {string} isbn
   * @returns {Promise<boolean>}
   */
  async isbnExists(isbn) {
    const existingISBNs = await this.getExistingISBNs([isbn]);
    return existingISBNs.has(isbn);
  }

  /**
   * Close database connection (no-op for API client)
   */
  async close() {
    // No database connection to close when using API
  }
}
