# Alexandria Write Endpoints & Enrichment Infrastructure

**Created:** November 29, 2025  
**Context:** Phase 1 of Enrichment Pipeline - Enable write operations  
**Related:** `docs/ENRICHMENT_PHASES.md`, `ALEXANDRIA_SCHEMA.md`, Migration 002  
**Goal:** Build write capability so bendv3 can enrich Alexandria database

---

## Priority Legend

- **P0 (CRITICAL):** Blocking bendv3 enrichment flow
- **P1 (HIGH):** Required for full enrichment pipeline  
- **P2 (MEDIUM):** Should implement but not blocking
- **P3 (LOW):** Nice to have, future improvement

---

## Overview: Why We Need Write Endpoints

**Current State:** Alexandria is READ-ONLY
- bendv3 can query Alexandria for book data ✅
- bendv3 CANNOT write enrichments back to Alexandria ❌

**Problem:** When bendv3 gets better data from ISBNdb/Google Books, it has nowhere to store it!

**Solution:** Build write endpoints so bendv3 can:
1. Store enriched book metadata in Alexandria
2. Queue background enrichment jobs
3. Track enrichment status and quality scores

**Benefit:** Future lookups get better data (80%+ hit rate on enriched data!)

---

## Architecture: Data Flow After Write Endpoints

```
User scans ISBN
  ↓
bendv3 checks Alexandria
  ↓
NOT FOUND or LOW QUALITY
  ↓
bendv3 fetches from ISBNdb/Google Books
  ↓
bendv3 POSTs enrichment to Alexandria  ← NEW!
  ↓
Alexandria stores in enriched_* tables
  ↓
Future lookups return enriched data (FREE!)
```

---

## P0: POST /api/enrich/edition

**Purpose:** Store or update edition metadata  
**Called by:** bendv3 when ISBN lookup finds better data  
**Database:** Inserts/updates `enriched_editions` table

### Request Body

```typescript
interface EnrichEditionRequest {
  isbn: string;                    // Primary key (13-digit)
  alternate_isbns?: string[];      // Other ISBNs for same edition
  work_key?: string;               // Reference to work (if known)
  title?: string;                  // Edition-specific title
  subtitle?: string;               // Edition subtitle
  publisher?: string;              // Publisher name
  publication_date?: string;       // Publication date
  page_count?: number;             // Number of pages
  format?: string;                 // Hardcover/Paperback/eBook
  language?: string;               // Language code (en, es, fr)
  cover_urls?: {
    large?: string;
    medium?: string;
    small?: string;
  };
  cover_source?: string;           // Provider of cover image
  
  // External IDs
  openlibrary_edition_id?: string;
  amazon_asins?: string[];
  google_books_volume_ids?: string[];
  goodreads_edition_ids?: string[];
  
  // Enrichment metadata
  primary_provider: string;        // Which API provided this (required)
  confidence?: number;             // Quality score 0-100 (default: 80)
  
  // Optional: Work matching confidence
  work_match_confidence?: number;  // How confident about work_key (0-100)
  work_match_source?: string;      // Who matched this (openlibrary, isbndb, etc)
}
```

### Response

```typescript
{
  "success": true,
  "data": {
    "isbn": "9780439064873",
    "action": "created" | "updated",  // Was this new or an update?
    "quality_improvement": 15,        // Diff in quality score (if update)
    "stored_at": "2025-11-30T01:00:00Z"
  }
}
```

### Database Operation

```sql
-- Upsert into enriched_editions
INSERT INTO enriched_editions (
  isbn,
  alternate_isbns,
  work_key,
  title,
  subtitle,
  publisher,
  publication_date,
  page_count,
  format,
  language,
  cover_url_large,
  cover_url_medium,
  cover_url_small,
  cover_source,
  openlibrary_edition_id,
  amazon_asins,
  google_books_volume_ids,
  goodreads_edition_ids,
  primary_provider,
  contributors,
  isbndb_quality,
  completeness_score,
  work_match_confidence,
  work_match_source,
  work_match_at,
  created_at,
  updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, $17, $18,
  $19, ARRAY[$19], $20, $21, $22, $23, NOW(), NOW(), NOW()
)
ON CONFLICT (isbn) DO UPDATE SET
  -- Only update if new data is higher quality
  title = CASE 
    WHEN EXCLUDED.isbndb_quality > enriched_editions.isbndb_quality 
    THEN EXCLUDED.title 
    ELSE enriched_editions.title 
  END,
  -- Similar for other fields...
  updated_at = NOW(),
  last_isbndb_sync = CASE 
    WHEN EXCLUDED.primary_provider = 'isbndb' 
    THEN NOW() 
    ELSE enriched_editions.last_isbndb_sync 
  END
RETURNING 
  isbn,
  (xmax = 0) AS was_insert,  -- True if INSERT, false if UPDATE
  isbndb_quality;
```

### Implementation Notes

**File:** `worker/src/handlers/enrich.ts` (new file)

**Quality Score Calculation:**
```typescript
function calculateQualityScore(edition: EnrichEditionRequest): number {
  let score = 0;
  
  // Provider weights
  const providerScores = {
    'isbndb': 40,        // Highest quality
    'google-books': 30,
    'openlibrary': 20
  };
  score += providerScores[edition.primary_provider] || 0;
  
  // Completeness weights
  if (edition.title) score += 10;
  if (edition.publisher) score += 5;
  if (edition.publication_date) score += 5;
  if (edition.page_count) score += 5;
  if (edition.cover_urls?.large) score += 10;
  if (edition.language) score += 5;
  if (edition.format) score += 5;
  
  // External ID weights
  if (edition.openlibrary_edition_id) score += 5;
  if (edition.google_books_volume_ids?.length) score += 5;
  if (edition.amazon_asins?.length) score += 5;
  
  return Math.min(score, 100);
}
```

### Testing

```bash
# Test creating new edition
curl "http://localhost:8787/api/enrich/edition" \
  -H "Content-Type: application/json" \
  -d '{
    "isbn": "9780439064873",
    "title": "Harry Potter and the Chamber of Secrets",
    "publisher": "Scholastic",
    "page_count": 344,
    "primary_provider": "google-books",
    "cover_urls": {
      "large": "https://..."
    }
  }' | jq '.'

# Expected: { "success": true, "data": { "action": "created", ... } }

# Test updating existing edition with higher quality
curl "http://localhost:8787/api/enrich/edition" \
  -H "Content-Type: application/json" \
  -d '{
    "isbn": "9780439064873",
    "title": "Harry Potter and the Chamber of Secrets",
    "publisher": "Scholastic Inc.",
    "page_count": 344,
    "format": "Paperback",
    "primary_provider": "isbndb",
    "confidence": 95
  }' | jq '.'

# Expected: { "success": true, "data": { "action": "updated", "quality_improvement": 15 } }
```

---

## P0: POST /api/enrich/work

**Purpose:** Store or update work metadata  
**Called by:** bendv3 when it finds work-level data  
**Database:** Inserts/updates `enriched_works` table

### Request Body

```typescript
interface EnrichWorkRequest {
  work_key: string;                // OpenLibrary work ID (required)
  title: string;                   // Main title (required)
  subtitle?: string;
  description?: string;            // Book description/summary
  original_language?: string;      // Original language
  first_publication_year?: number;
  subject_tags?: string[];         // Normalized genres
  cover_urls?: {
    large?: string;
    medium?: string;
    small?: string;
  };
  cover_source?: string;
  
  // External IDs
  openlibrary_work_id?: string;
  goodreads_work_ids?: string[];
  amazon_asins?: string[];
  google_books_volume_ids?: string[];
  
  // Enrichment metadata
  primary_provider: string;        // Required
  confidence?: number;             // Default: 80
}
```

### Response

```typescript
{
  "success": true,
  "data": {
    "work_key": "OL82537W",
    "action": "created" | "updated",
    "quality_improvement": 10,
    "stored_at": "2025-11-30T01:00:00Z"
  }
}
```

### Database Operation

```sql
INSERT INTO enriched_works (
  work_key,
  title,
  subtitle,
  description,
  original_language,
  first_publication_year,
  subject_tags,
  cover_url_large,
  cover_url_medium,
  cover_url_small,
  cover_source,
  openlibrary_work_id,
  goodreads_work_ids,
  amazon_asins,
  google_books_volume_ids,
  primary_provider,
  contributors,
  isbndb_quality,
  completeness_score,
  created_at,
  updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, ARRAY[$16], $17, $18, NOW(), NOW()
)
ON CONFLICT (work_key) DO UPDATE SET
  -- Merge logic: keep highest quality fields
  description = COALESCE(NULLIF(EXCLUDED.description, ''), enriched_works.description),
  subject_tags = array_cat(enriched_works.subject_tags, EXCLUDED.subject_tags),
  contributors = array_append(enriched_works.contributors, EXCLUDED.primary_provider),
  updated_at = NOW()
RETURNING work_key, (xmax = 0) AS was_insert;
```

### Testing

```bash
curl "http://localhost:8787/api/enrich/work" \
  -H "Content-Type: application/json" \
  -d '{
    "work_key": "OL82537W",
    "title": "Harry Potter and the Chamber of Secrets",
    "description": "...",
    "first_publication_year": 1998,
    "subject_tags": ["Fantasy", "Magic", "Wizards"],
    "primary_provider": "google-books"
  }' | jq '.'
```

---

## P0: POST /api/enrich/author

**Purpose:** Store or update author biographical data  
**Called by:** bendv3 when enriching book data  
**Database:** Inserts/updates `enriched_authors` table

### Request Body

```typescript
interface EnrichAuthorRequest {
  author_key: string;              // OpenLibrary author ID (required)
  name: string;                    // Author name (required)
  gender?: string;                 // Male/Female/NonBinary/Unknown
  nationality?: string;
  birth_year?: number;
  death_year?: number;
  bio?: string;
  bio_source?: string;
  author_photo_url?: string;
  
  // External IDs
  openlibrary_author_id?: string;
  goodreads_author_ids?: string[];
  wikidata_id?: string;
  
  primary_provider: string;        // Required
}
```

### Response

```typescript
{
  "success": true,
  "data": {
    "author_key": "OL23919A",
    "action": "created" | "updated",
    "stored_at": "2025-11-30T01:00:00Z"
  }
}
```

### Testing

```bash
curl "http://localhost:8787/api/enrich/author" \
  -H "Content-Type: application/json" \
  -d '{
    "author_key": "OL23919A",
    "name": "J.K. Rowling",
    "birth_year": 1965,
    "nationality": "United Kingdom",
    "primary_provider": "openlibrary"
  }' | jq '.'
```

---

## P1: POST /api/enrich/queue

**Purpose:** Queue background enrichment job  
**Called by:** bendv3 for fire-and-forget enrichment  
**Database:** Inserts into `enrichment_queue` table

### Request Body

```typescript
interface QueueEnrichmentRequest {
  entity_type: 'work' | 'edition' | 'author';
  entity_key: string;              // ISBN, work_key, or author_key
  providers_to_try: string[];      // ['isbndb', 'google-books']
  priority?: number;               // 1-10 (default: 5)
}
```

### Response

```typescript
{
  "success": true,
  "data": {
    "queue_id": "uuid",
    "position_in_queue": 42,
    "estimated_processing_time": "5-10 minutes"
  }
}
```

### Database Operation

```sql
INSERT INTO enrichment_queue (
  id,
  entity_type,
  entity_key,
  providers_to_try,
  priority,
  status,
  created_at
) VALUES (
  gen_random_uuid(),
  $1, $2, $3, $4, 'pending', NOW()
)
RETURNING id;
```

### Testing

```bash
curl "http://localhost:8787/api/enrich/queue" \
  -H "Content-Type: application/json" \
  -d '{
    "entity_type": "edition",
    "entity_key": "9780439064873",
    "providers_to_try": ["isbndb", "google-books"],
    "priority": 7
  }' | jq '.'
```

---

## P1: GET /api/enrich/status/:id

**Purpose:** Check enrichment job status  
**Called by:** bendv3 for polling job progress  
**Database:** Reads from `enrichment_queue` table

### Response

```typescript
{
  "success": true,
  "data": {
    "id": "uuid",
    "entity_type": "edition",
    "entity_key": "9780439064873",
    "status": "pending" | "processing" | "completed" | "failed",
    "providers_attempted": ["isbndb"],
    "providers_succeeded": ["isbndb"],
    "retry_count": 0,
    "created_at": "2025-11-30T01:00:00Z",
    "completed_at": "2025-11-30T01:05:00Z",
    "error_message": null
  }
}
```

### Database Query

```sql
SELECT 
  id,
  entity_type,
  entity_key,
  status,
  providers_attempted,
  providers_succeeded,
  retry_count,
  created_at,
  completed_at,
  error_message
FROM enrichment_queue
WHERE id = $1;
```

### Testing

```bash
# After queuing a job, check its status
QUEUE_ID="uuid-from-queue-response"
curl "http://localhost:8787/api/enrich/status/${QUEUE_ID}" | jq '.'
```

---

## P2: Enrichment Conflict Detection

**Purpose:** Detect when providers disagree on metadata  
**Implementation:** Use `provider_conflicts` table from Migration 002

### When to Create Conflicts

**Example scenario:**
1. OpenLibrary says: `work_key = OL82537W`
2. ISBNdb says: `work_key = OL12345W`
3. Create conflict record for manual review

### Conflict Creation

```sql
INSERT INTO provider_conflicts (
  entity_type,
  entity_key,
  field_name,
  provider_a,
  value_a,
  confidence_a,
  provider_b,
  value_b,
  confidence_b,
  status
) VALUES (
  'edition',
  '9780439064873',
  'work_key',
  'openlibrary',
  'OL82537W',
  90,
  'isbndb',
  'OL12345W',
  95,
  'pending'
);
```

### Conflict Resolution Strategy

```typescript
function resolveConflict(
  fieldName: string,
  providerA: string,
  valueA: any,
  confidenceA: number,
  providerB: string,
  valueB: any,
  confidenceB: number
): ConflictResolution {
  // Rule 1: If confidence differs by 20+, use higher confidence
  if (Math.abs(confidenceA - confidenceB) >= 20) {
    return {
      resolution: 'chose_higher_confidence',
      winner: confidenceA > confidenceB ? 'a' : 'b',
      resolved_value: confidenceA > confidenceB ? valueA : valueB
    };
  }
  
  // Rule 2: If both high confidence (90+), flag for manual review
  if (confidenceA >= 90 && confidenceB >= 90) {
    return {
      resolution: 'manual_review',
      status: 'manual_review'
    };
  }
  
  // Rule 3: Provider priority
  const providerPriority = {
    'user-correction': 100,
    'isbndb': 80,
    'google-books': 60,
    'openlibrary': 40
  };
  
  const priorityA = providerPriority[providerA] || 0;
  const priorityB = providerPriority[providerB] || 0;
  
  return {
    resolution: 'provider_priority',
    winner: priorityA > priorityB ? 'a' : 'b',
    resolved_value: priorityA > priorityB ? valueA : valueB
  };
}
```

---

## P3: Enrichment Analytics

**Purpose:** Track enrichment performance and quality  
**Implementation:** Use `enrichment_log` table

### Log Entry Creation

```sql
INSERT INTO enrichment_log (
  id,
  entity_type,
  entity_key,
  provider,
  operation,
  success,
  fields_updated,
  response_time_ms,
  created_at
) VALUES (
  gen_random_uuid(),
  'edition',
  '9780439064873',
  'isbndb',
  'fetch',
  true,
  ARRAY['title', 'publisher', 'page_count'],
  245,
  NOW()
);
```

### Analytics Queries

```sql
-- Provider success rate (last 24 hours)
SELECT 
  provider,
  COUNT(*) as total_attempts,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
  ROUND(AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate,
  ROUND(AVG(response_time_ms)) as avg_response_time_ms
FROM enrichment_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY provider
ORDER BY success_rate DESC;

-- Fields most frequently updated
SELECT 
  unnest(fields_updated) as field_name,
  COUNT(*) as update_count
FROM enrichment_log
WHERE success = true
GROUP BY field_name
ORDER BY update_count DESC
LIMIT 20;
```

---

## Deployment Steps

### 1. Deploy Migration 002 (Already Done! ✅)

```bash
# Already completed in this session
scp migrations/002_add_confidence_tracking.sql root@Tower.local:/tmp/
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/002_add_confidence_tracking.sql"
```

### 2. Implement Write Endpoints

**Create files:**
- `worker/src/handlers/enrich.ts` - Write endpoint handlers
- `worker/src/services/enrichment-service.ts` - Business logic
- `worker/src/utils/quality-scorer.ts` - Quality calculation
- `worker/src/utils/conflict-resolver.ts` - Conflict handling

**Update:**
- `worker/src/index.ts` - Register new routes

### 3. Add Routes to Worker

```typescript
// worker/src/index.ts
import { enrichEdition, enrichWork, enrichAuthor, queueEnrichment, getEnrichmentStatus } from './handlers/enrich';

app.post('/api/enrich/edition', enrichEdition);
app.post('/api/enrich/work', enrichWork);
app.post('/api/enrich/author', enrichAuthor);
app.post('/api/enrich/queue', queueEnrichment);
app.get('/api/enrich/status/:id', getEnrichmentStatus);
```

### 4. Test Locally

```bash
cd worker/
npx wrangler dev

# Test in another terminal
curl "http://localhost:8787/api/enrich/edition" -H "Content-Type: application/json" -d '{...}'
```

### 5. Deploy to Production

```bash
cd worker/
npx wrangler deploy
```

### 6. Verify Deployment

```bash
# Test production endpoint
curl "https://alexandria.ooheynerds.com/api/enrich/edition" \
  -H "Content-Type: application/json" \
  -d '{
    "isbn": "9780439064873",
    "title": "Test",
    "primary_provider": "test"
  }'

# Check database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT * FROM enriched_editions WHERE isbn = '\''9780439064873'\'';'"
```

---

## Integration with bendv3

Once write endpoints are deployed, update bendv3:

### Fire-and-Forget Pattern

```typescript
// In bendv3/src/services/enrichment.ts
async function searchByISBN(isbn: string, env: WorkerEnv): Promise<SingleEnrichmentResult | null> {
  // Try Alexandria first
  const alexandriaResult = await externalApis.searchAlexandriaByISBN(isbn, env);
  if (alexandriaResult?.works?.length) {
    return convertToSingleResult(alexandriaResult);
  }

  // Fallback to Google Books
  const googleResult = await searchGoogleBooks({ isbn }, env);
  if (googleResult?.success) {
    // ✨ NEW: Store enrichment in Alexandria (fire-and-forget)
    ctx.waitUntil(
      storeInAlexandria(googleResult, isbn, env)
    );
    
    return googleResult;
  }

  return null;
}

async function storeInAlexandria(
  enrichment: SingleEnrichmentResult,
  isbn: string,
  env: WorkerEnv
) {
  try {
    await fetch('https://alexandria.ooheynerds.com/api/enrich/edition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isbn,
        title: enrichment.work.title,
        publisher: enrichment.edition?.publisher,
        page_count: enrichment.edition?.pageCount,
        primary_provider: 'google-books',
        confidence: 80
      })
    });
    console.log(`✅ Stored enrichment for ${isbn} in Alexandria`);
  } catch (error) {
    console.error(`⚠️ Failed to store enrichment in Alexandria:`, error);
    // Don't throw - this is fire-and-forget
  }
}
```

---

## Testing Checklist

- [ ] **POST /api/enrich/edition creates new edition**
  ```bash
  curl POST /api/enrich/edition with ISBN
  # Verify: SELECT FROM enriched_editions WHERE isbn = '...'
  ```

- [ ] **POST /api/enrich/edition updates existing with higher quality**
  ```bash
  curl POST /api/enrich/edition with same ISBN but isbndb provider
  # Verify: quality score increased
  ```

- [ ] **POST /api/enrich/work creates new work**
  ```bash
  curl POST /api/enrich/work with work_key
  # Verify: SELECT FROM enriched_works WHERE work_key = '...'
  ```

- [ ] **POST /api/enrich/queue creates queue entry**
  ```bash
  curl POST /api/enrich/queue
  # Verify: SELECT FROM enrichment_queue WHERE entity_key = '...'
  ```

- [ ] **GET /api/enrich/status/:id returns job status**
  ```bash
  curl GET /api/enrich/status/{queue_id}
  # Verify: Returns status object
  ```

- [ ] **Conflict detection works**
  ```bash
  # Insert conflicting work_key from two providers
  # Verify: SELECT FROM provider_conflicts
  ```

---

## Notes for Claude Code

When implementing:

1. **Use Hyperdrive for database connection**
   ```typescript
   const client = await env.HYPERDRIVE.connect();
   ```

2. **Handle PostgreSQL parameterized queries**
   ```typescript
   const result = await client.query(
     'INSERT INTO enriched_editions (...) VALUES ($1, $2, $3)',
     [isbn, title, publisher]
   );
   ```

3. **Use transactions for multi-table operations**
   ```typescript
   await client.query('BEGIN');
   try {
     await client.query('INSERT INTO enriched_works ...');
     await client.query('INSERT INTO enriched_editions ...');
     await client.query('COMMIT');
   } catch (error) {
     await client.query('ROLLBACK');
     throw error;
   }
   ```

4. **Return contract-compliant responses**
   ```typescript
   return {
     success: true,
     data: { ... }
   };
   ```

5. **Test with wrangler dev**
   ```bash
   npx wrangler dev
   # Connects to production Hyperdrive for testing
   ```

---

**Created by:** Claude (Assistant)  
**For:** Justin (via Claude Code execution)  
**Next:** Implement write endpoints, test with bendv3, verify enrichment flow
