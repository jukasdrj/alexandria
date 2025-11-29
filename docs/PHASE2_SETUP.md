# Phase 2: Database Integration Setup Guide

## Critical DNS Issue Discovered

**PROBLEM**: `alexandria-db.ooheynerds.com` does not have a public DNS record, which prevents Hyperdrive creation.

**STATUS**:
- Tunnel is configured for `alexandria-db.ooheynerds.com` in config.yml
- Tunnel reports DNS route exists but points to `alexandria-db.ooheynerds.com.oooefam.net`
- Public DNS lookup fails (no A or CNAME record)
- Hyperdrive requires publicly routable hostname

## Solution: Fix DNS First

### Step 1: Create Proper DNS Record

You need to add a CNAME record in Cloudflare Dashboard:

1. Go to https://dash.cloudflare.com
2. Select domain: `ooheynerds.com`
3. Navigate to DNS > Records
4. Add CNAME record:
   - **Name**: `alexandria-db`
   - **Target**: `848928ab-4ab9-4733-93b0-3e7967c60acb.cfargotunnel.com`
   - **Proxy status**: DNS only (grey cloud) - IMPORTANT for Hyperdrive
   - **TTL**: Auto

**Alternative using cloudflared CLI**:
```bash
cloudflared tunnel route dns 848928ab-4ab9-4733-93b0-3e7967c60acb alexandria-db.ooheynerds.com
```

### Step 2: Verify DNS Propagation

Wait 1-2 minutes, then verify:
```bash
dig @8.8.8.8 alexandria-db.ooheynerds.com +short
# Should return: 848928ab-4ab9-4733-93b0-3e7967c60acb.cfargotunnel.com
```

---

## Option A: Hyperdrive (Recommended for Production)

**Benefits**:
- Connection pooling (critical for 50M+ row database)
- Automatic failover and retries
- Edge caching of connection metadata
- Better performance under load
- Designed for paid Workers plans

**Requirements**:
- Public DNS record (see Step 1 above)
- Cloudflare paid plan (you have this)

### Create Hyperdrive Configuration

Once DNS is verified:

```bash
cd /Users/juju/dev_repos/alex/worker

# Create Hyperdrive config
npx wrangler hyperdrive create alexandria-db \
  --connection-string="postgres://openlibrary:tommyboy@alexandria-db.ooheynerds.com:5432/openlibrary"

# Save the Hyperdrive ID from output (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
```

### Update wrangler.toml

Add Hyperdrive binding:
```toml
name = "alexandria"
main = "index.js"
compatibility_date = "2024-11-20"

# Route to your domain
route = { pattern = "alexandria.ooheynerds.com", zone_name = "ooheynerds.com" }

# Hyperdrive binding
[[hyperdrive]]
binding = "DB"
id = "YOUR_HYPERDRIVE_ID_HERE"  # From creation output
```

### Install Dependencies

```bash
cd /Users/juju/dev_repos/alex/worker
npm install @neondatabase/serverless
```

Note: We use `@neondatabase/serverless` because it's optimized for Workers environment and works with Hyperdrive.

### Update Worker Code (See index.js below)

### Deploy

```bash
npm run deploy
```

---

## Option B: Direct Connection (Quick Start)

**Use this if**:
- You want to test immediately without DNS setup
- You're doing initial development
- You plan to migrate to Hyperdrive later (recommended)

**Limitations**:
- No connection pooling
- Each request creates new connection (slower)
- Not optimal for high traffic
- Still works fine for read-only queries

### Install Dependencies

```bash
cd /Users/juju/dev_repos/alex/worker
npm install postgres
```

### Store Database Password

```bash
cd /Users/juju/dev_repos/alex/worker
npx wrangler secret put DATABASE_PASSWORD
# When prompted, enter: tommyboy
```

### Update wrangler.toml

```toml
name = "alexandria"
main = "index.js"
compatibility_date = "2024-11-20"

# Route to your domain
route = { pattern = "alexandria.ooheynerds.com", zone_name = "ooheynerds.com" }

# Database configuration (non-secret values)
[vars]
DATABASE_HOST = "alexandria-db.ooheynerds.com"
DATABASE_PORT = "5432"
DATABASE_NAME = "openlibrary"
DATABASE_USER = "openlibrary"
# PASSWORD stored via wrangler secret
```

### Create .dev.vars for Local Development

```bash
# /Users/juju/dev_repos/alex/worker/.dev.vars
DATABASE_HOST=alexandria-db.ooheynerds.com
DATABASE_PORT=5432
DATABASE_NAME=openlibrary
DATABASE_USER=openlibrary
DATABASE_PASSWORD=tommyboy
```

**IMPORTANT**: Add `.dev.vars` to `.gitignore`!

### Update Worker Code (See index.js below)

### Deploy

```bash
npm run deploy
```

---

## Worker Code Implementation

### For Hyperdrive (Option A):

```javascript
import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        database: 'connected via Hyperdrive',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // ISBN lookup endpoint
    if (url.pathname === '/api/isbn' && url.searchParams.has('isbn')) {
      const isbn = url.searchParams.get('isbn').replace(/[^0-9X]/gi, '').toUpperCase();

      // Validate ISBN format
      if (isbn.length !== 10 && isbn.length !== 13) {
        return new Response(JSON.stringify({
          error: 'Invalid ISBN format. Must be 10 or 13 characters.'
        }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
      }

      try {
        // Use Hyperdrive connection
        const sql = neon(env.DB.connectionString);

        const result = await sql`
          SELECT
            e.data->>'title' AS title,
            a.data->>'name' AS author,
            ei.isbn,
            e.data->>'publish_date' AS publish_date,
            e.data->>'publishers' AS publishers
          FROM editions e
          JOIN edition_isbns ei ON ei.edition_key = e.key
          LEFT JOIN works w ON w.key = e.work_key
          LEFT JOIN author_works aw ON aw.work_key = w.key
          LEFT JOIN authors a ON aw.author_key = a.key
          WHERE ei.isbn = ${isbn}
          LIMIT 10
        `;

        if (result.length === 0) {
          return new Response(JSON.stringify({
            error: 'ISBN not found',
            isbn: isbn
          }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          isbn: isbn,
          results: result,
          count: result.length
        }), {
          headers: { 'content-type': 'application/json' }
        });

      } catch (error) {
        console.error('Database query error:', error);
        return new Response(JSON.stringify({
          error: 'Database query failed',
          message: error.message
        }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // Default: Homepage
    return new Response(getHomepage(), {
      headers: { 'content-type': 'text/html' }
    });
  }
};

function getHomepage() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Alexandria - OpenLibrary Database</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #2563eb; }
    .endpoint { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0; }
    code { background: #1f2937; color: #10b981; padding: 2px 6px; border-radius: 4px; }
    .example { margin: 10px 0; }
  </style>
</head>
<body>
  <h1>📚 Alexandria - OpenLibrary Database</h1>
  <p>Connected to 54+ million books through Cloudflare Hyperdrive!</p>

  <h2>API Endpoints</h2>

  <div class="endpoint">
    <h3>GET /health</h3>
    <p>Health check endpoint</p>
    <div class="example">
      <strong>Example:</strong><br>
      <code>GET https://alexandria.ooheynerds.com/health</code>
    </div>
  </div>

  <div class="endpoint">
    <h3>GET /api/isbn?isbn={ISBN}</h3>
    <p>Look up book by ISBN (10 or 13 digits)</p>
    <div class="example">
      <strong>Example:</strong><br>
      <code>GET https://alexandria.ooheynerds.com/api/isbn?isbn=9780439064873</code>
      <p>Try it: <a href="/api/isbn?isbn=9780439064873">Harry Potter and the Chamber of Secrets</a></p>
    </div>
  </div>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p><strong>Architecture:</strong> Cloudflare Workers → Hyperdrive → Cloudflare Tunnel → PostgreSQL</p>
    <p><strong>Database:</strong> 54.8M editions, 49.3M ISBNs, 40.1M works, 14.7M authors</p>
  </div>
</body>
</html>`;
}
```

### For Direct Connection (Option B):

```javascript
import postgres from 'postgres';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        database: 'connected directly',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // ISBN lookup endpoint
    if (url.pathname === '/api/isbn' && url.searchParams.has('isbn')) {
      const isbn = url.searchParams.get('isbn').replace(/[^0-9X]/gi, '').toUpperCase();

      // Validate ISBN format
      if (isbn.length !== 10 && isbn.length !== 13) {
        return new Response(JSON.stringify({
          error: 'Invalid ISBN format. Must be 10 or 13 characters.'
        }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
      }

      // Create database connection
      const sql = postgres({
        host: env.DATABASE_HOST,
        port: parseInt(env.DATABASE_PORT),
        database: env.DATABASE_NAME,
        username: env.DATABASE_USER,
        password: env.DATABASE_PASSWORD,
        ssl: false,
        connect_timeout: 10,
        idle_timeout: 2,
        max_lifetime: 30
      });

      try {
        const result = await sql`
          SELECT
            e.data->>'title' AS title,
            a.data->>'name' AS author,
            ei.isbn,
            e.data->>'publish_date' AS publish_date,
            e.data->>'publishers' AS publishers
          FROM editions e
          JOIN edition_isbns ei ON ei.edition_key = e.key
          LEFT JOIN works w ON w.key = e.work_key
          LEFT JOIN author_works aw ON aw.work_key = w.key
          LEFT JOIN authors a ON aw.author_key = a.key
          WHERE ei.isbn = ${isbn}
          LIMIT 10
        `;

        // Close connection
        await sql.end();

        if (result.length === 0) {
          return new Response(JSON.stringify({
            error: 'ISBN not found',
            isbn: isbn
          }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          isbn: isbn,
          results: result,
          count: result.length
        }), {
          headers: { 'content-type': 'application/json' }
        });

      } catch (error) {
        console.error('Database query error:', error);
        await sql.end().catch(() => {});

        return new Response(JSON.stringify({
          error: 'Database query failed',
          message: error.message
        }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // Default: Homepage (same as Hyperdrive version)
    return new Response(getHomepage(), {
      headers: { 'content-type': 'text/html' }
    });
  }
};

// Same getHomepage() function as above
```

---

## Recommended Path Forward

### Immediate (Today):
1. **Fix DNS** - Add CNAME record for `alexandria-db.ooheynerds.com`
2. **Wait for propagation** - 1-2 minutes
3. **Create Hyperdrive** - Use Option A setup
4. **Deploy Worker** - With Hyperdrive binding
5. **Test** - Try ISBN lookup

### Fallback (If DNS issues persist):
1. Use **Option B** (direct connection)
2. Test functionality
3. Migrate to Hyperdrive later when DNS is resolved

---

## Testing After Deployment

```bash
# Test health endpoint
curl https://alexandria.ooheynerds.com/health

# Test ISBN lookup (Harry Potter)
curl "https://alexandria.ooheynerds.com/api/isbn?isbn=9780439064873"

# Test invalid ISBN
curl "https://alexandria.ooheynerds.com/api/isbn?isbn=123"

# Test non-existent ISBN
curl "https://alexandria.ooheynerds.com/api/isbn?isbn=9999999999999"
```

---

## Performance Optimization (Hyperdrive vs Direct)

### Hyperdrive Benefits:
- **Connection pooling**: Reuses connections across requests
- **Edge caching**: Caches connection metadata at Cloudflare edge
- **Auto-retry**: Built-in retry logic for transient failures
- **Better latency**: ~50-100ms faster under load
- **Cost effective**: Fewer database connections = better resource usage

### When to Use Direct Connection:
- Initial testing and development
- Low traffic scenarios (< 100 req/min)
- Temporary DNS resolution issues
- Quick prototyping before production

---

## Next Steps After Setup

1. Add rate limiting (see TODO.md Phase 3)
2. Implement more search endpoints (title, author)
3. Add request logging and analytics
4. Set up monitoring and alerts
5. Optimize queries with database indexes
6. Consider caching layer (KV or Cache API)

---

## Troubleshooting

### Hyperdrive Creation Fails
- **Error**: "DNS lookup failed"
- **Solution**: Verify DNS record exists and is publicly routable
- **Check**: `dig @8.8.8.8 alexandria-db.ooheynerds.com`

### Worker Deployment Fails
- **Error**: "Invalid binding"
- **Solution**: Verify Hyperdrive ID in wrangler.toml matches created config
- **Check**: `npx wrangler hyperdrive list`

### Database Connection Timeout
- **Error**: "Connection timeout"
- **Solution**: Verify tunnel is running with 4 connections
- **Check**: `./scripts/tunnel-status.sh`

### Query Performance Issues
- **Issue**: Slow responses (> 2 seconds)
- **Solution**: Ensure you're using `edition_isbns` table (indexed)
- **Check**: Run `EXPLAIN ANALYZE` on query in psql

---

## Security Considerations

1. **Never commit secrets**:
   - Add `.dev.vars` to `.gitignore`
   - Use `wrangler secret put` for production passwords
   - Rotate credentials periodically

2. **Input validation**:
   - Always sanitize ISBN input
   - Limit query results (use LIMIT)
   - Validate all user inputs

3. **Rate limiting** (Phase 3):
   - Implement per-IP rate limits
   - Add API key authentication for heavy users
   - Monitor for abuse patterns

4. **Tunnel security**:
   - Tunnel uses mTLS encryption
   - No inbound firewall ports needed
   - Backup tunnel credentials regularly
