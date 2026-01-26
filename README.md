# Alexandria

**Self-hosted OpenLibrary database (54M+ books) accessible globally via Cloudflare Workers**

[![Production](https://img.shields.io/badge/Production-Live-success)](https://alexandria.ooheynerds.com)
[![Database](https://img.shields.io/badge/Books-54.8M-blue)](https://alexandria.ooheynerds.com/api/stats)
[![ISBNdb](https://img.shields.io/badge/ISBNdb-Premium-orange)](https://isbndb.com)

**Production API:** `https://alexandria.ooheynerds.com`
**Dashboard:** https://alexandria.ooheynerds.com/
**OpenAPI Spec:** https://alexandria.ooheynerds.com/openapi.json

**Related:** [OOOE Homelab](https://github.com/jukasdrj/oooe-homelab) - Infrastructure docs (Tower/Unraid, Home Assistant, Docker services)

---

## 🎯 Current Status

**Production:** Phase 1-5 Complete ✅ | Combined search live | 54.8M books indexed

**Quick Links:**
- **[Developer Guide](./CLAUDE.md)** - Essential reference for development
- **[Full Documentation](./docs/INDEX.md)** - Complete docs index
- **[Roadmap](./TODO.md)** - Future work
- **[Issues](./docs/CURRENT-STATUS.md)** - Current priorities

---

## 📚 What is Alexandria?

Alexandria exposes a complete **PostgreSQL mirror of OpenLibrary** (54M+ books) through Cloudflare's global edge network. The database runs on a home Unraid server and is accessible worldwide via Cloudflare Tunnel + Hyperdrive.

**Key Features:**
- 🔍 **Smart Search** - Combined endpoint with auto-detection (ISBN/author/title)
- ⚡ **Type-Specific Caching** - KV caching (ISBN: 24h, Author/Title: 1h)
- 🖼️ **Cover Processing** - Multi-provider (OpenLibrary, ISBNdb, Google Books)
- 📊 **Enrichment Pipeline** - ISBNdb Premium integration with quota management
- 🌐 **Global Edge** - Cloudflare's 300+ locations
- 🔐 **3-Layer Security** - WAF, rate limiting, authentication
- 📖 **54.8M Books** - OpenLibrary complete dataset + enriched metadata

---

## 🏗️ Architecture

```
Internet → Cloudflare Edge (300+ locations)
    ↓
[3-Layer Security]
  1. Cloudflare WAF + Bot Fight Mode + DDoS
  2. Worker Rate Limiting + Input Validation
  3. Service Token Auth + Parameterized Queries
    ↓
Worker (alexandria.ooheynerds.com)
  - Hono + @hono/zod-openapi
  - TypeScript with full type safety
  - Workers Paid Plan (300s CPU, smart placement)
    ↓
Hyperdrive (connection pooling + caching)
    ↓
Cloudflare Tunnel (mTLS, alexandria-db.ooheynerds.com)
    ↓
Unraid Server (192.168.1.240)
    ↓
PostgreSQL 18 (54.8M editions, SSL enabled)
    ↓
R2 Bucket (bookstrack-covers-processed)
    ↓
Cloudflare Queues
  - alexandria-enrichment-queue (10/batch, 1 concurrency)
  - alexandria-cover-queue (5/batch, 3 concurrency)
  - alexandria-backfill-queue (1/batch, 1 concurrency)
  - alexandria-author-queue (10/batch, 1 concurrency) [NEW]
```

**Data Sources:**
- **OpenLibrary** - Base dataset (54.8M editions, 49.3M ISBNs, 40.1M works, 14.7M authors)
- **ISBNdb Premium** - Paid enrichment (3 req/sec, 1000 ISBN batches, 15K daily quota)
- **Google Books** - Free metadata fallback
- **Archive.org** - Free pre-2000 book covers (NEW - Jan 2026)
- **Wikipedia** - Free author biographies with Wikidata ID lookup (NEW - Jan 2026)
- **Wikidata** - Free structured book/author metadata via SPARQL (NEW - Jan 2026)

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Wrangler CLI (`npm install -g wrangler`)
- Access to Cloudflare account (for deployment)

### Local Development

```bash
# Clone repository
git clone https://github.com/yourusername/alexandria.git
cd alexandria

# Install dependencies
cd worker/
npm install

# Start local dev server
npm run dev              # → http://localhost:8787

# Run tests
npm test                 # Vitest suite (53 tests)

# Deploy to Cloudflare
npm run deploy

# Monitor logs
npm run tail

# Query Gemini synthetic books (backfill results)
./scripts/query-gemini-books.sh
```

### Querying Data

**Gemini Backfill Books**: The backfill system generates synthetic book records from AI even when ISBNdb quota is exhausted:

```bash
# See all Gemini-generated books
./scripts/query-gemini-books.sh

# Or query directly via psql
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c \"
SELECT
  (metadata#>>'{}')::jsonb->>'gemini_source' as source,
  title,
  (metadata#>>'{}')::jsonb->>'gemini_author' as author
FROM enriched_works
WHERE synthetic = true AND primary_provider = 'gemini-backfill'
ORDER BY source, title;
\""
```

**Note**: Metadata is stored as stringified JSON inside JSONB. Use `(metadata#>>'{}')::jsonb` to parse.

### Infrastructure

Alexandria runs on Tower (Unraid server) with PostgreSQL + Cloudflare Tunnel. For homelab infrastructure documentation (Docker services, Home Assistant, VPN setup, etc.), see the [OOOE Homelab](https://github.com/jukasdrj/oooe-homelab) repository.

```bash
# Verify tunnel (expect 4 connections)
./scripts/tunnel-status.sh

# Database health + sample query
./scripts/db-check.sh

# Deploy with validation
./scripts/deploy-worker.sh
```

---

## 📖 API Endpoints

### Search & Stats
- **`GET /api/search/combined?q={query}`** - 🆕 **Combined search with auto-detection** (RECOMMENDED)
- **`GET /api/search?isbn={isbn}`** - ISBN lookup with Smart Resolution
- **`GET /api/search?title={title}`** - Title search (ILIKE fuzzy)
- **`GET /api/search?author={author}`** - Author search (ILIKE fuzzy)
- **`GET /api/stats`** - Database statistics
- **`GET /health`** - Health check with DB latency

### Cover Processing (ISBN-based)
- **`POST /api/covers/process`** - Process cover from provider URL
- **`GET /covers/:isbn/:size`** - Serve cover (large/medium/small)
- **`GET /covers/:isbn/status`** - Check cover availability
- **`POST /covers/:isbn/process`** - Trigger cover processing
- **`POST /covers/batch`** - Batch processing (max 10)
- **`POST /api/covers/queue`** - Queue background processing (max 100)

### Enrichment
- **`POST /api/enrich/edition`** - Store edition metadata
- **`POST /api/enrich/work`** - Store work metadata
- **`POST /api/enrich/author`** - Store author metadata
- **`POST /api/enrich/queue`** - Queue enrichment (max 100)
- **`POST /api/enrich/batch-direct`** - Direct batch (up to 1000 ISBNs)
- **`GET /api/enrich/status/:id`** - Check enrichment status

### Author Operations
- **`GET /api/authors/top`** - Top authors by edition count
- **`GET /api/authors/:key`** - Get author details
- **`POST /api/authors/bibliography`** - Get ISBNdb bibliography
- **`POST /api/authors/enrich-bibliography`** - Fetch + enrich in one call
- **`POST /api/authors/enrich-wikidata`** - Enrich with Wikidata
- **`POST /api/authors/resolve-identifier`** - Resolve VIAF/ISNI to Wikidata

### External ID Resolution
- **`GET /api/external-ids/{entity_type}/{key}`** - Get external IDs (ASIN, Goodreads, etc.) from internal key
- **`GET /api/resolve/{provider}/{id}`** - Resolve external ID to internal key

### Recommendations
- **`GET /api/recommendations/subjects`** - Get subjects/categories for a book
- **`GET /api/recommendations/similar`** - Find similar books by subject

### Books & New Releases
- **`POST /api/books/search`** - Search ISBNdb by date/title/author
- **`POST /api/books/enrich-new-releases`** - Enrich by date range
- **`POST /api/harvest/backfill`** - Trigger historical backfill pipeline

### Quota Management
- **`GET /api/quota/status`** - ISBNdb quota usage and remaining

### System
- **`GET /openapi.json`** - OpenAPI 3.0 specification
- **`GET /`** - Interactive dashboard

**Full API documentation:** [docs/api/API-SEARCH-ENDPOINTS.md](./docs/api/API-SEARCH-ENDPOINTS.md)

---

## 💻 Quick Start

### API Examples

```bash
# Combined search (auto-detects ISBN/author/title)
curl "https://alexandria.ooheynerds.com/api/search/combined?q=harry%20potter" | jq

# Get cover image
curl "https://alexandria.ooheynerds.com/covers/9780439064873/large" -o cover.webp

# Check quota
curl "https://alexandria.ooheynerds.com/api/quota/status" | jq
```

### Type-Safe Clients

```bash
# TypeScript
npx openapi-typescript https://alexandria.ooheynerds.com/openapi.json -o types.ts

# Python
datamodel-codegen --url https://alexandria.ooheynerds.com/openapi.json -o models.py
```

**Full examples:** [docs/api/API-SEARCH-ENDPOINTS.md](./docs/api/API-SEARCH-ENDPOINTS.md)

---

## 📁 Project Structure

```
alexandria/
├── worker/                    # Cloudflare Worker (TypeScript)
│   ├── src/
│   │   ├── index.ts           # Main worker + Hono routes
│   │   ├── env.ts             # Environment type definitions
│   │   ├── routes/            # API route handlers (zod-openapi)
│   │   ├── schemas/           # Zod validation schemas
│   │   └── services/          # Business logic
│   ├── services/              # External API services
│   ├── lib/                   # Utilities (logger, cache, ISBN)
│   ├── wrangler.jsonc         # Cloudflare configuration
│   └── package.json           # v2.8.0
├── scripts/                   # Deployment & harvesting scripts
│   ├── bulk-author-harvest.js
│   ├── expand-author-bibliographies.js
│   └── lib/                   # Script utilities
├── migrations/                # Database migrations (003 deployed)
├── docs/                      # Documentation (organized)
│   ├── INDEX.md               # Documentation index
│   ├── CURRENT-STATUS.md      # Active issues (P1/P2/P3)
│   ├── api/                   # API documentation
│   ├── security/              # Security architecture
│   ├── operations/            # Operations guides
│   ├── harvesting/            # Harvesting docs
│   ├── infrastructure/        # Infrastructure setup
│   └── archive/               # Outdated docs
├── data/                      # Runtime data (checkpoints)
├── CLAUDE.md                  # Developer guide (42KB)
├── TODO.md                    # Development roadmap
├── CHANGELOG.md               # Version history
└── README.md                  # This file
```

---

## 🔐 Security

**3-Layer Defense Model:**

1. **Cloudflare Edge** (FREE tier)
   - WAF: Cloudflare Free Managed Ruleset
   - Bot Fight Mode: Active
   - DDoS Protection: Automatic

2. **Worker Application** (ACTIVE)
   - Rate Limiting: 100 req/min per IP (API), 60 req/min (search), 30 req/min (writes)
   - Input Validation: Zod schemas on all endpoints
   - Security Headers: HSTS, X-Frame-Options, X-Content-Type-Options

3. **Database Layer**
   - Service Token: Hyperdrive → Tunnel authentication
   - Parameterized Queries: SQL injection protection
   - Read-Only Access: No destructive operations

**Full security documentation:** [docs/security/SECURITY-FINAL-SUMMARY.md](./docs/security/SECURITY-FINAL-SUMMARY.md)

---

## 📊 Infrastructure

### Cloudflare Resources
- **Domain:** `ooheynerds.com`
- **Worker:** `alexandria.ooheynerds.com` (Workers Paid Plan)
- **Tunnel:** `alexandria-db.ooheynerds.com` (ID: 848928ab-4ab9-4733-93b0-3e7967c60acb)
- **Hyperdrive:** ID: 00ff424776f4415d95245c3c4c36e854
- **R2 Bucket:** `bookstrack-covers-processed`
- **Queues:** `alexandria-enrichment-queue`, `alexandria-cover-queue`, `alexandria-backfill-queue`, `alexandria-author-queue`

### Home Server (Unraid)
- **Host:** `Tower.local` (192.168.1.240)
- **PostgreSQL:** Port 5432, SSL enabled, v18
- **Database:** `openlibrary` (250GB, 54M+ records)
- **SSH:** `root@Tower.local` (passwordless, ed25519 key)
- **Auto-start:** Both `postgres` and `alexandria-tunnel` containers

### Database Schema
- **editions:** 54.8M rows (core OpenLibrary data)
- **works:** 40.1M rows
- **authors:** 14.7M rows
- **edition_isbns:** 49.3M rows (indexed for fast ISBN lookups)
- **enriched_editions:** 28.6M rows (Alexandria-enriched metadata)
- **enriched_works:** 21.3M rows
- **enriched_authors:** 8.2M rows (with Wikidata diversity data)

**Full schema documentation:** [CLAUDE.md](./CLAUDE.md) (Database Schema section)

---

## 📚 Documentation

### Essential Reading
- **[README.md](./README.md)** (this file) - Project overview
- **[CLAUDE.md](./CLAUDE.md)** - Complete developer guide (42KB, authoritative)
- **[docs/CURRENT-STATUS.md](./docs/CURRENT-STATUS.md)** - Active issues & priorities
- **[docs/INDEX.md](./docs/INDEX.md)** - Full documentation index
- **[TODO.md](./TODO.md)** - Development roadmap

### By Topic
- **API:** [docs/api/](./docs/api/)
- **Security:** [docs/security/](./docs/security/)
- **Operations:** [docs/operations/](./docs/operations/)
- **Harvesting:** [docs/harvesting/](./docs/harvesting/)
- **Infrastructure:** [docs/infrastructure/](./docs/infrastructure/)

### Quick Commands Reference
```bash
# Development
cd worker/ && npm run dev        # Local dev
npm run deploy                    # Deploy to Cloudflare
npm run tail                      # Live Worker logs
npm run test     # Run vitest tests
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
```

### Monitoring
```bash
# Real-time logs
npm run tail

# ISBNdb quota
curl https://alexandria.ooheynerds.com/api/quota/status | jq

# Database stats
curl https://alexandria.ooheynerds.com/api/stats | jq

# Queue status
npx wrangler queues list | grep alexandria
```

---

## 🗺️ Roadmap

**Production (Complete):** Infrastructure, enrichment pipeline, search optimization, combined search endpoint

**Current Work:**
- Author metadata expansion (bulk harvesting automation)
- Search analytics tracking
- Export results (CSV/JSON)

**Future:**
- Semantic search with embeddings
- CI/CD pipeline automation
- Wikipedia + LLM fallback enrichment

**Full roadmap:** [TODO.md](./TODO.md) | **Issues:** [CURRENT-STATUS.md](./docs/CURRENT-STATUS.md)

---

## 🤝 Contributing

Alexandria is a personal project, but contributions are welcome:

1. Check [docs/CURRENT-STATUS.md](./docs/CURRENT-STATUS.md) for open issues
2. Review [CLAUDE.md](./CLAUDE.md) for development guidelines
3. Follow existing code patterns (Hono + Zod + TypeScript)
4. Add tests for new features
5. Update documentation

---

## 📄 License

MIT

---

## 🔗 Links

- **Production API:** https://alexandria.ooheynerds.com
- **Dashboard:** https://alexandria.ooheynerds.com/
- **OpenAPI Spec:** https://alexandria.ooheynerds.com/openapi.json
- **Documentation:** [docs/INDEX.md](./docs/INDEX.md)
- **Issues:** [docs/CURRENT-STATUS.md](./docs/CURRENT-STATUS.md)
- **GitHub:** https://github.com/jukasdrj/alexandria

---

**Last Updated:** January 16, 2026
**Version:** 2.8.0
**Database:** 54.8M editions | 49.3M ISBNs | 40.1M works | 14.7M authors
