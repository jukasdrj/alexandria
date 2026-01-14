# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Role

**Identity:** Alex (Data Lake) - Librarian & Archivist
**Scope:** Book metadata integrity, ingestion, enrichment, and serving
**Upstream:** Provides data to bendv3 (API gateway)

## Task Orchestration Philosophy

**As Alexandria's PROJECT MANAGER and task orchestrator, I (Claude) MUST:**

1. **NEVER implement directly** - Always delegate complex work to specialized agents
2. **ENFORCE planning-with-files** - ALL multi-step tasks (>5 tool calls) require planning files
3. **Execute in parallel** - When tasks are independent, run agents concurrently for 40% speed gains
4. **VALIDATE EVERYTHING** - No subagent output enters repo without PAL MCP validation
5. **DOCUMENT DECISIONS** - All findings recorded in findings.md for 100% resumability

**I am NOT a solo implementer. I am a PM who delegates, validates, and orchestrates.**

**Project Context:** Alexandria is a **family fun project** for a solo developer. Keep solutions pragmatic, maintainable, and avoid over-engineering.

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

**Daily Cron**: Midnight UTC enhances up to 500 synthetic works per day:
- Resolves ISBNs via ISBNdb title/author search
- Queues for full enrichment (Wikidata, Archive.org, Google Books, covers)
- Upgrades completeness_score from 30 → 80

**Manual Trigger**:
```bash
curl -X POST https://alexandria.ooheynerds.com/api/internal/enhance-synthetic-works \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  --data-raw '{"batch_size":500,"dry_run":false}'
```

**Documentation**: See `docs/features/SYNTHETIC_WORKS_ENRICHMENT_FLOW.md` for complete 3-stage pipeline, quota management, and cron configuration.

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

**Recent improvements** (commits 53e79a0, 49bd624):

**ISBN Resolution Singleton**: Module-level singleton orchestrator eliminates 10-15ms overhead per request (`worker/src/services/isbn-resolution.ts`)

**Fuzzy Deduplication**: Parallel query execution via `Promise.all` - 50 books from ~20 seconds → ~1 second (20x faster, `worker/src/services/deduplication.ts`)

**AI Provider Robustness**: Markdown code fence sanitization prevents JSON parsing failures (`worker/lib/external-services/providers/{gemini,xai}-provider.ts`)

**Documentation**: See `docs/operations/PERFORMANCE_OPTIMIZATIONS.md` for detailed metrics, monitoring queries, and future optimization candidates.

## ISBN Resolution - Multi-Source Fallback

**5-Tier Cascading Fallback** (v2.5.0):
1. ISBNdb (primary) - Premium API, quota-limited
2. Google Books (1st fallback) - Fast, free
3. OpenLibrary (2nd fallback) - Reliable, 100 req/5min
4. Archive.org (3rd fallback) - Excellent for pre-2000 books
5. Wikidata (last resort) - Comprehensive, slow SPARQL

**How It Works**: Automatic fallback when ISBNdb quota exhausted. Each resolver validates results (70% similarity). Zero data loss (Gemini metadata always preserved as synthetic work).

**Implementation**: `worker/src/services/book-resolution/` (interfaces, orchestrator, resolvers)

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

## Open API Integrations

**Phase 1-6 COMPLETE** (Jan 2026): Archive.org, Wikipedia, Wikidata, and OpenLibrary integrations for free metadata and covers.

**Integrated Providers**:
- Archive.org - Pre-2000 book covers, metadata
- Wikipedia - Author biographies with Wikidata ID lookup
- Wikidata - SPARQL queries for books, authors, bibliographies
- OpenLibrary - ISBN resolution, search API

**User-Agent**: `Alexandria/2.5.0 (nerd@ooheynerds.com; Book metadata enrichment and ISBN resolution)`

**Documentation**: See `docs/api/OPEN-API-INTEGRATIONS.md` for comprehensive guide with rate limits, caching strategies, priority chains, and API examples.

## Service Provider Framework

**Status**: ✅ Production-ready - Unified framework for all external service integrations

**Architecture**: Capability-based provider registry with dynamic service discovery. Eliminates 60% code duplication across 9 providers through centralized HTTP client and orchestrated workflows.

**14 Capabilities**: ISBN resolution, metadata enrichment, cover images, ratings, edition variants, public domain, series info, awards, translations, external IDs, author biographies, subject enrichment/browsing, book generation.

**9 Providers**: ISBNdb, Google Books, OpenLibrary, Archive.org, Wikidata, Wikipedia, LibraryThing, Gemini, x.ai Grok

**7 Orchestrators**: Cascading fallback chains for ISBN resolution, cover fetch, metadata enrichment, ratings, public domain, external IDs, edition variants

**Key Features**:
- Registry pattern for dynamic provider discovery
- Quota-aware filtering (automatically skips exhausted providers)
- Timeout protection (10-15s per provider)
- Free-first priority (covers use free APIs before paid)
- 116 tests (unit, integration, performance, quota enforcement)

**Concurrent AI Generation**: Gemini + Grok run in parallel (29% faster, 0% overlap, 60% deduplication threshold)

**Files**: `worker/lib/external-services/` (providers, orchestrators, registry, http-client)

**Documentation**: See `docs/development/SERVICE_PROVIDER_GUIDE.md` for comprehensive guide on adding new providers, capability interfaces, and orchestrator patterns.

## Analytics & Monitoring (v2.8.0)

**NEW in v2.8.0**: Comprehensive provider analytics via Cloudflare Analytics Engine

**Events Tracked**: Provider request (latency, success, cache hits, errors), orchestrator fallback (chains, attempts, reasons), provider cost (usage, estimates)

**Implementation**: ServiceHttpClient automatically tracks all provider requests (centralized, non-blocking via `ctx.waitUntil()`). No manual tracking needed for new providers.

**Documentation**: See `docs/operations/PROVIDER-ANALYTICS.md` for health check queries, troubleshooting decision trees, alert templates, and cost management strategies.

## Queue Architecture

**4 Queues** (configured in `worker/wrangler.jsonc`):
- **ENRICHMENT_QUEUE** - Metadata enrichment (max 100/batch, 10 batch, 1 concurrent)
- **COVER_QUEUE** - Cover downloads (max 5/batch, 5 batch, 3 concurrent)
- **BACKFILL_QUEUE** - Historical backfill orchestration (1 message/batch, 1 batch, 1 concurrent)
- **AUTHOR_QUEUE** - JIT author enrichment (max 10/batch, 10 batch, 1 concurrent) [NEW - Jan 2026]

**Handlers**: `worker/src/services/queue-handlers.ts` - `processCoverQueue()`, `processEnrichmentQueue()`, `processBackfillQueue()`, `processAuthorQueue()`

**Routing**: `worker/src/index.ts` - `queue()` handler

**Limitation**: Cloudflare max 100 messages/batch. For bulk ops (1000 ISBNs), use `/api/enrich/batch-direct`.

**Documentation**: See `docs/QUEUE-ENRICHMENT-SYSTEM.md` for complete queue architecture, retry logic, and monitoring.

## Backfill System

**Purpose**: Systematically enrich Alexandria's database with historically significant books using AI-curated lists.

**Pipeline** (`POST /api/harvest/backfill`):
1. Gemini API → Generate book metadata (no ISBNs to avoid hallucination)
2. Multi-Source ISBN Resolution → Cascading fallback (ISBNdb → OpenLibrary → others)
3. 3-Tier Deduplication → Filter existing ISBNs (exact, related, fuzzy)
4. Database Updates → Atomic inserts with conflict resolution
5. Cover Queue → Async cover downloads

**Scheduler** (v2.7.0): Systematic month-by-month backfill (2000-2024)
- **Database**: `backfill_log` table tracks completion status
- **Endpoints**: `POST /api/internal/schedule-backfill`, `GET /api/internal/backfill-stats`
- **Production**: Target 2020-2023 (90%+ ISBN resolution), 10-15 months/day

**Usage**:
```bash
# Schedule batch (dry run)
curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
  -H "X-Cron-Secret: $ALEXANDRIA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  --data-raw '{"batch_size":10,"year_range":{"start":2020,"end":2020},"dry_run":true}'
```

**Documentation**: See `docs/BACKFILL_SCHEDULER_DEPLOYMENT.md` for complete pipeline, scheduler configuration, prompt variants, and operational guide.

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
