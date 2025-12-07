---
description: Guide for adding a new API endpoint to Alexandria Worker
---

You are adding a new API endpoint to the Alexandria Cloudflare Worker.

## Pre-Implementation Checklist

1. **Test database query first** using /db-query
2. **Verify performance** with EXPLAIN ANALYZE
3. **Check for existing similar endpoints** in worker/index.ts
4. **Consider caching strategy** (KV, Hyperdrive query cache, CDN)

## Implementation Pattern

```typescript
// In worker/index.ts

app.get('/api/your-endpoint', async (c) => {
  // 1. Input validation
  const param = c.req.query('param');
  if (!param || !isValid(param)) {
    return c.json({ error: 'Invalid input' }, 400);
  }

  // 2. Check cache (if applicable)
  const cacheKey = `endpoint:${param}`;
  const cached = await c.env.CACHE.get(cacheKey, 'json');
  if (cached) return c.json(cached);

  // 3. Get request-scoped SQL connection
  const sql = c.get('sql');

  // 4. Execute query with error handling
  try {
    const results = await sql`
      SELECT ... FROM ... WHERE ... = ${param}
    `;

    // 5. Track analytics
    c.env.QUERY_ANALYTICS.writeDataPoint({
      indexes: ['endpoint'],
      blobs: ['your-endpoint', param],
      doubles: [Date.now()]
    });

    // 6. Cache result
    await c.env.CACHE.put(cacheKey, JSON.stringify(results), {
      expirationTtl: 3600
    });

    return c.json({ results });
  } catch (error) {
    console.error('Query error:', error);
    return c.json({ error: 'Query failed' }, 500);
  }
});
```

## Testing Workflow

1. Test locally: `cd worker && npm run dev`
2. Verify: `curl http://localhost:8787/api/your-endpoint?param=value`
3. Deploy: `/deploy-check`
4. Test live: `curl https://alexandria.ooheynerds.com/api/your-endpoint?param=value`

## Security Checklist

- [ ] Input validation for all parameters
- [ ] SQL injection protection (use parameterized queries)
- [ ] Rate limiting considered
- [ ] Error messages don't leak sensitive info
- [ ] No secrets in response
