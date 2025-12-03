#!/usr/bin/env node

/**
 * ISBNdb API Endpoint Tester
 *
 * Tests all available ISBNdb API v2 endpoints to verify access and document capabilities.
 * Requires ISBNDB_API_KEY environment variable or reads from wrangler.jsonc secrets.
 *
 * Usage:
 *   ISBNDB_API_KEY=your_key node scripts/test-isbndb-endpoints.js
 *   OR
 *   npx wrangler secret get ISBNDB_API_KEY | node scripts/test-isbndb-endpoints.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Base URL for ISBNdb API v2
const BASE_URL = 'https://api2.isbndb.com';

// Get API key from environment or wrangler secrets
let API_KEY = process.env.ISBNDB_API_KEY;

if (!API_KEY) {
  console.error('❌ ISBNDB_API_KEY not found in environment');
  console.error('Run: npx wrangler secret get ISBNDB_API_KEY --env production');
  process.exit(1);
}

/**
 * Make a GET request to ISBNdb API
 */
function makeRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${endpoint}`;
    console.log(`\n🔍 Testing: ${url}`);

    const options = {
      method: 'GET',
      headers: {
        'Authorization': API_KEY,
        'User-Agent': 'Alexandria/2.0 (API Testing)'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: parsed
          });
        } catch (error) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Test results formatter
 */
function formatResult(endpoint, result) {
  const { status, data } = result;

  console.log(`Status: ${status}`);

  if (status === 200) {
    console.log('✅ SUCCESS');

    // Show sample data structure
    if (typeof data === 'object') {
      console.log('\n📦 Response Structure:');
      console.log(JSON.stringify(data, null, 2).slice(0, 500) + '...');
    }
  } else if (status === 401) {
    console.log('❌ UNAUTHORIZED - Check API key');
  } else if (status === 404) {
    console.log('⚠️  NOT FOUND - Endpoint may not exist or resource not available');
  } else if (status === 429) {
    console.log('⏱️  RATE LIMITED - Too many requests');
  } else {
    console.log('❌ FAILED');
    console.log('Response:', typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200));
  }

  return status === 200;
}

/**
 * Main test suite
 */
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         ISBNdb API v2 Endpoint Verification                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const results = {
    passed: [],
    failed: []
  };

  const tests = [
    {
      name: 'Book Lookup by ISBN',
      endpoint: '/book/9780439064873',
      description: 'Fetch book details by ISBN-13 (Harry Potter)'
    },
    {
      name: 'Book Lookup by ISBN-10',
      endpoint: '/book/0439064872',
      description: 'Fetch book details by ISBN-10'
    },
    {
      name: 'Books Search by Title',
      endpoint: '/books/harry%20potter?page=1&pageSize=20',
      description: 'Search books by title keyword'
    },
    {
      name: 'Books Search with Column Filter',
      endpoint: '/books/harry%20potter?page=1&pageSize=20&column=title',
      description: 'Search books filtered by specific column'
    },
    {
      name: 'Author by Name',
      endpoint: '/author/j.k._rowling',
      description: 'Fetch author details by name'
    },
    {
      name: 'Authors Search',
      endpoint: '/authors/rowling?page=1&pageSize=20',
      description: 'Search authors by name keyword'
    },
    {
      name: 'Publisher by Name',
      endpoint: '/publisher/scholastic',
      description: 'Fetch publisher details'
    },
    {
      name: 'Publishers Search',
      endpoint: '/publishers/scholastic?page=1&pageSize=20',
      description: 'Search publishers by name keyword'
    },
    {
      name: 'Subject by Name',
      endpoint: '/subject/fiction',
      description: 'Fetch books by subject'
    },
    {
      name: 'Subjects Search',
      endpoint: '/subjects/fantasy?page=1&pageSize=20',
      description: 'Search subjects by keyword'
    },
    {
      name: 'Books with Advanced Filters',
      endpoint: '/books/python?page=1&pageSize=10&column=title&language=en',
      description: 'Books search with language filter'
    }
  ];

  for (const test of tests) {
    console.log('\n' + '═'.repeat(60));
    console.log(`📖 ${test.name}`);
    console.log(`   ${test.description}`);
    console.log('─'.repeat(60));

    try {
      const result = await makeRequest(test.endpoint);
      const success = formatResult(test.endpoint, result);

      if (success) {
        results.passed.push(test.name);
      } else {
        results.failed.push(test.name);
      }

      // Rate limiting: wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1100));

    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
      results.failed.push(test.name);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`📈 Total:  ${tests.length}`);

  if (results.passed.length > 0) {
    console.log('\n✅ Working Endpoints:');
    results.passed.forEach(name => console.log(`   - ${name}`));
  }

  if (results.failed.length > 0) {
    console.log('\n❌ Failed Endpoints:');
    results.failed.forEach(name => console.log(`   - ${name}`));
  }

  console.log('\n' + '═'.repeat(60));

  // Generate documentation
  const doc = generateDocumentation(results);
  const docPath = path.join(__dirname, '..', 'docs', 'ISBNDB-ENDPOINTS.md');
  fs.writeFileSync(docPath, doc);
  console.log(`\n📄 Documentation saved to: ${docPath}`);
}

/**
 * Generate markdown documentation
 */
function generateDocumentation(results) {
  const date = new Date().toISOString().split('T')[0];

  return `# ISBNdb API Endpoints Documentation

Last Updated: ${date}

## Available Endpoints

### Book Endpoints

#### \`GET /book/{isbn}\`
Fetch detailed book information by ISBN (10 or 13 digits).

**Example:** \`/book/9780439064873\`

**Response:**
\`\`\`json
{
  "book": {
    "title": "Harry Potter and the Sorcerer's Stone",
    "title_long": "Harry Potter and the Sorcerer's Stone (Book 1)",
    "isbn": "9780439064873",
    "isbn13": "9780439064873",
    "authors": ["J.K. Rowling"],
    "publisher": "Scholastic Inc.",
    "language": "en",
    "pages": 309,
    "date_published": "1999",
    "synopsis": "...",
    "image": "https://images.isbndb.com/covers/...",
    "edition": "Mass Market Paperback",
    "binding": "Paperback"
  }
}
\`\`\`

#### \`GET /books/{query}\`
Search books by keyword with pagination and filtering.

**Query Parameters:**
- \`page\` - Page number (default: 1)
- \`pageSize\` - Results per page (default: 20, max: 1000 for premium+)
- \`column\` - Filter by column: title, author, date_published, subject
- \`language\` - Filter by language code (e.g., 'en')

**Example:** \`/books/harry%20potter?page=1&pageSize=20&column=title\`

**Response:**
\`\`\`json
{
  "total": 5234,
  "books": [
    {
      "title": "...",
      "isbn": "...",
      "authors": ["..."],
      "publisher": "...",
      "image": "..."
    }
  ]
}
\`\`\`

### Author Endpoints

#### \`GET /author/{name}\`
Fetch author details and their books.

**Example:** \`/author/j.k._rowling\`

**Response:**
\`\`\`json
{
  "author": "J.K. Rowling",
  "books": [
    {
      "title": "...",
      "isbn": "...",
      "publisher": "..."
    }
  ]
}
\`\`\`

#### \`GET /authors/{query}\`
Search authors by name keyword.

**Query Parameters:**
- \`page\` - Page number
- \`pageSize\` - Results per page

**Example:** \`/authors/rowling?page=1&pageSize=20\`

### Publisher Endpoints

#### \`GET /publisher/{name}\`
Fetch publisher details and their catalog.

**Example:** \`/publisher/scholastic\`

#### \`GET /publishers/{query}\`
Search publishers by name keyword.

**Example:** \`/publishers/scholastic?page=1&pageSize=20\`

### Subject Endpoints

#### \`GET /subject/{name}\`
Fetch books by subject/category.

**Example:** \`/subject/fiction\`

#### \`GET /subjects/{query}\`
Search subjects by keyword.

**Example:** \`/subjects/fantasy?page=1&pageSize=20\`

## Authentication

All requests require an HTTP header:
\`\`\`
Authorization: YOUR_API_KEY
\`\`\`

## Rate Limits

- **Free/Standard:** 1 request/second
- **Premium:** 3 requests/second (use \`api.premium.isbndb.com\`)
- **Pro:** 5 requests/second (use \`api.pro.isbndb.com\`)
- **Enterprise:** 10 requests/second (use \`api.enterprise.isbndb.com\`)

## Response Fields

### Book Object
- \`title\` - Short title
- \`title_long\` - Full title with subtitle
- \`isbn\` / \`isbn13\` - ISBN identifiers
- \`authors\` - Array of author names
- \`publisher\` - Publisher name
- \`date_published\` - Publication year
- \`pages\` - Page count
- \`language\` - ISO language code
- \`synopsis\` - Book description
- \`image\` - Cover image URL
- \`edition\` - Edition type
- \`binding\` - Binding type (Hardcover, Paperback, etc.)
- \`subjects\` - Array of subject categories

## Test Results (${date})

✅ **Working Endpoints:** ${results.passed.length}
${results.passed.map(name => `- ${name}`).join('\n')}

${results.failed.length > 0 ? `
❌ **Failed Endpoints:** ${results.failed.length}
${results.failed.map(name => `- ${name}`).join('\n')}
` : ''}

## Best Practices

1. **ISBN Lookups:** Use \`/book/{isbn}\` - fastest and most accurate
2. **Caching:** Cache responses for 24 hours minimum
3. **Rate Limiting:** Implement client-side rate limiting
4. **Fallback Chain:** Use ISBNdb → Google Books → OpenLibrary
5. **Pagination:** For bulk data, use pageSize=1000 (premium+ only)

## See Also

- [ISBNdb Official Documentation](https://isbndb.com/isbndb-api-documentation-v2)
- Alexandria Worker: \`worker/services/external-apis.ts\`
`;
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
