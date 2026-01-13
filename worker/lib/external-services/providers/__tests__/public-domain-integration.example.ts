/**
 * Public Domain Detection Integration Example
 *
 * Demonstrates how to use the Public Domain capability with Archive.org as a fallback
 * to Google Books.
 *
 * This example shows:
 * 1. Google Books (primary) - API-verified public domain status
 * 2. Archive.org (fallback) - Date-based heuristic for public domain detection
 *
 * Usage:
 * - Copy this code into a test or route handler
 * - Replace mock data with real ServiceContext
 * - Archive.org provides fallback when Google Books lacks data
 *
 * @module lib/external-services/providers/__tests__/public-domain-integration.example
 */

import { ArchiveOrgProvider } from '../archive-org-provider.js';
import { GoogleBooksProvider } from '../google-books-provider.js';
import { getGlobalRegistry } from '../../provider-registry.js';
import { ServiceCapability } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

/**
 * Example: Check public domain status with cascading fallback
 *
 * This function demonstrates the recommended pattern:
 * 1. Try Google Books first (API-verified, high confidence: 95)
 * 2. Fall back to Archive.org (heuristic, medium-high confidence: 60-90)
 */
async function examplePublicDomainCheck() {
  // Register providers
  const registry = getGlobalRegistry();
  registry.registerAll([
    new GoogleBooksProvider(),
    new ArchiveOrgProvider(),
  ]);

  // Mock context (replace with real context in production)
  const mockContext: ServiceContext = {
    env: {} as Env,
    logger: {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    } as any,
  };

  // Get all providers that support public domain detection
  const publicDomainProviders = registry.getProvidersByCapability(
    ServiceCapability.PUBLIC_DOMAIN
  );

  console.log(`Found ${publicDomainProviders.length} public domain providers:`);
  publicDomainProviders.forEach((p) => {
    console.log(`  - ${p.name} (${p.providerType})`);
  });

  // Example ISBNs to test
  const testISBNs = [
    { isbn: '9780141439518', title: 'Pride and Prejudice', year: 1813 },
    { isbn: '9780451524935', title: '1984', year: 1949 },
    { isbn: '9780439708180', title: 'Harry Potter', year: 1997 },
  ];

  for (const { isbn, title, year } of testISBNs) {
    console.log(`\n--- Checking: ${title} (${year}) ---`);

    // Try each provider in sequence
    for (const provider of publicDomainProviders) {
      console.log(`Trying ${provider.name}...`);

      if ('checkPublicDomain' in provider) {
        const result = await (provider as any).checkPublicDomain(isbn, mockContext);

        if (result) {
          console.log(`✓ Result from ${provider.name}:`, {
            isPublicDomain: result.isPublicDomain,
            confidence: result.confidence,
            reason: result.reason,
            downloadUrl: result.downloadUrl,
          });
          break; // Stop on first success
        } else {
          console.log(`✗ No result from ${provider.name}`);
        }
      }
    }
  }
}

/**
 * Example: Archive.org public domain heuristic breakdown
 *
 * Shows how Archive.org determines public domain status based on publication year.
 */
function exampleArchiveOrgHeuristic() {
  console.log('\n=== Archive.org Public Domain Heuristic ===');
  console.log('Based on US copyright law:\n');

  const examples = [
    {
      year: 1813,
      status: 'Public Domain',
      confidence: 90,
      reason: 'Published before 1928',
    },
    {
      year: 1949,
      status: 'Possibly Public Domain',
      confidence: 60,
      reason: '1928-1977 (depends on copyright renewal)',
    },
    {
      year: 1997,
      status: 'Not Public Domain',
      confidence: 90,
      reason: 'Published after 1977',
    },
  ];

  examples.forEach(({ year, status, confidence, reason }) => {
    console.log(`${year}: ${status} (confidence: ${confidence})`);
    console.log(`  Reason: ${reason}\n`);
  });
}

/**
 * Example: Why Archive.org is a fallback, not primary
 *
 * Explains the confidence scoring difference.
 */
function exampleConfidenceComparison() {
  console.log('\n=== Provider Confidence Comparison ===\n');

  console.log('Google Books (PRIMARY):');
  console.log('  - Confidence: 95');
  console.log('  - Reason: api-verified (explicit flag from Google)');
  console.log('  - Best for: All books in Google catalog');
  console.log('  - Limitations: Not all books have access info\n');

  console.log('Archive.org (FALLBACK):');
  console.log('  - Confidence: 60-90 (depends on publication year)');
  console.log('  - Reason: publication-date (heuristic based on US copyright law)');
  console.log('  - Best for: Pre-2000 books, historical texts');
  console.log('  - Limitations: Cannot verify copyright renewal for 1928-1977 books\n');

  console.log('RECOMMENDATION: Try Google Books first, fall back to Archive.org');
}

// Run examples (commented out - uncomment to test)
// examplePublicDomainCheck();
// exampleArchiveOrgHeuristic();
// exampleConfidenceComparison();
