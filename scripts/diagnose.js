#!/usr/bin/env node
/**
 * Alexandria Component Diagnostics
 * 
 * Quick tests for individual workflow components.
 * Run specific tests to isolate issues.
 * 
 * Usage:
 *   node scripts/diagnose.js <component>
 * 
 * Components:
 *   health     - API health check
 *   db         - Database connection
 *   isbndb     - ISBNdb batch API test
 *   queue      - Queue status and test send
 *   covers     - Cover processing test
 *   search     - Search API test
 *   all        - Run all diagnostics
 */

const PRODUCTION_URL = 'https://alexandria.ooheynerds.com';
const LOCAL_URL = 'http://localhost:8787';

// Single well-known ISBN for testing
const TEST_ISBN = '9780439064873'; // Harry Potter and the Chamber of Secrets

async function fetchJSON(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    const data = await response.json().catch(() => response.text());
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// =============================================================================
// Diagnostic Functions
// =============================================================================

async function diagnoseHealth() {
  console.log('\n🏥 HEALTH CHECK\n');
  
  for (const [name, url] of [['Production', PRODUCTION_URL], ['Local', LOCAL_URL]]) {
    console.log(`${name} (${url}):`);
    const result = await fetchJSON(`${url}/health`);
    
    if (result.ok) {
      console.log(`  ✅ Status: ${result.data.status}`);
      console.log(`  📊 Database: ${result.data.database}`);
      console.log(`  🗄️  R2: ${result.data.r2_covers}`);
      console.log(`  ⏱️  Latency: ${result.data.hyperdrive_latency_ms}ms`);
    } else {
      console.log(`  ❌ Failed: ${result.error || result.status}`);
    }
    console.log();
  }
}

async function diagnoseDatabase() {
  console.log('\n🗄️  DATABASE DIAGNOSTICS\n');
  
  const result = await fetchJSON(`${PRODUCTION_URL}/api/stats`);
  
  if (result.ok) {
    console.log('Database Statistics:');
    console.log(`  📚 Editions: ${result.data.editions?.toLocaleString()}`);
    console.log(`  🔢 ISBNs: ${result.data.isbns?.toLocaleString()}`);
    console.log(`  📖 Works: ${result.data.works?.toLocaleString()}`);
    console.log(`  ✍️  Authors: ${result.data.authors?.toLocaleString()}`);
    console.log(`  🖼️  Covers: ${result.data.covers?.toLocaleString()}`);
    console.log(`  ⏱️  Query time: ${result.data.query_duration_ms}ms`);
  } else {
    console.log(`❌ Stats failed: ${result.error || result.status}`);
  }
  
  // Check enriched tables
  console.log('\nEnriched Tables Check:');
  const searchResult = await fetchJSON(`${PRODUCTION_URL}/api/search?isbn=${TEST_ISBN}`);
  
  if (searchResult.ok && searchResult.data.results?.length > 0) {
    const book = searchResult.data.results[0];
    console.log(`  ✅ Found test ISBN ${TEST_ISBN}`);
    console.log(`  📖 Title: "${book.title}"`);
    console.log(`  🖼️  Cover: ${book.coverUrl ? 'Yes' : 'No'}`);
    console.log(`  ⏱️  Query: ${searchResult.data.query_duration_ms}ms`);
  } else {
    console.log(`  ⚠️  Test ISBN not in enriched_editions (might need enrichment)`);
  }
}

async function diagnoseISBNdb() {
  console.log('\n📚 ISBNDB BATCH API TEST\n');
  
  // Queue a single ISBN for enrichment
  console.log(`Testing batch enrichment for ISBN: ${TEST_ISBN}`);
  
  const result = await fetchJSON(`${PRODUCTION_URL}/api/enrich/queue/batch`, {
    method: 'POST',
    body: JSON.stringify({
      books: [{ isbn: TEST_ISBN, priority: 'high', source: 'diagnostic' }]
    })
  });
  
  if (result.ok) {
    console.log(`  ✅ Queued: ${result.data.queued}`);
    console.log(`  ❌ Failed: ${result.data.failed}`);
    if (result.data.errors?.length > 0) {
      console.log(`  ⚠️  Errors: ${JSON.stringify(result.data.errors)}`);
    }
  } else {
    console.log(`  ❌ Queue failed: ${result.error || JSON.stringify(result.data)}`);
  }
  
  // Test ISBNdb test endpoint if available
  console.log('\nTesting ISBNdb API directly...');
  const testResult = await fetchJSON(`${PRODUCTION_URL}/api/test/isbndb?isbn=${TEST_ISBN}`);
  
  if (testResult.ok) {
    console.log(`  ✅ ISBNdb response received`);
    if (testResult.data.book) {
      console.log(`  📖 Title: "${testResult.data.book.title}"`);
      console.log(`  🖼️  Cover: ${testResult.data.book.image ? 'Yes' : 'No'}`);
    }
  } else {
    console.log(`  ⚠️  ISBNdb test endpoint: ${testResult.status} (may not be exposed)`);
  }
}

async function diagnoseQueue() {
  console.log('\n📬 QUEUE DIAGNOSTICS\n');
  
  // Check enrichment queue status
  console.log('Enrichment Queue:');
  const queueStatus = await fetchJSON(`${PRODUCTION_URL}/api/queue/status`);
  
  if (queueStatus.ok) {
    console.log(`  📊 Status: ${JSON.stringify(queueStatus.data)}`);
  } else {
    console.log(`  ⚠️  Queue status endpoint: ${queueStatus.status} (may not be exposed)`);
  }
  
  // Try to queue a test item
  console.log('\nQueue Test Send:');
  const sendResult = await fetchJSON(`${PRODUCTION_URL}/api/enrich/queue/batch`, {
    method: 'POST',
    body: JSON.stringify({
      books: [{ isbn: TEST_ISBN, priority: 'low', source: 'queue-diagnostic' }]
    })
  });
  
  if (sendResult.ok) {
    console.log(`  ✅ Successfully queued test item`);
    console.log(`  📊 Response: ${JSON.stringify(sendResult.data)}`);
  } else {
    console.log(`  ❌ Queue send failed: ${sendResult.error || sendResult.status}`);
  }
}

async function diagnoseCovers() {
  console.log('\n🖼️  COVER PROCESSING DIAGNOSTICS\n');
  
  // Check if cover exists for test ISBN
  console.log(`Checking cover for ISBN: ${TEST_ISBN}`);
  
  const sizes = ['large', 'medium', 'small'];
  for (const size of sizes) {
    const url = `${PRODUCTION_URL}/api/covers/${TEST_ISBN}/${size}`;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const status = response.status;
      const contentType = response.headers.get('content-type');
      
      if (status === 200) {
        console.log(`  ✅ ${size}: Available (${contentType})`);
      } else if (status === 302) {
        console.log(`  ⚠️  ${size}: Redirect (placeholder)`);
      } else {
        console.log(`  ❌ ${size}: ${status}`);
      }
    } catch (error) {
      console.log(`  ❌ ${size}: ${error.message}`);
    }
  }
  
  // Queue cover processing
  console.log('\nQueue Cover Processing:');
  const queueResult = await fetchJSON(`${PRODUCTION_URL}/api/covers/queue`, {
    method: 'POST',
    body: JSON.stringify({
      books: [{ isbn: TEST_ISBN, priority: 'high', source: 'cover-diagnostic' }]
    })
  });
  
  if (queueResult.ok) {
    console.log(`  ✅ Cover queued: ${JSON.stringify(queueResult.data)}`);
  } else {
    console.log(`  ❌ Cover queue failed: ${queueResult.error || queueResult.status}`);
  }
}

async function diagnoseSearch() {
  console.log('\n🔍 SEARCH API DIAGNOSTICS\n');
  
  const tests = [
    { name: 'ISBN Search', url: `/api/search?isbn=${TEST_ISBN}` },
    { name: 'Title Search', url: `/api/search?title=harry%20potter&limit=3` },
    { name: 'Author Search', url: `/api/search?author=rowling&limit=3` },
    { name: 'Combined Search', url: `/api/search/combined?q=harry%20potter&limit=3` },
  ];
  
  for (const test of tests) {
    console.log(`${test.name}:`);
    const result = await fetchJSON(`${PRODUCTION_URL}${test.url}`);
    
    if (result.ok) {
      const { query_duration_ms, results, pagination } = result.data;
      console.log(`  ✅ ${results?.length || 0} results in ${query_duration_ms}ms`);
      if (results?.length > 0) {
        console.log(`  📖 First: "${results[0].title?.substring(0, 40)}..."`);
      }
      if (pagination) {
        console.log(`  📄 Total: ${pagination.total}, HasMore: ${pagination.hasMore}`);
      }
    } else {
      console.log(`  ❌ Failed: ${result.error || result.status}`);
    }
    console.log();
  }
}

async function runAll() {
  await diagnoseHealth();
  await diagnoseDatabase();
  await diagnoseISBNdb();
  await diagnoseQueue();
  await diagnoseCovers();
  await diagnoseSearch();
}

// =============================================================================
// Main
// =============================================================================

const component = process.argv[2] || 'all';
const commands = {
  health: diagnoseHealth,
  db: diagnoseDatabase,
  isbndb: diagnoseISBNdb,
  queue: diagnoseQueue,
  covers: diagnoseCovers,
  search: diagnoseSearch,
  all: runAll,
};

console.log('=' .repeat(60));
console.log('Alexandria Component Diagnostics');
console.log('=' .repeat(60));

if (commands[component]) {
  commands[component]().then(() => {
    console.log('\n' + '=' .repeat(60));
    console.log('Diagnostics complete');
    console.log('=' .repeat(60) + '\n');
  });
} else {
  console.log(`Unknown component: ${component}`);
  console.log('Available: health, db, isbndb, queue, covers, search, all');
  process.exit(1);
}
