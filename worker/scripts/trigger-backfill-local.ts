#!/usr/bin/env tsx
/**
 * Local script to trigger backfill via deployed worker
 * Uses the secret from Cloudflare's secret store (you'll need to provide it)
 */

const WEBHOOK_SECRET = process.env.ALEXANDRIA_WEBHOOK_SECRET;
const BASE_URL = 'https://alexandria.ooheynerds.com';

if (!WEBHOOK_SECRET) {
  console.error('❌ Error: ALEXANDRIA_WEBHOOK_SECRET environment variable not set');
  console.error('\nPlease retrieve it from Cloudflare Dashboard:');
  console.error('  Workers → alexandria → Settings → Variables → Secrets');
  console.error('\nThen run:');
  console.error('  export ALEXANDRIA_WEBHOOK_SECRET="your-secret-here"');
  console.error('  npx tsx scripts/trigger-backfill-local.ts');
  process.exit(1);
}

interface BackfillRequest {
  batch_size: number;
  year_range?: {
    start: number;
    end: number;
  };
  dry_run: boolean;
  force_retry?: boolean;
}

async function checkStats() {
  console.log('📊 Checking current backfill statistics...\n');

  const response = await fetch(`${BASE_URL}/api/internal/backfill-stats`, {
    headers: {
      'X-Cron-Secret': WEBHOOK_SECRET!,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch stats: ${response.status} - ${error}`);
  }

  const stats = await response.json();
  console.log(JSON.stringify(stats, null, 2));
  console.log('');
  return stats;
}

async function scheduleBackfill(request: BackfillRequest) {
  console.log('🚀 Scheduling backfill...');
  console.log(`   Batch size: ${request.batch_size} months`);
  console.log(`   Year range: ${request.year_range?.start || 'default'} - ${request.year_range?.end || 'default'}`);
  console.log(`   Dry run: ${request.dry_run}`);
  console.log('');

  const response = await fetch(`${BASE_URL}/api/internal/schedule-backfill`, {
    method: 'POST',
    headers: {
      'X-Cron-Secret': WEBHOOK_SECRET!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to schedule backfill: ${response.status} - ${error}`);
  }

  const result = await response.json();
  console.log('✅ Backfill scheduled successfully!\n');
  console.log(JSON.stringify(result, null, 2));
  console.log('');
  return result;
}

async function main() {
  console.log('📚 Alexandria Backfill Scheduler - Phase 1 Validation\n');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Step 1: Check current stats
    await checkStats();

    // Step 2: Run Phase 1 - 5 months from 2020 (dry run first)
    console.log('Phase 1: Validation Run (Dry Run)');
    console.log('-'.repeat(60));
    await scheduleBackfill({
      batch_size: 5,
      year_range: { start: 2020, end: 2020 },
      dry_run: true,
    });

    // Step 3: Confirm before proceeding
    console.log('⚠️  This was a dry run. To execute for real, run:');
    console.log('');
    console.log('   ALEXANDRIA_WEBHOOK_SECRET="..." npx tsx scripts/trigger-backfill-local.ts --execute');
    console.log('');

    if (process.argv.includes('--execute')) {
      console.log('Phase 1: Validation Run (LIVE)');
      console.log('-'.repeat(60));
      await scheduleBackfill({
        batch_size: 5,
        year_range: { start: 2020, end: 2020 },
        dry_run: false,
      });

      console.log('⏳ Waiting 30 seconds for queue processing...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));

      console.log('📊 Updated statistics:');
      console.log('-'.repeat(60));
      await checkStats();
    }

    console.log('✅ Done!\n');
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
