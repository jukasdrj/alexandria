#!/usr/bin/env node
/**
 * Author Deduplication Analysis Script
 *
 * Analyzes author name duplication patterns in enriched_authors table
 * to inform normalization strategy for Issue #114
 */

const ALEXANDRIA_API = 'https://alexandria.ooheynerds.com';

async function analyzeDuplicates() {
  console.log('🔍 Alexandria Author Deduplication Analysis\n');

  // First, get overall statistics
  const statsResponse = await fetch(`${ALEXANDRIA_API}/api/authors/enrich-status`);
  const stats = await statsResponse.json();

  console.log('📊 Overall Statistics:');
  console.log(`  Total Authors: ${stats.total_authors.toLocaleString()}`);
  console.log(`  With Wikidata ID: ${stats.has_wikidata_id.toLocaleString()}`);
  console.log(`  Wikidata Enriched: ${stats.wikidata_enriched.toLocaleString()}\n`);

  // Analyze specific duplication patterns
  console.log('🔎 Analyzing Duplication Patterns...\n');

  // Test cases of known duplicates
  const testCases = [
    'Stephen King',
    'J.K. Rowling',
    'J. K. Rowling',
    'Joanne Rowling',
    'Brandon Sanderson',
    'Neil Gaiman',
    'Isaac Asimov',
    'Agatha Christie',
    'Dr. Seuss'
  ];

  console.log('📝 Sample Author Searches:');
  for (const name of testCases) {
    try {
      const response = await fetch(
        `${ALEXANDRIA_API}/api/search?author=${encodeURIComponent(name)}&limit=5`
      );
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const uniqueAuthors = new Set(
          data.results.map(r => r.author_name).filter(Boolean)
        );
        console.log(`  "${name}": ${uniqueAuthors.size} unique variations found`);
        if (uniqueAuthors.size > 1) {
          uniqueAuthors.forEach(a => console.log(`    - ${a}`));
        }
      }
    } catch (error) {
      console.log(`  "${name}": Error - ${error.message}`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\n📋 Normalization Strategy Recommendations:\n');
  console.log('1. Add `normalized_name` column (TEXT)');
  console.log('   - Lowercase for case-insensitive comparison');
  console.log('   - Trim whitespace (TRIM)');
  console.log('   - Standardize punctuation (". " → ".")');
  console.log('   - Remove extra spaces (multiple → single)');
  console.log('   - Handle co-authors (extract primary or create junction)');
  console.log('');
  console.log('2. PostgreSQL Normalization Function:');
  console.log('   CREATE FUNCTION normalize_author_name(name TEXT)');
  console.log('   - Apply rules consistently');
  console.log('   - Make it immutable for index usage');
  console.log('');
  console.log('3. GIN Trigram Index on `normalized_name`:');
  console.log('   - Enables fuzzy search on normalized form');
  console.log('   - Better deduplication detection');
  console.log('');
  console.log('4. Update Search Logic:');
  console.log('   - Search on `normalized_name`');
  console.log('   - Display original `name` field');
  console.log('   - Group by `normalized_name` for dedup');
  console.log('');
  console.log('5. Handle Co-Authors:');
  console.log('   - Decision: Split "A & B" → link to both authors');
  console.log('   - OR: Extract primary author only');
  console.log('   - Store co-author relationships separately');
  console.log('');

  console.log('✅ Analysis Complete!\n');
  console.log('Next Steps:');
  console.log('1. Review migration file: migrations/005_add_author_normalization.sql');
  console.log('2. Test normalization function with sample data');
  console.log('3. Run backfill migration');
  console.log('4. Update search endpoints to use normalized_name');
  console.log('5. Add integration tests');
}

analyzeDuplicates().catch(console.error);
