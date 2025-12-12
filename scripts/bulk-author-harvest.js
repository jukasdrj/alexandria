#!/usr/bin/env node

/**
 * Alexandria Bulk Author Harvesting Script
 *
 * Harvests author bibliographies from ISBNdb Premium API to enrich Alexandria.
 * Based on consensus analysis recommending:
 * - Prioritize by EDITION COUNT (not work count) for better ISBNdb coverage
 * - Breadth-first: 1 page (100 books) per author initially
 * - Rate limit: 3 req/sec with 350ms delay between requests
 * - Monitor queue processing to stay under 2-hour image expiry
 *
 * Usage:
 *   # Dry run - query for top authors, don't call ISBNdb
 *   node bulk-author-harvest.js --dry-run --tier top-1000
 *
 *   # Process top 100 authors as validation run
 *   node bulk-author-harvest.js --tier top-100
 *
 *   # Process specific tier
 *   node bulk-author-harvest.js --tier top-1000
 *   node bulk-author-harvest.js --tier 1000-5000
 *   node bulk-author-harvest.js --tier 5000-20000
 *
 *   # Resume from checkpoint
 *   node bulk-author-harvest.js --resume
 *
 *   # Process single author
 *   node bulk-author-harvest.js --author "Brandon Sanderson"
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Configuration
const CONFIG = {
  ALEXANDRIA_URL: 'https://alexandria.ooheynerds.com',
  CHECKPOINT_FILE: 'data/bulk-author-checkpoint.json',
  DELAY_MS: 1500, // 1.5s between authors (safe for 3 req/sec)
  MAX_PAGES: 1, // Breadth-first: 1 page = 100 books per author
  DAILY_QUOTA: 15000, // ISBNdb Premium daily limit
};

// Tier definitions based on edition count
const TIERS = {
  'top-100': { offset: 0, limit: 100 },
  'top-1000': { offset: 0, limit: 1000 },
  '1000-5000': { offset: 1000, limit: 4000 },
  '5000-20000': { offset: 5000, limit: 15000 },
  'all': { offset: 0, limit: 100000 },
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Query authors sorted by work count via Alexandria API
 * Note: Work count is used as a faster proxy for popularity (edition count query was too slow)
 */
async function getTopAuthors(offset, limit) {
  console.log(`Querying authors by work count (offset: ${offset}, limit: ${limit})...`);

  const response = await fetch(`${CONFIG.ALEXANDRIA_URL}/api/authors/top?offset=${offset}&limit=${limit}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`API error: ${error.error || error.message}`);
  }

  const data = await response.json();
  console.log(`Query completed in ${data.query_duration_ms}ms`);
  return data.authors || [];
}

/**
 * Enrich author bibliography via Alexandria API
 */
async function enrichAuthorBibliography(authorName, maxPages = 1) {
  const response = await fetch(`${CONFIG.ALEXANDRIA_URL}/api/authors/enrich-bibliography`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author_name: authorName,
      max_pages: maxPages
    })
  });

  if (response.status === 429) {
    return { error: 'rate_limited', books_found: 0 };
  }

  if (response.status === 403) {
    return { error: 'quota_exhausted', books_found: 0 };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    return { error: error.error || error.message, books_found: 0 };
  }

  return await response.json();
}

/**
 * Load checkpoint file
 */
function loadCheckpoint() {
  if (!existsSync(CONFIG.CHECKPOINT_FILE)) {
    return {
      processed: [],
      failed: [],
      stats: { books_found: 0, enriched: 0, covers_queued: 0 },
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString()
    };
  }
  return JSON.parse(readFileSync(CONFIG.CHECKPOINT_FILE, 'utf-8'));
}

/**
 * Save checkpoint file
 */
function saveCheckpoint(checkpoint) {
  checkpoint.last_updated = new Date().toISOString();

  // Ensure data directory exists
  const dir = dirname(CONFIG.CHECKPOINT_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(CONFIG.CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

/**
 * Check queue status
 */
async function checkQueueStatus() {
  try {
    const response = await fetch(`${CONFIG.ALEXANDRIA_URL}/api/queue/status`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    // Queue status endpoint may not exist
  }
  return null;
}

/**
 * Main execution
 */
async function main() {
  const { values: args } = parseArgs({
    options: {
      tier: { type: 'string', default: 'top-100' },
      author: { type: 'string' },
      resume: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'max-pages': { type: 'string', default: '1' },
    }
  });

  console.log('\n=== Alexandria Bulk Author Harvesting ===\n');
  console.log('Strategy: Work count prioritization (proxy for popularity)');
  console.log('Approach: Breadth-first (1 page per author)');
  console.log(`Tier: ${args.tier}`);
  console.log(`Max pages per author: ${args['max-pages']}`);
  console.log(`Dry run: ${args['dry-run']}`);
  console.log('');

  // Single author mode
  if (args.author) {
    console.log(`Processing single author: ${args.author}`);
    if (!args['dry-run']) {
      const result = await enrichAuthorBibliography(args.author, parseInt(args['max-pages']));
      console.log('Result:', JSON.stringify(result, null, 2));
    }
    return;
  }

  // Get tier configuration
  const tier = TIERS[args.tier];
  if (!tier) {
    console.error(`Unknown tier: ${args.tier}`);
    console.error('Available tiers:', Object.keys(TIERS).join(', '));
    process.exit(1);
  }

  // Query authors by work count via Alexandria API
  const authors = await getTopAuthors(tier.offset, tier.limit);
  console.log(`Found ${authors.length} authors in tier "${args.tier}"`);

  if (authors.length === 0) {
    console.log('No authors found!');
    return;
  }

  // Show sample authors
  console.log('\nTop 10 authors in this tier:');
  authors.slice(0, 10).forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.author_name} (${a.work_count} works)`);
  });

  if (args['dry-run']) {
    console.log('\n[DRY RUN] Would process these authors. Run without --dry-run to proceed.');

    // Show tier statistics
    const totalWorks = authors.reduce((sum, a) => sum + parseInt(a.work_count), 0);
    const avgWorks = Math.round(totalWorks / authors.length);
    console.log(`\nTier statistics:`);
    console.log(`  Total authors: ${authors.length}`);
    console.log(`  Total works: ${totalWorks.toLocaleString()}`);
    console.log(`  Average works/author: ${avgWorks}`);
    console.log(`  Estimated API calls: ${authors.length} (1 page each)`);
    console.log(`  Days to complete: ${Math.ceil(authors.length / CONFIG.DAILY_QUOTA)}`);
    return;
  }

  // Load checkpoint
  const checkpoint = args.resume ? loadCheckpoint() : {
    processed: [],
    failed: [],
    stats: { books_found: 0, enriched: 0, covers_queued: 0, cache_hits: 0 },
    started_at: new Date().toISOString(),
    last_updated: new Date().toISOString()
  };

  // Filter out already processed authors
  const processedSet = new Set(checkpoint.processed);
  const remaining = authors.filter(a => !processedSet.has(a.author_name));

  console.log(`\nRemaining to process: ${remaining.length} authors`);
  console.log(`Already processed: ${checkpoint.processed.length}`);

  if (remaining.length === 0) {
    console.log('All authors already processed!');
    return;
  }

  // Process authors
  const maxPages = parseInt(args['max-pages']);
  let apiCallsToday = checkpoint.processed.length;

  console.log('\nStarting enrichment...\n');

  for (let i = 0; i < remaining.length; i++) {
    const author = remaining[i];
    const progress = `[${i + 1}/${remaining.length}]`;

    // Check daily quota
    if (apiCallsToday >= CONFIG.DAILY_QUOTA) {
      console.log(`\n⚠️  Daily quota reached (${CONFIG.DAILY_QUOTA} calls). Stopping.`);
      console.log('Resume tomorrow with: node bulk-author-harvest.js --resume');
      break;
    }

    try {
      console.log(`${progress} Processing: ${author.author_name} (${author.work_count} works)...`);

      const result = await enrichAuthorBibliography(author.author_name, maxPages);

      if (result.error === 'quota_exhausted') {
        console.log(`\n⚠️  ISBNdb quota exhausted! Stopping.`);
        console.log('Resume tomorrow with: node bulk-author-harvest.js --resume');
        break;
      }

      if (result.error) {
        console.log(`  ❌ Error: ${result.error}`);
        checkpoint.failed.push({ name: author.author_name, error: result.error });
      } else {
        const status = result.cached ? '📦 CACHED' : '✅ ENRICHED';
        console.log(`  ${status}: ${result.books_found || 0} books, ${result.newly_enriched || 0} new, ${result.covers_queued || 0} covers`);

        checkpoint.processed.push(author.author_name);
        checkpoint.stats.books_found += result.books_found || 0;
        checkpoint.stats.enriched += result.newly_enriched || 0;
        checkpoint.stats.covers_queued += result.covers_queued || 0;
        if (result.cached) checkpoint.stats.cache_hits++;
      }

      apiCallsToday++;

      // Save checkpoint every 10 authors
      if (i % 10 === 0) {
        saveCheckpoint(checkpoint);
      }

      // Rate limit
      if (i < remaining.length - 1) {
        await sleep(CONFIG.DELAY_MS);
      }

    } catch (error) {
      console.log(`  ❌ Exception: ${error.message}`);
      checkpoint.failed.push({ name: author.author_name, error: error.message });
    }
  }

  // Final checkpoint save
  saveCheckpoint(checkpoint);

  // Summary
  console.log('\n=== Harvesting Complete ===\n');
  console.log(`Authors processed: ${checkpoint.processed.length}`);
  console.log(`Authors failed: ${checkpoint.failed.length}`);
  console.log(`Cache hits: ${checkpoint.stats.cache_hits}`);
  console.log(`Total books found: ${checkpoint.stats.books_found.toLocaleString()}`);
  console.log(`Newly enriched: ${checkpoint.stats.enriched.toLocaleString()}`);
  console.log(`Covers queued: ${checkpoint.stats.covers_queued.toLocaleString()}`);
  console.log(`\nCheckpoint saved to: ${CONFIG.CHECKPOINT_FILE}`);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
