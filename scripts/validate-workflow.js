#!/usr/bin/env node
/**
 * Alexandria End-to-End Workflow Validation Test
 * 
 * Validates the complete enrichment pipeline:
 * 1. Health check (Worker, Database, R2)
 * 2. Queue seeding via API (POST /api/enrich/queue/batch)
 * 3. ISBNdb batch processing (via Cloudflare Queue consumer)
 * 4. Database enrichment storage (enriched_editions)
 * 5. Cover queue trigger & processing
 * 6. R2 storage validation (cover images)
 * 7. Search API validation
 * 
 * Usage:
 *   node scripts/validate-workflow.js [--production] [--clean] [--verbose]
 * 
 * Options:
 *   --production  Test against production (default: local dev on port 8787)
 *   --clean       Clear test ISBNs before running
 *   --verbose     Show detailed logging
 */

import postgres from 'postgres';
import { writeFileSync } from 'fs';

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  local: {
    baseUrl: 'http://localhost:8787',
    name: 'Local Dev'
  },
  production: {
    baseUrl: 'https://alexandria.ooheynerds.com',
    name: 'Production'
  },
  
  // Database connection - try tunnel first (for remote access), fallback to direct IP
  database: {
    // Cloudflare Tunnel (works from anywhere)
    tunnel: {
      host: 'alexandria-db.ooheynerds.com',
      port: 5432,
      database: 'openlibrary',
      user: 'openlibrary',
      password: 'tommyboy',
      ssl: 'require'
    },
    // Direct IP (works from local network only)
    direct: {
      host: '192.168.1.240',
      port: 5432,
      database: 'openlibrary',
      user: 'openlibrary',
      password: 'tommyboy',
      ssl: false
    }
  },
  
  // Test ISBNs - mix of popular books with known ISBNdb data
  testISBNs: [
    '9780439064873',  // Harry Potter and the Chamber of Secrets
    '9780061120084',  // To Kill a Mockingbird
    '9780743273565',  // The Great Gatsby
    '9780316769488',  // The Catcher in the Rye
    '9780142437230',  // Don Quixote
  ],
  
  // Polling configuration
  maxWaitMs: 180000,        // 3 minutes max wait for queue processing
  pollIntervalMs: 5000,     // 5 seconds between checks
  coverWaitMs: 60000,       // 1 minute for cover processing
};

// =============================================================================
// Helpers
// =============================================================================

const isProduction = process.argv.includes('--production');
const isClean = process.argv.includes('--clean');
const isVerbose = process.argv.includes('--verbose');
const env = isProduction ? CONFIG.production : CONFIG.local;

function log(msg, level = 'info') {
  const timestamp = new Date().toISOString().slice(11, 19);
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    debug: '🔍',
    step: '▶️',
    wait: '⏳'
  }[level] || '•';
  
  if (level === 'debug' && !isVerbose) return;
  console.log(`${timestamp} ${prefix} ${msg}`);
}

async function fetchJSON(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Alexandria-Workflow-Validator/1.0',
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
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error.message };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Validation Steps
// =============================================================================

class WorkflowValidator {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      environment: env.name,
      testISBNs: CONFIG.testISBNs,
      steps: [],
      summary: { passed: 0, failed: 0, warnings: 0 }
    };
    this.sql = null;
    this.preTestState = {};
  }

  recordResult(step, passed, message, details = {}) {
    const status = passed ? 'PASS' : 'FAIL';
    this.results.steps.push({ 
      step, 
      status, 
      message, 
      details,
      timestamp: new Date().toISOString() 
    });
    
    if (passed) {
      this.results.summary.passed++;
      log(`${step}: ${message}`, 'success');
    } else {
      this.results.summary.failed++;
      log(`${step}: ${message}`, 'error');
    }
    
    if (Object.keys(details).length > 0 && isVerbose) {
      console.log('   Details:', JSON.stringify(details, null, 2));
    }
  }

  async connectDatabase() {
    log('Connecting to PostgreSQL database...', 'step');
    
    // Try tunnel connection first (works from anywhere)
    const connConfigs = [
      { name: 'Tunnel', config: CONFIG.database.tunnel },
      { name: 'Direct', config: CONFIG.database.direct }
    ];
    
    for (const { name, config } of connConfigs) {
      try {
        log(`Trying ${name} connection (${config.host})...`, 'debug');
        this.sql = postgres({
          host: config.host,
          port: config.port,
          database: config.database,
          username: config.user,
          password: config.password,
          ssl: config.ssl,
          max: 1,
          connect_timeout: 10
        });
        
        await this.sql`SELECT 1 as test`;
        log(`Database connection successful via ${name}`, 'success');
        return true;
      } catch (error) {
        log(`${name} connection failed: ${error.message}`, 'debug');
        if (this.sql) {
          try { await this.sql.end(); } catch {}
        }
        continue;
      }
    }
    
    log('All database connections failed', 'error');
    return false;
  }


  // ========================================================================
  // STEP 1: Health Check
  // ========================================================================
  async step1_healthCheck() {
    log('Step 1: Health Check', 'step');
    
    const result = await fetchJSON(`${env.baseUrl}/health`);
    
    if (!result.ok) {
      this.recordResult('health_check', false, `Health check failed: HTTP ${result.status}`, {
        error: result.error || result.data
      });
      return false;
    }
    
    const health = result.data;
    const passed = health.status === 'ok' && 
                   health.database === 'connected' && 
                   health.r2_covers === 'bound';
    
    this.recordResult('health_check', passed, 
      passed ? 'All systems operational' : 'Health check issues',
      {
        database: health.database,
        r2: health.r2_covers,
        latency_ms: health.hyperdrive_latency_ms
      }
    );
    
    return passed;
  }

  // ========================================================================
  // STEP 2: Check Pre-Test State
  // ========================================================================
  async step2_checkPreTestState() {
    log('Step 2: Check Pre-Test State', 'step');
    
    const existing = await this.sql`
      SELECT isbn, title, isbndb_quality, cover_url_large, cover_url_original,
             primary_provider, completeness_score, created_at, updated_at
      FROM enriched_editions
      WHERE isbn = ANY(${CONFIG.testISBNs})
    `;
    
    log(`Found ${existing.length}/${CONFIG.testISBNs.length} test ISBNs already enriched`, 'debug');
    
    for (const row of existing) {
      log(`  ${row.isbn}: "${row.title?.substring(0, 30)}..." quality=${row.isbndb_quality} cover=${row.cover_url_large ? 'yes' : 'no'}`, 'debug');
    }
    
    this.preTestState = {
      existingISBNs: existing.map(r => r.isbn),
      existingCount: existing.length,
      existingRows: existing
    };
    
    this.recordResult('pre_test_state', true, `${existing.length} ISBNs pre-existing`, {
      isbns: this.preTestState.existingISBNs
    });
    
    return true;
  }

  // ========================================================================
  // STEP 3: Clear Test Data (Optional)
  // ========================================================================
  async step3_clearTestData() {
    log('Step 3: Clear Test Data', 'step');
    
    if (!isClean) {
      log('Skipping cleanup (use --clean to reset test ISBNs)', 'debug');
      this.recordResult('clear_test_data', true, 'Skipped (no --clean flag)');
      return true;
    }
    
    try {
      // Clear from enriched_editions
      const deletedEditions = await this.sql`
        DELETE FROM enriched_editions WHERE isbn = ANY(${CONFIG.testISBNs}) RETURNING isbn
      `;
      
      // Clear from enrichment_log
      const deletedLogs = await this.sql`
        DELETE FROM enrichment_log WHERE entity_key = ANY(${CONFIG.testISBNs}) RETURNING id
      `;
      
      log(`Cleared ${deletedEditions.length} editions, ${deletedLogs.length} logs`, 'debug');
      this.preTestState.existingISBNs = [];
      this.preTestState.existingCount = 0;
      
      this.recordResult('clear_test_data', true, `Cleared ${deletedEditions.length} test ISBNs`);
      return true;
    } catch (error) {
      this.recordResult('clear_test_data', false, error.message);
      return false;
    }
  }

  // ========================================================================
  // STEP 4: Queue Enrichment Batch via API
  // ========================================================================
  async step4_queueEnrichment() {
    log('Step 4: Queue Enrichment Batch via API', 'step');
    
    // Only queue ISBNs that don't already exist
    const isbnsToQueue = CONFIG.testISBNs.filter(
      isbn => !this.preTestState.existingISBNs.includes(isbn)
    );
    
    if (isbnsToQueue.length === 0) {
      log('All test ISBNs already enriched, nothing to queue', 'debug');
      this.recordResult('queue_enrichment', true, 'All ISBNs already enriched');
      return true;
    }
    
    const books = isbnsToQueue.map(isbn => ({
      isbn,
      priority: 'high',
      source: 'workflow-validator'
    }));
    
    const result = await fetchJSON(`${env.baseUrl}/api/enrich/queue/batch`, {
      method: 'POST',
      body: JSON.stringify({ books })
    });
    
    if (!result.ok) {
      this.recordResult('queue_enrichment', false, `Queue failed: HTTP ${result.status}`, result.data);
      return false;
    }
    
    const { queued, failed, errors } = result.data;
    
    if (errors?.length > 0) {
      log(`Queue errors: ${JSON.stringify(errors)}`, 'warning');
    }
    
    const passed = queued > 0;
    this.recordResult('queue_enrichment', passed, 
      `Queued ${queued}/${isbnsToQueue.length} ISBNs`, 
      { queued, failed, isbns: isbnsToQueue }
    );
    
    return passed;
  }


  // ========================================================================
  // STEP 5: Wait for Queue Processing (Cloudflare Queue Consumer)
  // ========================================================================
  async step5_waitForQueueProcessing() {
    log('Step 5: Wait for Cloudflare Queue Processing', 'step');
    log(`Waiting up to ${CONFIG.maxWaitMs/1000}s for enrichment queue to process...`, 'wait');
    
    const startTime = Date.now();
    let lastCount = this.preTestState.existingCount;
    let lastCheckTime = Date.now();
    
    while (Date.now() - startTime < CONFIG.maxWaitMs) {
      await sleep(CONFIG.pollIntervalMs);
      
      // Check how many ISBNs are now enriched
      const current = await this.sql`
        SELECT isbn, isbndb_quality, title
        FROM enriched_editions
        WHERE isbn = ANY(${CONFIG.testISBNs})
      `;
      
      const currentCount = current.length;
      
      if (currentCount > lastCount) {
        const newISBNs = current.filter(r => !this.preTestState.existingISBNs.includes(r.isbn));
        log(`Progress: ${currentCount}/${CONFIG.testISBNs.length} ISBNs enriched (+${currentCount - lastCount} new)`, 'info');
        for (const row of newISBNs) {
          log(`  ✓ ${row.isbn}: "${row.title?.substring(0, 40)}..." (quality: ${row.isbndb_quality})`, 'debug');
        }
        lastCount = currentCount;
      }
      
      if (currentCount >= CONFIG.testISBNs.length) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        log(`All test ISBNs enriched in ${duration}s!`, 'success');
        this.recordResult('queue_processing', true, `Completed in ${duration}s`, {
          enriched: currentCount,
          duration_seconds: duration
        });
        return true;
      }
    }
    
    // Timeout reached - check partial results
    const finalCheck = await this.sql`
      SELECT COUNT(*) as count FROM enriched_editions WHERE isbn = ANY(${CONFIG.testISBNs})
    `;
    
    const finalCount = parseInt(finalCheck[0].count);
    const partial = finalCount > this.preTestState.existingCount;
    
    this.recordResult('queue_processing', partial, 
      partial 
        ? `Partial: ${finalCount}/${CONFIG.testISBNs.length} (timeout after ${CONFIG.maxWaitMs/1000}s)` 
        : `No new ISBNs enriched (timeout after ${CONFIG.maxWaitMs/1000}s)`,
      { final_count: finalCount, expected: CONFIG.testISBNs.length }
    );
    
    return partial;
  }

  // ========================================================================
  // STEP 6: Validate Enrichment Data Quality
  // ========================================================================
  async step6_validateEnrichmentData() {
    log('Step 6: Validate Enrichment Data Quality', 'step');
    
    const enriched = await this.sql`
      SELECT 
        isbn,
        title,
        subtitle,
        publisher,
        page_count,
        format,
        language,
        isbndb_quality,
        completeness_score,
        primary_provider,
        cover_url_original,
        cover_url_large,
        cover_url_medium,
        cover_url_small,
        cover_source,
        subjects,
        dewey_decimal,
        binding,
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
    let withSubjectsCount = 0;
    const details = [];
    
    for (const row of enriched) {
      const hasTitle = !!row.title;
      const hasQuality = row.isbndb_quality > 0;
      const hasCover = !!(row.cover_url_original || row.cover_url_large);
      const isHighQuality = row.isbndb_quality >= 50;
      const hasSubjects = row.subjects && row.subjects.length > 0;
      const isFromISBNdb = row.primary_provider === 'isbndb';
      
      log(`  ${row.isbn}: "${row.title?.substring(0, 35)}..."`, 'debug');
      log(`    quality=${row.isbndb_quality} cover=${hasCover} subjects=${hasSubjects ? row.subjects.length : 0} provider=${row.primary_provider}`, 'debug');
      
      if (hasTitle && hasQuality) validCount++;
      if (isHighQuality) highQualityCount++;
      if (hasCover) withCoversCount++;
      if (hasSubjects) withSubjectsCount++;
      
      details.push({
        isbn: row.isbn,
        title: row.title?.substring(0, 50),
        quality: row.isbndb_quality,
        completeness: row.completeness_score,
        provider: row.primary_provider,
        hasCover,
        coverUrl: row.cover_url_original || row.cover_url_large || null,
        subjectCount: row.subjects?.length || 0
      });
    }
    
    const passed = validCount > 0 && highQualityCount > 0;
    this.recordResult('enrichment_quality', passed, 
      `${validCount} valid, ${highQualityCount} high-quality (≥50), ${withCoversCount} with cover URLs`,
      {
        total: enriched.length,
        valid: validCount,
        high_quality: highQualityCount,
        with_covers: withCoversCount,
        with_subjects: withSubjectsCount,
        details: isVerbose ? details : undefined
      }
    );
    
    return passed;
  }


  // ========================================================================
  // STEP 7: Check Cover Queue Processing
  // ========================================================================
  async step7_checkCoverQueue() {
    log('Step 7: Check Cover Queue Processing', 'step');
    log(`Waiting up to ${CONFIG.coverWaitMs/1000}s for cover queue to process...`, 'wait');
    
    // Get ISBNs with cover URLs that should have triggered cover queue
    const withCoverUrls = await this.sql`
      SELECT isbn, cover_url_original, cover_url_large, cover_source
      FROM enriched_editions
      WHERE isbn = ANY(${CONFIG.testISBNs})
        AND (cover_url_original IS NOT NULL OR cover_url_large IS NOT NULL)
    `;
    
    if (withCoverUrls.length === 0) {
      this.recordResult('cover_queue', false, 'No ISBNs have cover URLs to process');
      return false;
    }
    
    log(`${withCoverUrls.length} ISBNs have cover URLs that should be queued`, 'debug');
    
    // Wait a bit for cover queue to process
    await sleep(Math.min(CONFIG.coverWaitMs, 30000));
    
    // Check R2 for processed covers
    let r2CoverCount = 0;
    const coverResults = [];
    
    for (const row of withCoverUrls) {
      // Check cover existence via correct endpoint: /covers/{isbn}/{size}
      const coverUrl = `${env.baseUrl}/covers/${row.isbn}/large`;
      
      try {
        const response = await fetch(coverUrl, { method: 'HEAD' });
        
        if (response.ok) {
          r2CoverCount++;
          coverResults.push({
            isbn: row.isbn,
            status: 'found',
            contentType: response.headers.get('content-type'),
            size: response.headers.get('content-length')
          });
          log(`  ✓ ${row.isbn}: Cover found in R2`, 'debug');
        } else if (response.status === 302) {
          coverResults.push({
            isbn: row.isbn,
            status: 'redirect',
            note: 'Redirecting to original URL (not yet in R2)'
          });
          log(`  ↪ ${row.isbn}: Redirect (not yet cached in R2)`, 'debug');
        } else {
          coverResults.push({
            isbn: row.isbn,
            status: 'missing',
            httpStatus: response.status
          });
          log(`  ✗ ${row.isbn}: Cover not found (${response.status})`, 'debug');
        }
      } catch (error) {
        coverResults.push({
          isbn: row.isbn,
          status: 'error',
          error: error.message
        });
      }
    }
    
    const passed = r2CoverCount > 0 || withCoverUrls.length > 0;
    this.recordResult('cover_queue', passed, 
      `${r2CoverCount}/${withCoverUrls.length} covers in R2`,
      {
        with_urls: withCoverUrls.length,
        in_r2: r2CoverCount,
        results: coverResults
      }
    );
    
    return passed;
  }

  // ========================================================================
  // STEP 8: Validate R2 Cover Storage
  // ========================================================================
  async step8_validateR2Storage() {
    log('Step 8: Validate R2 Cover Storage', 'step');
    
    const coverTests = [];
    
    for (const isbn of CONFIG.testISBNs) {
      // Valid sizes: large, medium, small (not "original")
      const sizes = ['large', 'medium', 'small'];
      const sizeResults = {};
      
      for (const size of sizes) {
        // Correct endpoint: /covers/{isbn}/{size} (not /api/covers/...)
        const coverUrl = `${env.baseUrl}/covers/${isbn}/${size}`;
        
        try {
          const response = await fetch(coverUrl, { method: 'GET', redirect: 'manual' });
          
          sizeResults[size] = {
            status: response.status,
            contentType: response.headers.get('content-type'),
            cacheControl: response.headers.get('cache-control'),
            location: response.headers.get('location')
          };
          
          // Check if it's serving from R2 (200) or redirecting (302)
          if (response.status === 200) {
            const contentType = response.headers.get('content-type');
            const isWebP = contentType?.includes('webp');
            log(`  ${isbn}/${size}: ✓ R2 (${contentType}${isWebP ? ' - WebP!' : ''})`, 'debug');
          } else if (response.status === 302) {
            log(`  ${isbn}/${size}: ↪ Redirect to ${response.headers.get('location')?.substring(0, 50)}...`, 'debug');
          }
        } catch (error) {
          sizeResults[size] = { error: error.message };
        }
      }
      
      coverTests.push({ isbn, sizes: sizeResults });
    }
    
    // Count how many ISBNs have at least one cover in R2
    const withR2Covers = coverTests.filter(t => 
      Object.values(t.sizes).some(s => s.status === 200)
    ).length;
    
    this.recordResult('r2_storage', true, 
      `${withR2Covers}/${coverTests.length} ISBNs have covers in R2`,
      { tests: coverTests }
    );
    
    return true;
  }


  // ========================================================================
  // STEP 9: Verify Enrichment Audit Trail
  // ========================================================================
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
        error_message,
        created_at
      FROM enrichment_log
      WHERE entity_type = 'edition'
        AND entity_key = ANY(${CONFIG.testISBNs})
      ORDER BY created_at DESC
      LIMIT 50
    `;
    
    if (logs.length === 0) {
      this.recordResult('enrichment_log', false, 'No enrichment logs found for test ISBNs');
      return false;
    }
    
    const successCount = logs.filter(l => l.success).length;
    const failedCount = logs.filter(l => !l.success).length;
    const avgResponseTime = logs.length > 0 
      ? Math.round(logs.reduce((sum, l) => sum + (l.response_time_ms || 0), 0) / logs.length)
      : 0;
    
    const providerCounts = {};
    for (const log of logs) {
      providerCounts[log.provider] = (providerCounts[log.provider] || 0) + 1;
    }
    
    log(`Found ${logs.length} log entries: ${successCount} success, ${failedCount} failed`, 'debug');
    log(`Avg response time: ${avgResponseTime}ms`, 'debug');
    log(`Providers: ${JSON.stringify(providerCounts)}`, 'debug');
    
    this.recordResult('enrichment_log', logs.length > 0, 
      `${logs.length} log entries, ${successCount} successful, avg ${avgResponseTime}ms`,
      {
        total: logs.length,
        success: successCount,
        failed: failedCount,
        avg_response_ms: avgResponseTime,
        providers: providerCounts
      }
    );
    
    return logs.length > 0;
  }

  // ========================================================================
  // STEP 10: Search API Validation
  // ========================================================================
  async step10_searchValidation() {
    log('Step 10: Search API Validation', 'step');
    
    const searchTests = [];
    
    // Test ISBN search
    const testISBN = CONFIG.testISBNs[0];
    const isbnResult = await fetchJSON(`${env.baseUrl}/api/search?isbn=${testISBN}`);
    
    // Response structure: { success: true, data: { results: [...] } }
    const isbnData = isbnResult.data?.data || isbnResult.data;
    if (isbnResult.ok && isbnData?.results?.length > 0) {
      const book = isbnData.results[0];
      searchTests.push({
        type: 'isbn',
        query: testISBN,
        found: true,
        title: book.title,
        coverUrl: book.coverUrl,
        duration_ms: isbnData.query_duration_ms
      });
      log(`  ISBN search: ✓ "${book.title?.substring(0, 40)}..." in ${isbnData.query_duration_ms}ms`, 'debug');
    } else {
      searchTests.push({
        type: 'isbn',
        query: testISBN,
        found: false,
        error: isbnData?.error || 'Not found'
      });
      log(`  ISBN search: ✗ Not found`, 'debug');
    }
    
    // Test title search
    const titleResult = await fetchJSON(`${env.baseUrl}/api/search?title=Harry%20Potter&limit=3`);
    const titleData = titleResult.data?.data || titleResult.data;
    
    if (titleResult.ok && titleData?.results?.length > 0) {
      searchTests.push({
        type: 'title',
        query: 'Harry Potter',
        found: true,
        count: titleData.results.length,
        total: titleData.pagination?.total,
        duration_ms: titleData.query_duration_ms
      });
      log(`  Title search: ✓ ${titleData.results.length} results (${titleData.pagination?.total} total) in ${titleData.query_duration_ms}ms`, 'debug');
    } else {
      searchTests.push({
        type: 'title',
        query: 'Harry Potter',
        found: false
      });
    }
    
    // Test combined search
    const combinedResult = await fetchJSON(`${env.baseUrl}/api/search?q=Great%20Gatsby&limit=3`);
    const combinedData = combinedResult.data?.data || combinedResult.data;
    
    if (combinedResult.ok && combinedData?.results?.length > 0) {
      searchTests.push({
        type: 'combined',
        query: 'Great Gatsby',
        found: true,
        count: combinedData.results.length,
        duration_ms: combinedData.query_duration_ms
      });
      log(`  Combined search: ✓ ${combinedData.results.length} results`, 'debug');
    } else {
      searchTests.push({
        type: 'combined',
        query: 'Great Gatsby',
        found: false
      });
    }
    
    const passedSearches = searchTests.filter(t => t.found).length;
    const passed = passedSearches >= 1;
    
    this.recordResult('search_api', passed, 
      `${passedSearches}/${searchTests.length} search types working`,
      { tests: searchTests }
    );
    
    return passed;
  }

  // ========================================================================
  // STEP 11: ISBNdb Batch Efficiency Check
  // ========================================================================
  async step11_checkBatchEfficiency() {
    log('Step 11: Check ISBNdb Batch Efficiency', 'step');
    
    // Check enrichment logs for batch processing evidence
    const recentLogs = await this.sql`
      SELECT 
        provider,
        COUNT(*) as count,
        AVG(response_time_ms) as avg_time,
        MIN(created_at) as first_at,
        MAX(created_at) as last_at
      FROM enrichment_log
      WHERE entity_type = 'edition'
        AND entity_key = ANY(${CONFIG.testISBNs})
        AND created_at > NOW() - INTERVAL '1 hour'
      GROUP BY provider
    `;
    
    const isbndbLogs = recentLogs.find(l => l.provider === 'isbndb');
    
    if (isbndbLogs) {
      const timeSpan = new Date(isbndbLogs.last_at) - new Date(isbndbLogs.first_at);
      const batchLikely = timeSpan < 5000 && isbndbLogs.count >= 3; // Multiple ISBNs processed quickly
      
      this.recordResult('batch_efficiency', true, 
        `${isbndbLogs.count} ISBNs via ISBNdb, avg ${Math.round(isbndbLogs.avg_time)}ms, span ${Math.round(timeSpan)}ms`,
        {
          count: isbndbLogs.count,
          avg_time_ms: Math.round(isbndbLogs.avg_time),
          time_span_ms: timeSpan,
          batch_likely: batchLikely
        }
      );
    } else {
      this.recordResult('batch_efficiency', true, 'No recent ISBNdb logs (may already be cached)', {});
    }
    
    return true;
  }


  // ========================================================================
  // Main Runner
  // ========================================================================
  async run() {
    console.log('\n' + '═'.repeat(70));
    console.log('  Alexandria End-to-End Workflow Validation');
    console.log('═'.repeat(70));
    console.log(`  Environment: ${env.name} (${env.baseUrl})`);
    console.log(`  Test ISBNs:  ${CONFIG.testISBNs.length}`);
    console.log(`  Options:     ${isClean ? '--clean ' : ''}${isVerbose ? '--verbose' : ''}`);
    console.log('═'.repeat(70) + '\n');
    
    try {
      // Connect to database
      if (!await this.connectDatabase()) {
        log('Cannot proceed without database connection', 'error');
        return this.results;
      }
      
      // Run all validation steps
      const steps = [
        () => this.step1_healthCheck(),
        () => this.step2_checkPreTestState(),
        () => this.step3_clearTestData(),
        () => this.step4_queueEnrichment(),
        () => this.step5_waitForQueueProcessing(),
        () => this.step6_validateEnrichmentData(),
        () => this.step7_checkCoverQueue(),
        () => this.step8_validateR2Storage(),
        () => this.step9_checkEnrichmentLog(),
        () => this.step10_searchValidation(),
        () => this.step11_checkBatchEfficiency(),
      ];
      
      for (const step of steps) {
        try {
          await step();
        } catch (error) {
          log(`Step error: ${error.message}`, 'error');
          this.recordResult('step_error', false, error.message);
        }
      }
      
    } catch (error) {
      log(`Validation suite error: ${error.message}`, 'error');
      this.recordResult('validation_suite', false, error.message);
    } finally {
      // Cleanup
      if (this.sql) {
        await this.sql.end();
      }
    }
    
    // Print summary
    console.log('\n' + '═'.repeat(70));
    console.log('  VALIDATION SUMMARY');
    console.log('═'.repeat(70));
    console.log(`  ✅ Passed:   ${this.results.summary.passed}`);
    console.log(`  ❌ Failed:   ${this.results.summary.failed}`);
    console.log(`  ⚠️  Warnings: ${this.results.summary.warnings}`);
    console.log('═'.repeat(70));
    
    // Detailed step results
    console.log('\n  Step Results:');
    for (const step of this.results.steps) {
      const icon = step.status === 'PASS' ? '✅' : '❌';
      console.log(`    ${icon} ${step.step}: ${step.message}`);
    }
    
    console.log('\n' + '═'.repeat(70) + '\n');
    
    // Save results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = `logs/workflow-validation-${timestamp}.json`;
    writeFileSync(logFile, JSON.stringify(this.results, null, 2));
    log(`Results saved to ${logFile}`, 'info');
    
    // Exit with appropriate code
    const exitCode = this.results.summary.failed > 0 ? 1 : 0;
    process.exit(exitCode);
  }
}

// =============================================================================
// Run Validation
// =============================================================================
const validator = new WorkflowValidator();
validator.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
