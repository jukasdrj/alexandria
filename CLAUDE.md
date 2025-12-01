# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexandria exposes a self-hosted OpenLibrary PostgreSQL database (54M+ books) through Cloudflare Workers + Tunnel. Database runs on Unraid at home, accessible globally via Cloudflare's edge.

**Current Status**: Phase 2 + Cover Processing COMPLETE! Worker live with Hyperdrive + Tunnel database access + R2 cover image storage.

## Architecture Flow

```
Internet → Cloudflare Access (IP bypass: 47.187.18.143/32)
→ Worker (alexandria.ooheynerds.com, Hono framework)
→ Hyperdrive (connection pooling, ID: 00ff424776f4415d95245c3c4c36e854)
→ Cloudflare Access (Service Token auth to tunnel)
→ Tunnel (alexandria-db.ooheynerds.com)
→ Unraid (192.168.1.240:5432, SSL enabled)
→ PostgreSQL (54.8M editions)

Cover Images:
→ Worker receives provider URL (OpenLibrary, ISBNdb, Google Books)
→ Downloads, validates, stores in R2 (bookstrack-covers-processed bucket)
→ Serves via /api/covers/:work_key/:size or /covers/:isbn/:size
```

**IMPORTANT**:
- Tunnel is outbound-only from home network. No inbound firewall ports needed.
- API secured with Cloudflare Access - only accessible from home IP (47.187.18.143/32)

## Database Schema (CRITICAL)

**YOU MUST use `edition_isbns` table for ISBN lookups** - it's indexed and optimized.

Tables:
- **authors** (14.7M): `key`, `type`, `revision`, `data` (JSONB: name, bio)
- **works** (40.1M): `key`, `type`, `revision`, `data` (JSONB: title, description)
- **editions** (54.8M): `key`, `type`, `revision`, `work_key`, `data` (JSONB: title, ISBN)
- **edition_isbns** (49.3M): `edition_key`, `isbn` ← **USE THIS FOR ISBN QUERIES**
- **author_works** (42.8M): `author_key`, `work_key` (relationships)

## Essential Commands

### Worker Development
```bash
cd worker/
npm run dev      # Local dev server (localhost:8787)
npm run deploy   # Deploy to Cloudflare
npm run tail     # Live Worker logs
```

### Infrastructure Checks
```bash
./scripts/tunnel-status.sh  # Check tunnel (expect 4 connections)
./scripts/db-check.sh        # Verify database + sample query
./scripts/deploy-worker.sh   # Deploy with validation
```

### Database Access
```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# Connection for Worker:
# Host: alexandria-db.ooheynerds.com (via tunnel)
# Port: 5432 | DB: openlibrary | User: openlibrary
# Password: in docs/CREDENTIALS.md (gitignored)
```

## Development Workflow

### Git Conventions
- **Branch naming**: `feature/description`, `fix/description`, `docs/description`
- **Merge strategy**: Squash and merge for features, rebase for hotfixes
- **NEVER commit**: docs/CREDENTIALS.md (gitignored), .env files, secrets

### Before Starting Work
1. Run `./scripts/tunnel-status.sh` and `./scripts/db-check.sh` to verify infrastructure
2. **IMPORTANT**: Always test queries in psql before implementing in Worker
3. Use `npm run dev` for local testing before deploying

### Testing Workflow
1. Test locally: `npm run dev`
2. Verify infrastructure with scripts
3. Deploy: `npm run deploy`
4. Check logs: `npm run tail`
5. Test live: https://alexandria.ooheynerds.com

## Phase 2: Database Integration (COMPLETE ✅)

### Hyperdrive Setup (Production)
Hyperdrive provides connection pooling, query caching, and secure tunnel access.

**Prerequisites**:
1. PostgreSQL must have SSL enabled (self-signed cert is fine)
2. Cloudflare Access Service Token created
3. Cloudflare Access Application configured for tunnel hostname

**Setup Steps**:
```bash
# 1. Enable SSL on PostgreSQL (if not already enabled)
ssh root@Tower.local "docker exec postgres bash -c 'cd /var/lib/postgresql/18/docker && openssl req -new -x509 -days 3650 -nodes -text -out server.crt -keyout server.key -subj \"/CN=postgres\" && chmod 600 server.key && chown postgres:postgres server.key server.crt'"
ssh root@Tower.local "docker exec postgres bash -c 'echo \"ssl = on\" >> /var/lib/postgresql/18/docker/postgresql.conf'"
ssh root@Tower.local "docker restart postgres"

# 2. Create Hyperdrive config (requires Access Client ID/Secret from dashboard)
npx wrangler hyperdrive create alexandria-db \
  --host=alexandria-db.ooheynerds.com \
  --user=openlibrary \
  --password=<from CREDENTIALS.md> \
  --database=openlibrary \
  --access-client-id=<from Cloudflare Access> \
  --access-client-secret=<from Cloudflare Access> \
  --caching-disabled
```

**wrangler.toml configuration**:
```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "00ff424776f4415d95245c3c4c36e854"
```

**Worker code** (using Hono + Hyperdrive):
```javascript
import { Hono } from 'hono';
import postgres from 'postgres';

const app = new Hono();

// Database middleware - creates request-scoped connection
app.use('*', async (c, next) => {
  const sql = postgres(c.env.HYPERDRIVE.connectionString, {
    max: 1,  // Single connection per request, Hyperdrive handles pooling
    fetch_types: false,
    prepare: false
  });
  c.set('sql', sql);
  await next();
});

// Route example
app.get('/health', async (c) => {
  const sql = c.get('sql');
  await sql`SELECT 1`;
  return c.json({ status: 'ok' });
});

export default app;
```

**CRITICAL I/O Context Fix**: Connection must be request-scoped (`c.get('sql')`) not global. Global connections cause "Cannot perform I/O on behalf of a different request" errors.

## Cover Image Processing (COMPLETE ✅)

### R2 Storage
- **Bucket**: `bookstrack-covers-processed`
- **Binding**: `COVER_IMAGES`
- **Structure**: `covers/{work_key}/{hash}/original` or `isbn/{isbn}/original.{ext}`

### Endpoints

**Work-based (new)**:
- `POST /api/covers/process` - Process cover from provider URL
- `GET /api/covers/:work_key/:size` - Serve cover (large/medium/small)

**ISBN-based (legacy)**:
- `POST /covers/:isbn/process` - Trigger cover processing from providers
- `GET /covers/:isbn/:size` - Serve cover image
- `GET /covers/:isbn/status` - Check if cover exists
- `POST /covers/batch` - Process multiple ISBNs (max 10)

### Domain Whitelist (Security)
Only these domains are allowed for cover downloads:
- `books.google.com`
- `covers.openlibrary.org`
- `images.isbndb.com`
- `images-na.ssl-images-amazon.com`
- `m.media-amazon.com`

### Processing Pipeline
```javascript
// Work-based: POST /api/covers/process
const response = await fetch('https://alexandria.ooheynerds.com/api/covers/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    work_key: '/works/OL45804W',
    provider_url: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
    isbn: '9780439064873'  // optional, for logging
  })
});

// ISBN-based: POST /covers/:isbn/process
const response = await fetch('https://alexandria.ooheynerds.com/covers/9780439064873/process', {
  method: 'POST'
});
```

## Sample Query (Test First!)

**CRITICAL**: Test this in psql before implementing:
```sql
SELECT
    e.data->>'title' AS title,
    a.data->>'name' AS author,
    ei.isbn
FROM editions e
JOIN edition_isbns ei ON ei.edition_key = e.key
JOIN works w ON w.key = e.work_key
JOIN author_works aw ON aw.work_key = w.key
JOIN authors a ON aw.author_key = a.key
WHERE ei.isbn = '9780439064873'  -- Test with Harry Potter ISBN
LIMIT 1;
```

Run via: `./scripts/db-check.sh`

## Code Patterns

### Adding API Endpoints (Hono Framework)
```javascript
// In worker/index.js
app.get('/api/search', async (c) => {
  // IMPORTANT: Validate input first
  const isbn = c.req.query('isbn')?.replace(/[^0-9X]/gi, '').toUpperCase();

  if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
    return c.json({ error: 'Invalid ISBN' }, 400);
  }

  // Get request-scoped sql connection
  const sql = c.get('sql');

  // YOU MUST wrap queries in try-catch
  try {
    const results = await sql`
      SELECT
        e.data->>'title' AS title,
        a.data->>'name' AS author,
        ei.isbn
      FROM editions e
      JOIN edition_isbns ei ON ei.edition_key = e.key
      LEFT JOIN works w ON w.key = e.work_key
      LEFT JOIN author_works aw ON aw.work_key = w.key
      LEFT JOIN authors a ON aw.author_key = a.key
      WHERE ei.isbn = ${isbn}
      LIMIT 10
    `;

    return c.json({ results });
  } catch (error) {
    console.error('DB error:', error);
    return c.json({ error: 'Query failed' }, 500);
  }
});
```

**Key Hono Patterns**:
- Use `c.req.query('param')` for query parameters
- Use `c.json(data, status)` for JSON responses
- Use `c.get('sql')` for request-scoped database connection
- Middleware applies to routes via `app.use()`

## Critical Constraints

### Database Operations
- **NEVER re-import data** - database is fully populated (250GB, 54M records)
- **Read-only application** - OpenLibrary is source of truth
- Indexes exist on common columns - use them
- Complex joins need careful design (50M+ rows)

### SSH Access
- Passwordless configured: `ssh root@Tower.local`
- **IMPORTANT**: Backup `/root/.cloudflared/config.yml` before modifying tunnel config

### Security
- **docs/CREDENTIALS.md** has all passwords (gitignored - NEVER commit!)
- Tunnel uses mTLS encryption
- **YOU MUST** add rate limiting + input validation for public API

### Cloudflare Resources
- Account: Jukasdrj@gmail.com's Account
- Tunnel ID: 848928ab-4ab9-4733-93b0-3e7967c60acb
- Worker: alexandria | Domain: ooheynerds.com

## Troubleshooting

### Worker Issues
```bash
npx wrangler whoami   # Check auth
npx wrangler login    # Re-auth if needed
```

### Tunnel Issues
```bash
ssh root@Tower.local "docker restart alexandria-tunnel"
./scripts/tunnel-status.sh  # Should show 4 connections
```

### Database Issues
```bash
ssh root@Tower.local "docker ps | grep postgres"
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT 1;'"
```

### Performance Issues
- Use `EXPLAIN ANALYZE` in psql to diagnose slow queries
- Check indexes: `\d+ table_name`
- Consider Hyperdrive for connection pooling
- Database is optimized, but 50M+ row joins need careful design

## File Structure

```
alex/
├── worker/                    # Cloudflare Worker code
│   ├── index.js               # Main worker + Hono routes
│   ├── wrangler.toml          # Wrangler config (Hyperdrive, R2, KV, Secrets)
│   ├── cover-handlers.js      # Work-based cover processing (POST /api/covers/process)
│   ├── image-utils.js         # Image download, validation, hashing utilities
│   ├── enrich-handlers.js     # Enrichment API handlers
│   ├── enrichment-service.js  # Enrichment business logic
│   ├── services/
│   │   ├── image-processor.js # ISBN-based cover processing pipeline
│   │   └── cover-fetcher.js   # Multi-provider cover URL fetching
│   └── package.json           # Dependencies
├── scripts/                   # Deployment & monitoring scripts
├── docs/                      # Documentation
│   ├── CREDENTIALS.md         # Passwords (gitignored!)
│   ├── ARCHITECTURE.md        # System design
│   └── SETUP.md               # Infrastructure setup
├── tunnel/config.yml          # Tunnel config reference
└── TODO.md                    # Development roadmap
```

## Cloudflare Bindings Reference

```toml
# wrangler.toml bindings summary
[[hyperdrive]]
binding = "HYPERDRIVE"                    # PostgreSQL via Hyperdrive

[[r2_buckets]]
binding = "COVER_IMAGES"                  # R2: bookstrack-covers-processed

[[kv_namespaces]]
binding = "CACHE"                         # KV for caching

[[secrets_store_secrets]]
binding = "ISBNDB_API_KEY"                # ISBNdb API key
binding = "GOOGLE_BOOKS_API_KEY"          # Google Books API key
```

## Additional Context

- Unraid server runs 24/7 with auto-restart
- Tunnel auto-restarts on failure (Docker policy)
- Worker runs on Cloudflare's global network (300+ locations)
- See TODO.md for Phase 3+ features (search UI, author queries, optimization)
