# Test-Driven Development Guide for Alexandria

This guide outlines TDD patterns for Phase 2+ development.

## Testing Philosophy

1. **Test queries in psql BEFORE implementing in Worker**
2. **Use curl/Wrangler dev for Worker endpoint testing**
3. **Validate live deployment with real requests**

## Phase 2: Database Integration Testing

### 1. Database Query Tests (psql)

Before implementing any query in the Worker, test it directly:

```bash
# Test ISBN lookup
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
    e.data->>'title' AS title,
    a.data->>'name' AS author,
    ei.isbn
FROM editions e
JOIN edition_isbns ei ON ei.edition_key = e.key
JOIN works w ON w.key = e.work_key
JOIN author_works aw ON aw.work_key = w.key
JOIN authors a ON aw.author_key = a.key
WHERE ei.isbn = '9780439064873'
LIMIT 1;
\""
```

**Expected results:**
- Query returns in < 2 seconds
- Results match expected book data
- No PostgreSQL errors

### 2. Worker Local Testing

Test Worker endpoints locally before deploying:

```bash
cd worker
npm run dev

# In another terminal
curl "http://localhost:8787/api/search?isbn=9780439064873"
```

**Test cases:**
- ✅ Valid ISBN returns correct book data
- ✅ Invalid ISBN (wrong format) returns 400 error
- ✅ Non-existent ISBN returns 404 or empty result
- ✅ Missing ISBN parameter returns 400 error
- ✅ SQL injection attempts are blocked

### 3. Input Validation Tests

Test edge cases for ISBN validation:

```javascript
// Valid ISBNs to test
const validISBNs = [
  '9780439064873',     // 13-digit
  '0439064872',        // 10-digit
  '978-0-439-06487-3', // With hyphens (should strip)
  '0 439 06487 2'      // With spaces (should strip)
];

// Invalid ISBNs to test
const invalidISBNs = [
  '123',               // Too short
  'abcdefghij',        // Non-numeric
  '9780439064873999',  // Too long
  '',                  // Empty
  null,                // Null
];
```

### 4. Error Handling Tests

Verify error responses:

```bash
# Missing ISBN
curl "http://localhost:8787/api/search"
# Expected: 400 Bad Request

# Invalid format
curl "http://localhost:8787/api/search?isbn=abc"
# Expected: 400 Bad Request with error message

# Database connection failure (simulate by stopping tunnel)
ssh root@Tower.local "docker stop alexandria-tunnel"
curl "http://localhost:8787/api/search?isbn=9780439064873"
# Expected: 500 Internal Server Error
ssh root@Tower.local "docker start alexandria-tunnel"
```

### 5. Performance Tests

Verify query performance:

```bash
# Use EXPLAIN ANALYZE in psql
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
EXPLAIN ANALYZE
SELECT e.data->>'title' AS title
FROM editions e
JOIN edition_isbns ei ON ei.edition_key = e.key
WHERE ei.isbn = '9780439064873'
LIMIT 1;
\""
```

**Performance targets:**
- Query execution: < 100ms
- Worker response: < 200ms (local)
- Worker response: < 500ms (production, including tunnel)

## Test Workflow

### Before Every Code Change

1. Run infrastructure checks:
   ```bash
   ./scripts/tunnel-status.sh
   ./scripts/db-check.sh
   ```

2. Test query in psql
3. Implement in Worker
4. Test locally with `npm run dev`
5. Test edge cases and error conditions
6. Deploy with `/deploy-check` command
7. Test live endpoint

### Integration Testing Checklist

- [ ] Tunnel is running (4 connections)
- [ ] Database is accessible
- [ ] Query works in psql
- [ ] Worker runs locally
- [ ] All test cases pass (valid/invalid input)
- [ ] Error handling works
- [ ] Performance is acceptable
- [ ] Live deployment successful
- [ ] Live endpoint works

## Example: Testing ISBN Search Feature

```bash
# 1. Test query
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"SELECT e.data->>'title' FROM editions e JOIN edition_isbns ei ON ei.edition_key = e.key WHERE ei.isbn = '9780439064873' LIMIT 1;\""

# 2. Implement in Worker (worker/index.js)
# ... add code ...

# 3. Test locally
cd worker && npm run dev

# 4. Test valid ISBN
curl "http://localhost:8787/api/search?isbn=9780439064873"

# 5. Test invalid input
curl "http://localhost:8787/api/search?isbn=invalid"
curl "http://localhost:8787/api/search"

# 6. Deploy
npx wrangler deploy

# 7. Test live
curl "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873"
```

## Regression Testing

After any code change, verify:

```bash
# Quick smoke test
curl https://alexandria.ooheynerds.com
curl "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873"

# Full infrastructure check
./scripts/tunnel-status.sh
./scripts/db-check.sh
```

## Future: Automated Tests

For Phase 3+, consider:
- Vitest for Worker unit tests
- Playwright for integration tests
- GitHub Actions for CI/CD

## Common Issues & Solutions

### Query works in psql but fails in Worker
- Check connection string configuration
- Verify secrets are set: `npx wrangler secret list`
- Check Worker logs: `npm run tail`

### Performance degradation
- Run EXPLAIN ANALYZE to check query plan
- Verify indexes exist: `\d+ edition_isbns`
- Check if Hyperdrive caching is working (if enabled)

### Intermittent failures
- Check tunnel status: `./scripts/tunnel-status.sh`
- Verify PostgreSQL is stable: `ssh root@Tower.local "docker ps"`
- Check Worker error rate in Cloudflare dashboard
