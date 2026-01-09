# Donation Tracking for Open APIs

**Last Updated**: 2026-01-09
**Purpose**: Track usage of free/open APIs and calculate recommended donations

## Overview

Alexandria uses three free/open APIs that accept donations to support their operations:
- **Archive.org** (Internet Archive) - Pre-2000 book covers and metadata
- **Wikipedia** (Wikimedia Foundation) - Author biographies and book summaries
- **Wikidata** (Wikimedia Foundation) - Structured book/author metadata via SPARQL

These services provide immense value to Alexandria. This document outlines how we track usage and recommend donations based on actual API consumption.

---

## Donation Philosophy

**Principle**: Pay what we can afford based on value received.

**Guidelines**:
- Track actual API usage monthly
- Calculate cost-per-request based on infrastructure costs
- Recommend donations proportional to usage
- Prioritize sustainability of upstream services
- Be transparent about our usage

**Target**: $0.001 per API request (1/10th of typical API costs)

---

## Usage Tracking

### Analytics Engine Integration

All Open API calls are tracked via Cloudflare Analytics Engine.

**Implementation**: `worker/lib/open-api-utils.ts`

```typescript
export async function trackOpenApiUsage(
  env: Env,
  provider: 'archive.org' | 'wikipedia' | 'wikidata',
  endpoint: string,
  success: boolean,
  latency_ms: number,
  cache_hit: boolean,
  logger?: Logger
): Promise<void> {
  try {
    await env.ANALYTICS.writeDataPoint({
      blobs: [provider, endpoint, success ? 'success' : 'error'],
      doubles: [latency_ms],
      indexes: [cache_hit ? 'cache_hit' : 'cache_miss'],
    });
  } catch (error) {
    logger?.warn('Failed to track Open API usage', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

**Usage Example**:
```typescript
const start = Date.now();
const cached = await env.CACHE.get(cacheKey);

if (cached) {
  await trackOpenApiUsage(
    env,
    'wikidata',
    'sparql',
    true,
    Date.now() - start,
    true,
    logger
  );
  return JSON.parse(cached);
}

const response = await fetch(SPARQL_ENDPOINT, ...);
await trackOpenApiUsage(
  env,
  'wikidata',
  'sparql',
  response.ok,
  Date.now() - start,
  false,
  logger
);
```

---

## Monthly Reporting

### Query Analytics Data

**GraphQL API**: https://api.cloudflare.com/client/v4/graphql

**Query Template**:
```graphql
query GetOpenApiUsage($accountTag: string, $start: string, $end: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      analyticsEngineDataset(filter: {
        datetime_geq: $start,
        datetime_lt: $end,
        blobs: ["archive.org", "wikipedia", "wikidata"]
      }) {
        blob1  # provider
        count
        sum {
          double1  # latency_ms
        }
      }
    }
  }
}
```

**Variables**:
```json
{
  "accountTag": "your-account-id",
  "start": "2026-01-01T00:00:00Z",
  "end": "2026-02-01T00:00:00Z"
}
```

**Result Format**:
```json
{
  "data": {
    "viewer": {
      "accounts": [{
        "analyticsEngineDataset": [
          {
            "blob1": "archive.org",
            "count": 15423,
            "sum": { "double1": 234567.89 }
          },
          {
            "blob1": "wikipedia",
            "count": 8921,
            "sum": { "double1": 145234.12 }
          },
          {
            "blob1": "wikidata",
            "count": 12045,
            "sum": { "double1": 189876.34 }
          }
        ]
      }]
    }
  }
}
```

### Bash Script for Monthly Reports

**Location**: `scripts/open-api-usage-report.sh`

```bash
#!/bin/bash
# Generate monthly Open API usage report

ACCOUNT_ID="your-cloudflare-account-id"
API_TOKEN="your-api-token"
MONTH="${1:-$(date -u +%Y-%m)}"  # Default to current month

# Calculate date range
START_DATE="${MONTH}-01T00:00:00Z"
END_DATE="$(date -u -d "${START_DATE} +1 month" +%Y-%m-%dT%H:%M:%SZ)"

echo "=== Open API Usage Report ==="
echo "Month: ${MONTH}"
echo "Date Range: ${START_DATE} to ${END_DATE}"
echo ""

# Query Analytics Engine via GraphQL
RESPONSE=$(curl -s -X POST https://api.cloudflare.com/client/v4/graphql \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "query": "query GetOpenApiUsage(\$accountTag: String!, \$start: String!, \$end: String!) { viewer { accounts(filter: { accountTag: \$accountTag }) { analyticsEngineDataset(filter: { datetime_geq: \$start, datetime_lt: \$end, blobs: [\"archive.org\", \"wikipedia\", \"wikidata\"] }) { blob1 count sum { double1 } } } } }",
  "variables": {
    "accountTag": "${ACCOUNT_ID}",
    "start": "${START_DATE}",
    "end": "${END_DATE}"
  }
}
EOF
)

# Parse response and calculate donations
echo "${RESPONSE}" | jq -r '
  .data.viewer.accounts[0].analyticsEngineDataset[] |
  "\(.blob1):\n  Requests: \(.count)\n  Avg Latency: \((.sum.double1 / .count) | round)ms\n  Donation: $\((.count * 0.001) | round / 100)"
'

# Total
TOTAL=$(echo "${RESPONSE}" | jq '
  [.data.viewer.accounts[0].analyticsEngineDataset[].count] | add
')
DONATION=$(echo "${TOTAL} * 0.001" | bc)

echo ""
echo "Total Requests: ${TOTAL}"
echo "Recommended Total Donation: \$${DONATION}"
echo ""
echo "Donation Links:"
echo "- Archive.org: https://archive.org/donate"
echo "- Wikimedia (Wikipedia + Wikidata): https://donate.wikimedia.org"
```

**Usage**:
```bash
# Current month
./scripts/open-api-usage-report.sh

# Specific month
./scripts/open-api-usage-report.sh 2026-01

# Output:
# === Open API Usage Report ===
# Month: 2026-01
# Date Range: 2026-01-01T00:00:00Z to 2026-02-01T00:00:00Z
#
# archive.org:
#   Requests: 15423
#   Avg Latency: 152ms
#   Donation: $15.42
#
# wikipedia:
#   Requests: 8921
#   Avg Latency: 163ms
#   Donation: $8.92
#
# wikidata:
#   Requests: 12045
#   Avg Latency: 158ms
#   Donation: $12.05
#
# Total Requests: 36389
# Recommended Total Donation: $36.39
#
# Donation Links:
# - Archive.org: https://archive.org/donate
# - Wikimedia (Wikipedia + Wikidata): https://donate.wikimedia.org
```

---

## Donation Calculation

### Cost Model

**Base Rate**: $0.001 per API request (1/10th of typical commercial API pricing)

**Rationale**:
- Commercial APIs (ISBNdb): ~$0.01 per request ($29.95/mo ÷ ~3000 requests)
- Google Books: Free tier (1,000/day), but limited
- We pay 10% of commercial rate to support open infrastructure

**Formula**:
```
Monthly Donation = (Total Requests) × $0.001
```

**Per-Provider Breakdown**:
```
Archive.org Donation   = (Archive.org Requests) × $0.001
Wikimedia Donation     = (Wikipedia Requests + Wikidata Requests) × $0.001
```

### Usage Tiers

| Tier | Monthly Requests | Recommended Donation | Notes |
|------|------------------|---------------------|-------|
| **Free** | 0 - 1,000 | $0 - $1 | Personal/testing use |
| **Light** | 1,000 - 10,000 | $1 - $10 | Small projects |
| **Medium** | 10,000 - 100,000 | $10 - $100 | Active development |
| **Heavy** | 100,000 - 1M | $100 - $1,000 | Production use |
| **Enterprise** | 1M+ | $1,000+ | High-volume production |

**Current Projection** (based on Phase 1-4 testing):
- Archive.org: ~5,000 requests/month → $5/month
- Wikipedia: ~3,000 requests/month → $3/month
- Wikidata: ~8,000 requests/month → $8/month
- **Total**: ~$16/month

---

## Donation Process

### Monthly Schedule

**Timeline**:
1. **1st of month**: Generate usage report for previous month
2. **5th of month**: Review report and approve donation amounts
3. **10th of month**: Make donations via online forms
4. **15th of month**: Update donation log

### Making Donations

#### Archive.org (Internet Archive)

**Link**: https://archive.org/donate

**Process**:
1. Visit donation page
2. Select "One-time donation"
3. Enter calculated amount
4. Payment method: Credit card or PayPal
5. Optional: Add message "From Alexandria project - API usage support"

**Tax Receipt**: Archive.org is 501(c)(3) - donations are tax-deductible in US

#### Wikimedia Foundation (Wikipedia + Wikidata)

**Link**: https://donate.wikimedia.org

**Process**:
1. Visit donation page
2. Select "Other amount" and enter total (Wikipedia + Wikidata combined)
3. Payment method: Credit card, PayPal, or bank transfer
4. Optional: Add message "From Alexandria project - API usage (Wikipedia + Wikidata)"

**Tax Receipt**: Wikimedia is 501(c)(3) - donations are tax-deductible in US

### Donation Log

**Location**: `docs/operations/DONATION-LOG.md` (create if not exists)

**Format**:
```markdown
# Donation Log

## 2026-01 (January)

**Date**: 2026-02-10

### Usage Summary
- Archive.org: 15,423 requests
- Wikipedia: 8,921 requests
- Wikidata: 12,045 requests
- Total: 36,389 requests

### Donations Made
- Archive.org: $15.42 (receipt: IA-2026-02-10-001)
- Wikimedia: $20.97 (receipt: WMF-2026-02-10-002)
- **Total**: $36.39

### Notes
- Peak usage: Cover fetching (Archive.org)
- Wikidata SPARQL queries for author bibliographies
- Wikipedia biographical summaries for enrichment
```

---

## Monitoring & Alerts

### Dashboard Queries

**Monthly Usage Check**:
```bash
# Quick check (current month)
npx wrangler tail alexandria --format pretty | grep "Open API" | wc -l

# Detailed breakdown (requires Analytics Engine query)
./scripts/open-api-usage-report.sh
```

### Alert Thresholds

**Set up alerts for**:
- Daily requests > 5,000 (potential abuse or runaway process)
- Monthly requests > 100,000 (budget concern)
- Error rate > 10% (service degradation)
- Average latency > 5,000ms (performance issue)

**Implementation** (Cloudflare Workers Analytics):
```typescript
// In scheduled worker or cron job
async function checkUsageThresholds(env: Env) {
  const today = new Date().toISOString().split('T')[0];
  const usage = await queryAnalyticsEngine(env, today);

  if (usage.total_requests > 5000) {
    await sendAlert(env, `High API usage today: ${usage.total_requests} requests`);
  }

  if (usage.error_rate > 0.1) {
    await sendAlert(env, `High error rate: ${(usage.error_rate * 100).toFixed(1)}%`);
  }
}
```

---

## Best Practices

### 1. Aggressive Caching

**Goal**: Minimize API calls via long cache TTLs

**Current Configuration**:
- Wikidata metadata: 30 days
- Wikipedia biographies: 30 days
- Archive.org covers: 7 days (longer for covers)

**Impact**: 90%+ cache hit rate reduces API usage by 10x

### 2. Batch Operations

**Where possible**: Group requests to reduce overhead

**Example**: Wikidata SPARQL with VALUES clause
```sparql
SELECT ?book ?title WHERE {
  VALUES ?isbn { "9780747532743" "9780545010221" "9780061120084" }
  ?book wdt:P212 ?isbn .
  ?book wdt:P1476 ?title .
}
```

### 3. Graceful Degradation

**Never fail requests due to API limits**

**Pattern**:
```typescript
try {
  const data = await fetchFromOpenApi(...);
  return data;
} catch (error) {
  logger.warn('Open API unavailable, using fallback', { error });
  return fallbackData;
}
```

### 4. Rate Limiting

**Respect service limits** even when not enforced

**Current Limits**:
- Archive.org: 1 req/sec (policy: "be reasonable")
- Wikipedia: 1 req/sec (policy: max 200 req/sec, we use 1)
- Wikidata: 2 req/sec (policy: max 60 req/min, we use 2/sec)

### 5. Attribution

**Always identify ourselves** via User-Agent

**Current User-Agent**:
```
Alexandria/2.3.0 (nerd@ooheynerds.com; Book metadata enrichment; Donate: https://donate.wikimedia.org)
```

---

## Future Considerations

### Automated Donations

**Possibility**: Integrate with donation APIs (if available)

**Challenges**:
- Archive.org: No public donation API
- Wikimedia: No public donation API
- Manual process likely required indefinitely

### Usage Optimization

**Goals**:
- Increase cache hit rate to 95%+
- Implement smarter fallback chains (try faster APIs first)
- Batch more requests to reduce overhead

**Projected Impact**: Reduce API usage by 20-30% without reducing functionality

### Cost Sharing

**If Alexandria becomes multi-tenant**:
- Track usage per tenant/project
- Split donation costs proportionally
- Generate per-tenant usage reports

---

## Related Documentation

- **Open API Integration Guide**: `docs/api/OPEN-API-INTEGRATIONS.md`
- **Rate Limits Reference**: `docs/operations/RATE-LIMITS.md`
- **Analytics Tracking**: `worker/lib/open-api-utils.ts`
- **Wikidata Service**: `worker/services/wikidata.ts`
- **Archive.org Service**: `worker/services/archive-org.ts`
- **Wikipedia Service**: `worker/services/wikipedia.ts`

---

## Contact & Support

**Questions about donations**:
- Archive.org: info@archive.org
- Wikimedia: donate@wikimedia.org

**Questions about API usage**:
- Archive.org: https://archive.org/about/contact.php
- Wikipedia: https://en.wikipedia.org/wiki/Wikipedia:Contact_us
- Wikidata: https://www.wikidata.org/wiki/Wikidata:Contact

**Alexandria maintainer**: nerd@ooheynerds.com

---

## Summary

**Monthly Process**:
1. Run `./scripts/open-api-usage-report.sh` on 1st of month
2. Review usage and calculate donations ($0.001/request)
3. Make donations via Archive.org and Wikimedia websites
4. Log donations in `DONATION-LOG.md`

**Current Projection**: ~$16/month ($5 Archive.org + $11 Wikimedia)

**Sustainability**: This model ensures we contribute back to the services that make Alexandria possible, while keeping costs predictable and proportional to actual usage.
