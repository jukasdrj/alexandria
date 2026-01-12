# Legacy Cover Fetcher - Deprecated

**Status**: DEPRECATED as of January 12, 2026
**Replacement**: External Service Provider Framework (`worker/lib/external-services/`)

## What Happened

The original `cover-fetcher.ts` file has been superseded by the **External Service Provider Framework (v2.6.0)** deployed on Jan 11-12, 2026.

## Migration Complete

All production code paths now use the new framework:

### ✅ Migrated to New Framework
- **Cover Queue Handler** (`worker/src/services/queue-handlers.ts`)
  - Uses `CoverFetchOrchestrator` from External Service Provider Framework
  - JWT recovery logic migrated to `ISBNdbProvider.fetchCover()` (Jan 12, 2026)
  - Fully tested and operational in production

### ⚠️ Legacy Code Paths (Still Active)
- **Legacy Cover Routes** (`worker/src/routes/covers-legacy.ts`)
  - `/covers/{isbn}/status` - Check cover status
  - `POST /covers/process` - Process single cover
  - `POST /covers/batch` - Batch cover processing
  - Uses `image-processor.ts` → `cover-fetcher.ts` (old chain)
  - Marked as "Legacy" in OpenAPI spec
  - **Reason preserved**: Backward compatibility for external clients

### 📦 Type-Only Dependencies
The following files import only the `CoverResult` type interface:
- `worker/services/wikidata.ts`
- `worker/services/archive-org.ts`
- `worker/lib/open-api-utils.ts` (reference comment only)

## Recommendation

### Option A: Keep for Backward Compatibility (Current)
- Preserve legacy routes for external API consumers
- Mark endpoints as deprecated in OpenAPI spec
- Add `X-Deprecated` response headers
- No breaking changes

### Option B: Full Deprecation (Future)
1. Add deprecation notices to all legacy endpoints
2. Set 6-month sunset timeline
3. Communicate to API consumers via changelog
4. Remove after grace period

## Files Involved

**Deprecated (but still functional)**:
- `worker/services/cover-fetcher.ts` - Original multi-provider cover fetcher
- `worker/services/image-processor.ts` - Original image processing (pre-jSquash)
- `worker/src/routes/covers-legacy.ts` - Legacy API endpoints

**New Framework (production)**:
- `worker/lib/external-services/orchestrators/cover-fetch-orchestrator.ts` - NEW orchestrator
- `worker/lib/external-services/providers/isbndb-provider.ts` - ISBNdb via framework
- `worker/lib/external-services/providers/google-books-provider.ts` - Google Books via framework
- `worker/lib/external-services/providers/openlibrary-provider.ts` - OpenLibrary via framework
- `worker/lib/external-services/providers/archive-org-provider.ts` - Archive.org via framework
- `worker/lib/external-services/providers/wikidata-provider.ts` - Wikidata via framework

## Benefits of New Framework

1. **Unified Architecture**: All 8 external providers use same pattern
2. **Dynamic Discovery**: Registry-based provider selection
3. **Quota-Aware**: Automatic ISBNdb quota enforcement
4. **Timeout Protection**: Per-provider timeouts prevent hangs
5. **Observability**: Built-in logging for analytics (#177)
6. **Free-First Priority**: Preserves ISBNdb quota by trying free providers first
7. **Testable**: 116 comprehensive tests (100% passing)

## Migration Guide (for future reference)

If you need to migrate `covers-legacy.ts` to the new framework:

```typescript
// OLD (covers-legacy.ts)
import { fetchBestCover } from '../../services/cover-fetcher.js';
const result = await fetchBestCover(isbn, env);

// NEW (use CoverFetchOrchestrator)
import { CoverFetchOrchestrator } from '../../lib/external-services/orchestrators/cover-fetch-orchestrator.js';
import { getGlobalRegistry } from '../../lib/external-services/provider-registry.js';
import { createServiceContext } from '../../lib/external-services/service-context.js';

const orchestrator = new CoverFetchOrchestrator(getGlobalRegistry());
const context = createServiceContext(env, logger);
const result = await orchestrator.fetchCover(isbn, context);
```

## Related Issues

- **Issue #171**: Cover Priority Chain Analytics (blocked on #177)
- **Issue #177**: External Service Provider Analytics & Monitoring (NEW - includes cover fetch metrics)
- **Issue #96**: JWT Expiry Recovery (migrated to ISBNdbProvider on Jan 12, 2026)

## Timeline

- **Jan 11-12, 2026**: External Service Provider Framework deployed (v2.6.0)
- **Jan 12, 2026**: JWT recovery migrated to ISBNdbProvider
- **Jan 12, 2026**: This deprecation notice created
- **Future**: Consider full deprecation after API consumer analysis

---

**Last Updated**: January 12, 2026
**Status**: Legacy code preserved for backward compatibility
**Decision**: Keep legacy routes, all production traffic uses new framework
