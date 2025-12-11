# Cloudflare Workers Rules for Alexandria

These rules are automatically loaded when working with Worker-related tasks.

## Worker Code Guidelines

1. **Use request-scoped SQL connections** - Get via `c.get('sql')`, never global
2. **Always wrap queries in try-catch** - Return proper error responses
3. **Validate all inputs** - ISBNs, titles, author names before queries
4. **Use Hono patterns** - `c.req.query()`, `c.json()`, `c.get()`

## Bindings Reference

- `HYPERDRIVE` - PostgreSQL connection pooling
- `COVER_IMAGES` - R2 bucket for cover storage
- `CACHE` - KV namespace for caching
- `ISBNDB_API_KEY` - ISBNdb Premium API key
- `GOOGLE_BOOKS_API_KEY` - Google Books API key
- `ANALYTICS`, `QUERY_ANALYTICS`, `COVER_ANALYTICS` - Analytics Engine datasets
- `ENRICHMENT_QUEUE`, `COVER_QUEUE` - Cloudflare Queues

## Paid Plan Benefits (Workers Paid)

- Extended CPU limits: 300s (5 minutes)
- Smart placement enabled
- Full observability with 100% sampling
- Queue-based background processing

## ISBNdb Premium (Current Plan)

- Rate Limit: 3 requests/second
- Batch Size: Up to 1000 ISBNs per POST
- Base URL: `api.premium.isbndb.com`
- Daily Quota: ~15,000 API calls

## Security Checklist

- [ ] Input validation for all parameters
- [ ] SQL injection protection (parameterized queries)
- [ ] No secrets in response bodies
- [ ] Whitelist-only domains for cover downloads
