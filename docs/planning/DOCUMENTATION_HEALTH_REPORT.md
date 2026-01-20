# Documentation Health Report

**Date:** 2026-01-16
**Auditor:** Jules (Documentation Auditor Agent)

## 🚨 Critical Mismatches
*(Documentation contradicts the current code/reality)*

1.  **Missing/Legacy Cover Endpoints in API Docs:**
    *   **File:** `docs/api/API-SEARCH-ENDPOINTS.md`
    *   **Issue:** Lists `POST /covers/:isbn/process` and `POST /covers/batch` as active endpoints.
    *   **Reality:** These routes are missing from `worker/src/routes/covers.ts` (and `index.ts` integration). Only `POST /api/covers/process` and `POST /api/covers/queue` (async) are present, plus the legacy `GET /covers/:isbn/:size`.
    *   **Impact:** Users might try to use non-existent synchronous batch/process endpoints.

2.  **Missing Async Backfill Endpoints:**
    *   **File:** `docs/api/API-SEARCH-ENDPOINTS.md`
    *   **Issue:** Does not document `POST /api/harvest/backfill` (Async Backfill) or `GET /api/harvest/backfill/status/:jobId`.
    *   **Reality:** These are fully implemented in `worker/src/routes/backfill-async.ts` and are key for the backfill system described in `README.md`.

3.  **Missing Hybrid Test Endpoints:**
    *   **File:** `docs/api/API-SEARCH-ENDPOINTS.md`
    *   **Issue:** Missing `POST /api/harvest/hybrid/test` and `GET /api/harvest/gemini/test`.
    *   **Reality:** Implemented in `worker/src/routes/harvest.ts`.

## 🛠️ Auto-Updates Made
*(List files you corrected automatically for typos or pathing)*

1.  **Fixed Broken/Stale Links in API Search Endpoints:**
    *   **File:** `docs/api/API-SEARCH-ENDPOINTS.md`
    *   **Action:**
        *   Replaced `docs/ARCHITECTURE.md` (missing) with `docs/infrastructure/INFRASTRUCTURE.md`.
        *   Corrected paths `docs/ISBNDB-ENDPOINTS.md` -> `ISBNDB-ENDPOINTS.md` (relative).
        *   Corrected paths `docs/ISBNDB-ENRICHMENT.md` -> `ISBNDB-ENRICHMENT.md` (relative).
        *   Corrected `CLAUDE.md` -> `../../CLAUDE.md`.

## ⚠️ Stale Warnings
*(Files that look outdated but require human context to fix)*

1.  **`docs/api/API-SEARCH-ENDPOINTS.md` Structure:**
    *   The file structure and endpoint list lags behind the `worker/src/routes/` modularization (e.g. `backfill-async.ts`, `harvest.ts` split). It needs a restructure to match the route files more closely.

## ✅ Verified Accurate
*(Key files confirmed up-to-date)*

*   **`worker/wrangler.jsonc` vs `worker/src/env.ts`:** Environment variables and bindings match perfectly.
*   **`docs/INDEX.md`:** Correctly reflects the file structure and recent updates (e.g. `docs/infrastructure/INFRASTRUCTURE.md`).
*   **`README.md`:** Generally accurate high-level overview, correctly links to `CLAUDE.md`.
