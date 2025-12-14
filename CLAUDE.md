# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexandria exposes a self-hosted OpenLibrary PostgreSQL database (54M+ books) through Cloudflare Workers + Tunnel. Database runs on Unraid at home, accessible globally via Cloudflare's edge.

**Current Status**: Phase 1 + 2 COMPLETE! Queue-based architecture operational with cover processing and metadata enrichment. Worker live with Hyperdrive + Tunnel database access + R2 cover image storage + Cloudflare Queues. **Dec 10, 2025**: Upgraded to ISBNdb Premium (3x rate, 10x batch size), added direct batch endpoint for 10x efficiency. **Dec 13, 2025**: Added Cloudflare Workflows for durable bulk author harvesting (auto-recovering, checkpoint-free). **Dec 14, 2025**: Added NewReleasesHarvestWorkflow with self-spawning continuation for fully automated harvesting.

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
→ Storage: isbn/{isbn}/{size}.webp (CONSOLIDATED - Issue #95)
→ Serves via /covers/:isbn/:size
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

### Log Management (Logpush to R2)
```bash
# Setup Logpush (one-time)
./scripts/setup-logpush.sh

# Manage Logpush jobs
./scripts/logpush-management.sh list              # List all jobs
./scripts/logpush-management.sh get <job_id>      # Get job details
./scripts/logpush-management.sh list-logs         # List log files in R2
./scripts/logpush-management.sh download <path>   # Download log file
./scripts/logpush-management.sh test              # Generate test traffic

# Real-time logs (7-day retention)
npm run tail

# Long-term logs (R2 storage, permanent)
npx wrangler r2 object list alexandria-logs --limit 20
```

**Logpush Configuration** (COMPLETE - Dec 12, 2025):
- **Dataset**: Workers Trace Events
- **Destination**: R2 bucket `alexandria-logs`
- **Fields**: EventTimestampMs, EventType, Outcome, ScriptName, Exceptions, Logs, CPUTimeMs, WallTimeMs
- **Batching**: Every 30 seconds or 5MB (whichever first)
- **Format**: JSONL (newline-delimited JSON), gzip compressed
- **Retention**: Workers Logs UI (7 days) + R2 (permanent)
- **Cost**: ~$1.50/month for 10K requests/day
- **Documentation**: `docs/LOGPUSH-SETUP.md`

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
- **POST /api/enrich/batch-direct** - Direct batch enrichment (up to 1000 ISBNs, bypasses queue)
- **GET /api/enrich/status/:id** - Check enrichment status
- **POST /api/authors/bibliography** - Get author's complete bibliography from ISBNdb
- **POST /api/authors/enrich-bibliography** - Fetch + enrich author bibliography in one step (most efficient!) ⭐ NEW

## ISBNdb API Integration (COMPLETE ✅)

### Plan: Premium (Paid) - Upgraded Dec 10, 2025
- **Rate Limit**: 3 requests/second (3x faster than Basic)
- **Batch Endpoint**: Up to 1000 ISBNs per POST request (10x larger than Basic)
- **Base URL**: `api.premium.isbndb.com` (NOT `api2.isbndb.com`)
- **Daily Quota**: ~15,000 API calls (resets every 24 hours, does NOT roll over)

### How API Calls Are Counted (IMPORTANT!)
**Each API REQUEST = 1 call, regardless of results returned.**
- Fetching 100 books in one request = 1 call (NOT 100 calls)
- Batch POST for 1000 ISBNs = 1 call (NOT 1000 calls)
- This is PER-REQUEST billing, not per-result

### ISBNdb Pricing Tiers (Reference)
| Plan | Price | Daily Calls | Rate Limit | Batch Size | Base URL |
|------|-------|-------------|------------|------------|----------|
| Basic | $14.95/mo | ~7,500 | 1 req/sec | 100 ISBNs | api2.isbndb.com |
| **Premium** | $29.95/mo | ~15,000 | **3 req/sec** | **1000 ISBNs** | api.premium.isbndb.com |
| Pro | $74.95/mo | ~30,000 | 5 req/sec | 1000 ISBNs | api.pro.isbndb.com |
| Enterprise | Custom | Custom | 10 req/sec | 1000 ISBNs | api.enterprise.isbndb.com |

### Available Endpoints (All Verified Working ✅)
1. **GET /book/{isbn}** - Single book lookup (includes pricing)
2. **POST /books** - Batch lookup (up to 1000 ISBNs) ⭐ **Most Efficient**
3. **GET /books/{query}** - Search with pagination
4. **GET /author/{name}** - Author bibliography with pagination (default: 20/page, max: 1000)
5. **GET /authors/{query}** - Author search
6. **GET /publisher/{name}** - Publisher catalog
7. **GET /publishers/{query}** - Publisher search
8. **GET /subject/{name}** - Books by subject
9. **GET /subjects/{query}** - Subject search

### ISBNdb Pagination (IMPORTANT)
The `/author/{name}` endpoint **does NOT return a `total` field**. Pagination must check if the response contains a full page to determine if more pages exist:
```javascript
// ISBNdb pagination: if we got a full page, there might be more
const booksInResponse = data.books?.length || 0;
hasMore = booksInResponse === pageSize; // pageSize = 100
```
**Note**: Default page size is 20, but can request up to 1000 via `?pageSize=1000`. Max 10,000 total results regardless of pagination.

### Response Size Limit
ISBNdb has a **6MB response size limit**. If exceeded, returns 500 error. For large batch requests, consider chunking.

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
1. **Use batch endpoint** for multiple ISBNs (1 call for 1000 ISBNs vs 1000 calls)
2. **Use Premium endpoint** (`api.premium.isbndb.com`) for 3x rate limit
3. **Use `/api/authors/enrich-bibliography`** for author expansion (fetches + enriches in one step)
4. **Extract `image_original`** for best cover quality
5. **Rate limit**: 3 req/sec (Premium), use 350ms delay between requests
6. **Chunk large lists**: 1000 ISBNs per batch (Premium limit)
7. **Monitor quota**: Dashboard shows 30-day trailing usage; calls don't roll over

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
- **Structure**: `isbn/{isbn}/{size}.webp` (CONSOLIDATED - Issue #95)
  - Primary: `isbn/{isbn}/large.webp`, `isbn/{isbn}/medium.webp`, `isbn/{isbn}/small.webp`
  - Fallback: `isbn/{isbn}/original.{ext}` (legacy originals)

**IMPORTANT**: All cover storage now uses ISBN-based paths. Work-key based paths (`covers/{work_key}/`) are DEPRECATED.

### Endpoints

**Primary (ISBN-based)**:
- `POST /api/covers/process` - Process cover from provider URL (requires `isbn` + `provider_url`)
- `GET /covers/:isbn/:size` - Serve cover image (large/medium/small)
- `GET /covers/:isbn/status` - Check if cover exists
- `POST /covers/:isbn/process` - Trigger cover processing from providers
- `POST /covers/batch` - Process multiple ISBNs (max 10)
- `POST /api/covers/queue` - Queue cover processing (max 100)

**Deprecated**:
- `GET /api/covers/:work_key/:size` - Returns HTTP 410 (deprecated, use ISBN-based endpoint)

### Domain Whitelist (Security)
Only these domains are allowed for cover downloads:
- `books.google.com`
- `covers.openlibrary.org`
- `images.isbndb.com`
- `images-na.ssl-images-amazon.com`
- `m.media-amazon.com`
- `pictures.abebooks.com`

### Processing Pipeline
```javascript
// Process cover from provider URL (requires ISBN)
const response = await fetch('https://alexandria.ooheynerds.com/api/covers/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    isbn: '9780439064873',  // REQUIRED - used as storage key
    provider_url: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
    work_key: '/works/OL45804W'  // optional, for metadata
  })
});

// Direct ISBN-based processing
const response = await fetch('https://alexandria.ooheynerds.com/covers/9780439064873/process', {
  method: 'POST'
});

// Serve cover by ISBN
const imageUrl = 'https://alexandria.ooheynerds.com/covers/9780439064873/large';
```

### Migration Script
Audit and clean up duplicate covers stored under legacy work-key paths:
```bash
# Audit R2 storage for duplicates
node scripts/audit-cover-storage.js

# Delete duplicates (dry run first)
node scripts/audit-cover-storage.js --delete-duplicates --dry-run

# Actually delete duplicates
node scripts/audit-cover-storage.js --delete-duplicates
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

## Bulk Author Harvesting (NEW - Dec 11, 2025)

### Overview

Bulk harvesting of author bibliographies from ISBNdb to enrich Alexandria's catalog with high-quality covers and metadata. Based on multi-model consensus analysis.

### Strategy (Consensus-Driven)

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| **Prioritization** | Edition count (not work count) | Better proxy for ISBNdb coverage |
| **Approach** | Breadth-first (1 page/author) | Faster widespread improvement |
| **Rate** | 1.5s delay between authors | Safe for 3 req/sec limit |
| **Fallback** | Use `image` URL if `image_original` expires | 2-hour JWT on high-res URLs |

### Scripts

```bash
# Dry run - see what would be processed
node scripts/bulk-author-harvest.js --dry-run --tier top-1000

# Validation run (100 authors)
node scripts/bulk-author-harvest.js --tier top-100

# Full tier processing
node scripts/bulk-author-harvest.js --tier top-1000
node scripts/bulk-author-harvest.js --tier 1000-5000
node scripts/bulk-author-harvest.js --tier 5000-20000

# Resume from checkpoint
node scripts/bulk-author-harvest.js --resume

# Single author test
node scripts/bulk-author-harvest.js --author "Brandon Sanderson"
```

### Tiers by Edition Count

| Tier | Authors | Est. API Calls | Days to Complete |
|------|---------|----------------|------------------|
| top-100 | 100 | 100 | <1 hour |
| top-1000 | 1,000 | 1,000 | <1 day |
| 1000-5000 | 4,000 | 4,000 | <1 day |
| 5000-20000 | 15,000 | 15,000 | 1 day |

### Critical Constraints

1. **ISBNdb Premium Quota**: 15,000 calls/day (resets every 24 hours)
2. **Image URL Expiry**: `image_original` URLs have 2-hour JWT - queue must process within 2 hours
3. **Queue Throughput**: Cover queue processes 50 images/batch with 15s timeout

### Monitoring

```bash
# Watch queue processing
npx wrangler tail alexandria --format pretty | grep -E "(Cover|Queue)"

# Check queue depth
curl https://alexandria.ooheynerds.com/api/queue/status

# View cover analytics
# Dashboard: Cloudflare > Analytics Engine > alexandria_covers
```

### Pipeline Flow

```
bulk-author-harvest.js
    └─→ /api/authors/enrich-bibliography (Alexandria Worker)
            ├─→ ISBNdb /author/{name} (fetch books)
            ├─→ enriched_editions (store metadata)
            ├─→ enriched_works (store work data)
            └─→ alexandria-cover-queue (queue cover URLs)
                    └─→ jSquash WASM (download → resize → WebP → R2)
                            └─→ isbn/{isbn}/{large,medium,small}.webp
```

## Cloudflare Workflows (Updated Dec 14, 2025)

### Overview

Cloudflare Workflows provides durable, long-running execution for harvesting operations. Two workflows available:

1. **AuthorHarvestWorkflow** - Bulk author bibliography harvesting by tier
2. **NewReleasesHarvestWorkflow** - New book releases by date range (self-spawning)

Benefits over local scripts:
- No local machine dependency (runs on Cloudflare edge)
- Automatic retry on transient failures
- Durable execution (survives Worker restarts)
- ISBNdb JWT handled within 2-hour window

### Workflow 1: `AuthorHarvestWorkflow`

**Binding**: `AUTHOR_HARVEST`
**Class**: `AuthorHarvestWorkflow` (in `worker/src/workflows/author-harvest.ts`)

```bash
# Start author harvest
curl -X POST https://alexandria.ooheynerds.com/api/harvest/start \
  -H "Content-Type: application/json" \
  -d '{"tier": "top-100"}'

# Check status
curl https://alexandria.ooheynerds.com/api/harvest/status/{instance_id}
```

| Tier | Authors | Est. Steps |
|------|---------|------------|
| `top-10` | 10 | ~50 |
| `top-100` | 100 | ~550 |
| `top-1000` | 1,000 | ~5,500 |

### Workflow 2: `NewReleasesHarvestWorkflow` (NEW - Dec 14, 2025)

**Binding**: `NEW_RELEASES_HARVEST`
**Class**: `NewReleasesHarvestWorkflow` (in `worker/src/workflows/new-releases-harvest.ts`)

Harvests new book releases from ISBNdb by publication date. **Fully automated with self-spawning continuation** - just start it and walk away.

```bash
# Start new releases harvest (Nov-Dec 2025)
curl -X POST https://alexandria.ooheynerds.com/api/harvest/new-releases \
  -H "Content-Type: application/json" \
  -d '{"start_month": "2025-11", "end_month": "2025-12"}'

# Check status
curl https://alexandria.ooheynerds.com/api/harvest/new-releases/{instance_id}
```

**Parameters**:
- `start_month` (required): Start month in YYYY-MM format
- `end_month` (required): End month in YYYY-MM format
- `max_pages_per_month` (default: 100): Pages to fetch per month (100 books/page)
- `skip_existing` (default: true): Skip ISBNs already in Alexandria

### Self-Spawning Continuation Pattern (Dec 14, 2025)

The NewReleasesHarvestWorkflow implements **self-spawning continuation** for fully automated processing:

```typescript
// When workflow hits its limit, it spawns its own successor
if (results.status === 'continuation_needed' && results.next_month) {
  await step.do('spawn-continuation', async () => {
    await this.env.NEW_RELEASES_HARVEST.create({
      id: `new-releases-${results.next_month}-${Date.now()}`,
      params: { ...params, resume_from_month, resume_from_page }
    });
  });
  results.continuation_spawned = true;
}
```

**Result**: Start one workflow, it chains through all months automatically. No manual intervention needed.

### Workflow Limits (Optimized Dec 14, 2025)

| Limit | AuthorHarvest | NewReleasesHarvest |
|-------|---------------|-------------------|
| Items per workflow | 40 authors | **150 books** |
| Subrequests/item | ~14 | ~6 |
| Pages fetched | N/A | **100/month** (default) |
| Continuation | Manual (next_offset) | **Auto (self-spawn)** |

**Subrequest Budget** (1000 limit per workflow):
- NewReleasesHarvest: 150 books × 6 subrequests = 900 (safe margin)
- AuthorHarvest: 40 authors × 14 subrequests = 560 (safe margin)

### wrangler.jsonc Configuration

```jsonc
"workflows": [
  {
    "name": "author-harvest-workflow",
    "binding": "AUTHOR_HARVEST",
    "class_name": "AuthorHarvestWorkflow"
  },
  {
    "name": "new-releases-harvest-workflow",
    "binding": "NEW_RELEASES_HARVEST",
    "class_name": "NewReleasesHarvestWorkflow"
  }
]
```

### Monitoring

```bash
# Check author harvest status
curl https://alexandria.ooheynerds.com/api/harvest/status/{instance_id}

# Check new releases status
curl https://alexandria.ooheynerds.com/api/harvest/new-releases/{instance_id}

# View workflow logs
npx wrangler tail alexandria --format pretty | grep -E "(AuthorHarvest|NewReleasesHarvest)"

# Cloudflare Dashboard
# Workers & Pages > alexandria > Workflows tab
```

## File Structure

```
alex/
├── worker/                    # Cloudflare Worker code
│   ├── src/
│   │   ├── index.ts           # Main worker + Hono routes (TypeScript)
│   │   ├── env.ts             # Environment type definitions
│   │   ├── routes/            # API route handlers
│   │   │   ├── harvest.ts     # Workflow trigger endpoints (/api/harvest/*)
│   │   │   ├── books.ts       # ISBNdb book search endpoints
│   │   │   ├── authors.ts     # Author API endpoints
│   │   │   └── ...            # Other route modules
│   │   └── workflows/
│   │       ├── author-harvest.ts       # AuthorHarvestWorkflow (tier-based)
│   │       └── new-releases-harvest.ts # NewReleasesHarvestWorkflow (self-spawning)
│   ├── wrangler.jsonc         # Wrangler config (Hyperdrive, R2, KV, Secrets, Queues, Workflows)
│   ├── services/
│   │   ├── image-processor.js # ISBN-based cover processing pipeline
│   │   ├── cover-fetcher.js   # Multi-provider cover URL fetching
│   │   └── batch-isbndb.ts    # ISBNdb Premium batch API (1000 ISBNs/call)
│   └── package.json           # Dependencies
├── scripts/                   # Deployment & monitoring scripts
│   ├── bulk-author-harvest.js           # Bulk author harvesting (edition count priority)
│   ├── expand-author-bibliographies.js  # CSV-based author enrichment script
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
    "producers": [
      { "binding": "ENRICHMENT_QUEUE" },    // Metadata enrichment queue
      { "binding": "COVER_QUEUE" }          // Cover processing queue
    ]
  },
  "workflows": [
    { "binding": "AUTHOR_HARVEST" },        // AuthorHarvestWorkflow (tier-based)
    { "binding": "NEW_RELEASES_HARVEST" }   // NewReleasesHarvestWorkflow (self-spawning)
  ]
}
```

## Additional Context

- Unraid server runs 24/7 with auto-restart
- Tunnel auto-restarts on failure (Docker policy)
- Worker runs on Cloudflare's global network (300+ locations)
- See TODO.md for Phase 3+ features (search UI, author queries, optimization)
