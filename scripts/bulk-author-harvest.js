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
 * Features:
 * - Quota coordination via Alexandria Worker's /api/quota/status endpoint
 * - Checkpoint saving for resume capability
 * - Progress logging with quota status every 100 authors
 *
 * Usage:
 *   # Check current quota status only (no processing)
 *   node bulk-author-harvest.js --check-quota
 *
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
  DELAY_MS: 6000, // 6s between authors (Worker rate limit: 10 req/min for heavy endpoints)
  MAX_PAGES: 1, // Breadth-first: 1 page = 100 books per author
  DAILY_QUOTA: 15000, // ISBNdb Premium daily limit
  // Cloudflare Access Service Token (from environment or empty)
  CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID || '',
  CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET || '',
};

/**
 * Get headers for Alexandria API requests with Cloudflare Access authentication
 */
function getAuthHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Add Cloudflare Access service token if available
  if (CONFIG.CF_ACCESS_CLIENT_ID && CONFIG.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = CONFIG.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = CONFIG.CF_ACCESS_CLIENT_SECRET;
  }

  return headers;
}

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
 * Fetch quota status from Alexandria Worker
 */
async function getQuotaStatus() {
  // Add 10 second timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${CONFIG.ALEXANDRIA_URL}/api/quota/status`, {
      headers: getAuthHeaders(),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Failed to fetch quota status: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.data || null; // Response is wrapped in success envelope
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      console.error('Quota status request timeout after 10 seconds');
      return null;
    }
    console.error(`Error fetching quota status: ${error.message}`);
    return null;
  }
}

/**
 * Format quota status for display
 */
function formatQuotaStatus(quota) {
  if (!quota) return 'Unable to fetch quota status';

  const used = quota.used || 0;
  const remaining = quota.remaining || 0;
  const safetyRemaining = quota.safety_remaining || 0;
  const limit = quota.daily_limit || 15000;
  const percentageUsed = quota.percentage_used || 0;
  const canMakeCalls = quota.can_make_calls !== false;
  const resetAt = quota.reset_at ? new Date(quota.reset_at).toLocaleString() : 'Unknown';

  const status = canMakeCalls ? '✓ CALLS AVAILABLE' : '✗ QUOTA EXHAUSTED';

  return `
  Status: ${status}
  Used: ${used.toLocaleString()} / ${limit.toLocaleString()} calls
  Remaining: ${remaining.toLocaleString()} calls
  Safety Threshold: ${safetyRemaining.toLocaleString()} calls available
  Usage: ${percentageUsed}% of safety limit
  Reset Time: ${resetAt}`;
}

/**
 * Query authors sorted by work count via Alexandria API
 * Note: Work count is used as a faster proxy for popularity (edition count query was too slow)
 */
async function getTopAuthors(offset, limit) {
  console.log(`Querying authors by work count (offset: ${offset}, limit: ${limit})...`);

  // Add 30 second timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${CONFIG.ALEXANDRIA_URL}/api/authors/top?offset=${offset}&limit=${limit}`, {
      headers: getAuthHeaders(),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`API error: ${error.error || error.message}`);
    }

    const data = await response.json();
    console.log(`Query completed in ${data.query_duration_ms}ms`);
    return data.authors || [];
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout after 30 seconds');
    }
    throw error;
  }
}

/**
 * Enrich author bibliography via Alexandria API
 */
async function enrichAuthorBibliography(authorName, maxPages = 1, editionCount = 0) {
  // Dynamic timeout based on author size
  // Small authors (<100): 30s, Medium (100-500): 60s, Large (500-1000): 90s, Mega (1000+): 120s
  const timeoutMs = editionCount > 1000 ? 120000
                  : editionCount > 500  ? 90000
                  : editionCount > 100  ? 60000
                  : 30000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${CONFIG.ALEXANDRIA_URL}/api/authors/enrich-bibliography`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        author_name: authorName,
        max_pages: maxPages
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

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
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return { error: 'timeout', books_found: 0 };
    }
    throw error;
  }
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
    const response = await fetch(`${CONFIG.ALEXANDRIA_URL}/api/queue/status`, {
      headers: getAuthHeaders()
    });
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
      'check-quota': { type: 'boolean', default: false },
    }
  });

  console.log('\n=== Alexandria Bulk Author Harvesting ===\n');

  // Check quota mode - show status and exit
  if (args['check-quota']) {
    console.log('Checking ISBNdb API quota status...\n');
    const quota = await getQuotaStatus();
    console.log(formatQuotaStatus(quota));
    console.log('');
    process.exit(quota?.can_make_calls ? 0 : 1);
  }

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

  // Check quota before starting
  console.log('\nChecking ISBNdb API quota...');
  const initialQuota = await getQuotaStatus();
  if (!initialQuota) {
    console.warn('\n⚠️  Warning: Could not check quota (network error)');
    console.warn('Proceeding with caution - monitor quota manually');
    console.warn('Check quota at: https://alexandria.ooheynerds.com/api/quota/status\n');
  } else if (!initialQuota.can_make_calls) {
    console.log('\nQuota Status:');
    console.log(formatQuotaStatus(initialQuota));
    console.log('\n⚠️  ISBNdb quota ACTUALLY exhausted!');
    console.log(`Used: ${initialQuota.used}/${initialQuota.daily_limit}`);
    console.log('Retry tomorrow after quota resets.');
    process.exit(2); // Exit code 2 = quota exhaustion
  } else {
    console.log(formatQuotaStatus(initialQuota));
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

  console.log('\nStarting enrichment...\n');

  for (let i = 0; i < remaining.length; i++) {
    const author = remaining[i];
    const progress = `[${i + 1}/${remaining.length}]`;

    // Check quota every 100 authors (or at the start)
    if (i > 0 && i % 100 === 0) {
      console.log(`\n--- Quota check at author ${i + 1} ---`);
      const currentQuota = await getQuotaStatus();

      if (!currentQuota) {
        // Network error - log warning but CONTINUE harvest
        console.warn('⚠️  Warning: Could not check quota (network error)');
        console.warn('Continuing harvest - monitor quota manually at:');
        console.warn('https://alexandria.ooheynerds.com/api/quota/status\n');
      } else {
        console.log(formatQuotaStatus(currentQuota));

        if (!currentQuota.can_make_calls) {
          // ACTUAL quota exhaustion - stop safely
          console.log(`\n⚠️  ISBNdb quota ACTUALLY exhausted!`);
          console.log(`Used: ${currentQuota.used}/${currentQuota.daily_limit}`);
          console.log('Resume tomorrow with: node bulk-author-harvest.js --resume');

          // Save checkpoint before exiting
          saveCheckpoint(checkpoint);
          console.log(`Checkpoint saved to: ${CONFIG.CHECKPOINT_FILE}`);

          process.exit(2); // Exit code 2 = quota exhaustion
        }

        console.log(`--- Continuing with ${remaining.length - i} remaining authors ---\n`);
      }
    }

    try {
      console.log(`${progress} Processing: ${author.author_name} (${author.edition_count} editions)...`);

      const result = await enrichAuthorBibliography(author.author_name, maxPages, author.edition_count);

      if (result.error === 'quota_exhausted') {
        console.log(`\n⚠️  ISBNdb quota exhausted! Stopping after ${i} authors.`);
        console.log('Resume tomorrow with: node bulk-author-harvest.js --resume');

        // Save checkpoint before exiting
        saveCheckpoint(checkpoint);
        console.log(`Checkpoint saved to: ${CONFIG.CHECKPOINT_FILE}`);

        process.exit(2); // Exit code 2 = quota exhaustion
      }

      if (result.error) {
        console.log(`  ❌ Error: ${result.error}`);
        checkpoint.failed.push({ name: author.author_name, error: result.error });
      } else {
        const status = result.cached ? '📦 CACHED' : '✅ ENRICHED';
        console.log(`  ${status}: ${result.books_found || 0} books, ${result.enriched || 0} new, ${result.covers_queued || 0} covers`);

        checkpoint.processed.push(author.author_name);
        checkpoint.stats.books_found += result.books_found || 0;
        checkpoint.stats.enriched += result.enriched || 0;  // FIX: Use 'enriched', not 'newly_enriched'
        checkpoint.stats.covers_queued += result.covers_queued || 0;
        if (result.cached) checkpoint.stats.cache_hits++;
      }

      // Save checkpoint every 5 authors (more frequent for better crash recovery)
      if (i % 5 === 0 || i === 1) {
        saveCheckpoint(checkpoint);
        console.log(`📝 Checkpoint saved (${checkpoint.processed.length + checkpoint.failed.length}/${authors.length})`);
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
