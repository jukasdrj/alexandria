# Legacy Cover API Routes - Usage Analytics

**Created:** 2026-01-14
**Status:** Active - Collecting data
**Purpose:** Determine if external consumers exist for deprecated cover processing endpoints

---

## Overview

Phase 1 of Issue #178 implements analytics tracking for 2 legacy cover processing endpoints to measure actual usage before deprecation.

### Endpoints Tracked

1. **POST /covers/:isbn/process** - Synchronous single cover processing
2. **POST /covers/batch** - Synchronous batch cover processing (max 10 ISBNs)

### Endpoints NOT Tracked (Still in Use)

1. **GET /covers/:isbn/:size** - Primary cover serving endpoint (PRODUCTION USE)
2. **GET /covers/:isbn/status** - Cover metadata query (LEGITIMATE API)

---

## Implementation Details

### Analytics Dataset

**Binding:** `COVER_ANALYTICS`
**Dataset:** `alexandria_covers`
**Collection Period:** 2-4 weeks (Feb 11-25, 2026)

### Event Schema

```typescript
interface LegacyRouteEvent {
  // Indexes (queryable fields)
  indexes: ['legacy_route_access'],

  // Blobs (string values)
  blobs: [
    endpoint: '/covers/:isbn/process' | '/covers/batch',
    method: 'POST',
    user_agent: string | 'unknown',
    referer: string | 'unknown',
  ],

  // Doubles (numeric values)
  doubles: [
    response_status: number, // HTTP status code
    response_time_ms: number, // Request duration
    isbn_count: number, // 1 for single, N for batch
  ],
}
```

### Deprecation Headers

Both endpoints now return deprecation warnings in HTTP headers:

```http
X-Deprecated: true
Warning: 299 - "This endpoint is deprecated. Use queue-based cover processing instead."
```

---

## Querying Analytics Data

### Check Total Usage

```bash
# Query last 7 days of legacy route usage
wrangler analytics sql "
  SELECT COUNT(*) as request_count
  FROM alexandria_covers
  WHERE indexes[1] = 'legacy_route_access'
  AND timestamp > NOW() - INTERVAL '7' DAY
"
```

### Breakdown by Endpoint

```bash
wrangler analytics sql "
  SELECT
    blobs[1] as endpoint,
    COUNT(*) as request_count,
    AVG(doubles[2]) as avg_response_time_ms,
    SUM(doubles[3]) as total_isbns_processed
  FROM alexandria_covers
  WHERE indexes[1] = 'legacy_route_access'
  AND timestamp > NOW() - INTERVAL '7' DAY
  GROUP BY blobs[1]
"
```

### Identify External Consumers

```bash
wrangler analytics sql "
  SELECT
    blobs[1] as endpoint,
    blobs[3] as user_agent,
    blobs[4] as referer,
    COUNT(*) as request_count
  FROM alexandria_covers
  WHERE indexes[1] = 'legacy_route_access'
  AND timestamp > NOW() - INTERVAL '7' DAY
  GROUP BY blobs[1], blobs[3], blobs[4]
  ORDER BY request_count DESC
"
```

### Check HTTP Status Distribution

```bash
wrangler analytics sql "
  SELECT
    blobs[1] as endpoint,
    doubles[1] as status_code,
    COUNT(*) as count
  FROM alexandria_covers
  WHERE indexes[1] = 'legacy_route_access'
  AND timestamp > NOW() - INTERVAL '7' DAY
  GROUP BY blobs[1], doubles[1]
  ORDER BY blobs[1], doubles[1]
"
```

---

## Testing Commands

### Test Single Cover Processing

```bash
curl -X POST 'https://alexandria.ooheynerds.com/covers/9780439064873/process' \
  -H "Content-Type: application/json" \
  -i
```

**Expected Response Headers:**
```http
X-Deprecated: true
Warning: 299 - "This endpoint is deprecated. Use queue-based cover processing instead."
```

### Test Batch Cover Processing

```bash
curl -X POST 'https://alexandria.ooheynerds.com/covers/batch' \
  -H "Content-Type: application/json" \
  -d '{
    "isbns": ["9780439064873", "9780316769488", "9780061120084"]
  }' \
  -i
```

**Expected Response Headers:**
```http
X-Deprecated: true
Warning: 299 - "This endpoint is deprecated. Use queue-based cover processing instead."
```

---

## Expected Results

### Zero Usage Scenario (Most Likely)

If analytics show **0-5 requests/day** total:
- ✅ Confirms no external consumers
- ✅ Safe to proceed to Phase 2 (6-month deprecation period)
- ✅ Phase 3 (code removal) can proceed after sunset date

### Low Usage Scenario

If analytics show **5-50 requests/day**:
- ⚠️ Investigate user-agent + referer patterns
- Check if requests are from bendv3 or other internal services
- Contact consumers if external (via referer domain)
- Consider longer deprecation period (12 months)

### High Usage Scenario (Unlikely)

If analytics show **>50 requests/day**:
- 🚨 Significant external usage detected
- **DO NOT DEPRECATE** - keep routes for backward compatibility
- Mark endpoints as "Legacy (not recommended)" in documentation
- Focus on optimizing new queue-based system instead

---

## Timeline

| Date | Milestone |
|------|-----------|
| 2026-01-14 | Phase 1 deployed, analytics active |
| 2026-01-21 | 1-week checkpoint (review initial data) |
| 2026-02-11 | 4-week checkpoint (minimum collection period) |
| 2026-02-25 | Final review and Phase 2 decision |

---

## Phase 2 Decision Matrix

| Usage Level | Action |
|-------------|--------|
| 0-5 req/day | ✅ Proceed to Phase 2 (deprecation) |
| 5-50 req/day | ⚠️ Investigate + contact consumers |
| >50 req/day | 🚨 Keep routes, mark as legacy |

---

## Next Steps (After Data Collection)

### If Zero Usage Confirmed

1. Update Issue #178 with findings
2. Start Phase 2: 6-month deprecation period
3. Add sunset date headers: `X-Sunset: 2026-08-25`
4. Update API documentation with migration guide
5. Monitor for 6 months
6. Proceed to Phase 3: Code removal

### If Usage Detected

1. Document consumers (user-agent, referer, request patterns)
2. Reach out to external consumers via referer domain
3. Provide migration timeline (6-12 months)
4. Offer assistance with queue-based migration
5. Extended monitoring period

---

## Files Modified

- `worker/src/routes/covers-legacy.ts` - Added analytics + deprecation headers (lines 408-601)

## Deployment

- **Version:** 0071ad9d-4e25-497f-96bc-9d5659fc7a32
- **Deployed:** 2026-01-14 @ 20:40 UTC
- **Status:** ✅ Production active

---

**Related:** Issue #178 (Deprecate Legacy Cover API Routes)
**Next Review:** 2026-01-21 (1-week checkpoint)
