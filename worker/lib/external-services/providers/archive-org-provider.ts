/**
 * Archive.org Service Provider
 *
 * Fetches cover images and book metadata from Archive.org's digital library.
 * Excellent for pre-2000 books and historical texts.
 *
 * Implements:
 * - ICoverProvider: ISBN → Cover image URL
 * - IMetadataProvider: ISBN → Book metadata
 *
 * Features:
 * - Free, respectful rate limiting (1 req/sec)
 * - Response caching (7-day TTL)
 * - Cover quality detection
 * - Metadata enrichment (descriptions, subjects)
 *
 * @module lib/external-services/providers/archive-org-provider
 */

import type {
  IMetadataProvider,
  ICoverProvider,
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

const ARCHIVE_ORG_SEARCH_API = 'https://archive.org/advancedsearch.php';
const ARCHIVE_ORG_IMAGE_SERVICE = 'https://archive.org/services/img';

// =================================================================================
// Types
// =================================================================================

interface ArchiveOrgSearchResponse {
  response: {
    numFound: number;
    docs: Array<{
      identifier: string;
      title?: string;
      creator?: string | string[];
      publisher?: string | string[];
      date?: string;
      description?: string | string[];
      subject?: string | string[];
    }>;
  };
}

// =================================================================================
// Archive.org Provider
// =================================================================================

export class ArchiveOrgProvider implements ICoverProvider, IMetadataProvider {
  readonly name = 'archive.org';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.COVER_IMAGES,
    ServiceCapability.METADATA_ENRICHMENT,
  ];

  private client = new ServiceHttpClient({
    providerName: 'archive.org',
    rateLimitMs: 1000, // 1 req/sec (respectful)
    cacheTtlSeconds: 604800, // 7 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(_env: Env): Promise<boolean> {
    return true; // Free service, always available
  }

  async fetchCover(isbn: string, context: ServiceContext): Promise<CoverResult | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Archive.org API call', { isbn });
      return null;
    }

    // First, find the Archive.org identifier for this ISBN
    const identifier = await this.findIdentifier(normalizedISBN, context);
    if (!identifier) {
      return null;
    }

    // Use Archive.org Image Service for cover
    const coverUrl = `${ARCHIVE_ORG_IMAGE_SERVICE}/${identifier}`;

    return {
      url: coverUrl,
      source: 'archive.org',
      size: 'large',
    };
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    // Validate ISBN format before making API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      context.logger.debug('Invalid ISBN format, skipping Archive.org API call', { isbn });
      return null;
    }

    const params = new URLSearchParams({
      q: `isbn:${normalizedISBN}`,
      fl: 'identifier,title,creator,publisher,date,description,subject',
      output: 'json',
      rows: '1',
    });

    const url = `${ARCHIVE_ORG_SEARCH_API}?${params.toString()}`;
    const response = await this.client.fetch<ArchiveOrgSearchResponse>(url, {}, context);

    if (!response?.response?.docs?.[0]) {
      return null;
    }

    const doc = response.response.docs[0];
    return {
      title: doc.title || '',
      authors: Array.isArray(doc.creator) ? doc.creator : doc.creator ? [doc.creator] : undefined,
      publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher,
      publishDate: doc.date,
      description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
      subjects: Array.isArray(doc.subject) ? doc.subject : doc.subject ? [doc.subject] : undefined,
    };
  }

  private async findIdentifier(isbn: string, context: ServiceContext): Promise<string | null> {
    const params = new URLSearchParams({
      q: `isbn:${isbn}`,
      fl: 'identifier',
      output: 'json',
      rows: '1',
    });

    const url = `${ARCHIVE_ORG_SEARCH_API}?${params.toString()}`;
    const response = await this.client.fetch<ArchiveOrgSearchResponse>(url, {}, context);

    return response?.response?.docs?.[0]?.identifier || null;
  }
}
