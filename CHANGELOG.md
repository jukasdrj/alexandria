# Alexandria Changelog

All notable changes to the Alexandria API and npm package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Author Name Normalization** (#114): Complete author deduplication system
  - Added `normalized_name` column to `enriched_authors` table
  - Created `normalize_author_name()` PostgreSQL function with comprehensive normalization rules
  - Added GIN trigram and B-tree indexes on `normalized_name` for performance
  - Created `authors_canonical` view for deduplicated author listings
  - Auto-normalize trigger keeps `normalized_name` in sync with `name` changes
  - Migration handles backfill of 14.7M authors in batches (50K per batch)
  - Handles: case variations, spacing, co-authors, suffixes, synonyms, quotes
  - Comprehensive test suite (13 PostgreSQL function tests + integration tests)

### Changed
- **Author Search**: Updated `/api/search?author=...` to use `normalized_name` for deduplication
  - Searches now match author name variations automatically
  - Falls back to ILIKE on `name` if `normalized_name` is NULL (backward compatible)
  - Reduced duplicate author results in search responses
- **Top Authors**: Updated `/api/authors/top` to deduplicate by `normalized_name`
  - Shows one canonical author per normalized name
  - Selects author with most books as canonical version
  - Eliminates duplicate entries in top author lists

### Documentation
- Added comprehensive `docs/AUTHOR-NORMALIZATION.md` guide
- Created migration file `migrations/005_add_author_normalization.sql`
- Created test suite `migrations/005_test_normalization.sql`
- Added analysis script `scripts/analyze-author-duplicates.js`

## [2.1.0] - 2025-12-03

### Added
- **New `/api/search/combined` endpoint** - Unified search endpoint with intelligent ISBN vs text detection
  - Automatically detects ISBN queries and uses fast indexed lookups (~60ms)
  - Text queries perform parallel title + author search (~1-2s)
  - Returns results with automatic deduplication
  - Full pagination support built-in
- **Pagination support** - All search endpoints now support `offset` parameter
  - All endpoints: limit (default: 10, max: 100), offset (default: 0)
- **Enhanced TypeScript types**:
  - `CombinedSearchQuery` - Request type for combined search
  - `CombinedSearchResult` - Response type for combined search
  - `PaginationMetadata` - Comprehensive pagination info with `hasMore` flag
  - `BookResult.type` - Optional field indicating result type
  - `BookResult.openlibrary_author` - Optional field for author links
- **Performance optimizations**:
  - Parallel COUNT and data queries for accurate totals
  - DISTINCT subqueries to avoid over-counting

### Changed
- **Breaking**: `SearchResult` response now includes `pagination` object
  - The `count` field is deprecated (use `pagination.total`)
- Updated `README-INTEGRATION.md` with comprehensive examples

### Fixed
- Issue #41 - Combined search endpoint implemented
- Issue #42 - Pagination support added

## [2.0.0] - 2025-11

### Added
- Full TypeScript support with exported types
- Zod runtime validation on all endpoints
- Type-safe API client patterns
- `README-INTEGRATION.md` with integration guide

## Migration Guide: v2.0.0 → v2.1.0

Response structure change:
```typescript
// Before: results.count
// After: results.pagination.total
```

Use the new combined search endpoint for simpler integration.
