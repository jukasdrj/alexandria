## 2024-05-24 - N+1 R2 Listing Pattern
**Learning:** Cloudflare R2 `list()` does not return custom metadata by default. Iterating through `list()` results and calling `head()` for each object creates a massive N+1 performance bottleneck (Class A operations).
**Action:** Always use `include: ['customMetadata']` in `R2Bucket.list()` options when metadata is needed for list items. This reduces N+1 API calls to a single call per page.
