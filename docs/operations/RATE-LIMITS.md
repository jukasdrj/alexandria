# API Rate Limits Reference

**Last Updated**: 2026-01-09
**Purpose**: Central reference for all Alexandria API rate limits

## Overview

Alexandria integrates with multiple external APIs, each with different rate limiting requirements. This document provides a comprehensive reference for all rate limits and how they're enforced.

---

## Rate Limit Summary

| API | Plan | Rate Limit | Min Delay | Enforcement | Storage |
|-----|------|------------|-----------|-------------|---------|
| **ISBNdb** | Premium ($29.95/mo) | 3 req/sec | 350ms | KV-backed quota | `QUOTA_KV` |
| **Google Books** | Free | 1,000 req/day | None | Daily quota | Auto-adjuster |
| **Archive.org** | Free | 1 req/sec (policy) | 1000ms | KV-backed delay | `CACHE` |
| **Wikipedia** | Free | 1 req/sec (policy) | 1000ms | KV-backed delay | `CACHE` |
| **Wikidata** | Free | 2 req/sec (60/min) | 500ms | KV-backed delay | `CACHE` |
| **Gemini** | Free | Varies | None | Backpressure | None |

---

## Paid APIs

### ISBNdb Premium

**Plan**: Premium ($29.95/month)
**Official Limit**: 3 requests/second
**Daily Quota**: ~15,000 calls/day (no rollover)
**Quota Reset**: Midnight UTC

**Enforcement**: Centralized quota tracking via `QUOTA_KV`
- Hard limit: 13,000/day (with 2,000 buffer for safety)
- Fail-closed: Blocks requests when quota exhausted
- Real-time tracking: Every API call recorded immediately
- Persistent state: Survives Worker deployments

**Implementation**: `worker/src/services/quota-manager.ts`

```typescript
// Check quota before API call
const quotaOk = await checkQuota(env.QUOTA_KV);
if (!quotaOk) {
  throw new Error('ISBNdb quota exhausted');
}

// Make API call
const response = await fetch(ISBNDB_API_URL, ...);

// Record usage
await recordApiCall(env.QUOTA_KV, 1);
```

**Rate Limiting**: 350ms between requests (3 req/sec with safety margin)
- Pattern: KV-backed delay (same as Open APIs)
- KV Key: `cover_fetcher:isbndb_last_request`
- Implementation: `worker/services/cover-fetcher.ts` - `enforceISBNdbRateLimit()`

**Monitoring**: `GET /api/quota/status`
```json
{
  "success": true,
  "quota": {
    "used": 8542,
    "limit": 13000,
    "remaining": 4458,
    "percentage": 65.71,
    "resets_at": "2026-01-10T00:00:00.000Z",
    "hours_until_reset": 6.5
  }
}
```

**Best Practices**:
- Use batch endpoints (`POST /books` with 1000 ISBNs counts as 1 call)
- Check `/api/quota/status` regularly
- Monitor quota usage in Analytics Engine
- Reserve quota for high-priority user requests

### Google Books API

**Plan**: Free
**Official Limit**: 1,000 requests/day
**Quota Reset**: Daily (time zone unknown)

**Enforcement**: Auto-adjuster with predictive quota management
- Tracks actual usage vs estimated usage
- Learns daily quota patterns over 48 hours
- Reduces quota estimates when approaching limits
- No hard limit (degrades gracefully)

**Implementation**: `worker/src/services/google-books.ts`

**Auto-Adjuster Metrics**:
- `quota_used_today`: Actual API calls made
- `quota_estimated_today`: Estimated usage based on cache misses
- `quota_limit_today`: Current daily limit (starts at 1000)
- `quota_adjustment_factor`: Multiplier for safety (0.8-1.0)

**Best Practices**:
- Use for cover fetching only (not metadata)
- Archive.org and Wikidata provide free alternatives
- Monitor auto-adjuster logs
- Caching reduces load (cache hit rate >90%)

---

## Free/Open APIs

All free APIs use **KV-backed rate limiting** for distributed safety across Cloudflare Workers.

### Archive.org

**Policy**: "Be reasonable" - no hard limit, but respect server
**Recommended**: 1 request/second
**Alexandria Limit**: 1 req/sec (1000ms delay)

**Enforcement**: KV-backed delay
- KV Key: `rate_limit:archive.org`
- Min Delay: 1000ms
- TTL: 60 seconds (auto-cleanup)

**Implementation**: `worker/services/archive-org.ts`

```typescript
await enforceRateLimit(
  env.CACHE,
  'rate_limit:archive.org',
  RATE_LIMITS['archive.org'], // 1000ms
  logger
);
```

**Why KV-backed?**
- Cloudflare Workers run in distributed isolates globally
- In-memory state doesn't work (each isolate thinks it's first)
- KV provides shared state across all instances

**Graceful Degradation**:
```typescript
try {
  await kv.put(kvKey, Date.now().toString(), { expirationTtl: 60 });
} catch (error) {
  logger.warn('KV rate limiting unavailable, proceeding without delay');
  // Continue without rate limiting (better than failing)
}
```

### Wikipedia

**Policy**: Max 200 req/sec (bot policy), but we use 1 req/sec to be respectful
**Alexandria Limit**: 1 req/sec (1000ms delay)

**Enforcement**: KV-backed delay (same pattern as Archive.org)
- KV Key: `rate_limit:wikipedia`
- Min Delay: 1000ms
- TTL: 60 seconds

**Implementation**: `worker/services/wikipedia.ts`

```typescript
await enforceRateLimit(
  env.CACHE,
  'rate_limit:wikipedia',
  RATE_LIMITS['wikipedia'], // 1000ms
  logger
);
```

**User-Agent Required**: Wikipedia requires identification
```
Alexandria/2.3.0 (nerd@ooheynerds.com; Author biographies; Donate: https://donate.wikimedia.org)
```

### Wikidata

**Policy**: Max 60 req/min for SPARQL endpoint
**Alexandria Limit**: 2 req/sec (500ms delay)

**Enforcement**: KV-backed delay
- KV Key: `rate_limit:wikidata`
- Min Delay: 500ms (2 req/sec)
- TTL: 60 seconds

**Implementation**: `worker/services/wikidata.ts`

```typescript
await enforceRateLimit(
  env.CACHE,
  'rate_limit:wikidata',
  RATE_LIMITS['wikidata'], // 500ms
  logger
);
```

**User-Agent Required**: Wikidata bot policy
```
Alexandria/2.3.0 (nerd@ooheynerds.com; Book metadata enrichment; Donate: https://donate.wikimedia.org)
```

**SPARQL Considerations**:
- Complex queries can be slow (>1 second)
- Caching essential (30-day TTL)
- Batch queries where possible (VALUES clause)

---

## Rate Limiting Implementation

### KV-Backed Rate Limiter

**Location**: `worker/lib/open-api-utils.ts`

**Pattern**:
```typescript
export async function enforceRateLimit(
  kv: KVNamespace,
  kvKey: string,
  minDelayMs: number,
  logger?: Logger
): Promise<void> {
  const now = Date.now();

  try {
    // Fetch last request timestamp from KV
    const lastRequestStr = await kv.get(kvKey);
    const lastRequest = lastRequestStr ? parseInt(lastRequestStr, 10) : 0;
    const timeSinceLastRequest = now - lastRequest;

    // If not enough time has passed, wait
    if (timeSinceLastRequest < minDelayMs) {
      const waitTime = minDelayMs - timeSinceLastRequest;
      logger?.debug(`Rate limit: waiting ${waitTime}ms`, { kvKey });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Update KV with current timestamp
    await kv.put(kvKey, Date.now().toString(), { expirationTtl: 60 });

  } catch (error) {
    // Graceful degradation: log warning and continue
    logger?.warn('KV rate limiting unavailable, proceeding without delay', {
      kvKey,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
```

**Key Features**:
- **Distributed-safe**: Uses KV for shared state across Worker isolates
- **Graceful degradation**: Continues on KV failure (better than blocking)
- **Auto-cleanup**: 60-second TTL prevents stale entries
- **Minimal latency**: Only waits when necessary

### Quota Tracking (ISBNdb)

**Location**: `worker/src/services/quota-manager.ts`

**Pattern**:
```typescript
export async function checkQuota(quotaKv: KVNamespace): Promise<boolean> {
  const state = await getQuotaState(quotaKv);
  return state.used < state.limit;
}

export async function recordApiCall(
  quotaKv: KVNamespace,
  count: number = 1
): Promise<void> {
  const state = await getQuotaState(quotaKv);
  state.used += count;
  state.last_updated = new Date().toISOString();
  await quotaKv.put(QUOTA_KV_KEY, JSON.stringify(state));
}
```

**State Structure**:
```typescript
interface QuotaState {
  used: number;              // Calls used today
  limit: number;             // Daily limit (13000)
  last_reset: string;        // ISO timestamp of last reset
  last_updated: string;      // ISO timestamp of last update
}
```

**Auto-Reset**: Midnight UTC
```typescript
const now = new Date();
const lastReset = new Date(state.last_reset);
if (now.getUTCDate() !== lastReset.getUTCDate()) {
  // New day - reset quota
  state.used = 0;
  state.last_reset = now.toISOString();
}
```

---

## Monitoring Rate Limits

### Check ISBNdb Quota

```bash
curl https://alexandria.ooheynerds.com/api/quota/status
```

Response:
```json
{
  "success": true,
  "quota": {
    "used": 8542,
    "limit": 13000,
    "remaining": 4458,
    "percentage": 65.71,
    "resets_at": "2026-01-10T00:00:00.000Z",
    "hours_until_reset": 6.5
  }
}
```

### Check KV Rate Limit State

```bash
# Via Wrangler
npx wrangler kv:key get "rate_limit:wikipedia" --namespace-id=<KV_ID>

# Via API (if implemented)
curl https://alexandria.ooheynerds.com/api/debug/rate-limits
```

### Monitor Logs

```bash
# Live Worker logs
npm run tail

# Filter for rate limit events
npm run tail | grep "Rate limit"

# Output examples:
# [Archive.org] Rate limit: waiting 500ms
# [Wikipedia] Rate limit unavailable, proceeding
```

---

## Troubleshooting

### ISBNdb Quota Exhausted

**Symptoms**:
- `/api/enrich/batch-direct` returns 429 Too Many Requests
- `/api/quota/status` shows `remaining: 0`

**Diagnosis**:
```bash
curl https://alexandria.ooheynerds.com/api/quota/status
```

**Solutions**:
1. **Wait for reset**: Quota resets at midnight UTC
2. **Use free APIs**: Archive.org, Wikidata provide cover alternatives
3. **Reduce usage**: Prioritize user requests over batch operations
4. **Increase quota**: Upgrade ISBNdb plan (if available)

**Prevention**:
- Monitor `/api/quota/status` regularly
- Set up alerts at 80% usage
- Reserve quota for high-priority operations
- Use batch endpoints (1000 ISBNs = 1 call)

### Rate Limit Errors (429)

**Symptoms**:
- API returns 429 Too Many Requests
- Worker logs show rate limit errors

**Diagnosis**:
1. Check if KV is working: `npx wrangler kv:key list --namespace-id=<ID>`
2. Verify rate limit delays in logs
3. Check for bugs causing rapid sequential calls

**Solutions**:
1. **Verify KV-backed rate limiting**: Ensure `enforceRateLimit()` is called before API requests
2. **Increase delays**: Adjust `RATE_LIMITS` constants if needed
3. **Fix bugs**: Check for loops making rapid requests

**Prevention**:
- Always use KV-backed rate limiting (never in-memory)
- Test with `npm run tail` to see actual delays
- Add logging to track API call frequency

### Slow Requests

**Symptoms**:
- API requests taking >5 seconds
- Worker timeout errors

**Diagnosis**:
1. Check if rate limiting is adding delays (expected)
2. Verify cache hit rate (should be >70%)
3. Test API directly (may be slow on provider side)

**Solutions**:
1. **Enable caching**: Ensure responses are cached
2. **Increase cache TTL**: Longer TTL = fewer slow requests
3. **Parallel requests**: Don't block on rate limits unnecessarily
4. **Provider issue**: Some APIs (Wikidata SPARQL) can be slow

**Prevention**:
- Cache aggressively (7-30 day TTLs)
- Monitor cache hit rates
- Use batch endpoints where available

---

## Best Practices

### 1. Always Use KV-Backed Rate Limiting

❌ **Wrong**: In-memory state
```typescript
private lastRequestTime = 0; // Doesn't work in distributed Workers
```

✅ **Right**: KV-backed state
```typescript
await enforceRateLimit(env.CACHE, kvKey, minDelayMs, logger);
```

### 2. Check Quota Before Expensive Operations

```typescript
// Before batch enrichment
const quotaOk = await checkQuota(env.QUOTA_KV);
if (!quotaOk) {
  return c.json({ error: 'ISBNdb quota exhausted' }, 429);
}

// Make API call
const response = await fetchISBNdbBatch(isbns, env);

// Record usage
await recordApiCall(env.QUOTA_KV, 1);
```

### 3. Monitor Quota Regularly

```typescript
// Daily quota check (via cron or manual)
const status = await fetch('https://alexandria.ooheynerds.com/api/quota/status');
const data = await status.json();

if (data.quota.percentage > 80) {
  console.warn('ISBNdb quota at 80%!', data.quota);
  // Send alert, reduce usage, etc.
}
```

### 4. Fail Gracefully on Rate Limit Errors

```typescript
try {
  const data = await fetchFromAPI(...);
  return data;
} catch (error) {
  if (error.status === 429) {
    logger.warn('Rate limited, trying alternative provider');
    return await fetchFromAlternative(...);
  }
  throw error;
}
```

### 5. Log Rate Limit Events

```typescript
logger.debug('Rate limit enforced', {
  provider: 'wikipedia',
  delay_ms: waitTime,
  last_request_ms: timeSinceLastRequest
});
```

---

## Rate Limit Configuration

### Constants

**Location**: `worker/lib/open-api-utils.ts`

```typescript
export const RATE_LIMITS = {
  'archive.org': 1000,  // 1 second
  'wikipedia': 1000,    // 1 second
  'wikidata': 500,      // 500ms (2 req/sec)
} as const;
```

### Adjusting Rate Limits

To change rate limits:

1. **Edit constants** in `worker/lib/open-api-utils.ts`
2. **Redeploy Worker**: `npm run deploy`
3. **Monitor logs**: Verify new delays are applied
4. **Test**: Make API requests and check timing

**Example**: Increase Wikidata to 1 req/sec
```typescript
export const RATE_LIMITS = {
  'archive.org': 1000,
  'wikipedia': 1000,
  'wikidata': 1000,  // Changed from 500ms
} as const;
```

---

## Related Documentation

- **Open API Integrations**: `docs/api/OPEN-API-INTEGRATIONS.md`
- **Donation Tracking**: `docs/operations/DONATION-TRACKING.md`
- **Quota Manager**: `worker/src/services/quota-manager.ts`
- **ISBNdb Integration**: `docs/api/ISBNDB-ENDPOINTS.md`

---

## API Provider Policies

### Archive.org
- Policy: https://archive.org/about/terms.php
- Contact: https://archive.org/about/contact.php
- Be respectful, identify yourself

### Wikipedia
- Bot Policy: https://www.mediawiki.org/wiki/API:Etiquette
- Contact: https://en.wikipedia.org/wiki/Wikipedia:Contact_us
- User-Agent required, max 200 req/sec (we use 1 req/sec)

### Wikidata
- Bot Policy: https://www.wikidata.org/wiki/Wikidata:Bot_policy
- SPARQL: https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service
- Max 60 req/min for SPARQL (we use 2 req/sec = 120/min with bursts)

### ISBNdb
- Premium Plan: https://isbndb.com/isbn-database
- Documentation: https://isbndb.com/apidocs/v2
- Support: support@isbndb.com
