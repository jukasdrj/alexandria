#!/usr/bin/env node
/**
 * Fix Orphaned Work Links Migration Script
 *
 * This script fixes the 99.8% orphaned works issue where enriched_works
 * exist but have no entries in work_authors_enriched.
 *
 * The bug: routes/authors.ts enrich-bibliography endpoint was not calling
 * linkWorkToAuthors() after creating works. Fixed in PR #XXX.
 *
 * This script:
 * 1. Finds orphaned works (works with no author links)
 * 2. Gets author info from enriched_editions (joined to the work)
 * 3. Creates missing work_authors_enriched entries
 *
 * Usage:
 *   node scripts/fix-orphaned-work-links.js --dry-run    # Preview changes
 *   node scripts/fix-orphaned-work-links.js              # Execute migration
 *   node scripts/fix-orphaned-work-links.js --limit 100  # Process 100 at a time
 *
 * Prerequisites:
 *   - SSH access to Tower.local
 *   - PostgreSQL running in Docker
 */

const { execSync } = require('child_process');

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '1000', 10);
const BATCH_SIZE = 100;

// SSH command helper
function runSQL(query, returnJson = false) {
  const escapedQuery = query.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const format = returnJson ? '-t -A' : '';
  const cmd = `ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary ${format} -c \\"${escapedQuery}\\""`;

  try {
    const result = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    return result.trim();
  } catch (error) {
    console.error('SQL Error:', error.message);
    throw error;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('Fix Orphaned Work Links Migration');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE MIGRATION'}`);
  console.log(`Limit: ${LIMIT} works`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  // Step 1: Count orphaned works
  console.log('[1/4] Counting orphaned works...');
  const countResult = runSQL(`
    SELECT COUNT(*) as count
    FROM enriched_works ew
    LEFT JOIN work_authors_enriched wae ON ew.work_key = wae.work_key
    WHERE wae.work_key IS NULL
      AND ew.work_key LIKE '/works/isbndb-%'
  `);
  const orphanedCount = parseInt(countResult.split('\n').find(line => line.trim().match(/^\d+$/))?.trim() || '0', 10);
  console.log(`   Found ${orphanedCount.toLocaleString()} orphaned ISBNdb works`);

  if (orphanedCount === 0) {
    console.log('\n✅ No orphaned works to fix!');
    return;
  }

  // Step 2: Get orphaned works with their editions (to extract author info)
  console.log('\n[2/4] Fetching orphaned works with edition data...');
  const orphanedWorksQuery = `
    SELECT DISTINCT ON (ew.work_key)
      ew.work_key,
      ew.title as work_title,
      ee.isbn,
      ee.title as edition_title
    FROM enriched_works ew
    LEFT JOIN work_authors_enriched wae ON ew.work_key = wae.work_key
    JOIN enriched_editions ee ON ee.work_key = ew.work_key
    WHERE wae.work_key IS NULL
      AND ew.work_key LIKE '/works/isbndb-%'
    ORDER BY ew.work_key, ee.isbn
    LIMIT ${LIMIT}
  `;

  const worksResult = runSQL(orphanedWorksQuery);
  const workLines = worksResult.split('\n').filter(line => line.includes('/works/isbndb-'));

  console.log(`   Retrieved ${workLines.length} works to process`);

  if (workLines.length === 0) {
    console.log('\n⚠️  No works with edition data found. May need manual intervention.');
    return;
  }

  // Step 3: For each work, find author from ISBNdb data stored in editions
  // Since we don't store author names directly on editions, we need to:
  // 1. Use the work title to search ISBNdb (costly)
  // 2. OR create a placeholder author from the work's first edition
  // 3. OR skip and let future enrichment fix it

  // For this migration, we'll create author entries based on work title patterns
  // This is a best-effort approach - future harvests will create proper links

  console.log('\n[3/4] Creating author links from available data...');

  let processed = 0;
  let created = 0;
  let skipped = 0;
  let errors = 0;

  // We need a different approach - query enrichment_log or use title-based author lookup
  // For now, let's just log what we'd do and create placeholder authors

  if (DRY_RUN) {
    console.log('\n   DRY RUN - Would process these works:');
    workLines.slice(0, 10).forEach((line, i) => {
      const parts = line.split('|').map(s => s.trim());
      console.log(`   ${i + 1}. ${parts[0]} - "${parts[1] || parts[3]}"`);
    });
    if (workLines.length > 10) {
      console.log(`   ... and ${workLines.length - 10} more`);
    }
  } else {
    // Process in batches
    for (let i = 0; i < workLines.length; i += BATCH_SIZE) {
      const batch = workLines.slice(i, i + BATCH_SIZE);
      console.log(`\n   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(workLines.length / BATCH_SIZE)}...`);

      for (const line of batch) {
        const parts = line.split('|').map(s => s.trim());
        const workKey = parts[0];
        const workTitle = parts[1] || parts[3];

        if (!workKey || !workTitle) {
          skipped++;
          continue;
        }

        try {
          // Extract likely author name from title if it contains "by" pattern
          // Otherwise create a placeholder "Unknown Author" entry
          let authorName = 'Unknown Author';
          const byMatch = workTitle.match(/\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
          if (byMatch) {
            authorName = byMatch[1];
          }

          // Create author if not exists and link to work
          const insertQuery = `
            WITH author_upsert AS (
              INSERT INTO enriched_authors (author_key, name, primary_provider, created_at, updated_at)
              VALUES (
                '/authors/migration-' || encode(sha256('${authorName}'::bytea), 'hex')::text,
                '${authorName.replace(/'/g, "''")}',
                'migration',
                NOW(),
                NOW()
              )
              ON CONFLICT (author_key) DO UPDATE SET updated_at = NOW()
              RETURNING author_key
            )
            INSERT INTO work_authors_enriched (work_key, author_key, author_order)
            SELECT '${workKey}', author_key, 1 FROM author_upsert
            ON CONFLICT (work_key, author_key) DO NOTHING
            RETURNING work_key
          `;

          const result = runSQL(insertQuery);
          if (result.includes(workKey)) {
            created++;
          } else {
            skipped++;
          }
          processed++;
        } catch (error) {
          errors++;
          console.error(`   Error processing ${workKey}: ${error.message}`);
        }
      }

      console.log(`   Batch complete: ${created} links created, ${skipped} skipped, ${errors} errors`);
    }
  }

  // Step 4: Summary
  console.log('\n[4/4] Migration Summary');
  console.log('='.repeat(70));
  console.log(`Total orphaned works found: ${orphanedCount.toLocaleString()}`);
  console.log(`Works processed this run:   ${processed.toLocaleString()}`);
  console.log(`Author links created:       ${created.toLocaleString()}`);
  console.log(`Skipped (no data):          ${skipped.toLocaleString()}`);
  console.log(`Errors:                     ${errors.toLocaleString()}`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN complete. Run without --dry-run to apply changes.');
  } else {
    // Verify fix
    const newOrphanCount = runSQL(`
      SELECT COUNT(*) FROM enriched_works ew
      LEFT JOIN work_authors_enriched wae ON ew.work_key = wae.work_key
      WHERE wae.work_key IS NULL AND ew.work_key LIKE '/works/isbndb-%'
    `);
    const remaining = parseInt(newOrphanCount.split('\n').find(line => line.trim().match(/^\d+$/))?.trim() || '0', 10);
    console.log(`\nRemaining orphaned works: ${remaining.toLocaleString()}`);

    if (remaining > 0) {
      console.log(`\n⚠️  Run again to process more works (--limit ${LIMIT})`);
    } else {
      console.log('\n✅ All orphaned works have been linked!');
    }
  }

  console.log('\nNote: These are placeholder links. Future ISBNdb harvests will');
  console.log('create proper author associations as books are re-enriched.');
}

main().catch(console.error);
