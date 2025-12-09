/**
 * Database Client for ISBN Deduplication
 * Queries enriched_editions table to check which ISBNs already exist
 */

import postgres from 'postgres';

export class DatabaseClient {
  constructor(connectionString) {
    this.sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10
    });
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
      // Query enriched_editions for ISBNs
      const results = await this.sql`
        SELECT DISTINCT unnest(related_isbns) as isbn
        FROM enriched_editions
        WHERE related_isbns && ${isbns}
      `;

      return new Set(results.map(row => row.isbn));
    } catch (error) {
      console.error('Database query error:', error.message);
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
      const [enrichedCount] = await this.sql`
        SELECT COUNT(*) as count FROM enriched_editions
      `;

      const [totalISBNs] = await this.sql`
        SELECT COUNT(*) as count FROM edition_isbns
      `;

      return {
        enriched_editions: parseInt(enrichedCount.count),
        total_isbns: parseInt(totalISBNs.count)
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
    try {
      const result = await this.sql`
        SELECT 1 FROM enriched_editions
        WHERE ${isbn} = ANY(related_isbns)
        LIMIT 1
      `;

      return result.length > 0;
    } catch (error) {
      console.error('ISBN check error:', error.message);
      return false;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    await this.sql.end();
  }
}
