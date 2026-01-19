# Documentation Health Report

**Date**: 2026-01-14 (Generated automatically)
**Auditor**: Jules (AI Agent)

## 🚨 Critical Mismatches

These items represent discrepancies where the documentation contradicts the actual codebase.

1.  **Missing Endpoint Implementation**:
    - **Documented**: `POST /covers/:isbn/process` (Endpoint #6 in `API-SEARCH-ENDPOINTS.md`)
    - **Reality**: This route is not defined in `worker/src/routes/covers.ts`.

2.  **Undocumented Active Endpoints**:
    The following endpoints are implemented and active in the code but missing from `API-SEARCH-ENDPOINTS.md`:
    - **Authors**:
        - `POST /api/authors/bibliography` (Fetch bibliography from ISBNdb)
        - `POST /api/authors/enrich-bibliography` (Fetch & enrich bibliography)
        - `POST /api/authors/resolve-identifier` (Resolve VIAF/ISNI to Wikidata)
    - **Harvesting**:
        - `POST /api/harvest/covers` (Harvest covers for OpenLibrary editions)
        - `POST /api/harvest/backfill` (Queue historical backfill)
        - `GET /api/harvest/backfill/status/:jobId` (Poll backfill status)
    - **Testing/Internal**:
        - `GET /api/test/ai-comparison` (Compare Gemini vs x.ai)

3.  **Broken Links**:
    - `docs/api/API-SEARCH-ENDPOINTS.md` contained broken relative links to:
        - `docs/ISBNDB-ENDPOINTS.md` (Should be local file)
        - `docs/ISBNDB-ENRICHMENT.md` (Should be local file)
        - `docs/ARCHITECTURE.md` (File missing, likely moved to `docs/infrastructure/INFRASTRUCTURE.md`)
        - `CLAUDE.md` (Should be `../../CLAUDE.md`)

## 🛠️ Auto-Updates Made

The following corrections were applied automatically:

1.  **Link Fixes in `docs/api/API-SEARCH-ENDPOINTS.md`**:
    - Updated paths to correctly point to sibling files and parent directories.
    - Updated Architecture link to point to `docs/infrastructure/INFRASTRUCTURE.md`.

2.  **Content Cleanup in `docs/api/API-SEARCH-ENDPOINTS.md`**:
    - Removed the missing `POST /covers/:isbn/process` endpoint documentation.
    - Removed the duplicate `POST /api/covers/queue` entry (merged "Batch Cover Queueing" into one section if appropriate, or kept the more descriptive one).

## ⚠️ Stale Warnings

Files that appear outdated or require human review:

- `docs/api/API-SEARCH-ENDPOINTS.md`: The "Last Updated" date should be updated.
- `docs/infrastructure/INFRASTRUCTURE.md`: Verify if this file contains the up-to-date architecture diagrams mentioned in the old `ARCHITECTURE.md` links.

## ✅ Verified Accurate

The following core endpoints are correctly documented and implemented:

- `GET /api/search`
- `GET /api/search/combined`
- `GET /api/stats`
- `GET /health`
- `GET /api/covers/status/:isbn`
- `POST /api/covers/process`
- `POST /api/enrich/edition`
- `POST /api/enrich/work`
