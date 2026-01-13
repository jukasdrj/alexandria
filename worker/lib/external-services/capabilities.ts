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
  // Phase 1 - Quick Wins (Jan 2026)
  RATINGS = 'ratings',
  EDITION_VARIANTS = 'edition-variants',
  PUBLIC_DOMAIN = 'public-domain',
  SUBJECT_BROWSING = 'subject-browsing',
  // Phase 2 - High-Value (Jan 2026)
  SERIES_INFO = 'series-info',
  AWARDS = 'awards',
  TRANSLATIONS = 'translations',
  ENHANCED_EXTERNAL_IDS = 'enhanced-external-ids',
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

// =============================================================================
// Phase 1 - Quick Wins (Jan 2026)
// =============================================================================

/**
 * Ratings Result
 */
export interface RatingsResult {
  averageRating: number; // 0.0 - 5.0 scale
  ratingsCount: number;
  source: string;
  confidence: number; // 0-100
}

/**
 * Ratings capability
 * Fetches user ratings and review counts
 */
export interface IRatingsProvider extends IServiceProvider {
  fetchRatings(
    isbn: string,
    context: ServiceContext
  ): Promise<RatingsResult | null>;

  /**
   * Batch fetch ratings for multiple ISBNs
   * Optional - not all providers support batching
   */
  batchFetchRatings?(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, RatingsResult>>;
}

/**
 * Edition Variant (format variant)
 */
export interface EditionVariant {
  isbn: string;
  format: 'hardcover' | 'paperback' | 'ebook' | 'audiobook' | 'mass-market' | 'library-binding' | 'other';
  formatDescription?: string;
  publisher?: string;
  publishDate?: string;
  price?: number;
  currency?: string;
  availability?: 'in-print' | 'out-of-print' | 'pre-order' | 'unknown';
  source: string;
}

/**
 * Edition Variants capability
 * Fetches different format editions of the same work
 */
export interface IEditionVariantProvider extends IServiceProvider {
  fetchEditionVariants(
    isbn: string,
    context: ServiceContext
  ): Promise<EditionVariant[]>;
}

/**
 * Public Domain Result
 */
export interface PublicDomainResult {
  isPublicDomain: boolean;
  confidence: number; // 0-100
  reason: 'publication-date' | 'copyright-expiration' | 'explicit-license' | 'api-verified' | 'unknown';
  copyrightExpiry?: number; // Year
  downloadUrl?: string;
  source: string;
}

/**
 * Public Domain capability
 * Detects if a book is in the public domain
 */
export interface IPublicDomainProvider extends IServiceProvider {
  checkPublicDomain(
    isbn: string,
    context: ServiceContext
  ): Promise<PublicDomainResult | null>;
}

/**
 * Subject Node (hierarchical subject/genre)
 */
export interface SubjectNode {
  id: string;
  label: string;
  parentId: string | null;
  childIds: string[];
  bookCount?: number;
  source: string;
}

/**
 * Subject Browsing capability
 * Fetches hierarchical subject/genre taxonomies
 */
export interface ISubjectBrowsingProvider extends IServiceProvider {
  fetchSubjectHierarchy(
    subjectId: string,
    depth: number,
    context: ServiceContext
  ): Promise<SubjectNode[]>;

  searchSubjects(
    query: string,
    context: ServiceContext
  ): Promise<SubjectNode[]>;
}

// =============================================================================
// Phase 2 - High-Value (Jan 2026)
// =============================================================================

/**
 * Series Information
 */
export interface SeriesInfo {
  seriesName: string;
  seriesPosition?: number;
  totalBooks?: number;
  seriesId?: string;
  relatedIsbns?: string[];
  confidence: number; // 0-100
  source: string;
}

/**
 * Series Information capability
 * Fetches book series metadata
 */
export interface ISeriesProvider extends IServiceProvider {
  fetchSeriesInfo(
    isbn: string,
    context: ServiceContext
  ): Promise<SeriesInfo | null>;

  /**
   * Fetch all books in a series
   * Optional - not all providers support this
   */
  fetchSeriesBooks?(
    seriesId: string,
    context: ServiceContext
  ): Promise<string[]>;
}

/**
 * Award Information
 */
export interface AwardInfo {
  awardName: string;
  year: number;
  category?: string;
  isWinner: boolean; // false = nominee
  awardId?: string;
  source: string;
}

/**
 * Awards capability
 * Fetches literary awards and nominations
 */
export interface IAwardsProvider extends IServiceProvider {
  fetchAwards(
    isbn: string,
    context: ServiceContext
  ): Promise<AwardInfo[]>;
}

/**
 * Translation Information
 */
export interface TranslationInfo {
  isbn: string;
  languageCode: string; // ISO 639-1
  languageName: string;
  translatedTitle: string;
  translators?: string[];
  publisher?: string;
  publishDate?: string;
  source: string;
}

/**
 * Translations capability
 * Fetches translated editions in other languages
 */
export interface ITranslationProvider extends IServiceProvider {
  fetchTranslations(
    isbn: string,
    context: ServiceContext
  ): Promise<TranslationInfo[]>;

  /**
   * Fetch translation in a specific language
   * Optional - not all providers support targeted lookup
   */
  fetchTranslationByLanguage?(
    isbn: string,
    languageCode: string,
    context: ServiceContext
  ): Promise<TranslationInfo | null>;
}

/**
 * Enhanced External IDs
 * Comprehensive cross-provider identifier mapping
 */
export interface EnhancedExternalIds {
  amazonAsin?: string;
  goodreadsId?: string;
  googleBooksId?: string;
  librarythingId?: string;
  wikidataQid?: string;
  openLibraryWorkKey?: string;
  openLibraryEditionKey?: string;
  archiveOrgId?: string;
  oclcNumber?: string;
  lccn?: string;
  sources: string[]; // Which providers contributed IDs
  confidence: number; // 0-100
}

/**
 * Enhanced External IDs capability
 * Fetches comprehensive external identifiers for cross-provider linking
 */
export interface IEnhancedExternalIdProvider extends IServiceProvider {
  fetchEnhancedExternalIds(
    isbn: string,
    context: ServiceContext
  ): Promise<EnhancedExternalIds | null>;

  /**
   * Batch fetch external IDs for multiple ISBNs
   * Optional - not all providers support batching
   */
  batchFetchEnhancedExternalIds?(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, EnhancedExternalIds>>;
}
