#!/usr/bin/env node

/**
 * E2E Author Enrichment Test
 *
 * Tests the full pipeline:
 * 1. Get bibliographies for N authors from ISBNdb
 * 2. Queue ISBNs for enrichment
 * 3. Wait for queue processing
 * 4. Verify enriched data in database
 */

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { execSync } from 'node:child_process';

const API_BASE = 'https://alexandria.ooheynerds.com';

// Use SSH to query database (tunnel not accessible directly from local)
function queryDB(sql) {
  const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const cmd = `ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -t -c \\"${escaped}\\""`;
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (e) {
    console.error('DB query failed:', e.message);
    return null;
  }
}

// Config
const NUM_AUTHORS = parseInt(process.argv[2]) || 50;
const POLL_INTERVAL_MS = 10000; // 10 seconds
const MAX_WAIT_MS = 600000; // 10 minutes

async function main() {
  console.log(`\n========================================`);
  console.log(`  E2E Author Enrichment Test`);
  console.log(`  Authors: ${NUM_AUTHORS}`);
  console.log(`========================================\n`);

  // 1. Extract unique authors from CSV
  console.log(`[1/5] Extracting authors from CSV...`);
  const csvPath = new URL('../docs/csv_examples/combined_library_expanded.csv', import.meta.url).pathname;
  const csvContent = readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

  const authorSet = new Set();
  for (const record of records) {
    const author = record.Author || record.author;
    if (author && author.trim() && !author.includes('&')) { // Skip co-authors for simplicity
      authorSet.add(author.trim());
    }
  }

  const allAuthors = Array.from(authorSet).slice(0, NUM_AUTHORS);
  console.log(`   Found ${allAuthors.length} unique authors\n`);

  // 2. Get bibliographies from ISBNdb via Alexandria API
  console.log(`[2/5] Fetching bibliographies from ISBNdb...`);
  const allBooks = [];
  const authorStats = [];

  for (let i = 0; i < allAuthors.length; i++) {
    const author = allAuthors[i];
    process.stdout.write(`   [${i + 1}/${allAuthors.length}] ${author.padEnd(30)}... `);

    try {
      const response = await fetch(`${API_BASE}/api/authors/bibliography`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author_name: author, max_pages: 2 }) // 2 pages = up to 200 books
      });

      if (!response.ok) {
        console.log(`ERROR: ${response.status}`);
        authorStats.push({ author, books: 0, error: response.status });
        continue;
      }

      const data = await response.json();
      const books = data.books || [];
      console.log(`${books.length} books`);

      authorStats.push({ author, books: books.length });
      allBooks.push(...books);

      // Rate limit: 1 req/sec for ISBNdb
      await sleep(1100);
    } catch (error) {
      console.log(`ERROR: ${error.message}`);
      authorStats.push({ author, books: 0, error: error.message });
    }
  }

  // Dedupe by ISBN
  const uniqueBooks = new Map();
  for (const book of allBooks) {
    if (book.isbn && !uniqueBooks.has(book.isbn)) {
      uniqueBooks.set(book.isbn, book);
    }
  }

  const booksToQueue = Array.from(uniqueBooks.values());
  console.log(`\n   Total: ${allBooks.length} books found, ${booksToQueue.length} unique ISBNs\n`);

  // 3. Get baseline counts from database
  console.log(`[3/5] Getting baseline counts from database...`);

  const baselineResult = queryDB(`SELECT (SELECT COUNT(*) FROM enriched_editions) as editions, (SELECT COUNT(*) FROM enriched_works) as works, (SELECT COUNT(*) FROM enriched_authors) as authors`);
  const [editions, works, authors] = baselineResult.split('|').map(s => parseInt(s.trim()));
  const baseline = { editions, works, authors };
  console.log(`   Baseline: ${baseline.editions} editions, ${baseline.works} works, ${baseline.authors} authors\n`);

  // 4. Queue books for enrichment
  console.log(`[4/5] Queueing ${booksToQueue.length} ISBNs for enrichment...`);

  const BATCH_SIZE = 100;
  let totalQueued = 0;
  let totalFailed = 0;

  for (let i = 0; i < booksToQueue.length; i += BATCH_SIZE) {
    const batch = booksToQueue.slice(i, i + BATCH_SIZE);
    process.stdout.write(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(booksToQueue.length / BATCH_SIZE)}... `);

    try {
      const response = await fetch(`${API_BASE}/api/enrich/queue/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          books: batch.map(b => ({
            isbn: b.isbn,
            title: b.title,
            author: b.author,
            priority: 'normal',
            source: 'e2e_test'
          }))
        })
      });

      const result = await response.json();
      totalQueued += result.queued || 0;
      totalFailed += result.failed || 0;
      console.log(`queued: ${result.queued}, failed: ${result.failed}`);

      await sleep(100);
    } catch (error) {
      console.log(`ERROR: ${error.message}`);
    }
  }

  console.log(`\n   Total queued: ${totalQueued}, failed: ${totalFailed}\n`);

  // 5. Monitor queue processing
  console.log(`[5/5] Monitoring queue processing (max ${MAX_WAIT_MS / 60000} minutes)...`);

  const startTime = Date.now();
  let lastEditions = baseline.editions;
  let lastWorks = baseline.works;
  let stableCount = 0;

  while (Date.now() - startTime < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const currentResult = queryDB(`SELECT (SELECT COUNT(*) FROM enriched_editions) as editions, (SELECT COUNT(*) FROM enriched_works) as works, (SELECT COUNT(*) FROM enriched_editions WHERE created_at > NOW() - INTERVAL '10 minutes') as recent`);
    if (!currentResult) continue;

    const [currEditions, currWorks, recent] = currentResult.split('|').map(s => parseInt(s.trim()));

    const newEditions = currEditions - baseline.editions;
    const newWorks = currWorks - baseline.works;
    const deltaEditions = currEditions - lastEditions;
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);

    console.log(`   [${elapsedSec}s] +${newEditions} editions, +${newWorks} works (delta: ${deltaEditions}/10s, recent: ${recent})`);

    // Check if processing has stabilized
    if (deltaEditions === 0 && recent === 0) {
      stableCount++;
      if (stableCount >= 3) {
        console.log(`\n   Processing appears complete (stable for 30s)\n`);
        break;
      }
    } else {
      stableCount = 0;
    }

    lastEditions = currEditions;
    lastWorks = currWorks;
  }

  // 6. Final verification
  console.log(`========================================`);
  console.log(`  FINAL RESULTS`);
  console.log(`========================================\n`);

  const finalResult = queryDB(`SELECT (SELECT COUNT(*) FROM enriched_editions) as editions, (SELECT COUNT(*) FROM enriched_works) as works, (SELECT COUNT(*) FROM enriched_authors) as authors`);
  const [finalEditions, finalWorks, finalAuthors] = finalResult.split('|').map(s => parseInt(s.trim()));

  const newEditions = finalEditions - baseline.editions;
  const newWorks = finalWorks - baseline.works;
  const newAuthors = finalAuthors - baseline.authors;

  console.log(`  Authors processed:     ${allAuthors.length}`);
  console.log(`  ISBNs found:           ${booksToQueue.length}`);
  console.log(`  ISBNs queued:          ${totalQueued}`);
  console.log(`  ---`);
  console.log(`  New editions:          ${newEditions}`);
  console.log(`  New works:             ${newWorks}`);
  console.log(`  New authors:           ${newAuthors}`);
  console.log(`  ---`);
  console.log(`  Success rate:          ${totalQueued > 0 ? ((newEditions / totalQueued) * 100).toFixed(1) : 0}%`);
  console.log(`\n========================================\n`);

  // Sample some enriched data
  console.log(`Sample enriched editions (newest):\n`);
  const samplesRaw = queryDB(`SELECT title, COALESCE(array_to_string(related_isbns[1:2], ', '), 'none') as isbns, source_provider FROM enriched_editions ORDER BY created_at DESC LIMIT 5`);
  if (samplesRaw) {
    const lines = samplesRaw.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim());
      console.log(`  - ${parts[0]?.substring(0, 50)}...`);
      console.log(`    ISBNs: ${parts[1]}, Provider: ${parts[2]}`);
    }
  }

  console.log(`\nDone!`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
