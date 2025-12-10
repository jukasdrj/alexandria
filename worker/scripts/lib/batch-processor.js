/**
 * Batch Processor for Queue Operations
 * Handles chunking and rate-limited HTTP requests
 */

/**
 * Process books in batches and queue them
 * @param {Array} books - Array of book objects with isbn, title, author
 * @param {object} options - Configuration options
 * @param {number} options.batchSize - Size of each batch
 * @param {object} options.client - QueueClient instance
 * @param {string} options.endpoint - API endpoint path
 * @param {object} options.tracker - ProgressTracker instance
 * @param {string} options.priority - Priority level (normal, high, low)
 * @returns {Promise<number>} - Total number of items queued
 */
export async function processBatches(books, options) {
  const { batchSize, client, endpoint, tracker, priority } = options;

  const batches = chunkArray(books, batchSize);
  let totalQueued = 0;

  const bar = tracker.createProgressBar(batches.length);

  for (const batch of batches) {
    const payload = {
      books: batch.map(book => ({
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        priority,
        source: 'csv_import'
      }))
    };

    const result = await client.post(endpoint, payload);
    totalQueued += result.queued;

    bar.increment();

    // Rate limit: 100ms between batches to avoid overwhelming Worker
    await sleep(100);
  }

  bar.stop();
  return totalQueued;
}

/**
 * Split array into chunks
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array<Array>} - Array of chunks
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Resolves after delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
