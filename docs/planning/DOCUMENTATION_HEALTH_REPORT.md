# Documentation Health Report

**Date:** January 9, 2026
**Auditor:** Agent Jules

This report details the findings of an automated audit of the Alexandria project documentation, identifying inconsistencies between the documentation and the current codebase.

## 🚨 Critical Mismatches

These are areas where the documentation contradicted the deployed code or significant features were missing.

1.  **Queue Configuration (README.md):**
    *   **Drift:** `README.md` listed only `alexandria-enrichment-queue` and `alexandria-cover-queue` in the Architecture diagram.
    *   **Reality:** `worker/wrangler.jsonc` and `CLAUDE.md` confirm 4 queues: `enrichment`, `cover`, `backfill`, `author`.
    *   **Status:** **FIXED**. `README.md` has been auto-updated.

2.  **API Endpoints (README.md):**
    *   **Drift:** `README.md` was missing the "External ID Resolution" endpoints (`GET /api/external-ids`, `GET /api/resolve`).
    *   **Reality:** These endpoints are live in `worker/src/routes/external-ids.ts` and documented in `CLAUDE.md`.
    *   **Status:** **FIXED**. `README.md` has been auto-updated.

## 🛠️ Auto-Updates Made

The following files were automatically updated to correct drifts:

*   **`README.md`:**
    *   Updated "Last Updated" date to Jan 9, 2026.
    *   Added `alexandria-backfill-queue` and `alexandria-author-queue` to Architecture section.
    *   Added "External ID Resolution" section to API Endpoints.
    *   Added `POST /api/harvest/backfill` to API Endpoints.
    *   Updated `POST /api/authors/resolve-identifier` description to clarify it is for VIAF/ISNI.

## ⚠️ Stale Warnings & Context Needed

These files appear outdated or potentially confusing and may require human review.

1.  **`docs/api/API-IDENTIFIER-RESOLUTION.md` vs Generic External IDs**
    *   **Issue:** This file specifically documents `POST /api/authors/resolve-identifier` (VIAF/ISNI → Wikidata). However, the project also has "External ID Resolution" (Issue #155) for resolving ASIN/Goodreads/etc. (`GET /api/external-ids`, `GET /api/resolve`).
    *   **Confusion:** The filename `API-IDENTIFIER-RESOLUTION.md` implies it covers all identifier resolution, but it only covers the author-specific one.
    *   **Recommendation:** Rename `docs/api/API-IDENTIFIER-RESOLUTION.md` to `docs/api/API-AUTHOR-IDENTIFIER-RESOLUTION.md` and create a new `docs/api/API-EXTERNAL-ID-RESOLUTION.md` for the generic system.

2.  **`README.md` Version**
    *   **Issue:** `README.md` lists version `2.2.2`. `package.json` lists `2.2.0`.
    *   **Recommendation:** Verify the correct semantic version.

## ✅ Verified Accurate

The following key files were checked and found to be consistent with the codebase:

*   **`CLAUDE.md`:** Accurately reflects the 4-queue architecture, bindings, and recent features like External ID Resolution. It serves as the authoritative source.
*   **`worker/wrangler.jsonc`:** Matches `CLAUDE.md` configuration.
*   **`docs/INDEX.md`:** Accurately links to existing docs, though it may need updates if new API docs are created.

## Next Steps

1.  **Review `docs/api/` naming:** Consider renaming `API-IDENTIFIER-RESOLUTION.md` to avoid confusion.
2.  **Create missing API doc:** Create documentation for the Generic External ID Resolution endpoints (`GET /api/external-ids`, `GET /api/resolve`).
3.  **Sync Version:** Update `package.json` to `2.2.2` if that is the correct intended version.
