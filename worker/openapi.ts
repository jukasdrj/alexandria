/**
 * OpenAPI 3.0 Specification for Alexandria API
 *
 * This file contains the complete API documentation for Alexandria.
 * It's imported by index.ts and served at /openapi.json
 */

export const openAPISpec = {
  openapi: '3.1.0',
  info: {
    title: 'Alexandria Book API',
    version: '2.0.0',
    description: `
Search 54+ million books from OpenLibrary via ISBN, title, and author. Powered by Cloudflare Workers and Hyperdrive.

## Features
- **54.8M+ editions** with ISBN lookups
- **40.1M+ works** with title search
- **14.7M+ authors** with author search
- **Fuzzy text search** using PostgreSQL pg_trgm for typo-tolerant queries
- **Cover image processing** with R2 storage
- **Smart enrichment** with ISBNdb, Google Books, and OpenLibrary integration
- **Queue-based architecture** for async processing

## Rate Limits
- Recommended: 10 requests/second per IP
- Burst: Up to 20 requests for short bursts
- Use batch endpoints when processing multiple items

## Authentication
No authentication required for public endpoints. All endpoints are protected by Cloudflare rate limiting.
    `.trim(),
    contact: {
      name: 'API Support',
      url: 'https://github.com/jukasdrj/alexandria'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [{ url: 'https://alexandria.ooheynerds.com', description: 'Production' }],
  tags: [
    { name: 'System', description: 'Health checks and system statistics' },
    { name: 'Books', description: 'Book search endpoints' },
    { name: 'Covers', description: 'Cover image processing and serving' },
    { name: 'Enrichment', description: 'Metadata enrichment from external providers' }
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health Check',
        description: 'Returns API and database health status',
        tags: ['System'],
        responses: {
          '200': { description: 'Healthy' }
        }
      }
    },
    '/api/stats': {
      get: {
        summary: 'Database Statistics',
        description: 'Get live counts of editions, ISBNs, works, and authors',
        tags: ['System'],
        responses: {
          '200': { description: 'Statistics' }
        }
      }
    },
    '/api/search': {
      get: {
        summary: 'Search for books',
        description: `
Search the Alexandria database by ISBN, title, or author. Supports fuzzy text matching for typo-tolerant searches.

## Search Modes
1. **ISBN Search** - Exact match with Smart Resolution (auto-enrichment if not found)
   - Fastest: ~10-50ms
   - Accepts ISBN-10 or ISBN-13 (normalized automatically)
   - Triggers external enrichment if not in database

2. **Title Search** - Fuzzy matching with pg_trgm
   - Speed: ~50-200ms
   - Supports partial matches and typos (e.g., "hary poter" finds "Harry Potter")
   - Searches enriched_works table with trigram indexes

3. **Author Search** - Fuzzy matching with pg_trgm
   - Speed: ~100-300ms
   - Supports partial matches and typos
   - Searches enriched_authors table with trigram indexes

## Examples
- \`?isbn=9780439064873\` - Find Harry Potter by ISBN
- \`?title=harry%20potter&limit=20\` - Search by title with pagination
- \`?author=rowling&limit=10&offset=20\` - Search by author, page 3
        `.trim(),
        tags: ['Books'],
        parameters: [
          {
            name: 'isbn',
            in: 'query',
            description: 'Search by ISBN-10 or ISBN-13. Triggers Smart Resolution if not found.',
            schema: { type: 'string', example: '9780439064873' }
          },
          {
            name: 'title',
            in: 'query',
            description: 'Search by book title. Supports fuzzy matching and typos.',
            schema: { type: 'string', example: 'Harry Potter' }
          },
          {
            name: 'author',
            in: 'query',
            description: 'Search by author name. Supports fuzzy matching and typos.',
            schema: { type: 'string', example: 'J.K. Rowling' }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum results per page (default: 20, max: 100)',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
          },
          {
            name: 'offset',
            in: 'query',
            description: 'Number of results to skip for pagination (default: 0)',
            schema: { type: 'integer', minimum: 0, default: 0 }
          }
        ],
        responses: {
          '200': {
            description: 'Search results with pagination metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          title: { type: 'string', example: 'Harry Potter and the Sorcerer\'s Stone' },
                          author: { type: 'string', example: 'J.K. Rowling' },
                          isbn: { type: 'string', example: '9780439064873' },
                          work_key: { type: 'string', example: '/works/OL45883W' },
                          edition_key: { type: 'string', example: '/books/OL7353617M' },
                          cover_url: { type: 'string', example: 'https://alexandria.ooheynerds.com/covers/9780439064873/medium', nullable: true },
                          publisher: { type: 'string', example: 'Scholastic', nullable: true },
                          publication_date: { type: 'string', example: '1998-09-01', nullable: true },
                          page_count: { type: 'integer', example: 309, nullable: true },
                          language: { type: 'string', example: 'eng', nullable: true }
                        }
                      }
                    },
                    total: { type: 'integer', example: 247, description: 'Total number of results' },
                    limit: { type: 'integer', example: 20 },
                    offset: { type: 'integer', example: 0 },
                    query: {
                      type: 'object',
                      description: 'Echo of query parameters used',
                      properties: {
                        isbn: { type: 'string', nullable: true },
                        title: { type: 'string', nullable: true },
                        author: { type: 'string', nullable: true }
                      }
                    }
                  }
                },
                examples: {
                  isbnSearch: {
                    summary: 'ISBN search result',
                    value: {
                      results: [{
                        title: 'Harry Potter and the Sorcerer\'s Stone',
                        author: 'J.K. Rowling',
                        isbn: '9780439064873',
                        work_key: '/works/OL45883W',
                        edition_key: '/books/OL7353617M',
                        cover_url: 'https://alexandria.ooheynerds.com/covers/9780439064873/medium',
                        publisher: 'Scholastic',
                        publication_date: '1998-09-01',
                        page_count: 309,
                        language: 'eng'
                      }],
                      total: 1,
                      limit: 20,
                      offset: 0,
                      query: { isbn: '9780439064873' }
                    }
                  },
                  titleSearch: {
                    summary: 'Title search with multiple results',
                    value: {
                      results: [
                        {
                          title: 'Harry Potter and the Philosopher\'s Stone',
                          author: 'J.K. Rowling',
                          isbn: '9780747532699',
                          work_key: '/works/OL45883W',
                          cover_url: 'https://alexandria.ooheynerds.com/covers/9780747532699/medium'
                        },
                        {
                          title: 'Harry Potter and the Chamber of Secrets',
                          author: 'J.K. Rowling',
                          isbn: '9780439064873',
                          work_key: '/works/OL82537W',
                          cover_url: 'https://alexandria.ooheynerds.com/covers/9780439064873/medium'
                        }
                      ],
                      total: 247,
                      limit: 20,
                      offset: 0,
                      query: { title: 'Harry Potter' }
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid query parameters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'At least one search parameter required (isbn, title, or author)' }
                  }
                }
              }
            }
          },
          '404': {
            description: 'No results found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'No results found' },
                    results: { type: 'array', items: {} },
                    total: { type: 'integer', example: 0 }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/enrich/edition': {
      post: {
        summary: 'Store or update edition metadata',
        description: 'Enrich an edition with metadata from external providers (ISBNdb, Google Books, etc.)',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['isbn', 'primary_provider'],
                properties: {
                  isbn: { type: 'string', example: '9780439064873', description: 'ISBN-10 or ISBN-13' },
                  title: { type: 'string', example: 'Harry Potter and the Sorcerer\'s Stone' },
                  subtitle: { type: 'string' },
                  publisher: { type: 'string', example: 'Scholastic' },
                  publication_date: { type: 'string', example: '1998-09-01' },
                  page_count: { type: 'integer', example: 309 },
                  format: { type: 'string', example: 'Paperback' },
                  language: { type: 'string', example: 'eng' },
                  primary_provider: { type: 'string', enum: ['isbndb', 'google-books', 'openlibrary', 'user-correction'], example: 'isbndb' },
                  cover_urls: { type: 'object', properties: { large: { type: 'string' }, medium: { type: 'string' }, small: { type: 'string' } } },
                  cover_source: { type: 'string' },
                  work_key: { type: 'string', description: 'OpenLibrary work key' },
                  openlibrary_edition_id: { type: 'string' },
                  amazon_asins: { type: 'array', items: { type: 'string' } },
                  google_books_volume_ids: { type: 'array', items: { type: 'string' } },
                  goodreads_edition_ids: { type: 'array', items: { type: 'string' } },
                  alternate_isbns: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Edition created' },
          '200': { description: 'Edition updated' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/work': {
      post: {
        summary: 'Store or update work metadata',
        description: 'Enrich a work (collection of editions) with metadata',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['work_key', 'title', 'primary_provider'],
                properties: {
                  work_key: { type: 'string', example: '/works/OL45883W' },
                  title: { type: 'string', example: 'Harry Potter and the Philosopher\'s Stone' },
                  subtitle: { type: 'string' },
                  description: { type: 'string' },
                  original_language: { type: 'string', example: 'eng' },
                  first_publication_year: { type: 'integer', example: 1997 },
                  subject_tags: { type: 'array', items: { type: 'string' } },
                  primary_provider: { type: 'string', enum: ['isbndb', 'google-books', 'openlibrary'], example: 'openlibrary' },
                  cover_urls: { type: 'object', properties: { large: { type: 'string' }, medium: { type: 'string' }, small: { type: 'string' } } },
                  cover_source: { type: 'string' },
                  openlibrary_work_id: { type: 'string' },
                  goodreads_work_ids: { type: 'array', items: { type: 'string' } },
                  amazon_asins: { type: 'array', items: { type: 'string' } },
                  google_books_volume_ids: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Work created' },
          '200': { description: 'Work updated' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/author': {
      post: {
        summary: 'Store or update author biographical data',
        description: 'Enrich an author with biographical metadata',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['author_key', 'name', 'primary_provider'],
                properties: {
                  author_key: { type: 'string', example: '/authors/OL23919A' },
                  name: { type: 'string', example: 'J.K. Rowling' },
                  gender: { type: 'string', example: 'female' },
                  nationality: { type: 'string', example: 'British' },
                  birth_year: { type: 'integer', example: 1965 },
                  death_year: { type: 'integer' },
                  bio: { type: 'string' },
                  bio_source: { type: 'string' },
                  author_photo_url: { type: 'string' },
                  primary_provider: { type: 'string', enum: ['isbndb', 'openlibrary', 'wikidata'], example: 'wikidata' },
                  openlibrary_author_id: { type: 'string' },
                  goodreads_author_ids: { type: 'array', items: { type: 'string' } },
                  wikidata_id: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Author created' },
          '200': { description: 'Author updated' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/queue': {
      post: {
        summary: 'Queue background enrichment job',
        description: 'Queue an enrichment task to be processed in the background',
        tags: ['Enrichment'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['entity_type', 'entity_key', 'providers_to_try'],
                properties: {
                  entity_type: { type: 'string', enum: ['work', 'edition', 'author'], example: 'edition' },
                  entity_key: { type: 'string', example: '9780439064873', description: 'ISBN for editions, work_key for works, author_key for authors' },
                  providers_to_try: { type: 'array', items: { type: 'string' }, example: ['isbndb', 'google-books'], description: 'List of providers to attempt enrichment from' },
                  priority: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Job priority (1=lowest, 10=highest)' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Job queued successfully' },
          '400': { description: 'Validation error' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/api/enrich/status/{id}': {
      get: {
        summary: 'Get enrichment job status',
        description: 'Check the status of a queued enrichment job',
        tags: ['Enrichment'],
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Job ID (UUID)', schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Job status' },
          '404': { description: 'Job not found' },
          '500': { description: 'Internal server error' }
        }
      }
    },
    '/covers/{isbn}/{size}': {
      get: {
        summary: 'Get cover image',
        description: 'Serve cover image from R2 storage. Redirects to placeholder if not found.',
        tags: ['Covers'],
        parameters: [
          { name: 'isbn', in: 'path', required: true, description: 'ISBN-10 or ISBN-13', schema: { type: 'string' } },
          { name: 'size', in: 'path', required: true, description: 'Image size', schema: { type: 'string', enum: ['small', 'medium', 'large', 'original'] } }
        ],
        responses: {
          '200': { description: 'Cover image (image/jpeg or image/png)' },
          '302': { description: 'Redirect to placeholder if not found' },
          '400': { description: 'Invalid ISBN or size' }
        }
      }
    },
    '/covers/{isbn}/status': {
      get: {
        summary: 'Check cover status',
        description: 'Check if a cover exists and get metadata',
        tags: ['Covers'],
        parameters: [
          { name: 'isbn', in: 'path', required: true, description: 'ISBN-10 or ISBN-13', schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Cover status and metadata' },
          '400': { description: 'Invalid ISBN' }
        }
      }
    },
    '/covers/{isbn}/process': {
      post: {
        summary: 'Process cover image',
        description: 'Download, process, and store cover image from providers (ISBNdb, Google Books, OpenLibrary)',
        tags: ['Covers'],
        parameters: [
          { name: 'isbn', in: 'path', required: true, description: 'ISBN-10 or ISBN-13', schema: { type: 'string' } },
          { name: 'force', in: 'query', description: 'Force reprocessing even if exists', schema: { type: 'boolean' } }
        ],
        responses: {
          '201': { description: 'Cover processed successfully' },
          '200': { description: 'Cover already exists' },
          '404': { description: 'No cover found from any provider' },
          '400': { description: 'Invalid ISBN' }
        }
      }
    },
    '/covers/batch': {
      post: {
        summary: 'Batch process covers',
        description: 'Process multiple cover images (max 10 per request)',
        tags: ['Covers'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['isbns'],
                properties: {
                  isbns: { type: 'array', items: { type: 'string' }, maxItems: 10, example: ['9780439064873', '9780141439518'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Batch processing results' },
          '400': { description: 'Invalid request' }
        }
      }
    },
    '/api/covers/process': {
      post: {
        summary: 'Process cover image from provider URL',
        description: 'Download, validate, and store cover image in R2 (bookstrack-covers-processed bucket)',
        tags: ['Covers'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['work_key', 'provider_url'],
                properties: {
                  work_key: { type: 'string', example: '/works/OL45804W' },
                  provider_url: { type: 'string', example: 'https://covers.openlibrary.org/b/id/8091323-L.jpg' },
                  isbn: { type: 'string', example: '9780439064873', description: 'Optional, for logging' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Cover processed successfully' },
          '400': { description: 'Invalid request' },
          '403': { description: 'Domain not allowed' },
          '500': { description: 'Processing error' }
        }
      }
    },
    '/api/covers/{work_key}/{size}': {
      get: {
        summary: 'Serve processed cover image',
        description: 'Retrieve cover image from R2 (bookstrack-covers-processed bucket)',
        tags: ['Covers'],
        parameters: [
          { name: 'work_key', in: 'path', required: true, schema: { type: 'string' }, description: 'OpenLibrary work key (without /works/ prefix)' },
          { name: 'size', in: 'path', required: true, schema: { type: 'string', enum: ['large', 'medium', 'small'] } }
        ],
        responses: {
          '200': { description: 'Cover image' },
          '302': { description: 'Redirect to placeholder' },
          '400': { description: 'Invalid size parameter' }
        }
      }
    }
  }
};
