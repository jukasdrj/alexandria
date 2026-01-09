/**
 * Open APIs TypeScript Type Definitions
 *
 * Type definitions for Archive.org, Wikipedia, and Wikidata API integrations.
 * These types follow Alexandria's service-layer patterns for external API integration.
 *
 * **Design Principles:**
 * - Pure TypeScript interfaces (not Zod schemas)
 * - No `any` types - strict TypeScript
 * - JSDoc comments for complex structures
 * - Native JSONB storage (avoid stringified JSON anti-pattern)
 * - Consistent with existing patterns in services/types.ts
 *
 * @module worker/types/open-apis
 * @since 2.3.0
 */

// =================================================================================
// Provider Enum
// =================================================================================

/**
 * Open API provider identifiers
 * Consistent with existing provider patterns in external-ids.ts
 */
export type OpenApiProvider = 'archive-org' | 'wikipedia' | 'wikidata';

// =================================================================================
// Shared Types
// =================================================================================

/**
 * Cache configuration for API responses
 */
export interface CacheOptions {
  /**
   * Time-to-live in seconds
   * - Biographies: 2592000 (30 days)
   * - Covers: 604800 (7 days)
   * - Metadata: 86400 (1 day)
   */
  ttl: number;

  /**
   * KV namespace key pattern
   * Format: `{provider}:{entity_type}:{identifier}`
   * Example: `wikipedia:author:J._K._Rowling`
   */
  key: string;

  /**
   * Force cache refresh
   */
  forceRefresh?: boolean;
}

/**
 * Rate limiting configuration for API clients
 * Uses KV-backed state (NOT in-memory) for distributed workers
 */
export interface RateLimitConfig {
  /**
   * Minimum delay between requests in milliseconds
   * - Archive.org: 1000ms (respectful delay)
   * - Wikipedia: 1000ms (respect best practices)
   * - Wikidata: 500ms (SPARQL endpoint, 2 req/sec)
   */
  minDelayMs: number;

  /**
   * KV namespace key for rate limit state
   * Format: `ratelimit:{provider}:last_request_timestamp`
   */
  kvKey: string;
}

/**
 * API error response structure
 */
export interface ApiErrorResponse {
  provider: OpenApiProvider;
  error: string;
  statusCode?: number;
  retryable: boolean;
  timestamp: string;
}

/**
 * Generic API success metadata
 */
export interface ApiResponseMeta {
  provider: OpenApiProvider;
  cached: boolean;
  latency_ms: number;
  timestamp: string;
}

// =================================================================================
// Archive.org Types
// =================================================================================

/**
 * Archive.org metadata API response structure
 * Endpoint: https://archive.org/metadata/{identifier}
 */
export interface ArchiveOrgMetadataResponse {
  created: number;
  d1: string;
  d2: string;
  dir: string;
  files: ArchiveOrgFile[];
  files_count: number;
  item_last_updated: number;
  item_size: number;
  metadata: ArchiveOrgMetadata;
  server: string;
  uniq: number;
  workable_servers: string[];
}

/**
 * Archive.org file entry in metadata response
 */
export interface ArchiveOrgFile {
  name: string;
  source: string;
  format: string;
  mtime?: string;
  size?: string;
  md5?: string;
  crc32?: string;
  sha1?: string;
  rotation?: string;
  original?: string;
}

/**
 * Archive.org metadata object
 */
export interface ArchiveOrgMetadata {
  identifier: string;
  title?: string;
  creator?: string | string[];
  publisher?: string | string[];
  date?: string;
  language?: string | string[];
  mediatype: string;
  collection?: string | string[];
  description?: string | string[];
  subject?: string | string[];
  isbn?: string | string[];

  /**
   * Additional metadata fields (Archive.org has 100+ possible fields)
   */
  [key: string]: unknown;
}

/**
 * Archive.org advanced search response
 * Endpoint: https://archive.org/advancedsearch.php
 */
export interface ArchiveOrgSearchResponse {
  responseHeader: {
    status: number;
    QTime: number;
    params: Record<string, string>;
  };
  response: {
    numFound: number;
    start: number;
    docs: ArchiveOrgSearchDoc[];
  };
}

/**
 * Archive.org search document result
 */
export interface ArchiveOrgSearchDoc {
  identifier: string;
  title?: string;
  creator?: string[];
  date?: string;
  publisher?: string[];
  isbn?: string[];
  mediatype: string;
}

/**
 * Cover result from Archive.org
 * Extracted from files array in metadata response
 */
export interface ArchiveOrgCoverResult {
  provider: 'archive-org';
  identifier: string;
  coverUrl: string;
  format: string;
  confidence: number;
  fetched_at: string;
}

// =================================================================================
// Wikipedia Types
// =================================================================================

/**
 * Wikipedia API query response (action=query)
 * Endpoint: https://en.wikipedia.org/w/api.php
 */
export interface WikipediaQueryResponse {
  batchcomplete?: string;
  continue?: {
    continue: string;
    [key: string]: string;
  };
  query: {
    pages: Record<string, WikipediaPage>;
    normalized?: WikipediaNormalization[];
  };
}

/**
 * Wikipedia page normalization info
 */
export interface WikipediaNormalization {
  from: string;
  to: string;
}

/**
 * Wikipedia page data
 */
export interface WikipediaPage {
  pageid: number;
  ns: number;
  title: string;
  extract?: string;
  thumbnail?: WikipediaThumbnail;
  pageimage?: string;
  categories?: WikipediaCategory[];
  missing?: string;
}

/**
 * Wikipedia page thumbnail
 */
export interface WikipediaThumbnail {
  source: string;
  width: number;
  height: number;
}

/**
 * Wikipedia category
 */
export interface WikipediaCategory {
  ns: number;
  title: string;
}

/**
 * Author biography data from Wikipedia
 * **CRITICAL:** Stored as native JSONB in enriched_authors.biography_data
 * (NOT stringified JSON - avoid metadata anti-pattern)
 *
 * Database storage:
 * ```sql
 * ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS biography_data JSONB;
 * ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikidata_id TEXT;
 * ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikipedia_page_title TEXT;
 * ```
 */
export interface WikipediaAuthorBiography {
  source: 'wikipedia';
  article_title: string;

  /**
   * Wikipedia extract (first 2-3 paragraphs)
   * Plain text or HTML depending on query parameters
   */
  extract: string;

  /**
   * Birth year extracted from infobox or text
   */
  birth_year?: number;

  /**
   * Death year (if deceased)
   */
  death_year?: number;

  /**
   * Nationality/citizenship extracted from infobox
   */
  nationality?: string[];

  /**
   * Author's portrait image URL from Wikimedia Commons
   */
  image_url?: string;

  /**
   * ISO 8601 timestamp of fetch
   */
  fetched_at: string;

  /**
   * Full Wikipedia article URL
   */
  wikipedia_url: string;

  /**
   * Wikidata Q-ID if available (for crosswalk)
   * Example: "Q34660" for J.K. Rowling
   */
  wikidata_qid?: string;

  /**
   * Confidence score for biography match (0-100)
   * Factors: exact name match, has birth year, categories match
   */
  confidence: number;
}

/**
 * Wikipedia disambiguation detection
 * Used to determine if conservative fallback is needed
 */
export interface WikipediaDisambiguation {
  is_disambiguation: boolean;
  disambiguation_options?: string[];
  reason?: string;
}

// =================================================================================
// Wikidata Types
// =================================================================================

/**
 * Wikidata SPARQL query response
 * Endpoint: https://query.wikidata.org/sparql
 */
export interface WikidataSparqlResponse {
  head: {
    vars: string[];
  };
  results: {
    bindings: WikidataSparqlBinding[];
  };
}

/**
 * SPARQL result binding (single row)
 */
export interface WikidataSparqlBinding {
  [variable: string]: WikidataSparqlValue | undefined;
}

/**
 * SPARQL value with type information
 */
export interface WikidataSparqlValue {
  type: 'uri' | 'literal' | 'bnode';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

/**
 * Wikidata entity structure
 * Represents a book, author, or publisher entity
 */
export interface WikidataEntity {
  /**
   * Wikidata Q-ID
   * Example: "Q43361" for Harry Potter and the Philosopher's Stone
   */
  qid: string;

  /**
   * Entity label (en)
   */
  label: string;

  /**
   * Entity description (en)
   */
  description?: string;

  /**
   * Properties map (P-codes to values)
   * Common properties:
   * - P212: ISBN-13
   * - P957: ISBN-10
   * - P50: Author
   * - P18: Image
   * - P577: Publication date
   * - P136: Genre
   * - P921: Main subject
   */
  properties: Record<string, WikidataPropertyValue[]>;

  /**
   * ISO 8601 timestamp of fetch
   */
  fetched_at: string;
}

/**
 * Wikidata property value
 */
export interface WikidataPropertyValue {
  /**
   * Value type: string, entity, time, quantity, etc.
   */
  type: string;

  /**
   * Raw value
   */
  value: string;

  /**
   * For entity references, the Q-ID
   */
  entity_id?: string;

  /**
   * For entity references, the label (en)
   */
  label?: string;
}

/**
 * Wikidata book metadata
 * Extracted from SPARQL query for ISBN lookup
 */
export interface WikidataBookMetadata {
  qid: string;
  title: string;
  isbn13?: string[];
  isbn10?: string[];

  /**
   * Author Q-IDs
   * Example: ["Q34660"] for J.K. Rowling
   */
  author_qids?: string[];

  /**
   * Author labels (en)
   */
  author_names?: string[];

  /**
   * Publication date (YYYY-MM-DD format)
   */
  publication_date?: string;

  /**
   * Publisher Q-ID
   */
  publisher_qid?: string;

  /**
   * Publisher label (en)
   */
  publisher_name?: string;

  /**
   * Genre Q-IDs
   */
  genre_qids?: string[];

  /**
   * Genre labels (en)
   */
  genre_names?: string[];

  /**
   * Main subject Q-IDs
   */
  subject_qids?: string[];

  /**
   * Main subject labels (en)
   */
  subject_names?: string[];

  /**
   * Cover image URL from Wikimedia Commons (P18)
   */
  image_url?: string;

  /**
   * ISO 8601 timestamp of fetch
   */
  fetched_at: string;

  /**
   * Confidence score (0-100)
   * Based on: ISBN match, author verification, data completeness
   */
  confidence: number;
}

/**
 * Wikidata author data (diversity enrichment)
 * Comprehensive author profile for diversity tracking and bibliographies
 */
export interface WikidataAuthorEnriched {
  qid: string;

  /**
   * Author name (label from Wikidata)
   */
  name: string;

  /**
   * Gender (P21)
   * Example: "female", "male", "non-binary"
   */
  gender?: string;

  /**
   * Gender Q-ID
   */
  gender_qid?: string;

  /**
   * Citizenship/nationality (P27)
   * Example: ["British", "American"]
   */
  citizenship?: string[];

  /**
   * Citizenship Q-IDs
   */
  citizenship_qids?: string[];

  /**
   * Birth year (extracted from P569)
   */
  birth_year?: number;

  /**
   * Death year (extracted from P570)
   */
  death_year?: number;

  /**
   * Birth place (P19)
   */
  birth_place?: string;

  /**
   * Birth place Q-ID
   */
  birth_place_qid?: string;

  /**
   * Birth country (P19 → P17)
   */
  birth_country?: string;

  /**
   * Birth country Q-ID
   */
  birth_country_qid?: string;

  /**
   * Death place (P20)
   */
  death_place?: string;

  /**
   * Death place Q-ID
   */
  death_place_qid?: string;

  /**
   * Occupations (P106)
   * Example: ["novelist", "screenwriter", "philanthropist"]
   */
  occupations?: string[];

  /**
   * Occupation Q-IDs
   */
  occupation_qids?: string[];

  /**
   * Author portrait image URL from Wikimedia Commons (P18)
   */
  image_url?: string;

  /**
   * Literary movements (P135)
   * Example: ["Modernism", "Post-colonialism"]
   */
  movements?: string[];

  /**
   * Movement Q-IDs
   */
  movement_qids?: string[];

  /**
   * Awards received (P166)
   */
  awards?: string[];

  /**
   * Award Q-IDs
   */
  award_qids?: string[];

  /**
   * Notable works (P800)
   */
  notable_works?: string[];

  /**
   * Notable work Q-IDs
   */
  notable_work_qids?: string[];

  /**
   * ISO 8601 timestamp of fetch
   */
  fetched_at: string;
}

/**
 * Wikidata bibliography entry
 * Result from author bibliography query
 */
export interface WikidataBibliographyWork {
  work_qid: string;
  work_title: string;
  publication_date?: string;
  isbn13?: string[];
  isbn10?: string[];
  genre?: string[];
  genre_qids?: string[];
}

/**
 * SPARQL property codes used in queries
 * Centralized reference for Wikidata properties
 */
export const WikidataProperties = {
  /**
   * P212: ISBN-13
   */
  ISBN_13: 'P212',

  /**
   * P957: ISBN-10
   */
  ISBN_10: 'P957',

  /**
   * P50: Author
   */
  AUTHOR: 'P50',

  /**
   * P18: Image
   */
  IMAGE: 'P18',

  /**
   * P577: Publication date
   */
  PUBLICATION_DATE: 'P577',

  /**
   * P136: Genre
   */
  GENRE: 'P136',

  /**
   * P921: Main subject
   */
  MAIN_SUBJECT: 'P921',

  /**
   * P123: Publisher
   */
  PUBLISHER: 'P123',

  /**
   * P21: Sex or gender
   */
  GENDER: 'P21',

  /**
   * P27: Country of citizenship
   */
  CITIZENSHIP: 'P27',

  /**
   * P569: Date of birth
   */
  DATE_OF_BIRTH: 'P569',

  /**
   * P570: Date of death
   */
  DATE_OF_DEATH: 'P570',

  /**
   * P19: Place of birth
   */
  PLACE_OF_BIRTH: 'P19',

  /**
   * P20: Place of death
   */
  PLACE_OF_DEATH: 'P20',

  /**
   * P17: Country
   */
  COUNTRY: 'P17',

  /**
   * P106: Occupation
   */
  OCCUPATION: 'P106',

  /**
   * P135: Movement
   */
  MOVEMENT: 'P135',

  /**
   * P166: Award received
   */
  AWARD_RECEIVED: 'P166',

  /**
   * P800: Notable work
   */
  NOTABLE_WORK: 'P800',

  /**
   * P214: VIAF ID
   */
  VIAF_ID: 'P214',

  /**
   * P213: ISNI
   */
  ISNI: 'P213',

  /**
   * P648: Open Library ID
   */
  OPENLIBRARY_ID: 'P648',
} as const;

// =================================================================================
// Service Layer Integration Types
// =================================================================================

/**
 * Unified cover result from any Open API provider
 * Compatible with existing CoverUrls interface in services/types.ts
 */
export interface OpenApiCoverResult {
  provider: OpenApiProvider;
  url: string;
  confidence: number;
  fetched_at: string;
  metadata?: {
    identifier?: string;
    format?: string;
    source_url?: string;
  };
}

/**
 * Author enrichment request for Open APIs
 * Used by author queue processor
 */
export interface OpenApiAuthorEnrichmentRequest {
  author_key: string;
  author_name: string;

  /**
   * Known Wikidata Q-ID (if available)
   */
  wikidata_qid?: string;

  /**
   * Known Wikipedia page title (if available)
   */
  wikipedia_page_title?: string;

  /**
   * Priority: high, medium, low
   */
  priority?: string;

  /**
   * Source of enrichment request
   */
  source?: string;
}

/**
 * Author enrichment result from Open APIs
 */
export interface OpenApiAuthorEnrichmentResult {
  author_key: string;
  success: boolean;

  /**
   * Which providers were attempted
   */
  providers_attempted: OpenApiProvider[];

  /**
   * Which providers succeeded
   */
  providers_succeeded: OpenApiProvider[];

  /**
   * Wikipedia biography data (if fetched)
   */
  wikipedia_bio?: WikipediaAuthorBiography;

  /**
   * Wikidata enrichment data (if fetched)
   */
  wikidata_data?: WikidataAuthorEnriched;

  /**
   * Author portrait URL (best available from any provider)
   */
  portrait_url?: string;

  /**
   * Errors encountered
   */
  errors?: string[];

  /**
   * Total latency in milliseconds
   */
  latency_ms: number;

  /**
   * ISO 8601 timestamp
   */
  timestamp: string;
}

/**
 * Book metadata enrichment from Wikidata
 */
export interface OpenApiBookEnrichmentResult {
  isbn: string;
  success: boolean;

  /**
   * Wikidata book metadata (if found)
   */
  wikidata_book?: WikidataBookMetadata;

  /**
   * Cover URL from Wikidata/Wikimedia Commons (if available)
   */
  cover_url?: string;

  /**
   * Errors encountered
   */
  errors?: string[];

  /**
   * Latency in milliseconds
   */
  latency_ms: number;

  /**
   * ISO 8601 timestamp
   */
  timestamp: string;
}

// =================================================================================
// Type Guards
// =================================================================================

/**
 * Type guard for Archive.org cover result
 */
export function isArchiveOrgCoverResult(result: unknown): result is ArchiveOrgCoverResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'provider' in result &&
    result.provider === 'archive-org' &&
    'coverUrl' in result &&
    typeof result.coverUrl === 'string'
  );
}

/**
 * Type guard for Wikipedia author biography
 */
export function isWikipediaAuthorBiography(bio: unknown): bio is WikipediaAuthorBiography {
  return (
    typeof bio === 'object' &&
    bio !== null &&
    'source' in bio &&
    bio.source === 'wikipedia' &&
    'article_title' in bio &&
    'extract' in bio
  );
}

/**
 * Type guard for Wikidata entity
 */
export function isWikidataEntity(entity: unknown): entity is WikidataEntity {
  return (
    typeof entity === 'object' &&
    entity !== null &&
    'qid' in entity &&
    typeof entity.qid === 'string' &&
    'properties' in entity &&
    typeof entity.properties === 'object'
  );
}
