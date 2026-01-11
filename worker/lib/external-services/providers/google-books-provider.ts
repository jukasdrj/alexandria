/**
 * Google Books Service Provider
 *
 * Provides book metadata, covers, and subject/category enrichment via Google Books API.
 *
 * Implements:
 * - IMetadataProvider: ISBN → Book metadata lookup
 * - ICoverProvider: ISBN → Cover image URL
 * - ISubjectProvider: ISBN → Categories/subjects
 *
 * Features:
 * - Free tier: 1000 requests/day
 * - KV-backed rate limiting (1 req/sec)
 * - Response caching (30-day TTL for stable metadata)
 * - Category extraction and normalization
 *
 * @module lib/external-services/providers/google-books-provider
 */

import type {
  IMetadataProvider,
  ICoverProvider,
  ISubjectProvider,
  BookMetadata,
  CoverResult,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

// =================================================================================
// Constants
// =================================================================================

const GOOGLE_BOOKS_API_BASE = 'https://www.googleapis.com/books/v1/volumes';

// =================================================================================
// Types
// =================================================================================

interface GoogleBooksVolumeResponse {
  items?: Array<{
    id: string;
    volumeInfo: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      publisher?: string;
      publishedDate?: string;
      pageCount?: number;
      language?: string;
      description?: string;
      categories?: string[];
      imageLinks?: {
        smallThumbnail?: string;
        thumbnail?: string;
      };
      industryIdentifiers?: Array<{
        type: string;
        identifier: string;
      }>;
    };
  }>;
}

// =================================================================================
// Google Books Provider
// =================================================================================

export class GoogleBooksProvider implements IMetadataProvider, ICoverProvider, ISubjectProvider {
  readonly name = 'google-books';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.METADATA_ENRICHMENT,
    ServiceCapability.COVER_IMAGES,
    ServiceCapability.SUBJECT_ENRICHMENT,
  ];

  private client = new ServiceHttpClient({
    providerName: 'google-books',
    rateLimitMs: 1000, // 1 req/sec (free tier: 1000 req/day)
    cacheTtlSeconds: 2592000, // 30 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(_env: Env): Promise<boolean> {
    // Optional API key improves quota, but not required
    return true;
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return null;
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]) {
      return null;
    }

    const volumeInfo = response.items[0].volumeInfo;
    return {
      title: volumeInfo.title || '',
      authors: volumeInfo.authors,
      publisher: volumeInfo.publisher,
      publishDate: volumeInfo.publishedDate,
      pageCount: volumeInfo.pageCount,
      language: volumeInfo.language,
      description: volumeInfo.description,
      subjects: volumeInfo.categories,
      coverUrl: volumeInfo.imageLinks?.thumbnail,
      externalIds: {
        googleBooksId: response.items[0].id,
      },
    };
  }

  async fetchCover(isbn: string, context: ServiceContext): Promise<CoverResult | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return null;
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]?.volumeInfo.imageLinks) {
      return null;
    }

    const thumbnail = response.items[0].volumeInfo.imageLinks.thumbnail;
    if (!thumbnail) {
      return null;
    }

    return {
      url: thumbnail.replace('http:', 'https:'), // Force HTTPS
      source: 'google-books',
      size: 'medium',
    };
  }

  async fetchSubjects(isbn: string, context: ServiceContext): Promise<string[]> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Google Books API call', { isbn });
      return [];
    }

    const url = `${GOOGLE_BOOKS_API_BASE}?q=isbn:${normalizedISBN}`;
    const response = await this.client.fetch<GoogleBooksVolumeResponse>(url, {}, context);

    if (!response?.items?.[0]?.volumeInfo.categories) {
      return [];
    }

    return response.items[0].volumeInfo.categories;
  }
}
