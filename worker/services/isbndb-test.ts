/**
 * ISBNdb API Testing Service
 *
 * Comprehensive tester for all ISBNdb API v2 endpoints.
 * Used to verify API access and document capabilities.
 *
 * @module services/isbndb-test
 */

import type { Env } from '../env.d.js';

interface ISBNdbTestResult {
  endpoint: string;
  success: boolean;
  status?: number;
  data?: any;
  error?: string;
  responseTime?: number;
}

/**
 * Makes a request to ISBNdb API with timing
 */
async function testISBNdbEndpoint(
  endpoint: string,
  apiKey: string,
  description: string
): Promise<ISBNdbTestResult> {
  const startTime = Date.now();
  const url = `https://api2.isbndb.com${endpoint}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': apiKey,
        'User-Agent': 'Alexandria/2.0 (API Testing)',
      },
    });

    const responseTime = Date.now() - startTime;
    let data: any;

    try {
      data = await response.json();
    } catch (e) {
      data = await response.text();
    }

    return {
      endpoint: description,
      success: response.ok,
      status: response.status,
      data: response.ok ? data : undefined,
      error: !response.ok ? `HTTP ${response.status}` : undefined,
      responseTime,
    };
  } catch (error) {
    return {
      endpoint: description,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Test all ISBNdb endpoints
 */
export async function testAllISBNdbEndpoints(env: Env): Promise<ISBNdbTestResult[]> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return [
      {
        endpoint: 'API Key Check',
        success: false,
        error: 'ISBNDB_API_KEY not configured',
      },
    ];
  }

  const tests: Array<{ endpoint: string; description: string }> = [
    { endpoint: '/book/9780439064873', description: 'Book by ISBN-13' },
    { endpoint: '/book/0439064872', description: 'Book by ISBN-10' },
    { endpoint: '/books/harry%20potter?page=1&pageSize=5', description: 'Books search (title)' },
    { endpoint: '/books/harry%20potter?page=1&pageSize=5&column=title', description: 'Books search (filtered by column)' },
    { endpoint: '/author/j.k._rowling', description: 'Author by name' },
    { endpoint: '/authors/rowling?page=1&pageSize=5', description: 'Authors search' },
    { endpoint: '/publisher/scholastic', description: 'Publisher by name' },
    { endpoint: '/publishers/scholastic?page=1&pageSize=5', description: 'Publishers search' },
    { endpoint: '/subject/fiction', description: 'Subject by name' },
    { endpoint: '/subjects/fantasy?page=1&pageSize=5', description: 'Subjects search' },
  ];

  const results: ISBNdbTestResult[] = [];

  for (const test of tests) {
    const result = await testISBNdbEndpoint(test.endpoint, apiKey, test.description);
    results.push(result);

    // Rate limiting: 1 request per second
    await new Promise(resolve => setTimeout(resolve, 1100));
  }

  return results;
}

/**
 * Test a single ISBNdb book endpoint
 */
export async function testISBNdbBook(isbn: string, env: Env): Promise<ISBNdbTestResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return {
      endpoint: 'Book lookup',
      success: false,
      error: 'ISBNDB_API_KEY not configured',
    };
  }

  return testISBNdbEndpoint(`/book/${isbn}`, apiKey, `Book: ${isbn}`);
}

/**
 * Test ISBNdb books search endpoint
 */
export async function testISBNdbBooksSearch(
  query: string,
  options: { page?: number; pageSize?: number; column?: string } = {},
  env: Env
): Promise<ISBNdbTestResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return {
      endpoint: 'Books search',
      success: false,
      error: 'ISBNDB_API_KEY not configured',
    };
  }

  const page = options.page || 1;
  const pageSize = options.pageSize || 20;
  const column = options.column ? `&column=${options.column}` : '';
  const endpoint = `/books/${encodeURIComponent(query)}?page=${page}&pageSize=${pageSize}${column}`;

  return testISBNdbEndpoint(endpoint, apiKey, `Books search: "${query}"`);
}

/**
 * Test ISBNdb author endpoint
 */
export async function testISBNdbAuthor(authorName: string, env: Env): Promise<ISBNdbTestResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return {
      endpoint: 'Author lookup',
      success: false,
      error: 'ISBNDB_API_KEY not configured',
    };
  }

  const normalizedName = authorName.toLowerCase().replace(/\s+/g, '_');
  return testISBNdbEndpoint(`/author/${normalizedName}`, apiKey, `Author: ${authorName}`);
}

/**
 * Test ISBNdb authors search endpoint
 */
export async function testISBNdbAuthorsSearch(
  query: string,
  options: { page?: number; pageSize?: number } = {},
  env: Env
): Promise<ISBNdbTestResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return {
      endpoint: 'Authors search',
      success: false,
      error: 'ISBNDB_API_KEY not configured',
    };
  }

  const page = options.page || 1;
  const pageSize = options.pageSize || 20;
  const endpoint = `/authors/${encodeURIComponent(query)}?page=${page}&pageSize=${pageSize}`;

  return testISBNdbEndpoint(endpoint, apiKey, `Authors search: "${query}"`);
}

/**
 * Test ISBNdb publisher endpoint
 */
export async function testISBNdbPublisher(publisherName: string, env: Env): Promise<ISBNdbTestResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return {
      endpoint: 'Publisher lookup',
      success: false,
      error: 'ISBNDB_API_KEY not configured',
    };
  }

  const normalizedName = publisherName.toLowerCase().replace(/\s+/g, '_');
  return testISBNdbEndpoint(`/publisher/${normalizedName}`, apiKey, `Publisher: ${publisherName}`);
}

/**
 * Test ISBNdb subject endpoint
 */
export async function testISBNdbSubject(subjectName: string, env: Env): Promise<ISBNdbTestResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return {
      endpoint: 'Subject lookup',
      success: false,
      error: 'ISBNDB_API_KEY not configured',
    };
  }

  const normalizedName = subjectName.toLowerCase().replace(/\s+/g, '_');
  return testISBNdbEndpoint(`/subject/${normalizedName}`, apiKey, `Subject: ${subjectName}`);
}

/**
 * Test ISBNdb batch books endpoint (POST /books)
 * Fetches multiple books by ISBN in a single request
 */
export async function testISBNdbBatchBooks(isbns: string[], env: Env): Promise<ISBNdbTestResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();

  if (!apiKey) {
    return {
      endpoint: 'Batch books lookup',
      success: false,
      error: 'ISBNDB_API_KEY not configured',
    };
  }

  const startTime = Date.now();
  const url = 'https://api2.isbndb.com/books';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'Alexandria/2.0 (API Testing)',
      },
      body: `isbns=${isbns.join(',')}`,
    });

    const responseTime = Date.now() - startTime;
    let data: any;

    try {
      data = await response.json();
    } catch (e) {
      data = await response.text();
    }

    return {
      endpoint: `Batch books: ${isbns.length} ISBNs`,
      success: response.ok,
      status: response.status,
      data: response.ok ? data : undefined,
      error: !response.ok ? `HTTP ${response.status}` : undefined,
      responseTime,
    };
  } catch (error) {
    return {
      endpoint: `Batch books: ${isbns.length} ISBNs`,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime,
    };
  }
}
