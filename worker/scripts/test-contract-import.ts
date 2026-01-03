/**
 * Test script to verify contract testing type exports work correctly
 * This simulates what bendv3 will do when importing the alexandria-worker package
 */

// Import the AlexandriaAppType (the Hono app type for RPC client)
import type { AlexandriaAppType } from '../src/index.js';

// Import the public types (from types.ts, re-exported via src/index.ts)
import type {
  SearchQuery,
  SearchResult,
  BookResult,
  AuthorDetails,
  EnrichEdition,
  EnrichWork,
  EnrichAuthor,
} from '../src/index.js';

// Verify that we can use these types in a type-safe way
function testTypeExports() {
  // Test 1: AlexandriaAppType can be used with hc client
  type AppType = AlexandriaAppType;
  console.log('✅ AlexandriaAppType exported successfully');

  // Test 2: Request/Response types are available
  const searchQuery: SearchQuery = {
    isbn: '9780439064873',
    limit: 20,
    offset: 0,
  };
  console.log('✅ SearchQuery type available:', searchQuery);

  // Test 3: Response types are available
  const bookResult: Partial<BookResult> = {
    title: 'Harry Potter',
    isbn: '9780439064873',
  };
  console.log('✅ BookResult type available:', bookResult);

  // Test 4: Author types are available
  const authorDetails: Partial<AuthorDetails> = {
    name: 'J.K. Rowling',
    author_key: '/authors/OL7234434A',
  };
  console.log('✅ AuthorDetails type available:', authorDetails);

  // Test 5: Enrichment types are available
  const enrichEdition: Partial<EnrichEdition> = {
    isbn: '9780439064873',
    title: 'Harry Potter',
    primary_provider: 'isbndb',
  };
  console.log('✅ EnrichEdition type available:', enrichEdition);

  console.log('\n🎉 All contract testing types exported successfully!');
}

testTypeExports();
