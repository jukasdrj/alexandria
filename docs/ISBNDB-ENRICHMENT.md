# ISBNdb Enrichment Opportunities for Alexandria

Last Updated: 2025-12-28

## Implementation Status

**Status: PARTIALLY IMPLEMENTED**

- **Fetching Layer (`worker/services/external-apis.ts`)**: ✅ Implemented. The `ExternalBookData` interface and `fetchFromISBNdb` function already extract:
    - `image_original` (High quality covers)
    - `subjects` (Genre tags)
    - `deweyDecimal`
    - `binding`
    - `relatedISBNs`

- **Storage Layer**: ⚠️ Pending. Database schema updates (`enriched_editions` table) to store these new fields are needed.
- **API Layer**: ⚠️ Pending. Exposing these fields in the Alexandria API.

---

## Overview

ISBNdb provides rich metadata that goes far beyond basic book information. This document details all enrichment opportunities available through the ISBNdb API and how to leverage them in Alexandria's enrichment system.

## Current Plan: Basic (Paid)

- **Rate Limit:** 1 request/second
- **Batch Size:** Up to 100 ISBNs per request
- **Base URL:** api2.isbndb.com
- **Cost-Effective Strategy:** Use batch endpoint for bulk operations

---

## Available Data Fields from ISBNdb

### Basic Metadata ✅ (Currently Used)

These fields are already integrated in `worker/services/external-apis.ts`:

| Field | Type | Example | Usage |
|-------|------|---------|-------|
| `title` | string | "Harry Potter and the Chamber of Secrets" | Main title |
| `title_long` | string | "Harry Potter and the Chamber of Secrets (Book 2)" | Full title with subtitle |
| `isbn` | string | "0439064872" | ISBN-10 |
| `isbn13` | string | "9780439064873" | ISBN-13 |
| `authors` | string[] | ["J. K. Rowling"] | Author names |
| `publisher` | string | "Scholastic Inc." | Publisher name |
| `date_published` | string | "2000-09-01" | Publication date |
| `pages` | number | 341 | Page count |
| `language` | string | "en" | ISO language code |
| `synopsis` | string | "Description text..." | Book description |

### Cover Images 🎨 (Partially Used - Needs Enhancement)

**Current Implementation:**
```typescript
// worker/services/external-apis.ts (lines 256-260)
coverUrls: book.image ? {
  large: book.image,
  medium: book.image,
  small: book.image,
} : undefined
```

**Available Fields:**

| Field | Type | Example | Quality | Notes |
|-------|------|---------|---------|-------|
| `image` | string | `https://images.isbndb.com/covers/8356973482344.jpg` | Standard | ~300x450px, compressed |
| `image_original` | string | `https://images.isbndb.com/covers/original/8356973482344.jpg?key=JWT_TOKEN` | **HIGH** ⭐ | Original upload, best quality |

**Key Differences:**

1. **image** (Standard):
   - Pre-processed/compressed by ISBNdb
   - Fixed dimensions (~300x450px)
   - No authentication required
   - Suitable for thumbnails

2. **image_original** (High Quality):
   - Original uploaded image
   - Higher resolution (varies by source)
   - Requires JWT token (included in API response)
   - **Best for R2 storage and resizing**
   - Token expires (check `exp` claim)

**Recommendation:** ✅ **Use `image_original` for cover processing**
```typescript
// Proposed enhancement for external-apis.ts
coverUrls: {
  original: book.image_original,  // NEW: Store original for R2 processing
  large: book.image,
  medium: book.image,
  small: book.image,
}
```

### Physical Attributes 📐 (NOT Currently Used - High Value)

**Structured Dimensions:**
```json
{
  "dimensions_structured": {
    "length": { "unit": "inches", "value": 0.81 },
    "width": { "unit": "inches", "value": 8.85 },
    "height": { "unit": "inches", "value": 11.35 },
    "weight": { "unit": "pounds", "value": 2.7116858226 }
  }
}
```

**Use Cases:**
- Shipping cost calculation
- Bookshelf planning apps
- Format comparison (pocket vs standard vs large format)
- Weight-based recommendations

**Also Available:**
- `dimensions` (string): "Height: 11.35 inches, Length: 0.81 inches..."
- `binding`: "Hardcover", "Paperback", "Mass Market Paperback", "Kindle Edition"

### Subject Classification 🏷️ (NOT Currently Used - High Value)

**Structured Subject Tags:**
```json
{
  "subjects": [
    "POTTER, HARRY (FICTITIOUS CHARACTER)_FICTION",
    "CHILDREN'S FICTION",
    "WIZARDS_FICTION",
    "MAGIC_FICTION",
    "SCHOOLS_FICTION",
    "ENGLAND_FICTION",
    "HOGWARTS SCHOOL OF WITCHCRAFT AND WIZARDRY (IMAGINARY ORGANIZATION)_FICTION",
    "FANTASY FICTION"
  ]
}
```

**Use Cases:**
- Genre classification
- Content-based recommendations
- Subject-based search/filtering
- Topic clustering
- Reading list generation

**Also Available:**
- `dewey_decimal`: ["[Fic]", "823/.914"] - Library classification

### Pricing Information 💰 (Available)

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `msrp` | number | 10.99 | Manufacturer's suggested retail price |

**Note:** Pricing is available in **single book lookups** (`GET /book/{isbn}`) but **NOT in batch requests** (`POST /books`).

### Edition Information 📚 (Available)

| Field | Type | Example | Usage |
|-------|------|---------|-------|
| `edition` | string | "1", "2nd", "Special Edition" | Edition identifier |
| `binding` | string | "Hardcover", "Paperback", "Kindle" | Format type |

### Related ISBNs 🔗 (Available)

```json
{
  "related": {
    "ePub": "1492666874",
    "audiobook": "...",
    "hardcover": "..."
  }
}
```

**Use Cases:**
- Format conversion links
- "Also available in..." features
- Edition clustering

---

## Enrichment Strategy

### Priority 1: Cover Image Enhancement (HIGH IMPACT)

**Current State:** Using `image` field (standard quality)

**Recommended Enhancement:**
```typescript
// Update worker/services/external-apis.ts
interface ISBNdbResponse {
  book?: {
    image?: string;
    image_original?: string;  // ADD THIS
    // ... other fields
  };
}

// In fetchFromISBNdb():
coverUrls: book.image_original || book.image ? {
  original: book.image_original,  // NEW: Best for R2 storage
  large: book.image,
  medium: book.image,
  small: book.image,
} : undefined
```

**Impact:**
- Higher quality covers in Alexandria
- Better R2 storage (resize from original)
- Professional appearance
- No additional API cost

**Implementation File:** `worker/services/external-apis.ts:256-260`

---

### Priority 2: Subject Tags (MEDIUM IMPACT)

**Current State:** Not stored

**Recommended Enhancement:**
```typescript
interface ExternalBookData {
  // ... existing fields
  subjects?: string[];         // NEW
  deweyDecimal?: string[];     // NEW
}

// In fetchFromISBNdb():
return {
  // ... existing fields
  subjects: book.subjects,
  deweyDecimal: book.dewey_decimal,
};
```

**Use Cases:**
1. **Genre Classification:**
   ```sql
   -- Query books by subject
   SELECT * FROM enriched_editions
   WHERE 'FANTASY FICTION' = ANY(subjects);
   ```

2. **Content-Based Recommendations:**
   ```typescript
   // Find similar books
   const similarBooks = await findBySimilarSubjects(bookSubjects);
   ```

3. **Search Enhancement:**
   ```typescript
   // Include subjects in search
   WHERE title ILIKE '%query%'
      OR array_to_string(subjects, ' ') ILIKE '%query%'
   ```

**Implementation Files:**
- Type definition: `worker/types.ts`
- Fetching: `worker/services/external-apis.ts`
- Storage: Database schema update (enriched_editions table)

---

### Priority 3: Physical Dimensions (MEDIUM IMPACT)

**Current State:** Not stored

**Recommended Enhancement:**
```typescript
interface ExternalBookData {
  // ... existing fields
  dimensions?: {
    length?: { unit: string; value: number };
    width?: { unit: string; value: number };
    height?: { unit: string; value: number };
    weight?: { unit: string; value: number };
  };
  binding?: string;  // NEW
}

// In fetchFromISBNdb():
return {
  // ... existing fields
  dimensions: book.dimensions_structured,
  binding: book.binding,
};
```

**Use Cases:**
1. **Format Filtering:**
   ```typescript
   // Find pocket-sized books
   const pocketBooks = books.filter(b =>
     b.dimensions?.height?.value < 7 &&
     b.dimensions?.width?.value < 5
   );
   ```

2. **Shipping Integration:**
   ```typescript
   // Calculate shipping cost
   const weight = book.dimensions?.weight?.value || 1;
   const shippingCost = calculateShipping(weight);
   ```

3. **Display Enhancement:**
   ```html
   <!-- Show physical specs -->
   <div class="book-specs">
     <span>📏 8.85" × 11.35" × 0.81"</span>
     <span>⚖️ 2.71 lbs</span>
     <span>📖 Hardcover</span>
   </div>
   ```

---

### Priority 4: Pricing Data (LOW IMPACT)

**Current State:** Not stored

**Limitations:**
- Only available in single book lookup (`GET /book/{isbn}`)
- **NOT available in batch requests** (`POST /books`)
- May be outdated (MSRP, not real-time pricing)

**Recommendation:** ⚠️ **Skip for now**
- Batch operations are more important than pricing
- Use external pricing APIs if needed (Amazon, Google Books)
- Focus on enrichment fields available in batch endpoint

---

### Priority 5: Related ISBNs (MEDIUM IMPACT)

**Current State:** Not stored

**Recommended Enhancement:**
```typescript
interface ExternalBookData {
  // ... existing fields
  relatedISBNs?: {
    epub?: string;
    audiobook?: string;
    hardcover?: string;
    paperback?: string;
  };
}
```

**Use Cases:**
1. **Format Switching:**
   ```typescript
   // "Also available as eBook"
   if (book.relatedISBNs?.epub) {
     showFormatOption('Kindle Edition', book.relatedISBNs.epub);
   }
   ```

2. **Edition Clustering:**
   ```sql
   -- Find all formats of a work
   SELECT * FROM enriched_editions
   WHERE work_key = ? OR isbn = ANY(related_isbns);
   ```

---

## Batch Endpoint Strategy

### Why Batch is Critical

**Without Batching (100 books):**
- 100 requests × 1 second rate limit = **100+ seconds**
- High risk of rate limit errors
- Expensive in terms of API quota

**With Batching (100 books):**
- 1 request = **~0.5 seconds**
- 100x faster ⚡
- More reliable
- Better API quota usage

### Batch Request Implementation

```typescript
// Efficient batch enrichment
async function batchEnrichFromISBNdb(isbns: string[], env: Env) {
  const apiKey = await env.ISBNDB_API_KEY.get();

  // Chunk into 100 ISBN batches (Basic plan limit)
  const chunks = chunkArray(isbns, 100);
  const allBooks = [];

  for (const chunk of chunks) {
    const response = await fetch('https://api2.isbndb.com/books', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: `isbns=${chunk.join(',')}`,
    });

    if (response.ok) {
      const data = await response.json();

      // Extract all enrichment fields
      const enrichedBooks = data.data.map(book => ({
        isbn: book.isbn13,
        title: book.title_long || book.title,
        authors: book.authors || [],
        publisher: book.publisher,
        pages: book.pages,
        language: book.language,
        description: book.synopsis,

        // ENHANCED: Cover images
        coverUrls: {
          original: book.image_original,  // Best quality
          large: book.image,
          medium: book.image,
          small: book.image,
        },

        // NEW: Subject classification
        subjects: book.subjects || [],
        deweyDecimal: book.dewey_decimal || [],

        // NEW: Physical attributes
        dimensions: book.dimensions_structured,
        binding: book.binding,

        // NEW: Related formats
        relatedISBNs: book.related,

        provider: 'isbndb',
      }));

      allBooks.push(...enrichedBooks);
    }

    // Rate limiting between chunks
    if (chunks.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }

  return allBooks;
}
```

---

## Implementation Roadmap

### Phase 1: Cover Image Enhancement (Immediate)
**Effort:** Low | **Impact:** High

1. Update `ISBNdbResponse` interface to include `image_original`
2. Modify `fetchFromISBNdb()` to use `image_original`
3. Update cover processing to prioritize original images
4. Test with batch endpoint

**Files to modify:**
- `worker/services/external-apis.ts`
- `worker/types.ts`

### Phase 2: Subject Tags (1-2 days)
**Effort:** Medium | **Impact:** High

1. Add `subjects` and `deweyDecimal` to `ExternalBookData` interface
2. Update database schema to store subject arrays
3. Modify enrichment handlers to save subjects
4. Add subject-based search/filtering endpoints

**Files to modify:**
- `worker/types.ts`
- `worker/services/external-apis.ts`
- Database migration script
- `worker/enrich-handlers.ts`

### Phase 3: Physical Dimensions (2-3 days)
**Effort:** Medium | **Impact:** Medium

1. Add `dimensions` and `binding` to interfaces
2. Update database schema
3. Modify enrichment handlers
4. Add dimension-based filtering API

**Files to modify:**
- `worker/types.ts`
- `worker/services/external-apis.ts`
- Database migration script

### Phase 4: Related ISBNs (1-2 days)
**Effort:** Low | **Impact:** Medium

1. Add `relatedISBNs` to interfaces
2. Store in database
3. Add "Also available as" feature to API

**Files to modify:**
- `worker/types.ts`
- `worker/services/external-apis.ts`
- Database migration

---

## Database Schema Considerations

### Proposed Enrichment Table Extensions

```sql
-- Add columns to enriched_editions table
ALTER TABLE enriched_editions ADD COLUMN IF NOT EXISTS
  cover_url_original TEXT,           -- ISBNdb image_original
  subjects TEXT[],                    -- Subject tags
  dewey_decimal TEXT[],               -- Dewey classification
  dimensions JSONB,                   -- Physical dimensions
  binding VARCHAR(50),                -- Binding type
  related_isbns JSONB;                -- Related format ISBNs

-- Indexes for new fields
CREATE INDEX idx_enriched_editions_subjects
  ON enriched_editions USING GIN (subjects);

CREATE INDEX idx_enriched_editions_binding
  ON enriched_editions (binding);
```

---

## Testing Commands

### Test Batch Enrichment with All Fields

```bash
# Get full enrichment data
curl 'https://alexandria.ooheynerds.com/api/test/isbndb/batch' \
  -H 'Content-Type: application/json' \
  -X POST \
  -d '{"isbns":["9780439064873","9781492666868"]}' \
  | jq '.data.data[] | {
      title,
      image_original,
      subjects,
      dimensions_structured,
      binding,
      related
    }'
```

### Test Single Book with Pricing

```bash
# Note: Pricing only available in single book endpoint
curl 'https://alexandria.ooheynerds.com/api/test/isbndb/book/9780439064873' \
  | jq '.data.book | {title, msrp, binding}'
```

---

## Cost-Benefit Analysis

### Current State (Basic Metadata Only)
- ✅ Basic book info (title, authors, publisher)
- ✅ Standard quality covers
- ❌ No subject classification
- ❌ No physical dimensions
- ❌ No format relationships

### Enhanced State (All Enrichment Fields)
- ✅ Basic book info
- ✅ **High-quality original covers**
- ✅ **Subject tags for recommendations**
- ✅ **Physical dimensions for shipping/display**
- ✅ **Related format ISBNs**

**Additional API Cost:** $0 (same API calls, more data extracted)
**Implementation Effort:** 5-8 days
**Value Add:** 10x more useful metadata

---

## Best Practices

### 1. Always Use Batch Endpoint for Bulk Operations
```typescript
// ❌ BAD: Sequential single requests
for (const isbn of isbns) {
  await fetchFromISBNdb(isbn, env);
  await sleep(1000);
}

// ✅ GOOD: Batch request
await batchEnrichFromISBNdb(isbns, env);
```

### 2. Extract All Available Fields
```typescript
// ❌ BAD: Only taking what you need now
return { title, authors };

// ✅ GOOD: Extract everything for future use
return {
  title, authors, subjects, dimensions,
  coverUrls: { original: book.image_original },
  relatedISBNs: book.related
};
```

### 3. Use image_original for Cover Processing
```typescript
// ❌ BAD: Using compressed image
await processCover(book.image);

// ✅ GOOD: Using original for best quality
await processCover(book.image_original || book.image);
```

### 4. Store Structured Data
```typescript
// ❌ BAD: Flattening structured data
dimensions: `${h} × ${w} × ${l}`

// ✅ GOOD: Keep structure for querying
dimensions: book.dimensions_structured
```

---

## Resources

- **ISBNdb API Docs:** https://isbndb.com/isbndb-api-documentation-v2
- **Current Implementation:** `worker/services/external-apis.ts`
- **Type Definitions:** `worker/types.ts`
- **Testing Endpoints:** `worker/services/isbndb-test.ts`
- **Batch Documentation:** `docs/ISBNDB-ENDPOINTS.md`

---

## Summary

ISBNdb provides rich metadata beyond what Alexandria currently uses. The **highest value enhancements** are:

1. **Use `image_original` instead of `image`** for cover processing (immediate, high impact)
2. **Add subject tags** for content-based features (medium effort, high impact)
3. **Add physical dimensions** for shipping/display (medium effort, medium impact)
4. **Add related ISBNs** for format linking (low effort, medium impact)

All enhancements can be implemented **without additional API costs** by extracting more data from existing API calls, especially when using the batch endpoint.
