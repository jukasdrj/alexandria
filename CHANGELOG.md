# Alexandria Changelog

All notable changes to the Alexandria API and npm package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2026-01-07

### Added
- **Author Just-in-Time Enrichment**: View-triggered automatic author enrichment system
  - View-triggered enrichment on `GET /api/authors/:key` endpoint
  - Database migration adds 5 tracking columns: `last_viewed_at`, `view_count`, `heat_score`, `enrichment_priority`, `last_enrichment_queued_at`
  - New queue: `alexandria-author-queue` (10 batch size, 1 concurrency, 30s timeout)
  - Heat score calculation: `(view_count * 10) + (book_count * 0.5) + recency_boost`
  - Priority system (high/medium/low) based on heat score thresholds (>100, 20-100, <20)
  - 90-day staleness threshold for re-enrichment
  - Quota-aware circuit breakers at 85% (halt all) and 70% (halt low/medium priority)
  - `needsEnrichment()` logic in author-service with comprehensive checks
  - Queue handler `processAuthorQueue()` with full ISBNdb bibliography flow
  - Full documentation in `docs/features/AUTHOR-JIT-ENRICHMENT.md`
  - Migration file: `migrations/003_add_author_jit_tracking.sql`

### Changed
- Updated author routes to trigger JIT enrichment on author views
- Enhanced author service with enrichment decision logic
- Added AUTHOR_QUEUE binding to Worker environment
- Updated queue routing to handle author enrichment queue

### Documentation
- Created comprehensive feature documentation with architecture diagrams
- Added phased roadmap (Phase 1 complete, Phase 2-5 planned)
- Updated INDEX.md with new Features section
- Updated CURRENT-STATUS.md with JIT completion details
- Updated TODO.md with Author JIT Phase 2-5 roadmap

## [2.2.5] - 2026-01-06

### Changed
- **Code Quality**: Improved TypeScript type safety and logging consistency
  - Replaced `sql: any` with `Sql` type in query-detector for better type checking
  - Added `Logger.forScheduled()` static method for cron task logging
  - Replaced console.* calls with structured Logger in lifecycle handlers (fetch, queue, scheduled)
  - Enhanced error handling in query-detector with cleaner catch blocks
  - All changes maintain backward compatibility

## [2.2.4] - 2026-01-05

### Added
- **Cover URLs Enhancement**: BookResult now includes both legacy and modern cover URL formats
  - `coverUrl` - Legacy single cover URL (backward compatible)
  - `coverUrls` - New object with multiple sizes: `{ large, medium, small }`
  - Cover URLs use the `/covers/:isbn/:size` endpoint
  - All sizes are already available through existing R2 infrastructure
  - Provides consumers flexibility to choose optimal image size for their use case

### Changed
- Updated `BookResult` interface in types.ts to include optional `coverUrls` object
- Updated search endpoints (`/api/search` and `/api/search/combined`) to return both formats
- Updated `BookResultSchema` Zod schema to validate new coverUrls field

## [2.2.3] - 2026-01-05

### Fixed
- **NPM Package**: Updated `AuthorReference` interface to include enriched author metadata (#120)
  - Added `bio`, `gender`, `nationality`, `birth_year`, `death_year`, `wikidata_id`, `image` fields
  - Types now match actual API response from combined search endpoint
  - Ensures type-safe consumption of enriched author data in consuming applications

### Changed
- Combined search endpoint now returns full author metadata in all query types (ISBN, author, title)
- Fixed OpenLibrary URL construction (removed double `/authors/` prefix)

## [2.2.2] - 2026-01-05

### Fixed
- **NPM Package**: Published combined search implementation fixes to npm
  - Includes schema corrections from commit ab5812e
  - Ensures consumers get working combined search endpoint types and implementation

### Changed
- Bumped package version to 2.2.2 to include combined search fixes

## [2.2.1] - 2026-01-05

### Added
- **Combined Search Endpoint** (#120): Fully operational `/api/search/combined` with intelligent query detection
  - Auto-detects query type: ISBN (regex) → Author (DB lookup) → Title (fallback)
  - Type-specific KV caching: ISBN (24h TTL), Author/Title (1h TTL)
  - Query normalization and confidence scoring
  - Comprehensive metadata in responses (cache hits, timing, detection confidence)
  - Fixed schema mismatches in enriched tables queries
  - Successfully deployed and tested on production

### Fixed
- **Enriched Tables Schema**: Corrected column references in combined search queries
  - Fixed `work_id` → `work_key` throughout all queries
  - Fixed `edition_id` → `isbn` for proper joins
  - Fixed `cover_url` → `cover_url_large` for cover images
  - Fixed `edition_key` → `openlibrary_edition_id` for OpenLibrary URLs
  - Simplified author fields to match actual schema (name, key, openlibrary URL)

### Documentation
- Updated README.md to recommend combined search endpoint
- Updated CLAUDE.md to reflect Phase 1-5 completion
- Created GitHub Issue #120 for future author metadata enhancement
- Updated all documentation dates to January 5, 2026

## [2.2.0] - 2026-01-04

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
