#!/usr/bin/env node

/**
 * Alexandria Author Bibliography Expansion
 * Expand dataset by finding complete bibliographies for all CSV authors
 *
 * EFFICIENT VERSION: Uses /api/authors/enrich-bibliography endpoint which
 * fetches AND enriches in one step (no double-fetch of ISBNdb data!)
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
import { ProgressTracker } from './lib/progress-tracker.js';

// Sleep utility for rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  // Parse CLI arguments
  const { values: args } = parseArgs({
    options: {
      csv: { type: 'string', short: 'c' },
      checkpoint: { type: 'string', default: 'data/author-expansion-checkpoint.json' },
      resume: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      author: { type: 'string' }, // Process single author
      'max-pages': { type: 'string', default: '10' }
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

  // 3. Process each author using EFFICIENT endpoint (fetch + enrich in one call)
  tracker.phase(`Processing ${remainingAuthors.length} authors` + (args['dry-run'] ? ' (DRY RUN)' : ''));
  tracker.log('Using efficient /api/authors/enrich-bibliography endpoint (no double-fetch!)');

  const authorBar = tracker.createProgressBar(remainingAuthors.length);
  const maxPages = parseInt(args['max-pages']);

  let totalBooksFound = 0;
  let totalNewlyEnriched = 0;
  let totalCoversQueued = 0;
  let totalCacheHits = 0;

  for (const authorName of remainingAuthors) {
    try {
      if (args['dry-run']) {
        // Dry run: just fetch bibliography to see what would be processed
        const books = await isbndbClient.getAuthorBibliography(authorName, maxPages);
        totalBooksFound += books.length;
        checkpoint.markProcessed(authorName, books.length, 0, 0);
        authorBar.increment();
        await sleep(2000);
        continue;
      }

      // EFFICIENT: Fetch AND enrich in ONE API call (no double-fetch!)
      const result = await isbndbClient.enrichAuthorBibliography(authorName, maxPages);

      // Check for errors
      if (result.error) {
        if (result.error === 'quota_exhausted') {
          tracker.log(`ISBNdb quota exhausted! Stopping...`);
          checkpoint.markFailed(authorName, 'quota_exhausted');
          break; // Stop processing - no point continuing without API quota
        }
        checkpoint.markFailed(authorName, result.error);
        authorBar.increment();
        await sleep(2000);
        continue;
      }

      // Track totals
      totalBooksFound += result.books_found || 0;
      totalNewlyEnriched += result.newly_enriched || 0;
      totalCoversQueued += result.covers_queued || 0;
      if (result.cached) totalCacheHits++;

      // Update checkpoint with new format
      checkpoint.markProcessed(
        authorName,
        result.books_found || 0,
        result.newly_enriched || 0,
        result.covers_queued || 0
      );

      authorBar.increment();

      // Rate limit: Wait between authors
      // ISBNdb Premium is 3 req/sec, but author bibliographies can span multiple pages
      // 1.5s delay is safe for typical 1-2 page bibliographies
      await sleep(1500);
    } catch (error) {
      console.error(`Error processing ${authorName}:`, error.message);
      checkpoint.markFailed(authorName, error.message);
      authorBar.increment();

      // Still wait after errors to avoid rapid retries
      await sleep(2000);
    }
  }

  authorBar.stop();

  // 4. Summary
  const summary = checkpoint.getSummary();
  await tracker.complete({
    ...summary,
    total_books_found: totalBooksFound,
    total_newly_enriched: totalNewlyEnriched,
    total_covers_queued: totalCoversQueued,
    total_cache_hits: totalCacheHits,
    dry_run: args['dry-run']
  });

  tracker.log('\n=== Efficiency Report ===');
  tracker.log(`Books found: ${totalBooksFound.toLocaleString()}`);
  tracker.log(`Newly enriched: ${totalNewlyEnriched.toLocaleString()}`);
  tracker.log(`Covers queued: ${totalCoversQueued.toLocaleString()}`);
  tracker.log(`Cache hits: ${totalCacheHits}`);
  tracker.log('Using efficient single-call endpoint (no double-fetch!)');

  await dbClient.close();
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
