# Image Processing Pipeline - Implementation Plan

**Issue**: #12 (Implement Image Processing Pipeline)
**Created**: 2025-11-30
**Status**: Planned

---

## Architecture Overview

```
                    ARCHITECTURE OVERVIEW
+------------------+     +------------------+     +------------------+
|    ISBNdb API    | --> |  Image Processor | --> |   R2 Storage     |
|  (cover source)  |     |  (download/resize)|    | (alexandria-covers)|
+------------------+     +------------------+     +------------------+
        |                        |                        |
        v                        v                        v
+------------------+     +------------------+     +------------------+
|  Google Books    |     |   Worker Routes  | <-- |  CDN Serving     |
|   (fallback)     |     |  /covers/:isbn/* |     | (cache headers)  |
+------------------+     +------------------+     +------------------+
```

---

## Phase 1: Infrastructure Setup [Low Complexity]

**Tasks:**
1. Create R2 bucket:
   ```bash
   npx wrangler r2 bucket create alexandria-covers
   ```

2. Add to `wrangler.toml`:
   ```toml
   [[r2_buckets]]
   binding = "COVER_IMAGES"
   bucket_name = "alexandria-covers"
   ```

3. Add ISBNdb secret:
   ```bash
   npx wrangler secret put ISBNDB_API_KEY
   ```

**Dependencies:** None

---

## Phase 2: ISBNdb Cover Fetcher [Medium Complexity]

**New file:** `worker/services/isbndb-covers.js`

**Functions:**
- `fetchISBNdbCover(isbn, env)` - Primary source
- `fetchGoogleBooksCover(isbn)` - Fallback #1
- `fetchOpenLibraryCover(isbn)` - Fallback #2
- `fetchBestCover(isbn, env)` - Orchestrates fallback chain

**ISBNdb API Details:**
- Endpoint: `GET https://api2.isbndb.com/book/{isbn}`
- Header: `Authorization: {ISBNDB_API_KEY}`
- Response: `{ book: { image: "https://..." } }`
- Rate limit: 1 request/second

**Rate limiting:** 1 request/second via KV timestamp

**Error handling:**
- 404: Book not found -> try fallback
- 429: Rate limited -> wait and retry once
- 5xx: Server error -> try fallback

**Dependencies:** Phase 1

---

## Phase 3: Image Processor [High Complexity]

**New file:** `worker/services/image-processor.js`

**Pipeline:**
```
Download --> Validate --> Hash --> Store Original --> Resize --> Store Sizes
   |            |          |           |                |           |
   v            v          v           v                v           v
 5s timeout  image/*    SHA-256    R2 put         3 sizes      R2 put
             <10MB     dedup key   +metadata     512/256/128   per size
```

**Size Definitions:**
```javascript
const SIZES = {
  large:  { width: 512, height: 768 },
  medium: { width: 256, height: 384 },
  small:  { width: 128, height: 192 }
};
```

**Security - Allowed Domains:**
```javascript
const ALLOWED_DOMAINS = new Set([
  'books.google.com',
  'covers.openlibrary.org',
  'images.isbndb.com',
  'images-na.ssl-images-amazon.com'
]);
```

**Dependencies:** Phase 1-2

---

## Phase 4: Cover Serving Endpoints [Medium Complexity]

**Routes to add in** `worker/index.js`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/covers/:isbn/:size` | Serve image from R2 |
| GET | `/covers/:isbn/status` | Check if cover exists |
| POST | `/covers/:isbn/process` | Trigger processing |
| POST | `/covers/batch` | Process up to 10 ISBNs |

**Caching:** `Cache-Control: public, max-age=31536000, immutable`

**Placeholder fallback:** `https://placehold.co/300x450/e0e0e0/666666?text=No+Cover`

**Dependencies:** Phase 1-3

---

## Phase 5: Queue Integration [Medium Complexity]

**Ties to Issue #13 (Background Queue Consumer)**

**Database additions:**
```sql
ALTER TABLE enrichment_log ADD COLUMN cover_status TEXT;
ALTER TABLE enrichment_log ADD COLUMN cover_url TEXT;
ALTER TABLE enrichment_log ADD COLUMN cover_source TEXT;
```

**Queue Job Structure:**
```javascript
{
  type: 'process_cover',
  isbn: '9780439064873',
  priority: 'low',
  createdAt: '2025-11-30T...',
  attempts: 0,
  maxAttempts: 3
}
```

**Optional cron (wrangler.toml):**
```toml
[triggers]
crons = ["0 * * * *"]  # Every hour, process pending covers
```

**Dependencies:** Phase 1-4, Issue #13

---

## R2 Bucket Structure

```
alexandria-covers/
└── isbn/
    └── {isbn13}/
        ├── original.webp   (~100-200KB)
        ├── large.webp      (512x768, ~50KB)
        ├── medium.webp     (256x384, ~15KB)
        └── small.webp      (128x192, ~5KB)
```

---

## URL Structure

```
GET  /covers/9780439064873/small    -> 128x192 WebP
GET  /covers/9780439064873/medium   -> 256x384 WebP
GET  /covers/9780439064873/large    -> 512x768 WebP
GET  /covers/9780439064873/original -> Full size WebP
GET  /covers/9780439064873/status   -> JSON metadata
POST /covers/9780439064873/process  -> Trigger processing
POST /covers/batch                  -> Process multiple ISBNs
```

---

## Decision Needed: Image Resizing

| Option | Pros | Cons |
|--------|------|------|
| CF Image Resizing | Native, fast | $9/mo add-on |
| Store original only | Simplest | Larger downloads |
| Pre-resize externally | No extra cost | More complex |

---

## Files Summary

| File | Action |
|------|--------|
| `worker/wrangler.toml` | Add R2 binding |
| `worker/services/isbndb-covers.js` | NEW |
| `worker/services/image-processor.js` | NEW |
| `worker/index.js` | Add cover routes |

---

## Storage Estimates

| Size | Dimensions | Avg Size | Per 1M ISBNs |
|------|------------|----------|--------------|
| original | varies | 150KB | 150GB |
| large | 512x768 | 50KB | 50GB |
| medium | 256x384 | 15KB | 15GB |
| small | 128x192 | 5KB | 5GB |
| **Total** | | **220KB** | **220GB (~$3.30/mo)** |

---

## Reference

- Source guide: `COVER_IMAGE_PORTING_GUIDE.md`
- bendv3 patterns ported from: harvest-covers.ts, image-proxy.ts, edition-discovery.js
