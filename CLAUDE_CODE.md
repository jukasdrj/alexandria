# Guide for Claude Code

This document helps Claude Code agents pick up development of the Alexandria project.

## Project Context

**Alexandria** is a Cloudflare Workers application providing global access to a self-hosted OpenLibrary PostgreSQL database (54M+ books) through a secure Cloudflare Tunnel.

**Current Status**: Phase 3 COMPLETE! ✅ Database migration deployed with enrichment tables. Alexandria is a pure book metadata enrichment hub (NOT user data/social/AI). Ready for bendv3 integration (Path 1).

## Key Information

### Already Working ✅
- Cloudflare Tunnel running on Unraid server (Tower)
- PostgreSQL database fully populated with OpenLibrary data (54.8M editions, 49.3M ISBNs)
- **NEW:** Enrichment tables deployed (enriched_works, enriched_editions, enriched_authors, enrichment_queue, enrichment_log)
- **NEW:** 19 performance indexes created (GIN trigram for fuzzy search, B-tree for FKs)
- **NEW:** Auto-update triggers on enriched tables
- Worker deployed at https://alexandria.ooheynerds.com with Hono framework
- Hyperdrive configured for connection pooling and performance (ID: 00ff424776f4415d95245c3c4c36e854)
- Cloudflare Access securing API (IP-restricted to home network)
- SSH access configured (passwordless to root@Tower.local)
- DNS configured (alexandria-db.ooheynerds.com)
- Interactive dashboard with live stats and search functionality

### Project Structure
```
/Users/juju/dev_repos/alex/
├── worker/                        # Cloudflare Worker code
├── tunnel/                        # Tunnel configuration
├── docs/                          # Full documentation
│   └── SESSION_2025-11-29_database_migration.md  # Latest session
├── migrations/                    # Database migrations
│   └── 001_add_enrichment_tables.sql  # DEPLOYED ✅
├── scripts/                       # Deployment helpers
├── PATH_1_IMPLEMENTATION.md       # bendv3 integration guide (NEXT STEP)
├── ALEXANDRIA_SCHEMA.md           # Complete database reference
└── TODO.md                        # Development roadmap
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

# Check enrichment tables
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c '\dt enriched*'"
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

## Alexandria Architecture Principles

### ✅ What Alexandria Stores (Book Metadata ONLY)
- Book works, editions, authors
- Cover images, descriptions, ISBNs
- External IDs (Goodreads, Amazon, LibraryThing, Google Books, ISBNdb)
- Multi-provider aggregation metadata
- Quality scores and enrichment tracking

### ❌ What Alexandria Does NOT Store
- User data (reading lists, progress, ratings, collections)
- Social features (friends, recommendations, activity feeds)
- AI/ML computation (recommendation engine, analytics)

**These live in:**
- **bendv3** (Cloudflare Workers): User data (D1/KV), AI/ML (Workers AI), orchestration
- **books-v3** (iOS app): Local user data (SwiftData), UI/UX

## Next Development Steps (Phase 4)

### IMMEDIATE: Path 1 Implementation (2-3 hours)
**Goal:** Make Alexandria the primary book data provider in bendv3

**Follow:** `PATH_1_IMPLEMENTATION.md` for step-by-step guide

**Steps:**
1. Create Alexandria API service in bendv3 (✅ normalizer already exists)
2. Add to circuit breaker (15 min)
3. Update provider enum (5 min)
4. Make Alexandria primary provider (30 min)
5. Test and verify (15 min)

**Expected Results:**
- 80%+ ISBN lookups served by Alexandria
- <30ms p95 latency for Alexandria hits
- Fallback to Google Books for missing books
- 90%+ cost savings ($5/month vs $50-200/month)

### Future Enhancements (Phase 5+)
- **Write Endpoints**: POST /api/enrich/work, /api/enrich/edition
- **Background Enrichment**: Process enrichment_queue
- **ISBNdb Integration**: High-quality metadata enrichment
- **User Corrections**: Moderation workflow for user-submitted fixes
- **Materialized Views**: Analytics and reporting
- **Advanced Search**: Multi-field fuzzy search
- **Bulk Import**: Automated OpenLibrary dump updates

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

✅ **All Phase 3 objectives met:**
- ✅ https://alexandria.ooheynerds.com loads with interactive dashboard
- ✅ Can search by ISBN, title, and author with accurate results
- ✅ Results come from PostgreSQL via Hyperdrive
- ✅ Response time excellent (66-254ms for health checks, 238ms for searches)
- ✅ API secured with Cloudflare Access (IP-restricted)
- ✅ Worker uses Hono framework for consistency with other repos
- ✅ Connection pooling via Hyperdrive working correctly
- ✅ Enrichment tables deployed with 6 tables, 19 indexes, 3 triggers
- ✅ Database migration tested and verified
- ✅ Architecture clarified (book metadata only, no user data)
- ✅ Complete documentation created (schema, implementation guide, session notes)

⏳ **Phase 4 objectives (NEXT):**
- [ ] Alexandria integrated as primary provider in bendv3
- [ ] 80%+ ISBN lookups served by Alexandria
- [ ] <30ms p95 latency for Alexandria hits
- [ ] Cost savings verified (90%+ reduction)
- [ ] Fallback to Google Books working correctly

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
