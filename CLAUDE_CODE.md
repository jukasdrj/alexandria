# Guide for Claude Code

This document helps Claude Code agents pick up development of the Alexandria project.

## Project Context

**Alexandria** is a Cloudflare Workers application providing global access to a self-hosted OpenLibrary PostgreSQL database (54M+ books) through a secure Cloudflare Tunnel.

**Current Status**: Infrastructure complete, hello world deployed, ready for database integration.

## Key Information

### Already Working ✅
- Cloudflare Tunnel running on Unraid server (Tower)
- PostgreSQL database fully populated with OpenLibrary data
- Worker deployed at https://alexandria.ooheynerds.com
- SSH access configured (passwordless to root@Tower.local)
- DNS configured (alexandria-db.ooheynerds.com)

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
npm run dev     # Start local development server
npm run deploy  # Deploy to Cloudflare
```

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

## Next Development Steps

### Priority 1: Add Database Queries to Worker

The worker currently serves static HTML. Next steps:

1. **Add PostgreSQL driver**
   ```bash
   cd worker/
   npm install postgres
   ```

2. **Update wrangler.toml** with secrets:
   ```toml
   # Add to wrangler.toml
   [vars]
   DATABASE_HOST = "alexandria-db.ooheynerds.com"
   DATABASE_NAME = "openlibrary"
   DATABASE_USER = "openlibrary"
   
   # Set secret via CLI
   npx wrangler secret put DATABASE_PASSWORD
   # Enter: tommyboy
   ```

3. **Update index.js** to handle queries:
   - Add postgres import
   - Create connection helper
   - Add ISBN search endpoint
   - Return JSON results

### Example Query to Implement

```javascript
// Search by ISBN
const result = await db.query(`
  SELECT 
    e.data->>'title' AS title,
    a.data->>'name' AS author,
    ei.isbn
  FROM editions e
  JOIN edition_isbns ei ON ei.edition_key = e.key
  JOIN works w ON w.key = e.work_key
  JOIN author_works aw ON aw.work_key = w.key
  JOIN authors a ON aw.author_key = a.key
  WHERE ei.isbn = $1
  LIMIT 1
`, [isbn]);
```

### Priority 2: Consider Hyperdrive

For production-ready performance:
- Connection pooling
- Edge caching
- Better handling of concurrent requests

See `docs/ARCHITECTURE.md` for Hyperdrive setup details.

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

You'll know it's working when:
- ✅ https://alexandria.ooheynerds.com loads
- ✅ Can search by ISBN and get results
- ✅ Results are accurate from PostgreSQL
- ✅ Response time is reasonable (<2 seconds)

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
