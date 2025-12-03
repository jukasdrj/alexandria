# Changelog

All notable changes to Alexandria will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-XX (Current)

### Added
- **TypeScript Migration**: Full TypeScript support with exported types
- **Zod Validation**: Runtime validation on all API endpoints
- **Type Exports**: Package exports types for external consumption via `alexandria-worker/types`
- **OpenAPI 3.0 Specification**: Complete API documentation at `/openapi.json`

### Documentation
- Comprehensive integration guide for external services
- Updated README with current architecture and features
- Reference documentation for tunnel and enrichment architecture

## [1.6.0] - 2024-12-XX

### Added (Phase 2.6)
- **Enrichment Endpoints**: Write APIs for edition, work, and author metadata
  - `POST /api/enrich/edition` - Store edition metadata
  - `POST /api/enrich/work` - Store work metadata
  - `POST /api/enrich/author` - Store author metadata
  - `POST /api/enrich/queue` - Queue background enrichment jobs
  - `GET /api/enrich/status/:id` - Check job status
- **Quality Scoring**: Automatic quality assessment for enriched data
- **Conflict Detection**: Identify and handle metadata conflicts

## [1.5.0] - 2024-11-XX

### Added (Phase 2.5)
- **Cover Processing**: R2-based cover image storage and serving
  - `POST /api/covers/process` - Work-based cover processing
  - `GET /api/covers/:work_key/:size` - Serve covers (large/medium/small)
  - `POST /covers/:isbn/process` - Legacy ISBN-based processing
  - `GET /covers/:isbn/:size` - Legacy ISBN-based serving
- **Multi-provider Fetching**: OpenLibrary, ISBNdb, Google Books integration
- **Domain Whitelist**: Security for cover URL downloads
- **Image Hashing**: Content-based deduplication

## [1.0.0] - 2024-10-XX

### Added (Phase 2)
- **Hyperdrive Integration**: PostgreSQL connection pooling via Cloudflare Hyperdrive
- **Database Search**: ISBN, title, and author search endpoints
  - `GET /api/search?isbn={isbn}`
  - `GET /api/search?title={title}`
  - `GET /api/search?author={author}`
- **Statistics Endpoint**: `GET /api/stats` for database metrics
- **Health Check**: `GET /health` with database connectivity status
- **Interactive Dashboard**: Web UI at `/` for testing searches

### Infrastructure
- Cloudflare Access integration for tunnel security
- Service Token authentication
- SSL enabled on PostgreSQL
- Request-scoped database connections (fixed I/O context errors)

## [0.1.0] - 2024-09-XX

### Added (Phase 1)
- **Infrastructure Setup**: Cloudflare Tunnel deployment on Unraid
- **DNS Configuration**: `alexandria-db.ooheynerds.com`
- **Worker Deployment**: Basic worker at `alexandria.ooheynerds.com`
- **PostgreSQL Import**: 54.8M editions, 49.3M ISBNs, 40.1M works, 14.7M authors
- **Documentation**: Setup guides and architecture docs
- **Deployment Scripts**: Automated tunnel and worker deployment

[2.0.0]: https://github.com/jukasdrj/alexandria/compare/v1.6.0...v2.0.0
[1.6.0]: https://github.com/jukasdrj/alexandria/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/jukasdrj/alexandria/compare/v1.0.0...v1.5.0
[1.0.0]: https://github.com/jukasdrj/alexandria/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/jukasdrj/alexandria/releases/tag/v0.1.0
