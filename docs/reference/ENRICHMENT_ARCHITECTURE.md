# Alexandria Enrichment Architecture

**Status**: Phase 1 COMPLETE | Phases 2-4 PLANNING

This document outlines the enrichment pipeline architecture for Alexandria. Basic enrichment endpoints (Phase 1) are live. Advanced features (Phases 2-4) are planned.

**Goal**: Transform Alexandria from a static OpenLibrary mirror into a self-enriching, intelligent book data service that minimizes paid API costs while maximizing data quality.

---

## Implementation Status

**✅ Phase 1 Complete (Write Endpoints)**
- [x] `POST /api/enrich/edition` - Store edition metadata
- [x] `POST /api/enrich/work` - Store work metadata
- [x] `POST /api/enrich/author` - Store author metadata
- [x] `POST /api/enrich/queue` - Queue background enrichment
- [x] `GET /api/enrich/status/:id` - Check job status
- [x] Quality scoring and conflict detection

**🔜 Phases 2-4 Planned (see below)**

---

## High-Level Vision

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ALEXANDRIA ECOSYSTEM                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│  │   bendv3     │◄───►│  Alexandria  │◄───►│  External    │            │
│  │   (Client)   │     │   Worker     │     │  APIs        │            │
│  └──────────────┘     └──────────────┘     └──────────────┘            │
│         │                    │                    │                     │
│         │              ┌─────┴─────┐              │                     │
│         │              │           │              │                     │
│         ▼              ▼           ▼              │                     │
│  ┌──────────────┐ ┌─────────┐ ┌─────────┐        │                     │
│  │ D1/KV Cache  │ │   R2    │ │ Postgres│        │                     │
│  │  (bendv3)    │ │ Covers  │ │  54M+   │        │                     │
│  └──────────────┘ └─────────┘ └─────────┘        │                     │
│                                                   │                     │
│  External APIs:                                   │                     │
│  - ISBNdb (paid, 5000/day) ◄─────────────────────┘                     │
│  - Google Books (free, rate limited)                                    │
│  - OpenLibrary (free, public)                                          │
│  - Wikidata (free, author enrichment)                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Enrichment Write Endpoints ✅ COMPLETE

Basic enrichment endpoints are live and functional. These allow external services to write enriched metadata back to Alexandria.

### Implemented Endpoints

- `POST /api/enrich/edition` - Store edition metadata with quality scoring
- `POST /api/enrich/work` - Store work metadata with conflict detection
- `POST /api/enrich/author` - Store author metadata with validation
- `POST /api/enrich/queue` - Queue background enrichment jobs
- `GET /api/enrich/status/:id` - Check enrichment job status

### Quality Scoring

Enrichment data includes quality scores based on:
- Completeness (all required fields present)
- Provider trust level (ISBNdb > Google Books > user corrections)
- Data freshness
- Field-level conflict detection

---

## Phase 2: Strengthen bendv3 ↔ Alexandria Trust (PLANNED)

### 2.1 Title/Author Search via Alexandria

**Current**: Title searches go directly to Google Books
**Target**: Alexandria searched first (54M works available)

**Alexandria Changes**:
```sql
-- Enable fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes for fast ILIKE searches
CREATE INDEX CONCURRENTLY idx_works_title_trgm
  ON works USING GIN ((data->>'title') gin_trgm_ops);

CREATE INDEX CONCURRENTLY idx_authors_name_trgm
  ON authors USING GIN ((data->>'name') gin_trgm_ops);
```

**bendv3 Changes**:
- Add `searchAlexandriaByTitle(title, author, env, ctx)`
- Insert before Google Books in `enrichMultipleBooks()` for title searches

### 2.2 Quality-Aware Write-Back

**Current**: Every external API hit writes to Alexandria
**Target**: Smart write-back that respects existing quality

**Logic**:
```javascript
async function shouldWriteToAlexandria(isbn, newData, env) {
  // Check existing quality in Alexandria
  const existing = await getAlexandriaEditionQuality(isbn, env);

  if (!existing) return true; // New record

  // Compare quality scores
  const newQuality = calculateQualityScore(newData);
  if (newQuality > existing.quality_score + 10) return true; // Significant improvement

  // Check for missing fields we can fill
  const missingFields = existing.missing_fields || [];
  const canFillFields = missingFields.filter(f => newData[f]);
  if (canFillFields.length > 0) return true; // Can fill gaps

  return false; // Don't overwrite with equal/lower quality
}
```

### 2.3 Enrichment Status Communication Protocol

**Alexandria Response Enhancement**:
```json
{
  "data": {
    "works": [...],
    "editions": [...],
    "authors": [...]
  },
  "enrichment_hints": {
    "quality_score": 75,
    "completeness": {
      "has_cover": true,
      "has_page_count": false,
      "has_description": true,
      "has_publisher": true
    },
    "last_enriched": "2025-01-15T00:00:00Z",
    "enriched_by": ["openlibrary", "google-books"],
    "suggested_action": "enrich_edition_details"
  }
}
```

**bendv3 Response Handling**:
```javascript
if (alexandriaResult.enrichment_hints?.suggested_action === 'enrich_edition_details') {
  // Queue background enrichment via ISBNdb
  ctx.waitUntil(queueISBNdbEnrichment(isbn, env));
}
```

---

## Phase 3: Alexandria Self-Enrichment Pipeline (PLANNED)

### 3.1 Data Sources & Sync Strategy

| Source | Strategy | Frequency | Notes |
|--------|----------|-----------|-------|
| OpenLibrary Dumps | Download + diff | Monthly | Primary source, 54M+ records |
| OpenLibrary Recent Changes API | Poll for updates | Daily | Catch new/updated records |
| ISBNdb | On-demand + proactive | 5000/day budget | High-quality edition data |
| Google Books | On-demand only | Free tier | Covers and basic metadata |
| Wikidata | Author enrichment | As needed | Gender, nationality, birth/death |

### 3.2 OpenLibrary Dump Sync

**Monthly Process**:
```bash
# 1. Download latest dumps
wget https://openlibrary.org/data/ol_dump_editions_latest.txt.gz
wget https://openlibrary.org/data/ol_dump_works_latest.txt.gz
wget https://openlibrary.org/data/ol_dump_authors_latest.txt.gz

# 2. Import to staging tables
psql -c "CREATE TABLE editions_staging (LIKE editions);"
# ... import process

# 3. Diff and merge
psql -c "
  INSERT INTO editions
  SELECT * FROM editions_staging s
  WHERE NOT EXISTS (SELECT 1 FROM editions e WHERE e.key = s.key)
  OR s.revision > e.revision;
"

# 4. Update indexes
psql -c "REINDEX INDEX CONCURRENTLY idx_edition_isbns_isbn;"
```

### 3.3 OpenLibrary Recent Changes API

**Endpoint**: `https://openlibrary.org/recentchanges.json?limit=1000`

**Daily Cron Job** (Cloudflare Worker Cron Trigger):
```javascript
export default {
  async scheduled(event, env, ctx) {
    // Fetch recent changes since last sync
    const lastSync = await env.CACHE.get('ol_last_sync');
    const changes = await fetchRecentChanges(lastSync);

    for (const change of changes) {
      if (change.kind === 'edition' || change.kind === 'work') {
        await syncRecordFromOpenLibrary(change.key, env);
      }
    }

    await env.CACHE.put('ol_last_sync', new Date().toISOString());
  }
}
```

### 3.4 Proactive ISBNdb Enrichment

**Budget**: 5000 calls/day
**Strategy**: Prioritized queue

**Priority Tiers**:
1. **User-requested** (P1): Books users searched but Alexandria couldn't fully satisfy
2. **Missing editions** (P2): Works with 0 editions in Alexandria
3. **Missing covers** (P3): Editions without cover images
4. **Low quality** (P4): Editions with quality_score < 50
5. **Popular authors** (P5): Fill out bibliographies for frequently-searched authors

**Queue Schema**:
```sql
CREATE TABLE enrichment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(20) NOT NULL, -- 'edition', 'work', 'author'
  entity_key VARCHAR(255) NOT NULL,
  priority INTEGER DEFAULT 5,
  source VARCHAR(50), -- 'user_search', 'missing_edition', 'low_quality'
  providers_to_try TEXT[], -- ['isbndb', 'google-books']
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_attempt TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(entity_type, entity_key)
);

CREATE INDEX idx_enrichment_queue_priority ON enrichment_queue(priority DESC, created_at);
CREATE INDEX idx_enrichment_queue_status ON enrichment_queue(status) WHERE status = 'pending';
```

**Daily Budget Allocation**:
```
P1 (user-requested):    2000 calls (40%)
P2 (missing editions):  1500 calls (30%)
P3 (missing covers):     750 calls (15%)
P4 (low quality):        500 calls (10%)
P5 (author expansion):   250 calls (5%)
```

### 3.5 Test Data Bootstrap

**Your 10 years of reading data** (~1700 books):
```
bendv3/docs/testImages/csv-expansion/
├── 2015.csv through 2025.csv (yearly reading)
├── combined_library_expanded.csv (775 books)
└── yr_title_auth_isbn13.csv (359 books with ISBNs)
```

**Bootstrap Script**:
```javascript
// worker/scripts/bootstrap-test-data.js
async function bootstrapFromCSV(csvPath, env) {
  const books = parseCSV(csvPath);

  for (const book of books) {
    // Check if Alexandria has this ISBN
    const existing = await checkAlexandriaISBN(book.isbn13, env);

    if (!existing || existing.quality_score < 70) {
      // Queue for ISBNdb enrichment
      await queueEnrichment({
        entity_type: 'edition',
        entity_key: book.isbn13,
        priority: 1, // High priority - your actual reading list
        source: 'bootstrap_csv',
        providers_to_try: ['isbndb', 'google-books']
      }, env);
    }
  }
}
```

---

## Phase 4: Author Enrichment Pipeline (PLANNED)

### 4.1 Diversity & Biographical Data

**Fields to Enrich**:
- `gender` (Female/Male/Non-binary/Other/Unknown)
- `nationality` / `cultural_region`
- `birth_year` / `death_year`
- `bio` (short biography)
- `photo_url`
- `wikidata_id` (for future enrichment)

**Sources**:
1. **Wikidata** (primary for diversity data)
2. **OpenLibrary** (basic bio)
3. **ISBNdb** (limited author info)

### 4.2 Wikidata Integration

**Query Example**:
```sparql
SELECT ?author ?authorLabel ?genderLabel ?birthDate ?deathDate ?countryLabel WHERE {
  ?author wdt:P31 wd:Q5 .  # Instance of human
  ?author rdfs:label "J.K. Rowling"@en .
  OPTIONAL { ?author wdt:P21 ?gender . }
  OPTIONAL { ?author wdt:P569 ?birthDate . }
  OPTIONAL { ?author wdt:P570 ?deathDate . }
  OPTIONAL { ?author wdt:P27 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

**Alexandria Author Enrichment Endpoint**:
```
POST /api/enrich/author
{
  "author_key": "/authors/OL23919A",
  "name": "J.K. Rowling",
  "gender": "female",
  "nationality": "United Kingdom",
  "birth_year": 1965,
  "wikidata_id": "Q34660",
  "primary_provider": "wikidata"
}
```

### 4.3 Author Bibliography Expansion

When a new author is discovered:
1. Query OpenLibrary for all works by author
2. Queue editions for ISBNdb enrichment
3. Proactively fetch covers for popular works

---

## Phase 5: Cover Image Pipeline

### 5.1 Current State

- R2 bucket: `bookstrack-covers-processed`
- Stored by work_key or ISBN
- Single quality level (original)

### 5.2 Target State

**Storage Structure**:
```
bookstrack-covers-processed/
├── isbn/
│   └── {isbn13}/
│       ├── original.webp   (source quality)
│       ├── large.webp      (512x768)
│       ├── medium.webp     (256x384)
│       └── small.webp      (128x192)
└── work/
    └── {work_key}/
        └── {hash}/
            ├── original.webp
            └── ... (sizes)
```

**Processing Pipeline**:
```javascript
async function processAndStoreCover(isbn, sourceUrl, env) {
  // 1. Download original
  const original = await downloadImage(sourceUrl);

  // 2. Generate all sizes
  const sizes = await generateSizes(original, ['large', 'medium', 'small']);

  // 3. Store all versions in R2
  await Promise.all([
    env.COVER_IMAGES.put(`isbn/${isbn}/original.webp`, original),
    env.COVER_IMAGES.put(`isbn/${isbn}/large.webp`, sizes.large),
    env.COVER_IMAGES.put(`isbn/${isbn}/medium.webp`, sizes.medium),
    env.COVER_IMAGES.put(`isbn/${isbn}/small.webp`, sizes.small),
  ]);

  // 4. Return CDN URLs
  return {
    original: `https://alexandria.ooheynerds.com/covers/${isbn}/original`,
    large: `https://alexandria.ooheynerds.com/covers/${isbn}/large`,
    medium: `https://alexandria.ooheynerds.com/covers/${isbn}/medium`,
    small: `https://alexandria.ooheynerds.com/covers/${isbn}/small`,
  };
}
```

---

## Worker-to-Worker Communication Protocol

### Request: bendv3 → Alexandria

```javascript
// Standard search with enrichment hints request
GET /api/search?isbn=9780439064873&include_hints=true

// Response includes enrichment guidance
{
  "data": { ... },
  "enrichment_hints": {
    "quality_score": 65,
    "missing": ["page_count", "cover_large"],
    "stale": false,
    "suggested_providers": ["isbndb"]
  }
}
```

### Request: Alexandria → bendv3 (Callback)

```javascript
// When Alexandria completes background enrichment
POST https://bendv3.ooheynerds.com/api/internal/enrichment-complete
{
  "isbn": "9780439064873",
  "enrichment_type": "edition",
  "provider": "isbndb",
  "fields_updated": ["page_count", "format", "cover_urls"],
  "new_quality_score": 92,
  "timestamp": "2025-11-30T12:00:00Z"
}

// bendv3 can then invalidate its cache for this ISBN
```

### Shared Types (npm package or copy)

```typescript
// @alexandria/types or shared file
interface EnrichmentHints {
  quality_score: number;        // 0-100
  completeness: {
    has_cover: boolean;
    has_page_count: boolean;
    has_description: boolean;
    has_publisher: boolean;
    has_author_bio: boolean;
  };
  last_enriched: string | null; // ISO timestamp
  enriched_by: string[];        // ['openlibrary', 'isbndb']
  suggested_action: 'none' | 'enrich_edition' | 'enrich_author' | 'refresh';
  suggested_providers: string[];
}

interface EnrichmentCallback {
  isbn: string;
  entity_type: 'edition' | 'work' | 'author';
  provider: string;
  fields_updated: string[];
  new_quality_score: number;
  timestamp: string;
}
```

---

## Implementation Roadmap

### Sprint 1: Foundation (This Week)
- [ ] Add pg_trgm indexes to Alexandria
- [ ] Implement `searchAlexandriaByTitle()` in bendv3
- [ ] Add quality-aware write-back logic
- [ ] Create enrichment_hints response field

### Sprint 2: Self-Enrichment (Next Week)
- [ ] Build enrichment queue processor
- [ ] Implement ISBNdb batch fetching
- [ ] Bootstrap from your test CSV data
- [ ] Set up daily budget tracking

### Sprint 3: Author Enrichment (Week 3)
- [ ] Integrate Wikidata for author data
- [ ] Build author bibliography expansion
- [ ] Add diversity fields to schema

### Sprint 4: Covers & Polish (Week 4)
- [ ] Multi-size cover generation
- [ ] Worker-to-worker callbacks
- [ ] Monitoring dashboard
- [ ] Documentation

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Alexandria ISBN hit rate | ~60% | 90%+ |
| Average quality score | 50 | 80+ |
| ISBNdb calls/day | Variable | <5000 (budgeted) |
| Cover availability | ~40% | 85%+ |
| Author diversity data | 0% | 70%+ |

---

**Created**: November 30, 2025
**Status**: Planning Complete - Ready for Implementation
