#!/usr/bin/env node

/**
 * Alexandria Queue Seeder
 * Batch queue enrichment and cover processing jobs from CSV files
 *
 * Usage:
 *   node seed-queues.js --all --csv docs/csv_examples/combined_library_expanded.csv
 *   node seed-queues.js --enrich --csv docs/csv_examples/2024.csv
 *   node seed-queues.js --covers --csv docs/csv_examples/2024.csv
 *   node seed-queues.js --all --dry-run --csv docs/csv_examples/2025.csv
 */

import { parseArgs } from 'node:util';
import { readCSV } from './lib/csv-reader.js';
import { validateISBNs } from './lib/isbn-validator.js';
import { processBatches } from './lib/batch-processor.js';
import { QueueClient } from './lib/queue-client.js';
import { ProgressTracker } from './lib/progress-tracker.js';

async function main() {
  // Parse CLI arguments
  const { values: args } = parseArgs({
    options: {
      csv: { type: 'string', short: 'c' },
      enrich: { type: 'boolean', default: false },
      covers: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      priority: { type: 'string', default: 'normal' }
    }
  });

  // Validation
  if (!args.csv) {
    console.error('Error: --csv required');
    console.error('\nUsage:');
    console.error('  node seed-queues.js --all --csv docs/csv_examples/combined_library_expanded.csv');
    console.error('  node seed-queues.js --enrich --csv docs/csv_examples/2024.csv');
    console.error('  node seed-queues.js --covers --csv docs/csv_examples/2024.csv');
    console.error('  node seed-queues.js --all --dry-run --csv docs/csv_examples/2025.csv');
    process.exit(1);
  }

  const doEnrich = args.all || args.enrich;
  const doCovers = args.all || args.covers;

  if (!doEnrich && !doCovers) {
    console.error('Error: Specify --enrich, --covers, or --all');
    process.exit(1);
  }

  // Initialize
  const tracker = new ProgressTracker();
  const client = new QueueClient('https://alexandria.ooheynerds.com');

  tracker.start('Alexandria Queue Seeder');

  // 1. Read CSV
  tracker.phase('Reading CSV');
  const books = await readCSV(args.csv);
  tracker.log(`Found ${books.length} books`);

  // 2. Validate ISBNs
  tracker.phase('Validating ISBNs');
  const { valid, invalid } = validateISBNs(books);
  tracker.log(`Validated ${valid.length} ISBNs (${invalid.length} invalid)`);

  const toProcess = valid;

  // 3. Queue enrichment
  let enriched = 0;
  if (doEnrich) {
    tracker.phase('Queuing enrichment jobs' + (args['dry-run'] ? ' (DRY RUN)' : ''));

    if (!args['dry-run']) {
      enriched = await processBatches(toProcess, {
        endpoint: '/api/enrich/queue/batch',
        batchSize: 100,
        client,
        tracker,
        priority: args.priority
      });
      tracker.log(`Queued ${enriched} enrichment jobs`);
    } else {
      const batches = Math.ceil(toProcess.length / 100);
      tracker.log(`Would queue ${toProcess.length} ISBNs in ${batches} batches`);
    }
  }

  // 4. Queue covers
  let covered = 0;
  if (doCovers) {
    tracker.phase('Queuing cover jobs' + (args['dry-run'] ? ' (DRY RUN)' : ''));

    if (!args['dry-run']) {
      covered = await processBatches(toProcess, {
        endpoint: '/api/covers/queue',
        batchSize: 20,
        client,
        tracker,
        priority: args.priority
      });
      tracker.log(`Queued ${covered} cover jobs`);
    } else {
      const batches = Math.ceil(toProcess.length / 20);
      tracker.log(`Would queue ${toProcess.length} ISBNs in ${batches} batches`);
    }
  }

  // 5. Summary
  await tracker.complete({
    total: books.length,
    valid: valid.length,
    invalid: invalid.length,
    processed: args['dry-run'] ? 0 : toProcess.length,
    skipped: 0,
    dry_run: args['dry-run']
  });
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
