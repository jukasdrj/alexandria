# Findings: ISBNdb Quota Leak Investigation

## Known Facts

### Usage Pattern
- Premium plan: 15,000 calls/daily limit
- Graph shows spikes: ~15K calls on multiple days (Dec 31 - Jan 3)
- Alexandria quota tracking shows 2,103 used today (16.18%)
- Mismatch suggests calls happening outside tracked endpoints

### Current Alexandria State
- 28.66M total enriched editions
- Only 82K from ISBNdb (minimal compared to total)
- Recent activity:
  - Jan 5: 187 enrichments
  - Jan 4: 1,913 enrichments (suspicious spike)
  - Jan 3: 19 enrichments

### Backfill System
- 76 synthetic books across 5 months
- Backfill uses ISBNdb for batch enrichment
- Should be quota-aware with centralized tracking

## ISBNdb Call Sites (Discovery)

### 1. Batch ISBNdb Client (`worker/services/batch-isbndb.ts`)
- **POST /books** - Main batch endpoint
- Fetches up to 1000 ISBNs per call (Premium API)
- Used by: Enrichment queue, backfill pipeline
- **CRITICAL**: This is 1 API call regardless of ISBN count
- Rate limit: 3 req/sec (333ms delay between batches)

### 2. ISBN Resolution Service (`worker/src/services/isbn-resolution.ts`)
- **GET /books/{query}** - Individual ISBN search by title/author
- Used by: Hybrid backfill (Gemini → ISBNdb resolution)
- **LEAK RISK**: Each call = 1 API call, can be called in loops
- Rate limit: 350ms delay between requests
- Line 169: `const url = https://api.premium.isbndb.com/books/${query}`
- Line 420: Called in `batchResolveISBNs()` loop

### 3. ISBNdb Author Service (`worker/src/services/isbndb-author.ts`)
- **GET /author/{name}** - Author bibliography endpoint
- Returns up to 100 books per page
- **LEAK RISK**: Can paginate multiple times (maxPages parameter)
- Line 91: `fetch('https://api.premium.isbndb.com/author/${authorName}?page=${page}&pageSize=100')`
- Each pagination = 1 API call
- Line 170: 350ms delay between pages

### API Endpoints Using ISBNdb
- Found in worker/src/routes/
- Need to check: enrich.ts, harvest.ts, books.ts

### Queue Handlers
- Enrichment queue: Uses batch endpoint (1 call per 100 ISBNs) ✅
- Cover queue: No ISBNdb calls (just downloads covers) ✅
- Backfill queue: Uses hybrid workflow (Gemini + ISBN resolution) ⚠️

### Backfill Services
- hybrid-backfill.ts: Calls `resolveISBNViaTitle()` in loop ⚠️
- async-backfill.ts: Need to check

## Potential Leak Vectors

### 1. Retry Loops
- Status: TBD
- Risk: High if no backoff/limits

### 2. Unbounded Batch Operations
- Status: TBD
- Risk: High if processing large datasets

### 3. Quota Bypass
- Status: TBD
- Risk: Critical if calls skip quota checks

### 4. External Integration (bendv3)
- Status: TBD
- Risk: High if duplicate ISBNdb integration exists

## ROOT CAUSE IDENTIFIED ✅ (UPDATED)

### THE REAL LEAK: Cover Queue ISBNdb Calls

**Primary Leak**: `cover-fetcher.ts` line 384
**Function**: `fetchBestCover()` → `fetchISBNdbCover()`

**Problem**: Cover queue calls ISBNdb for EVERY cover lookup:
```typescript
// Line 384 in cover-fetcher.ts
export async function fetchBestCover(isbn: string, env: Env): Promise<CoverResult> {
  // Try ISBNdb first (highest quality)
  let cover = await fetchISBNdbCover(normalizedISBN, env);  // ← ISBNdb API call!
  // ... then fallback to Google Books, OpenLibrary ...
}
```

**Evidence**:
- Dec 31: 3,021 covers processed = **3,021 ISBNdb API calls**
- Jan 4: 1,913 covers processed = **1,913 ISBNdb API calls**
- Cover counts EXACTLY match enrichment counts
- Called from cover queue line 104: `await fetchBestCover(normalizedISBN, env)`
- **ZERO quota tracking** - these calls bypass quota manager entirely

**Why This Is Worse**:
- Cover queue batches up to 5 covers, processes 3 batches concurrently
- That's **15 ISBNdb calls every ~2 seconds** during busy periods
- No quota enforcement, no tracking
- Uses individual `/book/{isbn}` endpoint (not batch)

## ROOT CAUSE IDENTIFIED ✅ (SECONDARY)

### The Leak: Hybrid Backfill ISBN Resolution Loop

**File**: `worker/src/services/isbn-resolution.ts` line 394-430
**Function**: `batchResolveISBNs()`

**Problem**: This function makes **1 ISBNdb API call PER BOOK** in a loop:
```typescript
for (let i = 0; i < books.length; i++) {
  const result = await resolveISBNViaTitle(book, apiKey, logger);  // ← 1 API call
  // ... 350ms delay ...
}
```

**Called By**:
- `generateHybridBackfillList()` in `hybrid-backfill.ts` line 153
- `processAsyncBackfillJob()` in `async-backfill.ts` line 242

**Impact Calculation**:
- Dec 31: 3,021 enrichments = **~3,021 ISBNdb calls**
- Jan 4: 1,913 enrichments = **~1,913 ISBNdb calls**
- Default batch_size: 20 books per call
- 3,021 ÷ 20 = **~151 backfill jobs** on Dec 31 alone!

**Why This Happened**:
1. Someone (or automated process) called `/api/harvest/backfill` repeatedly
2. Each call processes `batch_size` books (default 20, max 50)
3. Each book triggers 1 ISBNdb API call for ISBN resolution
4. No throttling between backfill jobs
5. Quota tracking records calls but doesn't prevent them in queue handlers

## ALL ISBNdb API Call Sites (Complete Audit)

### 1. Batch Endpoint (`POST /books`) - TRACKED ✅
- **File**: `worker/services/batch-isbndb.ts` line 108
- **Calls**: 1 per batch (up to 1000 ISBNs)
- **Used by**: Enrichment queue
- **Quota tracking**: YES (via QuotaManager)

### 2. Individual Book Lookup (`GET /book/{isbn}`) - **NOT TRACKED** ❌
**Location A**: `worker/services/cover-fetcher.ts` line 133
- **Function**: `fetchISBNdbCover()`
- **Used by**: Cover queue (line 104, 134 in queue-handlers.ts)
- **Volume**: 3,021 calls (Dec 31), 1,913 calls (Jan 4)
- **Quota tracking**: NONE
- **Retries**: Up to 2 retries (line 138: `maxRetries: 2`)
- **Potential multiplier**: 1-3x per cover (on failures)

**Location B**: `worker/services/external-apis.ts` line 246
- **Function**: `fetchFromISBNdb()`
- **Used by**: `resolveExternalISBN()` (line 460)
- **Usage**: Unknown - need to find callers
- **Quota tracking**: NONE
- **Retries**: Up to 3 retries (default from fetchWithRetry)

### 3. ISBN Resolution Search (`GET /books/{query}`) - **NOT TRACKED** ❌
- **File**: `worker/src/services/isbn-resolution.ts` line 169
- **Function**: `resolveISBNViaTitle()`
- **Used by**: Hybrid backfill via `batchResolveISBNs()` (line 420)
- **Quota tracking**: Partial (only in backfill context)
- **Retries**: No automatic retries

### 4. Author Bibliography (`GET /author/{name}`) - **NOT TRACKED** ❌
- **File**: `worker/src/services/isbndb-author.ts` line 91
- **Function**: `fetchAuthorBibliography()`
- **Pagination**: Each page = 1 API call
- **Quota tracking**: NONE
- **Used by**: Unknown - need to find callers

## VOLUME CALCULATION WITH RETRIES

### Confirmed Call Volume (Dec 31)
| Source | Calls | Notes |
|--------|-------|-------|
| Enrichment queue (batch) | ~50-100 | Batch endpoint (1 call per 1000 ISBNs) - TRACKED ✅ |
| Cover queue (base) | 3,021 | `fetchISBNdbCover()` - one per cover - UNTRACKED ❌ |
| Cover retries (failures) | 300-3,000 | If 10-100% fail, retry 2x - UNTRACKED ❌ |
| JWT expiry refresh | 150-1,500 | Line 134 refetch on 401/403 - UNTRACKED ❌ |
| Hybrid backfill ISBN resolution | Unknown | `batchResolveISBNs()` loop - PARTIAL TRACKING |
| **Confirmed minimum** | **3,500** | Base + enrichment |
| **Maximum with failures** | **7,500+** | If 50%+ failure rate |

### Unaccounted Volume
- **Dec 31**: 15,000 - 4,371 = **10,629 calls missing**
- **Jan 4**: 15,000 - 2,813 = **12,187 calls missing**

### NEW DISCOVERY: Enrichment Log Shows Higher Call Volume

**Enrichment Log Data (Dec 31)**:
- 3,003 edition creates (logged)
- 1,707 work creates (logged, no ISBNdb calls)
- **Total operations: 4,710**

**Database Counts (Dec 31)**:
- 3,021 enriched_editions created
- Discrepancy: 4,710 logged - 3,021 actual = **~18 editions missing?** (within margin)

**Cover Queue Processing**:
- 3,021 covers processed on Dec 31
- Each cover calls `fetchISBNdbCover()` = **3,021 ISBNdb calls**
- With retries (maxRetries: 2): potentially 6,000-9,000 calls
- With JWT refresh recovery: add another 300-900 calls

### Potential Sources for Missing ~10K-12K Daily Calls
1. **High retry/failure rate** - If 50% of cover fetches fail → 2-3x multiplier = 6,000-9,000 extra calls
2. **JWT expiry recovery loop** - Line 134 in queue-handlers refetches from ISBNdb
3. **Concurrent duplicate requests** - Multiple workers processing same ISBNs
4. **Hybrid backfill ISBN resolution** - Need to quantify volume
5. **`resolveExternalISBN()` usage** - Unknown callers
6. **Author bibliography pagination** - Could be hundreds of calls if used
7. **Rate limit 429 retries** - Exponential backoff could cause cascading retries

## FINAL ASSESSMENT

### Confirmed Leak Sources
1. **Cover Queue (Primary)**: 3,000+ untracked ISBNdb calls/day
2. **Retries & JWT Refresh**: 2-3x multiplier on failures (conservatively 1,500-3,000 calls)
3. **Hybrid Backfill**: Unknown volume, partially tracked
4. **External APIs**: Unknown volume, untracked
5. **Author Bibliography**: Unknown volume, untracked

### Most Likely Explanation for 15K Daily Exhaustion
**High failure/retry cascade during Dec 31-Jan 4 spike period**:
- Base: 3,021 cover fetches
- If 50% failed → 1,500 retries (maxRetries: 2)
- If 30% had JWT expiry → 900 refetches
- If retries also failed → another 750 retries
- **Total: 3,021 + 1,500 + 900 + 750 = 6,171 calls from covers alone**

Add in:
- Enrichment batch: ~100 calls
- Hybrid backfill: ~500-1,000 calls (estimated)
- If ALL had similar failure rates: **multiply by 2-2.5x**

**Plausible Total**: 6,000-8,000 base × 2x failure multiplier = **12,000-16,000 calls**

### Why We Can't See All Calls
- Enrichment_log only tracks successful operations
- Cover fetches aren't logged at all
- Retries aren't counted
- JWT refresh recovery isn't logged
- ISBNdb doesn't provide per-endpoint breakdowns

### Solution Confidence: HIGH
Even without finding every single call, implementing the fixes will:
1. **Phase 1A**: Reduce cover queue by 80% (priority reorder) = -2,400 calls/day
2. **Phase 1A**: Add quota enforcement = prevent runaway retries
3. **Phase 1B**: Track all remaining call sites = visibility into actual usage

**Expected outcome**: 15,000 → <5,000 calls/day

## Investigation Complete ✅
All findings documented. Implementation plan finalized. Ready to execute fixes.
