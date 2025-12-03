# npm Package Publishing Checklist

## Package Information
- **Name**: `alexandria-worker`
- **Version**: `2.1.0` (from v2.0.0)
- **Description**: Cloudflare Worker for Alexandria OpenLibrary database with TypeScript types, Zod validation, and intelligent search

## What's New in v2.1.0

### New Endpoints
1. **`GET /api/search/combined`** - Unified search with intelligent ISBN/text detection
   - Auto-detects ISBN vs text queries
   - Fast ISBN lookups (~60ms)
   - Parallel title + author search (~1-2s)
   - Built-in pagination and deduplication

### Enhanced Existing Endpoints
All search endpoints now support pagination:
- `GET /api/search?isbn=...&limit=10&offset=0`
- `GET /api/search?title=...&limit=10&offset=0`
- `GET /api/search?author=...&limit=10&offset=0`

### New TypeScript Types Exported
- `CombinedSearchQuery` - Combined search request
- `CombinedSearchResult` - Combined search response
- `PaginationMetadata` - Pagination info with `hasMore` flag
- Enhanced `BookResult` with `type` and `openlibrary_author` fields
- Enhanced `SearchQuerySchema` with `offset` parameter

### Breaking Changes
⚠️ **Response structure changed**:
```typescript
// Before (v2.0.0)
{ count: number, results: [] }

// After (v2.1.0)
{ count?: number, results: [], pagination: { ... } }
```

## Files Updated
- ✅ `worker/types.ts` - Added new types and schemas
- ✅ `worker/package.json` - Version bumped to 2.1.0
- ✅ `worker/README-INTEGRATION.md` - Documentation updated
- ✅ `CHANGELOG.md` - Version history documented
- ✅ `worker/index.ts` - Implementation complete (by subagents)

## Publishing Steps

### 1. Pre-publish Verification
```bash
cd worker/

# Verify types are valid
npm run test

# Check package contents
npm pack --dry-run

# Verify wrangler config
cat wrangler.jsonc
```

### 2. Publish to npm
```bash
cd worker/

# Login to npm (if needed)
npm login

# Publish the package
npm publish

# Verify publication
npm view alexandria-worker
```

### 3. Tag Git Release
```bash
cd /Users/juju/dev_repos/alex

# Commit the changes
git add worker/types.ts worker/package.json worker/README-INTEGRATION.md CHANGELOG.md
git commit -m "chore: bump alexandria-worker to v2.1.0

- Add combined search endpoint (#41)
- Add pagination support (#42)
- Update TypeScript types and documentation"

# Create git tag
git tag -a v2.1.0 -m "Release v2.1.0: Combined search & pagination"

# Push to GitHub
git push origin main
git push origin v2.1.0
```

### 4. Create GitHub Release
```bash
# Create release via gh CLI
gh release create v2.1.0 \
  --title "v2.1.0 - Combined Search & Pagination" \
  --notes-file CHANGELOG.md \
  --latest
```

## For bendv3 Integration

### Update Steps
1. Update `package.json` in bendv3:
   ```bash
   npm install alexandria-worker@2.1.0
   # or
   npm update alexandria-worker
   ```

2. Update import statements (if needed):
   ```typescript
   import type {
     CombinedSearchQuery,
     CombinedSearchResult,
     PaginationMetadata
   } from 'alexandria-worker/types';
   ```

3. Update service code to use pagination:
   ```typescript
   // Old way
   const results = await search({ isbn });
   const total = results.count;

   // New way
   const results = await search({ isbn });
   const total = results.pagination.total;
   const hasMore = results.pagination.hasMore;
   ```

4. Consider using combined search:
   ```typescript
   // Simpler API - auto-detects query type
   const results = await searchCombined({ q: userQuery, limit: 20 });
   ```

### Communication to bendv3 Consumers

**When bendv3 deploys with v2.1.0**, consumers will automatically get:
- Faster search performance (if using new combined endpoint)
- Pagination support for better UX
- More accurate result counts
- `hasMore` flag for infinite scroll implementations

**Breaking Changes to Handle**:
- Update code that reads `results.count` → `results.pagination.total`
- The `count` field is still present but deprecated

**Optional Enhancements**:
- Implement pagination UI using `offset` parameter
- Use `/api/search/combined` for simpler search logic
- Leverage `hasMore` flag for infinite scroll

## Verification After Publishing

### Test npm package
```bash
# In a test directory
mkdir test-alexandria && cd test-alexandria
npm init -y
npm install alexandria-worker@2.1.0

# Verify types are available
cat > test.ts << 'EOFTEST'
import type { CombinedSearchQuery, PaginationMetadata } from 'alexandria-worker/types';

const query: CombinedSearchQuery = {
  q: 'test',
  limit: 10,
  offset: 0
};
console.log('Types loaded successfully!');
EOFTEST

npx tsx test.ts
```

### Test live API
```bash
# Test combined search
curl "https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873" | jq '.pagination'

# Test pagination
curl "https://alexandria.ooheynerds.com/api/search?title=Harry%20Potter&limit=5&offset=0" | jq '.pagination'
```

## Rollback Plan

If issues are discovered:
```bash
# Deprecate the problematic version
npm deprecate alexandria-worker@2.1.0 "Please use v2.0.0 until v2.1.1 is released"

# Users can downgrade
npm install alexandria-worker@2.0.0
```

## Status
- [ ] Pre-publish verification complete
- [ ] Published to npm
- [ ] Git tag created
- [ ] GitHub release created
- [ ] bendv3 notified of new version
- [ ] Verification tests passed

## Notes
- Worker is already deployed to production with these changes
- API is live and tested at https://alexandria.ooheynerds.com
- All implementation work complete (issues #41 and #42 closed)
- Ready for npm publication when you're ready to proceed
