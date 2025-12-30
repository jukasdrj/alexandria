/**
 * MSW Handlers for External API Mocking
 *
 * Mocks ISBNdb, Google Books, and OpenLibrary APIs for integration testing.
 * Based on actual API responses documented in docs/ISBNDB-ENDPOINTS.md
 */

import { http, HttpResponse } from 'msw';

/**
 * ISBNdb Premium API Mocks
 * Base URL: api.premium.isbndb.com
 */
export const isbndbHandlers = [
  // GET /book/:isbn - Single book lookup
  http.get('https://api.premium.isbndb.com/book/:isbn', ({ params }) => {
    const { isbn } = params;

    // Mock response for Harry Potter test ISBN
    if (isbn === '9780439064873') {
      return HttpResponse.json({
        book: {
          isbn: '9780439064873',
          isbn13: '9780439064873',
          title: "Harry Potter and the Philosopher's Stone",
          title_long: "Harry Potter and the Philosopher's Stone (Harry Potter, #1)",
          authors: ['J.K. Rowling'],
          publisher: 'Scholastic',
          language: 'en',
          date_published: '1998-09-01',
          edition: '1',
          pages: 309,
          dimensions: 'Height: 7.75 Inches, Length: 5.25 Inches, Weight: 0.75 Pounds, Width: 1.5 Inches',
          image: 'https://images.isbndb.com/covers/48/73/9780439064873.jpg',
          image_original: 'https://images.isbndb.com/covers/48/73/9780439064873_original.jpg',
          subjects: ['Fiction', 'Fantasy', 'Magic', 'Wizards'],
        },
      });
    }

    // Default mock book
    return HttpResponse.json({
      book: {
        isbn: isbn,
        isbn13: isbn,
        title: `Mock Book ${isbn}`,
        authors: ['Mock Author'],
        publisher: 'Mock Publisher',
        image: `https://images.isbndb.com/covers/${isbn}.jpg`,
      },
    });
  }),

  // POST /books - Batch lookup (up to 1000 ISBNs)
  http.post('https://api.premium.isbndb.com/books', async ({ request }) => {
    const body = (await request.json()) as { isbns: string[] };
    const { isbns } = body;

    return HttpResponse.json({
      books: isbns.map((isbn) => ({
        isbn,
        isbn13: isbn,
        title: `Mock Book ${isbn}`,
        authors: ['Mock Author'],
        publisher: 'Mock Publisher',
        image: `https://images.isbndb.com/covers/${isbn}.jpg`,
      })),
    });
  }),

  // GET /author/:name - Author bibliography
  http.get('https://api.premium.isbndb.com/author/:name', ({ params, request }) => {
    const { name } = params;
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '100', 10);

    // Mock Sanderson bibliography
    if (name === 'Brandon Sanderson') {
      const books = Array.from({ length: 50 }, (_, i) => ({
        isbn: `978${i.toString().padStart(10, '0')}`,
        title: `Mock Sanderson Book ${i + 1}`,
        authors: ['Brandon Sanderson'],
        date_published: '2024-01-01',
        image: `https://images.isbndb.com/covers/sanderson-${i}.jpg`,
      }));

      const start = (page - 1) * pageSize;
      const end = Math.min(start + pageSize, books.length);

      return HttpResponse.json({
        author: name,
        books: books.slice(start, end),
      });
    }

    return HttpResponse.json({
      author: name,
      books: [],
    });
  }),
];

/**
 * Google Books API Mocks
 * Base URL: www.googleapis.com/books/v1
 */
export const googleBooksHandlers = [
  // GET /volumes - Book search
  http.get('https://www.googleapis.com/books/v1/volumes', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';

    // Mock Harry Potter search
    if (query.includes('9780439064873')) {
      return HttpResponse.json({
        kind: 'books#volumes',
        totalItems: 1,
        items: [
          {
            id: 'wrOQLV6xB-wC',
            volumeInfo: {
              title: "Harry Potter and the Sorcerer's Stone",
              authors: ['J.K. Rowling'],
              publisher: 'Scholastic Inc.',
              publishedDate: '1999-09-01',
              description: "Harry Potter has no idea how famous he is...",
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780439064873' },
                { type: 'ISBN_10', identifier: '0439064872' },
              ],
              pageCount: 309,
              imageLinks: {
                smallThumbnail: 'https://books.google.com/books/content?id=wrOQLV6xB-wC&printsec=frontcover&img=1&zoom=5',
                thumbnail: 'https://books.google.com/books/content?id=wrOQLV6xB-wC&printsec=frontcover&img=1&zoom=1',
              },
              language: 'en',
            },
          },
        ],
      });
    }

    return HttpResponse.json({
      kind: 'books#volumes',
      totalItems: 0,
      items: [],
    });
  }),
];

/**
 * OpenLibrary API Mocks
 * Base URL: openlibrary.org
 */
export const openLibraryHandlers = [
  // GET /api/books - Books API
  http.get('https://openlibrary.org/api/books', ({ request }) => {
    const url = new URL(request.url);
    const bibkeys = url.searchParams.get('bibkeys') || '';

    if (bibkeys.includes('9780439064873')) {
      return HttpResponse.json({
        'ISBN:9780439064873': {
          info_url: 'https://openlibrary.org/books/OL26331930M',
          bib_key: 'ISBN:9780439064873',
          preview_url: 'https://archive.org/details/isbn_9780439064873',
          thumbnail_url: 'https://covers.openlibrary.org/b/id/8091323-S.jpg',
          details: {
            title: "Harry Potter and the Philosopher's Stone",
            authors: [{ name: 'J.K. Rowling' }],
            publishers: ['Scholastic'],
            publish_date: '1998',
            isbn_10: ['0439064872'],
            isbn_13: ['9780439064873'],
            number_of_pages: 309,
          },
        },
      });
    }

    return HttpResponse.json({});
  }),

  // GET /search.json - Search API
  http.get('https://openlibrary.org/search.json', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const title = url.searchParams.get('title') || '';

    if (query.includes('Harry Potter') || title.includes('Harry Potter')) {
      return HttpResponse.json({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL45804W',
            title: "Harry Potter and the Philosopher's Stone",
            author_name: ['J.K. Rowling'],
            first_publish_year: 1997,
            isbn: ['0439064872', '9780439064873'],
            cover_i: 8091323,
          },
        ],
      });
    }

    return HttpResponse.json({
      numFound: 0,
      start: 0,
      docs: [],
    });
  }),
];

/**
 * Combined handlers for all external APIs
 */
export const handlers = [
  ...isbndbHandlers,
  ...googleBooksHandlers,
  ...openLibraryHandlers,
];
