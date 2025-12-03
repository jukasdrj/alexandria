# Cloudflare Tunnel Configuration

## Overview

Alexandria uses **Zero Trust remotely-managed** tunnel configuration. The tunnel is controlled via a token stored in the Cloudflare dashboard, not a local config file.

## Production Tunnel

- **Tunnel ID**: `848928ab-4ab9-4733-93b0-3e7967c60acb`
- **Tunnel Name**: `alexandria`
- **Public Hostname**: `alexandria-db.ooheynerds.com`
- **Backend Target**: `tcp://localhost:5432` (PostgreSQL)

## How It Works

```
Cloudflare Edge → Zero Trust → Tunnel Token → Docker Container → PostgreSQL
```

The tunnel:
1. Runs as Docker container on Unraid server
2. Uses token-based authentication (stored in Cloudflare dashboard)
3. Establishes outbound-only connection to Cloudflare
4. No inbound firewall ports required
5. Auto-restarts on failure (`--restart unless-stopped`)

## Docker Container

```bash
# Current running container
docker run -d \
  --name alexandria-tunnel \
  --restart unless-stopped \
  --network host \
  cloudflare/cloudflared:latest \
  tunnel run --token <TUNNEL_TOKEN>
```

**Important**: Must use `--network host` for tunnel to access PostgreSQL on `localhost:5432`

## Configuration Location

**NOT** in local config file. Configuration is managed in:
- Cloudflare Zero Trust Dashboard → Access → Tunnels → alexandria
- Public hostname routing configured there

## Reference Config File

See [tunnel-config.example.yml](./tunnel-config.example.yml) for the equivalent local configuration format. This file is **for reference only** and is not used by the production tunnel.

## Checking Tunnel Status

```bash
# Via script
./scripts/tunnel-status.sh

# Or directly via SSH
ssh root@Tower.local "docker logs alexandria-tunnel --tail 20"

# Should show 4 active connections
```

## Recreating the Tunnel

If the container is lost:

1. Get tunnel token from Cloudflare dashboard or `docs/CREDENTIALS.md`
2. Recreate container:

```bash
ssh root@Tower.local "docker run -d \
  --name alexandria-tunnel \
  --restart unless-stopped \
  --network host \
  cloudflare/cloudflared:latest \
  tunnel run --token <YOUR_TUNNEL_TOKEN>"
```

3. Verify: `./scripts/tunnel-status.sh`

## Security

- Tunnel secured with Cloudflare Access
- Service Token authentication for Hyperdrive access
- IP whitelist: `47.187.18.143/32` (home IP)
- mTLS encryption for all tunnel traffic

## Troubleshooting

**Container not found:**
```bash
# Check if running
ssh root@Tower.local "docker ps | grep alexandria-tunnel"

# Check logs
ssh root@Tower.local "docker logs alexandria-tunnel"

# Restart if needed
ssh root@Tower.local "docker restart alexandria-tunnel"
```

**Connection issues:**
- Verify tunnel shows 4 active connections
- Check PostgreSQL is listening: `ss -tlnp | grep 5432`
- Test from worker: `npm run dev` then query health endpoint
- Check Cloudflare Zero Trust dashboard for tunnel status
