# DNS Setup Required for Alexandria Worker

## Current Status

### What Works
- Cloudflare Worker is deployed successfully
- Worker code is correct and ready to serve requests
- Database password stored in Worker secrets
- Configuration in `wrangler.toml` is correct
- Tunnel is running with 4 active connections

### What Doesn't Work
- **DNS record for `alexandria.ooheynerds.com` does not exist**
- Worker cannot be accessed because hostname doesn't resolve

## The Problem

When you deploy a Worker with a custom route in `wrangler.toml`:

```toml
route = { pattern = "alexandria.ooheynerds.com", zone_name = "ooheynerds.com" }
```

**Cloudflare does NOT automatically create the DNS record.** You must create it manually.

## The Solution

You need to add a DNS record in the Cloudflare Dashboard that points `alexandria.ooheynerds.com` to Cloudflare's Workers infrastructure.

### Option 1: Using Cloudflare Dashboard (Recommended)

1. Go to https://dash.cloudflare.com
2. Select your domain: **ooheynerds.com**
3. Navigate to: **DNS > Records**
4. Click: **Add record**
5. Configure:
   - **Type**: `AAAA` (or `A`)
   - **Name**: `alexandria`
   - **IPv6 address**: `100::` (or IPv4: `192.0.2.1`)
   - **Proxy status**: **Proxied** (orange cloud) - CRITICAL!
   - **TTL**: Auto
6. Click: **Save**

**Why these values?**
- The actual IP doesn't matter because the orange cloud (proxied) means Cloudflare intercepts the request
- Cloudflare will route requests to your Worker based on the route configuration
- The Worker route in `wrangler.toml` tells Cloudflare to execute your Worker code for this hostname

### Option 2: Using Cloudflare API (Advanced)

```bash
# Get your Zone ID (already known: see CREDENTIALS.md)
ZONE_ID="YOUR_ZONE_ID"
API_TOKEN="YOUR_API_TOKEN"

# Create DNS record
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type":"AAAA",
    "name":"alexandria",
    "content":"100::",
    "ttl":1,
    "proxied":true
  }'
```

### Option 3: Use workers.dev Subdomain (Temporary)

If you don't want to set up DNS yet, you can test using the workers.dev subdomain:

1. Update `wrangler.toml`:
```toml
name = "alexandria"
main = "index.js"
compatibility_date = "2024-11-20"
compatibility_flags = ["nodejs_compat"]

# Commented out custom route for now
# route = { pattern = "alexandria.ooheynerds.com", zone_name = "ooheynerds.com" }

# Database configuration
[vars]
DATABASE_HOST = "alexandria-db.oooefam.net"
DATABASE_PORT = "5432"
DATABASE_NAME = "openlibrary"
DATABASE_USER = "openlibrary"
```

2. Deploy:
```bash
cd /Users/juju/dev_repos/alex/worker
npm run deploy
```

3. Access via:
```
https://alexandria.YOUR_SUBDOMAIN.workers.dev
```

**Note**: workers.dev subdomain is shown in the deployment output.

---

## Verification After DNS Setup

### Step 1: Check DNS Resolution

Wait 1-2 minutes after creating the record, then verify:

```bash
# Should return Cloudflare IPs (e.g., 104.21.x.x, 172.67.x.x)
dig @8.8.8.8 alexandria.ooheynerds.com +short

# Or use nslookup
nslookup alexandria.ooheynerds.com 8.8.8.8
```

### Step 2: Test Health Endpoint

```bash
curl https://alexandria.ooheynerds.com/health
```

**Expected response**:
```json
{
  "status": "ok",
  "database": "connected via tunnel",
  "tunnel": "alexandria-db.oooefam.net",
  "timestamp": "2025-11-29T02:45:00.000Z"
}
```

### Step 3: Test ISBN Lookup

```bash
# Harry Potter and the Chamber of Secrets
curl "https://alexandria.ooheynerds.com/api/isbn?isbn=9780439064873"
```

**Expected response**:
```json
{
  "isbn": "9780439064873",
  "count": 1,
  "results": [
    {
      "title": "Harry Potter and the Chamber of Secrets",
      "author": "J. K. Rowling",
      "isbn": "9780439064873",
      "publish_date": "1999",
      "publishers": ["Scholastic"],
      "pages": "341",
      "openlibrary_edition": "https://openlibrary.org/books/OL...",
      "openlibrary_work": "https://openlibrary.org/works/OL..."
    }
  ]
}
```

### Step 4: Test in Browser

Simply visit: https://alexandria.ooheynerds.com

You should see the beautiful API documentation homepage.

---

## Troubleshooting

### DNS Not Resolving

**Problem**: `dig alexandria.ooheynerds.com` returns nothing

**Solution**:
1. Verify DNS record exists in Cloudflare Dashboard
2. Ensure **Proxy status** is **Proxied** (orange cloud)
3. Wait 1-2 minutes for propagation
4. Clear your local DNS cache:
   ```bash
   # macOS
   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

   # Linux
   sudo systemd-resolve --flush-caches
   ```

### DNS Resolves but Worker Not Working

**Problem**: DNS works but you get a Cloudflare error page

**Solution**:
1. Verify Worker is deployed:
   ```bash
   cd /Users/juju/dev_repos/alex/worker
   npx wrangler deployments list
   ```

2. Check Worker route configuration:
   ```bash
   # Should show: alexandria.ooheynerds.com
   grep -A1 "route" wrangler.toml
   ```

3. Verify DNS record is **Proxied** (orange cloud, not grey)

### Database Connection Errors

**Problem**: Worker returns 500 error "Database query failed"

**Solution**:
1. Verify tunnel is running:
   ```bash
   ./scripts/tunnel-status.sh
   ```

2. Check database is accessible via tunnel:
   ```bash
   ./scripts/db-check.sh
   ```

3. Verify Worker has DATABASE_PASSWORD secret:
   ```bash
   cd /Users/juju/dev_repos/alex/worker
   npx wrangler secret list
   ```

4. Check Worker logs:
   ```bash
   npm run tail
   ```

---

## Summary

**You're 95% done!** The only missing piece is the DNS record.

### Current Infrastructure Status

| Component | Status | Details |
|-----------|--------|---------|
| PostgreSQL Database | ✅ Running | 54.8M editions, 250GB data |
| Cloudflare Tunnel | ✅ Running | 4 active connections |
| Tunnel DNS | ✅ Working | alexandria-db.oooefam.net resolves |
| Worker Code | ✅ Deployed | Version: b8efc981-1d7e-48be-8cf3-2cdf55381863 |
| Worker DNS | ❌ **MISSING** | **alexandria.ooheynerds.com doesn't resolve** |
| Database Password | ✅ Stored | Secret: DATABASE_PASSWORD |
| Configuration | ✅ Complete | wrangler.toml, .dev.vars |

### Next Steps

1. **Create DNS record** (Option 1 above) - 2 minutes
2. **Wait for propagation** - 1-2 minutes
3. **Test endpoints** - 1 minute
4. **Celebrate!** - You have a globally distributed API for 54M books!

### Files Created/Modified

Configuration files:
- `/Users/juju/dev_repos/alex/worker/wrangler.toml` - Worker configuration with nodejs_compat
- `/Users/juju/dev_repos/alex/worker/.dev.vars` - Local development environment variables
- `/Users/juju/dev_repos/alex/worker/index.js` - Worker code with ISBN API
- `/Users/juju/dev_repos/alex/worker/package.json` - Dependencies (postgres library)

Documentation files:
- `/Users/juju/dev_repos/alex/docs/PHASE2_SETUP.md` - Complete Phase 2 setup guide
- `/Users/juju/dev_repos/alex/docs/HYPERDRIVE_LIMITATION.md` - Why Hyperdrive doesn't work with tunnels
- `/Users/juju/dev_repos/alex/docs/DNS_SETUP_REQUIRED.md` - This file

### What You've Accomplished

- Discovered Hyperdrive limitation with Cloudflare Tunnel
- Implemented direct database connection (correct approach)
- Deployed Worker with proper Node.js compatibility
- Set up secure credential storage
- Created comprehensive API with health checks and ISBN lookup
- Built beautiful API documentation homepage
- Learned important Worker DNS configuration

**You just need to add one DNS record and you're live!**
