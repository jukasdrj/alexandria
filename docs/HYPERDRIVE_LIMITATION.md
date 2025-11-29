# Hyperdrive Limitation with Cloudflare Tunnel

## Critical Discovery

**Hyperdrive CANNOT be used with Cloudflare Tunnel for PostgreSQL connections.**

## Why This Doesn't Work

1. **Cloudflare Tunnel Architecture**:
   - Tunnel is designed for HTTP/HTTPS traffic proxying
   - It wraps TCP connections in HTTP/2 or QUIC tunnels
   - The tunnel endpoint (`alexandria-db.oooefam.net`) expects HTTP requests, not raw PostgreSQL protocol

2. **Hyperdrive Requirements**:
   - Hyperdrive needs direct TCP access to PostgreSQL (port 5432)
   - It establishes native PostgreSQL wire protocol connections
   - It cannot communicate through HTTP-wrapped tunnel endpoints

3. **Error Observed**:
   ```
   Network connection to the provided database was refused.
   Please check that host and port are correct and that the database
   allows connections from public IP addresses. [code: 2011]
   ```

## Architectural Implications

Your current setup:
```
Worker → Hyperdrive → ??? → Tunnel → PostgreSQL
                      ^
                      Cannot establish direct TCP connection
```

What Hyperdrive needs:
```
Worker → Hyperdrive → Direct TCP → PostgreSQL (public IP or private network)
```

## Solutions

### Option 1: Direct Connection from Worker (Recommended for Your Setup)

**This is the correct approach for your architecture.**

Use the `postgres` library directly in your Worker to connect through the tunnel:

```
Worker → HTTP over Tunnel → PostgreSQL
```

**Pros**:
- Works with your existing tunnel infrastructure
- No firewall changes needed
- Secure (mTLS via tunnel)
- Simple to implement

**Cons**:
- No connection pooling (each request creates new connection)
- Slightly higher latency (~100-200ms extra)
- Not optimal for very high traffic

**When to use**: Your current setup with home server + tunnel.

---

### Option 2: Cloudflare Tunnel WARP Connector (Not for PostgreSQL)

Cloudflare WARP Connector can create private network tunnels, but it's designed for internal application traffic, not database connections.

**Not applicable for this use case.**

---

### Option 3: Expose PostgreSQL Publicly (NOT RECOMMENDED)

You could expose PostgreSQL directly to the internet and use Hyperdrive:

```
Worker → Hyperdrive → Public IP → PostgreSQL (port 5432)
```

**Requirements**:
- Open port 5432 on your router
- Configure PostgreSQL to accept public connections
- Use strong authentication and SSL/TLS
- Implement IP allowlisting

**Pros**:
- Can use Hyperdrive connection pooling
- Better performance under heavy load

**Cons**:
- SECURITY RISK - exposing database to internet
- Requires firewall configuration
- More attack surface
- Not recommended for home servers

**DO NOT USE THIS unless you have enterprise security requirements.**

---

### Option 4: Move Database to Cloudflare-Compatible Provider

Migrate database to a provider that Hyperdrive supports directly:

**Supported providers**:
- Neon (serverless Postgres)
- Supabase
- AWS RDS
- Google Cloud SQL
- Azure Database
- Any PostgreSQL with public TCP access

**Pros**:
- Full Hyperdrive benefits (pooling, caching, retries)
- Better performance and scalability
- Managed backups and HA

**Cons**:
- Monthly cost ($10-50+ depending on size)
- Your database is 250GB - migration would be expensive
- Loses "self-hosted" benefit
- Ongoing operational costs

**When to use**: If you need to scale beyond home server capacity.

---

## Recommended Approach for Alexandria

### Use Direct Connection (Option 1)

This is the pragmatic solution for your architecture:

1. **Keep your current infrastructure**:
   - PostgreSQL on Unraid (local network)
   - Cloudflare Tunnel (secure access)
   - Worker connects via tunnel

2. **Optimize the connection**:
   - Use `postgres` library with connection settings optimized for Workers
   - Implement query result caching (Workers KV or Cache API)
   - Keep queries simple and indexed
   - Add connection timeout handling

3. **Performance considerations**:
   - Your database is read-only (no write conflicts)
   - Queries use indexed columns (`edition_isbns` table)
   - Limited concurrent users expected
   - Connection overhead acceptable for this use case

### Implementation

See `/Users/juju/dev_repos/alex/docs/PHASE2_SETUP.md` - **Option B (Direct Connection)**.

This gives you:
- Working solution TODAY
- No infrastructure changes
- Secure (tunnel + mTLS)
- Cost-effective (free, using your hardware)
- Adequate performance for read-only queries

### Performance Optimization Without Hyperdrive

1. **Query Optimization**:
   - Always use `edition_isbns` table (indexed)
   - Limit result sets (LIMIT 10)
   - Avoid complex joins when possible
   - Use JSONB operators efficiently

2. **Caching Layer**:
   - Cache frequent ISBN lookups in Workers KV
   - TTL: 24-48 hours (data rarely changes)
   - Reduces database connections by 80-90%

3. **Connection Settings**:
   ```javascript
   const sql = postgres({
     host: env.DATABASE_HOST,
     port: 5432,
     database: env.DATABASE_NAME,
     username: env.DATABASE_USER,
     password: env.DATABASE_PASSWORD,
     ssl: false,
     connect_timeout: 10,      // Fast timeout
     idle_timeout: 2,          // Close idle quickly
     max_lifetime: 30,         // Recycle connections
     max: 1                    // Single connection per request
   });
   ```

4. **Request Optimization**:
   - Validate input before querying
   - Return early for invalid requests
   - Close connections explicitly
   - Handle errors gracefully

### Expected Performance

With direct connection + optimizations:
- **First request**: 200-400ms (cold start + DB query)
- **Cached requests**: 10-50ms (Workers KV)
- **Uncached requests**: 150-300ms (tunnel + query)

This is acceptable for:
- Personal projects
- Low-traffic APIs (< 1000 req/min)
- Read-only data lookups
- MVP and prototyping

---

## When to Reconsider

Migrate to Hyperdrive + managed database IF:
1. Traffic exceeds 10,000 requests/day consistently
2. You need < 100ms response times
3. You want to scale globally
4. You're willing to pay $20-50/month
5. You need high availability guarantees

For now, **stick with direct connection**. It's the right architecture for your needs.

---

## Updated Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Internet Users                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTPS
                     ▼
        ┌────────────────────────────┐
        │  Cloudflare Workers        │
        │  (alexandria.ooheynerds    │
        │   .com)                    │
        │                            │
        │  - Validates ISBN          │
        │  - Checks KV cache         │
        │  - Queries database        │
        │  - Returns JSON            │
        └────────────┬───────────────┘
                     │
                     │ postgres://
                     │ (over tunnel HTTP wrapping)
                     ▼
        ┌────────────────────────────┐
        │  Cloudflare Tunnel         │
        │  (alexandria-db.oooefam    │
        │   .net)                    │
        │                            │
        │  - mTLS encryption         │
        │  - No inbound ports        │
        │  - TCP over HTTP/2         │
        └────────────┬───────────────┘
                     │
                     │ Outbound
                     │ Connection
                     ▼
        ┌────────────────────────────┐
        │  Home Network              │
        │  (192.168.1.0/24)          │
        │                            │
        │  ┌──────────────────────┐  │
        │  │ Unraid Server        │  │
        │  │ (192.168.1.240)      │  │
        │  │                      │  │
        │  │ - PostgreSQL:5432    │  │
        │  │ - 54M books          │  │
        │  │ - 250GB data         │  │
        │  └──────────────────────┘  │
        └────────────────────────────┘
```

**Key Points**:
- No Hyperdrive in this architecture
- Worker uses `postgres` library directly
- Connection goes through tunnel (HTTP wrapping)
- PostgreSQL not exposed to internet
- Secure and cost-effective

---

## Summary

**Don't use Hyperdrive with Cloudflare Tunnel.**

Use direct connection from Worker → Tunnel → PostgreSQL instead.

This is the correct architecture for your self-hosted setup and provides adequate performance for your use case.

See `/Users/juju/dev_repos/alex/docs/PHASE2_SETUP.md` for implementation details (Option B).
