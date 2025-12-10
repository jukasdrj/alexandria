/**
 * Checkpoint Manager
 * Handles saving/loading processing state for resumability
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export class CheckpointManager {
  constructor(checkpointPath) {
    this.checkpointPath = checkpointPath;
    this.state = this.load();
  }

  /**
   * Load checkpoint from disk
   * @returns {Object} - Checkpoint state
   */
  load() {
    if (existsSync(this.checkpointPath)) {
      try {
        const data = readFileSync(this.checkpointPath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        console.warn(`Failed to load checkpoint: ${error.message}`);
        return this.getDefaultState();
      }
    }
    return this.getDefaultState();
  }

  /**
   * Save checkpoint to disk
   */
  save() {
    try {
      // Ensure directory exists
      const dir = dirname(this.checkpointPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(
        this.checkpointPath,
        JSON.stringify(this.state, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error(`Failed to save checkpoint: ${error.message}`);
    }
  }

  /**
   * Get default checkpoint state
   * @returns {Object}
   */
  getDefaultState() {
    return {
      processed_authors: [],
      failed_authors: [],
      total_authors: 0,
      total_isbns_found: 0,
      total_new_isbns: 0,
      total_queued: 0,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Mark author as processed
   * @param {string} authorName
   * @param {number} booksFound
   * @param {number} newBooks
   * @param {number} queued
   */
  markProcessed(authorName, booksFound, newBooks, queued) {
    this.state.processed_authors.push({
      name: authorName,
      books_found: booksFound,
      new_books: newBooks,
      queued: queued,
      timestamp: new Date().toISOString()
    });

    this.state.total_isbns_found += booksFound;
    this.state.total_new_isbns += newBooks;
    this.state.total_queued += queued;
    this.state.last_updated = new Date().toISOString();

    this.save();
  }

  /**
   * Mark author as failed
   * @param {string} authorName
   * @param {string} error
   */
  markFailed(authorName, error) {
    this.state.failed_authors.push({
      name: authorName,
      error: error,
      timestamp: new Date().toISOString()
    });
    this.state.last_updated = new Date().toISOString();
    this.save();
  }

  /**
   * Check if author has been processed
   * @param {string} authorName
   * @returns {boolean}
   */
  isProcessed(authorName) {
    return this.state.processed_authors.some(a => a.name === authorName);
  }

  /**
   * Check if author has failed
   * @param {string} authorName
   * @returns {boolean}
   */
  hasFailed(authorName) {
    return this.state.failed_authors.some(a => a.name === authorName);
  }

  /**
   * Get list of remaining authors to process
   * @param {Array<string>} allAuthors
   * @returns {Array<string>}
   */
  getRemaining(allAuthors) {
    return allAuthors.filter(author =>
      !this.isProcessed(author) && !this.hasFailed(author)
    );
  }

  /**
   * Initialize checkpoint with total count
   * @param {number} totalAuthors
   */
  initialize(totalAuthors) {
    this.state.total_authors = totalAuthors;
    this.save();
  }

  /**
   * Get progress summary
   * @returns {Object}
   */
  getSummary() {
    const processed = this.state.processed_authors.length;
    const failed = this.state.failed_authors.length;
    const remaining = this.state.total_authors - processed - failed;

    return {
      total: this.state.total_authors,
      processed,
      failed,
      remaining,
      total_isbns_found: this.state.total_isbns_found,
      total_new_isbns: this.state.total_new_isbns,
      total_queued: this.state.total_queued,
      started_at: this.state.started_at,
      last_updated: this.state.last_updated
    };
  }

  /**
   * Reset checkpoint (start fresh)
   */
  reset() {
    this.state = this.getDefaultState();
    this.save();
  }
}
