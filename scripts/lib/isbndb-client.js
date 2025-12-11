/**
 * ISBNdb API Client (via Alexandria Worker)
 * Handles author bibliography queries by calling the Worker endpoint
 */

export class ISBNdbClient {
  constructor(workerBaseURL = 'https://alexandria.ooheynerds.com') {
    this.workerBaseURL = workerBaseURL;
  }

  /**
   * Get complete bibliography for an author via Worker endpoint
   * @param {string} authorName - Author name to search
   * @param {number} maxPages - Maximum pages to fetch (default: 10 = 1000 books)
   * @returns {Promise<Array>} - Array of book objects with ISBN, title, author
   */
  async getAuthorBibliography(authorName, maxPages = 10) {
    try {
      const response = await fetch(`${this.workerBaseURL}/api/authors/bibliography`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          author_name: authorName,
          max_pages: maxPages
        })
      });

      if (response.status === 429) {
        console.warn(`Rate limited by ISBNdb for ${authorName}`);
        return [];
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.warn(`Worker error for ${authorName}:`, error.error || error.message);
        return [];
      }

      const data = await response.json();
      return data.books || [];
    } catch (error) {
      console.error(`Error fetching bibliography for ${authorName}:`, error.message);
      return [];
    }
  }

  /**
   * Get bibliographies for multiple authors with progress tracking
   * @param {Array<string>} authors - Array of author names
   * @param {Function} onProgress - Callback(authorName, booksFound, currentIndex, total)
   * @param {number} maxPagesPerAuthor - Max pages per author (default: 10)
   * @returns {Promise<Object>} - { authorName: [books], ... }
   */
  async getBulkBibliographies(authors, onProgress, maxPagesPerAuthor = 10) {
    const results = {};

    for (let i = 0; i < authors.length; i++) {
      const author = authors[i];
      const books = await this.getAuthorBibliography(author, maxPagesPerAuthor);
      results[author] = books;

      if (onProgress) {
        onProgress(author, books.length, i + 1, authors.length);
      }

      // Rate limit between authors
      if (i < authors.length - 1) {
        await this.sleep(1000);
      }
    }

    return results;
  }

  /**
   * Fetch bibliography AND enrich in one API call (no double-fetch!)
   * This is the efficient method that avoids re-fetching book data.
   *
   * @param {string} authorName - Author name to search
   * @param {number} maxPages - Maximum pages to fetch (default: 10 = 1000 books)
   * @returns {Promise<Object>} - { books_found, already_enriched, newly_enriched, covers_queued, cached }
   */
  async enrichAuthorBibliography(authorName, maxPages = 10) {
    try {
      const response = await fetch(`${this.workerBaseURL}/api/authors/enrich-bibliography`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          author_name: authorName,
          max_pages: maxPages
        })
      });

      if (response.status === 429) {
        console.warn(`Rate limited by ISBNdb for ${authorName}`);
        return { error: 'rate_limited', books_found: 0 };
      }

      if (response.status === 403) {
        console.warn(`ISBNdb quota exhausted for ${authorName}`);
        return { error: 'quota_exhausted', books_found: 0 };
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.warn(`Worker error for ${authorName}:`, error.error || error.message);
        return { error: error.error || error.message, books_found: 0 };
      }

      return await response.json();
    } catch (error) {
      console.error(`Error enriching bibliography for ${authorName}:`, error.message);
      return { error: error.message, books_found: 0 };
    }
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
