/**
 * Service Provider Framework - Capability Interfaces
 *
 * Defines the core interfaces and capabilities for Alexandria's external service providers.
 * Each service implements one or more capability interfaces based on what it offers.
 *
 * DESIGN PHILOSOPHY:
 * - Use TypeScript interfaces (not abstract classes) for maximum flexibility
 * - Optional methods (e.g., batchFetchMetadata?) avoid forced implementations
 * - Confidence scores use 0-100 scale for consistency across providers
 * - All async methods return Promises for non-blocking Worker execution
 */

import type { Env } from '../../src/env.js';
import type { Logger } from '../logger.js';
import type { ServiceContext } from './service-context.js';

/**
 * Service capabilities enum
 * Defines what operations a service can perform
 */
export enum ServiceCapability {
  ISBN_RESOLUTION = 'isbn-resolution',
  METADATA_ENRICHMENT = 'metadata-enrichment',
  COVER_IMAGES = 'cover-images',
  AUTHOR_BIOGRAPHY = 'author-biography',
  SUBJECT_ENRICHMENT = 'subject-enrichment',
  BOOK_GENERATION = 'book-generation',
}

/**
 * Base capability interface - all services implement at minimum
 */
export interface IServiceProvider {
  /** Service name (e.g., 'open-library', 'google-books') */
  readonly name: string;

  /** Provider type for categorization and prioritization */
  readonly providerType: 'free' | 'paid' | 'ai';

  /** Capabilities this provider offers */
  readonly capabilities: ServiceCapability[];

  /**
   * Check if service is available (API key exists, quota available, etc.)
   */
  isAvailable(env: Env): Promise<boolean>;
}

/**
 * ISBN Resolution Result
 */
export interface ISBNResolutionResult {
  isbn: string | null;
  confidence: number; // 0-100
  source: string;
  metadata?: Partial<BookMetadata>;
}

/**
 * ISBN Resolution capability
 * Resolves title/author to ISBN
 */
export interface IISBNResolver extends IServiceProvider {
  resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult>;
}

/**
 * Book Metadata (standardized format)
 */
export interface BookMetadata {
  isbn?: string;
  isbn13?: string;
  title: string;
  authors?: string[];
  publisher?: string;
  publishDate?: string;
  pageCount?: number;
  subjects?: string[];
  description?: string;
  language?: string;
  coverUrl?: string;
  externalIds?: {
    googleBooksId?: string;
    goodreadsId?: string;
    amazonAsin?: string;
    librarythingId?: string;
    wikidataQid?: string;
  };
  // ISBNdb-specific fields (optional for other providers)
  deweyDecimal?: string[];
  binding?: string;
  relatedISBNs?: Record<string, string>;
}

/**
 * Metadata Enrichment capability
 * Fetches comprehensive book metadata
 */
export interface IMetadataProvider extends IServiceProvider {
  /**
   * Fetch metadata for a single ISBN
   */
  fetchMetadata(
    isbn: string,
    context: ServiceContext
  ): Promise<BookMetadata | null>;

  /**
   * Batch fetch metadata for multiple ISBNs
   * Optional - not all providers support batching
   */
  batchFetchMetadata?(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, BookMetadata>>;
}

/**
 * Cover Image Result
 */
export interface CoverResult {
  url: string;
  source: string;
  size?: 'small' | 'medium' | 'large';
  width?: number;
  height?: number;
}

/**
 * Cover Image capability
 * Fetches book cover images
 */
export interface ICoverProvider extends IServiceProvider {
  fetchCover(
    isbn: string,
    context: ServiceContext
  ): Promise<CoverResult | null>;
}

/**
 * Author Biography
 */
export interface AuthorBiography {
  authorKey: string;
  name: string;
  biography: string;
  birthDate?: string;
  deathDate?: string;
  wikidataQid?: string;
  wikipediaUrl?: string;
  source: string;
}

/**
 * Author Biography capability
 * Fetches author biographies and biographical data
 */
export interface IAuthorBiographyProvider extends IServiceProvider {
  fetchBiography(
    authorKey: string,
    context: ServiceContext
  ): Promise<AuthorBiography | null>;
}

/**
 * Subject/Genre Enrichment capability
 * Fetches subject classifications and genres
 */
export interface ISubjectProvider extends IServiceProvider {
  fetchSubjects(
    isbn: string,
    context: ServiceContext
  ): Promise<string[]>;
}

/**
 * Generated Book Metadata (from AI)
 */
export interface GeneratedBook {
  title: string;
  author: string;
  publisher?: string;
  publishDate?: string;
  description?: string;
  subjects?: string[];
  confidence: number; // 0-100
  source: 'gemini' | string;
}

/**
 * Book Generation capability (AI-generated metadata)
 * Used for backfill and synthetic work creation
 */
export interface IBookGenerator extends IServiceProvider {
  /**
   * Generate book metadata based on a prompt/criteria
   */
  generateBooks(
    prompt: string,
    count: number,
    context: ServiceContext
  ): Promise<GeneratedBook[]>;
}
