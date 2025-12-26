/**
 * Database Type Definitions for Alexandria
 *
 * Provides proper TypeScript typing for database operations,
 * replacing 'any' types with specific interfaces.
 */

/**
 * PostgreSQL client interface
 * Used to replace 'any' types for SQL connections
 */
export interface SqlClient {
  // Template literal query method
  <T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>;

  // Connection management
  end(): Promise<void>;

  // Transaction support
  begin(fn?: (sql: SqlClient) => Promise<void>): Promise<void>;
}

/**
 * Search result interfaces for replacing any types in search operations
 */

export interface EditionSearchResult {
  edition_key: string;
  isbn: string;
  title: string;
  authors?: string[] | DatabaseRow[];
  author_names?: string[];
  publication_date?: string;
  publish_date?: string; // OpenLibrary format
  publisher?: string;
  publishers?: string; // OpenLibrary format
  pages?: number;
  cover_url_large?: string;
  cover_url_medium?: string;
  cover_url_small?: string;
  cover_url?: string; // Fallback field
  coverUrl?: string; // Legacy field
  work_key?: string;
  work_title?: string;
  binding?: string;
  related_isbns?: string[];
  primary_provider?: string;
  enriched?: boolean;
}

export interface AuthorSearchResult {
  author_key: string;
  name: string;
  bio?: string;
  birth_year?: number;
  death_year?: number;
  work_count: number;
  edition_count: number;
  gender?: string;
  gender_qid?: string;
  citizenship?: string;
  citizenship_qid?: string;
  birth_place?: string;
  birth_country?: string;
  wikidata_id?: string;
  wikidata_enriched_at?: string;
}

export interface WorkSearchResult {
  work_key: string;
  title: string;
  author_names: string[];
  author_keys?: string[];
  first_publish_year?: number;
  subject?: string[];
  subject_places?: string[];
  subject_people?: string[];
  editions_count: number;
  description?: string;
  primary_provider?: string;
}

/**
 * Database query result wrapper
 * For functions that return paginated results
 */
export interface QueryResult<T> {
  results: T[];
  total?: number;
  offset: number;
  limit: number;
  hasMore?: boolean;
}

/**
 * Generic database row interface
 * For raw SQL query results before transformation
 */
export interface DatabaseRow {
  [key: string]: any;
}

/**
 * Enriched table result types
 * Specific to Alexandria's enriched_* tables
 */

export interface EnrichedEdition {
  edition_key: string;
  isbn?: string;
  title: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publication_date?: string;
  pages?: number;
  language?: string;
  description?: string;
  subjects?: string[];
  cover_url_large?: string;
  cover_url_medium?: string;
  cover_url_small?: string;
  cover_url_original?: string;
  cover_source?: string;
  work_key?: string;
  primary_provider: string;
  created_at: string;
  updated_at: string;
}

export interface EnrichedAuthor {
  author_key: string;
  name: string;
  bio?: string;
  bio_source?: string;
  birth_year?: number;
  death_year?: number;
  gender?: string;
  gender_qid?: string;
  citizenship?: string;
  citizenship_qid?: string;
  birth_place?: string;
  birth_place_qid?: string;
  birth_country?: string;
  birth_country_qid?: string;
  death_place?: string;
  death_place_qid?: string;
  wikidata_id?: string;
  wikidata_enriched_at?: string;
  enrichment_source?: string;
  occupations?: string[];
  languages?: string[];
  awards?: string[];
  literary_movements?: string[];
  work_count: number;
  edition_count: number;
  openlibrary_author_id: string;
  primary_provider: string;
  created_at: string;
  updated_at: string;
}

export interface EnrichedWork {
  work_key: string;
  title: string;
  subtitle?: string;
  description?: string;
  subjects?: string[];
  subject_places?: string[];
  subject_people?: string[];
  first_publish_year?: number;
  language?: string;
  author_keys?: string[];
  author_names?: string[];
  editions_count: number;
  cover_edition_key?: string;
  primary_provider: string;
  created_at: string;
  updated_at: string;
}