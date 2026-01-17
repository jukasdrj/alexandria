# Provider Analytics - Operations Dashboard

**Purpose**: Actionable dashboards and health checks for Alexandria's External Service Provider system.

**Audience**: Solo developer managing multiple repos (Alexandria, bendv3, future projects)

**Last Updated**: 2026-01-14

---

## 🎯 5-Minute System Health Check

**Run this FIRST every time before pausing development work.**

### Quick Status Query

```graphql
# Cloudflare Analytics Engine GraphQL
# Dashboard: https://dash.cloudflare.com → Analytics & Logs → Analytics Engine → GraphQL
# Dataset: alexandria_performance

query SystemHealth {
  # Overall provider success rate (last 24 hours)
  providerSuccess: alexandriaPerformanceAdaptiveGroups(
    limit: 1000
    filter: {
      index: "provider_request"
    }
    orderBy: [timestamp_DESC]
  ) {
    count
    dimensions {
      blob1  # provider
      blob4  # status (success/error/timeout)
    }
  }

  # ISBNdb quota usage
  isbndbQuota: alexandriaPerformanceAdaptiveGroups(
    limit: 100
    filter: {
      index: "provider_cost"
      blob1: "isbndb"
    }
    orderBy: [timestamp_DESC]
  ) {
    sum {
      double1  # api_calls_count
    }
    dimensions {
      blob1  # provider
    }
  }

  # Cache hit rates
  cachePerformance: alexandriaPerformanceAdaptiveGroups(
    limit: 1000
    filter: {
      index: "provider_request"
    }
    orderBy: [timestamp_DESC]
  ) {
    avg {
      double2  # cache_hit (0 or 1)
    }
    dimensions {
      blob1  # provider
    }
  }

  # Fallback chain health
  fallbackRate: alexandriaPerformanceAdaptiveGroups(
    limit: 1000
    filter: {
      index: "orchestrator_fallback"
    }
    orderBy: [timestamp_DESC]
  ) {
    count
    avg {
      double1  # attempts_count
    }
    dimensions {
      blob1  # orchestrator
      blob3  # successful_provider
    }
  }
}
```

### Expected Results

| Metric | ✅ Healthy | ⚠️ Warning | ❌ Critical | Action |
|--------|-----------|-----------|------------|--------|
| **Overall Success Rate** | >95% | 90-95% | <90% | [Troubleshoot failing provider](#provider-failing-success-rate-90) |
| **ISBNdb Quota Usage** | <80% daily | 80-95% | >95% | [Reduce backfill frequency](#isbndb-quota-exhaustion) |
| **Average Latency** | <500ms | 500-1000ms | >1000ms | [Check slow providers](#high-latency-p95-1000ms) |
| **Cache Hit Rate** | >60% | 40-60% | <40% | [Investigate cache misses](#low-cache-hit-rate-60) |
| **Fallback Rate** | <20% | 20-40% | >40% | [Check primary provider](#excessive-fallbacks-40) |

### Interpreting Results

**Success Rate Calculation:**
```javascript
// From providerSuccess query results
const totalRequests = providerSuccess.reduce((sum, group) => sum + group.count, 0);
const successfulRequests = providerSuccess
  .filter(group => group.dimensions.blob4 === 'success')
  .reduce((sum, group) => sum + group.count, 0);

const successRate = (successfulRequests / totalRequests) * 100;
console.log(`System Success Rate: ${successRate.toFixed(1)}%`);
```

**ISBNdb Quota Check:**
```javascript
// From isbndbQuota query results
const dailyLimit = 13000;  // From Premium plan
const currentUsage = isbndbQuota[0]?.sum?.double1 || 0;
const quotaPercent = (currentUsage / dailyLimit) * 100;

if (quotaPercent > 95) {
  console.error('❌ CRITICAL: ISBNdb quota exhausted');
  console.log('Action: Pause backfill operations');
} else if (quotaPercent > 80) {
  console.warn('⚠️ WARNING: ISBNdb quota >80%');
  console.log('Action: Monitor closely, reduce batch sizes');
} else {
  console.log(`✅ ISBNdb quota healthy: ${quotaPercent.toFixed(1)}%`);
}
```

**Cache Hit Rate:**
```javascript
// From cachePerformance query results
const cacheHitRate = cachePerformance.reduce((sum, group) => {
  return sum + (group.avg.double2 * 100);
}, 0) / cachePerformance.length;

console.log(`Cache Hit Rate: ${cacheHitRate.toFixed(1)}%`);
if (cacheHitRate < 40) {
  console.error('❌ Cache not working effectively');
} else if (cacheHitRate < 60) {
  console.warn('⚠️ Cache could be better');
} else {
  console.log('✅ Cache performing well');
}
```

---

## 📊 Detailed Dashboard Queries

### 1. Provider Performance

#### Success Rate by Provider

**What it measures**: Percentage of successful requests per provider over 24 hours

**Why it matters**: Identifies unreliable providers that need priority adjustment or removal

**Healthy range**: >95% for paid providers (ISBNdb), >85% for free providers

**Action if abnormal**: Check rate limits, quota, upstream status

```graphql
query ProviderSuccessRates {
  viewer {
    accounts(filter: { accountTag: $accountId }) {
      alexandriaPerformanceAdaptiveGroups(
        limit: 1000
        filter: {
          index: "provider_request"
          datetime_geq: "2026-01-13T00:00:00Z"
          datetime_lt: "2026-01-14T00:00:00Z"
        }
      ) {
        count
        dimensions {
          blob1  # provider
          blob4  # status
        }
      }
    }
  }
}
```

**Example output interpretation:**

| Provider | Total Requests | Success | Error | Timeout | Success Rate | Status |
|----------|---------------|---------|-------|---------|--------------|--------|
| isbndb | 1,250 | 1,231 | 15 | 4 | 98.5% | ✅ |
| google-books | 890 | 856 | 34 | 0 | 96.2% | ✅ |
| open-library | 456 | 206 | 180 | 70 | 45.2% | ❌ |
| wikidata | 234 | 198 | 36 | 0 | 84.6% | ⚠️ |

**Action for open-library (45.2%)**:
1. Check rate limits: [Query rate limit status](#rate-limit-compliance)
2. Verify API key/credentials: None required (public API)
3. Check upstream status: https://openlibrary.org/status
4. **Immediate mitigation**: Adjust provider priority to demote OpenLibrary

```typescript
// worker/lib/external-services/orchestrators/isbn-resolution.ts
const providerPriority = [
  'isbndb',        // Keep first
  'google-books',  // Keep second
  'archive-org',   // Move up from 4th → 3rd
  'open-library',  // Demote to 4th (was 3rd)
  'wikidata'       // Keep last
];
```

#### Latency Percentiles by Provider

**What it measures**: Response time distribution (P50, P95, P99) per provider

**Why it matters**: Slow providers impact user experience and Worker CPU time

**Healthy range**: P95 <500ms for cached, <2000ms for live API calls

**Action if abnormal**: Increase timeouts, reduce batch sizes, or demote provider priority

```graphql
query ProviderLatency {
  viewer {
    accounts(filter: { accountTag: $accountId }) {
      alexandriaPerformanceAdaptiveGroups(
        limit: 10000
        filter: {
          index: "provider_request"
          datetime_geq: "2026-01-13T00:00:00Z"
          datetime_lt: "2026-01-14T00:00:00Z"
        }
      ) {
        dimensions {
          blob1  # provider
          blob4  # status
        }
        quantiles {
          double1P50: quantile(probability: 0.5) { double1 }  # latency_ms
          double1P95: quantile(probability: 0.95) { double1 }
          double1P99: quantile(probability: 0.99) { double1 }
        }
      }
    }
  }
}
```

**Example output:**

| Provider | Status | P50 | P95 | P99 | Assessment |
|----------|--------|-----|-----|-----|------------|
| isbndb | success | 245ms | 412ms | 589ms | ✅ Fast |
| google-books | success | 312ms | 678ms | 1240ms | ✅ Good |
| open-library | success | 2100ms | 4500ms | 8900ms | ❌ Too slow |
| open-library | timeout | N/A | N/A | N/A | ❌ Timing out |
| wikidata | success | 1850ms | 3200ms | 4100ms | ⚠️ Acceptable (SPARQL) |

**Action for open-library (P95 4500ms)**:

```typescript
// worker/lib/external-services/http-client.ts
// Reduce timeout for OpenLibrary to fail faster
const serviceContext: ServiceContext = {
  timeoutMs: 5000,  // Reduce from default 10000ms
  cacheTtlSeconds: 604800,  // 7 days (unchanged)
  rateLimitKey: 'openlibrary',
  // ...
};
```

#### Error Type Distribution

**What it measures**: Breakdown of error types (timeout, rate_limit, invalid_response, network_error)

**Why it matters**: Identifies root cause of failures for targeted fixes

**Healthy range**: <5% total errors, <2% any single error type

**Action if abnormal**: See [Troubleshooting Guide](#-troubleshooting-guide)

```graphql
query ErrorBreakdown {
  alexandriaPerformanceAdaptiveGroups(
    limit: 1000
    filter: {
      index: "provider_request"
      blob4: "error"  # Only error status
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    dimensions {
      blob1  # provider
      blob5  # error_type
    }
  }
}
```

**Example output:**

| Provider | Error Type | Count | % of Provider Errors | Action |
|----------|-----------|-------|---------------------|--------|
| open-library | timeout | 70 | 38.9% | [Reduce timeout](#reduce-timeout) |
| open-library | rate_limit | 85 | 47.2% | [Increase delay](#rate-limit-compliance) |
| open-library | invalid_response | 25 | 13.9% | [Fix parser](#invalid-response) |
| wikidata | timeout | 28 | 77.8% | [Expected for SPARQL](#wikidata-timeouts) |
| google-books | invalid_response | 12 | 100% | [Update schema validation](#invalid-response) |

---

### 2. Fallback Chain Analysis

#### Fallback Success Patterns

**What it measures**: Which providers succeed after primary fails, average fallback depth

**Why it matters**: Validates fallback chain design, identifies weak links

**Healthy range**: <20% fallback rate, average attempts <1.5

**Action if abnormal**: Reorder provider priority, remove unreliable providers

```graphql
query FallbackPatterns {
  alexandriaPerformanceAdaptiveGroups(
    limit: 1000
    filter: {
      index: "orchestrator_fallback"
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    avg {
      double1  # attempts_count
      double2  # total_latency_ms
      double3  # success (0 or 1)
    }
    dimensions {
      blob1  # orchestrator
      blob2  # provider_chain (e.g., "isbndb,google-books,open-library")
      blob3  # successful_provider
    }
  }
}
```

**Example output:**

| Orchestrator | Provider Chain | Success Provider | Attempts Avg | Success Rate | Total Latency |
|-------------|----------------|------------------|--------------|--------------|---------------|
| isbn-resolution | isbndb,google-books,open-library | isbndb | 1.0 | 95% | 450ms | ✅ |
| isbn-resolution | isbndb,google-books,open-library | google-books | 2.0 | 80% | 1200ms | ⚠️ |
| isbn-resolution | isbndb,google-books,open-library | open-library | 3.0 | 45% | 8500ms | ❌ |
| cover-fetch | google-books,open-library,archive-org | google-books | 1.0 | 85% | 650ms | ✅ |
| cover-fetch | google-books,open-library,archive-org | archive-org | 2.5 | 70% | 2300ms | ⚠️ |

**Interpretation:**
- **95% success on first provider (isbndb)** = Healthy primary
- **80% success on second provider** = Acceptable fallback
- **45% success on third provider** = Remove from chain (too unreliable)

**Action**:
```typescript
// worker/lib/external-services/orchestrators/isbn-resolution.ts
// Remove open-library from chain (only 45% success rate)
const providerPriority = [
  'isbndb',
  'google-books',
  'archive-org',  // Skip open-library entirely
  'wikidata'
];
```

#### Orchestrator Performance

**What it measures**: Success rate and latency per orchestrator type

**Why it matters**: Identifies which workflows need optimization

**Healthy range**: >90% success for all orchestrators

```graphql
query OrchestratorPerformance {
  alexandriaPerformanceAdaptiveGroups(
    limit: 1000
    filter: {
      index: "orchestrator_fallback"
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    avg {
      double1  # attempts_count
      double3  # success
    }
    quantiles {
      double2P95: quantile(probability: 0.95) { double2 }  # total_latency_ms
    }
    dimensions {
      blob1  # orchestrator
    }
  }
}
```

**Example output:**

| Orchestrator | Total Operations | Avg Attempts | Success Rate | P95 Latency | Status |
|-------------|-----------------|--------------|--------------|-------------|--------|
| isbn-resolution | 1,850 | 1.4 | 92% | 2100ms | ✅ |
| cover-fetch | 3,200 | 1.2 | 96% | 1500ms | ✅ |
| metadata-enrichment | 2,100 | 1.1 | 98% | 800ms | ✅ |
| ratings | 450 | 2.8 | 65% | 5400ms | ❌ |
| edition-variants | 320 | 2.1 | 78% | 3200ms | ⚠️ |

**Action for ratings orchestrator (65% success)**:
1. Check which providers failing: Run [Error Breakdown](#error-type-distribution)
2. Review provider order: `worker/lib/external-services/orchestrators/ratings.ts`
3. Consider removing unreliable providers from chain

---

### 3. Cost Tracking

#### Daily Cost by Provider

**What it measures**: Estimated USD cost per provider based on API calls

**Why it matters**: Tracks spend against budget, identifies optimization opportunities

**Healthy range**: ISBNdb <$30/month, Gemini <$1/month, x.ai <$0.50/month

**Action if abnormal**: Reduce call frequency, optimize caching, consider cheaper alternatives

```graphql
query DailyCosts {
  alexandriaPerformanceAdaptiveGroups(
    limit: 100
    filter: {
      index: "provider_cost"
      datetime_geq: "2026-01-13T00:00:00Z"
      datetime_lt: "2026-01-14T00:00:00Z"
    }
  ) {
    sum {
      double1  # api_calls_count
      double2  # estimated_cost_usd
    }
    dimensions {
      blob1  # provider
      blob2  # tier (e.g., "premium", "free")
    }
  }
}
```

**Example output:**

| Provider | Tier | API Calls (24h) | Est. Cost (24h) | Monthly Projection | Status |
|----------|------|----------------|----------------|-------------------|--------|
| isbndb | premium | 8,450 | $0.97 | $29.10 | ✅ Under budget |
| gemini | paid | 125 | $0.0019 | $0.06 | ✅ Minimal |
| xai | paid | 87 | $0.0009 | $0.03 | ✅ Minimal |
| google-books | free | 2,340 | $0.00 | $0.00 | ✅ Free |
| open-library | free | 1,120 | $0.00 | $0.00 | ✅ Free |

**Cost Per Call Reference:**

| Provider | Cost Per Call | Daily Limit | Monthly Cost (Flat) |
|----------|--------------|-------------|---------------------|
| ISBNdb | $0.0023 | 13,000 | $29.95 (Premium plan) |
| Gemini (2.5 Flash) | ~$0.000015 | Unlimited | Usage-based ($0.075/$0.30 per 1M tokens) |
| x.ai (Grok) | ~$0.00001 | Unlimited | Usage-based ($5 per 1M tokens) |
| Google Books | $0 | Soft limit | Free |
| OpenLibrary | $0 | 100/5min | Free |
| Archive.org | $0 | 1/sec | Free |
| Wikidata | $0 | 2/sec | Free |

#### ISBNdb Quota Management

**What it measures**: Real-time quota usage against 13K daily limit

**Why it matters**: Prevents service degradation from quota exhaustion

**Healthy range**: <10,000 calls/day (77% utilization), resets midnight UTC

**Action if abnormal**: Immediately pause backfill operations, queue-based enrichment

```graphql
query ISBNdbQuotaStatus {
  alexandriaPerformanceAdaptiveGroups(
    limit: 1
    filter: {
      index: "provider_cost"
      blob1: "isbndb"
      datetime_geq: "2026-01-14T00:00:00Z"  # Today (UTC)
    }
  ) {
    sum {
      double1  # api_calls_count (cumulative today)
    }
  }
}
```

**JavaScript helper for real-time quota:**

```javascript
async function checkISBNdbQuota() {
  // Query Analytics Engine (above GraphQL)
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: ISBNdbQuotaStatus })
  });

  const { data } = await response.json();
  const currentUsage = data.viewer.accounts[0].alexandriaPerformanceAdaptiveGroups[0]?.sum?.double1 || 0;
  const dailyLimit = 13000;
  const percentUsed = (currentUsage / dailyLimit) * 100;

  let status, action;
  if (percentUsed >= 95) {
    status = '❌ CRITICAL';
    action = 'STOP all ISBNdb calls immediately. Pause backfill operations.';
  } else if (percentUsed >= 80) {
    status = '⚠️ WARNING';
    action = 'Reduce batch sizes. Monitor closely.';
  } else {
    status = '✅ HEALTHY';
    action = 'Continue normal operations.';
  }

  console.log(`ISBNdb Quota: ${currentUsage.toLocaleString()}/${dailyLimit.toLocaleString()} (${percentUsed.toFixed(1)}%)`);
  console.log(`Status: ${status}`);
  console.log(`Action: ${action}`);

  return { currentUsage, percentUsed, status, action };
}
```

**Integration with backfill scheduler:**

```bash
# Check quota before scheduling daily backfill
curl -X GET 'https://alexandria.ooheynerds.com/api/quota/status' | jq

# Response indicates available calls
{
  "success": true,
  "data": {
    "used": 8450,
    "limit": 13000,
    "remaining": 4550,
    "resetAt": "2026-01-15T00:00:00Z"
  }
}

# Schedule backfill ONLY if remaining > 500 buffer
if [ "$remaining" -gt 500 ]; then
  curl -X POST 'https://alexandria.ooheynerds.com/api/internal/schedule-backfill' \
    -H "X-Cron-Secret: $CRON_SECRET" \
    --data '{"batch_size": 5, "year_range": {"start": 2020, "end": 2020}}'
fi
```

---

### 4. Cache Efficiency

#### Cache Hit Rate by Provider

**What it measures**: Percentage of requests served from cache vs live API

**Why it matters**: High cache rates reduce costs, improve latency, preserve quotas

**Healthy range**: >60% overall, >80% for stable providers (ISBNdb, Google Books)

**Action if abnormal**: Increase TTL, fix cache key collisions, verify KV writes

```graphql
query CacheHitRates {
  alexandriaPerformanceAdaptiveGroups(
    limit: 1000
    filter: {
      index: "provider_request"
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    sum {
      double2  # cache_hit (sum of 1s = total cache hits)
    }
    dimensions {
      blob1  # provider
      blob2  # capability
    }
  }
}
```

**Example output:**

| Provider | Capability | Total Requests | Cache Hits | Cache Hit Rate | Status |
|----------|-----------|----------------|-----------|----------------|--------|
| isbndb | METADATA_ENRICHMENT | 1,250 | 987 | 78.9% | ✅ Good |
| google-books | COVER_IMAGES | 2,340 | 2,103 | 89.9% | ✅ Excellent |
| open-library | ISBN_RESOLUTION | 456 | 89 | 19.5% | ❌ Poor |
| wikidata | SUBJECT_ENRICHMENT | 234 | 45 | 19.2% | ❌ Poor |
| archive-org | PUBLIC_DOMAIN | 112 | 98 | 87.5% | ✅ Excellent |

**Action for open-library (19.5% cache hit)**:

1. **Check cache TTL**: Should be 7 days (604800 seconds)
```typescript
// worker/lib/external-services/providers/open-library-provider.ts
async resolveISBN(title: string, author: string, context: ServiceContext): Promise<ISBNResolutionResult | null> {
  const cacheKey = `openlibrary:isbn:${title}:${author}`;
  const ctx: ServiceContext = {
    ...context,
    cacheTtlSeconds: 604800,  // Verify this is set
    rateLimitKey: 'openlibrary'
  };
  // ...
}
```

2. **Check for cache key collisions**: Ensure unique cache keys
```typescript
// Add more context to cache key
const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedAuthor = author.toLowerCase().replace(/[^a-z0-9]/g, '');
const cacheKey = `openlibrary:isbn:v2:${normalizedTitle}:${normalizedAuthor}`;
```

3. **Verify KV writes are succeeding**: Check Worker logs
```bash
npx wrangler tail alexandria --format pretty | grep "Cache write"
```

#### Cache Performance Impact

**What it measures**: Latency difference between cached vs uncached requests

**Why it matters**: Validates caching ROI (should be 10x+ faster)

**Healthy range**: Cached <50ms, Uncached <2000ms, ratio >10x

```graphql
query CachePerformanceImpact {
  cached: alexandriaPerformanceAdaptiveGroups(
    limit: 10000
    filter: {
      index: "provider_request"
      double2: 1  # cache_hit = 1
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    quantiles {
      double1P50: quantile(probability: 0.5) { double1 }  # latency_ms
      double1P95: quantile(probability: 0.95) { double1 }
    }
    dimensions {
      blob1  # provider
    }
  }

  uncached: alexandriaPerformanceAdaptiveGroups(
    limit: 10000
    filter: {
      index: "provider_request"
      double2: 0  # cache_hit = 0
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    quantiles {
      double1P50: quantile(probability: 0.5) { double1 }
      double1P95: quantile(probability: 0.95) { double1 }
    }
    dimensions {
      blob1  # provider
    }
  }
}
```

**Example output:**

| Provider | Cached P50 | Uncached P50 | Speedup | Cached P95 | Uncached P95 | Status |
|----------|-----------|-------------|---------|-----------|-------------|--------|
| isbndb | 12ms | 245ms | 20.4x | 35ms | 412ms | ✅ Excellent |
| google-books | 18ms | 312ms | 17.3x | 42ms | 678ms | ✅ Excellent |
| wikidata | 15ms | 1850ms | 123x | 38ms | 3200ms | ✅ Cache critical! |
| open-library | 450ms | 2100ms | 4.7x | 890ms | 4500ms | ⚠️ Slow cache reads |

**Action for open-library (450ms cached P50)**:
- **Likely cause**: KV read latency from large cached payloads
- **Solution**: Compress cached responses or reduce payload size

```typescript
// worker/lib/external-services/http-client.ts
async cacheGet<T>(key: string): Promise<T | null> {
  const cached = await this.env.CACHE.get(key, 'text');
  if (!cached) return null;

  // Check if compressed (starts with gzip magic bytes)
  if (cached.startsWith('\x1f\x8b')) {
    const decompressed = await decompressGzip(cached);
    return JSON.parse(decompressed);
  }

  return JSON.parse(cached);
}
```

---

## 🔧 Troubleshooting Guide

### Provider Failing (Success Rate <90%)

**Symptom**: Provider shows <90% success rate in [Provider Performance](#1-provider-performance) dashboard

**Diagnostic Steps:**

#### Step 1: Identify Error Type
```graphql
query ProviderErrors($provider: String!) {
  alexandriaPerformanceAdaptiveGroups(
    filter: {
      index: "provider_request"
      blob1: $provider  # e.g., "open-library"
      blob4: "error"
    }
  ) {
    count
    dimensions {
      blob5  # error_type
    }
  }
}
```

**Error types and actions:**

| Error Type | Likely Cause | Fix |
|-----------|--------------|-----|
| `timeout` | Slow API, network issues | [Reduce timeout](#reduce-timeout) |
| `rate_limit` | Exceeded provider limits | [Increase delay between calls](#rate-limit-compliance) |
| `invalid_response` | API schema changed | [Update provider parser](#invalid-response) |
| `network_error` | DNS/connection issues | [Check upstream status](#check-upstream-status) |
| `quota_exhausted` | Daily limit reached | [Wait for reset or disable](#quota-exhaustion) |

#### Step 2: Check Rate Limits

```bash
# Query current rate limit state from QUOTA_KV
npx wrangler kv:key get --namespace-id=<QUOTA_KV_ID> "ratelimit:openlibrary:last_request"

# Expected format: Unix timestamp in milliseconds
# Example: 1736812800000 (2026-01-14 00:00:00 UTC)

# Check if delay is sufficient
# OpenLibrary requires 3000ms between requests (100 req / 5 min)
```

**Rate limit configuration per provider:**

| Provider | Limit | Delay Required | Current Config |
|----------|-------|---------------|----------------|
| ISBNdb | 3 req/sec | 334ms | 1000ms ✅ (conservative) |
| OpenLibrary | 100 req/5min | 3000ms | 3000ms ✅ |
| Archive.org | 1 req/sec | 1000ms | 1000ms ✅ |
| Wikidata | 2 req/sec | 500ms | 500ms ✅ |
| Wikipedia | 1 req/sec | 1000ms | 1000ms ✅ |

**Fix rate limit violations:**

```typescript
// worker/lib/external-services/providers/open-library-provider.ts
const RATE_LIMIT_DELAY = 3500;  // Increase from 3000ms to 3500ms (buffer)

async makeRateLimitedRequest<T>(context: ServiceContext, fn: () => Promise<T>): Promise<T> {
  const kvKey = 'ratelimit:openlibrary:last_request';
  const now = Date.now();

  const lastRequestStr = await context.env.QUOTA_KV.get(kvKey);
  const lastRequest = lastRequestStr ? parseInt(lastRequestStr) : 0;

  const elapsed = now - lastRequest;
  if (elapsed < RATE_LIMIT_DELAY) {
    const waitTime = RATE_LIMIT_DELAY - elapsed;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  await context.env.QUOTA_KV.put(kvKey, now.toString());
  return fn();
}
```

#### Step 3: Check Upstream Status

**ISBNdb**: https://api.isbndb.com/status (no public status page)
- Test manually: `curl -H "Authorization: <KEY>" https://api.premium.isbndb.com/books/9780140328721`

**Google Books**: https://status.cloud.google.com (Cloud Console status)
- Test: `curl "https://www.googleapis.com/books/v1/volumes?q=isbn:9780140328721"`

**OpenLibrary**: https://openlibrary.org/ (check if site loads)
- Test: `curl "https://openlibrary.org/search.json?q=the+hobbit&author=tolkien"`

**Archive.org**: https://status.archive.org/
- Test: `curl "https://archive.org/metadata/isbn_9780140328721"`

**Wikidata**: https://www.wikidata.org/wiki/Special:Statistics
- Test SPARQL: `curl "https://query.wikidata.org/sparql?query=SELECT%20%2A%20WHERE%20%7B%3Fbook%20wdt%3AP212%20%229780140328721%22%7D%20LIMIT%201"`

#### Step 4: Temporary Mitigation

```typescript
// worker/lib/external-services/orchestrators/isbn-resolution.ts
// Temporarily remove failing provider from chain

const orchestrator = new ISBNResolutionOrchestrator(registry, {
  providerPriority: [
    'isbndb',
    'google-books',
    // 'open-library',  // DISABLED - 45% success rate
    'archive-org',
    'wikidata'
  ],
  stopOnFirstSuccess: true,
  providerTimeoutMs: 10000
});
```

**Re-enable when fixed:**
1. Monitor [Error Type Distribution](#error-type-distribution) for 24 hours
2. When error rate drops below 10%, re-add to chain
3. Initially add at end of priority list (lowest priority)
4. Gradually promote if stable

---

### High Latency (P95 >1000ms)

**Symptom**: Provider P95 latency exceeds 1000ms in [Latency Percentiles](#latency-percentiles-by-provider)

**Diagnostic Steps:**

#### Step 1: Check Cache Hit Rate

Run [Cache Hit Rate query](#cache-hit-rate-by-provider) to identify if caching is working.

**Expected cache hit rates:**
- **ISBNdb**: >75% (frequently queried ISBNs)
- **Google Books**: >80% (covers, public domain status)
- **Wikidata**: >30% (SPARQL queries are unique)
- **Overall**: >60%

**If cache hit rate is low (<40%):**

```typescript
// Increase cache TTL for stable data
const CACHE_TTL = {
  'metadata': 2592000,     // 30 days (was 7 days)
  'covers': 2592000,       // 30 days (rarely change)
  'public_domain': 7776000, // 90 days (never changes)
  'ratings': 604800        // 7 days (may update)
};
```

#### Step 2: Identify Slow Operations

```graphql
query SlowRequests($provider: String!) {
  alexandriaPerformanceAdaptiveGroups(
    filter: {
      index: "provider_request"
      blob1: $provider
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    quantiles {
      latencyP99: quantile(probability: 0.99) { double1 }
    }
    dimensions {
      blob1  # provider
      blob2  # capability
      blob3  # operation
    }
  }
}
```

**Example output identifying bottleneck:**

| Provider | Capability | Operation | P99 Latency | Issue |
|----------|-----------|-----------|-------------|-------|
| wikidata | METADATA_ENRICHMENT | fetch_book_by_isbn | 4100ms | ✅ Expected (SPARQL) |
| wikidata | AUTHOR_BIOGRAPHY | fetch_author_bibliography | 8900ms | ❌ Too slow |
| open-library | ISBN_RESOLUTION | search_by_title_author | 6700ms | ❌ Timing out |

**Action for wikidata author_bibliography (8900ms)**:

```typescript
// worker/lib/external-services/providers/wikidata-provider.ts
// Reduce SPARQL query complexity - limit results

const BIBLIOGRAPHY_QUERY = `
SELECT DISTINCT ?work ?workLabel ?publicationDate
WHERE {
  ?work wdt:P50 wd:${authorQid} .
  OPTIONAL { ?work wdt:P577 ?publicationDate . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 100  # Add limit (was unlimited)
ORDER BY DESC(?publicationDate)
`;
```

#### Step 3: Adjust Timeouts

```typescript
// worker/lib/external-services/orchestrators/isbn-resolution.ts
const orchestrator = new ISBNResolutionOrchestrator(registry, {
  providerTimeoutMs: 5000,  // Reduce from 10000ms (fail faster)
  providerPriority: ['isbndb', 'google-books', 'archive-org'],
  stopOnFirstSuccess: true
});
```

**Provider-specific timeout recommendations:**

| Provider | Recommended Timeout | Rationale |
|----------|-------------------|-----------|
| ISBNdb | 5000ms | Fast paid API, fail quickly if slow |
| Google Books | 5000ms | Fast free API |
| OpenLibrary | 8000ms | Slow but reliable |
| Archive.org | 10000ms | Slow for metadata lookups |
| Wikidata | 15000ms | SPARQL queries are inherently slow |

#### Step 4: Reduce Batch Sizes

```typescript
// worker/src/services/queue-handlers.ts
// Reduce batch size for enrichment queue

export async function processEnrichmentQueue(
  batch: MessageBatch<EnrichmentMessage>,
  env: Env
): Promise<void> {
  // Process in smaller chunks to reduce per-message latency
  const CHUNK_SIZE = 25;  // Reduce from 50

  for (let i = 0; i < batch.messages.length; i += CHUNK_SIZE) {
    const chunk = batch.messages.slice(i, i + CHUNK_SIZE);
    await processChunk(chunk, env);
  }
}
```

---

### Excessive Fallbacks (>40%)

**Symptom**: Orchestrator fallback rate exceeds 40% in [Fallback Success Patterns](#fallback-success-patterns)

**Diagnostic Steps:**

#### Step 1: Identify Failing Primary Provider

```graphql
query FallbackAnalysis($orchestrator: String!) {
  alexandriaPerformanceAdaptiveGroups(
    filter: {
      index: "orchestrator_fallback"
      blob1: $orchestrator  # e.g., "isbn-resolution"
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    avg {
      double1  # attempts_count (>1 means fallback occurred)
    }
    dimensions {
      blob2  # provider_chain
      blob3  # successful_provider
    }
  }
}
```

**Example output:**

| Provider Chain | Successful Provider | Count | Avg Attempts | Fallback Rate |
|---------------|-------------------|-------|--------------|---------------|
| isbndb,google-books,open-library | isbndb | 450 | 1.0 | 0% ✅ |
| isbndb,google-books,open-library | google-books | 320 | 2.0 | 100% ⚠️ |
| isbndb,google-books,open-library | open-library | 180 | 3.0 | 100% ⚠️ |
| isbndb,google-books,open-library | null (all failed) | 85 | 3.0 | N/A ❌ |

**Interpretation:**
- **320 requests fell back to google-books** = ISBNdb failing 41% of the time (320 / (450+320+180+85))
- **85 total failures** = 8% of requests exhaust all providers

#### Step 2: Check Primary Provider Status

Run [Provider Success Rate](#success-rate-by-provider) for the primary provider (e.g., ISBNdb)

**If ISBNdb success rate <90%:**
1. Check quota: [ISBNdb Quota Management](#isbndb-quota-management)
2. Check upstream status: Manual API test
3. Review recent errors: [Error Type Distribution](#error-type-distribution)

#### Step 3: Reorder Provider Priority

**Current priority:**
```typescript
const providerPriority = ['isbndb', 'google-books', 'open-library', 'archive-org', 'wikidata'];
```

**If ISBNdb quota exhausted (temporary):**
```typescript
const providerPriority = [
  'google-books',   // Promote to primary (free, fast)
  'open-library',   // Second fallback (free, slower)
  'isbndb',         // Move to end (quota exhausted, expensive)
  'archive-org',
  'wikidata'
];
```

**If OpenLibrary unreliable (permanent):**
```typescript
const providerPriority = [
  'isbndb',
  'google-books',
  'archive-org',    // Skip open-library entirely
  'wikidata'
];
```

#### Step 4: Adjust Success Criteria

**Sometimes fallbacks are acceptable** (e.g., rare books not in ISBNdb)

**Healthy fallback rate by orchestrator:**

| Orchestrator | Healthy Fallback Rate | Rationale |
|-------------|---------------------|-----------|
| isbn-resolution | <30% | ISBNdb should cover 70%+ of queries |
| cover-fetch | <50% | Many books lack covers, fallbacks expected |
| ratings | <40% | Ratings data sparse, multiple sources needed |
| edition-variants | <35% | ISBNdb best source, fallbacks common |

**Adjust thresholds in monitoring:**

```javascript
// Fallback rate alert thresholds (per orchestrator)
const FALLBACK_THRESHOLDS = {
  'isbn-resolution': 0.30,
  'cover-fetch': 0.50,
  'metadata-enrichment': 0.20,
  'ratings': 0.40,
  'edition-variants': 0.35
};

function assessFallbackRate(orchestrator, fallbackRate) {
  const threshold = FALLBACK_THRESHOLDS[orchestrator] || 0.20;  // Default 20%

  if (fallbackRate > threshold * 1.5) {
    return '❌ CRITICAL';
  } else if (fallbackRate > threshold) {
    return '⚠️ WARNING';
  } else {
    return '✅ HEALTHY';
  }
}
```

---

### Low Cache Hit Rate (<60%)

**Symptom**: Cache hit rate below 60% in [Cache Hit Rate by Provider](#cache-hit-rate-by-provider)

**Diagnostic Steps:**

#### Step 1: Verify Cache Configuration

```typescript
// Check provider implementation for cache TTL
// Example: worker/lib/external-services/providers/open-library-provider.ts

async resolveISBN(title: string, author: string, context: ServiceContext): Promise<ISBNResolutionResult | null> {
  const ctx: ServiceContext = {
    ...context,
    cacheTtlSeconds: 604800,  // Should be set (7 days)
    rateLimitKey: 'openlibrary'
  };

  // Verify httpClient respects cacheTtlSeconds
  return this.httpClient.post<OpenLibrarySearchResponse>(
    'https://openlibrary.org/search.json',
    { q: `${title} ${author}`, limit: 1 },
    ctx  // Pass context with cache config
  );
}
```

**Check cache writes in http-client:**

```typescript
// worker/lib/external-services/http-client.ts
async request<T>(method: string, url: string, options: RequestOptions, context: ServiceContext): Promise<T> {
  const cacheKey = this.buildCacheKey(url, options);

  // Check cached response
  const cached = await this.cacheGet<T>(cacheKey, context);
  if (cached) {
    this.logger?.info('Cache hit', { url, cacheKey });
    // Track cache hit in analytics
    await this.trackAnalytics(context, {
      index: 'provider_request',
      blob4: 'success',
      double2: 1  // cache_hit = 1
    });
    return cached;
  }

  // Fetch from API
  const result = await this.fetchFromApi<T>(url, options, context);

  // CRITICAL: Verify cache write is called
  if (context.cacheTtlSeconds > 0) {
    await this.cachePut(cacheKey, result, context);
    this.logger?.info('Cache write', { url, cacheKey, ttl: context.cacheTtlSeconds });
  }

  return result;
}
```

#### Step 2: Check KV Namespace Health

```bash
# List recent cache keys to verify writes are succeeding
npx wrangler kv:key list --namespace-id=<CACHE_KV_ID> --prefix="openlibrary:isbn:" | head -n 20

# Expected output: List of recent cache keys
# If empty or outdated → KV writes are failing

# Check KV metrics in Cloudflare dashboard
# Navigate to: KV → <CACHE_KV_NAMESPACE> → Metrics
# Look for: Write operations per second, Read operations per second
```

**If KV writes are failing:**

```typescript
// Add error handling to cache writes
async cachePut(key: string, value: unknown, context: ServiceContext): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    await context.env.CACHE.put(key, serialized, {
      expirationTtl: context.cacheTtlSeconds
    });
    this.logger?.debug('Cache write success', { key });
  } catch (error) {
    // Don't throw - cache failures shouldn't break requests
    this.logger?.error('Cache write failed', { key, error });
    // Track failure in analytics
    await context.env.ANALYTICS.writeDataPoint({
      indexes: ['cache_failure'],
      blobs: [key, error.message]
    });
  }
}
```

#### Step 3: Analyze Cache Key Uniqueness

```bash
# Sample cache keys to check for collisions
npx wrangler kv:key list --namespace-id=<CACHE_KV_ID> | grep "openlibrary:isbn:"

# Expected pattern: Unique keys per query
# openlibrary:isbn:v2:thehobbit:jrrtolkien
# openlibrary:isbn:v2:1984:georgeorwell

# If seeing duplicates with different results → cache key collision
```

**Fix cache key collisions:**

```typescript
// Ensure cache keys are deterministic and unique
function buildCacheKey(url: string, options: RequestOptions, context: ServiceContext): string {
  const provider = context.provider || 'unknown';
  const capability = context.capability || 'unknown';

  // Include provider, capability, and normalized parameters
  const params = new URLSearchParams(options.params || {});
  const sortedParams = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  // Version prefix allows cache invalidation
  return `v2:${provider}:${capability}:${url}:${sortedParams}`;
}
```

#### Step 4: Increase Cache TTL for Stable Data

```typescript
// Adjust TTL based on data stability
const CACHE_TTL_BY_CAPABILITY: Record<string, number> = {
  'METADATA_ENRICHMENT': 2592000,    // 30 days (book metadata rarely changes)
  'COVER_IMAGES': 2592000,           // 30 days (cover URLs stable)
  'ISBN_RESOLUTION': 604800,         // 7 days (mappings stable)
  'PUBLIC_DOMAIN': 7776000,          // 90 days (never changes once determined)
  'RATINGS': 86400,                  // 1 day (ratings update frequently)
  'SUBJECT_ENRICHMENT': 1209600,     // 14 days (subjects semi-stable)
  'SERIES_INFO': 604800,             // 7 days (series data stable)
  'AWARDS': 2592000                  // 30 days (awards don't change)
};

function getCacheTtl(capability: string): number {
  return CACHE_TTL_BY_CAPABILITY[capability] || 604800;  // Default 7 days
}
```

---

### ISBNdb Quota Exhaustion

**Symptom**: ISBNdb quota usage >95% in [ISBNdb Quota Management](#isbndb-quota-management)

**Immediate Actions:**

#### Step 1: Pause Quota-Consuming Operations

```bash
# 1. Disable backfill scheduler (if running via cron)
# Comment out cron job or remove from cron triggers

# 2. Stop manual backfill operations
# Do NOT run: POST /api/harvest/backfill
# Do NOT run: POST /api/internal/schedule-backfill

# 3. Switch enrichment queue to use fallback providers
# This requires code change:
```

```typescript
// worker/lib/external-services/orchestrators/isbn-resolution.ts
// Temporarily reorder providers to avoid ISBNdb

const orchestrator = new ISBNResolutionOrchestrator(registry, {
  providerPriority: [
    'google-books',    // Promote to primary (free)
    'open-library',    // Free fallback
    'archive-org',     // Free fallback
    'wikidata',        // Free fallback
    'isbndb'           // Move to last resort
  ],
  stopOnFirstSuccess: true,
  providerTimeoutMs: 10000
});
```

#### Step 2: Deploy Emergency Fix

```bash
cd /Users/juju/dev_repos/alex/worker

# Edit orchestrator priority (as shown above)
vim lib/external-services/orchestrators/isbn-resolution.ts

# Deploy immediately
npm run deploy

# Verify deployment
npm run tail | grep "Provider chain"
# Expected: Should see google-books tried before isbndb
```

#### Step 3: Monitor Quota Recovery

```bash
# ISBNdb quota resets at midnight UTC
# Check current UTC time
date -u

# Calculate hours until midnight UTC
# Wait for reset, then re-enable ISBNdb as primary

# After midnight UTC, verify quota reset
curl -X GET 'https://alexandria.ooheynerds.com/api/quota/status'

# Expected response:
# { "used": 0, "limit": 13000, "remaining": 13000, "resetAt": "2026-01-15T00:00:00Z" }
```

#### Step 4: Prevent Future Exhaustion

**1. Add quota pre-check to backfill scheduler:**

```typescript
// worker/src/routes/backfill-scheduler.ts
export async function scheduleBackfill(
  c: Context<AppBindings>
): Promise<Response> {
  const sql = c.get('sql');
  const env = c.get('env');

  // Check ISBNdb quota BEFORE scheduling
  const quotaStatus = await checkISBNdbQuota(env.QUOTA_KV);
  if (quotaStatus.percentUsed > 80) {
    return c.json({
      success: false,
      error: 'ISBNdb quota >80%, skipping backfill to preserve quota',
      quota: quotaStatus
    }, 429);
  }

  // Proceed with backfill scheduling...
}
```

**2. Implement quota-aware batch sizing:**

```typescript
// worker/src/services/hybrid-backfill.ts
async function calculateSafeBatchSize(env: Env): Promise<number> {
  const quotaStatus = await checkISBNdbQuota(env.QUOTA_KV);
  const remainingQuota = quotaStatus.remaining;

  // Each backfill month uses ~40 ISBNdb calls
  const CALLS_PER_MONTH = 40;
  const SAFETY_BUFFER = 500;

  const maxMonths = Math.floor((remainingQuota - SAFETY_BUFFER) / CALLS_PER_MONTH);
  return Math.max(1, Math.min(maxMonths, 10));  // Cap at 10 months
}
```

**3. Add daily quota alerts:**

```typescript
// New cron trigger: Check quota at 6 AM UTC (halfway through day)
async function quotaHealthCheck(env: Env): Promise<void> {
  const status = await checkISBNdbQuota(env.QUOTA_KV);

  if (status.percentUsed > 80) {
    // Send alert (email, Slack, Discord, etc.)
    await sendAlert({
      severity: 'warning',
      title: 'ISBNdb Quota Warning',
      message: `Quota at ${status.percentUsed.toFixed(1)}% (${status.used}/${status.limit})`,
      action: 'Consider reducing backfill operations for remainder of day'
    });
  }

  if (status.percentUsed > 95) {
    // Critical alert
    await sendAlert({
      severity: 'critical',
      title: 'ISBNdb Quota Critical',
      message: `Quota exhausted: ${status.used}/${status.limit}`,
      action: 'All ISBNdb operations will fail until midnight UTC reset'
    });
  }
}
```

---

### Rate Limit Compliance

**Symptom**: Provider shows `rate_limit` errors in [Error Type Distribution](#error-type-distribution)

**Root Cause**: Requests sent faster than provider's documented rate limit

#### Provider Rate Limits (Official)

| Provider | Official Limit | Configured Delay | Status |
|----------|---------------|------------------|--------|
| ISBNdb | 3 req/sec | 1000ms (1/sec) | ✅ Conservative |
| OpenLibrary | 100 req/5min | 3000ms (1/3sec) | ✅ Compliant |
| Archive.org | 1 req/sec | 1000ms | ✅ Compliant |
| Wikidata | Unknown (polite) | 500ms (2/sec) | ⚠️ Untested |
| Wikipedia | 1 req/sec | 1000ms | ✅ Compliant |
| Google Books | Soft limit (undocumented) | None | ⚠️ Best effort |

#### Diagnostic Query

```graphql
query RateLimitErrors($provider: String!) {
  alexandriaPerformanceAdaptiveGroups(
    filter: {
      index: "provider_request"
      blob1: $provider
      blob5: "rate_limit"  # error_type
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    count
    dimensions {
      blob1  # provider
      blob2  # capability
      timestamp
    }
  }
}
```

**Example output:**

| Provider | Capability | Rate Limit Errors | Last Occurrence | Status |
|----------|-----------|------------------|----------------|--------|
| open-library | ISBN_RESOLUTION | 85 | 2026-01-13 18:45:23 | ❌ Frequent |
| wikidata | SUBJECT_ENRICHMENT | 12 | 2026-01-13 12:30:15 | ⚠️ Occasional |
| archive-org | PUBLIC_DOMAIN | 0 | N/A | ✅ None |

#### Fix for OpenLibrary (85 rate limit errors)

**Step 1: Verify current delay:**

```typescript
// worker/lib/external-services/providers/open-library-provider.ts
const RATE_LIMIT_DELAY = 3000;  // Current: 3 seconds

// OpenLibrary documented limit: 100 requests per 5 minutes
// = 300 seconds / 100 requests = 3 seconds per request (minimum)
```

**Step 2: Add safety buffer:**

```typescript
// Increase delay to 3.5 seconds (16% buffer)
const RATE_LIMIT_DELAY = 3500;

async makeRateLimitedRequest<T>(context: ServiceContext, fn: () => Promise<T>): Promise<T> {
  const kvKey = 'ratelimit:openlibrary:last_request';
  const now = Date.now();

  const lastRequestStr = await context.env.QUOTA_KV.get(kvKey);
  const lastRequest = lastRequestStr ? parseInt(lastRequestStr) : 0;

  const elapsed = now - lastRequest;
  if (elapsed < RATE_LIMIT_DELAY) {
    const waitTime = RATE_LIMIT_DELAY - elapsed;
    this.logger?.debug('Rate limit wait', { provider: 'open-library', waitTime });
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  await context.env.QUOTA_KV.put(kvKey, now.toString(), {
    expirationTtl: 60  // Expire after 1 minute (cleanup)
  });

  return fn();
}
```

**Step 3: Handle concurrent requests:**

**Problem**: Multiple Workers may read same `last_request` timestamp simultaneously, causing burst

**Solution**: Use Durable Objects for distributed rate limiting (future enhancement)

**Temporary workaround**: Add random jitter to reduce burst probability

```typescript
// Add 0-500ms random jitter to prevent synchronized bursts
const jitter = Math.floor(Math.random() * 500);
const effectiveDelay = RATE_LIMIT_DELAY + jitter;

if (elapsed < effectiveDelay) {
  await new Promise(resolve => setTimeout(resolve, effectiveDelay - elapsed));
}
```

#### Fix for Wikidata (12 rate limit errors)

**Wikidata has no official rate limit** but requests "polite" usage.

**Current delay: 500ms (2 req/sec)**

**Recommendation**: Increase to 1000ms (1 req/sec) to be more conservative

```typescript
// worker/lib/external-services/providers/wikidata-provider.ts
const RATE_LIMIT_DELAY = 1000;  // Increase from 500ms

// Wikidata is last-resort fallback, so slower is acceptable
```

---

### Invalid Response

**Symptom**: Provider shows `invalid_response` errors in [Error Type Distribution](#error-type-distribution)

**Root Cause**: API response schema changed, or provider returning unexpected format

#### Diagnostic Steps

**Step 1: Capture failing response:**

```typescript
// worker/lib/external-services/http-client.ts
// Add detailed logging for invalid responses

async request<T>(method: string, url: string, options: RequestOptions, context: ServiceContext): Promise<T> {
  try {
    const response = await fetch(url, {
      method,
      headers: options.headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(context.timeoutMs)
    });

    const rawBody = await response.text();

    // Log raw response for debugging
    this.logger?.debug('Raw API response', {
      provider: context.provider,
      url,
      status: response.status,
      bodyPreview: rawBody.substring(0, 500)  // First 500 chars
    });

    // Attempt to parse JSON
    const parsed = JSON.parse(rawBody);

    // Validate schema (if validation fails, log full response)
    if (!this.validateResponse(parsed, context)) {
      this.logger?.error('Schema validation failed', {
        provider: context.provider,
        url,
        fullResponse: rawBody  // Log full response for investigation
      });
      throw new Error('Invalid response schema');
    }

    return parsed as T;

  } catch (error) {
    this.logger?.error('Request failed', { url, error: error.message });
    throw error;
  }
}
```

**Step 2: Check Worker logs for full response:**

```bash
npx wrangler tail alexandria --format pretty | grep "Schema validation failed" -A 10

# Example output:
# {
#   "provider": "google-books",
#   "url": "https://www.googleapis.com/books/v1/volumes/...",
#   "fullResponse": "{\"error\":{\"code\":429,\"message\":\"Quota exceeded\"}}"
# }
```

**Step 3: Update provider schema validation:**

**Example: Google Books changed response format**

```typescript
// worker/lib/external-services/providers/google-books-provider.ts

// OLD schema (no longer matches API)
interface GoogleBooksVolume {
  volumeInfo: {
    title: string;
    authors?: string[];
    publishedDate?: string;
  };
}

// NEW schema (updated to match current API)
interface GoogleBooksVolume {
  volumeInfo: {
    title: string;
    authors?: string[];
    publishedDate?: string;
    // NEW FIELDS added by Google
    publisher?: string;
    industryIdentifiers?: Array<{ type: string; identifier: string }>;
  };
  // Handle error responses
  error?: {
    code: number;
    message: string;
  };
}

// Update validation logic
function validateGoogleBooksResponse(data: unknown): data is GoogleBooksVolume {
  if (!data || typeof data !== 'object') return false;

  // Handle error responses gracefully
  if ('error' in data) {
    this.logger?.warn('Google Books API error', { error: data.error });
    return false;
  }

  // Validate success response
  return 'volumeInfo' in data &&
         typeof data.volumeInfo === 'object' &&
         'title' in data.volumeInfo;
}
```

#### Common Invalid Response Scenarios

| Provider | Common Issue | Fix |
|----------|-------------|-----|
| Google Books | Quota exceeded returns error object | Handle `error` field in response |
| OpenLibrary | Empty `docs` array when no results | Check `docs.length > 0` before accessing |
| ISBNdb | `null` instead of empty array | Use `data?.books ?? []` |
| Wikidata | SPARQL timeout returns HTML error page | Check `Content-Type: application/sparql-results+json` |
| Archive.org | 404 returns HTML, not JSON | Check `response.ok` before parsing JSON |

**General validation pattern:**

```typescript
async fetchFromProvider<T>(url: string, context: ServiceContext): Promise<T | null> {
  const response = await fetch(url);

  // Check HTTP status
  if (!response.ok) {
    this.logger?.warn('HTTP error', { status: response.status, url });
    return null;  // Graceful degradation
  }

  // Check Content-Type
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    this.logger?.warn('Non-JSON response', { contentType, url });
    return null;
  }

  // Parse and validate
  try {
    const data = await response.json();
    return this.validateAndTransform(data, context);
  } catch (error) {
    this.logger?.error('JSON parse failed', { error, url });
    return null;
  }
}
```

---

### Wikidata Timeouts

**Special Case**: Wikidata SPARQL queries are inherently slow and timeouts are expected

**Healthy Metrics:**
- Success rate: 70-85% (15-30% timeouts acceptable)
- P95 latency: 3000-5000ms
- P99 latency: 8000-12000ms

**These are NOT errors** - Wikidata is a last-resort fallback for rare books

#### Optimization Strategies

**1. Simplify SPARQL queries:**

```sparql
-- BEFORE (complex, slow)
SELECT ?work ?workLabel ?authorLabel ?publicationDate ?publisherLabel ?genres
WHERE {
  ?work wdt:P212 "${isbn}" .
  ?work wdt:P50 ?author .
  OPTIONAL { ?work wdt:P577 ?publicationDate . }
  OPTIONAL { ?work wdt:P123 ?publisher . }
  OPTIONAL { ?work wdt:P136 ?genre . ?genre rdfs:label ?genres . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,de,es". }
}
LIMIT 1

-- AFTER (simplified, faster)
SELECT ?work ?workLabel ?publicationDate
WHERE {
  ?work wdt:P212 "${isbn}" .
  OPTIONAL { ?work wdt:P577 ?publicationDate . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 1
```

**2. Increase timeout for Wikidata specifically:**

```typescript
// worker/lib/external-services/orchestrators/metadata-enrichment.ts
const orchestrator = new MetadataOrchestrator(registry, {
  providerTimeoutMs: {
    'isbndb': 5000,
    'google-books': 5000,
    'wikidata': 15000  // Allow longer timeout for SPARQL
  }
});
```

**3. Reduce Wikidata usage via better caching:**

```typescript
// worker/lib/external-services/providers/wikidata-provider.ts
const CACHE_TTL = 2592000;  // 30 days (was 7 days)

// Wikidata data rarely changes, so aggressive caching is safe
```

---

### Check Upstream Status

**When providers are failing, check external service status pages**

| Provider | Status Page | Manual Test |
|----------|------------|-------------|
| **ISBNdb** | No public status page | `curl -H "Authorization: <KEY>" https://api.premium.isbndb.com/books/9780140328721` |
| **Google Books** | https://status.cloud.google.com | `curl "https://www.googleapis.com/books/v1/volumes?q=isbn:9780140328721"` |
| **OpenLibrary** | https://openlibrary.org/ (site load) | `curl "https://openlibrary.org/search.json?q=the+hobbit"` |
| **Archive.org** | https://status.archive.org/ | `curl "https://archive.org/metadata/isbn_9780140328721"` |
| **Wikidata** | https://www.wikidata.org/wiki/Special:Statistics | `curl "https://query.wikidata.org/sparql?query=SELECT%20%2A%20WHERE%20%7B%7D%20LIMIT%201"` |
| **Wikipedia** | https://www.wikimedia.org/ (site load) | `curl "https://en.wikipedia.org/api/rest_v1/page/summary/The_Hobbit"` |

**Automated upstream health check:**

```bash
#!/bin/bash
# scripts/check-upstream-health.sh

echo "Checking external provider health..."

# ISBNdb
echo -n "ISBNdb: "
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: $ISBNDB_API_KEY" \
  "https://api.premium.isbndb.com/books/9780140328721" | grep -q "200" && echo "✅ OK" || echo "❌ FAIL"

# Google Books
echo -n "Google Books: "
curl -s -o /dev/null -w "%{http_code}" \
  "https://www.googleapis.com/books/v1/volumes?q=isbn:9780140328721" | grep -q "200" && echo "✅ OK" || echo "❌ FAIL"

# OpenLibrary
echo -n "OpenLibrary: "
curl -s -o /dev/null -w "%{http_code}" \
  "https://openlibrary.org/search.json?q=hobbit&limit=1" | grep -q "200" && echo "✅ OK" || echo "❌ FAIL"

# Archive.org
echo -n "Archive.org: "
curl -s -o /dev/null -w "%{http_code}" \
  "https://archive.org/metadata/isbn_9780140328721" | grep -q "200" && echo "✅ OK" || echo "❌ FAIL"

# Wikidata
echo -n "Wikidata: "
curl -s -o /dev/null -w "%{http_code}" \
  "https://query.wikidata.org/sparql?query=SELECT%20%2A%20WHERE%20%7B%7D%20LIMIT%201" | grep -q "200" && echo "✅ OK" || echo "❌ FAIL"
```

**Run before investigating provider failures:**

```bash
cd /Users/juju/dev_repos/alex
./scripts/check-upstream-health.sh

# Example output:
# ISBNdb: ✅ OK
# Google Books: ✅ OK
# OpenLibrary: ❌ FAIL  ← Explains why fallbacks are triggering
# Archive.org: ✅ OK
# Wikidata: ✅ OK
```

---

## 📊 Multi-Repo Dashboard Design

**Vision**: Single dashboard showing health across Alexandria, bendv3, and future projects

### Recommended Architecture

**Option 1: Cloudflare Workers Analytics API + Custom HTML Dashboard**

**Pros:**
- Free tier (10M events/month)
- Already integrated (Alexandria uses Analytics Engine)
- GraphQL API for flexible queries
- Can aggregate across multiple Workers/datasets

**Cons:**
- Requires building custom UI
- No built-in alerting

**Implementation:**

```html
<!-- dashboard.html - hosted on Cloudflare Pages or Workers -->
<!DOCTYPE html>
<html>
<head>
  <title>Alexandria & bendv3 System Health</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <h1>Multi-Repo System Health Dashboard</h1>

  <!-- Quick Status Grid -->
  <div id="status-grid">
    <div class="repo-status" id="alexandria-status">
      <h2>Alexandria (Data Lake)</h2>
      <div class="metric">
        <span class="label">Provider Success:</span>
        <span class="value" id="alexandria-success-rate">Loading...</span>
      </div>
      <div class="metric">
        <span class="label">ISBNdb Quota:</span>
        <span class="value" id="alexandria-quota">Loading...</span>
      </div>
      <div class="metric">
        <span class="label">Cache Hit Rate:</span>
        <span class="value" id="alexandria-cache">Loading...</span>
      </div>
    </div>

    <div class="repo-status" id="bendv3-status">
      <h2>bendv3 (API Gateway)</h2>
      <div class="metric">
        <span class="label">API Success Rate:</span>
        <span class="value" id="bendv3-success-rate">Loading...</span>
      </div>
      <div class="metric">
        <span class="label">P95 Latency:</span>
        <span class="value" id="bendv3-latency">Loading...</span>
      </div>
      <div class="metric">
        <span class="label">Rate Limit Hits:</span>
        <span class="value" id="bendv3-rate-limits">Loading...</span>
      </div>
    </div>
  </div>

  <!-- Time Series Charts -->
  <canvas id="success-rate-chart"></canvas>
  <canvas id="latency-chart"></canvas>

  <script>
    // Fetch Alexandria metrics
    async function fetchAlexandriaMetrics() {
      const query = `
        query {
          viewer {
            accounts(filter: { accountTag: "${ACCOUNT_ID}" }) {
              alexandriaPerformanceAdaptiveGroups(
                limit: 1000
                filter: {
                  index: "provider_request"
                  datetime_geq: "${get24HoursAgo()}"
                }
              ) {
                count
                dimensions { blob4 }  # status
              }
            }
          }
        }
      `;

      const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      const { data } = await response.json();
      const groups = data.viewer.accounts[0].alexandriaPerformanceAdaptiveGroups;

      // Calculate success rate
      const total = groups.reduce((sum, g) => sum + g.count, 0);
      const successful = groups
        .filter(g => g.dimensions.blob4 === 'success')
        .reduce((sum, g) => sum + g.count, 0);
      const successRate = (successful / total * 100).toFixed(1);

      document.getElementById('alexandria-success-rate').textContent =
        `${successRate}% ${getStatusIcon(successRate, 95, 90)}`;
    }

    // Fetch bendv3 metrics (similar pattern)
    async function fetchBendv3Metrics() {
      // Query bendv3 Analytics Engine dataset
      // ...
    }

    function getStatusIcon(value, greenThreshold, yellowThreshold) {
      if (value >= greenThreshold) return '✅';
      if (value >= yellowThreshold) return '⚠️';
      return '❌';
    }

    // Refresh every 60 seconds
    setInterval(() => {
      fetchAlexandriaMetrics();
      fetchBendv3Metrics();
    }, 60000);

    // Initial load
    fetchAlexandriaMetrics();
    fetchBendv3Metrics();
  </script>
</body>
</html>
```

---

**Option 2: Grafana Cloud (Free Tier)**

**Pros:**
- Professional dashboards out of the box
- Built-in alerting (email, Slack, Discord)
- Mobile app for on-the-go monitoring
- 10K series, 14-day retention (free tier)

**Cons:**
- Requires Grafana Cloud account
- Data must be pushed to Grafana (not pulled from Cloudflare)

**Implementation:**

```typescript
// worker/src/middleware/grafana-exporter.ts
// Push Analytics Engine data to Grafana Cloud Prometheus

export async function exportToGrafana(env: Env): Promise<void> {
  // Query Analytics Engine for last hour
  const metrics = await queryAnalyticsEngine(env);

  // Convert to Prometheus format
  const prometheusMetrics = convertToPrometheus(metrics);

  // Push to Grafana Cloud
  await fetch('https://prometheus-prod-10-prod-us-central-0.grafana.net/api/prom/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GRAFANA_API_KEY}`,
      'Content-Type': 'application/x-protobuf'
    },
    body: prometheusMetrics
  });
}

// Run via Cron Trigger every 5 minutes
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    if (event.cron === '*/5 * * * *') {  // Every 5 minutes
      await exportToGrafana(env);
    }
  }
};
```

**Grafana Dashboard JSON** (importable):

```json
{
  "dashboard": {
    "title": "Alexandria & bendv3 System Health",
    "panels": [
      {
        "title": "Provider Success Rate (24h)",
        "targets": [
          {
            "expr": "avg_over_time(provider_success_rate{repo=\"alexandria\"}[24h])",
            "legendFormat": "{{provider}}"
          }
        ],
        "thresholds": [
          { "value": 90, "color": "red" },
          { "value": 95, "color": "yellow" },
          { "value": 100, "color": "green" }
        ]
      },
      {
        "title": "ISBNdb Quota Usage",
        "targets": [
          {
            "expr": "isbndb_quota_used / isbndb_quota_limit * 100"
          }
        ],
        "thresholds": [
          { "value": 80, "color": "yellow" },
          { "value": 95, "color": "red" }
        ]
      }
    ]
  }
}
```

---

### Data Schema for Aggregation

**Standardized event format across all repos:**

```typescript
// Shared interface (used by Alexandria, bendv3, future projects)
interface SystemHealthEvent {
  // Identification
  repo: 'alexandria' | 'bendv3' | 'other';
  subsystem: 'providers' | 'database' | 'queues' | 'api-gateway';

  // Status
  status: 'healthy' | 'warning' | 'critical';

  // Metrics (nullable - not all subsystems have all metrics)
  success_rate?: number;      // 0-100
  latency_p95?: number;        // milliseconds
  quota_usage?: number;        // 0-100 (percentage)
  cache_hit_rate?: number;     // 0-100
  error_rate?: number;         // 0-100

  // Metadata
  timestamp: number;           // Unix timestamp
  version: string;             // App version (for correlation)
}
```

**Analytics Engine schema (supports all repos):**

```toml
# wrangler.jsonc - analytics_engine_datasets
[[analytics_engine_datasets]]
binding = "SYSTEM_HEALTH"  # Shared across repos

# Indexes for efficient querying
# index1: repo
# index2: subsystem
# index3: status

# Metrics (doubles)
# double1: success_rate
# double2: latency_p95
# double3: quota_usage
# double4: cache_hit_rate
# double5: error_rate
```

**Aggregation query pattern (works across repos):**

```graphql
query MultiRepoHealth {
  # Alexandria providers
  alexandriaProviders: systemHealthAdaptiveGroups(
    filter: {
      index1: "alexandria"     # repo
      index2: "providers"      # subsystem
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    avg { double1 }  # success_rate
    dimensions { index3 }  # status
  }

  # bendv3 API gateway
  bendv3Api: systemHealthAdaptiveGroups(
    filter: {
      index1: "bendv3"
      index2: "api-gateway"
      datetime_geq: "2026-01-13T00:00:00Z"
    }
  ) {
    avg { double1 double2 }  # success_rate, latency_p95
    dimensions { index3 }
  }
}
```

---

## 🚨 Alert Configuration

**Recommended alerting strategy for solo developer:**

### Critical Alerts (Immediate Action Required)

**Delivery**: Email + SMS (via Twilio or similar) + Desktop notification

| Alert | Condition | Query | Action |
|-------|-----------|-------|--------|
| ISBNdb quota critical | >95% | `isbndb_quota_used / isbndb_quota_limit > 0.95` | [Stop enrichment](#isbndb-quota-exhaustion) |
| Provider complete failure | Success rate <50% for >30 min | `avg_over_time(provider_success_rate[30m]) < 0.5` | [Check upstream](#check-upstream-status) |
| System-wide failure | Overall success <80% | `avg_over_time(system_success_rate[10m]) < 0.8` | [Run health check](#-5-minute-system-health-check) |
| Database unreachable | 0 successful queries in 5 min | `sum_over_time(database_query_success[5m]) == 0` | Check tunnel, restart postgres |

### Warning Alerts (Investigate Soon)

**Delivery**: Email only (checked within 2-4 hours)

| Alert | Condition | Query | Action |
|-------|-----------|-------|--------|
| ISBNdb quota warning | >80% | `isbndb_quota_used / isbndb_quota_limit > 0.8` | Reduce batch sizes |
| High latency | P95 >1000ms for >30 min | `quantile_over_time(0.95, latency_ms[30m]) > 1000` | [Optimize slow provider](#high-latency-p95-1000ms) |
| Low cache hit rate | <50% for >1 hour | `avg_over_time(cache_hit_rate[1h]) < 0.5` | [Fix cache](#low-cache-hit-rate-60) |
| Excessive fallbacks | >40% for >1 hour | `fallback_rate > 0.4` | [Adjust priority](#excessive-fallbacks-40) |

### Info Alerts (Daily Digest)

**Delivery**: Email summary once per day (8 AM local time)

- Daily cost summary (ISBNdb, Gemini, x.ai)
- Provider success rate trends (7-day average)
- Cache hit rate trends
- Queue depth (enrichment, cover, backfill, author)

---

### Alert Implementation

**Option 1: Cloudflare Workers Cron + Email**

```typescript
// worker/src/scheduled/health-alerts.ts
export async function checkHealthAlerts(env: Env): Promise<void> {
  const alerts: Alert[] = [];

  // Check ISBNdb quota
  const quotaStatus = await checkISBNdbQuota(env.QUOTA_KV);
  if (quotaStatus.percentUsed > 95) {
    alerts.push({
      severity: 'critical',
      title: 'ISBNdb Quota Exhausted',
      message: `${quotaStatus.used}/${quotaStatus.limit} calls used (${quotaStatus.percentUsed.toFixed(1)}%)`,
      action: 'Stop all ISBNdb operations immediately',
      timestamp: Date.now()
    });
  } else if (quotaStatus.percentUsed > 80) {
    alerts.push({
      severity: 'warning',
      title: 'ISBNdb Quota Warning',
      message: `${quotaStatus.used}/${quotaStatus.limit} calls used (${quotaStatus.percentUsed.toFixed(1)}%)`,
      action: 'Reduce backfill batch sizes',
      timestamp: Date.now()
    });
  }

  // Check provider success rates
  const providerHealth = await queryProviderHealth(env);
  for (const [provider, successRate] of Object.entries(providerHealth)) {
    if (successRate < 80) {
      alerts.push({
        severity: 'critical',
        title: `${provider} Provider Failing`,
        message: `Success rate: ${successRate.toFixed(1)}%`,
        action: `Check upstream status: ${getStatusPageUrl(provider)}`,
        timestamp: Date.now()
      });
    }
  }

  // Send alerts if any
  if (alerts.length > 0) {
    await sendAlertEmail(alerts, env);
  }
}

async function sendAlertEmail(alerts: Alert[], env: Env): Promise<void> {
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');

  const emailBody = `
    <h1>Alexandria Health Alerts</h1>

    ${criticalAlerts.length > 0 ? `
      <h2 style="color: red;">CRITICAL (${criticalAlerts.length})</h2>
      ${criticalAlerts.map(a => `
        <div style="border: 2px solid red; padding: 10px; margin: 10px 0;">
          <h3>${a.title}</h3>
          <p><strong>Issue:</strong> ${a.message}</p>
          <p><strong>Action Required:</strong> ${a.action}</p>
          <p><em>${new Date(a.timestamp).toISOString()}</em></p>
        </div>
      `).join('')}
    ` : ''}

    ${warningAlerts.length > 0 ? `
      <h2 style="color: orange;">WARNINGS (${warningAlerts.length})</h2>
      ${warningAlerts.map(a => `
        <div style="border: 1px solid orange; padding: 10px; margin: 10px 0;">
          <h3>${a.title}</h3>
          <p>${a.message}</p>
          <p><em>Action: ${a.action}</em></p>
        </div>
      `).join('')}
    ` : ''}

    <hr>
    <p><a href="https://alexandria.ooheynerds.com/api/stats">View Full Status</a></p>
  `;

  // Send via Cloudflare Email Workers or external service
  await fetch('https://api.mailgun.net/v3/yourdomain.com/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      from: 'Alexandria Alerts <alerts@alexandria.ooheynerds.com>',
      to: 'you@example.com',
      subject: `[Alexandria] ${criticalAlerts.length} Critical, ${warningAlerts.length} Warning`,
      html: emailBody
    })
  });
}

// Schedule in wrangler.jsonc
// triggers = [
//   { cron = "*/10 * * * *" }  // Every 10 minutes
// ]
```

---

**Option 2: Grafana Alerting Rules**

```yaml
# grafana-alerts.yaml (imported into Grafana Cloud)
apiVersion: 1
groups:
  - name: alexandria-critical
    interval: 5m
    rules:
      - alert: ISBNdbQuotaCritical
        expr: isbndb_quota_usage > 95
        for: 0m  # Immediate
        labels:
          severity: critical
          repo: alexandria
        annotations:
          summary: "ISBNdb quota exhausted ({{ $value }}%)"
          description: "Stop all ISBNdb operations immediately"
          action_url: "https://alexandria.ooheynerds.com/api/quota/status"

      - alert: ProviderFailure
        expr: provider_success_rate < 80
        for: 30m
        labels:
          severity: critical
        annotations:
          summary: "Provider {{ $labels.provider }} failing ({{ $value }}%)"
          description: "Check upstream status and consider removing from chain"

  - name: alexandria-warnings
    interval: 15m
    rules:
      - alert: HighLatency
        expr: latency_p95 > 1000
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "High P95 latency ({{ $value }}ms)"
          description: "Investigate slow providers and cache efficiency"

      - alert: LowCacheHitRate
        expr: cache_hit_rate < 50
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Low cache hit rate ({{ $value }}%)"
          description: "Check KV namespace health and cache TTLs"
```

---

## 💰 Cost Management

### Current Costs (January 2026)

**Fixed Costs:**
- **ISBNdb Premium**: $29.95/month (flat rate, 13K calls/day)
- **Cloudflare Workers Paid**: $5/month (base) + CPU time overages
- **Total Fixed**: ~$35/month

**Variable Costs (negligible):**
- **Gemini API**: ~$0.10-0.15/month (backfill usage, ~5000 req/month)
- **x.ai Grok**: ~$0.05-0.08/month (backfill usage, ~3000 req/month)
- **Cloudflare Analytics Engine**: $0 (free tier, <10M events/month)
- **Cloudflare R2**: ~$0.50/month (storage for 100K covers)
- **Total Variable**: <$1/month

**Grand Total**: ~$36/month

---

### Cost Per Operation

| Operation | Primary Provider | Cost | Fallback | Fallback Cost | Savings |
|-----------|-----------------|------|----------|--------------|---------|
| ISBN Resolution | ISBNdb | $0.0023 | Google Books | $0 | $0.0023 |
| Metadata Enrichment | ISBNdb | $0.0023 | OpenLibrary | $0 | $0.0023 |
| Cover Fetch | Google Books | $0 | ISBNdb | $0.0023 | $0 (save on ISBNdb) |
| Ratings | ISBNdb | $0.0023 | OpenLibrary | $0 | $0.0023 |
| Public Domain Check | Google Books | $0 | Archive.org | $0 | $0 |
| AI Book Generation | Gemini | $0.00002 | x.ai Grok | $0.00001 | -$0.00001 (Grok cheaper) |

**Key Insight**: Every ISBNdb call saved via fallback = $0.0023 savings

**Daily ISBNdb quota value**: 13,000 calls × $0.0023 = **$29.90/day** (entire monthly subscription)

**ROI of free provider fallbacks**:
- If 30% of requests succeed via free providers (Google Books, OpenLibrary, Archive.org)
- Daily savings: 13,000 × 0.30 × $0.0023 = **$8.97/day**
- Monthly savings: **$269/month** in avoided ISBNdb overage fees

---

### Cost Tracking Queries

#### Daily Cost by Provider

```graphql
query DailyCostBreakdown {
  alexandriaPerformanceAdaptiveGroups(
    filter: {
      index: "provider_cost"
      datetime_geq: "2026-01-13T00:00:00Z"
      datetime_lt: "2026-01-14T00:00:00Z"
    }
  ) {
    sum {
      double1  # api_calls_count
      double2  # estimated_cost_usd
    }
    dimensions {
      blob1  # provider
    }
  }
}
```

**JavaScript cost calculator:**

```javascript
async function calculateDailyCost() {
  const results = await queryAnalyticsEngine(DailyCostBreakdown);

  const costs = results.map(group => ({
    provider: group.dimensions.blob1,
    calls: group.sum.double1,
    estimatedCost: group.sum.double2
  }));

  const totalCost = costs.reduce((sum, c) => sum + c.estimatedCost, 0);
  const monthlyProjection = totalCost * 30;

  console.log('Daily Cost Breakdown:');
  console.table(costs);
  console.log(`\nTotal Daily Cost: $${totalCost.toFixed(4)}`);
  console.log(`Monthly Projection: $${monthlyProjection.toFixed(2)}`);

  return { costs, totalCost, monthlyProjection };
}
```

#### Monthly Trend

```graphql
query MonthlyCostTrend {
  alexandriaPerformanceAdaptiveGroups(
    filter: {
      index: "provider_cost"
      datetime_geq: "2025-12-14T00:00:00Z"  # Last 30 days
    }
  ) {
    sum {
      double1  # api_calls_count
      double2  # estimated_cost_usd
    }
    dimensions {
      blob1  # provider
      date: timestamp  # Group by day
    }
  }
}
```

**Chart data for cost trends:**

```javascript
async function generateCostTrendChart() {
  const results = await queryAnalyticsEngine(MonthlyCostTrend);

  // Group by date
  const dailyCosts = results.reduce((acc, group) => {
    const date = group.dimensions.date.split('T')[0];  // Extract YYYY-MM-DD
    if (!acc[date]) acc[date] = 0;
    acc[date] += group.sum.double2;  // estimated_cost_usd
    return acc;
  }, {});

  // Generate Chart.js data
  return {
    labels: Object.keys(dailyCosts).sort(),
    datasets: [{
      label: 'Daily Cost (USD)',
      data: Object.values(dailyCosts),
      borderColor: 'rgb(75, 192, 192)',
      tension: 0.1
    }]
  };
}
```

---

### Cost Optimization Strategies

#### 1. Maximize Free Provider Usage

**Goal**: Offload as many requests as possible to free providers

**Current free-first priority (cover fetching):**
```typescript
const providerPriority = [
  'google-books',   // Free, fast
  'open-library',   // Free, slower
  'archive-org',    // Free, good for old books
  'wikidata',       // Free, comprehensive
  'isbndb'          // Paid, last resort
];
```

**Recommendation**: Apply same pattern to metadata enrichment

```typescript
// worker/lib/external-services/orchestrators/metadata-enrichment.ts
const orchestrator = new MetadataOrchestrator(registry, {
  providerPriority: [
    'google-books',   // Try free first
    'open-library',
    'wikidata',
    'isbndb'          // Use ISBNdb only if free providers fail
  ]
});
```

**Expected savings**: 40-60% reduction in ISBNdb calls (if free providers cover 40-60% of requests)

---

#### 2. Aggressive Caching for Paid Providers

**ISBNdb responses rarely change** - increase cache TTL

```typescript
// worker/lib/external-services/providers/isbndb-provider.ts
const CACHE_TTL = 2592000;  // 30 days (currently 7 days)

// Book metadata is stable - aggressive caching reduces API calls
```

**Expected savings**: 20-30% reduction in ISBNdb calls via improved cache hit rate

---

#### 3. Batch API Calls

**ISBNdb charges per request, not per result** - use batch endpoints

```typescript
// Current: 100 separate API calls for 100 ISBNs = 100 quota consumed
for (const isbn of isbns) {
  await isbndbProvider.getMetadata(isbn, context);
}

// Optimized: 1 batch API call for 100 ISBNs = 1 quota consumed
const results = await isbndbProvider.batchGetMetadata(isbns, context);

// Savings: 99 API calls saved
```

**Implementation:**

```typescript
// worker/lib/external-services/providers/isbndb-provider.ts
async batchGetMetadata(isbns: string[], context: ServiceContext): Promise<MetadataResult[]> {
  // ISBNdb supports up to 1000 ISBNs per POST /books
  const chunks = chunk(isbns, 1000);
  const results: MetadataResult[] = [];

  for (const chunkIsbns of chunks) {
    const response = await this.httpClient.post<ISBNdbBatchResponse>(
      'https://api.premium.isbndb.com/books',
      { isbns: chunkIsbns },
      context
    );

    results.push(...response.books.map(this.transformToMetadata));
  }

  return results;
}
```

**Usage in queue handlers:**

```typescript
// worker/src/services/queue-handlers.ts
export async function processEnrichmentQueue(
  batch: MessageBatch<EnrichmentMessage>,
  env: Env
): Promise<void> {
  const isbns = batch.messages.map(m => m.body.isbn);

  // Single batch API call instead of N individual calls
  const results = await isbndbProvider.batchGetMetadata(isbns, context);

  // Update database with results
  await updateDatabase(results, env);
}
```

**Expected savings**: 80-90% reduction in ISBNdb API calls for queue-based enrichment

---

#### 4. Quota-Aware Scheduling

**Stop enrichment operations when quota >80%**

```typescript
// worker/src/routes/backfill-scheduler.ts
export async function scheduleBackfill(c: Context<AppBindings>): Promise<Response> {
  const quotaStatus = await checkISBNdbQuota(c.get('env').QUOTA_KV);

  // Calculate safe batch size based on remaining quota
  const safeBatchSize = calculateSafeBatchSize(quotaStatus);

  if (safeBatchSize === 0) {
    return c.json({
      success: false,
      message: 'ISBNdb quota >80%, skipping backfill to preserve quota',
      quota: quotaStatus
    }, 429);
  }

  // Schedule only what quota allows
  await scheduleMonths(safeBatchSize, c.get('env'));

  return c.json({ success: true, scheduled: safeBatchSize });
}

function calculateSafeBatchSize(quota: QuotaStatus): number {
  const remainingQuota = quota.limit - quota.used;
  const safetyBuffer = 500;  // Reserve 500 calls

  if (remainingQuota < safetyBuffer) return 0;

  const CALLS_PER_MONTH = 40;  // Average ISBNdb calls per backfill month
  return Math.floor((remainingQuota - safetyBuffer) / CALLS_PER_MONTH);
}
```

---

### Cost Alerts

**Alert when projected monthly cost exceeds budget:**

```typescript
async function checkCostAlerts(env: Env): Promise<void> {
  // Query last 7 days of costs
  const last7DaysCost = await queryLast7DaysCost(env);

  // Project to 30 days
  const monthlyProjection = (last7DaysCost / 7) * 30;

  const MONTHLY_BUDGET = 40;  // $40/month budget

  if (monthlyProjection > MONTHLY_BUDGET * 1.2) {
    await sendAlert({
      severity: 'warning',
      title: 'Cost Projection Exceeds Budget',
      message: `Projected monthly cost: $${monthlyProjection.toFixed(2)} (budget: $${MONTHLY_BUDGET})`,
      action: 'Review API usage and optimize caching'
    });
  }
}
```

---

## 📈 Weekly/Monthly Reporting

### Weekly Summary Email

**Sent every Monday at 8 AM local time:**

```typescript
// worker/src/scheduled/weekly-report.ts
export async function generateWeeklyReport(env: Env): Promise<void> {
  const startDate = getLastMonday();
  const endDate = getThisSunday();

  // Query metrics for past week
  const providerHealth = await queryProviderHealth(env, startDate, endDate);
  const costs = await queryCosts(env, startDate, endDate);
  const fallbackStats = await queryFallbackStats(env, startDate, endDate);
  const cacheStats = await queryCacheStats(env, startDate, endDate);

  const emailBody = `
    <h1>Alexandria Weekly Report</h1>
    <p><em>${startDate} to ${endDate}</em></p>

    <h2>System Health Summary</h2>
    <table>
      <tr>
        <th>Metric</th>
        <th>Value</th>
        <th>Status</th>
        <th>Change from Last Week</th>
      </tr>
      <tr>
        <td>Overall Success Rate</td>
        <td>${providerHealth.overallSuccessRate.toFixed(1)}%</td>
        <td>${getStatusIcon(providerHealth.overallSuccessRate, 95, 90)}</td>
        <td>${formatChange(providerHealth.overallSuccessRateChange)}</td>
      </tr>
      <tr>
        <td>Average Latency (P95)</td>
        <td>${providerHealth.avgLatencyP95}ms</td>
        <td>${getLatencyStatus(providerHealth.avgLatencyP95)}</td>
        <td>${formatChange(providerHealth.latencyChange)}</td>
      </tr>
      <tr>
        <td>Cache Hit Rate</td>
        <td>${cacheStats.overallHitRate.toFixed(1)}%</td>
        <td>${getStatusIcon(cacheStats.overallHitRate, 60, 40)}</td>
        <td>${formatChange(cacheStats.hitRateChange)}</td>
      </tr>
    </table>

    <h2>Provider Performance</h2>
    <table>
      <tr>
        <th>Provider</th>
        <th>Requests</th>
        <th>Success Rate</th>
        <th>P95 Latency</th>
        <th>Status</th>
      </tr>
      ${Object.entries(providerHealth.providers).map(([provider, stats]) => `
        <tr>
          <td>${provider}</td>
          <td>${stats.requests.toLocaleString()}</td>
          <td>${stats.successRate.toFixed(1)}%</td>
          <td>${stats.latencyP95}ms</td>
          <td>${getStatusIcon(stats.successRate, 90, 80)}</td>
        </tr>
      `).join('')}
    </table>

    <h2>Cost Summary</h2>
    <table>
      <tr>
        <th>Provider</th>
        <th>API Calls</th>
        <th>Cost (Week)</th>
        <th>Projected Monthly</th>
      </tr>
      ${costs.map(c => `
        <tr>
          <td>${c.provider}</td>
          <td>${c.calls.toLocaleString()}</td>
          <td>$${c.weeklyCost.toFixed(4)}</td>
          <td>$${c.monthlyProjection.toFixed(2)}</td>
        </tr>
      `).join('')}
      <tr style="font-weight: bold;">
        <td>TOTAL</td>
        <td>${costs.reduce((sum, c) => sum + c.calls, 0).toLocaleString()}</td>
        <td>$${costs.reduce((sum, c) => sum + c.weeklyCost, 0).toFixed(4)}</td>
        <td>$${costs.reduce((sum, c) => sum + c.monthlyProjection, 0).toFixed(2)}</td>
      </tr>
    </table>

    <h2>Fallback Chain Analysis</h2>
    <ul>
      <li>Fallback rate: ${fallbackStats.overallFallbackRate.toFixed(1)}% (target: <20%)</li>
      <li>Most common fallback: ${fallbackStats.mostCommonFallback.provider} (${fallbackStats.mostCommonFallback.count} times)</li>
      <li>Average fallback depth: ${fallbackStats.avgFallbackDepth.toFixed(2)} providers</li>
    </ul>

    <h2>Action Items</h2>
    ${generateActionItems(providerHealth, costs, fallbackStats, cacheStats)}

    <hr>
    <p><a href="https://alexandria.ooheynerds.com/api/stats">View Live Dashboard</a></p>
  `;

  await sendEmail({
    to: 'you@example.com',
    subject: `Alexandria Weekly Report - ${startDate}`,
    html: emailBody
  });
}

function generateActionItems(
  health: ProviderHealth,
  costs: Cost[],
  fallbacks: FallbackStats,
  cache: CacheStats
): string {
  const items: string[] = [];

  // Check for failing providers
  for (const [provider, stats] of Object.entries(health.providers)) {
    if (stats.successRate < 85) {
      items.push(`⚠️ <strong>${provider}</strong> success rate is low (${stats.successRate.toFixed(1)}%). Consider removing from provider chain or investigating upstream issues.`);
    }
  }

  // Check for cost overruns
  const totalMonthly = costs.reduce((sum, c) => sum + c.monthlyProjection, 0);
  if (totalMonthly > 40) {
    items.push(`💰 Projected monthly cost ($${totalMonthly.toFixed(2)}) exceeds budget ($40). Review ISBNdb usage and increase free provider utilization.`);
  }

  // Check cache efficiency
  if (cache.overallHitRate < 50) {
    items.push(`🔧 Cache hit rate is low (${cache.overallHitRate.toFixed(1)}%). Investigate KV health, increase TTLs, or fix cache key collisions.`);
  }

  // Check fallback rates
  if (fallbacks.overallFallbackRate > 30) {
    items.push(`🔄 High fallback rate (${fallbacks.overallFallbackRate.toFixed(1)}%). Primary provider (${fallbacks.primaryProvider}) may be unreliable. Consider reordering provider priority.`);
  }

  if (items.length === 0) {
    return '<p>✅ All systems healthy! No action items this week.</p>';
  }

  return '<ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>';
}
```

---

## 🔗 Quick Reference Links

### Internal Documentation
- [API Endpoints](../api/API-SEARCH-ENDPOINTS.md)
- [Service Provider Guide](../development/SERVICE_PROVIDER_GUIDE.md)
- [Rate Limits](./RATE-LIMITS.md)
- [Current Status](../CURRENT-STATUS.md)

### Code Files
- **Provider Registry**: `../../worker/lib/external-services/provider-registry.ts`
- **HTTP Client**: `../../worker/lib/external-services/http-client.ts`
- **Orchestrators**: `../../worker/lib/external-services/orchestrators/`
- **Providers**: `../../worker/lib/external-services/providers/`
- **Queue Handlers**: `../../worker/src/services/queue-handlers.ts`
- **Analytics Tracking**: `../../worker/src/middleware/analytics.ts`

### External Status Pages
- **ISBNdb**: No public status page (test manually: `curl -H "Authorization: <KEY>" https://api.premium.isbndb.com/books/9780140328721`)
- **Google Books**: https://status.cloud.google.com
- **OpenLibrary**: https://openlibrary.org/ (check if site loads)
- **Archive.org**: https://status.archive.org/
- **Wikidata**: https://www.wikidata.org/wiki/Special:Statistics
- **Wikipedia**: https://www.wikimedia.org/

### Cloudflare Dashboard
- **Analytics Engine**: https://dash.cloudflare.com → Analytics & Logs → Analytics Engine
- **GraphQL Playground**: https://dash.cloudflare.com → Analytics & Logs → Analytics Engine → GraphQL
- **KV Namespaces**: https://dash.cloudflare.com → Workers & Pages → KV
- **Workers Logs**: https://dash.cloudflare.com → Workers & Pages → alexandria → Logs
- **R2 Buckets**: https://dash.cloudflare.com → R2 → bookstrack-covers-processed

### Deployment
```bash
# Deploy Worker
cd worker
npm run deploy

# Tail logs
npm run tail

# Check quota
curl https://alexandria.ooheynerds.com/api/quota/status

# Health check
curl https://alexandria.ooheynerds.com/health
```

---

## 📝 Changelog

### 2026-01-14
- ✅ Initial documentation created
- ✅ 5-minute health check query defined
- ✅ All dashboard queries documented with thresholds
- ✅ Comprehensive troubleshooting decision trees
- ✅ Multi-repo dashboard design with HTML + Grafana examples
- ✅ Alert configuration with critical/warning/info tiers
- ✅ Cost management queries and optimization strategies
- ✅ Weekly reporting template with action item generation

### Future Enhancements
- [ ] Implement Grafana dashboard (import JSON)
- [ ] Set up daily digest email automation
- [ ] Add mobile-friendly HTML dashboard
- [ ] Configure SMS alerts for critical issues
- [ ] Create cost projection ML model
- [ ] Add comparative benchmarking (week-over-week trends)

---

**Questions or Issues?**
- Check [CURRENT-STATUS.md](../CURRENT-STATUS.md) for active issues
- Review [Service Provider Guide](../development/SERVICE_PROVIDER_GUIDE.md) for implementation details
- Open GitHub issue for bugs or feature requests
