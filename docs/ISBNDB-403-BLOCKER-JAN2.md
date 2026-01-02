# ISBNdb API 403 Blocker - January 2, 2026

## Critical Issue

**All ISBNdb API calls are returning HTTP 403 Forbidden.**

This blocks:
- Author bibliography harvesting
- Batch ISBN enrichment
- New release searches
- Any ISBNdb-dependent functionality

## Test Results

```bash
curl https://alexandria.ooheynerds.com/api/test/isbndb
```

**Results**: 10/10 endpoints failed with 403 error:
- Book by ISBN-13: 403
- Book by ISBN-10: 403
- Books search (title): 403
- Books search (filtered): 403
- Author by name: 403
- Authors search: 403
- Publisher by name: 403
- Publishers search: 403
- Subject by name: 403
- Subjects search: 403

**Response time**: 255-716ms (API is responding, but rejecting requests)

## Possible Causes

### 1. Wrong ISBNdb API Endpoint ⚠️ **LIKELY**

**Current config**: Uses `api.premium.isbndb.com`
**Documentation** (ISBNDB-ENDPOINTS.md): Says Premium should use `api.premium.isbndb.com`

**To check**:
- Verify ISBNdb dashboard shows Premium account active
- Check if base URL changed in their system
- Try `api2.isbndb.com` (Basic endpoint) to test

### 2. Expired/Invalid API Key

**Current storage**: Worker Secrets Store (`ISBNDB_API_KEY`)

**To check**:
```bash
# Get current key value (if accessible)
npx wrangler secret list

# Test key directly with curl
curl -H "Authorization: YOUR_KEY" https://api.premium.isbndb.com/book/9780439064873
```

### 3. Account Suspended/Quota Exceeded

ISBNdb may have suspended account due to:
- Payment issue
- Terms of service violation
- Daily quota exceeded (but Alexandria quota shows 0 used)

**To check**:
- Login to ISBNdb dashboard: https://isbndb.com/apidocs/v2
- Check account status
- Verify billing is current
- Check quota usage on their end

### 4. IP/Access Restriction

ISBNdb may have blocked Cloudflare Workers IPs.

**To check**:
- Test from local machine vs Worker
- Check if ISBNdb has IP whitelist requirements

## Immediate Actions Required

### 1. Verify ISBNdb Account Status
- Login to ISBNdb dashboard
- Check subscription status (Premium active?)
- Verify API key is current
- Check quota usage on their side

### 2. Test API Key Directly
```bash
# From local machine (bypass Worker)
ISBNDB_KEY="YOUR_KEY_HERE"
curl -H "Authorization: $ISBNDB_KEY" \
  https://api.premium.isbndb.com/book/9780439064873
```

### 3. Check Base URL
Try alternative endpoints:
- `api2.isbndb.com` (Basic/old endpoint)
- `api.isbndb.com` (Generic endpoint)
- Contact ISBNdb support if URL changed

### 4. Update Worker Secrets if Needed
```bash
npx wrangler secret put ISBNDB_API_KEY
# Paste new key when prompted
```

## Impact on Alexandria

### Blocked Functionality
- ❌ Author bibliographies (`/api/authors/enrich-bibliography`)
- ❌ Batch ISBN enrichment (`/api/enrich/batch-direct`)
- ❌ New release harvesting (`/api/books/enrich-new-releases`)
- ❌ Bulk author harvest scripts
- ❌ ISBNdb metadata enrichment

### Still Working ✅
- ✅ Search (uses existing enriched data)
- ✅ Cover serving (uses R2 cache)
- ✅ OpenLibrary fallback searches
- ✅ Wikidata author enrichment
- ✅ Database queries

## Related Issues

- **Issue #108**: Bulk harvest failures (now explained - 403 errors)
- **Issue #109**: Queue validation (blocked - can't queue new covers)
- **MASTER-PLAN.md**: Top-1000 harvest (blocked until ISBNdb access restored)

## Timeline

- **Jan 2, 21:40 GMT**: Discovered during harvest attempt
- **Jan 2, 21:45 GMT**: Confirmed all 10 ISBNdb endpoints returning 403
- **Jan 2, 21:50 GMT**: Script bugs fixed, but harvest still blocked by 403
- **Next**: Verify ISBNdb account status and API key

## Workaround Options

### Short-term (Until ISBNdb Fixed)
1. **Use cached data only**: Alexandria has 28.6M enriched editions
2. **OpenLibrary fallback**: Already implemented for ISBN searches
3. **Google Books API**: Partial alternative for metadata
4. **Pause bulk harvesting**: Wait for ISBNdb access restoration

### Long-term (Reduce ISBNdb Dependency)
1. **Multi-provider strategy**: Google Books + OpenLibrary + ISBNdb
2. **Local ISBN database**: Build from open datasets
3. **API redundancy**: Multiple ISBNdb accounts or services

---

**Status**: ⛔ **CRITICAL BLOCKER**
**Priority**: P0 - Blocks all enrichment operations
**Owner**: Requires manual ISBNdb account verification
**Next Action**: Check ISBNdb dashboard and API key validity
