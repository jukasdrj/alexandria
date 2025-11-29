# Alexandria Database Schema

**Version:** 3.0  
**Purpose:** Pure book metadata enrichment hub (no user data)  
**Database:** PostgreSQL on Tower (192.168.1.240:5432)

---

## Architecture Principles

1. **Separation of Concerns**
   - Alexandria: Book metadata ONLY
   - bendv3: User data + AI/ML
   - books-v3: Local sync + UI

2. **PostgreSQL as Single Source of Truth**
   - No KV/D1 caching complexity
   - ACID transactions
   - Rich querying (JOINs, JSONB, fuzzy search)
   - Unlimited storage

3. **Multi-Provider Aggregation**
   - OpenLibrary: Scale (54M books)
   - ISBNdb: Quality (detailed metadata)
   - Google Books: Coverage (free fallback)

4. **work_key as Canonical Reference**
   - One work → many editions
   - Work is stable entity (ISBN changes)

---

## Tables (6 total)

### DOMAIN 1: Book Data

#### enriched_works
**Purpose:** Canonical work metadata (one per book)

| Column | Type | Description |
|--------|------|-------------|
| work_key | TEXT PK | OpenLibrary work ID (/works/OL45804W) |
| title | TEXT | Main title |
| subtitle | TEXT | Subtitle if exists |
| description | TEXT | Book description/summary |
| original_language | TEXT | Original publication language |
| first_publication_year | INTEGER | First publication year |
| subject_tags | TEXT[] | Normalized genres |
| is_own_voices | BOOLEAN | #OwnVoices flag |
| accessibility_tags | TEXT[] | Accessibility features |
| cover_url_large/medium/small | TEXT | Cover image URLs |
| cover_source | TEXT | Provider of cover image |
| openlibrary_work_id | TEXT | OpenLibrary ID |
| goodreads_work_ids | TEXT[] | Goodreads work IDs |
| amazon_asins | TEXT[] | Amazon ASINs |
| librarything_ids | TEXT[] | LibraryThing IDs |
| google_books_volume_ids | TEXT[] | Google Books IDs |
| isbndb_id | TEXT | ISBNdb ID |
| primary_provider | TEXT | Source of truth |
| contributors | TEXT[] | All providers that enriched |
| synthetic | BOOLEAN | AI-generated flag |
| isbndb_quality | INTEGER | Quality score 0-100 |
| completeness_score | INTEGER | Metadata completeness 0-100 |
| review_status | TEXT | verified/pending/flagged |
| original_image_path | TEXT | For AI-detected books |
| bounding_box_x/y/width/height | DOUBLE | For spine scan crops |
| created_at | TIMESTAMPTZ | First created |
| updated_at | TIMESTAMPTZ | Last updated (auto) |
| last_isbndb_sync | TIMESTAMPTZ | Last ISBNdb enrichment |
| last_google_books_sync | TIMESTAMPTZ | Last Google enrichment |
| metadata | JSONB | Extension fields |

**Indexes:**
- GIN on title (fuzzy search)
- GIN on subject_tags
- GIN on goodreads_work_ids
- B-tree on updated_at DESC
- Partial on isbndb_quality WHERE > 0

---

#### enriched_editions
**Purpose:** Physical/digital manifestations (one per ISBN)

| Column | Type | Description |
|--------|------|-------------|
| isbn | TEXT PK | 13-digit ISBN |
| alternate_isbns | TEXT[] | Other ISBNs for same edition |
| work_key | TEXT FK | References enriched_works |
| edition_key | TEXT | OpenLibrary edition ID |
| title | TEXT | Edition-specific title |
| subtitle | TEXT | Edition subtitle |
| publisher | TEXT | Publisher name |
| publication_date | TEXT | Publication date |
| page_count | INTEGER | Number of pages |
| format | TEXT | Hardcover/Paperback/eBook/etc |
| language | TEXT | Language code |
| edition_description | TEXT | Edition notes |
| cover_url_large/medium/small | TEXT | Cover images |
| cover_source | TEXT | Cover provider |
| openlibrary_edition_id | TEXT | OpenLibrary ID |
| amazon_asins | TEXT[] | Amazon ASINs |
| google_books_volume_ids | TEXT[] | Google Books IDs |
| librarything_ids | TEXT[] | LibraryThing IDs |
| goodreads_edition_ids | TEXT[] | Goodreads edition IDs |
| primary_provider | TEXT | Source |
| contributors | TEXT[] | All enrichers |
| isbndb_quality | INTEGER | Quality 0-100 |
| completeness_score | INTEGER | Completeness 0-100 |
| created_at | TIMESTAMPTZ | Created |
| updated_at | TIMESTAMPTZ | Updated (auto) |
| last_isbndb_sync | TIMESTAMPTZ | Last ISBNdb sync |
| last_google_books_sync | TIMESTAMPTZ | Last Google sync |
| metadata | JSONB | Extensions |

**Indexes:**
- B-tree on work_key
- GIN on title (fuzzy)
- B-tree on publisher
- GIN on alternate_isbns

---

#### enriched_authors
**Purpose:** Author biographical data

| Column | Type | Description |
|--------|------|-------------|
| author_key | TEXT PK | OpenLibrary author ID |
| name | TEXT | Author name |
| gender | TEXT | Male/Female/NonBinary/Unknown |
| cultural_region | TEXT | Cultural background |
| nationality | TEXT | Nationality |
| birth_year | INTEGER | Birth year |
| death_year | INTEGER | Death year |
| bio | TEXT | Biography |
| bio_source | TEXT | Bio provider |
| author_photo_url | TEXT | Author photo |
| openlibrary_author_id | TEXT | OpenLibrary ID |
| goodreads_author_ids | TEXT[] | Goodreads IDs |
| librarything_ids | TEXT[] | LibraryThing IDs |
| google_books_ids | TEXT[] | Google IDs |
| wikidata_id | TEXT | Wikidata ID |
| book_count | INTEGER | Total books (denormalized) |
| primary_provider | TEXT | Source |
| contributors | TEXT[] | Enrichers |
| created_at | TIMESTAMPTZ | Created |
| updated_at | TIMESTAMPTZ | Updated (auto) |
| last_wikidata_sync | TIMESTAMPTZ | Last Wikidata sync |
| metadata | JSONB | Extensions |

**Indexes:**
- GIN on name (fuzzy search)
- B-tree on nationality
- B-tree on book_count DESC

---

#### work_authors_enriched
**Purpose:** Many-to-many work↔author relationships

| Column | Type | Description |
|--------|------|-------------|
| work_key | TEXT FK | References enriched_works |
| author_key | TEXT FK | References enriched_authors |
| author_order | INTEGER | Display order (0, 1, 2...) |

**Primary Key:** (work_key, author_key)

**Indexes:**
- B-tree on work_key
- B-tree on author_key

---

### DOMAIN 2: Enrichment Infrastructure

#### enrichment_queue
**Purpose:** Background job queue for async enrichment

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Job ID |
| entity_type | TEXT | work/edition/author |
| entity_key | TEXT | Entity identifier |
| providers_to_try | TEXT[] | [isbndb, google-books] |
| providers_attempted | TEXT[] | Already tried |
| providers_succeeded | TEXT[] | Succeeded |
| priority | INTEGER | 1-10 (10=highest) |
| status | TEXT | pending/processing/completed/failed |
| created_at | TIMESTAMPTZ | Queued at |
| started_at | TIMESTAMPTZ | Processing started |
| completed_at | TIMESTAMPTZ | Finished |
| error_message | TEXT | Error if failed |
| retry_count | INTEGER | Retry attempts |
| max_retries | INTEGER | Max retries (default 3) |

**Indexes:**
- Composite on (status, priority DESC, created_at)
- Composite on (entity_type, entity_key)

---

#### enrichment_log
**Purpose:** Audit trail of all enrichment operations

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Log entry ID |
| entity_type | TEXT | work/edition/author |
| entity_key | TEXT | Entity identifier |
| provider | TEXT | isbndb/google-books/etc |
| operation | TEXT | fetch/merge/update |
| success | BOOLEAN | Succeeded? |
| fields_updated | TEXT[] | Which fields changed |
| error_message | TEXT | Error if failed |
| response_time_ms | INTEGER | Latency |
| created_at | TIMESTAMPTZ | Logged at |

**Indexes:**
- Composite on (entity_type, entity_key, created_at DESC)
- Composite on (provider, created_at DESC)
- Composite on (success, created_at DESC)

---

## Performance Expectations

| Query Type | p95 Latency | Notes |
|------------|-------------|-------|
| ISBN lookup | 15-30ms | Single row with index |
| Title fuzzy search | 50-150ms | GIN trigram index |
| Author lookup | 10-20ms | Indexed by author_key |
| Bulk ISBN (10 books) | 30-60ms | Parallel queries |
| Write enrichment | 5-10ms | Simple INSERT/UPDATE |
| Complex analytics | 100-200ms | Materialized views |

**Throughput:** ~1000 req/sec per Worker (unlimited with Cloudflare auto-scaling)

---

## Cost Model

### One-Time Enrichment
- ISBNdb: ~$0.01/book (high quality)
- Google Books: Free (good quality)
- OpenLibrary: Free (base dataset)

### Monthly Recurring
- Cloudflare Workers Paid: $5
- Durable Objects: ~$0.15 per 1M requests
- **Total: ~$5.15/month for unlimited queries**

After initial enrichment, all lookups are **FREE** from Alexandria!

---

## Data Flow

```
bendv3 receives ISBN lookup
  ↓
Check Alexandria enriched_editions
  ↓
FOUND (isbndb_quality >= 70)
  → Return immediately (sub-30ms)
  
FOUND (isbndb_quality < 70)
  → Return current data
  → Queue background enrichment
  
NOT FOUND
  → Fetch from ISBNdb/Google Books
  → Store in Alexandria (POST /api/enrich)
  → Return to user
  → Future lookups FREE
```

Provider priority:
1. User corrections
2. ISBNdb (highest quality)
3. Google Books
4. OpenLibrary

---

## Deployment

```bash
# Copy migration to Unraid
scp migrations/001_add_enrichment_tables.sql root@Tower.local:/tmp/

# Run migration
ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/001_add_enrichment_tables.sql"

# Verify
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c '\dt enriched*'"
```

---

## API Endpoints (Future)

### Read Operations
- `GET /api/work/:work_key` - Get work by key
- `GET /api/edition/:isbn` - Get edition by ISBN
- `GET /api/author/:author_key` - Get author by key
- `GET /api/search?q=title&limit=10` - Search works

### Write Operations (Internal Only)
- `POST /api/enrich/work` - Create/update work
- `POST /api/enrich/edition` - Create/update edition
- `POST /api/enrich/author` - Create/update author
- `POST /api/enrich/queue` - Queue background enrichment

---

## Monitoring

Key metrics to track:
- Cache hit rate (target: 95%+)
- Alexandria success rate (target: 80%+)
- Average latency (target: <30ms)
- ISBNdb API calls (cost tracking)
- Enrichment queue length (health)

---

**Last Updated:** November 29, 2025  
**Database:** openlibrary @ Tower (192.168.1.240)  
**Schema Version:** 1.0
