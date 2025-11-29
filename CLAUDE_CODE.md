# Guide for Claude Code

This document helps Claude Code agents pick up development of the Alexandria project.

## Project Context

**Alexandria** is a Cloudflare Workers application providing global access to a self-hosted OpenLibrary PostgreSQL database (54M+ books) through a secure Cloudflare Tunnel.

**Current Status**: Phase 2 COMPLETE! ✅ Worker deployed with Hyperdrive + Tunnel database integration. API secured with Cloudflare Access.

## Key Information

### Already Working ✅
- Cloudflare Tunnel running on Unraid server (Tower)
- PostgreSQL database fully populated with OpenLibrary data (54.8M editions, 49.3M ISBNs)
- Worker deployed at https://alexandria.ooheynerds.com with Hono framework
- Hyperdrive configured for connection pooling and performance
- Cloudflare Access securing API (IP-restricted to home network)
- SSH access configured (passwordless to root@Tower.local)
- DNS configured (alexandria-db.ooheynerds.com)
- Interactive dashboard with live stats and search functionality

### Project Structure
```
/Users/juju/dev_repos/alex/
├── worker/          # Cloudflare Worker code
├── tunnel/          # Tunnel configuration
├── docs/            # Full documentation
├── scripts/         # Deployment helpers
└── TODO.md          # Development roadmap
```

## For Claude Code Agents

### When Starting Work

1. **Read these files first:**
   - `README.md` - Project overview
   - `docs/SETUP.md` - Current infrastructure
   - `docs/CREDENTIALS.md` - All access information
   - `TODO.md` - Development roadmap

2. **Verify infrastructure:**
   ```bash
   ./scripts/tunnel-status.sh    # Check tunnel
   ./scripts/db-check.sh          # Check database
   ```

3. **Test current deployment:**
   ```bash
   curl https://alexandria.ooheynerds.com
   ```

### Available Resources

#### Local Development
```bash
cd /Users/juju/dev_repos/alex/worker
npm run dev     # Start local development server (requires Hyperdrive local connection string)
npm run deploy  # Deploy to Cloudflare
npm run tail    # View live Worker logs
```

#### Current Tech Stack
- **Framework**: Hono v4.10.7 (replaces itty-router for consistency)
- **Database**: postgres v3.4.7 client
- **Connection**: Hyperdrive (ID: 00ff424776f4415d95245c3c4c36e854)
- **Security**: Cloudflare Access with IP bypass (47.187.18.143/32)
- **Analytics**: Analytics Engine binding (ANALYTICS)

#### SSH Access to Server
```bash
ssh root@Tower.local    # Passwordless auth configured
```

#### Database Access
```bash
# Via SSH
ssh root@Tower.local "docker exec -it postgres psql -U openlibrary -d openlibrary"

# Connection details
Host: 192.168.1.240 (local) or alexandria-db.ooheynerds.com (tunnel)
Port: 5432
Database: openlibrary
User: openlibrary
Password: tommyboy
```

### Common Tasks

#### Deploy Worker Changes
```bash
cd worker/
npx wrangler deploy
```

#### Check Tunnel Status
```bash
ssh root@Tower.local "docker logs alexandria-tunnel --tail 20"
```

#### Test Database Query
```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT COUNT(*) FROM editions;'"
```

#### Restart Tunnel (if needed)
```bash
ssh root@Tower.local "docker restart alexandria-tunnel"
```

## Current API Endpoints

### Available Routes
- `GET /` - Interactive dashboard with live stats and search tester
- `GET /health` - System health check with Hyperdrive latency
- `GET /api/stats` - Database statistics (editions, ISBNs, works, authors)
- `GET /api/search?isbn=<isbn>` - Search by ISBN-10 or ISBN-13
- `GET /api/search?title=<title>` - Search by book title (partial match)
- `GET /api/search?author=<author>` - Search by author name (partial match)
- `GET /openapi.json` - OpenAPI 3.0 specification

### Example Queries
```bash
# Health check
curl https://alexandria.ooheynerds.com/health

# Search by ISBN
curl "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873"

# Search by title
curl "https://alexandria.ooheynerds.com/api/search?title=harry+potter&limit=5"

# Get database stats
curl https://alexandria.ooheynerds.com/api/stats
```

## Next Development Steps (Phase 3+)

### Potential Enhancements
- **Rate Limiting**: Add Cloudflare WAF rules or Hono middleware (currently secured by IP restriction)
- **Advanced Search**: Full-text search with pg_trgm indexes
- **Caching Optimization**: Replace Hono cache with native Cloudflare Cache API
- **Error Handling**: Sanitize error messages for production
- **Input Validation**: Add length limits and sanitization for title/author queries
- **Analytics Dashboard**: Use Analytics Engine binding to track usage
- **Service Tokens**: Add Cloudflare Access service tokens for worker-to-worker communication

See `TODO.md` for detailed roadmap.

## Important Notes

### Credentials Location
- **CRITICAL**: `docs/CREDENTIALS.md` contains all passwords and access info
- This file is in .gitignore - don't commit it!
- Passwords are also documented in this guide for convenience

### Tunnel Configuration
- Tunnel runs as Docker container on Unraid
- Config at: `/root/.cloudflared/config.yml` on Unraid
- Don't modify tunnel config without backing up first

### Database
- Database is MASSIVE (250GB+, 54M records)
- All data already imported - don't re-import!
- Database is optimized for queries - indexes in place

## Testing Checklist

Before deploying changes:

- [ ] Test locally with `wrangler dev`
- [ ] Verify tunnel is running (`./scripts/tunnel-status.sh`)
- [ ] Test database connection
- [ ] Check for errors in logs
- [ ] Test on staging first (if available)
- [ ] Verify SSL/HTTPS works
- [ ] Test error handling

## Troubleshooting

### Worker won't deploy
```bash
npx wrangler whoami  # Check auth
npx wrangler login   # Re-authenticate
```

### Can't connect to database
```bash
# Check tunnel
./scripts/tunnel-status.sh

# Check PostgreSQL
ssh root@Tower.local "docker ps | grep postgres"

# Restart if needed
ssh root@Tower.local "docker restart alexandria-tunnel postgres"
```

### Query too slow
- Check if indexes exist on queried columns
- Consider adding Hyperdrive for caching
- Optimize query (use EXPLAIN ANALYZE)

## Success Criteria

✅ **All Phase 2 objectives met:**
- ✅ https://alexandria.ooheynerds.com loads with interactive dashboard
- ✅ Can search by ISBN, title, and author with accurate results
- ✅ Results come from PostgreSQL via Hyperdrive
- ✅ Response time excellent (66-254ms for health checks, 238ms for searches)
- ✅ API secured with Cloudflare Access (IP-restricted)
- ✅ Worker uses Hono framework for consistency with other repos
- ✅ Connection pooling via Hyperdrive working correctly

## Getting Help

If stuck:
1. Check logs: `npx wrangler tail` (for Worker) or `docker logs alexandria-tunnel` (for tunnel)
2. Review documentation in `docs/` folder
3. Test database directly via SSH
4. Check Cloudflare dashboard for Worker errors

## Architecture Reminders

```
User → Cloudflare Edge → Worker → Tunnel → Unraid → PostgreSQL
```

- Worker runs at edge (globally distributed)
- Tunnel provides secure connection to home network
- PostgreSQL runs in Docker on Unraid server
- Future: Add Hyperdrive between Worker and Tunnel for performance

Good luck with development! 🚀
