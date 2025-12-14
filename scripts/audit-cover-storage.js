#!/usr/bin/env node

/**
 * R2 Cover Storage Audit Script
 *
 * Audits R2 storage for duplicate cover images stored under different path schemes:
 * - covers/{work_key}/{hash}/original (legacy work-key based)
 * - isbn/{isbn}/{size}.webp (current ISBN-based)
 *
 * This script identifies:
 * 1. Covers stored in work-key paths (should be migrated)
 * 2. Covers stored in ISBN paths (current standard)
 * 3. Potential duplicates (same ISBN in both locations)
 *
 * Issue: https://github.com/ooheynerds/alexandria/issues/95
 *
 * Usage:
 *   node scripts/audit-cover-storage.js [--delete-duplicates] [--dry-run]
 *
 * Options:
 *   --delete-duplicates  Delete work-key based covers after verifying ISBN version exists
 *   --dry-run           Show what would be deleted without actually deleting
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const R2_BUCKET = 'bookstrack-covers-processed';
const WORK_KEY_PREFIX = 'covers/';
const ISBN_PREFIX = 'isbn/';

// Parse command line arguments
const args = process.argv.slice(2);
const DELETE_DUPLICATES = args.includes('--delete-duplicates');
const DRY_RUN = args.includes('--dry-run');

/**
 * List R2 objects with a given prefix
 */
async function listR2Objects(prefix, limit = 1000) {
  const objects = [];
  let cursor = null;

  console.log(`Listing objects with prefix: ${prefix}...`);

  do {
    const cursorArg = cursor ? `--cursor "${cursor}"` : '';
    const cmd = `cd /Users/juju/dev_repos/alex/worker && npx wrangler r2 object list ${R2_BUCKET} --prefix "${prefix}" --json ${cursorArg} 2>/dev/null || echo '{"objects":[]}'`;

    try {
      const { stdout } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

      // Handle wrangler output which may have extra text before JSON
      const jsonStart = stdout.indexOf('{');
      if (jsonStart === -1) {
        console.error('No JSON found in output');
        break;
      }

      const result = JSON.parse(stdout.slice(jsonStart));
      objects.push(...(result.objects || []));

      cursor = result.truncated ? result.cursor : null;

      if (objects.length % 1000 === 0 && objects.length > 0) {
        console.log(`  Found ${objects.length} objects so far...`);
      }
    } catch (error) {
      console.error(`Error listing objects: ${error.message}`);
      break;
    }
  } while (cursor);

  return objects;
}

/**
 * Extract ISBN from work-key object metadata
 */
async function getObjectMetadata(key) {
  try {
    const cmd = `cd /Users/juju/dev_repos/alex/worker && npx wrangler r2 object head ${R2_BUCKET}/${key} --json 2>/dev/null || echo '{}'`;
    const { stdout } = await execAsync(cmd);

    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) return null;

    return JSON.parse(stdout.slice(jsonStart));
  } catch (error) {
    return null;
  }
}

/**
 * Delete an R2 object
 */
async function deleteR2Object(key) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete: ${key}`);
    return true;
  }

  try {
    const cmd = `cd /Users/juju/dev_repos/alex/worker && npx wrangler r2 object delete ${R2_BUCKET}/${key} 2>/dev/null`;
    await execAsync(cmd);
    console.log(`  Deleted: ${key}`);
    return true;
  } catch (error) {
    console.error(`  Failed to delete ${key}: ${error.message}`);
    return false;
  }
}

/**
 * Extract ISBN from ISBN-path object key
 */
function extractISBNFromPath(key) {
  // isbn/9780439064873/large.webp -> 9780439064873
  const match = key.match(/^isbn\/(\d{10,13})\//);
  return match ? match[1] : null;
}

/**
 * Main audit function
 */
async function auditCoverStorage() {
  console.log('='.repeat(70));
  console.log('R2 Cover Storage Audit');
  console.log('Issue #95: Consolidate cover storage paths');
  console.log('='.repeat(70));
  console.log();

  if (DRY_RUN) {
    console.log('[DRY RUN MODE - No changes will be made]');
    console.log();
  }

  // 1. List work-key based covers
  console.log('Step 1: Scanning work-key based covers (covers/...)');
  const workKeyObjects = await listR2Objects(WORK_KEY_PREFIX);
  console.log(`  Found ${workKeyObjects.length} objects in work-key paths`);
  console.log();

  // 2. List ISBN-based covers
  console.log('Step 2: Scanning ISBN-based covers (isbn/...)');
  const isbnObjects = await listR2Objects(ISBN_PREFIX);
  console.log(`  Found ${isbnObjects.length} objects in ISBN paths`);
  console.log();

  // 3. Build ISBN lookup set from ISBN-path objects
  console.log('Step 3: Building ISBN lookup index...');
  const isbnSet = new Set();
  for (const obj of isbnObjects) {
    const isbn = extractISBNFromPath(obj.key);
    if (isbn) {
      isbnSet.add(isbn);
    }
  }
  console.log(`  Indexed ${isbnSet.size} unique ISBNs in ISBN-based storage`);
  console.log();

  // 4. Analyze work-key objects for potential duplicates
  console.log('Step 4: Analyzing work-key objects for duplicates...');

  const stats = {
    workKeyTotal: workKeyObjects.length,
    isbnTotal: isbnObjects.length,
    withISBNMetadata: 0,
    duplicates: 0,
    orphans: 0,
    noMetadata: 0,
    deletedCount: 0,
    bytesRecovered: 0,
  };

  const duplicates = [];
  const orphans = [];

  // Sample first 100 for metadata analysis (full scan would be too slow)
  const sampleSize = Math.min(workKeyObjects.length, 100);
  console.log(`  Sampling ${sampleSize} work-key objects for metadata analysis...`);

  for (let i = 0; i < sampleSize; i++) {
    const obj = workKeyObjects[i];
    process.stdout.write(`\r  Analyzing ${i + 1}/${sampleSize}...`);

    const metadata = await getObjectMetadata(obj.key);

    if (metadata?.customMetadata?.isbn) {
      const isbn = metadata.customMetadata.isbn.replace(/[-\s]/g, '');
      stats.withISBNMetadata++;

      if (isbnSet.has(isbn)) {
        stats.duplicates++;
        duplicates.push({
          key: obj.key,
          isbn,
          size: obj.size,
          metadata,
        });
      } else {
        stats.orphans++;
        orphans.push({
          key: obj.key,
          isbn,
          size: obj.size,
          metadata,
        });
      }
    } else {
      stats.noMetadata++;
    }
  }
  console.log(); // Clear progress line
  console.log();

  // 5. Report findings
  console.log('='.repeat(70));
  console.log('AUDIT RESULTS');
  console.log('='.repeat(70));
  console.log();

  console.log('Storage Statistics:');
  console.log(`  Work-key based objects: ${stats.workKeyTotal}`);
  console.log(`  ISBN-based objects: ${stats.isbnTotal}`);
  console.log();

  console.log(`Sample Analysis (${sampleSize} work-key objects):`);
  console.log(`  With ISBN metadata: ${stats.withISBNMetadata}`);
  console.log(`  Duplicates (also in ISBN path): ${stats.duplicates}`);
  console.log(`  Orphans (only in work-key path): ${stats.orphans}`);
  console.log(`  No ISBN metadata: ${stats.noMetadata}`);
  console.log();

  if (duplicates.length > 0) {
    console.log('Duplicate Objects (safe to delete):');
    for (const dup of duplicates.slice(0, 10)) {
      console.log(`  ${dup.key}`);
      console.log(`    ISBN: ${dup.isbn}, Size: ${dup.size} bytes`);
    }
    if (duplicates.length > 10) {
      console.log(`  ... and ${duplicates.length - 10} more`);
    }
    console.log();
  }

  if (orphans.length > 0) {
    console.log('Orphan Objects (need migration, no ISBN-path version):');
    for (const orphan of orphans.slice(0, 10)) {
      console.log(`  ${orphan.key}`);
      console.log(`    ISBN: ${orphan.isbn}, Size: ${orphan.size} bytes`);
    }
    if (orphans.length > 10) {
      console.log(`  ... and ${orphans.length - 10} more`);
    }
    console.log();
  }

  // 6. Delete duplicates if requested
  if (DELETE_DUPLICATES && duplicates.length > 0) {
    console.log('='.repeat(70));
    console.log('DELETING DUPLICATES');
    console.log('='.repeat(70));
    console.log();

    for (const dup of duplicates) {
      const success = await deleteR2Object(dup.key);
      if (success) {
        stats.deletedCount++;
        stats.bytesRecovered += dup.size || 0;
      }
    }

    console.log();
    console.log(`Deleted ${stats.deletedCount} duplicate objects`);
    console.log(`Recovered ${(stats.bytesRecovered / 1024 / 1024).toFixed(2)} MB`);
  }

  // 7. Summary and recommendations
  console.log();
  console.log('='.repeat(70));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(70));
  console.log();

  if (stats.workKeyTotal > 0) {
    console.log('1. DUPLICATES: Run with --delete-duplicates to remove work-key');
    console.log('   objects that already have ISBN-based versions.');
    console.log();
    console.log('2. ORPHANS: Objects only in work-key paths need manual migration.');
    console.log('   Consider re-processing these through the cover pipeline.');
    console.log();
    console.log('3. NO METADATA: Work-key objects without ISBN metadata cannot');
    console.log('   be automatically migrated. Manual review recommended.');
    console.log();
  } else {
    console.log('All covers are already using ISBN-based storage paths!');
  }

  // Estimated storage savings
  if (stats.workKeyTotal > 0) {
    const avgSize = stats.isbnTotal > 0
      ? isbnObjects.reduce((sum, o) => sum + (o.size || 0), 0) / isbnObjects.length
      : 100000; // 100KB estimate
    const potentialSavings = stats.duplicates * avgSize;
    console.log(`Potential storage savings: ~${(potentialSavings / 1024 / 1024).toFixed(2)} MB`);
  }

  console.log();
  console.log('Audit complete.');
}

// Run the audit
auditCoverStorage().catch(error => {
  console.error('Audit failed:', error);
  process.exit(1);
});
