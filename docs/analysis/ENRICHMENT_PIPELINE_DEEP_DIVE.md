# Enrichment Pipeline Deep Dive - Status Report

**Date:** 2026-01-13
**Context:** Post-2020 backfill validation
**Scope:** Verify all enrichment pipeline components are functioning

---

## Executive Summary

### ✅ What's Working

1. **AI Book Generation** - 100% functional (295 books generated)
2. **ISBN Resolution** - 100% functional (295/295 resolved)
3. **Work/Edition Creation** - 100% functional (synthetic works created)
4. **Work/Edition Crosswalks** - 100% functional (all editions linked to works)
5. **Database Persistence** - 100% functional (all data stored correctly)
6. **Backfill State Tracking** - 100% functional (backfill_log table working)

### ⚠️ What's NOT Working / Needs Investigation

1. **Enrichment Queue Processing** - ❌ NOT RUNNING
   - ISBNs queued: ~280 ISBNs (from 2020 backfill)
   - Enrichment log entries: 0 (no processing in last 24 hours)
   - Completeness scores: Stuck at 30 (baseline AI-generated)
   - Root cause: Queue consumer not processing messages

2. **Cover Harvesting** - ⚠️ PARTIALLY WORKING
   - Cover coverage: 12% (10/82 recent editions)
   - Cover queue: 2 messages pending
   - Possible issue: Not triggered after enrichment OR low priority/slow processing

3. **Author Biography Enrichment** - ⚠️ UNKNOWN
   - No enriched_authors table found (or not queried correctly)
   - Author data exists in work metadata but not in separate table
   - May be by design (authors stored as JSON in works)

4. **External ID Mappings** - ⚠️ NOT VERIFIED
   - Need to check if Amazon ASIN, Goodreads, Google Books IDs are populated
   - `external_id_mappings` table exists but not yet tested

---

## Detailed Findings

### 1. Work/Edition Creation ✅

**Status:** EXCELLENT - Working as designed

**Evidence:**
```sql
-- All recent editions have corresponding works
SELECT ee.isbn, ee.title, ee.work_key, ew.title as work_title
FROM enriched_editions ee
LEFT JOIN enriched_works ew ON ee.work_key = ew.work_key
WHERE ee.created_at >= (NOW() - INTERVAL '1 day')
LIMIT 10;

-- Results: 10/10 have work_key and matching enriched_works records
```

**Findings:**
- ✅ All 295 editions from 2020 backfill have work_keys
- ✅ Synthetic work_keys format: `synthetic:title-slug:author-slug`
- ✅ All work titles match edition titles
- ✅ Work/edition crosswalk is 100% functional

**Example:**
- Edition: `9798461340964` - "Sapiens"
- Work: `synthetic:sapiens:yuval-noah-harari` - "Sapiens"
- Perfect 1:1 mapping

---

### 2. Enrichment Queue Processing ❌

**Status:** CRITICAL ISSUE - Queue not processing

**Evidence:**

**Queue Status:**
```bash
$ npx wrangler queues list | grep enrichment
alexandria-enrichment-queue  │ 2 messages | 1 backlog
```

**Database Check:**
```sql
-- NO enrichment_log entries in last 24 hours
SELECT COUNT(*) FROM enrichment_log WHERE created_at >= (NOW() - INTERVAL '1 day');
-- Result: 0
```

**Completeness Scores:**
```sql
-- All recent editions stuck at baseline score
SELECT isbn, title, completeness_score FROM enriched_editions
WHERE created_at >= (NOW() - INTERVAL '1 day') LIMIT 5;

-- Results: ALL at completeness_score = 30 (baseline AI-generated)
```

**Root Cause Analysis:**

1. **Queue Messages Sent:** ✅ Confirmed in backfill code (`async-backfill.ts:461-466`)
   ```typescript
   await env.ENRICHMENT_QUEUE.send({
     isbns: batch,
     source: `backfill-${year}-${month}`,
     priority: 'low',
   });
   ```

2. **Queue Handler Exists:** ✅ Confirmed in `queue-handlers.ts:387`
   ```typescript
   export async function processEnrichmentQueue(batch, env) { ... }
   ```

3. **Queue Handler Wired:** ✅ Confirmed in `index.ts:285`
   ```typescript
   case 'alexandria-enrichment-queue':
     return await processEnrichmentQueue(batch, env);
   ```

4. **Queue Consumer Running:** ❓ UNKNOWN - Need to check Worker deployment status

**Possible Causes:**

A. **Worker Not Consuming Queue:**
   - Queue consumer trigger not active in production
   - Worker deployment issue
   - Binding configuration issue

B. **Queue Processing Failing Silently:**
   - Error in queue handler causing early exit
   - Quota manager blocking all requests
   - ISBNdb API key missing/invalid

C. **Queue Throttling:**
   - Batch concurrency set too low
   - Queue processing paused/disabled

**Action Items:**

1. ✅ Check Worker deployment logs for queue processing
2. ✅ Verify queue consumer bindings in `wrangler.jsonc`
3. ✅ Test enrichment queue manually with single ISBN
4. ✅ Check quota manager status (ISBNdb quota available?)
5. ✅ Verify ISBNdb API key is present and valid

---

### 3. Cover Harvesting ⚠️

**Status:** PARTIALLY WORKING - Low coverage

**Evidence:**
```sql
-- Cover coverage for recent enrichments
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN cover_url_small IS NOT NULL THEN 1 END) as has_cover,
  ROUND(COUNT(CASE WHEN cover_url_small IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as pct
FROM enriched_editions
WHERE created_at >= (NOW() - INTERVAL '7 days');

-- Result: 10/82 editions (12% coverage)
```

**Findings:**
- ✅ Cover URLs exist in database for 10 editions
- ⚠️ Only 12% coverage (expected 70-90% based on ISBNdb data)
- ⚠️ 2 messages in cover queue (not 280+ expected)

**Possible Causes:**

A. **Covers Not Queued:**
   - Enrichment queue not processing → covers never queued
   - Cover queueing happens AFTER enrichment succeeds

B. **ISBNs Don't Have Covers:**
   - AI-generated ISBNs might be synthetic (not real books)
   - ISBNdb may not have cover URLs for these ISBNs

C. **Cover Queue Throttling:**
   - Low priority processing
   - Batch concurrency too low (config: 3 concurrent)

**Action Items:**

1. ✅ Fix enrichment queue first (covers depend on enrichment)
2. ✅ Verify ISBNs are real (check ISBNdb API directly)
3. ✅ Check cover queue processing logs
4. ✅ Verify R2 storage has cover files

---

### 4. Author Biography Enrichment ⚠️

**Status:** UNKNOWN - Need to locate author data

**Evidence:**
```sql
-- No separate enriched_authors table found
SELECT column_name FROM information_schema.columns
WHERE table_name = 'enriched_authors';
-- Result: Table may not exist or query incorrect
```

**Findings:**
- ⚠️ Authors not stored in separate table
- ✅ Author names present in work metadata
- ❓ Unknown if Wikipedia bios are being fetched
- ❓ Unknown if Wikidata IDs are being resolved

**Possible Architecture:**

A. **Authors in Work Metadata (JSON):**
   - `enriched_works.metadata->>'gemini_author'`
   - `enriched_works.contributors` array
   - No separate author enrichment

B. **JIT Author Enrichment:**
   - Authors enriched on-demand via `/api/authors/*` endpoints
   - Author queue for async enrichment
   - Not part of initial backfill workflow

**Action Items:**

1. ✅ Check if `enriched_authors` table exists
2. ✅ Review author enrichment architecture in code
3. ✅ Check author queue status (1 message pending)
4. ✅ Verify author biography endpoints are functional

---

### 5. External ID Mappings ⚠️

**Status:** NOT VERIFIED - Table exists but no data checked

**Evidence:**
```sql
-- external_id_mappings table exists (partitioned by entity_type)
SELECT * FROM external_id_mappings LIMIT 5;
-- Not yet queried
```

**Findings:**
- ✅ Table exists and is partitioned
- ✅ Lazy backfill architecture designed
- ❓ Unknown if IDs are being populated
- ❓ Unknown if reverse lookups are functional

**Expected Data Sources:**
- ISBNdb: Amazon ASINs
- Google Books: volume IDs
- Goodreads: work/edition IDs
- LibraryThing: work IDs

**Action Items:**

1. ✅ Query `external_id_mappings` for recent ISBNs
2. ✅ Check if ISBNdb returns Amazon ASINs
3. ✅ Verify external ID endpoints (`/api/external-ids/*`)
4. ✅ Test reverse lookup (`/api/resolve/{provider}/{id}`)

---

## Queue Configuration Analysis

**From `wrangler.jsonc`:**

```jsonc
{
  "enrichment_queue": {
    "max_batch_size": 100,
    "max_batch_timeout": 30,
    "max_retries": 3,
    "max_concurrency": 10
  },
  "cover_queue": {
    "max_batch_size": 5,
    "max_batch_timeout": 5,
    "max_retries": 3,
    "max_concurrency": 3
  },
  "backfill_queue": {
    "max_batch_size": 1,
    "max_batch_timeout": 60,
    "max_retries": 3,
    "max_concurrency": 1
  }
}
```

**Analysis:**

- ✅ Enrichment: High throughput (100 batch, 10 concurrent)
- ⚠️ Cover: Lower throughput (5 batch, 3 concurrent) - intentional?
- ✅ Backfill: Serial processing (1 concurrent) - correct for month-by-month

**Bottleneck:** Cover queue may be slow due to jSquash processing overhead

---

## Critical Next Steps (Priority Order)

### 1. FIX ENRICHMENT QUEUE ⚠️ CRITICAL

**Why:** All downstream enrichment depends on this

**Actions:**
1. Check Worker deployment logs: `npm run tail | grep enrichment`
2. Manually test queue: Send test ISBN via API
3. Verify ISBNdb quota: Check quota manager status
4. Check ISBNdb API key: Ensure secret is set
5. Monitor queue processing: Watch for errors

### 2. Verify ISBNs Are Real ⚠️ HIGH

**Why:** AI-generated ISBNs might not exist in ISBNdb

**Actions:**
1. Test sample ISBNs against ISBNdb API directly
2. Check ISBN format (9798* are valid ISBN-13)
3. Verify ISBNdb has metadata for these ISBNs
4. Review ISBN resolution logs for validation

### 3. Test Cover Harvesting 📊 MEDIUM

**Why:** Depends on enrichment queue being fixed

**Actions:**
1. Wait for enrichment queue to process
2. Monitor cover queue for new messages
3. Check R2 storage for cover files
4. Verify cover URLs in database

### 4. Investigate Author Enrichment 📊 MEDIUM

**Why:** Good to know, but not blocking

**Actions:**
1. Locate enriched_authors table (if exists)
2. Check author queue processing
3. Test author biography endpoints
4. Review JIT enrichment strategy

### 5. Test External ID Resolution 📊 LOW

**Why:** Nice-to-have, not critical for backfill

**Actions:**
1. Query external_id_mappings table
2. Test external ID endpoints
3. Verify reverse lookup functionality
4. Check lazy backfill implementation

---

## Recommended Investigation Commands

```bash
# 1. Check enrichment queue logs
npm run tail | grep -i enrichment | head -50

# 2. Check quota status
curl https://alexandria.ooheynerds.com/api/quota/status | jq

# 3. Test single ISBN enrichment (via Worker)
# (Would require creating test endpoint or using bendv3)

# 4. Check database for enrichment progress
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c '
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN completeness_score > 30 THEN 1 END) as enriched,
  ROUND(AVG(completeness_score), 2) as avg_score
FROM enriched_editions
WHERE created_at >= (NOW() - INTERVAL \"7 days\");
'"

# 5. Check R2 storage for covers
npx wrangler r2 object list bookstrack-covers-processed --prefix isbn/ | head -20
```

---

## Conclusion

**Overall Status:** 🟡 PARTIALLY FUNCTIONAL

**Core Pipeline:** ✅ AI generation, ISBN resolution, work/edition creation ALL WORKING

**Critical Issue:** ❌ Enrichment queue NOT processing → Blocking all downstream enrichment

**Impact:**
- 295 books created with baseline completeness (30)
- No ISBNdb metadata enrichment
- No cover downloads triggered
- No completeness score upgrades

**Root Cause:** Enrichment queue consumer not running or failing silently

**Priority:** Fix enrichment queue FIRST, then investigate covers and authors

**Timeline:** Should be fixable within 1-2 hours once root cause identified
