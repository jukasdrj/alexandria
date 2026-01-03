# Alexandria Project Rules

These rules are automatically loaded for all tasks.

## Worker Code

1. **Request-scoped connections**: Use `c.get('sql')`, NEVER global
2. **Try-catch all queries**: Return proper error responses
3. **Validate inputs**: ISBNs, titles, author names before queries
4. **Hono patterns**: `c.req.valid()`, `c.json()`, `c.get()`

## Database

1. **Use `edition_isbns` table** for ISBN lookups (indexed, 49.3M rows)
2. **Never modify core tables** - Read-only source of truth
3. **Test in psql first** - Before implementing in Worker
4. **Parameterized queries** - Prevent SQL injection

**Fuzzy search**: `WHERE title % 'search'` or `similarity(title, 'search')`

## Security

**Never commit**:
- `docs/CREDENTIALS.md` (passwords/API keys)
- `.env` files
- `**/*.key`, `**/*.pem`, `**/*.crt`

**API keys**: Access via `env.ISBNDB_API_KEY`, `env.GOOGLE_BOOKS_API_KEY`

**Cover whitelist**: books.google.com, covers.openlibrary.org, images.isbndb.com, Amazon CDNs

**Errors**: Never leak DB details or internal errors to clients

## ISBNdb Premium

- Rate: 3 req/sec
- Batch: 1000 ISBNs per POST
- Quota: 15,000 calls/day (NO rollover)
- URL: `api.premium.isbndb.com`

## Bindings

- `HYPERDRIVE` - PostgreSQL pooling
- `COVER_IMAGES` - R2 bucket
- `CACHE`, `QUOTA_KV` - KV namespaces
- `ISBNDB_API_KEY`, `GOOGLE_BOOKS_API_KEY` - Secrets
- `ENRICHMENT_QUEUE`, `COVER_QUEUE` - Queues
- `ANALYTICS`, `QUERY_ANALYTICS`, `COVER_ANALYTICS` - Analytics
