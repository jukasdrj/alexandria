## 2024-05-24 - N+1 R2 Listing Pattern
**Learning:** Cloudflare R2 `list()` does not return custom metadata by default. Iterating through `list()` results and calling `head()` for each object creates a massive N+1 performance bottleneck (Class A operations).
**Action:** Always use `include: ['customMetadata']` in `R2Bucket.list()` options when metadata is needed for list items. This reduces N+1 API calls to a single call per page.

## 2026-01-14 - Limit+1 Pagination Strategy
**Learning:** For fuzzy search (ILIKE, pg_trgm) and complex joins, `COUNT(*)` queries to get the total number of results are extremely expensive as they scan the entire result set.
**Action:** Use `LIMIT limit + 1` to fetch one extra record. If the extra record exists, set `hasMore = true` and estimate the total (e.g., `offset + limit + 1`). This avoids the separate count query entirely. Provide `totalEstimated: true` in the API response to inform clients.

## 2026-01-14 - Concurrent Deduplication in Workers
**Learning:** When parallelizing database operations that involve "find-or-create" logic (like `findOrCreateWork`), standard unique constraints are insufficient if keys are generated randomly. Concurrent requests can create duplicate entities even with `ON CONFLICT DO NOTHING`.
**Action:** Use request-scoped `Map<string, Promise<T>>` locks to serialize operations for the same entity key (e.g., Title) within a batch. This allows parallel processing of distinct entities while ensuring sequential processing for potential collisions.
