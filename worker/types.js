// =================================================================================
// Type Definitions for Enrichment Endpoints
// =================================================================================

/**
 * @typedef {Object} EnrichEditionRequest
 * @property {string} isbn - Primary ISBN (13-digit preferred)
 * @property {string[]} [alternate_isbns] - Other ISBNs for same edition
 * @property {string} [work_key] - Reference to work (if known)
 * @property {string} [title] - Edition-specific title
 * @property {string} [subtitle] - Edition subtitle
 * @property {string} [publisher] - Publisher name
 * @property {string} [publication_date] - Publication date
 * @property {number} [page_count] - Number of pages
 * @property {string} [format] - Hardcover/Paperback/eBook
 * @property {string} [language] - Language code (en, es, fr)
 * @property {CoverUrls} [cover_urls] - Cover image URLs
 * @property {string} [cover_source] - Provider of cover image
 * @property {string} [openlibrary_edition_id] - OpenLibrary edition ID
 * @property {string[]} [amazon_asins] - Amazon ASINs
 * @property {string[]} [google_books_volume_ids] - Google Books volume IDs
 * @property {string[]} [goodreads_edition_ids] - Goodreads edition IDs
 * @property {string} primary_provider - Which API provided this (required)
 * @property {number} [confidence] - Quality score 0-100 (default: 80)
 * @property {number} [work_match_confidence] - Work match confidence 0-100
 * @property {string} [work_match_source] - Who matched the work
 */

/**
 * @typedef {Object} EnrichWorkRequest
 * @property {string} work_key - OpenLibrary work ID (required)
 * @property {string} title - Main title (required)
 * @property {string} [subtitle] - Subtitle
 * @property {string} [description] - Book description/summary
 * @property {string} [original_language] - Original language
 * @property {number} [first_publication_year] - First publication year
 * @property {string[]} [subject_tags] - Normalized genres
 * @property {CoverUrls} [cover_urls] - Cover image URLs
 * @property {string} [cover_source] - Provider of cover image
 * @property {string} [openlibrary_work_id] - OpenLibrary work ID
 * @property {string[]} [goodreads_work_ids] - Goodreads work IDs
 * @property {string[]} [amazon_asins] - Amazon ASINs
 * @property {string[]} [google_books_volume_ids] - Google Books volume IDs
 * @property {string} primary_provider - Required
 * @property {number} [confidence] - Default: 80
 */

/**
 * @typedef {Object} EnrichAuthorRequest
 * @property {string} author_key - OpenLibrary author ID (required)
 * @property {string} name - Author name (required)
 * @property {string} [gender] - Male/Female/NonBinary/Unknown
 * @property {string} [nationality] - Nationality
 * @property {number} [birth_year] - Birth year
 * @property {number} [death_year] - Death year
 * @property {string} [bio] - Biography
 * @property {string} [bio_source] - Biography source
 * @property {string} [author_photo_url] - Author photo URL
 * @property {string} [openlibrary_author_id] - OpenLibrary author ID
 * @property {string[]} [goodreads_author_ids] - Goodreads author IDs
 * @property {string} [wikidata_id] - Wikidata ID
 * @property {string} primary_provider - Required
 */

/**
 * @typedef {Object} CoverUrls
 * @property {string} [large] - Large cover image URL
 * @property {string} [medium] - Medium cover image URL
 * @property {string} [small] - Small cover image URL
 */

/**
 * @typedef {Object} EnrichmentResponse
 * @property {boolean} success - Whether the operation succeeded
 * @property {EnrichmentData} data - Response data
 */

/**
 * @typedef {Object} EnrichmentData
 * @property {string} isbn - ISBN or entity key
 * @property {'created'|'updated'} action - Was this new or an update
 * @property {number} [quality_improvement] - Quality score difference
 * @property {string} stored_at - ISO timestamp
 */

// No exports needed for JSDoc type definitions
