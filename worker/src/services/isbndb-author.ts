/**
 * ISBNdb Author Service
 *
 * Shared module for fetching author bibliographies from ISBNdb Premium API.
 * Can be called from both HTTP routes and Cloudflare Workflows.
 */

import type { Env } from '../env.js';

export interface ISBNdbBook {
  isbn: string;
  title: string;
  authors: string[];
  publisher?: string;
  date_published?: string;
  pages?: number;
  language?: string;
  synopsis?: string;
  image?: string;
  image_original?: string;
  subjects?: string[];
  binding?: string;
  dewey_decimal?: string[];
  related?: Record<string, string>;
}

export interface ISBNdbAuthorResult {
  author: string;
  books_found: number;
  pages_fetched: number;
  api_calls: number;
  books: ISBNdbBook[];
  error?: string;
}

interface ISBNdbAuthorResponse {
  books?: Array<{
    isbn?: string;
    isbn13?: string;
    title?: string;
    title_long?: string;
    authors?: string[];
    publisher?: string;
    date_published?: string;
    pages?: number;
    language?: string;
    synopsis?: string;
    image?: string;
    image_original?: string;
    subjects?: string[];
    binding?: string;
    dewey_decimal?: string[];
    related?: Record<string, string>;
  }>;
  total?: number;
}

/**
 * Fetch author bibliography from ISBNdb Premium API.
 *
 * @param authorName - Author name to search
 * @param env - Cloudflare Worker environment (for API key)
 * @param maxPages - Maximum pages to fetch (default: 1 = 100 books)
 * @returns ISBNdb author result with books
 */
export async function fetchAuthorBibliography(
  authorName: string,
  env: Env,
  maxPages: number = 1
): Promise<ISBNdbAuthorResult> {
  const apiKey = await env.ISBNDB_API_KEY.get();
  if (!apiKey) {
    return {
      author: authorName,
      books_found: 0,
      pages_fetched: 0,
      api_calls: 0,
      books: [],
      error: 'ISBNdb API key not configured',
    };
  }

  const pageSize = 100;
  const allBooks: ISBNdbBook[] = [];
  let page = 1;
  let hasMore = true;
  let apiCalls = 0;

  while (hasMore && page <= maxPages) {
    const response = await fetch(
      `https://api.premium.isbndb.com/author/${encodeURIComponent(authorName)}?page=${page}&pageSize=${pageSize}`,
      {
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    apiCalls++;

    if (response.status === 404) {
      break;
    }

    if (response.status === 429) {
      return {
        author: authorName,
        books_found: allBooks.length,
        pages_fetched: page - 1,
        api_calls: apiCalls,
        books: allBooks,
        error: 'rate_limited',
      };
    }

    if (response.status === 403) {
      return {
        author: authorName,
        books_found: allBooks.length,
        pages_fetched: page - 1,
        api_calls: apiCalls,
        books: allBooks,
        error: 'quota_exhausted',
      };
    }

    if (!response.ok) {
      return {
        author: authorName,
        books_found: allBooks.length,
        pages_fetched: page - 1,
        api_calls: apiCalls,
        books: allBooks,
        error: `ISBNdb API error: ${response.status}`,
      };
    }

    const data = (await response.json()) as ISBNdbAuthorResponse;

    if (data.books && Array.isArray(data.books)) {
      for (const book of data.books) {
        const isbn = book.isbn13 || book.isbn;
        if (isbn) {
          allBooks.push({
            isbn,
            title: book.title_long || book.title || 'Unknown',
            authors: book.authors || [authorName],
            publisher: book.publisher,
            date_published: book.date_published,
            pages: book.pages,
            language: book.language,
            synopsis: book.synopsis,
            image: book.image,
            image_original: book.image_original,
            subjects: book.subjects,
            binding: book.binding,
            dewey_decimal: book.dewey_decimal,
            related: book.related,
          });
        }
      }
    }

    const booksInResponse = data.books?.length || 0;
    hasMore = booksInResponse === pageSize;
    page++;

    // Rate limit between pagination requests (ISBNdb Premium: 3 req/sec)
    if (hasMore && page <= maxPages) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return {
    author: authorName,
    books_found: allBooks.length,
    pages_fetched: page - 1,
    api_calls: apiCalls,
    books: allBooks,
  };
}
