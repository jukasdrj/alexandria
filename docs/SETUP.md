# Alexandria Setup Guide

Complete setup documentation for the Alexandria project.

## Prerequisites Installed

✅ Cloudflared on Mac and Unraid
✅ SSH key authentication to Unraid (root@Tower.local)
✅ Wrangler CLI authenticated
✅ Docker on Unraid

## Step-by-Step Setup (Already Complete)

### 1. SSH Key Setup

SSH key created and deployed to Unraid:
```bash
# Key location: ~/.ssh/id_ed25519
# Connection test
ssh root@Tower.local hostname
```

### 2. Cloudflare Tunnel Creation

Created tunnel "alexandria" with ID: `848928ab-4ab9-4733-93b0-3e7967c60acb`

```bash
# Tunnel created on Mac
cloudflared tunnel login
cloudflared tunnel create alexandria

# Token generated (stored on Unraid)
cloudflared tunnel token alexandria

# DNS route created
cloudflared tunnel route dns alexandria alexandria-db.ooheynerds.com
```

### 3. Tunnel Deployment on Unraid

Tunnel running as Docker container:
```bash
ssh root@Tower.local

# Configuration at: /root/.cloudflared/config.yml
# Credentials at: /root/.cloudflared/848928ab-4ab9-4733-93b0-3e7967c60acb.json

# Container command
docker run -d --name alexandria-tunnel \
  --network host \
  -v /root/.cloudflared:/etc/cloudflared \
  cloudflare/cloudflared:latest \
  tunnel --config /etc/cloudflared/config.yml run
```

### 4. Worker Deployment

Worker deployed to alexandria.ooheynerds.com:
```bash
cd worker/
npx wrangler deploy
```

## Current Configuration

### Tunnel Config (on Unraid: /root/.cloudflared/config.yml)
```yaml
tunnel: 848928ab-4ab9-4733-93b0-3e7967c60acb
credentials-file: /etc/cloudflared/848928ab-4ab9-4733-93b0-3e7967c60acb.json

ingress:
  - hostname: alexandria-db.ooheynerds.com
    service: tcp://localhost:5432
  - service: http_status:404
```

### PostgreSQL Connection
Database is accessible locally on Unraid at:
- Host: localhost (or 192.168.1.240)
- Port: 5432
- Database: openlibrary
- User: openlibrary
- Password: tommyboy

### Cloudflare DNS Records
Created automatically by tunnel:
- alexandria-db.ooheynerds.com → CNAME to tunnel
- alexandria.ooheynerds.com → Worker route

## Verification Commands

### Check Tunnel Status
```bash
# View tunnel logs
ssh root@Tower.local "docker logs alexandria-tunnel --tail 50"

# Check tunnel connections (should show 4 active)
ssh root@Tower.local "docker logs alexandria-tunnel 2>&1 | grep 'Registered tunnel'"
```

### Check Database
```bash
# Connect to database
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT COUNT(*) FROM editions;'"

# Should return: 54881444
```

### Check Worker
```bash
curl https://alexandria.ooheynerds.com
# Should return HTML page
```

## Troubleshooting

### Tunnel Not Connecting
```bash
# Restart tunnel
ssh root@Tower.local "docker restart alexandria-tunnel"

# Check credentials exist
ssh root@Tower.local "ls -la /root/.cloudflared/"
```

### Worker Not Deploying
```bash
# Check Wrangler auth
npx wrangler whoami

# Re-authenticate if needed
npx wrangler login
```

### Database Not Accessible
```bash
# Check PostgreSQL container
ssh root@Tower.local "docker ps | grep postgres"

# Check port
ssh root@Tower.local "netstat -tlnp | grep 5432"
```
