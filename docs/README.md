# Alexandria Documentation

This directory contains all documentation for the Alexandria project.

## Structure

```
docs/
├── README.md                    # This file
├── CREDENTIALS.md               # Credentials (gitignored)
├── API-SEARCH-ENDPOINTS.md      # Search API documentation
├── CLOUDFLARE-API-VS-WRANGLER.md # Cloudflare management reference
├── ISBNDB-ENDPOINTS.md          # ISBNdb API documentation
├── ISBNDB-ENRICHMENT.md         # ISBNdb enrichment opportunities
└── reference/                   # Reference documentation
    ├── TUNNEL.md               # Cloudflare Tunnel configuration
    ├── tunnel-config.example.yml  # Example config file
    └── ENRICHMENT_ARCHITECTURE.md # Enrichment pipeline design
```

## Quick Links

### Getting Started
- [Main README](../README.md) - Project overview and quick start
- [CLAUDE.md](../CLAUDE.md) - Complete guide for Claude Code
- [TODO.md](../TODO.md) - Development roadmap

### API Documentation
- [Search Endpoints](./api/API-SEARCH-ENDPOINTS.md) - Complete search API documentation
- [Integration Guide](../worker/README-INTEGRATION.md) - TypeScript API integration
- [OpenAPI Spec](https://alexandria.ooheynerds.com/openapi.json) - Live API specification
- [ISBNdb Endpoints](./api/ISBNDB-ENDPOINTS.md) - ISBNdb API v2 reference
- [ISBNdb Enrichment](./api/ISBNDB-ENRICHMENT.md) - ISBNdb data enrichment guide
- [Cloudflare API vs Wrangler](./infrastructure/CLOUDFLARE-API-VS-WRANGLER.md) - Infrastructure management reference

### Reference
- [Tunnel Configuration](./reference/TUNNEL.md) - How the Cloudflare Tunnel works
- [Enrichment Architecture](./reference/ENRICHMENT_ARCHITECTURE.md) - Data enrichment design

### Infrastructure
- **Credentials**: See `CREDENTIALS.md` (gitignored, contains all passwords)
- **Scripts**: See `../scripts/` for deployment and health check scripts

## For Developers

### Local Development
```bash
cd worker/
npm install
npm run dev
```

### Deployment
```bash
npm run deploy
```

### Health Checks
```bash
./scripts/tunnel-status.sh  # Check tunnel (4 connections expected)
./scripts/db-check.sh        # Database health + sample query
```

## Architecture Overview

```
Internet → Cloudflare Edge → Worker (Hono + Zod)
    ↓
Hyperdrive (pooling + caching)
    ↓
Cloudflare Access (mTLS)
    ↓
Tunnel (alexandria-db.ooheynerds.com)
    ↓
Unraid Server → PostgreSQL (54.8M editions)
    ↓
R2 Bucket (cover images)
```

## Key Resources

- **Production API**: https://alexandria.ooheynerds.com
- **GitHub**: https://github.com/jukasdrj/alexandria
- **Issues**: https://github.com/jukasdrj/alexandria/issues
- **Database**: 54.8M editions, 49.3M ISBNs, 40.1M works, 14.7M authors

## Contributing

See the main README and TODO.md for current development priorities.
