# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexandria is a Cloudflare Workers application that exposes a self-hosted OpenLibrary PostgreSQL database (54M+ books) through a secure Cloudflare Tunnel. The database runs on an Unraid server at home, accessible globally via Cloudflare's edge network.

**Current Status**: Infrastructure complete, hello world deployed. Ready for database integration (Phase 2).

## Architecture

```
Internet Users
    ↓
Cloudflare Worker (alexandria.ooheynerds.com)
    ↓
[Future: Hyperdrive for connection pooling]
    ↓
Cloudflare Tunnel (alexandria-db.ooheynerds.com)
    ↓
Unraid Server "Tower" (192.168.1.240)
    ↓
PostgreSQL Container (openlibrary database)
```

**Key Insight**: The tunnel provides secure, outbound-only access from the home network to Cloudflare. No inbound firewall ports needed. The Worker connects through the tunnel to query the database.

## Database Schema

The OpenLibrary database uses JSONB columns for flexibility:

- **authors** (14.7M rows): `key`, `type`, `revision`, `data` (JSONB with name, bio, etc.)
- **works** (40.1M rows): `key`, `type`, `revision`, `data` (JSONB with title, description, etc.)
- **editions** (54.8M rows): `key`, `type`, `revision`, `work_key`, `data` (JSONB with title, ISBN, etc.)
- **edition_isbns** (49.3M rows): `edition_key`, `isbn` (normalized ISBN lookup)
- **author_works** (42.8M rows): `author_key`, `work_key` (many-to-many relationship)

**Critical**: Use `edition_isbns` table for ISBN lookups, not the JSONB data. It's optimized with indexes.

## Development Commands

### Worker Development
```bash
cd worker/
npm run dev      # Start local development server (localhost:8787)
npm run deploy   # Deploy to Cloudflare (requires Wrangler auth)
npm run tail     # View live Worker logs
```

### Infrastructure Checks
```bash
./scripts/tunnel-status.sh  # Check tunnel health (4 connections expected)
./scripts/db-check.sh        # Verify database and run sample query
./scripts/deploy-worker.sh   # Deploy worker with validation
```

### Direct Database Access
```bash
# Via SSH to Unraid
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# Connection details for Worker configuration:
# Host: alexandria-db.ooheynerds.com (via tunnel)
# Port: 5432
# Database: openlibrary
# User: openlibrary
# Password: stored in docs/CREDENTIALS.md (gitignored)
```

## Testing Queries

Sample ISBN query to implement:
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
WHERE ei.isbn = '9780439064873'  -- Harry Potter test ISBN
LIMIT 1;
```

Test this query via:
```bash
./scripts/db-check.sh  # Includes this query in its output
```

## Next Development Steps (Phase 2)

Two approaches for adding database queries:

### Option A: Direct Connection (Quick Start)
1. Add PostgreSQL driver: `cd worker && npm install postgres`
2. Add secrets: `npx wrangler secret put DATABASE_PASSWORD`
3. Update `wrangler.toml` with connection vars
4. Modify `worker/index.js` to handle `/api/search?isbn=XXX` endpoint
5. Test locally with `npm run dev`

### Option B: Hyperdrive (Production-Ready)
1. Set up Cloudflare Access application
2. Create Service Token for authentication
3. Configure Hyperdrive binding in `wrangler.toml`
4. Update Worker to use Hyperdrive (connection pooling + edge caching)

**Recommendation**: Start with Option A for quick wins, migrate to Hyperdrive for production scale.

## Important Constraints

### SSH Access
- Passwordless SSH configured: `ssh root@Tower.local`
- Used for checking tunnel/database status and viewing logs
- Don't modify tunnel config without backing up `/root/.cloudflared/config.yml` first

### Database Operations
- Database is fully populated (250GB+, 54M records) - **never re-import data**
- Indexes already exist on common query columns
- Database is read-only for this application (OpenLibrary is the source of truth)

### Cloudflare Resources
- Account: Jukasdrj@gmail.com's Account
- Tunnel ID: 848928ab-4ab9-4733-93b0-3e7967c60acb
- Worker name: alexandria
- Domain: ooheynerds.com

### Security
- **docs/CREDENTIALS.md** contains all passwords (gitignored - never commit!)
- Tunnel uses mTLS encryption
- Future: Add rate limiting and input validation when exposing API

## Wrangler Configuration

Current `wrangler.toml` is minimal. When adding database support, you'll need:

```toml
[vars]
DATABASE_HOST = "alexandria-db.ooheynerds.com"
DATABASE_PORT = "5432"
DATABASE_NAME = "openlibrary"
DATABASE_USER = "openlibrary"

# Set via CLI (not in wrangler.toml):
# npx wrangler secret put DATABASE_PASSWORD
```

For Hyperdrive approach, add a binding instead:
```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"
```

## Troubleshooting

### Worker won't deploy
```bash
npx wrangler whoami   # Check authentication
npx wrangler login    # Re-authenticate if needed
```

### Tunnel not connecting
```bash
ssh root@Tower.local "docker restart alexandria-tunnel"
./scripts/tunnel-status.sh  # Should show 4 registered connections
```

### Database connection issues
```bash
# Check PostgreSQL is running
ssh root@Tower.local "docker ps | grep postgres"

# Test direct connection
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT 1;'"
```

### Query performance issues
- Check if indexes exist: `\d+ table_name` in psql
- Use `EXPLAIN ANALYZE` to diagnose slow queries
- Consider adding Hyperdrive for connection pooling and caching
- The database is optimized, but complex joins across 50M+ rows need careful query design

## File Structure

```
/Users/juju/dev_repos/alex/
├── worker/
│   ├── index.js          # Worker code (currently static HTML)
│   ├── wrangler.toml     # Wrangler config
│   └── package.json      # Dependencies
├── tunnel/
│   └── config.yml        # Reference config (actual config on Unraid)
├── scripts/
│   ├── deploy-worker.sh  # Deploy with validation
│   ├── tunnel-status.sh  # Check tunnel health
│   └── db-check.sh       # Database status and test query
├── docs/
│   ├── ARCHITECTURE.md   # System design details
│   ├── SETUP.md          # Infrastructure setup steps
│   └── CREDENTIALS.md    # All passwords (gitignored!)
├── TODO.md               # Development roadmap
├── README.md             # Project overview
└── CLAUDE_CODE.md        # Older agent guide (this file supersedes it)
```

## Common Patterns

### Adding a New Query Endpoint

1. **Design the query** - Test in psql first via `ssh root@Tower.local`
2. **Add route handling** in `worker/index.js`:
   ```javascript
   const url = new URL(request.url);
   if (url.pathname === '/api/search' && url.searchParams.has('isbn')) {
     // Query logic here
   }
   ```
3. **Return JSON response**:
   ```javascript
   return new Response(JSON.stringify(results), {
     headers: { 'content-type': 'application/json' }
   });
   ```
4. **Test locally**: `npm run dev` and visit `http://localhost:8787/api/search?isbn=XXX`
5. **Deploy**: `npm run deploy`

### Error Handling

Always wrap database queries in try-catch:
```javascript
try {
  const result = await db.query(sql, params);
  return new Response(JSON.stringify(result), { status: 200 });
} catch (error) {
  console.error('Database error:', error);
  return new Response(JSON.stringify({ error: 'Database query failed' }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  });
}
```

### Input Validation

Sanitize user input, especially for ISBNs:
```javascript
const isbn = url.searchParams.get('isbn')
  .replace(/[^0-9X]/gi, '')  // Remove non-ISBN characters
  .toUpperCase();

if (isbn.length !== 10 && isbn.length !== 13) {
  return new Response(JSON.stringify({ error: 'Invalid ISBN format' }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
}
```

## Testing Workflow

Before deploying changes:

1. **Test locally**: `npm run dev` in worker directory
2. **Verify infrastructure**: Run `./scripts/tunnel-status.sh` and `./scripts/db-check.sh`
3. **Check Worker logs**: `npm run tail` (after deployment)
4. **Test on live site**: Visit https://alexandria.ooheynerds.com

## Additional Context

- The Unraid server runs 24/7 with automatic restarts
- Tunnel is configured to auto-restart on failure (Docker restart policy)
- Worker runs on Cloudflare's global network (300+ locations)
- Future plans include search UI, author queries, and performance optimization (see TODO.md)
