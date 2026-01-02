#!/usr/bin/env node
/**
 * Execute Migration 003 via Cloudflare Tunnel
 *
 * This script connects to PostgreSQL through the Cloudflare Tunnel
 * and executes the Wikidata diversity enrichment migration.
 */

import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connection string from environment variable
const connectionString = process.env.DATABASE_URL ||
  (() => {
    console.error('❌ ERROR: DATABASE_URL environment variable not set');
    console.error('Usage: DATABASE_URL=postgres://user:pass@host:port/db npm run migrate-003');
    process.exit(1);
  })();

console.log('🚀 Starting Migration 003 execution...\n');

const sql = postgres(connectionString, {
  max: 1,
  ssl: { rejectUnauthorized: false }, // Self-signed cert
  connect_timeout: 30,
});

try {
  console.log('✓ Connected to PostgreSQL via Cloudflare Tunnel');

  // Execute migration in transaction
  await sql.begin(async (transaction) => {
    console.log('\n📋 Phase 1A: Adding Wikidata columns...');

    // Add columns
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS gender_qid TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS citizenship_qid TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_place TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_place_qid TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_country TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_country_qid TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS death_place TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS death_place_qid TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikidata_enriched_at TIMESTAMPTZ`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS enrichment_source TEXT`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS occupations TEXT[]`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS languages TEXT[]`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS awards TEXT[]`;
    await transaction`ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS literary_movements TEXT[]`;

    console.log('  ✓ Columns added');

    console.log('\n📋 Phase 1B: Creating indexes...');

    await transaction`
      CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_pending
      ON enriched_authors (author_key)
      WHERE wikidata_id IS NOT NULL AND wikidata_enriched_at IS NULL
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_id
      ON enriched_authors (wikidata_id)
      WHERE wikidata_id IS NOT NULL
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_sync
      ON enriched_authors (wikidata_enriched_at DESC)
      WHERE wikidata_id IS NOT NULL
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS idx_enriched_authors_has_gender
      ON enriched_authors (author_key)
      WHERE gender IS NOT NULL AND gender != 'Unknown'
    `;

    console.log('  ✓ Indexes created');

    console.log('\n📋 Phase 2: Seeding data from OpenLibrary...');

    // Ensure all OL authors exist in enriched_authors
    const newAuthors = await transaction`
      INSERT INTO enriched_authors (author_key, name, openlibrary_author_id)
      SELECT
          a.key as author_key,
          a.data->>'name' as name,
          a.key as openlibrary_author_id
      FROM authors a
      WHERE a.data->>'name' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM enriched_authors ea WHERE ea.author_key = a.key
        )
      ON CONFLICT (author_key) DO NOTHING
      RETURNING author_key
    `;

    console.log(`  ✓ Synced ${newAuthors.length} new authors from OpenLibrary`);

    // Seed wikidata_id
    const wikidataSeeded = await transaction`
      UPDATE enriched_authors ea
      SET
          wikidata_id = a.data->'remote_ids'->>'wikidata',
          updated_at = NOW()
      FROM authors a
      WHERE ea.author_key = a.key
        AND a.data->'remote_ids'->>'wikidata' IS NOT NULL
        AND ea.wikidata_id IS NULL
      RETURNING ea.author_key
    `;

    console.log(`  ✓ Seeded ${wikidataSeeded.length} Wikidata IDs`);

    // Seed birth_year
    const birthYearSeeded = await transaction`
      UPDATE enriched_authors ea
      SET
          birth_year = CASE
              WHEN a.data->>'birth_date' ~ '^\d{4}'
              THEN SUBSTRING(a.data->>'birth_date' FROM '^\d{4}')::INTEGER
              ELSE NULL
          END,
          updated_at = NOW()
      FROM authors a
      WHERE ea.author_key = a.key
        AND ea.birth_year IS NULL
        AND a.data->>'birth_date' IS NOT NULL
        AND a.data->>'birth_date' ~ '^\d{4}'
      RETURNING ea.author_key
    `;

    console.log(`  ✓ Seeded ${birthYearSeeded.length} birth years`);

    // Seed bio
    const bioSeeded = await transaction`
      UPDATE enriched_authors ea
      SET
          bio = CASE
              WHEN jsonb_typeof(a.data->'bio') = 'string' THEN a.data->>'bio'
              WHEN jsonb_typeof(a.data->'bio') = 'object' THEN a.data->'bio'->>'value'
              ELSE NULL
          END,
          bio_source = 'openlibrary',
          updated_at = NOW()
      FROM authors a
      WHERE ea.author_key = a.key
        AND ea.bio IS NULL
        AND a.data->'bio' IS NOT NULL
      RETURNING ea.author_key
    `;

    console.log(`  ✓ Seeded ${bioSeeded.length} bios`);
  });

  console.log('\n📊 Fetching statistics...');

  const stats = await sql`
    SELECT
      (SELECT COUNT(*) FROM enriched_authors) as total_authors,
      (SELECT COUNT(*) FROM enriched_authors WHERE wikidata_id IS NOT NULL) as with_wikidata_id,
      (SELECT COUNT(*) FROM enriched_authors WHERE wikidata_id IS NOT NULL AND wikidata_enriched_at IS NULL) as pending_enrichment,
      (SELECT COUNT(*) FROM enriched_authors WHERE birth_year IS NOT NULL) as with_birth_year,
      (SELECT COUNT(*) FROM enriched_authors WHERE bio IS NOT NULL) as with_bio
  `;

  console.log('\n✅ Migration 003 Complete!\n');
  console.log('Statistics:');
  console.log(`  Total authors: ${stats[0].total_authors.toLocaleString()}`);
  console.log(`  With Wikidata ID: ${stats[0].with_wikidata_id.toLocaleString()}`);
  console.log(`  Pending enrichment: ${stats[0].pending_enrichment.toLocaleString()}`);
  console.log(`  With birth year: ${stats[0].with_birth_year.toLocaleString()}`);
  console.log(`  With bio: ${stats[0].with_bio.toLocaleString()}`);

  console.log('\n🎉 Next step: Run Wikidata enrichment:');
  console.log('  curl -X POST https://alexandria.ooheynerds.com/api/authors/enrich-wikidata \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"limit": 100}\'');

} catch (error) {
  console.error('\n❌ Migration failed:');
  console.error(error);
  process.exit(1);
} finally {
  await sql.end();
  console.log('\n✓ Database connection closed');
}
