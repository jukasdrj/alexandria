# Alexandria Queue & Enrichment System Documentation

**Last Updated**: 2026-01-08
**Status**: All systems operational
**Worker Version**: 865f3066-82d5-4f64-a1b7-d61bd1c1049a

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Queue Architecture](#queue-architecture)
3. [Enrichment Workflows](#enrichment-workflows)
4. [API Endpoints](#api-endpoints)
5. [Monitoring & Status](#monitoring--status)
6. [Backfill System](#backfill-system)
7. [Cover Harvest System](#cover-harvest-system)
8. [Author Enrichment](#author-enrichment)
9. [Quota Management](#quota-management)
10. [Examples & Usage](#examples--usage)

---

## System Overview

Alexandria uses **Cloudflare Queues** for asynchronous processing of:
- **Book metadata enrichment** (ISBNdb API calls)
- **Cover image harvesting** (download, process, store in R2)
- **Historical backfill** (Gemini + ISBNdb pipeline)
- **Author biography enrichment** (Wikidata integration)
- **Author Just-in-Time enrichment** (view-triggered ISBNdb bibliography expansion)

### Key Benefits
- ✅ **Async processing** - No client timeouts
- ✅ **Automatic retries** - Built-in error handling
- ✅ **Batch optimization** - 1000 ISBNs per ISBNdb call
- ✅ **Dead letter queues** - Failed messages preserved
- ✅ **100% success rate** - 3,282 operations, zero failures (7 days)

---

## Queue Architecture

### Queue Configuration

All queues are configured in `worker/wrangler.jsonc`:

| Queue | Batch Size | Concurrency | Timeout | Retries | DLQ |
|-------|-----------|-------------|---------|---------|-----|
| **alexandria-enrichment-queue** | 100 | 1 | 60s | 3 | alexandria-enrichment-dlq |
| **alexandria-cover-queue** | 5 | 3 | 60s | 3 | alexandria-cover-dlq |
| **alexandria-backfill-queue** | 1 | 1 | 5s | 2 | alexandria-backfill-dlq |
| **alexandria-author-queue** | 10 | 1 | 30s | 3 | alexandria-author-dlq |

### Queue Handlers

Implemented in `src/services/queue-handlers.ts`:

```typescript
// Cover processing (parallel execution)
export async function processCoverQueue(
  batch: MessageBatch<CoverQueueMessage>,
  env: Env
): Promise<CoverQueueResults>

// Enrichment (batched ISBNdb calls)
export async function processEnrichmentQueue(
  batch: MessageBatch<EnrichmentQueueMessage>,
  env: Env
): Promise<EnrichmentQueueResults>

// Backfill orchestration
export async function processBackfillQueue(
  batch: MessageBatch<BackfillQueueMessage>,
  env: Env
): Promise<BackfillQueueResults>

// Author JIT enrichment (new - Jan 2026)
export async function processAuthorQueue(
  batch: MessageBatch<AuthorQueueMessage>,
  env: Env
): Promise<AuthorQueueResults>
```

### Message Routing

The Worker's `queue()` handler in `src/index.ts` routes messages to appropriate handlers:

```typescript
export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    switch (batch.queue) {
      case 'alexandria-cover-queue':
        return processCoverQueue(batch, env);
      case 'alexandria-enrichment-queue':
        return processEnrichmentQueue(batch, env);
      case 'alexandria-backfill-queue':
        return processBackfillQueue(batch, env);
      case 'alexandria-author-queue':
        return processAuthorQueue(batch, env);
    }
  }
}
```

---

## Enrichment Workflows

### 1. Direct Enrichment (Real-time)

**Trigger**: User query for uncached ISBN
**Endpoint**: `GET /api/search/combined?q=<ISBN>`

```mermaid
User Query → Search Endpoint → Check Cache
                                    ↓ (miss)
                                ISBN Lookup
                                    ↓ (not found)
                            Queue Enrichment
                                    ↓
                        Enrichment Queue → ISBNdb API
                                              ↓
                                    Store in enriched_editions
                                              ↓
                                      Queue Cover → Cover Queue
```

**Flow**:
1. User searches for ISBN
2. Not found in `enriched_editions`
3. Message sent to `ENRICHMENT_QUEUE`
4. Queue handler batches up to 100 ISBNs
5. Single ISBNdb API call (1000 ISBN max)
6. Results stored in database
7. Cover URLs queued to `COVER_QUEUE`

### 2. Batch Enrichment (Manual)

**Trigger**: Manual API call
**Endpoint**: `POST /api/enrich/batch-direct`

```bash
curl -X POST https://alexandria.ooheynerds.com/api/enrich/batch-direct \
  -H "Content-Type: application/json" \
  -d '{
    "isbns": ["9780439064873", "9780439136365"],
    "priority": "high",
    "source": "user_request"
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "enriched": 2,
    "cached": 0,
    "failed": 0,
    "api_calls_saved": 0,
    "quota_used": 1,
    "covers_queued": 2
  }
}
```

### 3. Backfill Enrichment (Async Queue)

**Trigger**: Manual backfill request
**Endpoint**: `POST /api/harvest/backfill`

See [Backfill System](#backfill-system) for details.

---

## API Endpoints

### Search Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search/combined?q=<query>` | Combined search (ISBN/title/author) |
| GET | `/api/search?type=<type>&q=<query>` | Legacy search with explicit type |
| GET | `/api/books/search?isbn=<isbn>` | Direct ISBN lookup |

### Enrichment Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/enrich/batch-direct` | Batch enrich up to 1000 ISBNs |
| POST | `/api/enrich/author` | Enrich single author |
| GET | `/api/enrich/status` | Get enrichment statistics |

### Harvest & Backfill Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/harvest/backfill` | Trigger historical backfill |
| GET | `/api/harvest/backfill/status` | Overall backfill progress |
| GET | `/api/harvest/backfill/status/:jobId` | Specific job status |
| GET | `/api/harvest/gemini/test` | Test Gemini API connection |
| GET | `/api/harvest/hybrid/test` | Test hybrid backfill |
| GET | `/api/harvest/covers` | Trigger cover harvest |
| GET | `/api/harvest/quota` | Check harvest quota |

### Author Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/authors/top?limit=<n>` | Top authors by work count |
| GET | `/api/authors/:key` | Author details by key (triggers JIT enrichment) |
| POST | `/api/authors/bibliography` | Get author bibliography |
| POST | `/api/authors/enrich-bibliography` | Expand author bibliography from ISBNdb |
| POST | `/api/authors/enrich-wikidata` | Enrich authors with Wikidata |
| POST | `/api/authors/resolve-identifier` | Resolve VIAF/ISNI to Wikidata |
| GET | `/api/authors/enrich-status` | Author enrichment statistics |

**Note**: The `GET /api/authors/:key` endpoint now includes view-triggered Just-in-Time enrichment. See [docs/features/AUTHOR-JIT-ENRICHMENT.md](./features/AUTHOR-JIT-ENRICHMENT.md) for full details.

### Cover Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/covers/:isbn/large` | Serve large cover (600x900) |
| GET | `/covers/:isbn/medium` | Serve medium cover (300x450) |
| GET | `/covers/:isbn/small` | Serve small cover (150x225) |
| POST | `/api/covers/process` | Process cover from URL |
| POST | `/api/covers/batch` | Batch process covers (max 10) |

### Monitoring Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Worker health check |
| GET | `/api/stats` | Database statistics |
| GET | `/api/quota/status` | ISBNdb quota tracking |
| GET | `/openapi.json` | Full API documentation |

---

## Monitoring & Status

### Health Check

```bash
curl https://alexandria.ooheynerds.com/health
```

**Response**:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "database": "connected",
    "r2_covers": "bound",
    "hyperdrive_latency_ms": 64
  },
  "meta": {
    "requestId": "9ba7a95c6a00143c",
    "timestamp": "2026-01-08T00:43:35.942Z",
    "latencyMs": 18
  }
}
```

### Database Statistics

```bash
curl https://alexandria.ooheynerds.com/api/stats
```

**Response**:
```json
{
  "total_editions": 54881898,
  "total_works": 40158492,
  "total_authors": 14718239,
  "enriched_editions": 28659686,
  "enriched_works": 21324256,
  "enriched_authors": 14717121,
  "coverage": {
    "editions": "52.2%",
    "works": "53.1%",
    "authors": "100.0%"
  }
}
```

### Quota Status

```bash
curl https://alexandria.ooheynerds.com/api/quota/status
```

**Response**:
```json
{
  "success": true,
  "data": {
    "daily_limit": 15000,
    "safety_limit": 13000,
    "used": 2066,
    "remaining": 12934,
    "safety_remaining": 10934,
    "percentage_used": 15.89,
    "reset_at": "2026-01-09T00:00:00.000Z",
    "can_make_calls": true
  }
}
```

### Queue Status (Wrangler CLI)

```bash
# List all queues
npx wrangler queues list

# Output:
# alexandria-backfill-queue    - 1 message, 1 consumer
# alexandria-cover-queue       - 2 messages, 1 consumer
# alexandria-enrichment-queue  - 2 messages, 1 consumer
```

---

## Backfill System

### Overview

The backfill system systematically enriches Alexandria's database with historically significant books using a **Gemini AI → Deduplication → ISBNdb → Enrichment** pipeline.

### Architecture

```mermaid
POST /api/harvest/backfill
        ↓
Validate year/month
        ↓
Create job (KV storage)
        ↓
Queue message → BACKFILL_QUEUE
        ↓
Queue Consumer (async)
        ↓
[1] Gemini API - Generate book list
        ↓
[2] Deduplication - 3-tier check
        ↓
[3] ISBNdb Batch - Fetch metadata
        ↓
[4] Database - Store enriched_editions
        ↓
[5] Cover Queue - Queue cover downloads
```

### Triggering a Backfill

**Endpoint**: `POST /api/harvest/backfill`

**Request**:
```bash
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "month": 12,
    "batch_size": 20
  }'
```

**Response**:
```json
{
  "success": true,
  "job_id": "backfill-2024-12-abc123",
  "year": 2024,
  "month": 12,
  "status": "queued",
  "message": "Backfill job queued for processing",
  "status_url": "/api/harvest/backfill/status/backfill-2024-12-abc123"
}
```

### Checking Backfill Status

**Overall Status**: `GET /api/harvest/backfill/status`

```bash
curl https://alexandria.ooheynerds.com/api/harvest/backfill/status
```

**Response**:
```json
{
  "summary": {
    "years_total": 4,
    "years_completed": 0,
    "years_in_progress": 4,
    "total_books": 340,
    "total_covers": 0,
    "total_quota_used": 7
  },
  "incomplete_years": [
    2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018,
    2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010, 2009,
    2008, 2007, 2006, 2005
  ],
  "next_target": {
    "year": 2026,
    "month": 1
  }
}
```

**Specific Job**: `GET /api/harvest/backfill/status/:jobId`

```bash
curl https://alexandria.ooheynerds.com/api/harvest/backfill/status/backfill-2024-12-abc123
```

**Response**:
```json
{
  "job_id": "backfill-2024-12-abc123",
  "year": 2024,
  "month": 12,
  "status": "completed",
  "progress": "100%",
  "stats": {
    "gemini_books_generated": 20,
    "isbns_resolved": 18,
    "isbn_resolution_rate": 90.0,
    "exact_dedup_matches": 2,
    "new_isbns": 16,
    "new_isbn_percentage": 80.0,
    "isbndb_hits": 15,
    "isbndb_hit_rate": 93.75,
    "gemini_calls": 1,
    "isbndb_calls": 1,
    "total_api_calls": 2,
    "quota_used": 2
  }
}
```

### Backfill Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `year` | integer | No | Auto | Year to backfill (2005-2030) |
| `month` | integer | No | Auto | Month to backfill (1-12) |
| `batch_size` | integer | No | 20 | Books to generate (10-50) |
| `dry_run` | boolean | No | false | Validation only, no DB updates |
| `experiment_id` | string | No | - | Tracking ID for experiments |
| `model_override` | string | No | gemini-2.5-flash | Gemini model to use |
| `max_quota` | integer | No | - | Budget limit (1-1000) |

### Completed Months

**Query the database** to see which months have been backfilled:

```sql
SELECT
  EXTRACT(YEAR FROM created_at) as year,
  EXTRACT(MONTH FROM created_at) as month,
  COUNT(*) as books_added,
  primary_provider
FROM enriched_editions
WHERE primary_provider IN ('gemini', 'hybrid', 'backfill')
  AND created_at > '2024-01-01'
GROUP BY year, month, primary_provider
ORDER BY year DESC, month DESC;
```

**Via KV storage** (backfill completion tracking):

The system uses `QUOTA_KV` to track completed months:
- Key pattern: `backfill:YYYY:MM:complete`
- Value: `{ completed: true, timestamp: "...", stats: {...} }`

### Backfill Flow Details

#### Stage 1: Gemini Generation
- **Input**: Year, month, batch_size
- **Process**: Gemini generates list of historically significant books
- **Output**: JSON array of `{title, author, year, isbn?}`
- **Validation**: ISBN checksum verification

#### Stage 2: 3-Tier Deduplication
1. **Exact**: Check `enriched_editions.isbn`
2. **Related**: Check `related_isbns` jsonb field
3. **Fuzzy**: Trigram title similarity (threshold: 0.6)

#### Stage 3: ISBNdb Batch Enrichment
- **Input**: Deduplicated ISBN list
- **Batch size**: Up to 1000 ISBNs per call
- **Quota tracking**: Centralized via `QUOTA_KV`
- **Output**: Full book metadata

#### Stage 4: Database Storage
- **Table**: `enriched_editions`
- **Conflict resolution**: Upsert with confidence scoring
- **Audit trail**: `enrichment_log` entries

#### Stage 5: Cover Queueing
- **Automatic**: Covers queued for async processing
- **Priority**: low (backfill), medium (user), high (real-time)

---

## Cover Harvest System

### Overview

The cover system downloads, processes, and serves book covers in multiple sizes using **jSquash WebP compression** and **Cloudflare R2 storage**.

### Storage Structure

**R2 Bucket**: `bookstrack-covers-processed`

```
isbn/
  9780439064873/
    large.webp    (600x900)
    medium.webp   (300x450)
    small.webp    (150x225)
```

### Coverage Statistics

| Metric | Value | Percentage |
|--------|-------|------------|
| Total Editions | 28,659,686 | 100% |
| With Covers | 193,252 | 0.67% |
| Added (24h) | 12,896 | - |

### Triggering Cover Harvest

**Automatic**: Covers are queued automatically during enrichment

**Manual Single**: `POST /api/covers/process`
```bash
curl -X POST https://alexandria.ooheynerds.com/api/covers/process \
  -H "Content-Type: application/json" \
  -d '{
    "isbn": "9780439064873",
    "provider_url": "https://images.isbndb.com/covers/64873/9780439064873.jpg",
    "priority": "high"
  }'
```

**Manual Batch**: `POST /api/covers/batch` (max 10)
```bash
curl -X POST https://alexandria.ooheynerds.com/api/covers/batch \
  -H "Content-Type: application/json" \
  -d '{
    "covers": [
      {"isbn": "9780439064873", "priority": "high"},
      {"isbn": "9780439136365", "priority": "medium"}
    ]
  }'
```

### Serving Covers

**Endpoint**: `GET /covers/:isbn/:size`

```bash
# Large cover (600x900)
curl https://alexandria.ooheynerds.com/covers/9780439064873/large

# Medium cover (300x450)
curl https://alexandria.ooheynerds.com/covers/9780439064873/medium

# Small cover (150x225)
curl https://alexandria.ooheynerds.com/covers/9780439064873/small
```

**Cache Headers**:
- `Cache-Control: public, max-age=2592000` (30 days)
- `ETag` for efficient caching

### Cover Sources (Priority Order)

1. **ISBNdb** - Primary source (highest quality)
2. **OpenLibrary** - Fallback (good coverage)
3. **Google Books** - Fallback (API key required)

### Queue Processing

**Configuration**:
- Batch size: 5 covers
- Concurrency: 3 parallel workers
- Retry: 3 attempts
- Timeout: 60s

**Process**:
1. Check if cover exists in R2 (skip if found)
2. Fetch cover from provider URL
3. Process with jSquash (WebP compression)
4. Generate 3 sizes (large, medium, small)
5. Upload to R2
6. Update `enriched_editions` table with URLs
7. Log to Analytics Engine

---

## Author Enrichment

### Overview

Author enrichment adds biographical data, diversity information, and bibliographies from **Wikidata** and **ISBNdb**.

### Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| Total Authors | 14,717,121 | 100% |
| With Wikidata ID | 174,427 | 1.2% |
| Wikidata Enriched | 73,583 | 0.5% |
| Pending Enrichment | 100,844 | 0.7% |
| With Biography | 28,307 | 0.19% |
| With Gender | 71,593 | 0.49% |
| With Nationality | 63,027 | 0.43% |
| With Birth Year | 646,312 | 4.4% |

### Endpoints

#### Get Enrichment Status

```bash
curl https://alexandria.ooheynerds.com/api/authors/enrich-status
```

**Response**:
```json
{
  "total_authors": 14717121,
  "has_wikidata_id": 174427,
  "wikidata_enriched": 73583,
  "pending_enrichment": 100844,
  "diversity_fields": {
    "has_gender": 71593,
    "has_nationality": 63027,
    "has_birth_place": 58407
  }
}
```

#### Enrich from Wikidata

**Trigger**: Manual batch enrichment

```bash
curl -X POST https://alexandria.ooheynerds.com/api/authors/enrich-wikidata \
  -H "Content-Type: application/json" \
  -d '{
    "batch_size": 100,
    "priority": "has_wikidata_id"
  }'
```

#### Expand Bibliography (ISBNdb)

**Purpose**: Fetch complete author bibliography from ISBNdb

```bash
curl -X POST https://alexandria.ooheynerds.com/api/authors/enrich-bibliography \
  -H "Content-Type: application/json" \
  -d '{
    "author_name": "J. K. Rowling",
    "max_results": 1000
  }'
```

**Response**:
```json
{
  "success": true,
  "author": "J. K. Rowling",
  "books_found": 487,
  "new_books": 23,
  "already_in_db": 464,
  "quota_used": 1
}
```

#### Resolve Identifier (VIAF/ISNI → Wikidata)

**Purpose**: Cross-reference identifiers

```bash
curl -X POST https://alexandria.ooheynerds.com/api/authors/resolve-identifier \
  -H "Content-Type: application/json" \
  -d '{
    "identifier_type": "viaf",
    "identifier_value": "113230702"
  }'
```

**Response**:
```json
{
  "success": true,
  "wikidata_id": "Q34660",
  "name": "J. K. Rowling",
  "aliases": ["Joanne Rowling", "JK Rowling"]
}
```

### Trigger Strategy

**Author enrichment is manual by design**. To automate:

1. **Cron Job**: Schedule periodic Wikidata enrichment
2. **On-demand**: Trigger when user views author page
3. **Batch**: Process top N authors by book count

---

## Quota Management

### ISBNdb Quota System

**Plan**: Premium ($29.95/mo)
- **Daily limit**: 15,000 calls
- **Safety limit**: 13,000 calls (buffer: 2,000)
- **Batch size**: 1000 ISBNs per call
- **Rate limit**: 3 req/sec
- **Reset**: Midnight UTC daily
- **Rollover**: NO - unused quota lost

### Centralized Tracking

**Implementation**: `src/services/quota-manager.ts`

```typescript
const quotaManager = new QuotaManager(env.QUOTA_KV);

// Check before API call
const canProceed = await quotaManager.checkAndReserve(1);
if (!canProceed) {
  throw new Error('Quota exceeded');
}

// Record after API call
await quotaManager.recordUsage(1, true); // success
```

**Storage**: Cloudflare KV namespace `QUOTA_KV`
- Key: `isbndb:quota:YYYY-MM-DD`
- Value: `{ used: number, limit: number, updated_at: string }`

### Fail-Closed Behavior

**On KV errors**: System fails closed (rejects requests) to prevent quota overruns

### Protected Endpoints

All ISBNdb-calling endpoints enforce quota:
- `POST /api/enrich/batch-direct`
- `POST /api/harvest/backfill`
- `POST /api/authors/enrich-bibliography`
- Internal queue handlers

---

## Examples & Usage

### Example 1: Enrich a Single ISBN

```bash
# Search triggers auto-enrichment if not cached
curl "https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873"
```

### Example 2: Batch Enrich 100 ISBNs

```bash
curl -X POST https://alexandria.ooheynerds.com/api/enrich/batch-direct \
  -H "Content-Type: application/json" \
  -d '{
    "isbns": [
      "9780439064873", "9780439136365", ...
    ],
    "priority": "high"
  }'
```

### Example 3: Backfill December 2024

```bash
# Trigger backfill
curl -X POST https://alexandria.ooheynerds.com/api/harvest/backfill \
  -H "Content-Type: application/json" \
  -d '{"year": 2024, "month": 12, "batch_size": 50}'

# Check status
curl https://alexandria.ooheynerds.com/api/harvest/backfill/status
```

### Example 4: Download Author Bibliography

```bash
curl -X POST https://alexandria.ooheynerds.com/api/authors/enrich-bibliography \
  -H "Content-Type: application/json" \
  -d '{
    "author_name": "Stephen King",
    "max_results": 500
  }'
```

### Example 5: Monitor Queue Health

```bash
# Check Worker health
curl https://alexandria.ooheynerds.com/health

# Check quota
curl https://alexandria.ooheynerds.com/api/quota/status

# Check queue status (CLI)
npx wrangler queues list
```

---

## Troubleshooting

### Queue Not Processing

**Check consumers**:
```bash
npx wrangler queues list
```

**Check Worker logs**:
```bash
npx wrangler tail
```

**Check dead letter queues**:
```bash
npx wrangler queues list | grep dlq
```

### Quota Issues

**Check current quota**:
```bash
curl https://alexandria.ooheynerds.com/api/quota/status
```

**Reset quota** (if stuck):
```sql
-- Clear KV entry for today
DELETE FROM kv_storage WHERE key LIKE 'isbndb:quota:%';
```

### Cover Processing Failures

**Check R2 bucket**:
```bash
npx wrangler r2 object get bookstrack-covers-processed/isbn/9780439064873/large.webp
```

**Check enrichment_log**:
```sql
SELECT * FROM enrichment_log
WHERE operation LIKE '%cover%'
ORDER BY created_at DESC
LIMIT 10;
```

### Backfill Stuck

**Check job status**:
```bash
curl https://alexandria.ooheynerds.com/api/harvest/backfill/status/:jobId
```

**Check queue**:
```bash
npx wrangler queues list | grep backfill
```

---

## Performance Metrics

### Current Performance (7 Days)

| Metric | Value |
|--------|-------|
| Total Operations | 3,282 |
| Success Rate | 100% |
| Edition Creates | 2,110 |
| Edition Updates | 79 |
| Work Creates | 1,093 |
| Covers Added | 12,896 |
| Books Backfilled | 340 |
| ISBNdb Quota Used | 2,066 / 15,000 (13.8%) |

### Response Times

| Endpoint | Avg Response | P95 |
|----------|-------------|-----|
| Health Check | 64-179ms | <200ms |
| ISBN Search (cached) | 5ms | <10ms |
| ISBN Search (uncached) | 300ms | <500ms |
| Title Search | 345ms | <400ms |
| Author Search | 371ms | <400ms |

---

## References

- **API Documentation**: https://alexandria.ooheynerds.com/openapi.json
- **Cloudflare Queues Docs**: https://developers.cloudflare.com/queues/
- **ISBNdb API Docs**: https://isbndb.com/apidocs
- **Wikidata API**: https://www.wikidata.org/wiki/Wikidata:Data_access

---

**Document Version**: 1.0
**Last Reviewed**: 2026-01-08
**Next Review**: 2026-02-08
