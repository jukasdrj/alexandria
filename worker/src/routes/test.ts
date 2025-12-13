import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  ISBNdbTestResultSchema,
  ISBNdbTestSummarySchema,
  ISBNParamSchema,
  NameParamSchema,
  ISBNdbBooksQuerySchema,
  ISBNdbAuthorsQuerySchema,
  BatchISBNsRequestSchema,
  JSquashRequestSchema,
  JSquashResultSchema,
  WikidataTestResultSchema,
  TestErrorSchema,
} from '../schemas/test.js';

// Import test functions from services
import {
  testAllISBNdbEndpoints,
  testISBNdbBook,
  testISBNdbBooksSearch,
  testISBNdbAuthor,
  testISBNdbAuthorsSearch,
  testISBNdbPublisher,
  testISBNdbSubject,
  testISBNdbBatchBooks,
} from '../../services/isbndb-test.js';

import { processAndStoreCover, benchmark as jsquashBenchmark } from '../../services/jsquash-processor.js';
import { testWikidataClient } from '../../services/wikidata-client.js';

// =================================================================================
// ISBNdb Test Routes
// =================================================================================

const isbndbTestAllRoute = createRoute({
  method: 'get',
  path: '/api/test/isbndb',
  tags: ['Test'],
  summary: 'Test all ISBNdb endpoints',
  description: 'Runs a comprehensive test suite against all ISBNdb API endpoints to verify connectivity and functionality.',
  responses: {
    200: {
      description: 'Test results summary',
      content: {
        'application/json': {
          schema: ISBNdbTestSummarySchema,
        },
      },
    },
    500: {
      description: 'Test suite failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

const isbndbTestBookRoute = createRoute({
  method: 'get',
  path: '/api/test/isbndb/book/:isbn',
  tags: ['Test'],
  summary: 'Test ISBNdb book lookup',
  description: 'Test the ISBNdb /book/{isbn} endpoint with a specific ISBN.',
  request: {
    params: ISBNParamSchema,
  },
  responses: {
    200: {
      description: 'Book lookup test result',
      content: {
        'application/json': {
          schema: ISBNdbTestResultSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

const isbndbTestBooksSearchRoute = createRoute({
  method: 'get',
  path: '/api/test/isbndb/books',
  tags: ['Test'],
  summary: 'Test ISBNdb books search',
  description: 'Test the ISBNdb /books/{query} endpoint with search parameters.',
  request: {
    query: ISBNdbBooksQuerySchema,
  },
  responses: {
    200: {
      description: 'Books search test result',
      content: {
        'application/json': {
          schema: ISBNdbTestResultSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

const isbndbTestAuthorRoute = createRoute({
  method: 'get',
  path: '/api/test/isbndb/author/:name',
  tags: ['Test'],
  summary: 'Test ISBNdb author lookup',
  description: 'Test the ISBNdb /author/{name} endpoint with a specific author name.',
  request: {
    params: NameParamSchema,
  },
  responses: {
    200: {
      description: 'Author lookup test result',
      content: {
        'application/json': {
          schema: ISBNdbTestResultSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

const isbndbTestAuthorsSearchRoute = createRoute({
  method: 'get',
  path: '/api/test/isbndb/authors',
  tags: ['Test'],
  summary: 'Test ISBNdb authors search',
  description: 'Test the ISBNdb /authors/{query} endpoint with search parameters.',
  request: {
    query: ISBNdbAuthorsQuerySchema,
  },
  responses: {
    200: {
      description: 'Authors search test result',
      content: {
        'application/json': {
          schema: ISBNdbTestResultSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

const isbndbTestPublisherRoute = createRoute({
  method: 'get',
  path: '/api/test/isbndb/publisher/:name',
  tags: ['Test'],
  summary: 'Test ISBNdb publisher lookup',
  description: 'Test the ISBNdb /publisher/{name} endpoint with a specific publisher name.',
  request: {
    params: NameParamSchema,
  },
  responses: {
    200: {
      description: 'Publisher lookup test result',
      content: {
        'application/json': {
          schema: ISBNdbTestResultSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

const isbndbTestSubjectRoute = createRoute({
  method: 'get',
  path: '/api/test/isbndb/subject/:name',
  tags: ['Test'],
  summary: 'Test ISBNdb subject lookup',
  description: 'Test the ISBNdb /subject/{name} endpoint with a specific subject name.',
  request: {
    params: NameParamSchema,
  },
  responses: {
    200: {
      description: 'Subject lookup test result',
      content: {
        'application/json': {
          schema: ISBNdbTestResultSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

const isbndbTestBatchRoute = createRoute({
  method: 'post',
  path: '/api/test/isbndb/batch',
  tags: ['Test'],
  summary: 'Test ISBNdb batch lookup',
  description: 'Test the ISBNdb POST /books endpoint for batch ISBN lookups (up to 1000 ISBNs on Premium plan).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BatchISBNsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch lookup test result',
      content: {
        'application/json': {
          schema: ISBNdbTestResultSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// jSquash Image Processing Test Route
// =================================================================================

const jsquashTestRoute = createRoute({
  method: 'post',
  path: '/api/test/jsquash',
  tags: ['Test'],
  summary: 'Test jSquash image processing',
  description: 'Benchmark jSquash WASM image processing. If ISBN is provided, stores processed images in R2; otherwise runs benchmark only.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: JSquashRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Processing result',
      content: {
        'application/json': {
          schema: JSquashResultSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
    500: {
      description: 'Benchmark failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// Wikidata Test Route
// =================================================================================

const wikidataTestRoute = createRoute({
  method: 'get',
  path: '/api/test/wikidata',
  tags: ['Test'],
  summary: 'Test Wikidata SPARQL client',
  description: 'Test the Wikidata SPARQL API connection and author data fetching.',
  responses: {
    200: {
      description: 'Wikidata test result',
      content: {
        'application/json': {
          schema: WikidataTestResultSchema,
        },
      },
    },
    500: {
      description: 'Test failed',
      content: {
        'application/json': {
          schema: TestErrorSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

// ISBNdb tests
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestAllRoute, async (c) => {
  try {
    const results = await testAllISBNdbEndpoints(c.env);
    const summary = {
      total: results.length,
      passed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
    return c.json(summary);
  } catch (error) {
    c.get('logger')?.error('ISBNdb test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Test suite failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestBookRoute, async (c) => {
  const { isbn } = c.req.valid('param');
  try {
    const result = await testISBNdbBook(isbn, c.env);
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('ISBNdb book test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Book test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestBooksSearchRoute, async (c) => {
  const { q: query, page, pageSize, column } = c.req.valid('query');
  try {
    const result = await testISBNdbBooksSearch(query, { page, pageSize, column }, c.env);
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('ISBNdb books search test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Books search test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestAuthorRoute, async (c) => {
  const { name } = c.req.valid('param');
  try {
    const result = await testISBNdbAuthor(name, c.env);
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('ISBNdb author test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Author test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestAuthorsSearchRoute, async (c) => {
  const { q: query, page, pageSize } = c.req.valid('query');
  try {
    const result = await testISBNdbAuthorsSearch(query, { page, pageSize }, c.env);
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('ISBNdb authors search test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Authors search test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestPublisherRoute, async (c) => {
  const { name } = c.req.valid('param');
  try {
    const result = await testISBNdbPublisher(name, c.env);
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('ISBNdb publisher test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Publisher test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestSubjectRoute, async (c) => {
  const { name } = c.req.valid('param');
  try {
    const result = await testISBNdbSubject(name, c.env);
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('ISBNdb subject test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Subject test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(isbndbTestBatchRoute, async (c) => {
  try {
    const { isbns } = c.req.valid('json');

    if (!Array.isArray(isbns) || isbns.length === 0) {
      return c.json({
        error: 'Invalid request',
        message: 'Must provide array of ISBNs in request body'
      }, 400);
    }

    const result = await testISBNdbBatchBooks(isbns, c.env);
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('ISBNdb batch test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Batch test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// jSquash test
app.openapi(jsquashTestRoute, async (c) => {
  try {
    const { url, isbn } = c.req.valid('json');

    // If ISBN provided, do full processing (stores in R2)
    // Otherwise, run benchmark (processes but cleans up)
    if (isbn) {
      const result = await processAndStoreCover(isbn, url, c.env);
      return c.json(result);
    } else {
      const result = await jsquashBenchmark(url, c.env);
      return c.json(result);
    }
  } catch (error) {
    c.get('logger')?.error('jSquash benchmark error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Benchmark failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// Wikidata test
// @ts-expect-error - Handler return type complexity exceeds OpenAPI inference
app.openapi(wikidataTestRoute, async (c) => {
  try {
    const result = await testWikidataClient();
    return c.json(result);
  } catch (error) {
    c.get('logger')?.error('Wikidata test error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Wikidata test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app;
