#!/usr/bin/env node
/**
 * Alexandria Pipeline Test - Real-time Workflow Validation
 * 
 * This script tests the complete enrichment pipeline:
 * 1. Queues test ISBNs via the batch API
 * 2. Polls for queue processing completion
 * 3. Verifies database enrichment
 * 4. Checks cover URL generation
 * 
 * Usage: node scripts/pipeline-test.js [--verbose]
 */

const PRODUCTION_URL = 'https://alexandria.ooheynerds.com';

// Fresh ISBNs that are less likely to be pre-enriched
const TEST_ISBNS = [
  '9780593152386',  // Project Hail Mary (recent)
  '9780385545952',  // The Midnight Library
  '9780593099322',  // Atomic Habits
  '9780593139134',  // The Four Winds
  '9780593188477',  // Beautiful World Where Are You
];

const VERBOSE = process.argv.includes('--verbose');

function log(msg, emoji = '📋') {
  console.log(`${new Date().toISOString().slice(11,19)} ${emoji} ${msg}`);
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  return { 
    ok: response.ok, 
    status: response.status, 
    data: await response.json().catch(() => null) 
  };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =============================================================================
// Main Test Flow
// =============================================================================

async function main() {
  console.log('═'.repeat(70));
  console.log('Alexandria Pipeline Validation Test');
  console.log('═'.repeat(70));
  
  // Step 1: Check health
  log('Step 1: Health Check', '🏥');
  const health = await fetchJSON(`${PRODUCTION_URL}/health`);
  if (!health.ok) {
    log(`Health check failed: ${health.status}`, '❌');
    process.exit(1);
  }
  log(`Status: ${health.data.status}, DB: ${health.data.database}`, '✅');
  
  // Step 2: Check pre-test state
  log('Step 2: Check Pre-Test State', '🔍');
  const preCheck = await fetchJSON(`${PRODUCTION_URL}/api/isbns/check`, {
    method: 'POST',
    body: JSON.stringify({ isbns: TEST_ISBNS })
  });
  
  const existingBefore = preCheck.data?.existing || [];
  const newISBNs = TEST_ISBNS.filter(isbn => !existingBefore.includes(isbn));
  
  log(`${existingBefore.length}/${TEST_ISBNS.length} ISBNs already exist`, '📊');
  log(`${newISBNs.length} new ISBNs to test`, '📊');
  
  if (VERBOSE) {
    existingBefore.forEach(isbn => log(`  Already exists: ${isbn}`, '•'));
    newISBNs.forEach(isbn => log(`  Will test: ${isbn}`, '•'));
  }
  
  // Step 3: Queue enrichment
  log('Step 3: Queue Enrichment Batch', '📬');
  const queueStart = Date.now();
  
  const queueResult = await fetchJSON(`${PRODUCTION_URL}/api/enrich/queue/batch`, {
    method: 'POST',
    body: JSON.stringify({
      books: TEST_ISBNS.map(isbn => ({
        isbn,
        priority: 'high',
        source: 'pipeline-test',
        title: 'Test Book',
        author: 'Test Author'
      }))
    })
  });
  
  if (!queueResult.ok) {
    log(`Queue failed: ${JSON.stringify(queueResult.data)}`, '❌');
    process.exit(1);
  }
  
  log(`Queued ${queueResult.data.queued} ISBNs`, '✅');
  if (queueResult.data.failed > 0) {
    log(`${queueResult.data.failed} failed to queue`, '⚠️');
  }
  
  // Step 4: Wait and poll for completion
  log('Step 4: Waiting for Queue Processing...', '⏳');
  
  const maxWait = 120000; // 2 minutes
  const pollInterval = 5000; // 5 seconds
  let waitTime = 0;
  let lastProgress = 0;
  
  while (waitTime < maxWait) {
    await sleep(pollInterval);
    waitTime += pollInterval;
    
    const checkResult = await fetchJSON(`${PRODUCTION_URL}/api/isbns/check`, {
      method: 'POST',
      body: JSON.stringify({ isbns: TEST_ISBNS })
    });
    
    const currentExisting = checkResult.data?.existing || [];
    const newlyEnriched = currentExisting.filter(isbn => !existingBefore.includes(isbn));
    
    if (newlyEnriched.length > lastProgress) {
      log(`Progress: ${newlyEnriched.length}/${newISBNs.length} new ISBNs enriched (${waitTime/1000}s)`, '📈');
      lastProgress = newlyEnriched.length;
      
      if (VERBOSE) {
        newlyEnriched.forEach(isbn => log(`  Enriched: ${isbn}`, '✓'));
      }
    }
    
    // Check if all are done or we've enriched at least some
    if (newlyEnriched.length >= newISBNs.length) {
      log(`All ${newISBNs.length} new ISBNs enriched!`, '🎉');
      break;
    }
  }
  
  // Step 5: Verify enrichment quality
  log('Step 5: Verify Enrichment Quality', '🔬');
  
  let highQualityCount = 0;
  let coverCount = 0;
  
  for (const isbn of TEST_ISBNS) {
    const searchResult = await fetchJSON(`${PRODUCTION_URL}/api/search?isbn=${isbn}`);
    
    if (searchResult.ok && searchResult.data.results?.length > 0) {
      const book = searchResult.data.results[0];
      const hasGoodData = book.title && book.author;
      const hasCover = !!book.coverUrl;
      
      if (hasGoodData) highQualityCount++;
      if (hasCover) coverCount++;
      
      if (VERBOSE) {
        log(`${isbn}: "${book.title?.substring(0,40)}..." cover=${hasCover}`, hasGoodData ? '✓' : '○');
      }
    }
  }
  
  log(`Quality: ${highQualityCount}/${TEST_ISBNS.length} have good metadata`, highQualityCount > 0 ? '✅' : '⚠️');
  log(`Covers: ${coverCount}/${TEST_ISBNS.length} have cover URLs`, coverCount > 0 ? '✅' : '⚠️');
  
  // Step 6: Test search functionality
  log('Step 6: Search API Test', '🔍');
  
  const searchTests = [
    { name: 'ISBN', url: `/api/search?isbn=${TEST_ISBNS[0]}` },
    { name: 'Title', url: `/api/search?title=hail%20mary&limit=3` },
  ];
  
  for (const test of searchTests) {
    const result = await fetchJSON(`${PRODUCTION_URL}${test.url}`);
    if (result.ok) {
      log(`${test.name}: ${result.data.results?.length || 0} results in ${result.data.query_duration_ms}ms`, '✅');
    } else {
      log(`${test.name}: Failed - ${result.status}`, '❌');
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('TEST SUMMARY');
  console.log('═'.repeat(70));
  
  const totalTime = Date.now() - queueStart;
  const success = highQualityCount >= TEST_ISBNS.length / 2;
  
  console.log(`Total Time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`ISBNs Tested: ${TEST_ISBNS.length}`);
  console.log(`High Quality: ${highQualityCount}/${TEST_ISBNS.length}`);
  console.log(`With Covers: ${coverCount}/${TEST_ISBNS.length}`);
  console.log(`Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
  console.log('═'.repeat(70));
  
  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
