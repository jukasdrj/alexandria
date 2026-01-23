# Documentation Health Report

**Date:** 2026-01-19
**Auditor:** Jules (Systems Architect Agent)

## 🚨 Critical Mismatches
*(Documentation contradicts the current code/reality)*

1.  **Ghost Legacy Endpoints (404s):**
    *   **Files:** `docs/api/API-SEARCH-ENDPOINTS.md`, `README.md`, `worker/src/index.ts`
    *   **Issue:** The documentation and middleware configuration (`worker/src/index.ts`) reference legacy endpoints `POST /covers/batch` and `POST /covers/:isbn/process`.
    *   **Reality:** The implementation file `worker/src/routes/covers-legacy.ts` is **missing** from the codebase. These endpoints will return 404s or fail, despite being documented as active legacy routes.

2.  **Undocumented Public Endpoints:**
    *   **`POST /api/harvest/covers`**: Implemented in `worker/src/routes/enrich.ts` but missing from `docs/api/API-SEARCH-ENDPOINTS.md`.
    *   **`POST /api/test/ai-comparison`**: Implemented in `worker/src/routes/ai-comparison.ts` but missing from `docs/api/API-SEARCH-ENDPOINTS.md`.
    *   **`GET /api/harvest/backfill/status/:jobId`**: Implemented in `worker/src/routes/backfill-async.ts` (OpenAPI) but missing from `docs/api/API-SEARCH-ENDPOINTS.md` (which only lists the queue endpoint).

3.  **Middleware Configuration Error:**
    *   **File:** `worker/src/index.ts`
    *   **Issue:** Contains `app.use('/covers/batch', rateLimiter(RateLimitPresets.heavy));` and comments referring to legacy routes that no longer exist. This creates a disconnect between the application configuration and the actual route handlers.

## 🛠️ Auto-Updates Made
*(List files you corrected automatically for typos or pathing)*

*   **None.** (Requires human decision on whether to restore `covers-legacy.ts` or purge references from docs/middleware).

## ⚠️ Stale Warnings
*(Files that look outdated but require human context to fix)*

*   **`docs/api/API-SEARCH-ENDPOINTS.md`**: Section "6. ISBN-based Cover Processing" and "8. Queue Cover Processing" (legacy batch example) describe endpoints that no longer exist.
*   **`README.md`**: "API Endpoints" section lists `POST /covers/batch` and `POST /covers/:isbn/process`.

## ✅ Verified Accurate
*(Key files confirmed up-to-date)*

*   **`GET /api/search/combined`**: Correctly documented in `docs/api/API-SEARCH-ENDPOINTS.md` and matches `worker/src/routes/search-combined.ts`.
*   **`POST /api/enrich/batch-direct`**: Correctly documented and matches `worker/src/routes/enrich.ts`.
*   **`GET /api/covers/status/:isbn`**: Correctly documented and matches `worker/src/routes/covers.ts`.
*   **`GET /api/covers/:work_key/:size`**: Correctly documented and matches `worker/src/routes/covers.ts`.
*   **`worker/wrangler.jsonc`**: Queue bindings (`enrichment`, `cover`, `backfill`, `author`) match `README.md` and `CLAUDE.md`.
