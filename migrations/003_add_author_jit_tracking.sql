-- Migration: Add JIT enrichment tracking to enriched_authors
-- Purpose: Track author views and enrichment staleness for Just-in-Time enrichment
-- Date: 2026-01-07

-- Add tracking columns for JIT enrichment
ALTER TABLE enriched_authors
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heat_score FLOAT DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS last_enrichment_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_attempt_count INTEGER DEFAULT 0;

-- Add index for JIT enrichment queries (authors needing enrichment)
-- Finds authors with high heat scores who need enrichment
CREATE INDEX IF NOT EXISTS idx_authors_needing_enrichment
  ON enriched_authors(heat_score DESC, last_viewed_at DESC)
  WHERE wikidata_id IS NOT NULL;

-- Add index for view tracking queries
CREATE INDEX IF NOT EXISTS idx_authors_by_view_count
  ON enriched_authors(view_count DESC, last_viewed_at DESC);

-- Comments for documentation
COMMENT ON COLUMN enriched_authors.last_viewed_at IS 'Timestamp of most recent author detail view (for JIT enrichment trigger)';
COMMENT ON COLUMN enriched_authors.view_count IS 'Total number of times author details have been viewed';
COMMENT ON COLUMN enriched_authors.heat_score IS 'Computed priority score: (view_count * 10) + (book_count * 0.5) + recency_boost';
COMMENT ON COLUMN enriched_authors.last_enrichment_attempt_at IS 'Last time we attempted to enrich this author (success or failure)';
COMMENT ON COLUMN enriched_authors.enrichment_attempt_count IS 'Number of enrichment attempts (prevents infinite retries on bad data)';
