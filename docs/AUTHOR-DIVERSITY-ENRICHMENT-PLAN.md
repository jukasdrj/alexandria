# Author Diversity Enrichment Plan

> **Status**: APPROVED
> **Created**: 2025-12-12
> **Last Updated**: 2025-12-12
> **Reviewed By**: Grok (code review)

## Executive Summary

This plan outlines how Alexandria will enrich 8M+ author records with diversity data from Wikidata, enabling downstream consumers (bendv3) to provide diversity-aware book recommendations. The core principle is **Alexandria stores facts, consumers derive meaning**.

---

## Table of Contents

1. [Current State](#current-state)
2. [Architecture Decisions](#architecture-decisions)
3. [Data Model](#data-model)
4. [Wikidata Field Mapping](#wikidata-field-mapping)
5. [Implementation Phases](#implementation-phases)
6. [Technical Implementation](#technical-implementation)
7. [Rate Limiting & Error Handling](#rate-limiting--error-handling)
8. [API Contract](#api-contract)
9. [LLM Integration](#llm-integration)
10. [Ethical Guidelines](#ethical-guidelines)
11. [GDPR & Privacy Compliance](#gdpr--privacy-compliance)
12. [Monitoring & Metrics](#monitoring--metrics)

---

## Current State

### OpenLibrary Authors (14.7M total)

| External ID | Count | Wikidata Linkable |
|-------------|-------|-------------------|
| Wikidata    | 174,436 | Direct |
| VIAF        | 181,326 | Via crosswalk |
| ISNI        | 166,605 | Via crosswalk |
| Goodreads   | 14,526  | Limited |

### enriched_authors Table (8.15M rows)

| Field | Currently Populated | Target |
|-------|---------------------|--------|
| wikidata_id | 0 (0%) | 300K+ |
| gender | 0 (0%) | 300K+ |
| nationality | 0 (0%) | 300K+ |
| birth_year | 638,975 (8%) | 1M+ |
| cultural_region | 0 (0%) | Deprecated (see decisions) |
| bio | 28,307 (0.3%) | 100K+ |

---

## Architecture Decisions

### Decision 1: Facts vs Derived Data

```
+------------------+     FACTS ONLY      +------------------+
|   Alexandria     | ------------------> |     bendv3       |
|   (Data Layer)   |                     |   (App Layer)    |
+------------------+                     +------------------+
        |                                        |
        | Stores:                                | Derives:
        | - birth_place: "Lagos, Nigeria"        | - region: "West Africa"
        | - citizenship_qid: "Q1033"             | - diversity_tags: ["African"]
        | - gender_qid: "Q6581072"               | - display_gender: "Female"
        |                                        |
```

**Rationale**:
- Facts are stable; categorization schemes change with cultural context
- Apps can apply their own diversity frameworks
- Avoids Alexandria making subjective categorizations
- Enables A/B testing different categorization approaches

### Decision 2: Store Wikidata Q-IDs

Store raw Wikidata Q-IDs alongside human-readable labels:

```json
{
  "gender": "female",
  "gender_qid": "Q6581072",
  "citizenship": "Nigeria",
  "citizenship_qid": "Q1033",
  "birth_place": "Lagos",
  "birth_place_qid": "Q8673"
}
```

**Rationale**:
- Q-IDs are stable identifiers
- Consumers can resolve to their preferred label/language
- Enables joining with Wikidata for additional properties
- Future-proofs against label changes

### Decision 3: No Inference of Sensitive Data

**NEVER infer** these fields - only capture if explicitly stated in Wikidata:
- Ethnicity (P172)
- Sexual orientation (P91)
- Religion (P140)
- Disability status

**MAY extract** from unstructured text via LLM:
- Birth year (factual)
- Death year (factual)
- Nationality (usually stated)
- Gender (usually stated via pronouns)

### Decision 4: Consumer-Side Region Mapping

Alexandria does NOT map birth_place to global regions. Instead:

```
Alexandria provides:
  birth_place: "Lagos"
  birth_place_qid: "Q8673"
  citizenship: "Nigeria"
  citizenship_qid: "Q1033"

bendv3 maintains mapping table:
  Q1033 (Nigeria) -> region: "West Africa" -> continent: "Africa"

bendv3 derives:
  author.regions = ["West Africa", "Africa"]
  author.diversity_tags = ["African author", "Nigerian author"]
```

---

## Data Model

### Schema Changes to enriched_authors

```sql
-- New columns to add
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_place TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS birth_place_qid TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS death_place TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS death_place_qid TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS citizenship_qid TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS gender_qid TEXT;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS occupations TEXT[];
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS languages TEXT[];
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS awards TEXT[];
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS literary_movements TEXT[];
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS wikidata_enriched_at TIMESTAMPTZ;
ALTER TABLE enriched_authors ADD COLUMN IF NOT EXISTS enrichment_source TEXT; -- 'wikidata', 'wikipedia_llm', 'isbndb'

-- Deprecate cultural_region (consumer responsibility now)
COMMENT ON COLUMN enriched_authors.cultural_region IS 'DEPRECATED: Use citizenship + birth_place for consumer-side region derivation';

-- Index for unenriched author queries
CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_null
ON enriched_authors (author_key)
WHERE wikidata_id IS NULL;

-- Index for sync tracking
CREATE INDEX IF NOT EXISTS idx_enriched_authors_wikidata_sync
ON enriched_authors (wikidata_enriched_at)
WHERE wikidata_id IS NOT NULL;
```

### Metadata JSONB Structure

Store additional Wikidata properties in the existing `metadata` column:

```json
{
  "wikidata": {
    "qid": "Q34660",
    "fetched_at": "2025-12-12T00:00:00Z",
    "properties": {
      "P106": ["Q36180", "Q482980"],  // occupations: writer, novelist
      "P135": ["Q37068"],              // movement: romanticism
      "P166": ["Q37922"],              // award: Nobel Prize in Literature
      "P1412": ["Q1860", "Q150"]       // languages: English, French
    }
  },
  "enrichment_history": [
    {"source": "wikidata", "at": "2025-12-12T00:00:00Z", "fields": ["gender", "birth_year"]},
    {"source": "wikipedia_llm", "at": "2025-12-13T00:00:00Z", "fields": ["bio"]}
  ]
}
```

---

## Wikidata Field Mapping

### Core Fields (Phase 1-2)

| enriched_authors Column | Wikidata Property | Notes |
|------------------------|-------------------|-------|
| wikidata_id | Q-ID | e.g., "Q34660" |
| gender | P21 | sex or gender |
| gender_qid | P21 (raw) | Q6581097=male, Q6581072=female |
| nationality | P27 | country of citizenship (label) |
| citizenship_qid | P27 (raw) | Country Q-ID |
| birth_year | P569 | date of birth (year extracted) |
| death_year | P570 | date of death (year extracted) |
| birth_place | P19 | place of birth (label) |
| birth_place_qid | P19 (raw) | Place Q-ID |

### Extended Fields (Phase 3+)

| enriched_authors Column | Wikidata Property | Notes |
|------------------------|-------------------|-------|
| occupations[] | P106 | occupation (multiple) |
| languages[] | P1412 | languages spoken/written |
| awards[] | P166 | awards received |
| literary_movements[] | P135 | movement |
| author_photo_url | P18 | image (Commons URL) |

### Sensitive Fields (Explicit Only)

| Field | Wikidata Property | Capture Rule |
|-------|-------------------|--------------|
| ethnicity | P172 | ONLY if present in Wikidata |
| sexual_orientation | P91 | ONLY if present in Wikidata |
| religion | P140 | ONLY if present in Wikidata |

These go in `metadata.wikidata.sensitive` and are NEVER inferred.

---

## Implementation Phases

```
Phase 1                 Phase 2                 Phase 3                 Phase 4
[Seed Wikidata IDs]     [SPARQL Enrichment]     [Expand Coverage]       [LLM Fallback]
      |                       |                       |                       |
      v                       v                       v                       v
+-------------+         +-------------+         +-------------+         +-------------+
| Copy IDs    |         | Batch query |         | VIAF->Wiki  |         | Wikipedia   |
| from OL     |         | Wikidata    |         | ISNI->Wiki  |         | + Gemini    |
| remote_ids  |         | for 174K    |         | crosswalk   |         | extraction  |
+-------------+         +-------------+         +-------------+         +-------------+
      |                       |                       |                       |
   174,436               Gender, DOB,            +50-100K              High-priority
   authors               nationality             authors               authors only
```

### Phase 1: Seed Wikidata IDs (Immediate)

**Goal**: Populate `wikidata_id` from existing OpenLibrary `remote_ids`

```sql
-- One-time migration
UPDATE enriched_authors ea
SET wikidata_id = a.data->'remote_ids'->>'wikidata'
FROM authors a
WHERE ea.author_key = a.key
  AND a.data->'remote_ids'->>'wikidata' IS NOT NULL
  AND ea.wikidata_id IS NULL;
```

**Expected yield**: 174,436 authors with Wikidata IDs

### Phase 2: SPARQL Batch Enrichment

**Goal**: Fetch diversity data for all authors with Wikidata IDs

```sparql
SELECT ?author ?authorLabel ?genderLabel ?gender
       ?citizenshipLabel ?citizenship ?dob ?dod
       ?birthPlaceLabel ?birthPlace
WHERE {
  VALUES ?author { wd:Q34660 wd:Q36322 wd:Q7751 }  # Batch of Q-IDs

  OPTIONAL { ?author wdt:P21 ?gender. }
  OPTIONAL { ?author wdt:P27 ?citizenship. }
  OPTIONAL { ?author wdt:P569 ?dob. }
  OPTIONAL { ?author wdt:P570 ?dod. }
  OPTIONAL { ?author wdt:P19 ?birthPlace. }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

**Implementation**:
- Batch size: 50 Q-IDs per SPARQL query (Wikidata limit)
- Rate limit: 1 request/second (be nice to Wikidata)
- Run as Cloudflare Worker cron or local script

### Phase 3: VIAF/ISNI Crosswalk

**Goal**: Find Wikidata IDs for authors who have VIAF/ISNI but not Wikidata

```sparql
SELECT ?item ?itemLabel ?viaf WHERE {
  VALUES ?viaf { "72254511" "54316634" }  # VIAF IDs from OL
  ?item wdt:P214 ?viaf.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

**Expected yield**: +50,000-100,000 additional authors

### Phase 4: Wikipedia + LLM Fallback

**Goal**: Extract data from Wikipedia bios for high-priority authors without Wikidata

**Criteria for "high-priority"**:
- book_count >= 10 in enriched_authors
- No wikidata_id after Phase 3
- Has Wikipedia article (check via Wikipedia API)

**Process**:
1. Fetch Wikipedia article via API
2. Send to Gemini Flash with structured output schema
3. Store with `enrichment_source = 'wikipedia_llm'`

---

## Technical Implementation

### Worker Endpoint: POST /api/authors/enrich-wikidata

```typescript
interface WikidataEnrichRequest {
  author_keys?: string[];     // Specific authors to enrich
  limit?: number;             // Max authors to process (default 100)
  force_refresh?: boolean;    // Re-fetch even if already enriched
}

interface WikidataEnrichResponse {
  processed: number;
  enriched: number;
  errors: number;
  results: {
    author_key: string;
    wikidata_id: string | null;
    fields_updated: string[];
    error?: string;
  }[];
}
```

### SPARQL Query Builder

```typescript
// worker/services/wikidata-client.ts

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';

interface WikidataAuthor {
  qid: string;
  gender?: string;
  gender_qid?: string;
  citizenship?: string;
  citizenship_qid?: string;
  birth_year?: number;
  death_year?: number;
  birth_place?: string;
  birth_place_qid?: string;
  occupations?: string[];
  image_url?: string;
}

async function fetchAuthorBatch(qids: string[]): Promise<Map<string, WikidataAuthor>> {
  const values = qids.map(q => `wd:${q}`).join(' ');

  const query = `
    SELECT ?author ?genderLabel ?gender ?citizenshipLabel ?citizenship
           ?dob ?dod ?birthPlaceLabel ?birthPlace ?image
           (GROUP_CONCAT(DISTINCT ?occupationLabel; separator="|") as ?occupations)
    WHERE {
      VALUES ?author { ${values} }
      OPTIONAL { ?author wdt:P21 ?gender. }
      OPTIONAL { ?author wdt:P27 ?citizenship. }
      OPTIONAL { ?author wdt:P569 ?dob. }
      OPTIONAL { ?author wdt:P570 ?dod. }
      OPTIONAL { ?author wdt:P19 ?birthPlace. }
      OPTIONAL { ?author wdt:P18 ?image. }
      OPTIONAL { ?author wdt:P106 ?occupation. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?author ?genderLabel ?gender ?citizenshipLabel ?citizenship
             ?dob ?dod ?birthPlaceLabel ?birthPlace ?image
  `;

  const response = await fetch(WIKIDATA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'Alexandria/1.0 (https://alexandria.ooheynerds.com)'
    },
    body: `query=${encodeURIComponent(query)}`
  });

  // Parse and return...
}
```

### Cron Job Configuration

```jsonc
// wrangler.jsonc addition
{
  "triggers": {
    "crons": [
      "0 3 * * *"  // Run at 3 AM UTC daily (aligns with Wikidata maintenance windows)
    ]
  }
}
```

```typescript
// worker/index.ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 3 * * *') {
      await runWikidataEnrichmentBatch(env, { limit: 1000 });
    }
  }
}
```

---

## Rate Limiting & Error Handling

### Wikidata API Limits

Wikidata Query Service is a public resource. Be respectful:

| Limit | Value | Notes |
|-------|-------|-------|
| Requests/second | 1 | Enforced via token bucket |
| Batch size | 50 Q-IDs | Per SPARQL query |
| Timeout | 60 seconds | SPARQL query timeout |
| Daily budget | 50,000 | Self-imposed to avoid blocking |

### Rate Limiter Implementation

```typescript
// worker/services/rate-limiter.ts

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number = 1, refillRate: number = 1) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) / this.refillRate * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

const wikidataRateLimiter = new TokenBucketRateLimiter(1, 1); // 1 req/sec
```

### Retry Strategy with Exponential Backoff

```typescript
// worker/services/wikidata-client.ts

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000
};

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      await wikidataRateLimiter.acquire();
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on 4xx errors (except 429)
      if (error instanceof Response && error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;
      }

      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt),
          config.maxDelayMs
        );
        // Add jitter (0-25% of delay)
        const jitter = delay * Math.random() * 0.25;
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      }
    }
  }

  throw lastError!;
}
```

### Error Classification

| HTTP Status | Action | Retry |
|-------------|--------|-------|
| 200 | Success | N/A |
| 429 | Rate limited | Yes, with backoff |
| 500-503 | Server error | Yes, with backoff |
| 400 | Bad query | No, log and skip |
| 404 | Q-ID not found | No, mark as not in Wikidata |

---

## API Contract

### Updated Search Response

```typescript
interface SearchResult {
  // Existing fields...
  isbn: string;
  title: string;
  author: string;

  // NEW: Author diversity data (when available)
  author_diversity?: {
    gender?: string;
    gender_qid?: string;
    nationality?: string;
    citizenship_qid?: string;
    birth_year?: number;
    birth_place?: string;
    birth_place_qid?: string;
    wikidata_id?: string;
  };

  // Flag for consumers to know if full data available
  has_author_diversity_data: boolean;
}
```

### New Endpoint: GET /api/authors/:key

```typescript
interface AuthorResponse {
  author_key: string;           // "/authors/OL1234A"
  name: string;

  // Identity
  gender?: string;
  gender_qid?: string;

  // Geography
  nationality?: string;
  citizenship_qid?: string;
  birth_place?: string;
  birth_place_qid?: string;
  death_place?: string;
  death_place_qid?: string;

  // Dates
  birth_year?: number;
  death_year?: number;

  // Career
  occupations?: string[];
  languages?: string[];
  literary_movements?: string[];
  awards?: string[];

  // Content
  bio?: string;
  bio_source?: string;
  author_photo_url?: string;

  // External IDs
  wikidata_id?: string;
  openlibrary_author_id?: string;
  goodreads_author_ids?: string[];

  // Metadata
  book_count: number;
  enrichment_source?: string;
  wikidata_enriched_at?: string;

  // Raw Q-IDs for consumer-side resolution
  wikidata_qids?: {
    gender?: string;
    citizenship?: string;
    birth_place?: string;
    occupations?: string[];
  };
}
```

---

## LLM Integration

### When to Use LLM

```
                         Has Wikidata ID?
                               |
                    +----------+----------+
                    |                     |
                   YES                    NO
                    |                     |
            Use SPARQL query        Has Wikipedia article?
                    |                     |
                    |          +----------+----------+
                    |          |                     |
                    |         YES                    NO
                    |          |                     |
                    |    Use Gemini Flash      Skip (low priority)
                    |    + structured output        |
                    |          |                     |
                    v          v                     v
              [Enriched]  [Enriched]           [Not enriched]
```

### Gemini Flash Structured Output

```typescript
// worker/services/llm-extractor.ts

interface AuthorBioExtraction {
  birth_year: number | null;
  death_year: number | null;
  gender: 'male' | 'female' | 'non-binary' | 'unknown';
  nationality: string | null;
  birth_place: string | null;
  occupations: string[];
  notable_works: string[];
}

async function extractAuthorDataFromBio(
  bio: string,
  authorName: string,
  env: Env
): Promise<AuthorBioExtraction> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Extract structured author information from this biography of ${authorName}.

Biography:
${bio}

Extract ONLY explicitly stated facts. Do not infer or guess. If information is not clearly stated, use null.`
        }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            birth_year: { type: 'integer', nullable: true },
            death_year: { type: 'integer', nullable: true },
            gender: {
              type: 'string',
              enum: ['male', 'female', 'non-binary', 'unknown']
            },
            nationality: { type: 'string', nullable: true },
            birth_place: { type: 'string', nullable: true },
            occupations: {
              type: 'array',
              items: { type: 'string' }
            },
            notable_works: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['gender', 'occupations', 'notable_works']
        }
      }
    })
  });

  const data = await response.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}
```

### Author Name Disambiguation (Wikipedia Fallback)

When using Wikipedia API for authors without Wikidata IDs, common names may match multiple pages. Use this disambiguation strategy:

```typescript
// worker/services/wikipedia-resolver.ts

interface WikipediaSearchResult {
  title: string;
  pageid: number;
  snippet: string;
  categories?: string[];
}

async function resolveAuthorWikipedia(
  authorName: string,
  knownBooks?: string[]
): Promise<WikipediaSearchResult | null> {
  // 1. Search Wikipedia for the author name
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(authorName)}&format=json&srlimit=5`;
  const results = await fetch(searchUrl).then(r => r.json());

  if (!results.query?.search?.length) return null;

  // 2. Filter to likely author pages
  const candidates = results.query.search.filter((r: WikipediaSearchResult) => {
    const snippet = r.snippet.toLowerCase();
    return (
      snippet.includes('author') ||
      snippet.includes('writer') ||
      snippet.includes('novelist') ||
      snippet.includes('poet') ||
      snippet.includes('born') // Biographical pages often mention birth
    );
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // 3. If multiple candidates, score by known book mentions
  if (knownBooks?.length) {
    for (const candidate of candidates) {
      const pageContent = await fetchWikipediaContent(candidate.pageid);
      const matchedBooks = knownBooks.filter(book =>
        pageContent.toLowerCase().includes(book.toLowerCase())
      );
      if (matchedBooks.length > 0) {
        return candidate; // Found a page mentioning known works
      }
    }
  }

  // 4. Default to first biographical result
  return candidates[0];
}
```

**Disambiguation Rules:**
1. Prioritize pages with "author", "writer", "novelist" in snippet
2. If multiple matches, check for mentions of author's known books
3. If still ambiguous, skip (don't enrich with wrong data)
4. Log ambiguous cases for manual review

---

## Ethical Guidelines

### Data Collection Principles

1. **Public Information Only**: Only collect data that authors have made public
2. **No Inference of Sensitive Data**: Never guess ethnicity, sexuality, religion, disability
3. **Source Attribution**: Always track where data came from
4. **Right to Correction**: Provide mechanism for authors to correct their data
5. **Minimal Collection**: Only collect what's needed for the feature

### Sensitive Field Handling

| Field | Collection Rule | Storage |
|-------|-----------------|---------|
| Gender | Collect if in Wikidata or explicitly stated | Main table |
| Nationality | Collect if in Wikidata or explicitly stated | Main table |
| Ethnicity | ONLY if in Wikidata P172 | metadata.wikidata.sensitive |
| Sexual Orientation | ONLY if in Wikidata P91 | metadata.wikidata.sensitive |
| Religion | ONLY if in Wikidata P140 | metadata.wikidata.sensitive |

### Consumer Guidelines

Provide documentation for bendv3 on responsible use:

```markdown
## Diversity Data Usage Guidelines

1. **Avoid Stereotyping**: Don't use diversity data to make assumptions about writing style or content
2. **User Control**: Let users opt-in to diversity-based recommendations
3. **Transparent**: Show users why a book was recommended
4. **Balanced**: Don't over-index on diversity at the expense of relevance
```

---

## GDPR & Privacy Compliance

### Data Protection Principles

Alexandria processes publicly available data about authors, but must still respect privacy regulations:

| Principle | Implementation |
|-----------|----------------|
| **Lawful Basis** | Legitimate interest in providing book metadata |
| **Data Minimization** | Only collect fields needed for the feature |
| **Accuracy** | Source from authoritative sources (Wikidata) |
| **Storage Limitation** | No retention limit for public biographical data |
| **Integrity** | Track data provenance (`enrichment_source`) |

### Sensitive Data Handling

Per GDPR Article 9, "special categories" require extra care:

| Field | GDPR Category | Our Approach |
|-------|---------------|--------------|
| Gender | Not special category | Collect if public |
| Nationality | Not special category | Collect if public |
| Ethnicity | Special category | **Only if in Wikidata** (author self-disclosed) |
| Sexual orientation | Special category | **Only if in Wikidata** (author self-disclosed) |
| Religion | Special category | **Only if in Wikidata** (author self-disclosed) |

### Right to Erasure (GDPR Article 17)

If an author requests removal of their data:

```typescript
// DELETE /api/authors/:key/diversity-data
app.delete('/api/authors/:key/diversity-data', async (c) => {
  const authorKey = c.req.param('key');

  // Clear diversity fields but keep basic author record
  await sql`
    UPDATE enriched_authors
    SET
      gender = 'Unknown',
      gender_qid = NULL,
      nationality = NULL,
      citizenship_qid = NULL,
      birth_place = NULL,
      birth_place_qid = NULL,
      wikidata_id = NULL,
      bio = NULL,
      metadata = metadata - 'wikidata' - 'sensitive',
      updated_at = NOW()
    WHERE author_key = ${authorKey}
  `;

  // Log the erasure request
  env.ANALYTICS.writeDataPoint({
    blobs: ['gdpr_erasure', authorKey],
    indexes: ['erasure_request']
  });

  return c.json({ success: true, message: 'Diversity data removed' });
});
```

### Data Provenance

Always track where data came from:

```typescript
interface EnrichmentSource {
  source: 'wikidata' | 'wikipedia_llm' | 'isbndb' | 'manual';
  fetched_at: string;      // ISO timestamp
  wikidata_qid?: string;   // If from Wikidata
  confidence?: number;     // 0-1 for LLM extractions
}
```

### Consumer Responsibilities (bendv3)

Document that consumers must:
1. Display diversity data only with user consent
2. Allow users to hide diversity-based features
3. Not use diversity data for discriminatory purposes
4. Provide clear attribution ("Data from Wikidata")

---

## Monitoring & Metrics

### Analytics Engine Events

```typescript
// Track enrichment pipeline
env.ANALYTICS.writeDataPoint({
  blobs: ['wikidata_enrichment', authorKey, source],
  doubles: [fieldsUpdated, latencyMs],
  indexes: [success ? 'success' : 'error']
});
```

### Key Metrics

| Metric | Target | Query |
|--------|--------|-------|
| Authors with wikidata_id | 300K+ | `SELECT COUNT(*) WHERE wikidata_id IS NOT NULL` |
| Authors with gender | 250K+ | `SELECT COUNT(*) WHERE gender != 'Unknown'` |
| Authors with nationality | 200K+ | `SELECT COUNT(*) WHERE nationality IS NOT NULL` |
| Enrichment rate | 1000/day | Analytics Engine |
| SPARQL error rate | <1% | Analytics Engine |

### Dashboard Queries

```sql
-- Enrichment coverage by source
SELECT
  enrichment_source,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM enriched_authors
WHERE wikidata_id IS NOT NULL
GROUP BY enrichment_source;

-- Gender distribution
SELECT
  gender,
  COUNT(*) as count
FROM enriched_authors
WHERE gender IS NOT NULL AND gender != 'Unknown'
GROUP BY gender
ORDER BY count DESC;

-- Top nationalities
SELECT
  nationality,
  COUNT(*) as count
FROM enriched_authors
WHERE nationality IS NOT NULL
GROUP BY nationality
ORDER BY count DESC
LIMIT 20;
```

---

## Appendix A: Wikidata Property Reference

| Property | ID | Example Value |
|----------|-----|---------------|
| instance of | P31 | Q5 (human) |
| sex or gender | P21 | Q6581097 (male), Q6581072 (female) |
| country of citizenship | P27 | Q30 (USA), Q145 (UK) |
| date of birth | P569 | +1965-06-12T00:00:00Z |
| date of death | P570 | +2020-01-15T00:00:00Z |
| place of birth | P19 | Q60 (New York City) |
| place of death | P20 | Q65 (Los Angeles) |
| occupation | P106 | Q36180 (writer) |
| languages spoken | P1412 | Q1860 (English) |
| award received | P166 | Q37922 (Nobel Prize in Literature) |
| movement | P135 | Q37068 (romanticism) |
| ethnic group | P172 | (varies) |
| sexual orientation | P91 | (varies) |
| religion | P140 | (varies) |
| image | P18 | (Commons filename) |
| VIAF ID | P214 | 72254511 |
| ISNI | P213 | 0000000120260318 |
| GND ID | P227 | 124042465 |

---

## Appendix B: Region Mapping (Consumer Reference)

> **Note**: This mapping is provided as a reference for bendv3 implementation.
> Region derivation is a **consumer responsibility**, not Alexandria's.
> This section should be moved to bendv3 documentation when implemented.

Example mapping table for bendv3 to derive regions from citizenship Q-IDs:

```typescript
const REGION_MAP: Record<string, { region: string; continent: string }> = {
  // Africa
  'Q1033': { region: 'West Africa', continent: 'Africa' },      // Nigeria
  'Q258': { region: 'Southern Africa', continent: 'Africa' },   // South Africa
  'Q114': { region: 'East Africa', continent: 'Africa' },       // Kenya
  'Q79': { region: 'North Africa', continent: 'Africa' },       // Egypt

  // Asia
  'Q148': { region: 'East Asia', continent: 'Asia' },           // China
  'Q17': { region: 'East Asia', continent: 'Asia' },            // Japan
  'Q668': { region: 'South Asia', continent: 'Asia' },          // India

  // Europe
  'Q145': { region: 'Western Europe', continent: 'Europe' },    // UK
  'Q142': { region: 'Western Europe', continent: 'Europe' },    // France
  'Q183': { region: 'Central Europe', continent: 'Europe' },    // Germany

  // Americas
  'Q30': { region: 'North America', continent: 'Americas' },    // USA
  'Q16': { region: 'North America', continent: 'Americas' },    // Canada
  'Q155': { region: 'South America', continent: 'Americas' },   // Brazil
  'Q96': { region: 'Central America', continent: 'Americas' },  // Mexico

  // Oceania
  'Q408': { region: 'Oceania', continent: 'Oceania' },          // Australia
  'Q664': { region: 'Oceania', continent: 'Oceania' },          // New Zealand
};
```

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] Run Phase 1 SQL migration to seed wikidata_ids
3. [ ] Implement Wikidata SPARQL client in worker
4. [ ] Add GET /api/authors/:key endpoint
5. [ ] Set up cron job for batch enrichment
6. [ ] Update bendv3 to consume author diversity data
7. [ ] Create monitoring dashboard
