# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexandria exposes a self-hosted OpenLibrary PostgreSQL database (54M+ books) through Cloudflare Workers + Tunnel. Database runs on Unraid at home, accessible globally via Cloudflare's edge.

**Current Status**: Phase 1 + 2 COMPLETE! Queue-based architecture operational with cover processing and metadata enrichment. Worker live with Hyperdrive + Tunnel database access + R2 cover image storage + Cloudflare Queues. **Dec 10, 2025**: Upgraded to ISBNdb Premium (3x rate, 10x batch size), added direct batch endpoint for 10x efficiency.

## Architecture Flow

```
Internet → Cloudflare Access (IP bypass: 47.187.18.143/32)
→ Worker (alexandria.ooheynerds.com, Hono framework)
→ Hyperdrive (connection pooling, ID: 00ff424776f4415d95245c3c4c36e854)
→ Cloudflare Access (Service Token auth to tunnel)
→ Tunnel (alexandria-db.ooheynerds.com)
→ Unraid (192.168.1.240:5432, SSL enabled)
→ PostgreSQL (54.8M editions)

Queue-Based Processing (NEW - Dec 3, 2025):
→ bendv3 produces → Cloudflare Queues → Alexandria consumes
→ Cover Queue: Async cover downloads (2 producers, 1 consumer)
→ Enrichment Queue: Async metadata enrichment (2 producers, 1 consumer)
→ Both queues: max_retries=3, dead letter queues, analytics tracking

Cover Images:
→ Worker receives provider URL (OpenLibrary, ISBNdb, Google Books)
→ Fast-fail immediate processing (1 retry) OR queue for background
→ Downloads, validates, stores in R2 (bookstrack-covers-processed bucket)
→ Serves via /api/covers/:work_key/:size or /covers/:isbn/:size
```

**IMPORTANT**:
- Tunnel is outbound-only from home network. No inbound firewall ports needed.
- API secured with Cloudflare Access - only accessible from home IP (47.187.18.143/32)
- Tunnel uses **Zero Trust remotely-managed configuration** (token-based, not config.yml)
- Public hostname configured in Zero Trust dashboard: `alexandria-db.ooheynerds.com` → `tcp://localhost:5432`

## Database Schema (CRITICAL)

**YOU MUST use `edition_isbns` table for ISBN lookups** - it's indexed and optimized.

**Core OpenLibrary Tables (Read-Only)**:
- **authors** (14.7M): `key`, `type`, `revision`, `data` (JSONB: name, bio)
- **works** (40.1M): `key`, `type`, `revision`, `data` (JSONB: title, description)
- **editions** (54.8M): `key`, `type`, `revision`, `work_key`, `data` (JSONB: title, ISBN)
- **edition_isbns** (49.3M): `edition_key`, `isbn` ← **USE THIS FOR ISBN QUERIES**
- **author_works** (42.8M): `author_key`, `work_key` (relationships)

**Enriched Tables (Alexandria-specific, optimized for search)**:
- **enriched_works** (~28.6M estimated): Normalized work metadata, GIN trigram indexes on title for fuzzy search
- **enriched_editions**: Normalized edition metadata, GIN indexes on related_isbns array, analyzed statistics
- **enriched_authors**: Normalized author metadata, GIN trigram indexes on name for fuzzy search
- These tables are populated via Smart Resolution enrichment pipeline (ISBNdb → Google Books → OpenLibrary)
- Use enriched tables for better search performance vs JSONB queries on core tables

**Fuzzy Text Search (pg_trgm)**:
- PostgreSQL extension `pg_trgm` installed and enabled (v1.6)
- GIN trigram indexes on all title and author columns for fuzzy matching
- Use `%` operator for similarity matching: `WHERE title % 'search term'`
- Use `similarity()` function to get match scores: `similarity(title, 'search term')`
- Default similarity threshold: 0.3 (30% similarity)
- Supports typo-tolerant searches (e.g., "hary poter" finds "Harry Potter")
- All search endpoints use pg_trgm for improved search quality

## Configuration

**Wrangler Configuration**: `worker/wrangler.jsonc` (JSON format, recommended by Cloudflare)
- Schema validation with `$schema` for IDE autocomplete
- Optimized for **Cloudflare Workers Paid Plan**:
  - Extended CPU limits: 300s (5 minutes)
  - Smart placement for optimal routing
  - Full observability with 100% sampling
  - Queue-based background processing
  - Multiple Analytics Engine datasets

**API vs Wrangler**: See `docs/CLOUDFLARE-API-VS-WRANGLER.md` for comprehensive comparison of what can be managed via Cloudflare API vs Wrangler CLI (tunnels, Access, workers, queues, AI Gateway, etc.)

## Essential Commands

### Worker Development
```bash
cd worker/
npm run dev      # Local dev server (localhost:8787)
npm run deploy   # Deploy to Cloudflare
npm run tail     # Live Worker logs
```

### Infrastructure Checks
```bash
./scripts/tunnel-status.sh  # Check tunnel (expect 4 connections)
./scripts/db-check.sh        # Verify database + sample query
./scripts/deploy-worker.sh   # Deploy with validation
```

### Database Access
```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# Connection for Worker:
# Host: alexandria-db.ooheynerds.com (via tunnel)
# Port: 5432 | DB: openlibrary | User: openlibrary
# Password: in docs/CREDENTIALS.md (gitignored)
```

## Development Workflow

### Git Conventions
- **Branch naming**: `feature/description`, `fix/description`, `docs/description`
- **Merge strategy**: Squash and merge for features, rebase for hotfixes
- **NEVER commit**: docs/CREDENTIALS.md (gitignored), .env files, secrets

### Before Starting Work
1. Run `./scripts/tunnel-status.sh` and `./scripts/db-check.sh` to verify infrastructure
2. **IMPORTANT**: Always test queries in psql before implementing in Worker
3. Use `npm run dev` for local testing before deploying

### Testing Workflow
1. Test locally: `npm run dev`
2. Verify infrastructure with scripts
3. Deploy: `npm run deploy`
4. Check logs: `npm run tail`
5. Test live: https://alexandria.ooheynerds.com

## Alexandria Search API (COMPLETE ✅)

**Full Documentation**: `docs/API-SEARCH-ENDPOINTS.md`

### Main Search Endpoint: GET /api/search

**Supports 3 search modes**:
1. **ISBN** - Exact match with Smart Resolution (auto-enrichment if not found)
2. **Title** - Case-insensitive partial match (ILIKE)
3. **Author** - Case-insensitive partial match with joins

**Query Parameters**:
- `isbn` - ISBN-10 or ISBN-13 (normalized automatically)
- `title` - Book title (partial match)
- `author` - Author name (partial match)
- `limit` - Results per page (default: 20, max: 100)
- `offset` - Pagination offset (default: 0)

**Smart Resolution**: When ISBN not found in OpenLibrary, automatically queries ISBNdb → Google Books → OpenLibrary, enriches database, and returns result.

**Performance**:
- ISBN: ~10-50ms (indexed)
- Title: ~50-200ms (ILIKE scan)
- Author: ~100-300ms (multi-table join)

**Example Queries**:
```bash
# ISBN search
curl 'https://alexandria.ooheynerds.com/api/search?isbn=9780439064873'

# Title search with pagination
curl 'https://alexandria.ooheynerds.com/api/search?title=harry%20potter&limit=10'

# Author search
curl 'https://alexandria.ooheynerds.com/api/search?author=rowling&limit=20&offset=40'
```

### Other Endpoints (All Verified Working ✅)
- **GET /health** - Health check with DB latency
- **GET /api/stats** - Database statistics (54.8M editions, 49.3M ISBNs, 40.1M works, 14.7M authors)
- **GET /covers/:isbn/:size** - Cover images (large/medium/small)
- **POST /api/covers/process** - Work-based cover processing
- **POST /covers/:isbn/process** - ISBN-based cover processing
- **POST /covers/batch** - Batch cover processing (max 10)
- **GET /covers/:isbn/status** - Cover availability check
- **POST /api/enrich/edition** - Store edition metadata
- **POST /api/enrich/work** - Store work metadata
- **POST /api/enrich/author** - Store author biographical data
- **POST /api/enrich/queue** - Queue background enrichment (max 100 per batch)
- **POST /api/enrich/batch-direct** - Direct batch enrichment (up to 1000 ISBNs, bypasses queue) ⭐ NEW
- **GET /api/enrich/status/:id** - Check enrichment status
- **POST /api/authors/bibliography** - Get author's complete bibliography from ISBNdb

## ISBNdb API Integration (COMPLETE ✅)

### Plan: Premium (Paid) - Upgraded Dec 10, 2025
- **Rate Limit**: 3 requests/second (3x faster than Basic)
- **Batch Endpoint**: Up to 1000 ISBNs per POST request (10x larger than Basic)
- **Base URL**: `api.premium.isbndb.com` (NOT `api2.isbndb.com`)

### Available Endpoints (All Verified Working ✅)
1. **GET /book/{isbn}** - Single book lookup (includes pricing)
2. **POST /books** - Batch lookup (up to 1000 ISBNs) ⭐ **Most Efficient**
3. **GET /books/{query}** - Search with pagination
4. **GET /author/{name}** - Author bibliography with pagination
5. **GET /authors/{query}** - Author search
6. **GET /publisher/{name}** - Publisher catalog
7. **GET /publishers/{query}** - Publisher search
8. **GET /subject/{name}** - Books by subject
9. **GET /subjects/{query}** - Subject search

### ISBNdb Pagination (IMPORTANT)
The `/author/{name}` endpoint **does NOT return a `total` field**. Pagination must check if the response contains a full page (100 books) to determine if more pages exist:
```javascript
// ISBNdb pagination: if we got a full page, there might be more
const booksInResponse = data.books?.length || 0;
hasMore = booksInResponse === pageSize; // pageSize = 100
```

### Enrichment Opportunities
ISBNdb provides rich metadata beyond current usage:
- **`image_original`** - High-quality covers (better than `image`)
- **`subjects`** - Genre/topic tags for recommendations
- **`dimensions_structured`** - Physical book dimensions (H×W×L, weight)
- **`binding`** - Format (Hardcover, Paperback, etc.)
- **`related`** - Related ISBNs (ePub, audiobook, etc.)
- **`dewey_decimal`** - Library classification
- **`msrp`** - Pricing (single lookups only)

**See**: `docs/ISBNDB-ENRICHMENT.md` for implementation guide

### Best Practices
1. **Use batch endpoint** for multiple ISBNs (1000x faster than sequential)
2. **Use Premium endpoint** (`api.premium.isbndb.com`) for 3x rate limit
3. **Extract `image_original`** for best cover quality
4. **Rate limit**: 3 req/sec (Premium), use 350ms delay between requests
5. **Chunk large lists**: 1000 ISBNs per batch (Premium limit)

### Test Endpoints
```bash
# Test all endpoints
curl "https://alexandria.ooheynerds.com/api/test/isbndb" | jq

# Test batch (most important)
curl "https://alexandria.ooheynerds.com/api/test/isbndb/batch" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"isbns":["9780439064873","9781492666868"]}'
```

**Documentation**: `docs/ISBNDB-ENDPOINTS.md`

---

## Phase 2: Database Integration (COMPLETE ✅)

### Hyperdrive Setup (Production)
Hyperdrive provides connection pooling, query caching, and secure tunnel access.

**Prerequisites**:
1. PostgreSQL must have SSL enabled (self-signed cert is fine)
2. Cloudflare Access Service Token created
3. Cloudflare Access Application configured for tunnel hostname

**Setup Steps**:
```bash
# 1. Enable SSL on PostgreSQL (if not already enabled)
ssh root@Tower.local "docker exec postgres bash -c 'cd /var/lib/postgresql/18/docker && openssl req -new -x509 -days 3650 -nodes -text -out server.crt -keyout server.key -subj \"/CN=postgres\" && chmod 600 server.key && chown postgres:postgres server.key server.crt'"
ssh root@Tower.local "docker exec postgres bash -c 'echo \"ssl = on\" >> /var/lib/postgresql/18/docker/postgresql.conf'"
ssh root@Tower.local "docker restart postgres"

# 2. Create Hyperdrive config (requires Access Client ID/Secret from dashboard)
npx wrangler hyperdrive create alexandria-db \
  --host=alexandria-db.ooheynerds.com \
  --user=openlibrary \
  --password=<from CREDENTIALS.md> \
  --database=openlibrary \
  --access-client-id=<from Cloudflare Access> \
  --access-client-secret=<from Cloudflare Access> \
  --caching-disabled
```

**wrangler.jsonc configuration**:
```jsonc
{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "00ff424776f4415d95245c3c4c36e854",
      "localConnectionString": "postgres://openlibrary:tommyboy@alexandria-db.ooheynerds.com:5432/openlibrary?sslmode=require"
    }
  ]
}
```

**Worker code** (using Hono + Hyperdrive):
```javascript
import { Hono } from 'hono';
import postgres from 'postgres';

const app = new Hono();

// Database middleware - creates request-scoped connection
app.use('*', async (c, next) => {
  const sql = postgres(c.env.HYPERDRIVE.connectionString, {
    max: 1,  // Single connection per request, Hyperdrive handles pooling
    fetch_types: false,
    prepare: false
  });
  c.set('sql', sql);
  await next();
});

// Route example
app.get('/health', async (c) => {
  const sql = c.get('sql');
  await sql`SELECT 1`;
  return c.json({ status: 'ok' });
});

export default app;
```

**CRITICAL I/O Context Fix**: Connection must be request-scoped (`c.get('sql')`) not global. Global connections cause "Cannot perform I/O on behalf of a different request" errors.

## Queue Architecture (COMPLETE ✅ - Dec 3, 2025)

### Overview
Alexandria implements a queue-based architecture for async processing of cover downloads and metadata enrichment. This enables non-blocking operations and better resource utilization.

### Queue Configuration

**File**: `worker/wrangler.jsonc`

```jsonc
"queues": {
  "producers": [
    { "binding": "ENRICHMENT_QUEUE", "queue": "alexandria-enrichment-queue" },
    { "binding": "COVER_QUEUE", "queue": "alexandria-cover-queue" }
  ],
  "consumers": [
    {
      "queue": "alexandria-enrichment-queue",
      "max_batch_size": 10,
      "max_batch_timeout": 30,
      "max_retries": 3,
      "dead_letter_queue": "alexandria-enrichment-dlq",
      "max_concurrency": 5
    },
    {
      "queue": "alexandria-cover-queue",
      "max_batch_size": 20,
      "max_batch_timeout": 10,
      "max_retries": 3,
      "dead_letter_queue": "alexandria-cover-dlq",
      "max_concurrency": 10
    }
  ]
}
```

### Queue Handlers

**File**: `worker/queue-handlers.js`

Contains two queue processors:
- **`processCoverQueue(batch, env)`**: Processes cover download requests
  - Downloads images from provider URLs
  - Validates and stores in R2
  - Tracks analytics (source, latency, size)
  - Auto-retries on failure (up to 3 times)

- **`processEnrichmentQueue(batch, env)`**: Processes metadata enrichment requests
  - Uses `smartResolveISBN()` for ISBNdb → Google Books → OpenLibrary chain
  - Stores enriched data in PostgreSQL via Hyperdrive
  - Tracks analytics (provider, cost estimates)
  - Auto-retries on failure (up to 3 times)

### Queue Routing

**File**: `worker/index.ts`

```typescript
async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
  switch (batch.queue) {
    case 'alexandria-cover-queue':
      return await processCoverQueue(batch, env);
    case 'alexandria-enrichment-queue':
      return await processEnrichmentQueue(batch, env);
    default:
      console.error(`Unknown queue: ${batch.queue}`);
      batch.messages.forEach(msg => msg.ack());
  }
}
```

### Integration with bendv3

bendv3 acts as a **producer** for both queues:

**Cover Queue** (`bendv3/src/services/alexandria-cover-service.ts`):
```typescript
// Fast-fail immediate processing, queue on failure
const result = await processBookCover(request, env, 1) // 1 retry max
if (!result.success) {
  await queueCoverProcessing(request, env, 'normal') // Queue for background
}
```

**Enrichment Queue** (`bendv3/src/services/enrichment-queue.ts`):
```typescript
// Queue single ISBN
await queueEnrichment({ isbn, priority: 'high', source: 'user_add' }, env)

// Queue batch
await queueEnrichmentBatch(isbns, { priority: 'low', source: 'import' }, env)
```

### Queue Statistics

| Queue | Producers | Consumers | Purpose |
|-------|-----------|-----------|---------|
| **alexandria-cover-queue** | Alexandria, bendv3 | Alexandria | Async cover downloads |
| **alexandria-enrichment-queue** | Alexandria, bendv3 | Alexandria | Async metadata enrichment |

### Queue Batch Size Limitation (IMPORTANT - Dec 10, 2025)

**Cloudflare Queues has a hard limit of 100 messages per batch** (`max_batch_size` cannot exceed 100). This creates an efficiency gap with ISBNdb Premium which supports 1000 ISBNs per batch call.

**Solution: Direct Batch Endpoint**

For bulk operations, use `/api/enrich/batch-direct` which bypasses queues entirely:
```bash
# Enrich up to 1000 ISBNs in a single API call (10x more efficient!)
curl -X POST 'https://alexandria.ooheynerds.com/api/enrich/batch-direct' \
  -H 'Content-Type: application/json' \
  -d '{"isbns": ["9780439064873", "9781234567890", ...], "source": "bulk_import"}'
```

**When to use each approach:**
- **Queue** (`/api/enrich/queue`): Real-time trickle of ISBNs (user actions, imports < 100)
- **Direct** (`/api/enrich/batch-direct`): Bulk operations (author bibliographies, large imports)

**Future Enhancement (GitHub Issue #82)**: Durable Objects as a batching buffer to aggregate queue messages into optimal ISBNdb batch sizes.

### Monitoring

Check queue status:
```bash
npx wrangler queues list | grep alexandria
```

Monitor queue processing:
```bash
npx wrangler tail alexandria --format pretty | grep Queue
```

Expected logs:
```
[CoverQueue] Processing 5 cover requests
[CoverQueue] Batch complete: processed=4, cached=1, failed=0
[EnrichQueue] Processing 10 enrichment requests
[EnrichQueue] Batch complete: enriched=8, cached=2, failed=0
```

### Dead Letter Queues

Failed messages (after 3 retries) move to:
- **alexandria-cover-dlq**: Failed cover downloads
- **alexandria-enrichment-dlq**: Failed enrichment requests

Use DLQs for debugging and manual reprocessing.

## Cover Image Processing (COMPLETE ✅)

### R2 Storage
- **Bucket**: `bookstrack-covers-processed`
- **Binding**: `COVER_IMAGES`
- **Structure**: `covers/{work_key}/{hash}/original` or `isbn/{isbn}/original.{ext}`

### Endpoints

**Work-based (new)**:
- `POST /api/covers/process` - Process cover from provider URL
- `GET /api/covers/:work_key/:size` - Serve cover (large/medium/small)

**ISBN-based (legacy)**:
- `POST /covers/:isbn/process` - Trigger cover processing from providers
- `GET /covers/:isbn/:size` - Serve cover image
- `GET /covers/:isbn/status` - Check if cover exists
- `POST /covers/batch` - Process multiple ISBNs (max 10)

### Domain Whitelist (Security)
Only these domains are allowed for cover downloads:
- `books.google.com`
- `covers.openlibrary.org`
- `images.isbndb.com`
- `images-na.ssl-images-amazon.com`
- `m.media-amazon.com`

### Processing Pipeline
```javascript
// Work-based: POST /api/covers/process
const response = await fetch('https://alexandria.ooheynerds.com/api/covers/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    work_key: '/works/OL45804W',
    provider_url: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
    isbn: '9780439064873'  // optional, for logging
  })
});

// ISBN-based: POST /covers/:isbn/process
const response = await fetch('https://alexandria.ooheynerds.com/covers/9780439064873/process', {
  method: 'POST'
});
```

## Sample Query (Test First!)

**CRITICAL**: Test this in psql before implementing:
```sql
SELECT
    e.data->>'title' AS title,
    a.data->>'name' AS author,
    ei.isbn
FROM editions e
JOIN edition_isbns ei ON ei.edition_key = e.key
JOIN works w ON w.key = e.work_key
JOIN author_works aw ON aw.work_key = w.key
JOIN authors a ON aw.author_key = a.key
WHERE ei.isbn = '9780439064873'  -- Test with Harry Potter ISBN
LIMIT 1;
```

Run via: `./scripts/db-check.sh`

## Code Patterns

### Adding API Endpoints (Hono Framework)
```javascript
// In worker/index.js
app.get('/api/search', async (c) => {
  // IMPORTANT: Validate input first
  const isbn = c.req.query('isbn')?.replace(/[^0-9X]/gi, '').toUpperCase();

  if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
    return c.json({ error: 'Invalid ISBN' }, 400);
  }

  // Get request-scoped sql connection
  const sql = c.get('sql');

  // YOU MUST wrap queries in try-catch
  try {
    const results = await sql`
      SELECT
        e.data->>'title' AS title,
        a.data->>'name' AS author,
        ei.isbn
      FROM editions e
      JOIN edition_isbns ei ON ei.edition_key = e.key
      LEFT JOIN works w ON w.key = e.work_key
      LEFT JOIN author_works aw ON aw.work_key = w.key
      LEFT JOIN authors a ON aw.author_key = a.key
      WHERE ei.isbn = ${isbn}
      LIMIT 10
    `;

    return c.json({ results });
  } catch (error) {
    console.error('DB error:', error);
    return c.json({ error: 'Query failed' }, 500);
  }
});
```

**Key Hono Patterns**:
- Use `c.req.query('param')` for query parameters
- Use `c.json(data, status)` for JSON responses
- Use `c.get('sql')` for request-scoped database connection
- Middleware applies to routes via `app.use()`

## Critical Constraints

### Database Operations
- **NEVER re-import data** - database is fully populated (250GB, 54M records)
- **Read-only application** - OpenLibrary is source of truth
- Indexes exist on common columns - use them
- Complex joins need careful design (50M+ rows)

### SSH Access & Auto-Start
- Passwordless configured: `ssh root@Tower.local`
- **Auto-start configured**: Both `postgres` and `alexandria-tunnel` containers use `--restart unless-stopped`
  - Containers auto-start on Tower boot
  - Containers auto-restart on crash/unexpected exit
  - Containers stay stopped only if manually stopped with `docker stop`

### Security
- **docs/CREDENTIALS.md** has all passwords (gitignored - NEVER commit!)
- Tunnel uses mTLS encryption
- **YOU MUST** add rate limiting + input validation for public API

### Cloudflare Resources
- Account: Jukasdrj@gmail.com's Account
- Tunnel ID: 848928ab-4ab9-4733-93b0-3e7967c60acb
- Worker: alexandria | Domain: ooheynerds.com

## Troubleshooting

### Worker Issues
```bash
npx wrangler whoami   # Check auth
npx wrangler login    # Re-auth if needed
```

### Tunnel Issues
```bash
# The tunnel uses a Zero Trust token (remotely-managed)
# Restart tunnel:
ssh root@Tower.local "docker restart alexandria-tunnel"
./scripts/tunnel-status.sh  # Should show 4 connections

# If container is missing, recreate it:
# Get the tunnel token from Cloudflare Zero Trust dashboard or docs/CREDENTIALS.md (gitignored)
ssh root@Tower.local "docker run -d \
  --name alexandria-tunnel \
  --restart unless-stopped \
  --network host \
  cloudflare/cloudflared:latest \
  tunnel run --token <YOUR_TUNNEL_TOKEN>"

# IMPORTANT: Must use --network host for tunnel to access PostgreSQL on localhost:5432
```

### Database Issues
```bash
ssh root@Tower.local "docker ps | grep postgres"
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT 1;'"
```

### Performance Issues
- Use `EXPLAIN ANALYZE` in psql to diagnose slow queries
- Check indexes: `\d+ table_name`
- Consider Hyperdrive for connection pooling
- Database is optimized, but 50M+ row joins need careful design

## File Structure

```
alex/
├── worker/                    # Cloudflare Worker code
│   ├── index.ts               # Main worker + Hono routes (TypeScript)
│   ├── wrangler.jsonc         # Wrangler config (Hyperdrive, R2, KV, Secrets, Queues)
│   ├── cover-handlers.js      # Work-based cover processing (POST /api/covers/process)
│   ├── image-utils.js         # Image download, validation, hashing utilities
│   ├── enrich-handlers.js     # Enrichment API handlers
│   ├── enrichment-service.js  # Enrichment business logic
│   ├── queue-handlers.js      # Queue consumer handlers (cover + enrichment)
│   ├── services/
│   │   ├── image-processor.js # ISBN-based cover processing pipeline
│   │   ├── cover-fetcher.js   # Multi-provider cover URL fetching
│   │   └── batch-isbndb.ts    # ISBNdb Premium batch API (1000 ISBNs/call)
│   └── package.json           # Dependencies
├── scripts/                   # Deployment & monitoring scripts
│   ├── expand-author-bibliographies.js  # Bulk author enrichment script
│   └── e2e-author-enrichment-test.js    # E2E test for author pipeline
├── docs/                      # Documentation
│   ├── CREDENTIALS.md         # Passwords (gitignored!)
│   ├── ARCHITECTURE.md        # System design
│   └── SETUP.md               # Infrastructure setup
├── tunnel/config.yml          # Tunnel config reference
└── TODO.md                    # Development roadmap
```

## Cloudflare Bindings Reference

```jsonc
// wrangler.jsonc bindings summary
{
  "hyperdrive": [{
    "binding": "HYPERDRIVE"                 // PostgreSQL via Hyperdrive
  }],
  "r2_buckets": [{
    "binding": "COVER_IMAGES"               // R2: bookstrack-covers-processed
  }],
  "kv_namespaces": [{
    "binding": "CACHE"                      // KV for caching
  }],
  "secrets_store_secrets": [
    { "binding": "ISBNDB_API_KEY" },        // ISBNdb API key
    { "binding": "GOOGLE_BOOKS_API_KEY" }   // Google Books API key
  ],
  "analytics_engine_datasets": [
    { "binding": "ANALYTICS" },             // Performance metrics
    { "binding": "QUERY_ANALYTICS" },       // Query tracking
    { "binding": "COVER_ANALYTICS" }        // Cover processing stats
  ],
  "queues": {
    "producers": [{
      "binding": "ENRICHMENT_QUEUE"         // Background processing queue
    }]
  }
}
```

## Additional Context

- Unraid server runs 24/7 with auto-restart
- Tunnel auto-restarts on failure (Docker policy)
- Worker runs on Cloudflare's global network (300+ locations)
- See TODO.md for Phase 3+ features (search UI, author queries, optimization)
