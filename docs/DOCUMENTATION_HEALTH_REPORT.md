# Alexandria Documentation Health Report

**Date:** January 4, 2026
**Auditor:** Jules (Technical Architect Agent)

---

## 🚨 Critical Mismatches

The following items represent discrepancies where documentation contradicts the actual codebase. These should be addressed immediately to prevent developer confusion.

### 1. Missing Endpoints
The following endpoints are documented in `docs/api/API-SEARCH-ENDPOINTS.md` but **do not exist** in the `worker/src` codebase:

*   **`POST /api/isbns/check`** (Bulk ISBN Existence Check)
    *   *Status:* Mentioned as "Completed" in `TODO.md` (Phase 2.10), but code is missing from `worker/src/routes/`.
*   **`POST /api/queue/drain/enrichment`** (Manual Enrichment Queue Drain)
    *   *Status:* Completely missing from codebase.
*   **`POST /api/queue/drain/covers`** (Manual Cover Queue Drain)
    *   *Status:* Completely missing from codebase.
*   **`GET /api/covers/inspect`** (Cover Object Inspection)
    *   *Status:* Completely missing from codebase.

### 2. Phantom Features (Smart Resolution)
The documentation `docs/api/API-SEARCH-ENDPOINTS.md` claims "Smart Resolution" is configurable via environment variables, but these variables **do not exist** in `env.ts` or `wrangler.jsonc`:

*   `SMART_RESOLUTION_ENABLED`
*   `SMART_RESOLUTION_PROVIDERS`

*Note:* The "Smart Resolution" logic *does* exist in tests (`worker/src/__tests__/services/smart-resolution.test.ts`), but the configuration layer documented is missing from the production environment.

---

## ⚠️ Stale Warnings

The following files or sections appear to be outdated based on recent code changes:

*   **`docs/api/API-SEARCH-ENDPOINTS.md`**:
    *   Last Updated date says "2026-01-04", but it includes the missing endpoints listed above. It appears the documentation was updated anticipatorily for features that were either reverted or not yet merged.
*   **`TODO.md`**:
    *   Lists `POST /api/isbns/check` as "Fixed duplicate... endpoint (Phase 2.10)". The endpoint might have been accidentally removed during a refactor.

---

## ✅ Verified Accurate

The following key components have been verified to match the codebase:

*   **Core Search & Enrichment:**
    *   `GET /api/search/combined` (Exists and matches logic)
    *   `POST /api/enrich/batch-direct` (Exists)
    *   `POST /api/authors/enrich-bibliography` (Exists)
*   **Cover Processing:**
    *   `POST /api/covers/process` (Exists)
    *   `POST /api/covers/queue` (Exists)
    *   `GET /api/covers/:work_key/:size` (Verified in `worker/src/routes/covers.ts`)
*   **New Features (Jan 4):**
    *   `POST /api/authors/resolve-identifier` (Exists, matches PRD)
    *   `POST /api/authors/enrich-wikidata` (Exists)
*   **Environment Variables:**
    *   `ISBNDB_API_KEY` (Confirmed in use)
    *   `GOOGLE_BOOKS_API_KEY` (Confirmed in use)

---

## 🛠️ Recommendations

1.  **Investigate `/api/isbns/check`**: Since `TODO.md` says it was fixed/completed, locate the commit where it might have been lost.
2.  **Remove Phantom Endpoints**: If the admin/queue drain endpoints were experimental, remove them from `API-SEARCH-ENDPOINTS.md`.
3.  **Update Configuration Docs**: Remove references to `SMART_RESOLUTION_*` env vars if they are not actually implemented in `env.ts`.
