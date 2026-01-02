/**
 * Migration Execution Endpoint (TEMPORARY)
 *
 * This endpoint executes migration 003 directly via Hyperdrive.
 * DELETE THIS FILE after migration is complete!
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';
import postgres from 'postgres';

const app = new OpenAPIHono<AppBindings>();

// POST /api/migrate/003 - Execute Migration 003
const executeMigration003Route = createRoute({
  method: 'post',
  path: '/api/migrate/003',
  tags: ['Migration'],
  summary: 'Execute Migration 003 (Wikidata schema)',
  description: 'Executes the Wikidata diversity enrichment schema migration. **DANGEROUS: Only run once!**',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            confirm: z.literal('EXECUTE_MIGRATION_003'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Migration executed successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            stats: z.object({
              total_authors: z.number(),
              with_wikidata_id: z.number(),
              pending_enrichment: z.number(),
              with_birth_year: z.number(),
              with_bio: z.number(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'Confirmation required',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
});

app.openapi(executeMigration003Route, async (c) => {
  const { confirm } = c.req.valid('json');

  if (confirm !== 'EXECUTE_MIGRATION_003') {
    return c.json({ error: 'Confirmation required: send {"confirm": "EXECUTE_MIGRATION_003"}' }, 400);
  }

  const sql = postgres(c.env.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });

  try {
    console.log('[Migration 003] Starting execution...');

    // Execute migration SQL (embedded to avoid file read issues)
    await sql.begin(async (transaction) => {
      // Phase 1A: Add columns
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

      console.log('[Migration 003] ✓ Columns added');

      // Phase 1B: Create indexes
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

      console.log('[Migration 003] ✓ Indexes created');

      // Phase 2: Seed wikidata_id from OpenLibrary
      // First, ensure enriched_authors has all OL authors
      await transaction`
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
      `;

      console.log('[Migration 003] ✓ Authors synced from OpenLibrary');

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

      console.log(`[Migration 003] ✓ Seeded ${wikidataSeeded.length} Wikidata IDs`);

      // Seed birth_year
      await transaction`
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
      `;

      // Seed bio
      await transaction`
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
      `;

      console.log('[Migration 003] ✓ Seeded birth_year and bio');
    });

    // Get statistics
    const stats = await sql`
      SELECT
        (SELECT COUNT(*) FROM enriched_authors) as total_authors,
        (SELECT COUNT(*) FROM enriched_authors WHERE wikidata_id IS NOT NULL) as with_wikidata_id,
        (SELECT COUNT(*) FROM enriched_authors WHERE wikidata_id IS NOT NULL AND wikidata_enriched_at IS NULL) as pending_enrichment,
        (SELECT COUNT(*) FROM enriched_authors WHERE birth_year IS NOT NULL) as with_birth_year,
        (SELECT COUNT(*) FROM enriched_authors WHERE bio IS NOT NULL) as with_bio
    `;

    console.log('[Migration 003] ✓ Migration complete!');

    return c.json({
      success: true,
      message: 'Migration 003 executed successfully',
      stats: {
        total_authors: Number(stats[0].total_authors),
        with_wikidata_id: Number(stats[0].with_wikidata_id),
        pending_enrichment: Number(stats[0].pending_enrichment),
        with_birth_year: Number(stats[0].with_birth_year),
        with_bio: Number(stats[0].with_bio),
      },
    });

  } catch (error) {
    console.error('[Migration 003] Full error:', error);
    return c.json({
      error: 'Migration failed. Check server logs for details.',
    }, 500);
  } finally {
    await sql.end();
  }
});

export default app;
