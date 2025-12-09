/**
 * CSV Reader for Alexandria Queue Seeding
 * Handles both CSV schemas used in csv_examples/
 */

import fs from 'fs/promises';
import { parse } from 'csv-parse/sync';

/**
 * Read and parse a CSV file with book data
 * Normalizes column names to handle both CSV schemas:
 * - Schema 1: year,title,author,isbn13
 * - Schema 2: Title,Author,ISBN-13
 *
 * @param {string} filePath - Absolute or relative path to CSV file
 * @returns {Promise<Array>} - Array of book objects
 */
export async function readCSV(filePath) {
  const content = await fs.readFile(filePath, 'utf8');

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  // Normalize column names (handle both schemas)
  return records.map(row => ({
    title: row.Title || row.title,
    author: row.Author || row.author,
    isbn: row['ISBN-13'] || row.isbn13,
    year: row.year
  }));
}
