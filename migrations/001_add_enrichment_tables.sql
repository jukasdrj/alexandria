-- ============================================================================
-- Alexandria Database: Enrichment Tables
-- ============================================================================
-- Purpose: Store enriched book data from multiple providers (ISBNdb, Google Books, etc.)
-- This allows Alexandria to become the central aggregation hub
--
-- Deploy to Unraid PostgreSQL:
-- scp migrations/001_add_enrichment_tables.sql root@Tower.local:/tmp/
-- ssh root@Tower.local "docker exec -i postgres psql -U openlibrary -d openlibrary < /tmp/001_add_enrichment_tables.sql"
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For fuzzy search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- For UUID generation

-- ============================================================================
-- TABLE: enriched_works
-- ============================================================================
CREATE TABLE IF NOT EXISTS enriched_works (
    work_key TEXT PRIMARY KEY,
    
    -- Core metadata
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    original_language TEXT,
    first_publication_year INTEGER,
    
    -- Subject tags (normalized genres)
    subject_tags TEXT[],
    
    -- Diversity & Accessibility
    is_own_voices BOOLEAN,
    accessibility_tags TEXT[],
    
    -- Cover images
    cover_url_large TEXT,
    cover_url_medium TEXT,
    cover_url_small TEXT,
    cover_source TEXT,
    
    -- External IDs (aggregated from all providers)
    openlibrary_work_id TEXT,
    goodreads_work_ids TEXT[],
    amazon_asins TEXT[],
    librarything_ids TEXT[],
    google_books_volume_ids TEXT[],
    isbndb_id TEXT,
    
    -- Provider tracking
    primary_provider TEXT,
    contributors TEXT[],
    synthetic BOOLEAN DEFAULT FALSE,
    isbndb_quality INTEGER DEFAULT 0,
    completeness_score INTEGER DEFAULT 0,
    
    -- Review status (for AI-detected books)
    review_status TEXT DEFAULT 'verified',
    original_image_path TEXT,
    bounding_box_x DOUBLE PRECISION,
    bounding_box_y DOUBLE PRECISION,
    bounding_box_width DOUBLE PRECISION,
    bounding_box_height DOUBLE PRECISION,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_isbndb_sync TIMESTAMPTZ,
    last_google_books_sync TIMESTAMPTZ,
    
    -- Extensibility
    metadata JSONB DEFAULT '{}'
);

-- Indexes for enriched_works
CREATE INDEX IF NOT EXISTS idx_enriched_works_title_trgm ON enriched_works USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_enriched_works_subject_tags ON enriched_works USING gin(subject_tags);
CREATE INDEX IF NOT EXISTS idx_enriched_works_goodreads ON enriched_works USING gin(goodreads_work_ids);
CREATE INDEX IF NOT EXISTS idx_enriched_works_updated ON enriched_works(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_enriched_works_isbndb_quality ON enriched_works(isbndb_quality DESC) WHERE isbndb_quality > 0;

-- ============================================================================
-- TABLE: enriched_editions
-- ============================================================================
CREATE TABLE IF NOT EXISTS enriched_editions (
    isbn TEXT PRIMARY KEY,
    alternate_isbns TEXT[],
    
    -- Foreign keys
    work_key TEXT REFERENCES enriched_works(work_key),
    edition_key TEXT,
    
    -- Core metadata
    title TEXT,
    subtitle TEXT,
    publisher TEXT,
    publication_date TEXT,
    page_count INTEGER,
    format TEXT,
    language TEXT,
    edition_description TEXT,
    
    -- Cover images
    cover_url_large TEXT,
    cover_url_medium TEXT,
    cover_url_small TEXT,
    cover_source TEXT,
    
    -- External IDs
    openlibrary_edition_id TEXT,
    amazon_asins TEXT[],
    google_books_volume_ids TEXT[],
    librarything_ids TEXT[],
    goodreads_edition_ids TEXT[],
    
    -- Provider tracking
    primary_provider TEXT,
    contributors TEXT[],
    isbndb_quality INTEGER DEFAULT 0,
    completeness_score INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_isbndb_sync TIMESTAMPTZ,
    last_google_books_sync TIMESTAMPTZ,
    
    -- Extensibility
    metadata JSONB DEFAULT '{}'
);

-- Indexes for enriched_editions
CREATE INDEX IF NOT EXISTS idx_enriched_editions_work_key ON enriched_editions(work_key);
CREATE INDEX IF NOT EXISTS idx_enriched_editions_title_trgm ON enriched_editions USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_enriched_editions_publisher ON enriched_editions(publisher);
CREATE INDEX IF NOT EXISTS idx_enriched_editions_alternate_isbns ON enriched_editions USING gin(alternate_isbns);

-- ============================================================================
-- TABLE: enriched_authors
-- ============================================================================
CREATE TABLE IF NOT EXISTS enriched_authors (
    author_key TEXT PRIMARY KEY,
    
    -- Core metadata
    name TEXT NOT NULL,
    gender TEXT DEFAULT 'Unknown',
    cultural_region TEXT,
    nationality TEXT,
    birth_year INTEGER,
    death_year INTEGER,
    
    -- Biography
    bio TEXT,
    bio_source TEXT,
    author_photo_url TEXT,
    
    -- External IDs
    openlibrary_author_id TEXT,
    goodreads_author_ids TEXT[],
    librarything_ids TEXT[],
    google_books_ids TEXT[],
    wikidata_id TEXT,
    
    -- Statistics
    book_count INTEGER DEFAULT 0,
    
    -- Provider tracking
    primary_provider TEXT,
    contributors TEXT[],
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_wikidata_sync TIMESTAMPTZ,
    
    -- Extensibility
    metadata JSONB DEFAULT '{}'
);

-- Indexes for enriched_authors
CREATE INDEX IF NOT EXISTS idx_enriched_authors_name_trgm ON enriched_authors USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_enriched_authors_nationality ON enriched_authors(nationality);
CREATE INDEX IF NOT EXISTS idx_enriched_authors_book_count ON enriched_authors(book_count DESC);

-- ============================================================================
-- TABLE: work_authors_enriched
-- ============================================================================
CREATE TABLE IF NOT EXISTS work_authors_enriched (
    work_key TEXT REFERENCES enriched_works(work_key) ON DELETE CASCADE,
    author_key TEXT REFERENCES enriched_authors(author_key) ON DELETE CASCADE,
    author_order INTEGER DEFAULT 0,
    PRIMARY KEY (work_key, author_key)
);

CREATE INDEX IF NOT EXISTS idx_work_authors_enriched_work ON work_authors_enriched(work_key);
CREATE INDEX IF NOT EXISTS idx_work_authors_enriched_author ON work_authors_enriched(author_key);

-- ============================================================================
-- TABLE: enrichment_queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrichment_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    
    providers_to_try TEXT[],
    providers_attempted TEXT[] DEFAULT '{}',
    providers_succeeded TEXT[] DEFAULT '{}',
    
    priority INTEGER DEFAULT 5,
    status TEXT DEFAULT 'pending',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3
);

CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status ON enrichment_queue(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_entity ON enrichment_queue(entity_type, entity_key);

-- ============================================================================
-- TABLE: enrichment_log
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrichment_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    fields_updated TEXT[],
    error_message TEXT,
    response_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_log_entity ON enrichment_log(entity_type, entity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_log_provider ON enrichment_log(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_log_success ON enrichment_log(success, created_at DESC);

-- ============================================================================
-- FUNCTIONS: Auto-update timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_enriched_works_updated_at BEFORE UPDATE ON enriched_works
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_enriched_editions_updated_at BEFORE UPDATE ON enriched_editions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_enriched_authors_updated_at BEFORE UPDATE ON enriched_authors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE enriched_works IS 'Enriched book works aggregated from multiple providers';
COMMENT ON TABLE enriched_editions IS 'Enriched book editions with complete metadata';
COMMENT ON TABLE enriched_authors IS 'Enriched author information from multiple sources';
COMMENT ON TABLE enrichment_queue IS 'Background job queue for enriching entities';
COMMENT ON TABLE enrichment_log IS 'Audit log of all enrichment operations';

SELECT 'Alexandria enrichment tables created successfully!' AS status;
