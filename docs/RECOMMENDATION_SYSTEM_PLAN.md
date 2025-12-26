# BooksTrack Recommendation System - Technical Plan

**Version:** 1.0 DRAFT  
**Status:** Ready for Deep Review  
**Author:** Claude + Justin  
**Created:** December 26, 2025  
**Target Completion:** Q1 2026

---

## Executive Summary

This plan implements a hybrid book recommendation system using:
1. **pgvector** in Alexandria PostgreSQL for unified SQL+vector queries
2. **Literary awards database** as quality signals (50+ international awards)
3. **Content embeddings** from book descriptions via Workers AI
4. **Collaborative filtering** infrastructure for future user-based recommendations

The architecture keeps Alexandria as the pure book metadata hub while enabling sophisticated recommendation queries that combine vector similarity, award signals, and metadata filtering in single SQL statements.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Alexandria PostgreSQL                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ enriched_works   │  │ book_embeddings  │  │ literary_awards  │          │
│  │ enriched_editions│←→│ (pgvector)       │←→│ award_winners    │          │
│  │ enriched_authors │  │ 768-dim vectors  │  │ award_categories │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│           ↑                    ↑                      ↑                     │
│           └────────────────────┴──────────────────────┘                     │
│                    Single SQL query combines all three                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↑
                    Cloudflare Tunnel (Hyperdrive)
                                    ↑
┌─────────────────────────────────────────────────────────────────────────────┐
│                              bendv3 Worker                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ recommendation   │  │ Workers AI       │  │ User preferences │          │
│  │ service          │  │ embedding gen    │  │ (D1/KV)          │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↑
                              REST API
                                    ↑
┌─────────────────────────────────────────────────────────────────────────────┐
│                         books-v3 / books-flutter                             │
│                    iOS/Flutter apps with SwiftData/local storage            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: PostgreSQL pgvector Setup

### 1.1 Install pgvector Extension

**Location:** Tower PostgreSQL Docker container

```bash
# SSH to Tower and install pgvector
ssh root@Tower.local

# Enter postgres container
docker exec -it postgres bash

# Install build dependencies (if needed)
apt-get update && apt-get install -y postgresql-server-dev-16 git make gcc

# Clone and build pgvector
cd /tmp
git clone --branch v0.8.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
make install

# Exit container and restart postgres
exit
docker restart postgres
```

**Alternative: Use pgvector Docker image**
```bash
# If rebuilding, use official pgvector image
docker pull pgvector/pgvector:pg16-v0.8.1
```

### 1.2 Enable Extension

```sql
-- Connect to openlibrary database
\c openlibrary

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
SELECT * FROM pg_extension WHERE extname = 'vector';
```

---

## Phase 2: Schema Design

### 2.1 Book Embeddings Table

**Migration:** `004_add_book_embeddings.sql`

```sql
-- ============================================================================
-- Migration 004: Add book embeddings for vector similarity search
-- ============================================================================

BEGIN;

-- Create book_embeddings table
CREATE TABLE IF NOT EXISTS book_embeddings (
    -- Primary key matches enriched_works
    work_key TEXT PRIMARY KEY REFERENCES enriched_works(work_key) ON DELETE CASCADE,
    
    -- Vector embedding (768 dimensions for Workers AI bge-base-en-v1.5)
    embedding vector(768) NOT NULL,
    
    -- Embedding metadata
    model_name TEXT NOT NULL DEFAULT 'bge-base-en-v1.5',
    model_version TEXT,
    
    -- Source text used for embedding (for debugging/recomputation)
    source_text_hash TEXT,  -- SHA256 of input text
    
    -- Quality tracking
    embedding_quality REAL,  -- 0.0-1.0 confidence score
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create HNSW index for fast approximate nearest neighbor search
-- m = 16 (connections per layer), ef_construction = 64 (build quality)
CREATE INDEX IF NOT EXISTS idx_book_embeddings_vector 
ON book_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Index for finding books without embeddings
CREATE INDEX IF NOT EXISTS idx_book_embeddings_created 
ON book_embeddings (created_at DESC);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_book_embeddings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_book_embeddings_timestamp
BEFORE UPDATE ON book_embeddings
FOR EACH ROW EXECUTE FUNCTION update_book_embeddings_timestamp();

COMMENT ON TABLE book_embeddings IS 'Vector embeddings for book similarity search via pgvector';
COMMENT ON COLUMN book_embeddings.embedding IS '768-dimensional vector from Workers AI bge-base-en-v1.5';

COMMIT;
```

### 2.2 Literary Awards Tables

**Migration:** `005_add_literary_awards.sql`

```sql
-- ============================================================================
-- Migration 005: Add literary awards database for recommendation signals
-- ============================================================================

BEGIN;

-- ============================================================================
-- Table: literary_awards
-- Master list of all tracked literary awards
-- ============================================================================
CREATE TABLE IF NOT EXISTS literary_awards (
    award_id TEXT PRIMARY KEY,  -- slug: 'booker-prize', 'pulitzer-fiction'
    
    -- Basic info
    name TEXT NOT NULL,
    short_name TEXT,  -- 'Booker', 'Pulitzer'
    
    -- Classification
    country TEXT,  -- 'UK', 'USA', 'International'
    region TEXT,   -- 'Europe', 'North America', 'Asia', etc.
    language TEXT, -- Primary language: 'en', 'fr', 'es', etc.
    
    -- Award characteristics
    genre_focus TEXT[],  -- ['fiction', 'literary'] or ['science-fiction', 'fantasy']
    audience TEXT,       -- 'adult', 'young-adult', 'children'
    
    -- Prestige scoring (manual curation)
    prestige_tier INTEGER DEFAULT 3 CHECK (prestige_tier BETWEEN 1 AND 5),
    -- 5 = Nobel, Booker, Pulitzer
    -- 4 = National Book Award, Women's Prize, Hugo
    -- 3 = Major genre awards (Nebula, Edgar)
    -- 2 = Regional/specialized awards
    -- 1 = Indie/emerging awards
    
    -- Award info
    first_awarded INTEGER,  -- Year first given
    frequency TEXT DEFAULT 'annual',  -- annual, biennial, etc.
    is_active BOOLEAN DEFAULT true,
    
    -- Source tracking
    official_url TEXT,
    wikipedia_url TEXT,
    scrape_source TEXT,  -- URL or API we pull from
    last_scraped_at TIMESTAMPTZ,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- ============================================================================
-- Table: award_categories
-- Some awards have multiple categories (fiction, nonfiction, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS award_categories (
    category_id TEXT PRIMARY KEY,  -- 'booker-prize-fiction', 'pulitzer-fiction'
    award_id TEXT NOT NULL REFERENCES literary_awards(award_id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,  -- 'Fiction', 'General Nonfiction'
    genre TEXT,          -- Normalized genre
    
    is_primary BOOLEAN DEFAULT false,  -- Main category for the award
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: award_winners
-- Books that won or were nominated for awards
-- ============================================================================
CREATE TABLE IF NOT EXISTS award_winners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Award reference
    award_id TEXT NOT NULL REFERENCES literary_awards(award_id) ON DELETE CASCADE,
    category_id TEXT REFERENCES award_categories(category_id) ON DELETE SET NULL,
    
    -- Book reference (nullable - may not match our catalog)
    work_key TEXT REFERENCES enriched_works(work_key) ON DELETE SET NULL,
    isbn TEXT,  -- If we have it
    
    -- Award details
    year INTEGER NOT NULL,  -- Award year (may differ from publication year)
    status TEXT NOT NULL CHECK (status IN ('winner', 'shortlist', 'longlist', 'nominee', 'finalist')),
    
    -- Book info (stored for unmatched books)
    title TEXT NOT NULL,
    author_name TEXT,
    publisher TEXT,
    publication_year INTEGER,
    
    -- Matching metadata
    match_confidence REAL,  -- 0.0-1.0 how sure we are of work_key match
    matched_at TIMESTAMPTZ,
    match_method TEXT,  -- 'isbn', 'title-author', 'manual'
    
    -- Source tracking
    source_url TEXT,
    scraped_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicates
    UNIQUE (award_id, year, title, status)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Literary awards
CREATE INDEX IF NOT EXISTS idx_literary_awards_country ON literary_awards(country);
CREATE INDEX IF NOT EXISTS idx_literary_awards_prestige ON literary_awards(prestige_tier DESC);
CREATE INDEX IF NOT EXISTS idx_literary_awards_genre ON literary_awards USING GIN(genre_focus);

-- Award categories
CREATE INDEX IF NOT EXISTS idx_award_categories_award ON award_categories(award_id);

-- Award winners
CREATE INDEX IF NOT EXISTS idx_award_winners_work ON award_winners(work_key) WHERE work_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_award_winners_year ON award_winners(year DESC);
CREATE INDEX IF NOT EXISTS idx_award_winners_award_year ON award_winners(award_id, year DESC);
CREATE INDEX IF NOT EXISTS idx_award_winners_status ON award_winners(status);
CREATE INDEX IF NOT EXISTS idx_award_winners_unmatched ON award_winners(created_at) WHERE work_key IS NULL;

-- ============================================================================
-- Computed recommendation score view
-- ============================================================================
CREATE OR REPLACE VIEW book_award_scores AS
SELECT 
    w.work_key,
    COUNT(DISTINCT aw.award_id) AS total_awards,
    COUNT(DISTINCT CASE WHEN aw.status = 'winner' THEN aw.award_id END) AS wins,
    COUNT(DISTINCT CASE WHEN aw.status IN ('shortlist', 'finalist') THEN aw.award_id END) AS shortlists,
    MAX(la.prestige_tier) AS max_prestige,
    -- Weighted score: wins * prestige * 10 + shortlists * prestige * 3
    SUM(
        CASE 
            WHEN aw.status = 'winner' THEN la.prestige_tier * 10
            WHEN aw.status IN ('shortlist', 'finalist') THEN la.prestige_tier * 3
            WHEN aw.status = 'longlist' THEN la.prestige_tier * 1
            ELSE 0
        END
    ) AS award_score
FROM enriched_works w
LEFT JOIN award_winners aw ON w.work_key = aw.work_key
LEFT JOIN literary_awards la ON aw.award_id = la.award_id
GROUP BY w.work_key;

-- ============================================================================
-- Triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION update_awards_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_literary_awards_timestamp
BEFORE UPDATE ON literary_awards
FOR EACH ROW EXECUTE FUNCTION update_awards_timestamp();

CREATE TRIGGER trigger_award_winners_timestamp
BEFORE UPDATE ON award_winners
FOR EACH ROW EXECUTE FUNCTION update_awards_timestamp();

COMMENT ON TABLE literary_awards IS 'Master list of literary awards tracked for recommendations';
COMMENT ON TABLE award_categories IS 'Categories within multi-category awards';
COMMENT ON TABLE award_winners IS 'Books that won or were nominated for literary awards';
COMMENT ON VIEW book_award_scores IS 'Computed award-based quality scores per work';

COMMIT;
```

### 2.3 Seed Data: Initial Awards

**Migration:** `006_seed_literary_awards.sql`

```sql
-- ============================================================================
-- Migration 006: Seed initial literary awards
-- ============================================================================

BEGIN;

-- Tier 5: Highest prestige (Nobel-level)
INSERT INTO literary_awards (award_id, name, short_name, country, region, language, genre_focus, audience, prestige_tier, first_awarded, official_url) VALUES
('nobel-literature', 'Nobel Prize in Literature', 'Nobel', 'Sweden', 'International', 'en', ARRAY['literary'], 'adult', 5, 1901, 'https://www.nobelprize.org/prizes/literature/'),
('booker-prize', 'Booker Prize', 'Booker', 'UK', 'International', 'en', ARRAY['literary', 'fiction'], 'adult', 5, 1969, 'https://thebookerprizes.com/'),
('pulitzer-fiction', 'Pulitzer Prize for Fiction', 'Pulitzer', 'USA', 'North America', 'en', ARRAY['literary', 'fiction'], 'adult', 5, 1948, 'https://www.pulitzer.org/'),
('international-booker', 'International Booker Prize', 'Intl Booker', 'UK', 'International', 'en', ARRAY['literary', 'fiction', 'translation'], 'adult', 5, 2005, 'https://thebookerprizes.com/');

-- Tier 4: Major awards
INSERT INTO literary_awards (award_id, name, short_name, country, region, language, genre_focus, audience, prestige_tier, first_awarded, official_url) VALUES
('national-book-award-fiction', 'National Book Award for Fiction', 'NBA Fiction', 'USA', 'North America', 'en', ARRAY['literary', 'fiction'], 'adult', 4, 1950, 'https://www.nationalbook.org/'),
('womens-prize', 'Womens Prize for Fiction', 'Womens Prize', 'UK', 'Europe', 'en', ARRAY['literary', 'fiction'], 'adult', 4, 1996, 'https://womensprizeforfiction.co.uk/'),
('hugo-award', 'Hugo Award for Best Novel', 'Hugo', 'USA', 'International', 'en', ARRAY['science-fiction', 'fantasy'], 'adult', 4, 1953, 'https://www.thehugoawards.org/'),
('nebula-award', 'Nebula Award for Best Novel', 'Nebula', 'USA', 'North America', 'en', ARRAY['science-fiction', 'fantasy'], 'adult', 4, 1966, 'https://nebulas.sfwa.org/'),
('carnegie-medal', 'Carnegie Medal', 'Carnegie', 'UK', 'Europe', 'en', ARRAY['literary'], 'children', 4, 1936, 'https://carnegiegreenaway.org.uk/'),
('newbery-medal', 'Newbery Medal', 'Newbery', 'USA', 'North America', 'en', ARRAY['literary'], 'children', 4, 1922, 'https://www.ala.org/alsc/awardsgrants/bookmedia/newberymedal'),
('costa-book-awards', 'Costa Book Awards', 'Costa', 'UK', 'Europe', 'en', ARRAY['literary', 'fiction', 'biography', 'poetry'], 'adult', 4, 1971, NULL),
('giller-prize', 'Scotiabank Giller Prize', 'Giller', 'Canada', 'North America', 'en', ARRAY['literary', 'fiction'], 'adult', 4, 1994, 'https://scotiabankgillerprize.ca/');

-- Tier 3: Major genre awards
INSERT INTO literary_awards (award_id, name, short_name, country, region, language, genre_focus, audience, prestige_tier, first_awarded, official_url) VALUES
('edgar-award', 'Edgar Award for Best Novel', 'Edgar', 'USA', 'North America', 'en', ARRAY['mystery', 'crime', 'thriller'], 'adult', 3, 1946, 'https://mysterywriters.org/'),
('world-fantasy-award', 'World Fantasy Award', 'World Fantasy', 'USA', 'International', 'en', ARRAY['fantasy'], 'adult', 3, 1975, 'https://www.worldfantasy.org/'),
('arthur-c-clarke', 'Arthur C. Clarke Award', 'Clarke', 'UK', 'Europe', 'en', ARRAY['science-fiction'], 'adult', 3, 1987, 'https://www.clarkeaward.com/'),
('dublin-literary-award', 'International Dublin Literary Award', 'Dublin', 'Ireland', 'International', 'en', ARRAY['literary', 'fiction'], 'adult', 3, 1996, 'https://dublinliteraryaward.ie/'),
('prix-goncourt', 'Prix Goncourt', 'Goncourt', 'France', 'Europe', 'fr', ARRAY['literary', 'fiction'], 'adult', 3, 1903, 'https://www.academie-goncourt.fr/'),
('premio-strega', 'Premio Strega', 'Strega', 'Italy', 'Europe', 'it', ARRAY['literary', 'fiction'], 'adult', 3, 1947, 'https://www.fondazionebellonci.it/'),
('akutagawa-prize', 'Akutagawa Prize', 'Akutagawa', 'Japan', 'Asia', 'ja', ARRAY['literary', 'fiction'], 'adult', 3, 1935, NULL),
('printz-award', 'Michael L. Printz Award', 'Printz', 'USA', 'North America', 'en', ARRAY['literary'], 'young-adult', 3, 2000, 'https://www.ala.org/yalsa/printz'),
('national-book-award-ya', 'National Book Award for Young Peoples Literature', 'NBA YA', 'USA', 'North America', 'en', ARRAY['literary'], 'young-adult', 3, 1996, 'https://www.nationalbook.org/');

-- Tier 2: Regional and specialized
INSERT INTO literary_awards (award_id, name, short_name, country, region, language, genre_focus, audience, prestige_tier, first_awarded, official_url) VALUES
('miles-franklin', 'Miles Franklin Award', 'Miles Franklin', 'Australia', 'Oceania', 'en', ARRAY['literary', 'fiction'], 'adult', 2, 1957, 'https://www.milesfranklin.com.au/'),
('governor-general', 'Governor Generals Literary Award', 'GG Award', 'Canada', 'North America', 'en', ARRAY['literary', 'fiction'], 'adult', 2, 1936, 'https://ggbooks.ca/'),
('baillie-gifford', 'Baillie Gifford Prize', 'Baillie Gifford', 'UK', 'Europe', 'en', ARRAY['nonfiction'], 'adult', 2, 1999, 'https://www.thebailliegiffordprize.co.uk/'),
('kirkus-prize', 'Kirkus Prize', 'Kirkus', 'USA', 'North America', 'en', ARRAY['fiction', 'nonfiction', 'young-adult'], 'adult', 2, 2014, 'https://www.kirkusreviews.com/prize/'),
('locus-award', 'Locus Award', 'Locus', 'USA', 'International', 'en', ARRAY['science-fiction', 'fantasy'], 'adult', 2, 1971, 'https://locusmag.com/'),
('bram-stoker', 'Bram Stoker Award', 'Stoker', 'USA', 'North America', 'en', ARRAY['horror'], 'adult', 2, 1987, 'https://horror.org/bram-stoker-awards/');

COMMIT;
```

---

## Phase 3: Embedding Generation Pipeline

### 3.1 Workers AI Integration (bendv3)

**New service:** `src/services/embedding-service.ts`

```typescript
// src/services/embedding-service.ts

import type { Ai } from '@cloudflare/workers-types';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  inputTokens: number;
}

export interface EmbeddingInput {
  workKey: string;
  title: string;
  description?: string;
  subjects?: string[];
  authorName?: string;
}

export class EmbeddingService {
  private ai: Ai;
  private model = '@cf/baai/bge-base-en-v1.5';
  
  constructor(ai: Ai) {
    this.ai = ai;
  }
  
  /**
   * Generate embedding for a single book
   */
  async generateBookEmbedding(input: EmbeddingInput): Promise<EmbeddingResult> {
    const text = this.buildEmbeddingText(input);
    
    const result = await this.ai.run(this.model, {
      text: [text],
    });
    
    return {
      embedding: result.data[0],
      model: this.model,
      inputTokens: Math.ceil(text.length / 4),
    };
  }
  
  /**
   * Batch generate embeddings (up to 100 at once)
   */
  async generateBatchEmbeddings(inputs: EmbeddingInput[]): Promise<EmbeddingResult[]> {
    const texts = inputs.map(input => this.buildEmbeddingText(input));
    
    const result = await this.ai.run(this.model, {
      text: texts,
    });
    
    return result.data.map((embedding: number[], i: number) => ({
      embedding,
      model: this.model,
      inputTokens: Math.ceil(texts[i].length / 4),
    }));
  }
  
  /**
   * Build text representation for embedding
   * Format: "Title by Author. Description. Subjects: subject1, subject2"
   */
  private buildEmbeddingText(input: EmbeddingInput): string {
    const parts: string[] = [];
    
    // Title and author
    if (input.authorName) {
      parts.push(`${input.title} by ${input.authorName}.`);
    } else {
      parts.push(`${input.title}.`);
    }
    
    // Description (truncate to ~500 chars for embedding quality)
    if (input.description) {
      const desc = input.description.slice(0, 500);
      parts.push(desc);
    }
    
    // Subjects/genres
    if (input.subjects && input.subjects.length > 0) {
      parts.push(`Subjects: ${input.subjects.slice(0, 10).join(', ')}`);
    }
    
    return parts.join(' ').trim();
  }
}
```

### 3.2 Alexandria Embedding Storage Endpoint

**New endpoint in Alexandria worker:** `POST /api/embeddings`

```typescript
// worker/src/routes/embeddings.ts

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const app = new Hono();

const storeEmbeddingSchema = z.object({
  work_key: z.string(),
  embedding: z.array(z.number()).length(768),
  model_name: z.string().default('bge-base-en-v1.5'),
  model_version: z.string().optional(),
  source_text_hash: z.string().optional(),
  embedding_quality: z.number().min(0).max(1).optional(),
});

// Store single embedding
app.post('/', zValidator('json', storeEmbeddingSchema), async (c) => {
  const data = c.req.valid('json');
  const db = c.get('db');
  
  const result = await db.query(`
    INSERT INTO book_embeddings (work_key, embedding, model_name, model_version, source_text_hash, embedding_quality)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (work_key) DO UPDATE SET
      embedding = EXCLUDED.embedding,
      model_name = EXCLUDED.model_name,
      model_version = EXCLUDED.model_version,
      source_text_hash = EXCLUDED.source_text_hash,
      embedding_quality = EXCLUDED.embedding_quality,
      updated_at = NOW()
    RETURNING work_key, created_at, updated_at
  `, [
    data.work_key,
    JSON.stringify(data.embedding),
    data.model_name,
    data.model_version,
    data.source_text_hash,
    data.embedding_quality,
  ]);
  
  return c.json({ success: true, data: result.rows[0] });
});

// Get similar books by work_key
app.get('/similar/:work_key', async (c) => {
  const workKey = c.req.param('work_key');
  const limit = parseInt(c.req.query('limit') || '10');
  const db = c.get('db');
  
  const result = await db.query(`
    WITH target AS (
      SELECT embedding FROM book_embeddings WHERE work_key = $1
    )
    SELECT 
      be.work_key,
      ew.title,
      ew.description,
      1 - (be.embedding <=> target.embedding) AS similarity
    FROM book_embeddings be
    CROSS JOIN target
    JOIN enriched_works ew ON be.work_key = ew.work_key
    WHERE be.work_key != $1
    ORDER BY be.embedding <=> target.embedding
    LIMIT $2
  `, [workKey, limit]);
  
  return c.json({ success: true, data: result.rows });
});

export default app;
```


---

## Phase 4: Award Scraping System

### 4.1 Scraper Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Award Scraping Pipeline                       │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ Scraper Jobs │ →  │ Raw Results  │ →  │ Book Matcher │       │
│  │ (Cron)       │    │ (JSON)       │    │ (ISBN/Title) │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                        │               │
│         │                                        ↓               │
│         │                               ┌──────────────┐        │
│         └──────────────────────────────→│ award_winners│        │
│                                         │ (PostgreSQL) │        │
│                                         └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Scraper Framework

**Location:** `alex/scripts/scrapers/`

```typescript
// scripts/scrapers/base-scraper.ts

export interface ScrapedAward {
  awardId: string;
  year: number;
  status: 'winner' | 'shortlist' | 'longlist' | 'nominee' | 'finalist';
  title: string;
  authorName?: string;
  isbn?: string;
  publisher?: string;
  publicationYear?: number;
  sourceUrl: string;
}

export abstract class BaseAwardScraper {
  abstract awardId: string;
  abstract name: string;
  abstract baseUrl: string;
  
  abstract scrapeYear(year: number): Promise<ScrapedAward[]>;
  
  async scrapeRange(startYear: number, endYear: number): Promise<ScrapedAward[]> {
    const results: ScrapedAward[] = [];
    
    for (let year = startYear; year <= endYear; year++) {
      console.log(`Scraping ${this.name} ${year}...`);
      const yearResults = await this.scrapeYear(year);
      results.push(...yearResults);
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
    }
    
    return results;
  }
}
```

### 4.3 Book Matching Service

```typescript
// scripts/scrapers/book-matcher.ts

interface MatchResult {
  workKey: string | null;
  confidence: number;
  method: 'isbn' | 'title-author' | 'title-only' | null;
}

export class BookMatcher {
  private db: any;
  
  constructor(db: any) {
    this.db = db;
  }
  
  async match(scraped: ScrapedAward): Promise<MatchResult> {
    // Strategy 1: ISBN exact match
    if (scraped.isbn) {
      const isbnMatch = await this.matchByIsbn(scraped.isbn);
      if (isbnMatch) {
        return { workKey: isbnMatch, confidence: 1.0, method: 'isbn' };
      }
    }
    
    // Strategy 2: Title + Author fuzzy match
    if (scraped.authorName) {
      const titleAuthorMatch = await this.matchByTitleAuthor(
        scraped.title,
        scraped.authorName
      );
      if (titleAuthorMatch) {
        return { workKey: titleAuthorMatch.workKey, confidence: titleAuthorMatch.confidence, method: 'title-author' };
      }
    }
    
    // Strategy 3: Title only (lower confidence)
    const titleMatch = await this.matchByTitle(scraped.title);
    if (titleMatch) {
      return { workKey: titleMatch.workKey, confidence: titleMatch.confidence, method: 'title-only' };
    }
    
    return { workKey: null, confidence: 0, method: null };
  }
  
  private async matchByIsbn(isbn: string): Promise<string | null> {
    const result = await this.db.query(`
      SELECT work_key FROM enriched_editions WHERE isbn = $1
    `, [isbn]);
    return result.rows[0]?.work_key || null;
  }
  
  private async matchByTitleAuthor(title: string, author: string): Promise<{ workKey: string; confidence: number } | null> {
    const result = await this.db.query(`
      SELECT 
        ew.work_key,
        similarity(ew.title, $1) AS title_sim,
        similarity(ea.name, $2) AS author_sim
      FROM enriched_works ew
      JOIN work_authors_enriched wae ON ew.work_key = wae.work_key
      JOIN enriched_authors ea ON wae.author_key = ea.author_key
      WHERE 
        ew.title % $1 AND
        ea.name % $2
      ORDER BY (similarity(ew.title, $1) + similarity(ea.name, $2)) DESC
      LIMIT 1
    `, [title, author]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    const confidence = (row.title_sim + row.author_sim) / 2;
    
    if (confidence < 0.6) return null;
    
    return { workKey: row.work_key, confidence };
  }
  
  private async matchByTitle(title: string): Promise<{ workKey: string; confidence: number } | null> {
    const result = await this.db.query(`
      SELECT 
        work_key,
        similarity(title, $1) AS sim
      FROM enriched_works
      WHERE title % $1
      ORDER BY similarity(title, $1) DESC
      LIMIT 1
    `, [title]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    if (row.sim < 0.8) return null;
    
    return { workKey: row.work_key, confidence: row.sim * 0.7 };
  }
}
```

### 4.4 Data Sources Priority

| Source | Quality | Coverage | Access |
|--------|---------|----------|--------|
| Wikipedia Lists | High | Excellent | Free, CC-licensed |
| Official Award Sites | Highest | Complete | May need scraping |
| Wikidata | High | Good | Free API |
| Airtable "Book Award Database" | High | 2000+ titles | Public |
| Goodreads Lists | Medium | Extensive | TOS concerns |

**Recommended approach:**
1. Start with Wikipedia/Wikidata for major awards
2. Supplement with official sites where Wikipedia is incomplete
3. Manual curation for edge cases

---

## Phase 5: Recommendation API

### 5.1 Combined Query Examples

**Similar books with award weighting:**

```sql
-- Find books similar to a given work, boosted by awards
WITH target AS (
  SELECT embedding FROM book_embeddings WHERE work_key = $1
),
similarities AS (
  SELECT 
    be.work_key,
    1 - (be.embedding <=> target.embedding) AS vector_similarity
  FROM book_embeddings be
  CROSS JOIN target
  WHERE be.work_key != $1
),
award_data AS (
  SELECT 
    work_key,
    COALESCE(award_score, 0) AS award_score
  FROM book_award_scores
)
SELECT 
  s.work_key,
  ew.title,
  ew.description,
  ea.name AS author_name,
  s.vector_similarity,
  COALESCE(ad.award_score, 0) AS award_score,
  -- Combined score: 70% similarity, 30% awards (normalized)
  (s.vector_similarity * 0.7) + (LEAST(ad.award_score, 100) / 100.0 * 0.3) AS combined_score
FROM similarities s
JOIN enriched_works ew ON s.work_key = ew.work_key
LEFT JOIN work_authors_enriched wae ON ew.work_key = wae.work_key AND wae.author_order = 0
LEFT JOIN enriched_authors ea ON wae.author_key = ea.author_key
LEFT JOIN award_data ad ON s.work_key = ad.work_key
ORDER BY combined_score DESC
LIMIT 20;
```

**Award-winning books in a genre:**

```sql
-- Top award-winning science fiction
SELECT 
  ew.work_key,
  ew.title,
  ea.name AS author_name,
  bas.wins,
  bas.shortlists,
  bas.award_score,
  array_agg(DISTINCT la.short_name) AS awards_won
FROM enriched_works ew
JOIN book_award_scores bas ON ew.work_key = bas.work_key
JOIN award_winners aw ON ew.work_key = aw.work_key AND aw.status = 'winner'
JOIN literary_awards la ON aw.award_id = la.award_id
LEFT JOIN work_authors_enriched wae ON ew.work_key = wae.work_key AND wae.author_order = 0
LEFT JOIN enriched_authors ea ON wae.author_key = ea.author_key
WHERE 'science-fiction' = ANY(ew.subject_tags)
GROUP BY ew.work_key, ew.title, ea.name, bas.wins, bas.shortlists, bas.award_score
ORDER BY bas.award_score DESC
LIMIT 20;
```

### 5.2 bendv3 Recommendation Endpoints

**New endpoints:**
- `GET /v3/recommendations/similar/:workKey` - Similar books by vector + awards
- `GET /v3/recommendations/awarded` - Top award-winning books
- `GET /v3/recommendations/genre/:genre` - Best in genre
- `GET /v3/recommendations/discover` - Personalized discovery (future)


---

## Phase 6: Implementation Timeline

### Week 1: Foundation
- [ ] Install pgvector on Tower PostgreSQL
- [ ] Run migrations 004-006
- [ ] Verify pgvector working with test vectors
- [ ] Update Alexandria Hyperdrive connection

### Week 2: Embedding Pipeline
- [ ] Implement EmbeddingService in bendv3
- [ ] Create embedding storage endpoint in Alexandria
- [ ] Test end-to-end: book → embedding → storage → retrieval
- [ ] Add embedding generation to enrichment workflow

### Week 3: Award Scrapers
- [ ] Build scraper framework
- [ ] Implement scrapers for top 10 awards:
  - Booker Prize
  - Pulitzer Fiction
  - National Book Award
  - Hugo Award
  - Nebula Award
  - Women's Prize
  - Newbery Medal
  - Carnegie Medal
  - Costa Book Awards
  - Giller Prize
- [ ] Run initial scrape (2010-2025)
- [ ] Match books to Alexandria catalog

### Week 4: Recommendation API
- [ ] Implement combined similarity + award queries
- [ ] Add `/v3/recommendations/similar/:workKey` endpoint
- [ ] Add `/v3/recommendations/awarded` endpoint
- [ ] Integration testing with books-v3/flutter

### Week 5: Backfill & Optimization
- [ ] Batch generate embeddings for high-quality books (isbndb_quality >= 70)
- [ ] Tune HNSW index parameters based on query patterns
- [ ] Performance benchmarking
- [ ] Add remaining award scrapers (40+ more)

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Vector similarity query latency | <100ms p95 | PostgreSQL query logs |
| Combined recommendation query | <150ms p95 | API response times |
| Book-to-award match rate | >80% | Matched vs total scraped |
| Embedding coverage | >500K books | COUNT(*) in book_embeddings |
| Award coverage | 50+ awards | COUNT(*) in literary_awards |
| Award winner coverage | >5000 books | COUNT(*) in award_winners |

---

## Cost Projections

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| pgvector (self-hosted) | $0 | Uses existing Tower PostgreSQL |
| Workers AI embeddings | ~$5-20 | 10K Neurons/day free, then $0.011/1K |
| Alexandria Worker | $0 | Under free tier |
| bendv3 Worker | $5 | Paid plan minimum |
| Scraping infrastructure | $0 | Runs on green dev server |
| **Total** | ~$5-25/month | Mostly free tier |

---

## Open Questions for Review

### 1. Embedding Model Choice
**Current:** BGE-base-en-v1.5 (768 dimensions)
- Pros: Fast, free on Workers AI, good quality
- Cons: English-only, smaller than some alternatives

**Alternatives:**
- `bge-large-en-v1.5` (1024 dim) - Better quality, higher cost
- `multilingual-e5-large` - Multi-language support
- OpenAI `text-embedding-3-small` (1536 dim) - Highest quality, paid

**Question:** Should we support multiple embedding models or standardize on one?

### 2. Award Score Weighting
**Current formula:**
```
score = (wins * prestige_tier * 10) + (shortlists * prestige_tier * 3) + (longlists * prestige_tier * 1)
```

**Considerations:**
- Should Nobel winner (tier 5) weight 5x more than Locus Award (tier 2)?
- Time decay? (Recent awards worth more than 20-year-old wins?)
- Genre normalization? (Hugo in sci-fi vs Booker in literary)

### 3. Collaborative Filtering Scope
When we add user-based recommendations:
- Store user preference embeddings in bendv3 (D1) or Alexandria?
- Privacy: How to anonymize while maintaining personalization?
- Cold start: Fallback to content-based until enough user data?

### 4. Scraping Ethics & Legality
- Wikipedia/Wikidata: CC-licensed, fully safe
- Official award sites: May have TOS restrictions
- Consider: Build partnerships with award organizations?
- Alternative: Use only structured data sources (Wikidata SPARQL)

### 5. Vector Index Maintenance
- HNSW indexes need periodic rebuilding as data grows
- When to rebuild? Nightly cron? On significant data changes?
- Monitor recall degradation over time

---

## Appendix A: pgvector Quick Reference

```sql
-- Distance operators
<->   -- L2 distance (Euclidean)
<#>   -- Inner product (negative)
<=>   -- Cosine distance (1 - cosine similarity)

-- Index types
ivfflat  -- Faster build, lower recall, good for <1M vectors
hnsw     -- Slower build, higher recall, better for >1M vectors

-- HNSW parameters
m = 16               -- Connections per layer (higher = better recall, more memory)
ef_construction = 64 -- Build quality (higher = better index, slower build)

-- Query-time tuning
SET hnsw.ef_search = 100;  -- Higher = better recall, slower query
```

---

## Appendix B: Workers AI Embedding Models

| Model | Dimensions | Speed | Quality | Cost |
|-------|------------|-------|---------|------|
| `@cf/baai/bge-small-en-v1.5` | 384 | Fastest | Good | Lowest |
| `@cf/baai/bge-base-en-v1.5` | 768 | Fast | Better | Low |
| `@cf/baai/bge-large-en-v1.5` | 1024 | Medium | Best | Medium |

**Recommendation:** Start with `bge-base-en-v1.5` (768-dim) for optimal balance.

---

## Appendix C: File Locations

```
alexandria/
├── migrations/
│   ├── 004_add_book_embeddings.sql
│   ├── 005_add_literary_awards.sql
│   └── 006_seed_literary_awards.sql
├── scripts/
│   └── scrapers/
│       ├── base-scraper.ts
│       ├── booker-scraper.ts
│       ├── hugo-scraper.ts
│       └── book-matcher.ts
└── worker/
    └── src/
        └── routes/
            └── embeddings.ts

bendv3/
└── src/
    ├── services/
    │   └── embedding-service.ts
    └── api-v3/
        └── recommendations.ts
```

---

**Document Status:** Ready for deep review  
**Next Action:** Review by implementation team, then Phase 1 execution  
**Contact:** Justin / Claude collaboration
