# Alexandria

**Self-hosted OpenLibrary database (54M+ books) accessible globally via Cloudflare Workers**

Production API: `https://alexandria.ooheynerds.com`

## Overview

Alexandria exposes a complete PostgreSQL mirror of OpenLibrary through Cloudflare's edge network. The database runs on a home Unraid server and is accessible worldwide via Cloudflare Tunnel + Hyperdrive.

## Architecture

```
Internet → Cloudflare Edge (300+ locations)
    ↓
Worker (alexandria.ooheynerds.com) + Hono + Zod validation
    ↓
Hyperdrive (connection pooling + query caching)
    ↓
Cloudflare Access (mTLS auth)
    ↓
Tunnel (alexandria-db.ooheynerds.com)
    ↓
Unraid Server (192.168.1.240)
    ↓
PostgreSQL 18 (54.8M editions, SSL enabled)
    ↓
R2 Bucket (cover images)
```

## Features

✅ **Database Access** (Phase 2 Complete)
- Hyperdrive connection pooling
- ISBN, title, and author search
- 54.8M editions, 49.3M ISBNs, 40.1M works, 14.7M authors

✅ **Cover Processing** (Phase 2.5 Complete)
- R2 storage with multi-size variants
- Work-based and ISBN-based endpoints
- Multi-provider fetching (OpenLibrary, ISBNdb, Google Books)

✅ **Enrichment API** (Phase 2.6 Complete)
- Edition, work, and author metadata endpoints
- Quality scoring and conflict detection
- Background queue processing

✅ **TypeScript Integration** (v2.0.0)
- Exported types for external consumers
- Zod runtime validation
- OpenAPI 3.0 specification

## Quick Start

```bash
# Development
cd worker/
npm install
npm run dev              # Local dev server (localhost:8787)

# Deploy
npm run deploy           # Deploy to Cloudflare
npm run tail             # Live logs

# Infrastructure checks
./scripts/tunnel-status.sh  # Verify tunnel (expect 4 connections)
./scripts/db-check.sh        # Database health + sample query
```

## API Endpoints

**Search:**
- `GET /api/search?isbn={isbn}` - ISBN lookup
- `GET /api/search?title={title}` - Title search
- `GET /api/search?author={author}` - Author search
- `GET /api/stats` - Database statistics

**Covers:**
- `POST /api/covers/process` - Process cover from URL
- `GET /api/covers/:work_key/:size` - Serve cover (large/medium/small)
- `POST /covers/:isbn/process` - Legacy ISBN-based processing
- `GET /covers/:isbn/:size` - Legacy ISBN-based serving

**Enrichment:**
- `POST /api/enrich/edition` - Store edition metadata
- `POST /api/enrich/work` - Store work metadata
- `POST /api/enrich/author` - Store author metadata
- `POST /api/enrich/queue` - Queue background job
- `GET /api/enrich/status/:id` - Job status

**System:**
- `GET /health` - Health check
- `GET /openapi.json` - OpenAPI 3.0 spec

## TypeScript Integration

```bash
# Install package (when published)
npm install alexandria-worker
```

```typescript
import type {
  SearchQuery,
  SearchResult,
  BookResult,
  ENDPOINTS
} from 'alexandria-worker/types';

// Type-safe API client
const books = await fetch('https://alexandria.ooheynerds.com/api/search?isbn=9780439064873')
  .then(res => res.json()) as SearchResult;
```

See [worker/README-INTEGRATION.md](./worker/README-INTEGRATION.md) for full integration guide.

## Project Structure

```
alex/
├── worker/                    # Cloudflare Worker
│   ├── index.ts              # Main worker (Hono framework)
│   ├── types.ts              # Exported TypeScript types
│   ├── wrangler.jsonc        # Cloudflare configuration
│   └── README-INTEGRATION.md # Integration guide
├── scripts/                  # Infrastructure scripts
│   ├── deploy-worker.sh
│   ├── tunnel-status.sh
│   └── db-check.sh
├── docs/                     # Documentation
│   ├── CREDENTIALS.md        # Credentials (gitignored)
│   └── reference/            # Reference documentation
└── CLAUDE.md                 # Claude Code instructions
```

## Infrastructure

**Cloudflare Resources:**
- Domain: `ooheynerds.com`
- Worker: `alexandria.ooheynerds.com`
- Tunnel: `alexandria-db.ooheynerds.com` (ID: 848928ab-4ab9-4733-93b0-3e7967c60acb)
- Hyperdrive: Connection pooling + caching (ID: 00ff424776f4415d95245c3c4c36e854)
- R2 Bucket: `bookstrack-covers-processed`

**Home Server (Unraid):**
- Host: `Tower.local` (192.168.1.240)
- PostgreSQL: Port 5432, SSL enabled
- Database: `openlibrary` (250GB, 54M+ records)
- SSH: `root@Tower.local` (passwordless)

**Tunnel Configuration:**
- Uses **Zero Trust remotely-managed** token (not config file)
- Configured via Cloudflare dashboard
- Public hostname: `alexandria-db.ooheynerds.com` → `tcp://localhost:5432`
- Auto-restarts on failure

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Complete project guide for Claude Code
- [Integration Guide](./worker/README-INTEGRATION.md) - TypeScript API integration
- [TODO.md](./TODO.md) - Development roadmap

## Development Roadmap

**✅ Complete:**
- Phase 1: Infrastructure (Tunnel, Worker, DNS)
- Phase 2: Database Integration (Hyperdrive, Search)
- Phase 2.5: Cover Processing (R2, Multi-provider)
- Phase 2.6: Enrichment API (Metadata, Queue)

**🔜 Next:**
- Phase 3: Performance (pg_trgm, GIN indexes, caching)
- Phase 4: Advanced Search (Combined queries, pagination)
- Phase 5: Operations (CI/CD, monitoring, alerts)

See [TODO.md](./TODO.md) for details.

## License

MIT

## Links

- **Production API**: https://alexandria.ooheynerds.com
- **GitHub**: https://github.com/jukasdrj/alexandria
- **npm** (pending): `alexandria-worker`
