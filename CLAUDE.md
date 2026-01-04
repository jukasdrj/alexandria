# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Role

**Identity:** Alex (Data Lake) - Librarian & Archivist
**Scope:** Book metadata integrity, ingestion, enrichment, and serving
**Upstream:** Provides data to bendv3 (API gateway)

## Project Overview

Alexandria exposes a self-hosted OpenLibrary PostgreSQL database (54M+ books) through Cloudflare Workers + Tunnel. Database runs on Unraid at home, accessible globally via Cloudflare's edge.

**Current Status**: Phase 1-2 COMPLETE! Queue-based architecture operational. Worker live with Hyperdrive + Tunnel database access + R2 cover storage + Cloudflare Queues. ISBNdb Premium (3 req/sec, 1000 ISBN batches). TypeScript with @hono/zod-openapi.

## Architecture

```
Internet → Worker (alexandria.ooheynerds.com)
→ Hyperdrive (pooling) → Service Token Auth → Tunnel → Unraid PostgreSQL (54.8M editions)

Queues: Cover Queue (10 batch/5 concurrent) + Enrichment Queue (100 batch/1 concurrent)
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
- GIN trigram indexes for fuzzy search (`WHERE title % 'search'`)
- Use `similarity()` function for match scores (threshold: 0.3)

## Configuration

**Wrangler**: `worker/wrangler.jsonc` (Workers Paid Plan: 300s CPU, smart placement)

**Bindings**:
- `HYPERDRIVE` - PostgreSQL connection (ID: 00ff424776f4415d95245c3c4c36e854)
- `COVER_IMAGES` - R2 bucket (bookstrack-covers-processed)
- `CACHE`, `QUOTA_KV` - KV namespaces
- `ISBNDB_API_KEY`, `GOOGLE_BOOKS_API_KEY` - API keys
- `ENRICHMENT_QUEUE`, `COVER_QUEUE` - Queues
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
```

## Development Workflow

1. Test queries in psql BEFORE implementing in Worker
2. `npm run dev` for local testing
3. Deploy: `npm run deploy`
4. Monitor: `npm run tail`
5. Test live: https://alexandria.ooheynerds.com

## API Endpoints

**Full docs**: `docs/api/API-SEARCH-ENDPOINTS.md`

**Key endpoints**:
- `GET /health`, `GET /api/stats` - Status
- `GET /api/search` - Unified search (ISBN/title/author)
- `GET /covers/:isbn/:size` - Serve covers
- `POST /api/enrich/batch-direct` - Batch enrichment (up to 1000 ISBNs)
- `POST /api/authors/enrich-bibliography` - Author expansion
- `POST /api/authors/resolve-identifier` - VIAF/ISNI → Wikidata crosswalk (NEW!)
- `GET /api/quota/status` - ISBNdb quota tracking
- `GET /openapi.json` - OpenAPI spec

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

## Queue Architecture

**Config**: `worker/wrangler.jsonc`

**Handlers**: `worker/src/services/queue-handlers.ts`
- `processCoverQueue()` - Downloads, validates, stores covers (max 10/batch)
- `processEnrichmentQueue()` - Enriches metadata (max 100/batch)

**Routing**: `worker/src/index.ts` - `queue()` handler

**Limitation**: Cloudflare max 100 messages/batch. For bulk ops, use `/api/enrich/batch-direct` (1000 ISBNs in one call).

## Cover Processing

**Storage**: R2 `isbn/{isbn}/{large,medium,small}.webp`

**Endpoints**:
- `POST /api/covers/process` - Process from provider URL
- `GET /covers/:isbn/:size` - Serve image
- `POST /covers/batch` - Batch processing (max 10)

**Whitelist**: books.google.com, covers.openlibrary.org, images.isbndb.com, Amazon CDNs

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
