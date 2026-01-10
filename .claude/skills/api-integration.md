---
name: api-integration
description: Add new external API integration with rate limiting, circuit breakers, and enrichment pipeline
user-invocable: true
context: fork
model: sonnet
skills:
  - planning-with-files
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebFetch
  - WebSearch
hooks:
  Start:
    - type: command
      command: echo "🔌 API integration workflow starting..."
  Stop:
    - type: command
      command: echo "🔌 API integration complete - test with npm run dev"
---

# API Integration Skill

**Purpose:** Systematically add new external API providers to Alexandria's enrichment pipeline
**Context:** Runs in forked sub-agent for isolation
**Auto-loads:** planning-with-files for structured execution
**Updated:** January 10, 2026

## When to Use

**Required for adding any new external API:**
- New metadata providers (like LibraryThing, WorldCat, etc.)
- Cover image sources
- Author biography providers
- Search/discovery APIs
- ID resolution services

**Trigger phrases:**
- "Add LibraryThing API integration"
- "Integrate WorldCat for metadata"
- "Add another cover source"
- "Connect to OCLC API"
- "Add new enrichment provider"

## Workflow

This skill automatically:
1. **Loads planning-with-files** for task planning
2. **Researches API** (rate limits, authentication, schema)
3. **Creates service client** with proper error handling
4. **Adds rate limiting** via KV-backed distributed limiter
5. **Integrates circuit breaker** for resilience
6. **Updates enrichment pipeline** with new provider
7. **Adds analytics tracking** for usage monitoring

## Integration Checklist

### Phase 1: Research & Planning
- [ ] Review API documentation (auth, endpoints, rate limits)
- [ ] Identify required credentials/API keys
- [ ] Map API schema to Alexandria data model
- [ ] Determine position in provider chain
- [ ] Plan rate limiting strategy
- [ ] Check quota/cost implications

### Phase 2: Service Implementation
- [ ] Create service file in `worker/services/`
- [ ] Implement client with proper typing
- [ ] Add rate limiter (KV-backed)
- [ ] Add circuit breaker for fault tolerance
- [ ] Implement response normalization
- [ ] Add comprehensive error handling
- [ ] Include User-Agent with contact info

### Phase 3: Pipeline Integration
- [ ] Add to enrichment waterfall/chain
- [ ] Update priority/fallback logic
- [ ] Add to cover fetcher (if applicable)
- [ ] Handle quota management
- [ ] Add analytics tracking
- [ ] Update OpenAPI documentation

### Phase 4: Testing & Deployment
- [ ] Test with sample data locally
- [ ] Validate rate limiting works
- [ ] Test circuit breaker behavior
- [ ] Deploy to production
- [ ] Monitor analytics and errors
- [ ] Update documentation

## Alexandria-Specific Patterns

### Pattern 1: Metadata Provider Integration

**Files to create/modify:**
- `worker/services/{provider-name}.ts` - New service client
- `worker/services/external-apis.ts` - Add to provider chain
- `worker/services/normalizers/{provider-name}.ts` - Schema mapping
- `worker/src/env.ts` - Add API key binding
- `worker/wrangler.jsonc` - Add secret binding
- `docs/api/RATE-LIMITS.md` - Document rate limits

**Service Template:**
```typescript
// worker/services/example-provider.ts

import { Logger } from '../lib/logger';
import { RateLimiter } from '../lib/rate-limiter';
import type { Env } from '../env';

interface ExampleProviderConfig {
  baseUrl: string;
  rateLimit: { requests: number; windowMs: number };
  cacheTtl: number;
}

const CONFIG: ExampleProviderConfig = {
  baseUrl: 'https://api.example.com',
  rateLimit: { requests: 1, windowMs: 1000 }, // 1 req/sec
  cacheTtl: 86400 * 7, // 7 days
};

export async function fetchFromExampleProvider(
  isbn: string,
  env: Env,
  logger: Logger
): Promise<BookMetadata | null> {
  const limiter = new RateLimiter(env.QUOTA_KV, 'example-provider', CONFIG.rateLimit);

  try {
    // Check and consume rate limit
    await limiter.checkLimit();

    // Make API request
    const response = await fetch(`${CONFIG.baseUrl}/books/${isbn}`, {
      headers: {
        'Authorization': `Bearer ${env.EXAMPLE_API_KEY}`,
        'User-Agent': 'Alexandria/2.4.0 (contact@example.com; Book metadata enrichment)',
      },
    });

    if (!response.ok) {
      logger.warn(`Example Provider API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Track usage for analytics
    await trackOpenApiUsage(env, 'example-provider', 'metadata', isbn);

    return normalizeExampleProviderData(data);
  } catch (error) {
    logger.error('Example Provider fetch failed', { error, isbn });
    return null;
  }
}

function normalizeExampleProviderData(data: any): BookMetadata {
  return {
    title: data.title,
    authors: data.authors?.map((a: any) => a.name) || [],
    publishDate: data.published_date,
    isbn: data.isbn13,
    // ... map all fields to Alexandria schema
  };
}
```

### Pattern 2: Cover Source Integration

**Add to cover priority chain in `worker/services/cover-fetcher.ts`:**

```typescript
export async function fetchCover(
  isbn: string,
  env: Env,
  logger: Logger
): Promise<string | null> {
  // Try sources in priority order
  const sources = [
    { name: 'google-books', fn: fetchGoogleBooksCover },
    { name: 'openlibrary', fn: fetchOpenLibraryCover },
    { name: 'archive-org', fn: fetchArchiveOrgCover },
    { name: 'example-provider', fn: fetchExampleProviderCover }, // NEW
    { name: 'isbndb', fn: fetchISBNdbCover }, // Paid fallback
  ];

  for (const source of sources) {
    try {
      const coverUrl = await source.fn(isbn, env, logger);
      if (coverUrl) {
        logger.info(`Cover found via ${source.name}`, { isbn });
        return coverUrl;
      }
    } catch (error) {
      logger.warn(`${source.name} cover fetch failed`, { error, isbn });
    }
  }

  return null;
}
```

### Pattern 3: Rate Limiting Configuration

**KV-backed distributed rate limiter:**

```typescript
// worker/lib/rate-limiter.ts usage

export class RateLimiter {
  constructor(
    private kv: KVNamespace,
    private identifier: string,
    private config: { requests: number; windowMs: number }
  ) {}

  async checkLimit(): Promise<void> {
    const key = `rate_limit:${this.identifier}:${Date.now()}`;
    const count = await this.kv.get(key);

    if (count && parseInt(count) >= this.config.requests) {
      const waitMs = this.config.windowMs - (Date.now() % this.config.windowMs);
      throw new Error(`Rate limit exceeded, retry in ${waitMs}ms`);
    }

    await this.kv.put(
      key,
      (parseInt(count || '0') + 1).toString(),
      { expirationTtl: Math.ceil(this.config.windowMs / 1000) }
    );
  }
}
```

**Document in `docs/operations/RATE-LIMITS.md`:**
```markdown
## Example Provider

**Rate Limit:** 1 request/second (60 req/min)
**Quota:** None (free tier)
**Enforcement:** KV-backed distributed limiter
**Delay:** 1000ms between requests
**Caching:** 7 days (metadata stable)
**User-Agent:** Required with contact email
**Circuit Breaker:** 5 failures → 60s backoff
```

### Pattern 4: Circuit Breaker Pattern

**Prevent cascading failures:**

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly resetTimeout = 60000; // 60s

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.failures >= this.threshold) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.resetTimeout) {
        throw new Error('Circuit breaker open - service unavailable');
      }
      // Reset after timeout
      this.failures = 0;
    }

    try {
      const result = await fn();
      this.failures = 0; // Reset on success
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      throw error;
    }
  }
}
```

### Pattern 5: Analytics Tracking

**Track API usage for all providers:**

```typescript
// worker/lib/analytics.ts

export async function trackOpenApiUsage(
  env: Env,
  provider: string,
  operation: string,
  identifier: string
): Promise<void> {
  await env.ANALYTICS.writeDataPoint({
    blobs: [provider, operation, identifier],
    doubles: [1], // Count
    indexes: [provider],
  });
}
```

**Usage in service:**
```typescript
const metadata = await fetchFromProvider(isbn, env, logger);
if (metadata) {
  await trackOpenApiUsage(env, 'example-provider', 'metadata', isbn);
}
```

## Common API Patterns

### Pattern A: Pagination Handling

**For APIs with paginated results:**
```typescript
async function fetchAllPages<T>(
  baseUrl: string,
  params: Record<string, string>,
  env: Env
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(`${baseUrl}?page=${page}&${new URLSearchParams(params)}`);
    const data = await response.json();

    results.push(...data.items);
    hasMore = data.hasNext;
    page++;

    // Rate limit between pages
    await delay(1000);
  }

  return results;
}
```

### Pattern B: Batch Operations

**For APIs supporting batch lookups:**
```typescript
async function fetchBatch(
  isbns: string[],
  env: Env,
  logger: Logger
): Promise<Map<string, BookMetadata>> {
  const batchSize = 100; // API limit
  const results = new Map<string, BookMetadata>();

  for (let i = 0; i < isbns.length; i += batchSize) {
    const batch = isbns.slice(i, i + batchSize);

    const response = await fetch(`${CONFIG.baseUrl}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbns: batch }),
    });

    const data = await response.json();
    data.forEach((item: any) => {
      results.set(item.isbn, normalizeData(item));
    });

    // Rate limit between batches
    await delay(CONFIG.rateLimit.windowMs);
  }

  return results;
}
```

### Pattern C: Retry Logic with Exponential Backoff

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry client errors (4xx)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const backoffMs = Math.pow(2, attempt) * 1000;
      await delay(backoffMs);
    }
  }

  throw lastError!;
}
```

## Environment Configuration

### Add API Key to wrangler.jsonc

```jsonc
{
  "vars": {
    // ...existing vars
  },
  "kv_namespaces": [
    // ...existing KV namespaces
  ],
  "[env.production]": {
    "vars": {
      "EXAMPLE_PROVIDER_BASE_URL": "https://api.example.com/v1"
    }
  }
}
```

### Add Secret via Wrangler

```bash
# Set API key (interactive)
npx wrangler secret put EXAMPLE_API_KEY

# Or via script
echo "your-api-key" | npx wrangler secret put EXAMPLE_API_KEY
```

### Update TypeScript Types

```typescript
// worker/src/env.ts

export interface Env {
  // ...existing bindings
  EXAMPLE_API_KEY: string;
}
```

## Testing Strategy

### Local Testing

```bash
# Start dev server
cd worker && npm run dev

# Test endpoint
curl http://localhost:8787/api/test/example-provider?isbn=9780134685991

# Check logs
npm run tail
```

### Integration Tests

```typescript
// worker/tests/example-provider.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { fetchFromExampleProvider } from '../services/example-provider';

describe('ExampleProvider', () => {
  it('should fetch metadata for valid ISBN', async () => {
    const result = await fetchFromExampleProvider('9780134685991', env, logger);
    expect(result).toBeDefined();
    expect(result?.title).toBeTruthy();
  });

  it('should handle rate limiting', async () => {
    // Make rapid requests
    const promises = Array(10).fill(0).map(() =>
      fetchFromExampleProvider('9780134685991', env, logger)
    );

    await expect(Promise.all(promises)).rejects.toThrow('Rate limit exceeded');
  });

  it('should return null for invalid ISBN', async () => {
    const result = await fetchFromExampleProvider('invalid', env, logger);
    expect(result).toBeNull();
  });
});
```

## Deployment Checklist

- [ ] API key added via `wrangler secret put`
- [ ] Environment variables updated in wrangler.jsonc
- [ ] TypeScript types updated in env.ts
- [ ] Rate limiting tested locally
- [ ] Analytics tracking verified
- [ ] OpenAPI spec updated
- [ ] Documentation added to docs/api/
- [ ] Deploy with `npm run deploy`
- [ ] Monitor with `npm run tail`
- [ ] Check analytics in Cloudflare dashboard

## Monitoring & Maintenance

### Check API Usage

```bash
# View live logs
npm run tail | grep example-provider

# Check rate limit usage
./scripts/db-query.sh "SELECT * FROM quota_kv WHERE key LIKE 'rate_limit:example-provider%'"
```

### Analytics Queries

```sql
-- API call volume by provider
SELECT
  blob1 as provider,
  COUNT(*) as calls,
  DATE_TRUNC('day', timestamp) as day
FROM analytics
WHERE blob1 = 'example-provider'
GROUP BY provider, day
ORDER BY day DESC;
```

### Cost Tracking

Add to `docs/operations/DONATION-TRACKING.md`:
```markdown
## Example Provider Usage

- **Period:** January 2026
- **Calls:** 15,000 metadata requests
- **Cost:** Free tier (no costs)
- **Donation:** Not required (commercial API)
```

## Best Practices Summary

1. **Research thoroughly** - Understand API limits, costs, and capabilities
2. **Rate limit properly** - Use KV-backed distributed limiter
3. **Add circuit breakers** - Prevent cascading failures
4. **Track analytics** - Monitor usage for all providers
5. **Document rate limits** - Centralize in RATE-LIMITS.md
6. **Test locally first** - Validate before production
7. **User-Agent required** - Include contact info for free APIs
8. **Cache aggressively** - Respect API quotas
9. **Fail gracefully** - Return null, don't throw errors
10. **Update OpenAPI spec** - Keep documentation current

---

**Last Updated:** January 10, 2026
**Maintained By:** Alexandria AI Team
**Related Skills:** planning-with-files
**Related Docs:** docs/api/OPEN-API-INTEGRATIONS.md, docs/operations/RATE-LIMITS.md
