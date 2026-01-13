# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Role

**Identity:** Alex (Data Lake) - Librarian & Archivist
**Scope:** Book metadata integrity, ingestion, enrichment, and serving
**Upstream:** Provides data to bendv3 (API gateway)

## Task Orchestration Philosophy

**As Alexandria's task orchestrator, I (Claude) must:**

1. **Delegate to specialized agents** - Never do complex work myself when specialized skills/agents exist
2. **Call agents in parallel** - When tasks are independent, invoke multiple agents concurrently for speed
3. **Verify all agent outputs** - Either personally or via PAL MCP models (thinkdeep, codereview, etc.)
4. **Use planning-with-files structure** - ALL complex tasks (>5 tool calls) MUST use structured planning
5. **Trust but verify** - Agent outputs are generally correct, but I must validate against requirements

**Task Routing Rules (Priority Order):**

**PRIMARY: Use Skill-Based Planning for Implementation**
- **All multi-step implementation tasks** → `/planning-with-files` skill (creates task_plan.md, findings.md, progress.md)
- Database work → `/schema-migration` (auto-loads planning-with-files + postgres-optimizer agent)
- API integration → `/api-integration` (auto-loads planning-with-files, forked context)
- Queue tuning → `/queue-optimization` (auto-loads planning-with-files + cloudflare-workers-optimizer agent)

**SECONDARY: Use PAL MCP for Post-Implementation Validation**
- Deep debugging mysterious bugs → PAL MCP `debug` tool (NOT for planning implementation)
- Post-implementation code review → PAL MCP `codereview` tool
- Security vulnerability scanning → PAL MCP `secaudit` tool
- Multi-model architectural validation → PAL MCP `consensus` tool

**NEVER use `mcp__pal__planner` for implementation tasks** - It's for conceptual architectural planning only (rarely needed). Use the `planning-with-files` skill instead.

**Verification Strategy:**
- Simple changes: Personal review of agent output
- Complex changes: Use PAL MCP tools (`codereview`, `precommit`, `thinkdeep`) for expert validation
- Critical changes: Multi-model consensus via PAL MCP `consensus` tool

**Why This Matters:**
- **0% regression rate** on complex changes (proven in BooksTrack)
- **40% faster** completion via parallel agent execution
- **100% resumability** across sessions via structured planning files
- **Clear visibility** for user into progress and decision-making

## Skills & Agents Architecture

Alexandria leverages Claude Code v2.1+ skills and custom agents for specialized workflows.

**Custom Agents** (`.claude/agents/`):
- **postgres-optimizer** - Database schema, query optimization, index strategies
  - Auto-loads: planning-with-files, optimize-query, db-query
  - Use for: Schema migrations, performance tuning, complex queries
- **cloudflare-workers-optimizer** - Workers performance, wrangler config, queue optimization
  - Auto-loads: planning-with-files, optimize-query
  - Use for: Queue tuning, deployment issues, cost optimization

**Domain Skills** (`.claude/skills/`):
- **planning-with-files** - Multi-step task planning with structured files (task_plan.md, findings.md, progress.md)
- **schema-migration** - Safe database changes with postgres-optimizer agent (forked context)
- **api-integration** - Add external API providers with rate limiting and circuit breakers (forked context)
- **queue-optimization** - Optimize Cloudflare Queue performance with cloudflare-workers-optimizer agent

**Invocation:**
```bash
# Direct skill invocation
/schema-migration
/api-integration
/queue-optimization

# Or let Claude choose automatically based on task
"Add a new column to enriched_editions"  → schema-migration
"Integrate LibraryThing API"              → api-integration
"The enrichment queue is backing up"      → queue-optimization
```

**Skill Composition:**
Skills auto-load sub-skills and agents. Example: `/schema-migration` loads:
- postgres-optimizer agent (expert guidance)
- planning-with-files skill (structured execution)
- db-check.sh hook (pre-validation)

**Benefits:**
- Automatic expert agent activation
- Pre/post execution validation hooks
- Forked sub-agent contexts for isolation
- Structured planning for complex tasks

## Project Overview

Alexandria exposes a self-hosted OpenLibrary PostgreSQL database (54M+ books) through Cloudflare Workers + Tunnel. Database runs on Unraid at home, accessible globally via Cloudflare's edge.

**Current Status**: Phase 1-5 (Search) COMPLETE! Combined search endpoint live with intelligent query detection. Queue-based architecture operational. Worker live with Hyperdrive + Tunnel database access + R2 cover storage + Cloudflare Queues. ISBNdb Premium (3 req/sec, 1000 ISBN batches). TypeScript with @hono/zod-openapi.

## Architecture

```
Internet → Worker (alexandria.ooheynerds.com)
→ Hyperdrive (pooling) → Service Token Auth → Tunnel → Unraid PostgreSQL (54.8M editions)

Queues:
- Enrichment Queue (10 batch/1 concurrent)
- Cover Queue (5 batch/3 concurrent)
- Backfill Queue (1 batch/1 concurrent)
- Author Queue (10 batch/1 concurrent) [NEW - Jan 2026]

Storage: R2 isbn/{isbn}/{size}.webp
```

**Security**: 3-layer defense (Cloudflare Edge WAF + Worker rate limits + Database encryption). See `docs/security/SECURITY-FINAL-SUMMARY.md`

## Database Schema (CRITICAL)

**YOU MUST use `edition_isbns` table for ISBN lookups** - it's indexed and optimized (49.3M rows).

**Core Tables (Read-Only)**:
- `editions` (54.8M), `works` (40.1M), `authors` (14.7M)
- `edition_isbns` (49.3M) ← **USE THIS FOR ISBN QUERIES**
- `author_works` (42.8M)

**Enriched Tables (Alexandria-specific)**:
- `enriched_works`, `enriched_editions`, `enriched_authors`
- `external_id_mappings` - Multi-provider ID tracking (partitioned by entity_type)
- `provider_conflicts` - Conflict detection and resolution
- `enrichment_log` - Full audit trail of all enrichment operations
- GIN trigram indexes for fuzzy search (`WHERE title % 'search'`)
- Use `similarity()` function for match scores (threshold: 0.3)
- Enrichment tracking: cover availability, provider sources, confidence scores, sync timestamps

## Configuration

**Wrangler**: `worker/wrangler.jsonc` (Workers Paid Plan: 300s CPU, smart placement)

**Bindings**:
- `HYPERDRIVE` - PostgreSQL connection (ID: 00ff424776f4415d95245c3c4c36e854)
- `COVER_IMAGES` - R2 bucket (bookstrack-covers-processed)
- `CACHE`, `QUOTA_KV` - KV namespaces
- `ISBNDB_API_KEY`, `GOOGLE_BOOKS_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `LIBRARYTHING_API_KEY` - API keys
- `ENRICHMENT_QUEUE`, `COVER_QUEUE`, `BACKFILL_QUEUE`, `AUTHOR_QUEUE` - Queues
- `ANALYTICS`, `QUERY_ANALYTICS`, `COVER_ANALYTICS` - Analytics Engine

## Essential Commands

```bash
# Worker
cd worker/
npm run dev      # Local dev (localhost:8787)
npm run deploy   # Deploy to Cloudflare
npm run tail     # Live logs
npm run test     # Vitest tests

# Infrastructure
./scripts/tunnel-status.sh  # Check tunnel (expect 4 connections)
./scripts/db-check.sh        # Verify database
./scripts/deploy-worker.sh   # Deploy with validation

# Database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# Backfill & Data Queries
./scripts/query-gemini-books.sh  # List all Gemini synthetic books (by source, title, author)
```

## Querying Gemini Synthetic Books

**Location**: Gemini-generated books are stored in `enriched_works` table with:
- `synthetic = true`
- `primary_provider = 'gemini-backfill'`
- Metadata stored as **stringified JSON inside JSONB column** (requires double parsing)

**Query Pattern**:
```sql
SELECT
  (metadata#>>'{}')::jsonb->>'gemini_source' as source,
  title,
  (metadata#>>'{}')::jsonb->>'gemini_author' as author
FROM enriched_works
WHERE synthetic = true
  AND primary_provider = 'gemini-backfill'
ORDER BY source, title;
```

**CRITICAL**: Metadata is stored as a JSON string wrapped in JSONB, NOT as a direct JSONB object. Must use `(metadata#>>'{}')::jsonb` to extract the string, then parse it as JSON to access fields.

**Helper Script**: `./scripts/query-gemini-books.sh` - Returns formatted table of all synthetic books

## Synthetic Works Enhancement System

**Purpose**: Automatically enhance synthetic works (created during ISBNdb quota exhaustion) with full metadata when quota refreshes.

**Problem**: When backfill exhausts ISBNdb quota, Gemini creates "synthetic works" (completeness_score=30) without ISBNs. These works have no enrichment from Open APIs (Wikidata, Archive.org) and remain low-quality without intervention.

**Solution**: Daily automated enhancement via cron job at midnight UTC.

### Daily Cron Schedule

**Midnight UTC (`0 0 * * *`)**: Synthetic enhancement
- Enhances up to 500 synthetic works per day
- Resolves ISBNs via ISBNdb title/author search
- Creates enriched_editions records
- Queues for full enrichment (Wikidata, Archive.org, Google Books, covers)
- Upgrades completeness_score from 30 → 80

**2 AM UTC (`0 2 * * *`)**: Cover harvest + Wikidata enrichment (existing)

### Enhancement Flow

**Stage 1: Synthetic Enhancement** (`worker/src/services/synthetic-enhancement.ts`)
1. Query synthetic works: `WHERE synthetic=true AND completeness_score<50 AND last_isbndb_sync IS NULL`
2. Resolve ISBN via ISBNdb title/author search
3. Create minimal enriched_editions record (links ISBN to work)
4. Queue for full enrichment
5. Update work: `completeness_score = 80` (if queue succeeds) or `40` (if queue fails)

**Stage 2: Enrichment Queue** (`worker/src/services/queue-handlers.ts`)
1. Batch fetch metadata from ISBNdb (up to 100 ISBNs per API call)
2. Merge Wikidata genres via SPARQL
3. Update enriched_editions with full metadata
4. Queue cover download

**Stage 3: Cover Queue** (`worker/src/services/queue-handlers.ts`)
1. Download cover from provider URL
2. Process with jSquash (WebP, 3 sizes)
3. Upload to R2
4. Update enriched_editions with Alexandria URLs

### Manual Triggering

**Dry Run** (query candidates without enhancing):
```bash
curl -X POST https://alexandria.ooheynerds.com/api/internal/enhance-synthetic-works \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  --data-raw '{"batch_size":10,"dry_run":true}'
```

**Live Enhancement**:
```bash
curl -X POST https://alexandria.ooheynerds.com/api/internal/enhance-synthetic-works \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  --data-raw '{"batch_size":500,"dry_run":false}'
```

### Quota Management

**Daily Capacity**: ~500 works enhanced per day (~505 ISBNdb API calls)

**Graceful Degradation**: If quota exhausted during enhancement:
1. Stops gracefully, no errors thrown
2. Partially enhanced works marked `completeness_score=40`
3. Next day's cron will retry failed works

**Zero Data Loss**: Gemini API results are ALWAYS persisted as synthetic works, even when ISBNdb quota exhausted. Enhancement happens later when quota available.

### Documentation

- **SYNTHETIC_WORKS_ENRICHMENT_FLOW.md** - Complete 3-stage pipeline explanation
- **QUOTA_EXHAUSTION_HANDLING.md** - Graceful degradation guide with error handling matrix
- **CRON_CONFIGURATION.md** - Cron schedules, monitoring, troubleshooting

### Performance

**Index**: `idx_enriched_works_synthetic_enhancement` (composite partial)
- Query time: 0.262ms (114,503x faster than without index)
- Index size: ~1MB (negligible overhead)

**Success Rate**: 100% (based on production testing with 76 synthetic works)

## Development Workflow

### For Simple Changes (1-3 files, <30 min)
1. Test queries in psql BEFORE implementing in Worker
2. `npm run dev` for local testing
3. Deploy: `npm run deploy`
4. Monitor: `npm run tail`
5. Test live: https://alexandria.ooheynerds.com

### For Complex Tasks (Multi-step, >5 tool calls)
**USE specialized skills** - See `.claude/skills/` directory

Alexandria provides domain-specific skills that auto-load planning-with-files and relevant agents:

**Available Skills:**
- **`/planning-with-files`** - General multi-step task planning (manual invocation)
- **`/schema-migration`** - Database schema changes (postgres-optimizer agent, forked context)
- **`/api-integration`** - Add new external API providers (forked context)
- **`/queue-optimization`** - Optimize Cloudflare Queue performance (cloudflare-workers-optimizer agent)

**Skill Features (Claude Code v2.1.0+):**
- Auto-load relevant agents and sub-skills
- Run in forked sub-agent contexts for isolation
- Pre/post execution hooks for validation
- Structured planning with task files

**When to use skills:**
- **schema-migration**: Adding columns, creating indexes, data migrations
- **api-integration**: Integrating ISBNdb, Google Books, LibraryThing, etc.
- **queue-optimization**: Tuning batch sizes, concurrency, handler performance
- **planning-with-files**: Any multi-step task requiring >5 tool calls

**Skills automatically:**
1. Load appropriate expert agents (postgres-optimizer, cloudflare-workers-optimizer)
2. Create planning files (task_plan.md, findings.md, progress.md)
3. Execute validation hooks (db-check.sh, queue-status)
4. Run in isolated forked contexts (when configured)

**Benefits** (proven in BooksTrack):
- 0% regression rate on complex changes
- 40% faster completion time
- 100% resumability across sessions
- Clear visibility into progress
- Expert guidance from specialized agents

## API Endpoints

**Full docs**: `docs/api/API-SEARCH-ENDPOINTS.md`

**Key endpoints**:
- `GET /health`, `GET /api/stats` - Status
- `GET /api/search/combined` - Combined search with auto-detection (ISBN/author/title) **RECOMMENDED**
- `GET /api/search` - Legacy search (ISBN/title/author)
- `GET /covers/:isbn/:size` - Serve covers
- `POST /api/enrich/batch-direct` - Batch enrichment (up to 1000 ISBNs)
- `POST /api/harvest/backfill` - Historical book backfill (Gemini → Dedup → ISBNdb → Enrich)
- `GET /api/harvest/backfill/status` - Check backfill progress
- `GET /api/harvest/gemini/test` - Test Gemini API connection
- `POST /api/test/ai-comparison` - Compare Gemini vs x.ai Grok for book generation **NEW**
- `POST /api/authors/enrich-bibliography` - Author expansion
- `POST /api/authors/resolve-identifier` - VIAF/ISNI → Wikidata crosswalk
- `GET /api/quota/status` - ISBNdb quota tracking
- `GET /api/external-ids/{entity_type}/{key}` - Get external IDs (Amazon ASIN, Goodreads, Google Books)
- `GET /api/resolve/{provider}/{id}` - Resolve external ID to internal key
- `POST /api/internal/enhance-synthetic-works` - Daily cron to enhance synthetic works **NEW**
- `POST /api/internal/schedule-backfill` - Scheduler for systematic month-by-month backfill **NEW - v2.7.0**
- `GET /api/internal/backfill-stats` - Progress statistics and resolution rates **NEW - v2.7.0**
- `POST /api/internal/seed-backfill-queue` - One-time queue initialization (300 months) **NEW - v2.7.0**
- `GET /openapi.json` - OpenAPI spec

## Performance Optimizations (Jan 2026)

**Recent optimization work** (commits 53e79a0, 49bd624):

### ISBN Resolution Singleton Pattern
- ✅ Module-level singleton orchestrator (eliminates 10-15ms overhead per request)
- ✅ HTTP Keep-Alive connection reuse enabled
- ✅ Providers registered once at module load, reused across all requests
- ✅ Aligns with BookGenerationOrchestrator pattern

**File:** `worker/src/services/isbn-resolution.ts`

### Fuzzy Deduplication Optimization
- ✅ Parallel query execution via `Promise.all` (20x faster)
- ✅ 50 books: ~20 seconds → ~1 second
- ✅ No change to deduplication accuracy (0.6 threshold maintained)

**File:** `worker/src/services/deduplication.ts`

### AI Provider Robustness
- ✅ Markdown code fence sanitization (handles ````json ... ```` wrapping)
- ✅ Prevents JSON parsing failures from occasional Markdown responses
- ✅ Applied to both Gemini and x.ai providers

**Files:** `worker/lib/external-services/providers/{gemini,xai}-provider.ts`

### Code Cleanup
- ✅ Removed legacy `src/services/book-resolution/resolution-orchestrator.ts`
- ✅ Single source of truth: `lib/external-services/orchestrators/`

**Documentation:** `docs/BACKFILL_OPTIMIZATION_REPORT.md`

## ISBN Resolution - Multi-Source Fallback System

**NEW in v2.5.0**: Cascading ISBN fallback when ISBNdb quota exhausted.
**OPTIMIZED in v2.6.0**: Singleton pattern for 10-15ms improvement per request.

**5-Tier Resolution Chain**:
1. **ISBNdb** (primary) - Premium API, 3 req/sec, ~15K calls/day
2. **Google Books** (1st fallback) - Fast, good coverage, free tier
3. **OpenLibrary** (2nd fallback) - Free, reliable, 100 req per 5 min
4. **Archive.org** (3rd fallback) - Excellent for pre-2000 books
5. **Wikidata** (last resort) - Comprehensive, slow SPARQL queries

**How It Works**:
- ISBNdb quota available → Use ISBNdb (fast, accurate)
- ISBNdb quota exhausted → Automatic fallback to free APIs
- Each resolver validates results (70% string similarity threshold)
- All Gemini metadata preserved (zero data loss)

**Performance**:
- ISBNdb: 1-2 seconds per book
- OpenLibrary fallback: 3-6 seconds per book
- 20-book batch: 60-120 seconds (vs instant failure before)

**Implementation**: `worker/src/services/book-resolution/`
- `interfaces.ts` - IBookResolver interface, validation logic
- `resolution-orchestrator.ts` - Cascading fallback manager
- `resolvers/open-library-resolver.ts` - OpenLibrary Search → Validate

## ISBNdb Integration

**Plan**: Premium ($29.95/mo)
- Rate: 3 req/sec
- Batch: 1000 ISBNs per POST
- URL: `api.premium.isbndb.com`
- Quota: ~15,000 calls/day (resets daily, NO rollover)

**IMPORTANT**: API calls counted PER REQUEST, not per result. 1 batch of 1000 ISBNs = 1 call.

**Endpoints**: See `docs/api/ISBNDB-ENDPOINTS.md`
- `POST /books` - Batch lookup (1000 ISBNs)
- `GET /author/{name}` - Bibliography (pagination: `?page=1&pageSize=1000`)
- `GET /books/{query}` - Search

## ISBNdb Quota Management

**System**: Centralized quota tracking via `QUOTA_KV`
- Limit: 13,000/day (15K - 2K buffer)
- Auto-resets at midnight UTC
- Fail-closed on KV errors

**Endpoint**: `GET /api/quota/status`
**Protected endpoints**: All ISBNdb-calling endpoints enforce quota

**Docs**: See quota section in CLAUDE.md for detailed implementation

## Open API Integrations (Issue #159)

**Phase 1-6 COMPLETE** (Jan 2026): Archive.org, Wikipedia, Wikidata, and OpenLibrary integrations for free metadata and covers.

**Services**:
- `worker/services/archive-org.ts` - Pre-2000 book covers, metadata
- `worker/services/wikipedia.ts` - Author biographies with Wikidata ID lookup
- `worker/services/wikidata.ts` - SPARQL queries for books, authors, bibliographies
- `worker/services/open-library.ts` - **NEW** ISBN resolution, search API (v2.5.0)

**ISBN Resolution Priority** (`worker/src/services/book-resolution/`):
1. ISBNdb (paid, quota-limited, highest accuracy)
2. Google Books (fast, good coverage)
3. **OpenLibrary** (free, reliable, 100 req/5min)
4. Archive.org (excellent for pre-2000 books)
5. Wikidata (comprehensive SPARQL, slowest)

**Cover Priority Chain** (`worker/services/cover-fetcher.ts`):
1. Google Books (free, good quality)
2. OpenLibrary (free, reliable)
3. **Archive.org** (free, excellent for pre-2000 books)
4. **Wikidata** (free, Wikimedia Commons images)
5. ISBNdb (paid, highest quality, quota-protected)

**Rate Limiting**: KV-backed, distributed-safe
- Archive.org: 1 req/sec (1000ms delay)
- Wikipedia: 1 req/sec (1000ms delay)
- Wikidata: 2 req/sec (500ms delay)
- **OpenLibrary**: 1 req/3 sec (3000ms delay - 100 req/5min limit)

**Caching**: Long TTL for stability
- Archive.org: 7 days (covers may update)
- Wikipedia: 30 days (biographies rarely change)
- Wikidata: 30 days (metadata stable)
- **OpenLibrary**: 7 days (book metadata may update)

**User-Agent**: Includes project name, contact email, purpose
```
Alexandria/2.5.0 (nerd@ooheynerds.com; Book metadata enrichment and ISBN resolution)
```

**Documentation**:
- **API Guide**: `docs/api/OPEN-API-INTEGRATIONS.md` (comprehensive guide with examples)
- **Rate Limits**: `docs/operations/RATE-LIMITS.md` (central reference for all APIs)
- **ISBN Resolution**: `worker/src/services/book-resolution/` (cascading fallback architecture)

**Key Functions**:
- `fetchArchiveOrgCover(isbn, env, logger)` - Cover URL from Archive.org
- `fetchAuthorBiography(sql, authorKey, env, logger)` - Wikipedia bio with Wikidata lookup
- `fetchBookByISBN(isbn, env, logger)` - Wikidata book metadata via SPARQL
- `fetchAuthorBibliography(authorQid, env, logger)` - Complete author works from Wikidata
- `fetchAuthorMetadata(authorQid, env, logger)` - Comprehensive author profile from Wikidata

**Analytics**: All Open API calls tracked via `trackOpenApiUsage()` for donation calculations

## Service Provider Framework (Jan 2026 - Phases 1-3 Complete)

**Status**: ✅ Production-ready (8 new capabilities + 4 orchestrators added)
**Architecture**: Capability-based provider registry with dynamic service discovery

### Overview

Unified framework for all external service integrations. Eliminates 60% code duplication across 9 providers through centralized HTTP client, dynamic discovery, and orchestrated workflows.

**Expansion (Jan 2026)**: Added 8 new capabilities and 4 orchestrators, expanding Alexandria's metadata enrichment by 75%.
**Latest (Jan 13, 2026)**: LibraryThing thingISBN integration for community-validated edition variants.

**Core Components**:
- **Provider Registry**: Singleton registry for dynamic provider discovery
- **Capability Interfaces**: **14 interfaces** (6 core + 8 new - see below)
- **Unified HTTP Client**: Centralized rate limiting, caching, retry logic
- **7 Orchestrators**: ISBN resolution, cover fetch, metadata enrichment, ratings, public domain, external IDs, edition variants

**Capabilities** (14 total):

*Core Capabilities (v1.0)*:
- ISBN_RESOLUTION - Title/author → ISBN search
- METADATA_ENRICHMENT - ISBN → Book metadata
- COVER_IMAGES - ISBN → Cover URLs
- AUTHOR_BIOGRAPHY - Author → Biography text
- SUBJECT_ENRICHMENT - ISBN → Categories/subjects
- BOOK_GENERATION - AI-generated book metadata

*Phase 1 - Quick Wins (Jan 2026)*:
- RATINGS - ISBN → Ratings data (average/count)
- EDITION_VARIANTS - ISBN → Related ISBNs (hardcover, paperback, etc.)
- PUBLIC_DOMAIN - ISBN → Public domain status with download links
- SUBJECT_BROWSING - Subject → Book list discovery

*Phase 2 - High-Value (Jan 2026)*:
- SERIES_INFO - ISBN → Series name, position, total books
- AWARDS - ISBN → Literary awards and nominations
- TRANSLATIONS - ISBN → Available translations
- ENHANCED_EXTERNAL_IDS - ISBN → Amazon ASIN, Goodreads, Google Books IDs

**Providers** (9 total):
- `ISBNdbProvider` - Ratings, edition variants (paid, quota-managed)
- `GoogleBooksProvider` - Metadata, covers, subjects, public domain, external IDs
- `OpenLibraryProvider` - ISBN resolution, metadata, ratings, external IDs
- `ArchiveOrgProvider` - Covers, metadata, public domain (pre-2000 books)
- `WikidataProvider` - Metadata, covers, ratings, subject browsing, series, awards, translations, external IDs (SPARQL)
- `WikipediaProvider` - Author biographies
- `LibraryThingProvider` - Edition variants via thingISBN (free, community-validated, 1000 req/day)
- `GeminiProvider` - AI book generation for backfill (Google Gemini)
- `XaiProvider` - AI book generation for backfill (x.ai Grok)

**Files**:
- Core: `worker/lib/external-services/` (capabilities, registry, http-client, service-context)
- Providers: `worker/lib/external-services/providers/`
- Orchestrators: `worker/lib/external-services/orchestrators/`
- Tests: `worker/lib/external-services/__tests__/` (116 tests, 100% passing)

**Developer Guide**: `docs/development/SERVICE_PROVIDER_GUIDE.md` (comprehensive guide for adding new providers)

### Quick Usage

```typescript
// Register providers
import { getGlobalRegistry } from './lib/external-services/provider-registry.js';
import { OpenLibraryProvider, GoogleBooksProvider } from './lib/external-services/providers/index.js';

const registry = getGlobalRegistry();
registry.registerAll([
  new OpenLibraryProvider(),
  new GoogleBooksProvider(),
]);

// Use orchestrator for ISBN resolution
import { ISBNResolutionOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new ISBNResolutionOrchestrator(registry);
const result = await orchestrator.resolveISBN('The Hobbit', 'J.R.R. Tolkien', context);
// Automatically tries ISBNdb → Google Books → OpenLibrary until success
```

### Orchestrators

**New (Jan 2026)**:
- **RatingsOrchestrator** - Multi-provider ratings fallback (ISBNdb → OpenLibrary → Wikidata)
- **PublicDomainOrchestrator** - Public domain detection (Google Books → Archive.org)
- **ExternalIdOrchestrator** - External ID aggregation from multiple sources
- **EditionVariantOrchestrator** - Multi-provider edition discovery (ISBNdb → LibraryThing → Wikidata)

**Existing**:
- **ISBNResolutionOrchestrator** - Cascading ISBN fallback (ISBNdb → Google Books → OpenLibrary → Archive.org → Wikidata)
- **CoverOrchestrator** - Cover fetch with free-first priority
- **MetadataOrchestrator** - Metadata enrichment coordination

### Benefits

✅ **60% LOC Reduction**: Eliminated ~400 lines of boilerplate
✅ **Dynamic Discovery**: Adding a new service requires ≤2 file changes
✅ **Quota-Aware**: Registry filters unavailable providers automatically
✅ **Performance**: <10ms initialization, <5ms registry lookups, O(n) deduplication
✅ **Worker-Optimized**: Timeout protection, parallel execution, graceful degradation
✅ **100% Test Coverage**: 116 tests across unit, integration, performance, quota enforcement
✅ **75% Capability Expansion**: From 6 to 14 capabilities in Phases 1-3

### Architecture Decisions

- **Registry Pattern**: Eliminates hard-coded provider chains
- **Capability Interfaces**: Providers implement only what they support
- **Graceful Degradation**: All providers return `null` on errors, never throw
- **Timeout Protection**: 10-15s per provider to prevent Worker CPU exhaustion
- **Free-First Priority**: Cover orchestrator tries free providers before paid (quota preservation)

**Documentation**:
- **Developer Guide**: `docs/development/SERVICE_PROVIDER_GUIDE.md` (v2.0 - comprehensive guide)
- **Planning**: `docs/planning/EXTERNAL_API_ARCHITECTURE_PLAN.md`
- **Research**: `docs/research/PROVIDER-API-CAPABILITIES-2026.md` (full API reference)
- **Task Tracking**: GitHub Issue #180 (Phases 1-3 complete)

### Concurrent AI Book Generation (Jan 2026)

**Status**: ✅ Production

**Architecture**: BookGenerationOrchestrator with concurrent execution mode for backfill operations.

**How It Works**:
1. **Parallel Execution**: Both Gemini and Grok run simultaneously (not sequential)
2. **Timeout Protection**: 60-second timeout per provider with proper cleanup
3. **Deduplication**: Combined results deduplicated by 60% title similarity
4. **Fuzzy Matching**: Shared utility `worker/lib/utils/string-similarity.ts`

**Configuration** (`worker/src/services/hybrid-backfill.ts`):
```typescript
const bookGenOrchestrator = new BookGenerationOrchestrator(getGlobalRegistry(), {
  enableLogging: true,
  providerTimeoutMs: 60000,
  providerPriority: ['gemini', 'xai'], // Not used in concurrent mode
  stopOnFirstSuccess: false, // Use concurrent mode
  concurrentExecution: true, // Run both providers in parallel
  deduplicationThreshold: 0.6, // 60% title similarity (aligned with database)
});
```

**Benefits**:
- **Maximum Diversity**: 0% overlap observed between Gemini and Grok results
- **Speed Optimization**: 29% faster (parallel vs sequential)
- **Resilience**: Succeeds if ANY provider works
- **Cost**: $0.84/year for 2x unique books (minimal premium)

**Deduplication**:
- Uses shared fuzzy matching utilities (`worker/lib/utils/string-similarity.ts`)
- 60% similarity threshold (aligned with database `deduplication.ts`)
- Levenshtein distance with normalized titles (lowercase, no punctuation/articles)
- Single source of truth for fuzzy matching across codebase

**Testing**: `POST /api/test/ai-comparison` - Compare Gemini vs Grok side-by-side

**Documentation**: `docs/development/XAI_COMPARISON_RESULTS.md` - Full comparison analysis

## Queue Architecture

**Config**: `worker/wrangler.jsonc`

**Handlers**: `worker/src/services/queue-handlers.ts`
- `processCoverQueue()` - Downloads, validates, stores covers (max 5/batch)
- `processEnrichmentQueue()` - Enriches metadata (max 100/batch)
- `processBackfillQueue()` - Historical backfill orchestration (1 message/batch)
- `processAuthorQueue()` - JIT author enrichment (max 10/batch) **[NEW - Jan 2026]**

**Routing**: `worker/src/index.ts` - `queue()` handler

**Bindings**:
- `ENRICHMENT_QUEUE` - alexandria-enrichment-queue
- `COVER_QUEUE` - alexandria-cover-queue
- `BACKFILL_QUEUE` - alexandria-backfill-queue
- `AUTHOR_QUEUE` - alexandria-author-queue **[NEW - Jan 2026]**

**Limitation**: Cloudflare max 100 messages/batch. For bulk ops, use `/api/enrich/batch-direct` (1000 ISBNs in one call).

## Backfill Pipeline

**Purpose**: Systematically enrich Alexandria's database with historically significant books using AI-curated lists.

**Flow**: `POST /api/harvest/backfill`
```
1. Gemini API → Generate book metadata (title, author, publisher)
   - Model: gemini-2.5-flash (monthly), gemini-3-flash-preview (annual/large batches)
   - Native structured output with confidence scoring
   - NO ISBNs generated (avoids hallucination)

2. Multi-Source ISBN Resolution → Cascading fallback (NEW in v2.5.0)
   - ISBNdb (if quota available) → Title/author search
   - OpenLibrary (if ISBNdb exhausted) → Free search API
   - [Future] Google Books, Archive.org, Wikidata
   - Each resolver validates results (70% string similarity)
   - Zero data loss: Gemini metadata always preserved as synthetic work

3. 3-Tier Deduplication → Filter existing ISBNs
   - Exact: Check enriched_editions.isbn
   - Related: Check related_isbns jsonb field
   - Fuzzy: Trigram title similarity (threshold: 0.6)

4. Database Updates → enriched_editions table
   - Atomic inserts with conflict resolution
   - Confidence scoring for work matching
   - Full audit trail in enrichment_log
   - Synthetic works (completeness_score=30) created when all resolvers fail

5. Cover Queue → Async cover downloads
   - Priority: low (backfill), medium (user), high (real-time)
```

**Visibility Improvements** (Jan 2026):
- Response includes `already_enriched` count explaining why 0 new enrichments
- Separate API call tracking: `gemini_calls`, `isbndb_calls`, `total_api_calls`
- Logs clearly indicate when all ISBNs were deduplicated (success, not failure)

**Model Selection**:
- Monthly backfill (1-2 months): gemini-2.5-flash (stable, cost-effective)
- Annual backfill (large batches): gemini-3-flash-preview (next-gen, better reasoning)
- Experimental testing: gemini-3-pro-preview (advanced reasoning)

**Idempotency**: Month completion tracked in `QUOTA_KV` - prevents re-running same month

## Backfill Scheduler (Jan 2026)

**NEW in v2.7.0**: Systematic month-by-month backfill orchestration with automated state tracking, retry logic, and progress monitoring.

**Purpose**: Automate systematic enrichment of Alexandria's database with historically significant books from 2000-2024 using AI-driven generation and multi-source ISBN resolution.

**Architecture**:
- **Database Schema**: `backfill_log` table tracks month completion status (pending/processing/completed/failed/retry)
- **Scheduler API**: 3 internal endpoints for orchestration, monitoring, and queue seeding
- **Queue Integration**: Direct BACKFILL_QUEUE messaging (no HTTP self-requests)
- **State Tracking**: Real-time status updates in PostgreSQL + ephemeral job status in KV
- **Retry Logic**: Automatic retry up to 5 attempts with exponential backoff

**Endpoints** (Protected by `X-Cron-Secret` header):
- `POST /api/internal/schedule-backfill` - Queue batch processing (recent-first: 2024 → 2000)
- `GET /api/internal/backfill-stats` - Progress statistics with resolution rates
- `POST /api/internal/seed-backfill-queue` - One-time initialization (300 months: 2000-2024)

**Metrics Tracked** (per month):
- `books_generated`, `isbns_resolved`, `resolution_rate`, `isbns_queued`
- `gemini_calls`, `xai_calls`, `isbndb_calls` - API usage tracking
- `retry_count`, `error_message`, `last_retry_at` - Error handling

**Prompt Variant Selection**:
- 2020+ years: `contemporary-notable` (auto-selected)
- Pre-2020 years: `baseline` (default)

**Production Recommendations**:
- **Target Years**: 2020-2023 (90%+ ISBN resolution rate)
- **Avoid**: 2024 months (ISBNdb lacks data for books published 2-3 months ago)
- **Phase 1 Validation**: 5 months/day from 2020 → Validate 90%+ resolution
- **Phase 2 Scale**: 10-15 months/day for 2021-2023 → Complete recent years
- **Phase 3 Historical**: 15-20 months/day for 2000-2019 → Full coverage

**Performance Expectations**:
- 20 books per month after deduplication
- ~90-95% ISBN resolution rate (for 2020-2023)
- <$0.01 total cost for 24-year backfill (300 Gemini calls)
- ~400 ISBNdb calls per 10 months (~3% daily quota)
- 20-25 days for complete 2000-2023 backfill (288 months)

**Files**:
- Database Migration: `migrations/013_backfill_log_table.sql`
- Scheduler Routes: `worker/src/routes/backfill-scheduler.ts`
- Queue Consumer: `worker/src/services/async-backfill.ts` (updated with state tracking)
- Documentation: `docs/BACKFILL_SCHEDULER_DEPLOYMENT.md`, `docs/operations/BACKFILL_SCHEDULER_GUIDE.md`

**Usage Example**:
```bash
# Schedule 10 months from 2020 (dry run)
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  --data-raw '{"batch_size":10,"year_range":{"start":2020,"end":2020},"dry_run":true}'

# Check progress
curl 'https://alexandria.ooheynerds.com/api/internal/backfill-stats' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET"
```

### AI Provider Improvements (Jan 2026)

**Issue #1: Timeout Mismatch (RESOLVED)**
- **Problem**: ServiceHttpClient default 10s timeout vs orchestrator 60s timeout
- **Solution**: Pass `timeoutMs: 60000` in ServiceContext for AI providers
- **Impact**: Both Gemini and x.ai Grok complete successfully within timeout
- **Files**: `worker/src/services/hybrid-backfill.ts:155`, `worker/src/routes/ai-comparison.ts:116`

**Issue #2: x.ai Grok Refusing Recent Books (RESOLVED)**
- **Problem**: Grok refused books from 2023+ due to "can't verify historical significance"
- **Solution**: Created `contemporary-notable` prompt variant focusing on "recognized AT TIME OF PUBLICATION"
- **Implementation**: `worker/lib/ai/book-generation-prompts.ts` - new `buildContemporaryNotablePrompt()` function
- **Usage**: `{"prompt_variant": "contemporary-notable"}` in backfill requests for recent years (2020+)
- **Result**: 95% ISBN resolution rate with Gemini-generated books

**Issue #3: Cache TTL=0 Warnings (RESOLVED)**
- **Problem**: Cloudflare KV rejecting cache writes with TTL=0 for AI providers
- **Solution**: Skip cache writes when `cacheTtlSeconds === 0` in ServiceHttpClient
- **File**: `worker/lib/external-services/http-client.ts:422-429`

**Prompt Variants** (registered in `worker/lib/ai/book-generation-prompts.ts`):
- `baseline` - Default "historically significant" (works for older years)
- `contemporary-notable` - **RECOMMENDED for 2020+** - "recognized at time of publication"
- `annual` - Year-based generation for large batches
- `diversity-emphasis` - Non-English, indie publishers, underrepresented regions
- `overlooked-significance` - Culturally important but not bestsellers
- `genre-rotation` - Genre-focused (mystery, sci-fi, etc.)
- `era-contextualized` - Books reflecting their era's cultural moment

## Cover Processing

**Storage**: R2 `isbn/{isbn}/{large,medium,small}.webp`

**Endpoints**:
- `POST /api/covers/process` - Process from provider URL
- `GET /covers/:isbn/:size` - Serve image
- `POST /covers/batch` - Batch processing (max 10)

**Whitelist**: books.google.com, covers.openlibrary.org, images.isbndb.com, Amazon CDNs

## External ID Resolution (Issue #155)

**Purpose**: Bidirectional crosswalk between our keys and external provider IDs (Amazon ASIN, Goodreads, Google Books, LibraryThing)

**Architecture**: Hybrid lazy-backfill approach
- `external_id_mappings` table (partitioned by entity_type)
- Lazy population from array columns on first API access
- Enrichment pipeline unchanged (continues writing to arrays)

**Endpoints**:
- `GET /api/external-ids/{entity_type}/{key}` - Forward lookup (our key → external IDs)
  - entity_type: edition, work, author
  - Lazy backfill from arrays on first access (10-15ms one-time)
  - Subsequent queries hit crosswalk (0.75ms)
- `GET /api/resolve/{provider}/{id}?type=edition` - Reverse lookup (external ID → our key)
  - With lazy backfill fallback for consistency
  - Returns key + confidence score

**Confidence Scores**:
- amazon: 90 (ISBNdb validated)
- google-books: 85 (Google validation)
- goodreads: 80 (community validated)
- librarything: 75 (smaller community)

**Performance**:
- Crosswalk query: 0.75ms (P50), 2ms (P95)
- Lazy backfill: 10-15ms (one-time per ISBN)
- Reverse lookup: 1-3ms
- Expected hit rate: 95%+ after 30 days

**Concurrent-Safety**: ON CONFLICT DO NOTHING prevents race conditions

**Analytics**: Tracks source (crosswalk/array_backfill), latency, backfill rate, hit rate

## Code Patterns

### Adding Endpoints (Hono + zod-openapi)

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';

const RequestSchema = z.object({
  isbn: z.string().length(13)
}).openapi('ExampleRequest');

const exampleRoute = createRoute({
  method: 'get',
  path: '/api/example/:isbn',
  tags: ['Example'],
  request: { params: z.object({ isbn: z.string() }) },
  responses: {
    200: {
      description: 'Success',
      content: { 'application/json': { schema: ResponseSchema } }
    }
  }
});

const app = new OpenAPIHono<AppBindings>();

app.openapi(exampleRoute, async (c) => {
  const { isbn } = c.req.valid('param');
  const sql = c.get('sql');  // Request-scoped connection
  const logger = c.get('logger');

  const results = await sql`SELECT * FROM enriched_editions WHERE isbn = ${isbn}`;
  return c.json({ success: true, data: results[0] });
});

export default app;
```

**Key patterns**:
- Use `c.get('sql')` for request-scoped connection (NEVER global)
- Use `c.req.valid('json')` / `c.req.valid('param')` for validated input
- Schemas auto-generate OpenAPI spec

## Critical Constraints

### Database
- **NEVER re-import data** - database is fully populated (250GB)
- **Read-only** - OpenLibrary is source of truth
- **Use edition_isbns table** for ISBN lookups
- **Test in psql first** before Worker implementation

### Security
- **docs/CREDENTIALS.md** - Passwords (gitignored - NEVER commit!)
- **No destructive git commands** without user approval
- **Input validation** - Zod schemas on all endpoints
- **Rate limiting** - Multi-tier limits enforced

### SSH & Auto-Start
- Passwordless: `ssh root@Tower.local`
- Auto-start: postgres + tunnel (`--restart unless-stopped`)

## File Structure

```
alexandria/
├── worker/
│   ├── src/
│   │   ├── index.ts              # Main worker + routes
│   │   ├── env.ts                # Type definitions
│   │   ├── routes/               # API handlers (zod-openapi)
│   │   ├── schemas/              # Zod validation schemas
│   │   └── services/             # Business logic
│   ├── services/                 # External APIs
│   ├── lib/                      # Utilities
│   ├── middleware/               # Error handling, etc.
│   └── wrangler.jsonc            # Config
├── scripts/                      # Automation scripts
├── docs/                         # Documentation
│   ├── INDEX.md                  # Docs navigation
│   ├── CURRENT-STATUS.md         # Active issues
│   ├── api/                      # API docs
│   ├── security/                 # Security docs
│   ├── operations/               # Operations guides
│   └── archive/                  # Outdated docs
├── CLAUDE.md                     # This file
├── TODO.md                       # Roadmap
└── README.md                     # Overview
```

## Troubleshooting

```bash
# Worker
npx wrangler whoami
npx wrangler login

# Tunnel (expect 4 connections)
./scripts/tunnel-status.sh
ssh root@Tower.local "docker restart alexandria-tunnel"

# Database
ssh root@Tower.local "docker ps | grep postgres"
./scripts/db-check.sh

# Queues
npx wrangler queues list | grep alexandria
npx wrangler tail alexandria --format pretty | grep Queue
```

## Additional Resources

- **Documentation Index**: `docs/INDEX.md`
- **Active Issues**: `docs/CURRENT-STATUS.md`
- **API Docs**: `docs/api/`
- **Security**: `docs/security/`
- **Cross-repo**: `~/dev_repos/bendv3/docs/SYSTEM_ARCHITECTURE.md`
