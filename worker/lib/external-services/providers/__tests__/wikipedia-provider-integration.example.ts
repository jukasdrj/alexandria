/**
 * Wikipedia Provider Integration Example
 *
 * This example demonstrates how to use the WikipediaProvider
 * to fetch author biographies through the service provider framework.
 *
 * USAGE:
 * 1. Ensure you have a database connection (sql) available
 * 2. Create a ServiceContext with the required dependencies
 * 3. Call fetchBiography() with an author key
 *
 * The provider automatically:
 * - Looks up the author's Wikidata QID from the database
 * - Uses Wikidata API for exact Wikipedia page title resolution
 * - Falls back to name-based search if no Wikidata QID exists
 * - Fetches and caches the biography with structured data
 * - Returns null on errors (never throws)
 */

import { WikipediaProvider } from '../wikipedia-provider.js';
import { createServiceContext } from '../../service-context.js';
import type { Sql } from 'postgres';
import type { Env } from '../../../../src/env.js';
import type { Logger } from '../../../logger.js';

async function exampleUsage(
  sql: Sql,
  env: Env,
  logger: Logger
) {
  // Create the Wikipedia provider
  const provider = new WikipediaProvider();

  // Create a service context with database access
  const context = createServiceContext(env, logger, {
    sql, // CRITICAL: Wikipedia provider requires database access
  });

  // Check if the provider is available (always true for free services)
  const isAvailable = await provider.isAvailable(env);
  console.log('Wikipedia provider available:', isAvailable);

  // Fetch biography for J.K. Rowling
  const biography = await provider.fetchBiography(
    '/authors/OL23919A',
    context
  );

  if (biography) {
    console.log('Biography found:');
    console.log('- Author:', biography.name);
    console.log('- Extract:', biography.biography.substring(0, 200) + '...');
    console.log('- Birth Date:', biography.birthDate);
    console.log('- Wikidata QID:', biography.wikidataQid);
    console.log('- Wikipedia URL:', biography.wikipediaUrl);
  } else {
    console.log('No biography found');
  }
}

/**
 * Integration with Provider Registry
 *
 * For orchestrated workflows, register the provider with the global registry:
 */
import { getGlobalRegistry } from '../../provider-registry.js';

function registerWikipediaProvider() {
  const registry = getGlobalRegistry();
  const provider = new WikipediaProvider();

  registry.register(provider);

  // Now you can discover it dynamically
  const biographyProviders = registry.getByCapability('author-biography');
  console.log('Biography providers:', biographyProviders.map(p => p.name));
}

/**
 * Integration with Existing Service
 *
 * The WikipediaProvider wraps the existing wikipedia.ts service,
 * providing a consistent interface while maintaining backward compatibility.
 *
 * MIGRATION PATH:
 * 1. Old code: fetchAuthorBiography(sql, authorKey, env)
 * 2. New code: provider.fetchBiography(authorKey, context)
 *
 * Benefits of provider interface:
 * - Unified error handling (always returns null, never throws)
 * - Consistent logging patterns
 * - Integration with orchestrators and registry
 * - Future-proof for additional biography providers
 */
