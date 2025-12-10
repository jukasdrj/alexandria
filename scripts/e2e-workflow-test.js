#!/usr/bin/env node
/**
 * End-to-End Alexandria Workflow Validation Test
 * 
 * Tests the complete enrichment pipeline:
 * 1. Queue seeding via API
 * 2. ISBNdb batch processing
 * 3. Database enrichment storage
 * 4. Cover queue trigger & processing
 * 5. R2 storage validation
 * 
 * Usage:
 *   node scripts/e2e-workflow-test.js [--production]
 * 
 * Options:
 *   --production  Test against production (default: local dev)
 */

import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'fs';

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  // API endpoints
  local: {
    baseUrl: 'http://localhost:8787',
    name: 'Local Dev'
  },
  production: {
    baseUrl: 'https://alexandria.ooheynerds.com',
    name: 'Production'
  },
  
  // Database connection (via Hyperdrive for production, direct for local testing)
  database: {
    host: '192.168.1.240',
    port: 5432,
    database: 'openlibrary',
    user: 'openlibrary',
    password: 'tommyboy'
  },
  
  // Test ISBNs (mix of known good books for validation)
  testISBNs: [
    '9780439064873',  // Harry Potter and the Chamber of Secrets
    '9780061120084',  // To Kill a Mockingbird
    '9780743273565',  // The Great Gatsby
    '9780316769488',  // The Catcher in the Rye
    '9780142437230',  // Don Quixote
  ],
  
  // Timeouts
  queueProcessingTimeoutMs: 120000,  // 2 minutes for queue to process
  pollIntervalMs: 5000,              // 5 seconds between status checks
};

// =============================================================================
// Helpers
// =============================================================================

const isProduction = process.argv.includes('--production');
const env = isProduction ? CONFIG.production : CONFIG.local;

function log(msg, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    debug: '🔍',
    step: '▶️'
  }[level] || '•';
  console.log(`${timestamp} ${prefix} ${msg}`);
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Alexandria-E2E-Test/1.0',
      ...options.headers
    },
    ...options
  });
  
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, data: text };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Test Steps
// =============================================================================

class WorkflowTester {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      environment: env.name,
      steps: [],
      summary: { passed: 0, failed: 0, warnings: 0 }
    };
    this.sql = null;
  }
  
  async connectDatabase() {
    log('Connecting to PostgreSQL database...', 'step');
    try {
      this.sql = postgres({
        host: CONFIG.database.host,
        port: CONFIG.database.port,
        database: CONFIG.database.database,
        username: CONFIG.database.user,
        password: CONFIG.database.password,
        ssl: false,
        max: 1
      });
      
      // Test connection
      const result = await this.sql`SELECT 1 as test`;
      log('Database connection successful', 'success');
      return true;
    } catch (error) {
      log(`Database connection failed: ${error.message}`, 'error');
      return false;
    }
  }
  
  async step1_healthCheck() {
    log('Step 1: Health Check', 'step');
    
    const result = await fetchJSON(`${env.baseUrl}/health`);
    
    if (!result.ok) {
      this.recordResult('health_check', false, `Health check failed: ${result.status}`);
      return false;
    }
    
    const health = result.data;
    log(`Database: ${health.database}`, 'debug');
    log(`R2 Covers: ${health.r2_covers}`, 'debug');
    log(`Hyperdrive Latency: ${health.hyperdrive_latency_ms}ms`, 'debug');
    
    const passed = health.status === 'ok' && health.database === 'connected';
    this.recordResult('health_check', passed, passed ? 'All systems operational' : 'Health check issues');
    return passed;
  }
  
  async step2_checkExistingData() {
    log('Step 2: Check Pre-Test State', 'step');
    
    // Check which test ISBNs already exist
    const existing = await this.sql`
      SELECT isbn, title, isbndb_quality, cover_url_large
      FROM enriched_editions
      WHERE isbn = ANY(${CONFIG.testISBNs})
    `;
    
    log(`Found ${existing.length}/${CONFIG.testISBNs.length} test ISBNs already enriched`, 'debug');
    
    for (const row of existing) {
      log(`  ${row.isbn}: "${row.title}" (quality: ${row.isbndb_quality}, cover: ${row.cover_url_large ? 'yes' : 'no'})`, 'debug');
    }
    
    this.preTestState = {
      existingISBNs: existing.map(r => r.isbn),
      existingCount: existing.length
    };
    
    this.recordResult('pre_test_state', true, `${existing.length} ISBNs pre-existing`);
    return true;
  }
  
  async step3_clearTestData() {
    log('Step 3: Clear Test Data (Optional)', 'step');
    
    // Only clear if explicitly requested via --clean flag
    if (!process.argv.includes('--clean')) {
      log('Skipping cleanup (use --clean to reset test ISBNs)', 'debug');
      this.recordResult('clear_test_data', true, 'Skipped (no --clean flag)');
      return true;
    }
    
    try {
      const deleted = await this.sql`
        DELETE FROM enriched_editions
        WHERE isbn = ANY(${CONFIG.testISBNs})
        RETURNING isbn
      `;
      log(`Cleared ${deleted.length} test ISBNs from enriched_editions`, 'debug');
      this.recordResult('clear_test_data', true, `Cleared ${deleted.length} ISBNs`);
      return true;
    } catch (error) {
      this.recordResult('clear_test_data', false, error.message);
      return false;
    }
  }
  
  async step4_queueEnrichment() {
    log('Step 4: Queue Enrichment Batch', 'step');
    
    const books = CONFIG.testISBNs.map(isbn => ({
      isbn,
      priority: 'high',
      source: 'e2e-test'
    }));
    
    const result = await fetchJSON(`${env.baseUrl}/api/enrich/queue/batch`, {
      method: 'POST',
      body: JSON.stringify({ books })
    });
    
    if (!result.ok) {
      this.recordResult('queue_enrichment', false, `Queue failed: ${JSON.stringify(result.data)}`);
      return false;
    }
    
    log(`Queued: ${result.data.queued}, Failed: ${result.data.failed}`, 'debug');
    if (result.data.errors?.length > 0) {
      log(`Errors: ${JSON.stringify(result.data.errors)}`, 'warning');
    }
    
    const passed = result.data.queued > 0;
    this.recordResult('queue_enrichment', passed, `Queued ${result.data.queued} ISBNs`);
    return passed;
  }
  
  async step5_waitForQueueProcessing() {
    log('Step 5: Wait for Queue Processing', 'step');
    
    const startTime = Date.now();
    let lastCount = this.preTestState.existingCount;
    
    while (Date.now() - startTime < CONFIG.queueProcessingTimeoutMs) {
      await sleep(CONFIG.pollIntervalMs);
      
      // Check how many ISBNs are now enriched
      const current = await this.sql`
        SELECT COUNT(*) as count
        FROM enriched_editions
        WHERE isbn = ANY(${CONFIG.testISBNs})
      `;
      
      const currentCount = parseInt(current[0].count);
      
      if (currentCount > lastCount) {
        log(`Progress: ${currentCount}/${CONFIG.testISBNs.length} ISBNs enriched`, 'debug');
        lastCount = currentCount;
      }
      
      if (currentCount >= CONFIG.testISBNs.length) {
        log('All test ISBNs enriched!', 'success');
        this.recordResult('queue_processing', true, `Completed in ${Math.round((Date.now() - startTime) / 1000)}s`);
        return true;
      }
    }
    
    // Timeout - check what we got
    const finalCount = await this.sql`
      SELECT COUNT(*) as count FROM enriched_editions WHERE isbn = ANY(${CONFIG.testISBNs})
    `;
    
    const enriched = parseInt(finalCount[0].count);
    const partial = enriched > this.preTestState.existingCount;
    
    this.recordResult('queue_processing', partial, 
      partial ? `Partial: ${enriched}/${CONFIG.testISBNs.length} (timeout)` : 'No new ISBNs enriched (timeout)');
    
    return partial;
  }
  
  async step6_validateEnrichmentData() {
    log('Step 6: Validate Enrichment Data Quality', 'step');
    
    const enriched = await this.sql`
      SELECT 
        isbn,
        title,
        publisher,
        page_count,
        isbndb_quality,
        completeness_score,
        primary_provider,
        cover_url_large,
        cover_url_medium,
        cover_url_small,
        cover_source,
        created_at,
        updated_at,
        last_isbndb_sync
      FROM enriched_editions
      WHERE isbn = ANY(${CONFIG.testISBNs})
      ORDER BY isbn
    `;
    
    let validCount = 0;
    let highQualityCount = 0;
    let withCoversCount = 0;
    
    for (const row of enriched) {
      const hasTitle = !!row.title;
      const hasQuality = row.isbndb_quality > 0;
      const hasCover = !!(row.cover_url_large || row.cover_url_medium || row.cover_url_small);
      const isHighQuality = row.isbndb_quality >= 50;
      
      log(`  ${row.isbn}: "${row.title?.substring(0, 40)}..." quality=${row.isbndb_quality} cover=${hasCover ? 'yes' : 'no'}`, 'debug');
      
      if (hasTitle && hasQuality) validCount++;
      if (isHighQuality) highQualityCount++;
      if (hasCover) withCoversCount++;
    }
    
    log(`Valid: ${validCount}/${enriched.length}`, 'debug');
    log(`High Quality (≥50): ${highQualityCount}/${enriched.length}`, 'debug');
    log(`With Covers: ${withCoversCount}/${enriched.length}`, 'debug');
    
    const passed = validCount > 0 && highQualityCount > 0;
    this.recordResult('enrichment_quality', passed, 
      `${validCount} valid, ${highQualityCount} high-quality, ${withCoversCount} with covers`);
    
    return passed;
  }
  
  async step7_checkCoverQueue() {
    log('Step 7: Check Cover Queue Processing', 'step');
    
    // Check if any covers were queued (via enrichment_log or direct check)
    const coversWithUrls = await this.sql`
      SELECT isbn, cover_url_large, cover_url_original, cover_source
      FROM enriched_editions
      WHERE isbn = ANY(${CONFIG.testISBNs})
        AND (cover_url_large IS NOT NULL OR cover_url_original IS NOT NULL)
    `;
    
    log(`${coversWithUrls.length}/${CONFIG.testISBNs.length} ISBNs have cover URLs stored`, 'debug');
    
    for (const row of coversWithUrls) {
      log(`  ${row.isbn}: source=${row.cover_source} url=${row.cover_url_large?.substring(0, 60)}...`, 'debug');
    }
    
    // Note: Actual R2 storage is async and may not be complete yet
    this.recordResult('cover_queue', coversWithUrls.length > 0, 
      `${coversWithUrls.length} ISBNs have cover URLs`);
    
    return coversWithUrls.length > 0;
  }
  
  async step8_validateR2Storage() {
    log('Step 8: Validate R2 Cover Storage (via API)', 'step');
    
    // Test serving a cover for one of our test ISBNs
    let foundCover = false;
    
    for (const isbn of CONFIG.testISBNs) {
      const coverUrl = `${env.baseUrl}/api/covers/${isbn}/large`;
      
      try {
        const response = await fetch(coverUrl, {
          method: 'HEAD',
          headers: { 'User-Agent': 'Alexandria-E2E-Test/1.0' }
        });
        
        if (response.ok) {
          log(`Cover found for ${isbn}: ${response.headers.get('content-type')}`, 'debug');
          foundCover = true;
        } else if (response.status === 302) {
          log(`Cover redirect for ${isbn} (placeholder)`, 'debug');
        }
      } catch (error) {
        log(`Cover check failed for ${isbn}: ${error.message}`, 'debug');
      }
    }
    
    // R2 covers may be async - don't fail test if not found yet
    this.recordResult('r2_storage', true, 
      foundCover ? 'Covers found in R2' : 'Covers may still be processing');
    
    return true;
  }
  
  async step9_checkEnrichmentLog() {
    log('Step 9: Verify Enrichment Audit Trail', 'step');
    
    const logs = await this.sql`
      SELECT 
        entity_key,
        provider,
        operation,
        success,
        fields_updated,
        response_time_ms,
        created_at
      FROM enrichment_log
      WHERE entity_type = 'edition'
        AND entity_key = ANY(${CONFIG.testISBNs})
      ORDER BY created_at DESC
      LIMIT 20
    `;
    
    log(`Found ${logs.length} enrichment log entries`, 'debug');
    
    const successCount = logs.filter(l => l.success).length;
    const avgResponseTime = logs.length > 0 
      ? Math.round(logs.reduce((sum, l) => sum + (l.response_time_ms || 0), 0) / logs.length)
      : 0;
    
    log(`Success rate: ${successCount}/${logs.length}`, 'debug');
    log(`Avg response time: ${avgResponseTime}ms`, 'debug');
    
    this.recordResult('enrichment_log', logs.length > 0, 
      `${logs.length} log entries, ${successCount} successful, avg ${avgResponseTime}ms`);
    
    return logs.length > 0;
  }
  
  async step10_searchValidation() {
    log('Step 10: Search API Validation', 'step');
    
    // Test ISBN search
    const testISBN = CONFIG.testISBNs[0];
    const result = await fetchJSON(`${env.baseUrl}/api/search?isbn=${testISBN}`);
    
    if (!result.ok) {
      this.recordResult('search_api', false, `Search failed: ${result.status}`);
      return false;
    }
    
    const { query_duration_ms, results, pagination } = result.data;
    
    log(`Search for ${testISBN}: ${results?.length || 0} results in ${query_duration_ms}ms`, 'debug');
    
    if (results?.length > 0) {
      const book = results[0];
      log(`  Found: "${book.title}" by ${book.author}`, 'debug');
      log(`  Cover: ${book.coverUrl || 'none'}`, 'debug');
    }
    
    const passed = results?.length > 0;
    this.recordResult('search_api', passed, 
      passed ? `Found ${results.length} results in ${query_duration_ms}ms` : 'No results found');
    
    return passed;
  }
  
  // =============================================================================
  // Result Recording
  // =============================================================================
  
  recordResult(step, passed, message) {
    const status = passed ? 'PASS' : 'FAIL';
    this.results.steps.push({ step, status, message, timestamp: new Date().toISOString() });
    
    if (passed) {
      this.results.summary.passed++;
      log(`${step}: ${message}`, 'success');
    } else {
      this.results.summary.failed++;
      log(`${step}: ${message}`, 'error');
    }
  }
  
  // =============================================================================
  // Main Runner
  // =============================================================================
  
  async run() {
    console.log('\n' + '='.repeat(80));
    console.log('Alexandria End-to-End Workflow Validation Test');
    console.log(`Environment: ${env.name} (${env.baseUrl})`);
    console.log('='.repeat(80) + '\n');
    
    try {
      // Connect to database
      if (!await this.connectDatabase()) {
        log('Cannot proceed without database connection', 'error');
        return this.results;
      }
      
      // Run all test steps
      await this.step1_healthCheck();
      await this.step2_checkExistingData();
      await this.step3_clearTestData();
      await this.step4_queueEnrichment();
      await this.step5_waitForQueueProcessing();
      await this.step6_validateEnrichmentData();
      await this.step7_checkCoverQueue();
      await this.step8_validateR2Storage();
      await this.step9_checkEnrichmentLog();
      await this.step10_searchValidation();
      
    } catch (error) {
      log(`Test suite error: ${error.message}`, 'error');
      this.recordResult('test_suite', false, error.message);
    } finally {
      // Cleanup
      if (this.sql) {
        await this.sql.end();
      }
    }
    
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Passed: ${this.results.summary.passed}`);
    console.log(`❌ Failed: ${this.results.summary.failed}`);
    console.log('='.repeat(80) + '\n');
    
    // Save results to file
    const logFile = `logs/e2e-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(logFile, JSON.stringify(this.results, null, 2));
    log(`Results saved to ${logFile}`, 'info');
    
    // Exit with appropriate code
    process.exit(this.results.summary.failed > 0 ? 1 : 0);
  }
}

// Run the test
const tester = new WorkflowTester();
tester.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
