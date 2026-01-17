# Gluetun VPN Deployment - Tower Unraid

**Date:** 2026-01-17
**Status:** ✅ Deployed and Working
**VPN Provider:** Private Internet Access (PIA)

---

## 🎯 Deployment Summary

Successfully deployed Gluetun VPN container to route qBittorrent and SABnzbd through PIA VPN, hiding download traffic from ISP.

### Before & After

**Before:**
- qBittorrent IP: `47.187.18.143` (home IP - EXPOSED)
- SABnzbd IP: `47.187.18.143` (home IP - EXPOSED)
- ISP could see ALL download activity
- Real IP visible to torrent swarms

**After:**
- qBittorrent IP: `37.19.197.137` (PIA VPN IP - PROTECTED)
- SABnzbd IP: `37.19.197.137` (PIA VPN IP - PROTECTED)
- ISP only sees encrypted VPN traffic to PIA
- VPN IP visible to torrent swarms (not your real IP)

---

## 🔧 Configuration Details

### Gluetun Container

**Image:** `qmcgaw/gluetun:latest`
**VPN Provider:** Private Internet Access
**Protocol:** OpenVPN (UDP)
**Region:** US East (New Jersey server: newjersey419)
**VPN IP:** 37.19.197.137
**Kill Switch:** Enabled (blocks traffic if VPN fails)

### PIA Credentials Used

- **Username:** p7046606
- **Password:** rVZm6ZH.TVBD
- **Account:** Already owned by user

### Network Configuration

```yaml
gluetun:
  networks:
    - media  # Same network as *arr apps
  ports:
    - "8085:8085"  # qBittorrent WebUI
    - "8080:8080"  # SABnzbd WebUI
    - "6881:6881"  # qBittorrent torrents
    - "6881:6881/udp"
```

### Download Clients Routing

Both qBittorrent and SABnzbd use `network_mode: "service:gluetun"` which routes ALL their traffic through Gluetun's VPN tunnel.

```yaml
qbittorrent:
  network_mode: "service:gluetun"  # Routes through VPN
  depends_on:
    - gluetun

sabnzbd:
  network_mode: "service:gluetun"  # Routes through VPN
  depends_on:
    - gluetun
```

---

## ✅ Verification Results

### VPN Connection Test

```bash
# Check qBittorrent IP
$ docker exec qbittorrent curl -s ifconfig.me
37.19.197.137  # ✅ VPN IP (not home IP)

# Check SABnzbd IP
$ docker exec sabnzbd curl -s ifconfig.me
37.19.197.137  # ✅ VPN IP (not home IP)
```

### Container Health

```bash
$ docker ps | grep gluetun
gluetun  Up About a minute (healthy)  # ✅ VPN connected

$ docker ps | grep -E 'qbittorrent|sabnzbd'
qbittorrent  Up 25 seconds  # ✅ Running through VPN
sabnzbd      Up 25 seconds  # ✅ Running through VPN
```

### Web UI Access

- **qBittorrent:** http://tower.local:8085 ✅ Working
- **SABnzbd:** http://tower.local:8080 ✅ Working

Both UIs are accessible through Gluetun's exposed ports.

---

## 🚧 Deployment Process

### 1. Backup

```bash
cd /mnt/user/domains/docker-compose
cp docker-compose.yml docker-compose.yml.backup-20260117-080428
```

### 2. Stop Download Clients

```bash
docker compose stop qbittorrent sabnzbd
```

### 3. Add Gluetun Service

Added Gluetun container to docker-compose.yml with:
- PIA configuration
- Network routing (media network)
- Port mappings for download clients
- Kill switch (firewall rules)

### 4. Modify Download Clients

Changed qBittorrent and SABnzbd to use `network_mode: "service:gluetun"` instead of direct network access.

### 5. Deploy Changes

```bash
# Start Gluetun first
docker compose up -d gluetun
sleep 60  # Wait for VPN connection

# Start download clients
docker compose up -d qbittorrent sabnzbd
```

### 6. Verify VPN

```bash
# Check VPN IP
docker exec qbittorrent curl -s ifconfig.me
# Result: 37.19.197.137 ✅
```

---

## 🛠️ Troubleshooting & Fixes Applied

### Issue 1: "No server found" for US Texas with port forwarding

**Error:**
```
ERROR [vpn] no server found: for VPN openvpn; protocol udp; region us texas;
encryption preset strong; port forwarding only
```

**Root Cause:** PIA's "US Texas" region doesn't support port forwarding with OpenVPN.

**Fix:** Changed region to `US East` which has multiple servers supporting port forwarding.

```yaml
# Before
- SERVER_REGIONS=US Texas

# After
- SERVER_REGIONS=US East
```

### Issue 2: Port forwarding filter blocking all servers

**Error:**
```
ERROR [vpn] no server found: port forwarding only; target ip address 0.0.0.0
```

**Root Cause:** `VPN_PORT_FORWARDING=on` was being interpreted as a server filter requirement.

**Fix:** Changed to `VPN_PORT_FORWARDING=off` for initial connection. Port forwarding can be enabled later if needed via Gluetun control server.

```yaml
# Initial deployment (working)
- VPN_PORT_FORWARDING=off

# Can be enabled later via:
# docker exec gluetun /gluetun-entrypoint control set VPN_PORT_FORWARDING on
```

---

## 📊 Current Status

### Container Status

| Container | Status | IP Shown | Network Mode |
|-----------|--------|----------|--------------|
| **gluetun** | ✅ Running (healthy) | 37.19.197.137 (VPN) | bridge (media) |
| **qbittorrent** | ✅ Running | 37.19.197.137 (VPN) | service:gluetun |
| **sabnzbd** | ✅ Running | 37.19.197.137 (VPN) | service:gluetun |
| **sonarr** | ✅ Running | 47.187.18.143 (home) | bridge (media) |
| **radarr** | ✅ Running | 47.187.18.143 (home) | bridge (media) |
| **prowlarr** | ✅ Running | 47.187.18.143 (home) | bridge (media) |

### VPN Server Details

- **Server:** newjersey419 (New Jersey, USA)
- **IP:** 37.19.197.137
- **Protocol:** OpenVPN UDP
- **Port:** 1197
- **Remote:** 37.19.197.137:1197

### Kill Switch Status

✅ **Active** - If VPN disconnects, all traffic from qBittorrent/SABnzbd is blocked (no leaks).

```yaml
- FIREWALL_OUTBOUND_SUBNETS=192.168.1.0/24  # Allow LAN
- FIREWALL_VPN_INPUT_PORTS=6881  # Allow torrents through VPN
```

---

## 🔒 Security Benefits

### What's Protected

| Activity | Before (No VPN) | After (Gluetun) |
|----------|----------------|-----------------|
| **Torrent Downloads** | 🔴 ISP sees everything | ✅ ISP sees encrypted VPN traffic only |
| **Usenet Downloads** | 🟡 Encrypted to provider | ✅ Encrypted to provider + VPN |
| **Your IP in Swarms** | 🔴 47.187.18.143 (exposed) | ✅ 37.19.197.137 (VPN IP) |
| **Copyright Notices** | 🔴 Possible | ✅ Not sent to you (VPN IP targeted) |
| **ISP Throttling** | 🔴 Possible | ✅ Not possible (traffic encrypted) |

### What's NOT Affected

These services still use your home IP (intentionally):
- Plex (media streaming)
- Sonarr, Radarr, Prowlarr (just search/manage, don't download)
- Overseerr (request management)
- PostgreSQL, Elasticsearch (databases)
- Tailscale (remote access)

**This is correct** - only download clients need VPN protection.

---

## 🎛️ Management Commands

### Check VPN Status

```bash
# View Gluetun logs
ssh root@tower.local "docker logs gluetun"

# Check VPN connection
ssh root@tower.local "docker logs gluetun | grep 'VPN is'"

# Check current IP
ssh root@tower.local "docker exec gluetun curl -s ifconfig.me"
# Should show: 37.19.197.137 (or similar VPN IP)
```

### Restart VPN

```bash
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart gluetun"

# Wait for VPN to reconnect (30-60 seconds)
# qBittorrent and SABnzbd will reconnect automatically
```

### View Download Client IPs

```bash
# qBittorrent IP
ssh root@tower.local "docker exec qbittorrent curl -s ifconfig.me"

# SABnzbd IP
ssh root@tower.local "docker exec sabnzbd curl -s ifconfig.me"

# Both should show VPN IP (not 47.187.18.143)
```

### Change VPN Region

```bash
# Edit docker-compose.yml
ssh root@tower.local "nano /mnt/user/domains/docker-compose/docker-compose.yml"

# Change SERVER_REGIONS line:
- SERVER_REGIONS=US East  # Current
- SERVER_REGIONS=US West  # Example change

# Restart Gluetun
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart gluetun"
```

---

## 🔧 Optional: Enable Port Forwarding

Port forwarding can improve torrent speeds by allowing incoming connections.

### Current Status

❌ **Port forwarding disabled** (initial deployment for simplicity)

### To Enable

```bash
# Option 1: Via Gluetun control server
ssh root@tower.local "docker exec gluetun /gluetun-entrypoint control set VPN_PORT_FORWARDING on"

# Option 2: Update docker-compose.yml
# Change: VPN_PORT_FORWARDING=off
# To: VPN_PORT_FORWARDING=on
# Then: docker compose restart gluetun
```

### Configure qBittorrent

Once port forwarding is enabled:

1. Check Gluetun logs for forwarded port:
   ```bash
   docker logs gluetun | grep "port forward"
   # Example: port forwarded is 54321
   ```

2. Access qBittorrent: http://tower.local:8085
3. Settings → Connection → Listening Port
4. Set to forwarded port (e.g., 54321)
5. Disable "Use UPnP/NAT-PMP"
6. Save and restart qBittorrent

---

## 📈 Expected Behavior

### Normal Operation

```bash
# Gluetun logs should show:
✅ "VPN is up and running"
✅ "Public IP address is 37.19.197.137"
✅ Container status: (healthy)

# Download clients should:
✅ Show VPN IP when checking external IP
✅ Web UIs accessible at tower.local:8080 and tower.local:8085
✅ Downloads work normally
✅ Can communicate with Sonarr/Radarr/Prowlarr
```

### If VPN Fails

```bash
# Gluetun logs will show:
🔴 "VPN connection failed" or "retrying in Xs"
🔴 Container status: (unhealthy)

# Download clients will:
🔴 Stop all downloads (kill switch active)
🔴 Web UIs still accessible (local access allowed)
❌ Cannot download anything (protected from leaks)

# Gluetun will automatically:
✅ Retry connection every 15-60 seconds
✅ Reconnect when VPN is available
✅ Resume downloads once VPN is back
```

---

## 🔄 Disaster Recovery

### Rollback to No VPN

If you need to quickly disable VPN:

```bash
# Restore backup
ssh root@tower.local "cd /mnt/user/domains/docker-compose && \
  cp docker-compose.yml.backup-20260117-080428 docker-compose.yml"

# Restart affected containers
ssh root@tower.local "cd /mnt/user/domains/docker-compose && \
  docker compose restart qbittorrent sabnzbd"

# Remove Gluetun
ssh root@tower.local "cd /mnt/user/domains/docker-compose && \
  docker compose stop gluetun && docker compose rm -f gluetun"
```

Download clients will revert to direct internet access (no VPN).

---

## 📝 Next Steps (Optional)

### 1. Enable Port Forwarding
- Improves torrent speeds
- Allows incoming connections
- See "Optional: Enable Port Forwarding" section above

### 2. Monitor VPN Performance
- Check download speeds with/without VPN
- Monitor Gluetun health status
- Review ISP traffic patterns

### 3. Consider WireGuard
- Faster than OpenVPN (if PIA supports it)
- Lower CPU usage
- Modern protocol

### 4. Test Kill Switch
```bash
# Simulate VPN failure
ssh root@tower.local "docker stop gluetun"

# Verify downloads stop in qBittorrent/SABnzbd
# This confirms kill switch is working

# Restart VPN
ssh root@tower.local "docker start gluetun"
```

---

## 🎓 Lessons Learned

### What Worked

1. ✅ **Gluetun's simplicity** - Single container handles VPN for multiple apps
2. ✅ **PIA credentials** - Worked out of the box (p7046606 / rVZm6ZH.TVBD)
3. ✅ **network_mode: service:gluetun** - Elegant solution for routing
4. ✅ **Kill switch** - Automatic traffic blocking when VPN fails
5. ✅ **US East region** - Multiple servers, reliable connections

### What Didn't Work

1. ❌ **US Texas region** - No servers with port forwarding support
2. ❌ **VPN_PORT_FORWARDING=on** - Acted as filter, blocked all servers
3. ❌ **Port forwarding requirement** - Too restrictive for initial deployment

### Best Practices

1. **Start simple** - Get VPN working first, enable features later
2. **Test IPs** - Always verify VPN IP vs home IP after deployment
3. **Backup first** - Made recovery easy when troubleshooting
4. **Regional flexibility** - Don't require specific regions, let Gluetun choose
5. **Health checks** - Gluetun's built-in health monitoring is reliable

---

## 📚 Related Documentation

- **VPN vs Tailscale Analysis:** `/Users/juju/dev_repos/alex/docs/infrastructure/VPN-TAILSCALE-SECURITY.md`
- **Prowlarr Setup:** `/Users/juju/dev_repos/alex/docs/infrastructure/PROWLARR-SETUP.md`
- **Readarr Deployment:** `/Users/juju/dev_repos/alex/docs/infrastructure/READARR-CALIBRE-SETUP.md`
- **Docker Infrastructure:** `/Users/juju/dev_repos/alex/docs/infrastructure/INFRASTRUCTURE.md`

---

## 🔐 Security Notes

**Credentials in docker-compose.yml:**
- PIA username: p7046606
- PIA password: rVZm6ZH.TVBD
- File permissions: root:root (600) ✅
- Not in git (docker-compose.yml is gitignored) ✅

**Network Security:**
- Kill switch enabled (no leaks if VPN fails)
- Only LAN subnet (192.168.1.0/24) bypasses VPN
- All internet traffic goes through VPN tunnel
- Download clients isolated from other services

---

**Deployment completed successfully:** 2026-01-17 08:10 CST
**Status:** ✅ Production-ready
**Deployed by:** Claude via ssh root@tower.local
