# Alexandria Architecture

Technical architecture documentation for the Alexandria project.

## System Overview

Alexandria is a serverless application that provides global access to a self-hosted OpenLibrary database through Cloudflare's edge network.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Internet Users                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Global Network                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Worker: alexandria.ooheynerds.com                   │  │
│  │  - Handles HTTP requests                             │  │
│  │  - Future: Query database via Hyperdrive             │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Hyperdrive (Future)                                 │  │
│  │  - Connection pooling                                │  │
│  │  - Query caching at edge                             │  │
│  │  - Smart routing                                     │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Cloudflare Tunnel: alexandria-db.ooheynerds.com     │  │
│  │  - Secure outbound connection                        │  │
│  │  - No inbound ports needed                           │  │
│  └──────────────────┬───────────────────────────────────┘  │
└────────────────────┬┴──────────────────────────────────────┘
                     │
                     │ Encrypted Tunnel
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│            Home Network (192.168.1.0/24)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Unraid Server "Tower" (192.168.1.240)               │  │
│  │                                                       │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │  Docker: alexandria-tunnel                     │  │  │
│  │  │  - cloudflared daemon                          │  │  │
│  │  │  - 4 persistent connections to Cloudflare     │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  │                     │                                 │  │
│  │                     ▼                                 │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │  Docker: postgres                              │  │  │
│  │  │  - PostgreSQL 15                               │  │  │
│  │  │  - Port 5432                                   │  │  │
│  │  │  - 54.8M editions, 40.1M works, 14.7M authors │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Current (Phase 1 - Static Content)
1. User requests https://alexandria.ooheynerds.com
2. Cloudflare routes to Worker
3. Worker returns static HTML
4. Response served from edge

### Future (Phase 2 - Live Queries)
1. User searches for ISBN on alexandria.ooheynerds.com
2. Worker receives request at Cloudflare edge
3. Worker connects via Hyperdrive
4. Hyperdrive routes through Cloudflare Tunnel
5. Tunnel forwards to PostgreSQL on Unraid
6. Query results flow back through tunnel
7. Hyperdrive caches result at edge
8. Worker returns formatted response
9. Subsequent identical queries served from cache

## Components

### Cloudflare Worker
- **Runtime**: V8 isolate
- **Location**: Globally distributed
- **Cold start**: <1ms
- **Language**: JavaScript/ES6
- **Current**: Static HTML only
- **Future**: PostgreSQL queries via Hyperdrive

### Cloudflare Tunnel
- **Type**: Remotely managed
- **Protocol**: QUIC
- **Connections**: 4 persistent (for redundancy)
- **Direction**: Outbound only (from home network)
- **Security**: mTLS encrypted
- **DNS**: alexandria-db.ooheynerds.com

### Hyperdrive (Planned)
- **Purpose**: Connection pooling & caching
- **Benefits**:
  - Reduces connection overhead
  - Caches query results at edge
  - Handles concurrent requests efficiently
  - Smart query routing
- **Configuration**: Will use Cloudflare Access for auth

### PostgreSQL Database
- **Version**: 15
- **Size**: ~250GB
- **Records**: 54.8M editions
- **Container**: Docker on Unraid
- **Performance**: Optimized settings
  - shared_buffers: 2GB
  - work_mem: 256MB
  - maintenance_work_mem: 1GB

## Security Model

### Current
- ✅ Tunnel uses mTLS encryption
- ✅ No inbound firewall ports required
- ✅ Outbound-only connection model
- ✅ SSH key-based authentication to Unraid

### Future with Hyperdrive
- ✅ Cloudflare Access service tokens
- ✅ Fine-grained access control
- ✅ Connection from specific Workers only
- ✅ Audit logging

## Performance Characteristics

### Without Hyperdrive (Direct Tunnel)
- **Latency**: 50-200ms per query (internet round-trip)
- **Connections**: New connection per request
- **Scaling**: Limited by PostgreSQL max_connections
- **Caching**: None

### With Hyperdrive (Planned)
- **First query**: 50-200ms (internet round-trip)
- **Cached queries**: <10ms (served from edge)
- **Connections**: Pooled and reused
- **Scaling**: Handles thousands of concurrent users
- **Caching**: Automatic at Cloudflare edge

## Database Schema

### Main Tables
- **authors**: Author information (14.7M rows)
- **works**: Book works (40.1M rows)
- **editions**: Book editions (54.8M rows)
- **edition_isbns**: ISBN mappings (49.3M rows)
- **author_works**: Author-work relationships (42.8M rows)

### Query Patterns
```sql
-- Find book by ISBN
SELECT e.data->>'title', a.data->>'name'
FROM editions e
JOIN edition_isbns ei ON ei.edition_key = e.key
JOIN works w ON w.key = e.work_key
JOIN author_works aw ON aw.work_key = w.key
JOIN authors a ON aw.author_key = a.key
WHERE ei.isbn = '9780439064873';
```

## Scaling Considerations

### Current Limits
- Database: Single PostgreSQL instance
- Network: Home internet upload (typically 10-40 Mbps)
- Storage: Unraid server capacity

### Future Optimizations
- Read replicas for heavy query load
- Query result caching via Hyperdrive
- Database indexes for common queries
- Consider D1 replication for ultra-fast reads

## Monitoring & Observability

### Available Now
- Tunnel connection status via Docker logs
- Worker analytics in Cloudflare dashboard
- Database query logs in PostgreSQL

### Future
- Hyperdrive performance metrics
- Query latency tracking
- Error rate monitoring
- Cache hit/miss ratios
