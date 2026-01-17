# VPN vs Tailscale Security Analysis for Tower Unraid Homelab

**Date:** January 16, 2026
**Author:** Claude Code Analysis
**Status:** Recommendation for family fun project

---

## Executive Summary

**TL;DR:** Tailscale and VPN serve COMPLETELY DIFFERENT purposes. You likely need BOTH.

- **Tailscale** = Secure remote access to your homelab (replaces port forwarding)
- **VPN** = Hide your internet traffic from your ISP when downloading content

**Current Status:**
- ✅ Tailscale is active and working great (remote access secured)
- ❌ NO VPN configured for download clients (SABnzbd, qBittorrent)
- ⚠️ Your ISP can see ALL torrent/usenet traffic from your home IP (47.187.18.143)

**Recommendation:** Add VPN container for download clients to protect privacy and avoid ISP throttling/notices.

---

## Part 1: Understanding the Difference

### Tailscale (Remote Access VPN)

**What it does:**
- Creates a secure "mesh network" between your devices (Mac, Green, Tower)
- Allows you to access Tower's services remotely without exposing them to the internet
- Uses WireGuard protocol (extremely fast and secure)

**What it DOESN'T do:**
- Does NOT hide your internet traffic from your ISP
- Does NOT protect you when downloading torrents/usenet content
- Does NOT change your public IP address for outbound traffic

**Current Setup:**
```
Mac (anywhere in world)
    ↓ [Tailscale tunnel - encrypted]
Tower (192.168.1.240 / 100.120.125.46)
    ↓ [Regular internet connection - visible to ISP]
Internet (downloading torrents/usenet)
```

**Security Benefits Already In Place:**
1. ✅ **No port forwarding needed** - Plex, Overseerr, etc. are accessible via Tailscale without exposing ports
2. ✅ **Encrypted access** - All remote connections use WireGuard encryption
3. ✅ **No public exposure** - Services like Sonarr, Radarr, qBittorrent are NOT accessible from the open internet
4. ✅ **Device authentication** - Only your authorized devices can access Tower
5. ✅ **Zero Trust model** - Each device must authenticate with Tailscale

### VPN for Download Clients (Commercial VPN Service)

**What it does:**
- Routes your download client traffic through a commercial VPN server
- Changes your public IP address (ISP sees VPN server IP, not your downloads)
- Encrypts traffic between Tower and VPN server (ISP can't see WHAT you're downloading)
- Prevents ISP throttling and copyright notices

**What it DOESN'T do:**
- Does NOT help with remote access (that's Tailscale's job)
- Does NOT replace Tailscale (they work together)

**How it works:**
```
qBittorrent/SABnzbd (in Docker container)
    ↓ [VPN tunnel - encrypted, different IP]
Commercial VPN Server (NordVPN, Mullvad, etc.)
    ↓ [Appears as VPN's IP address]
Torrent Swarm / Usenet Provider
```

---

## Part 2: Do You Need a VPN for Downloads?

### Reasons to Use a VPN for Download Clients

**Privacy & Safety:**
1. ✅ **ISP Monitoring** - Your ISP (AT&T, Comcast, etc.) can see:
   - You're downloading torrents
   - Which torrent trackers you connect to
   - How much data you transfer

2. ✅ **Copyright Notices** - Without VPN:
   - Copyright trolls can see your real IP in torrent swarms
   - ISP may forward DMCA notices to you
   - Repeated notices could lead to throttling or service termination

3. ✅ **ISP Throttling** - Many ISPs throttle:
   - BitTorrent traffic (detected by deep packet inspection)
   - Heavy users during peak hours
   - VPN encrypts traffic so ISP can't selectively throttle

4. ✅ **Public IP Exposure** - Your current setup:
   - Home IP: `47.187.18.143` is visible to entire torrent swarm
   - Anyone can geolocate you to your city/neighborhood
   - VPN hides your real location

### When You DON'T Need a VPN

**If you ONLY use:**
- ✅ Private Usenet providers (already encrypted, no peer visibility)
- ✅ Private torrent trackers (lower risk, but still visible to ISP)
- ✅ Direct downloads (HTTP/HTTPS from legitimate sources)

**Current Risk Assessment for Your Setup:**
- **qBittorrent (Torrents):** 🔴 **HIGH RISK** - Public IP exposed to swarms, ISP can see traffic
- **SABnzbd (Usenet):** 🟡 **MEDIUM RISK** - Traffic encrypted to provider, but ISP knows you use usenet

---

## Part 3: Recommended VPN Providers (Family-Friendly)

### Top Picks for Docker + Homelab

| Provider | Cost/Month | Features | Docker Support | Notes |
|----------|-----------|----------|----------------|-------|
| **Mullvad** | $5.50 | No logs, anonymous payment, WireGuard | ✅ Excellent | Best for privacy, accepts cash/crypto |
| **NordVPN** | $3-12 | Huge server network, fast speeds | ✅ Good | Popular, reliable, frequent sales |
| **ProtonVPN** | $4-10 | Privacy-focused, Swiss jurisdiction | ✅ Good | Same company as ProtonMail |
| **Private Internet Access (PIA)** | $2-12 | Proven no-logs (court tested) | ✅ Excellent | Great value, lots of servers |
| **Windscribe** | $3-9 | Generous free tier (10GB/mo) | ✅ Good | Good for testing before committing |

**Recommended for Your Use Case:** **Mullvad** or **Private Internet Access (PIA)**

**Why Mullvad:**
- ✅ Simple pricing ($5.50/mo, no games)
- ✅ True no-logs policy (audited)
- ✅ Anonymous account numbers (no email required)
- ✅ WireGuard support (fast performance)
- ✅ Well-documented Docker setup
- ✅ Port forwarding support (important for torrents)

**Why PIA:**
- ✅ Proven in court (no logs to hand over)
- ✅ Great value ($2-3/mo on sale)
- ✅ Port forwarding included
- ✅ Large server network (reduces congestion)
- ✅ Excellent Docker containers available

---

## Part 4: Docker Implementation

### Option 1: Gluetun VPN Container (Recommended)

**Gluetun** is a universal VPN client container that supports 60+ VPN providers and acts as a network gateway for other containers.

**docker-compose.yml modifications:**

```yaml
services:
  # VPN Gateway Container (Gluetun)
  gluetun:
    image: qmcgaw/gluetun:latest
    container_name: gluetun
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    networks:
      - media
    ports:
      - "8085:8085"  # qBittorrent WebUI
      - "6881:6881"  # qBittorrent torrent port
      - "6881:6881/udp"
      - "8080:8080"  # SABnzbd WebUI
    volumes:
      - /mnt/cache/appdata/gluetun:/gluetun
    environment:
      # VPN Provider Settings (Example: Mullvad)
      - VPN_SERVICE_PROVIDER=mullvad
      - VPN_TYPE=wireguard
      - WIREGUARD_PRIVATE_KEY=your_private_key_here
      - WIREGUARD_ADDRESSES=10.64.x.x/32
      - SERVER_CITIES=Dallas,Chicago  # Nearby servers for best speed

      # Network Settings
      - FIREWALL_OUTBOUND_SUBNETS=192.168.1.0/24  # Allow LAN access
      - TZ=America/Chicago

      # Health Check
      - HEALTH_VPN_DURATION_INITIAL=30s
      - HEALTH_SUCCESS_WAIT_DURATION=5s
    restart: unless-stopped

  # qBittorrent - Routes through Gluetun VPN
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    network_mode: "service:gluetun"  # Use Gluetun's network stack
    depends_on:
      - gluetun
    volumes:
      - /mnt/cache/appdata/qbittorrentLS:/config
      - /mnt/user/data:/data
    environment:
      - PUID=99
      - PGID=100
      - TZ=America/Chicago
      - WEBUI_PORT=8085
    restart: unless-stopped

  # SABnzbd - Routes through Gluetun VPN
  sabnzbd:
    image: lscr.io/linuxserver/sabnzbd:latest
    container_name: sabnzbd
    network_mode: "service:gluetun"  # Use Gluetun's network stack
    depends_on:
      - gluetun
    volumes:
      - /mnt/cache/appdata/sabnzbd:/config
      - /mnt/user/data:/data
    environment:
      - PUID=99
      - PGID=100
      - TZ=America/Chicago
    restart: unless-stopped
```

**How This Works:**
1. Gluetun creates a VPN tunnel to your chosen provider (Mullvad, PIA, etc.)
2. qBittorrent and SABnzbd use `network_mode: "service:gluetun"`
3. ALL traffic from download clients goes through VPN tunnel
4. If VPN disconnects, download clients lose internet access (kill switch)
5. WebUIs are still accessible via Gluetun's exposed ports

### Option 2: Provider-Specific Container

Some VPN providers offer their own Docker containers (less flexible but simpler):

```yaml
  # Example: NordVPN Container
  nordvpn:
    image: ghcr.io/bubuntux/nordvpn:latest
    container_name: nordvpn
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun
    networks:
      - media
    ports:
      - "8085:8085"
      - "6881:6881"
      - "6881:6881/udp"
      - "8080:8080"
    environment:
      - TOKEN=your_nordvpn_token
      - CONNECT=United_States
      - TECHNOLOGY=NordLynx
      - NETWORK=192.168.1.0/24
      - TZ=America/Chicago
    restart: unless-stopped

  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    network_mode: "service:nordvpn"
    # ... rest of config
```

---

## Part 5: Setup Guide (Gluetun + Mullvad Example)

### Step 1: Get Mullvad Account

1. Go to https://mullvad.net/en/account/create/
2. Copy your 16-digit account number (e.g., `1234123412341234`)
3. Pay $5.50/mo (accepts credit card, PayPal, crypto, or cash by mail)

### Step 2: Generate WireGuard Keys

```bash
# On Tower (or any Linux machine)
ssh tower

# Install WireGuard tools
apt-get update && apt-get install -y wireguard-tools

# Generate private/public key pair
wg genkey | tee privatekey | wg pubkey > publickey

# View keys
cat privatekey   # Keep this SECRET
cat publickey    # Upload to Mullvad
```

### Step 3: Add Device to Mullvad

1. Go to https://mullvad.net/en/account/wireguard-config
2. Log in with your account number
3. Click "Generate a key" or "Add device"
4. Paste your PUBLIC key
5. Choose server (e.g., Dallas, Chicago for lowest latency)
6. Download WireGuard config OR note the settings

### Step 4: Update docker-compose.yml

```bash
ssh tower
cd /mnt/user/domains/docker-compose

# Backup existing config
cp docker-compose.yml docker-compose.yml.backup-$(date +%Y%m%d)

# Edit docker-compose.yml (use nano or vi)
nano docker-compose.yml
```

Add Gluetun section from Option 1 above, replacing:
- `WIREGUARD_PRIVATE_KEY` with your private key from Step 2
- `WIREGUARD_ADDRESSES` with IP from Mullvad config (usually 10.64.x.x/32)
- `SERVER_CITIES` with nearby cities (Dallas, Chicago, Los Angeles)

### Step 5: Deploy Changes

```bash
# Pull Gluetun image
docker compose pull gluetun

# Stop download clients
docker compose stop qbittorrent sabnzbd

# Start Gluetun first
docker compose up -d gluetun

# Wait for VPN to connect (check logs)
docker compose logs -f gluetun
# Look for: "ip getter: Public IP address is X.X.X.X (Mullvad)"

# Start download clients (they'll now use VPN network)
docker compose up -d qbittorrent sabnzbd
```

### Step 6: Verify VPN is Working

```bash
# Check qBittorrent's public IP (should be Mullvad IP, NOT 47.187.18.143)
docker compose exec qbittorrent curl -s ifconfig.me

# Check SABnzbd's public IP
docker compose exec sabnzbd curl -s ifconfig.me

# Check gluetun status
docker compose logs gluetun | grep "Public IP"
```

**Expected Output:**
- qBittorrent IP: `185.213.154.x` (Mullvad range, NOT your home IP)
- SABnzbd IP: Same Mullvad IP
- Gluetun logs: "Connected to Mullvad US-Dallas"

### Step 7: Test Access

1. **WebUIs (from Tailscale):**
   - qBittorrent: `http://100.120.125.46:8085`
   - SABnzbd: `http://100.120.125.46:8080`

2. **Test Kill Switch:**
   ```bash
   # Stop Gluetun (simulates VPN disconnect)
   docker compose stop gluetun

   # Try to access internet from qBittorrent (should FAIL)
   docker compose exec qbittorrent curl -s --max-time 5 ifconfig.me
   # Expected: Timeout or network unreachable

   # Restart Gluetun
   docker compose up -d gluetun
   ```

---

## Part 6: Tailscale Security Benefits (Already Active)

Your existing Tailscale setup is EXCELLENT and provides:

### 1. Secure Remote Access (Zero Trust)

**Without Tailscale (OLD WAY):**
```
Internet → Router Port Forwarding (32400) → Plex (EXPOSED!)
         → Anyone can scan and find your server
```

**With Tailscale (YOUR WAY):**
```
Internet → Tailscale Mesh Network (encrypted WireGuard) → Only your devices
         → No open ports on router
         → No public IP exposure
```

### 2. Authentication & Encryption

- ✅ **Device Authentication** - Only devices you explicitly authorize can join
- ✅ **End-to-End Encryption** - All traffic encrypted with WireGuard
- ✅ **Key Rotation** - Automatic key rotation every 24 hours
- ✅ **Coordination Server** - Tailscale servers only coordinate connections, never see traffic

### 3. ACLs (Access Control Lists)

You can control which devices can access which services:
```json
// Example Tailscale ACL
{
  "acls": [
    // Mac can access all Tower services
    {"action": "accept", "src": ["mac"], "dst": ["tower:*"]},

    // Green can only access PostgreSQL
    {"action": "accept", "src": ["green"], "dst": ["tower:5432"]}
  ]
}
```

### 4. MagicDNS

- ✅ Tower accessible via `tower.bat-saiph.ts.net` (no IP memorization)
- ✅ Works across network changes (Tower changes public IP? No problem!)
- ✅ Split DNS (Tailscale names only work on Tailscale network)

### 5. No Port Forwarding Needed

**Services Secured by Tailscale:**
- Plex (port 32400) - Only accessible via Tailscale
- Overseerr (port 5055) - Only accessible via Tailscale
- Sonarr, Radarr, Prowlarr - All private
- PostgreSQL (port 5432) - Only accessible via Tailscale
- Grafana, Netdata - Monitoring secure

**This prevents:**
- ❌ Bots scanning your public IP for vulnerabilities
- ❌ Unsolicited access attempts to services
- ❌ Exposure of admin panels to internet
- ❌ Router firewall complexity

---

## Part 7: Complete Security Architecture

### Current Architecture (After Adding VPN)

```
┌─────────────────────────────────────────────────────────────┐
│ YOUR DEVICES (Mac, iPhone, Green)                          │
│   ↓ [Tailscale WireGuard Tunnel - Encrypted]              │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ TOWER UNRAID (192.168.1.240 / 100.120.125.46)             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ SERVICES ACCESSED VIA TAILSCALE                     │  │
│  │  • Plex, Overseerr (exposed, but via Tailscale)     │  │
│  │  • Sonarr, Radarr, Prowlarr, Bazarr                 │  │
│  │  • PostgreSQL (Alexandria)                           │  │
│  │  • Grafana, Netdata, Portainer                       │  │
│  │  → YOUR IP: 47.187.18.143 (direct internet)         │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ DOWNLOAD CLIENTS (VPN PROTECTED)                    │  │
│  │                                                      │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │ Gluetun VPN Container                       │   │  │
│  │  │   ↓ [WireGuard to Mullvad/PIA]              │   │  │
│  │  │   → VPN IP: 185.213.x.x (Mullvad server)    │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  │           ↓                      ↓                  │  │
│  │  ┌────────────────┐     ┌──────────────────┐       │  │
│  │  │  qBittorrent   │     │     SABnzbd      │       │  │
│  │  │  (Torrents)    │     │     (Usenet)     │       │  │
│  │  └────────────────┘     └──────────────────┘       │  │
│  │  → ISP SEES: Encrypted VPN traffic only            │  │
│  │  → TORRENT SWARM SEES: Mullvad IP (not yours)      │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Security Layers

| Layer | Technology | Protects Against |
|-------|-----------|------------------|
| **Remote Access** | Tailscale | Port scanning, unauthorized access, public exposure |
| **Download Privacy** | Commercial VPN | ISP monitoring, copyright trolls, throttling |
| **Service Isolation** | Docker Networks | Container compromise, lateral movement |
| **Authentication** | Tailscale ACLs | Unauthorized device access |
| **Encryption (Remote)** | WireGuard | MITM attacks, eavesdropping |
| **Encryption (Download)** | VPN Tunnel | ISP deep packet inspection |

---

## Part 8: Cost Analysis

### Annual Costs

| Service | Cost/Year | Purpose | Required? |
|---------|-----------|---------|-----------|
| **Tailscale** | $0 (Free tier) | Remote access to homelab | ✅ Yes (already using) |
| **Mullvad VPN** | $66/year | Download client privacy | ⚠️ Recommended |
| **PIA VPN** | $40/year (sale) | Download client privacy (alternative) | ⚠️ Recommended |

**Total New Cost:** $40-66/year (~$3-5/month)

### What You Get for $5/month

1. ✅ **Privacy** - ISP can't see what you download
2. ✅ **No Copyright Notices** - Real IP hidden from torrent swarms
3. ✅ **No Throttling** - ISP can't selectively throttle torrent traffic
4. ✅ **Kill Switch** - Downloads stop if VPN disconnects
5. ✅ **Port Forwarding** - Better torrent performance (Mullvad, PIA support this)
6. ✅ **Multiple Devices** - Can use VPN on other devices too

---

## Part 9: Recommendations for Family Fun Project

### Pragmatic Approach (Recommended)

**Phase 1: Start with Free Testing (Do This First)**
1. Try Windscribe free tier (10GB/mo) with Gluetun
2. Test for 1 month to see if you like the setup
3. Verify performance (speed test, torrent speeds)
4. Ensure Tailscale access still works

**Phase 2: Commit to Paid VPN (If Phase 1 Works)**
1. Choose Mullvad ($5.50/mo) or wait for PIA sale ($3/mo)
2. Deploy Gluetun with WireGuard (fastest protocol)
3. Monitor for 1 week (ensure no issues with *arr apps)

**Phase 3: Maintenance (Ongoing)**
1. Check VPN connection monthly: `docker compose logs gluetun | grep "Public IP"`
2. Renew VPN subscription annually
3. Update Gluetun image quarterly: `docker compose pull gluetun && docker compose up -d gluetun`

### Skip VPN If...

You can SKIP the VPN if ALL these are true:
- ✅ You ONLY use private/encrypted Usenet providers
- ✅ You NEVER use public torrent trackers
- ✅ Your ISP has NEVER sent copyright notices or throttled you
- ✅ You're comfortable with ISP seeing your traffic patterns
- ✅ You live in a jurisdiction with strong privacy laws

**Reality Check:** For $5/month, VPN is cheap peace of mind.

---

## Part 10: Next Steps

### Immediate Actions (This Week)

1. **Decide on VPN provider:**
   - **Budget-conscious:** Wait for PIA sale (~$40/year)
   - **Privacy-focused:** Get Mullvad ($5.50/mo, no commitment)
   - **Just testing:** Try Windscribe free (10GB/mo)

2. **Read Gluetun docs:**
   - GitHub: https://github.com/qdm12/gluetun
   - Supported providers: https://github.com/qdm12/gluetun-wiki/tree/main/setup/providers
   - Mullvad setup: https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/mullvad.md

3. **Plan maintenance window:**
   - VPN setup will disconnect downloads for ~15 minutes
   - Plex/media playback will NOT be affected (separate network)
   - Best time: Evening when family isn't watching

### Reference Commands

```bash
# Check current public IP (before VPN)
ssh tower "docker compose exec qbittorrent curl -s ifconfig.me"
# Expected: 47.187.18.143 (your home IP)

# After VPN setup
ssh tower "docker compose exec qbittorrent curl -s ifconfig.me"
# Expected: 185.213.x.x (Mullvad) or different VPN IP

# Check VPN status
ssh tower "docker compose logs gluetun | tail -20"

# Restart VPN if needed
ssh tower "cd /mnt/user/domains/docker-compose && docker compose restart gluetun"

# View Tailscale status
ssh tower "tailscale status"
```

---

## Part 11: FAQ

### Q1: Will VPN slow down my downloads?

**A:** Minimal impact if you choose nearby servers.
- Without VPN: 500 Mbps (your ISP max)
- With Mullvad (Dallas): 450-480 Mbps (5-10% overhead)
- With Mullvad (Europe): 200-300 Mbps (distance penalty)

**Tip:** Use WireGuard protocol (not OpenVPN) and choose servers in Dallas/Chicago.

### Q2: Can I access qBittorrent WebUI with VPN?

**A:** Yes! WebUI is still accessible via Tailscale.
- Before VPN: `http://192.168.1.240:8085`
- After VPN: `http://100.120.125.46:8085` (Tailscale IP)
- The WebUI traffic does NOT go through VPN (only download traffic does)

### Q3: What if VPN disconnects?

**A:** Kill switch prevents leaks.
- Download clients CANNOT access internet if VPN is down
- They'll retry when VPN reconnects (automatic)
- Gluetun logs will show "VPN connection lost, reconnecting..."

### Q4: Will this affect Plex streaming?

**A:** No! Plex is NOT routed through VPN.
- Plex uses `network_mode: host` (direct internet)
- Only qBittorrent and SABnzbd use VPN
- Family can still stream via Tailscale or Plex.tv

### Q5: Can I use the same VPN on multiple devices?

**A:** Yes! Most VPN providers allow 5-10 simultaneous connections.
- Tower (download clients): 1 connection
- Laptop when traveling: 1 connection
- Phone: 1 connection
- Total: 3 simultaneous (well under limit)

### Q6: How do I know if VPN is working?

**A:** Three checks:
1. **IP Test:** `docker compose exec qbittorrent curl -s ifconfig.me` should show VPN IP
2. **DNS Leak Test:** Visit https://www.dnsleaktest.com/ from qBittorrent
3. **Torrent IP Test:** Download a tracking torrent from https://ipleak.net/ and check IP

### Q7: Does Tailscale conflict with VPN?

**A:** No! They work together perfectly.
- Tailscale secures INBOUND access (you → Tower)
- VPN secures OUTBOUND traffic (download clients → internet)
- Completely separate network paths

### Q8: What about Alexandria (Cloudflare Worker)?

**A:** No changes needed!
- Alexandria Worker → Hyperdrive → Tunnel → PostgreSQL (all stays same)
- PostgreSQL runs on Tower, accessible via Tailscale (no VPN involved)
- Worker traffic does NOT go through VPN (only download clients do)

---

## Part 12: Conclusion

### Key Takeaways

**Tailscale:**
- ✅ Already working perfectly
- ✅ Secures remote access to ALL Tower services
- ✅ No public exposure, no port forwarding
- ✅ Keep using exactly as-is (no changes needed)

**VPN (New Recommendation):**
- ⚠️ Currently missing - Your ISP sees download activity
- ✅ Add Gluetun + Mullvad for $5/mo
- ✅ Hides download traffic from ISP and copyright trolls
- ✅ Works alongside Tailscale (not a replacement)

**Bottom Line:**
- **Tailscale** = Secure tunnel TO your homelab (already great!)
- **VPN** = Secure tunnel FROM your homelab for downloads (add this)

**Think of it like:**
- **Tailscale** = Your private driveway (only you can enter)
- **VPN** = Tinted windows on your car (nobody sees what you're carrying)

Both are useful, neither replaces the other.

---

## Appendix A: Quick Start Command Checklist

```bash
# 1. Get Mullvad account
# Visit: https://mullvad.net/en/account/create/
# Cost: $5.50/month
# Save account number: ________________

# 2. Generate WireGuard keys
ssh tower
wg genkey | tee privatekey | wg pubkey > publickey
cat privatekey  # Save this: ________________
cat publickey   # Upload to Mullvad website

# 3. Backup current docker-compose.yml
ssh tower "cp /mnt/user/domains/docker-compose/docker-compose.yml /mnt/user/domains/docker-compose/docker-compose.yml.backup-$(date +%Y%m%d)"

# 4. Edit docker-compose.yml
# Add Gluetun section (see Part 4)

# 5. Deploy
ssh tower "cd /mnt/user/domains/docker-compose && docker compose pull gluetun"
ssh tower "cd /mnt/user/domains/docker-compose && docker compose up -d gluetun"
ssh tower "cd /mnt/user/domains/docker-compose && docker compose logs -f gluetun"
# Wait for: "Public IP address is X.X.X.X"

# 6. Restart download clients
ssh tower "cd /mnt/user/domains/docker-compose && docker compose restart qbittorrent sabnzbd"

# 7. Verify VPN is working
ssh tower "docker compose exec qbittorrent curl -s ifconfig.me"
# Expected: Mullvad IP (NOT 47.187.18.143)

# 8. Test WebUI access
# Visit: http://100.120.125.46:8085 (qBittorrent)
# Visit: http://100.120.125.46:8080 (SABnzbd)

# 9. Done! Monitor for 24 hours
ssh tower "docker compose logs -f gluetun"
```

---

**Document Version:** 1.0
**Last Updated:** January 16, 2026
**Next Review:** Add VPN within 1 week (test before committing to paid plan)

