# Documentation Health Report

**Generated**: 2026-01-16
**Auditor**: Documentation Auditor Agent

## 🚨 Critical Mismatches

These items represent discrepancies between the documentation and the codebase that could lead to developer confusion or API integration failures.

*   **Legacy Cover Endpoints Missing in Code**: The documentation (`docs/api/API-SEARCH-ENDPOINTS.md`) lists several "Legacy" or standard cover endpoints that were not found in `worker/src/routes/covers.ts` or `worker/src/index.ts`.
    *   `GET /covers/:isbn/:size`
    *   `POST /covers/:isbn/process`
    *   `POST /covers/batch` (Note: `/api/covers/queue` exists and is documented as replacement, but legacy endpoint is still listed as active).
    *   *Note*: `GET /api/covers/status/:isbn` exists, but docs mention `GET /covers/:isbn/status`.
*   **Documentation Architecture Link**: `docs/api/API-SEARCH-ENDPOINTS.md` referenced `docs/ARCHITECTURE.md` which does not exist. The actual architecture file appears to be `docs/infrastructure/INFRASTRUCTURE.md`. (Fixed).

## 🛠️ Auto-Updates Made

The following files were automatically updated to fix broken links and paths:

*   **`docs/README.md`**:
    *   Updated links to `API-SEARCH-ENDPOINTS.md`, `ISBNDB-ENDPOINTS.md`, `ISBNDB-ENRICHMENT.md` to point to `api/` directory.
    *   Updated link to `CLOUDFLARE-API-VS-WRANGLER.md` to point to `infrastructure/` directory.
*   **`docs/api/API-SEARCH-ENDPOINTS.md`**:
    *   Updated link for `Architecture` to `../infrastructure/INFRASTRUCTURE.md`.
    *   Updated "See Also" links to correct relative paths.
*   **`docs/operations/PROVIDER-ANALYTICS.md`**:
    *   Replaced absolute paths (e.g., `/Users/juju/dev_repos/alex/...`) with relative paths to ensure portability.

## ⚠️ Stale Warnings

The following features or endpoints exist in the codebase but are **not fully documented** in `docs/api/API-SEARCH-ENDPOINTS.md`. Use caution as these may be internal or experimental.

*   **Undocumented API Routes**:
    *   `/api/authors/bibliography`
    *   `/api/authors/enrich-bibliography`
    *   `/api/authors/resolve-identifier`
    *   `/api/books/enrich-new-releases`
    *   `/api/books/search`
    *   `/api/external-ids/{entity_type}/{key}`
    *   `/api/harvest/*` (Backfill and harvesting endpoints)
    *   `/api/recommendations/similar`
    *   `/api/recommendations/subjects`
    *   `/api/resolve/{provider}/{id}`

## ✅ Verified Accurate

The following documentation has been verified against the codebase and is accurate:

*   **Core Search Endpoints**: `/api/search/combined` and `/api/search` match the implementation in `worker/src/routes/search*.ts`.
*   **Stats & Health**: `/api/stats` and `/health` are correctly implemented.
*   **Enrichment API**: `/api/enrich/*` endpoints match `worker/src/routes/enrich.ts`.
*   **Cover Queue**: `/api/covers/queue` matches `worker/src/routes/covers.ts`.
*   **Environment Variables**: Key variables in `CLAUDE.md` align with `worker/wrangler.jsonc`.

---

**Next Steps**:
1.  Verify if legacy cover endpoints are truly deprecated and remove them from docs, or restore the code.
2.  Create documentation for the new Author, Recommendation, and External ID endpoints.
3.  Periodically run this audit to prevent regression.
