# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexandria exposes a self-hosted OpenLibrary PostgreSQL database (54M+ books) through Cloudflare Workers + Tunnel. Database runs on Unraid at home, accessible globally via Cloudflare's edge.

**Current Status**: Phase 2 COMPLETE! Worker live with Hyperdrive + Tunnel database access.

## Architecture Flow

```
Internet → Worker (alexandria.ooheynerds.com) → Hyperdrive (connection pooling)
→ Cloudflare Access (Service Token auth) → Tunnel (alexandria-db.ooheynerds.com)
→ Unraid (192.168.1.240:5432, SSL enabled) → PostgreSQL (54M books)
```

**IMPORTANT**: Tunnel is outbound-only from home network. No inbound firewall ports needed.

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

**Worker code** (using Hyperdrive):
```javascript
const sql = postgres(env.HYPERDRIVE.connectionString, {
  max: 5,
  fetch_types: false,
  prepare: false
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

### Adding API Endpoints
```javascript
// In worker/index.js
const url = new URL(request.url);
if (url.pathname === '/api/search' && url.searchParams.has('isbn')) {
  // IMPORTANT: Validate input first
  const isbn = url.searchParams.get('isbn').replace(/[^0-9X]/gi, '').toUpperCase();
  if (isbn.length !== 10 && isbn.length !== 13) {
    return new Response(JSON.stringify({ error: 'Invalid ISBN' }), { status: 400 });
  }

  // YOU MUST wrap queries in try-catch
  try {
    const result = await db.query(sql, [isbn]);
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    console.error('DB error:', error);
    return new Response(JSON.stringify({ error: 'Query failed' }), { status: 500 });
  }
}
```

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
├── worker/              # Cloudflare Worker code
│   ├── index.js         # Main worker (currently static HTML)
│   ├── wrangler.toml    # Wrangler config
│   └── package.json     # Dependencies
├── scripts/             # Deployment & monitoring scripts
├── docs/                # Documentation
│   ├── CREDENTIALS.md   # Passwords (gitignored!)
│   ├── ARCHITECTURE.md  # System design
│   └── SETUP.md         # Infrastructure setup
├── tunnel/config.yml    # Tunnel config reference
└── TODO.md              # Development roadmap
```

## Additional Context

- Unraid server runs 24/7 with auto-restart
- Tunnel auto-restarts on failure (Docker policy)
- Worker runs on Cloudflare's global network (300+ locations)
- See TODO.md for Phase 3+ features (search UI, author queries, optimization)
