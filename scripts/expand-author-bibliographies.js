#!/usr/bin/env node

/**
 * Alexandria Author Bibliography Expansion
 * Expand dataset by finding complete bibliographies for all CSV authors
 *
 * Usage:
 *   node expand-author-bibliographies.js --csv docs/csv_examples/combined_library_expanded.csv
 *   node expand-author-bibliographies.js --csv docs/csv_examples/combined_library_expanded.csv --dry-run
 *   node expand-author-bibliographies.js --resume --checkpoint data/author-expansion-checkpoint.json
 *   node expand-author-bibliographies.js --csv docs/csv_examples/combined_library_expanded.csv --author "J.K. Rowling"
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { ISBNdbClient } from './lib/isbndb-client.js';
import { CheckpointManager } from './lib/checkpoint-manager.js';
import { DatabaseClient } from './lib/db-client.js';
import { validateISBNs } from './lib/isbn-validator.js';
import { processBatches } from './lib/batch-processor.js';
import { QueueClient } from './lib/queue-client.js';
import { ProgressTracker } from './lib/progress-tracker.js';

async function main() {
  // Parse CLI arguments
  const { values: args } = parseArgs({
    options: {
      csv: { type: 'string', short: 'c' },
      checkpoint: { type: 'string', default: 'data/author-expansion-checkpoint.json' },
      resume: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      author: { type: 'string' }, // Process single author
      'max-pages': { type: 'string', default: '10' },
      priority: { type: 'string', default: 'low' }
    }
  });

  // Validation
  if (!args.resume && !args.csv) {
    console.error('Error: --csv required (or --resume to continue from checkpoint)');
    console.error('\nUsage:');
    console.error('  node expand-author-bibliographies.js --csv docs/csv_examples/combined_library_expanded.csv');
    console.error('  node expand-author-bibliographies.js --resume --checkpoint data/author-expansion-checkpoint.json');
    console.error('  node expand-author-bibliographies.js --csv docs/csv_examples/combined_library_expanded.csv --author "J.K. Rowling"');
    process.exit(1);
  }

  // Initialize
  const tracker = new ProgressTracker();
  const checkpoint = new CheckpointManager(args.checkpoint);
  const isbndbClient = new ISBNdbClient('https://alexandria.ooheynerds.com');
  const dbClient = new DatabaseClient('https://alexandria.ooheynerds.com');
  const queueClient = new QueueClient('https://alexandria.ooheynerds.com');

  tracker.start('Alexandria Author Bibliography Expansion');

  // 1. Extract unique authors from CSV
  let allAuthors = [];

  if (args.csv) {
    tracker.phase('Extracting authors from CSV');
    const csvContent = readFileSync(args.csv, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    // Extract unique authors
    const authorSet = new Set();
    for (const record of records) {
      const author = record.Author || record.author;
      if (author && author.trim()) {
        authorSet.add(author.trim());
      }
    }
    allAuthors = Array.from(authorSet).sort();
    tracker.log(`Found ${allAuthors.length} unique authors`);
  }

  // If specific author requested, filter
  if (args.author) {
    allAuthors = allAuthors.filter(a => a.toLowerCase().includes(args.author.toLowerCase()));
    tracker.log(`Filtered to ${allAuthors.length} author(s) matching "${args.author}"`);
  }

  // Initialize checkpoint
  if (!args.resume) {
    checkpoint.initialize(allAuthors.length);
  }

  // Get remaining authors (skip already processed)
  const remainingAuthors = checkpoint.getRemaining(allAuthors);
  tracker.log(`${remainingAuthors.length} authors remaining to process`);

  if (remainingAuthors.length === 0) {
    tracker.log('All authors already processed!');
    await tracker.complete(checkpoint.getSummary());
    await dbClient.close();
    return;
  }

  // 2. Get database stats
  tracker.phase('Checking database');
  const dbStats = await dbClient.getStats();
  tracker.log(`Database: ${dbStats.enriched_editions.toLocaleString()} enriched editions`);

  // 3. Process each author
  tracker.phase(`Processing ${remainingAuthors.length} authors` + (args['dry-run'] ? ' (DRY RUN)' : ''));

  const authorBar = tracker.createProgressBar(remainingAuthors.length);
  const maxPages = parseInt(args['max-pages']);

  let totalBooksFound = 0;
  let totalNewBooks = 0;
  let totalQueued = 0;

  for (const authorName of remainingAuthors) {
    try {
      // 3a. Query ISBNdb for author bibliography
      const books = await isbndbClient.getAuthorBibliography(authorName, maxPages);
      totalBooksFound += books.length;

      if (books.length === 0) {
        checkpoint.markProcessed(authorName, 0, 0, 0);
        authorBar.increment();
        continue;
      }

      // 3b. Validate and normalize ISBNs
      const { valid } = validateISBNs(books);

      // 3c. Filter out books that already exist in database
      const newBooks = args['dry-run'] ? valid : await dbClient.filterNewBooks(valid);
      totalNewBooks += newBooks.length;

      // 3d. Queue new books for enrichment and covers
      let queued = 0;
      if (!args['dry-run'] && newBooks.length > 0) {
        // Queue enrichment
        const enrichQueued = await processBatches(newBooks, {
          endpoint: '/api/enrich/queue/batch',
          batchSize: 100,
          client: queueClient,
          tracker,
          priority: args.priority
        });

        // Queue covers
        const coverQueued = await processBatches(newBooks, {
          endpoint: '/api/covers/queue',
          batchSize: 20,
          client: queueClient,
          tracker,
          priority: args.priority
        });

        queued = Math.max(enrichQueued, coverQueued); // Should be same
        totalQueued += queued;
      }

      // Update checkpoint
      checkpoint.markProcessed(authorName, books.length, newBooks.length, queued);

      authorBar.increment();
    } catch (error) {
      console.error(`Error processing ${authorName}:`, error.message);
      checkpoint.markFailed(authorName, error.message);
      authorBar.increment();
    }
  }

  authorBar.stop();

  // 4. Summary
  const summary = checkpoint.getSummary();
  await tracker.complete({
    ...summary,
    dry_run: args['dry-run']
  });

  await dbClient.close();
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
