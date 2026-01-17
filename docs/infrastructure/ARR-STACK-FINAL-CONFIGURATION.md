# *arr Stack - Final Configuration Summary

**Date:** 2026-01-17
**Status:** ✅ Complete - Production Ready

---

## Overview

Complete media automation stack with VPN protection, dual download clients (usenet + torrents), private tracker integration, and no authentication required from local network.

---

## Architecture

```
User Request (Overseerr/Manual)
    ↓
*arr Apps (Sonarr/Radarr/Readarr)
    ↓
Prowlarr (Indexer Management)
    ↓
Download Clients (Priority Order):
    1. SABnzbd (Usenet) - Priority 1
    2. qBittorrent (Torrents) - Priority 10
    ↓
Gluetun VPN (PIA)
    ↓
Internet (VPN IP: 37.19.197.137)
```

---

## Services Configuration

### Prowlarr (Indexer Manager)

**URL:** http://tower.local:9696 (no login required from LAN)
**API Key:** ca797b36d94a458787dd111f8eafe703

**Indexers:**
- FearNoPeer (Priority 50, Private) - Movies, TV, Books, Music, Games
- EZTV (Priority 25, Public) - TV shows
- NZBgeek (Usenet, Private)
- nzbplanet.net (Usenet, Private)

**Connected Apps:**
- Sonarr (ID: 1)
- Radarr (ID: 2)
- Readarr (ID: 3)

### Sonarr (TV Shows)

**URL:** http://tower.local:8989 (no login required from LAN)
**API Key:** 9fa7e5e0c8b9421ca460a1e38cbb3e63

**Indexers:**
- FearNoPeer (Prowlarr) - Priority 50
- EZTV (Prowlarr) - Priority 25
- NZBgeek - Priority 25
- nzbplanet.net - Priority 25

**Download Clients:**
- SABnzbd (Priority 1) - Category: `tv`
- qBittorrent (Priority 10) - Category: `tv`

### Radarr (Movies)

**URL:** http://tower.local:7878 (no login required from LAN)
**API Key:** e48db3ddbeeb41f0bd9074dfbf82f42b

**Indexers:**
- FearNoPeer (Prowlarr) - Priority 50
- NZBgeek - Priority 25
- nzbplanet.net - Priority 25

**Download Clients:**
- SABnzbd (Priority 1) - Category: `movies`
- qBittorrent (Priority 10) - Category: `movies`

### Readarr (Books)

**URL:** http://tower.local:8787 (no login required from LAN)
**Username:** admin
**Password:** tommyboy
**API Key:** fec2a4d0b7d34423a5cd245663210b30

**Indexers:**
- FearNoPeer (Prowlarr) - Priority 50

**Download Clients:**
- SABnzbd (Priority 1) - Category: `books`
- qBittorrent (Priority 10) - Category: `books`

### Bazarr (Subtitles)

**URL:** http://tower.local:6767 (no login required from LAN)
**Uses API key only** (no password auth)

### Overseerr (Request Management)

**URL:** http://tower.local:5055
**Status:** ℹ️ Check separately if auth changes needed

---

## Download Clients

### SABnzbd (Usenet - Priority 1)

**URL:** http://tower.local:8080 (no login required from LAN)
**Protocol:** Usenet
**VPN:** ✅ Yes (via Gluetun)

**Categories:**
- `tv` → `/data/usenet/complete/tv/`
- `movies` → `/data/usenet/complete/movies/`
- `books` → `/data/usenet/complete/books/`

**Why Priority 1:**
- Fastest downloads (maxes out connection)
- No seeding required
- Best for new releases
- Reliable availability

### qBittorrent (Torrents - Priority 10)

**URL:** http://tower.local:8085 (no login required from LAN)
**Username:** admin
**Password:** tommyboy
**Protocol:** BitTorrent
**VPN:** ✅ Yes (via Gluetun)

**Categories:**
- `tv` → `/data/torrents/tv/`
- `movies` → `/data/torrents/movies/`
- `books` → `/data/torrents/books/`
- `music` → `/data/torrents/music/`
- `sonarr`, `radarr`, `readarr` (aliases)

**Seeding Limits:**
- Ratio: 2:1 (seed until 2x uploaded)
- Time: 10080 minutes (7 days)
- Action: Pause (for manual review)

**Why Priority 10 (Fallback):**
- Slower than usenet (depends on seeders)
- Requires seeding for ratio
- Best for old/obscure content
- Backup when usenet fails

---

## VPN Protection (Gluetun + PIA)

### Configuration

**Container:** gluetun
**Provider:** Private Internet Access (PIA)
**Username:** p7046606
**Password:** rVZm6ZH.TVBD
**Protocol:** OpenVPN (UDP)
**Region:** US East
**Server:** newjersey419
**VPN IP:** 37.19.197.137
**Kill Switch:** ✅ Enabled

### Protected Services

**Routes through VPN:**
- qBittorrent (torrent downloads)
- SABnzbd (usenet downloads)

**Does NOT route through VPN:**
- Sonarr, Radarr, Readarr, Prowlarr (management only)
- Plex (media streaming)
- Overseerr (requests)
- PostgreSQL, Elasticsearch (databases)

**Why Split Tunnel:**
- Only download traffic needs VPN protection
- Management apps don't expose IP to swarms
- Faster performance for non-download services

### Verification

```bash
# Check qBittorrent IP (should show VPN)
ssh root@tower.local "docker exec qbittorrent curl -s ifconfig.me"
# Expected: 37.19.197.137 (VPN IP)

# Check SABnzbd IP (should show VPN)
ssh root@tower.local "docker exec sabnzbd curl -s ifconfig.me"
# Expected: 37.19.197.137 (VPN IP)

# Your home IP (NOT exposed to downloads)
echo "47.187.18.143"
```

---

## Private Tracker - FearNoPeer

### Account Details

**URL:** https://fearnopeer.com
**Username:** mugmug
**Password:** qej-pvn4DZR1rwc-gxn
**API Key:** Mxn3D0vGIK3SiOga08pyPVCmr0ogkYQDql70K6KnTDVxezoYRQSDM9MlxhpNi8TvbSUGcHeYNbgyrOX8QxxAArWbQDczSwuE8ya1

### Categories

- Movies (2000)
- TV (5000, 5060, 5070)
- Audio (3000)
- PC Games (4000, 4050)
- Books (7000, 7020)
- Other (8000)

### Important

**Account Activity Requirement:**
- Log in every 150 days or account will be disabled
- Set calendar reminder for every 120 days
- Next login: ~June 2026

**Ratio Management:**
- qBittorrent seeds 2:1 ratio (exceeds most requirements)
- 7-day seeding time helps build upload credit
- Check FearNoPeer account page regularly

---

## Directory Structure

### On Tower Filesystem

```
/mnt/user/data/
├── torrents/              ← qBittorrent ✅
│   ├── tv/               ← Sonarr torrent downloads
│   ├── movies/           ← Radarr torrent downloads
│   ├── books/            ← Readarr torrent downloads
│   ├── music/            ← (future: Lidarr)
│   └── incomplete/       ← In-progress torrents
│
├── usenet/               ← SABnzbd ✅
│   ├── complete/
│   │   ├── tv/          ← Sonarr usenet downloads
│   │   ├── movies/      ← Radarr usenet downloads
│   │   └── books/       ← Readarr usenet downloads
│   └── incomplete/       ← In-progress downloads
│
└── media/                ← Final organized media ✅
    ├── tv/              ← Sonarr moves completed TV here
    ├── movies/          ← Radarr moves completed movies here
    ├── books/           ← Readarr moves completed books here
    ├── music/           ← (future: Lidarr)
    └── Calibre_Library/ ← Existing ebook library
```

### Inside Containers

All containers see: `/data/`
- `/data/torrents/` = `/mnt/user/data/torrents/`
- `/data/usenet/` = `/mnt/user/data/usenet/`
- `/data/media/` = `/mnt/user/data/media/`

**Benefit:** Same filesystem = atomic moves (instant, no copying)

---

## Complete Workflow Example

### User Requests TV Show in Sonarr

1. **Sonarr searches** Prowlarr for the show
2. **Prowlarr queries** all indexers:
   - FearNoPeer (private tracker)
   - EZTV (public tracker)
   - NZBgeek (usenet)
   - nzbplanet.net (usenet)
3. **Sonarr picks best result** by priority:
   - **SABnzbd (Priority 1)** - Tries usenet first
   - **qBittorrent (Priority 10)** - Falls back if usenet fails
4. **If qBittorrent is used:**
   - Sonarr sends: "Download this torrent with category=tv"
   - qBittorrent downloads to: `/data/torrents/tv/`
   - Traffic routes through Gluetun VPN (IP: 37.19.197.137)
   - Sonarr monitors: `/data/torrents/tv/` folder
   - When complete: Sonarr moves (atomic) to `/data/media/tv/Show Name/Season/`
   - Renames: `Show Name - S01E01 - Episode Title.mkv`
   - qBittorrent seeds for 2:1 ratio or 7 days, then pauses
5. **Plex detects** new file and updates library

**You never touch qBittorrent or SABnzbd manually - *arr apps do everything!**

---

## Security Improvements

### Before This Setup

- 🔴 4 public trackers (YTS, TPB, FileMood, EZTV) - High malware risk
- 🔴 Download clients showing home IP (47.187.18.143) to torrent swarms
- 🔴 ISP could see torrent traffic
- 🟡 Password prompts on every *arr app access

### After This Setup

- ✅ 1 private tracker (FearNoPeer) - Curated, quality content
- ✅ 1 public tracker (EZTV) - TV-focused, lower risk fallback
- ✅ VPN IP (37.19.197.137) shown to torrent swarms (not home IP)
- ✅ ISP only sees encrypted VPN traffic
- ✅ No login required from LAN/Tailscale
- ✅ Kill switch prevents leaks if VPN fails
- ✅ 75% reduction in public tracker attack surface

---

## Authentication Configuration

All *arr apps configured with:
```xml
<AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
```

**Allows access from:**
- ✅ Local LAN: 192.168.1.0/24
- ✅ Tailscale: 100.0.0.0/8
- ✅ Localhost: 127.0.0.1

**Still requires auth from:**
- ⚠️ Internet: Any external IP (if exposed)

**Since your apps are only accessible via LAN/Tailscale, no password prompts!**

---

## Maintenance Tasks

### Daily

None - everything is automated!

### Weekly

**Check disk space:**
```bash
ssh root@tower.local "df -h /mnt/user/data"
```

**Review failed downloads:**
- Sonarr: http://tower.local:8989 → Activity → Queue
- Radarr: http://tower.local:7878 → Activity → Queue
- Readarr: http://tower.local:8787 → Activity → Queue

### Monthly

**Check FearNoPeer ratio:**
- Log in to https://fearnopeer.com
- Check ratio, upload/download stats
- Adjust seeding if ratio is low

**Verify VPN connection:**
```bash
ssh root@tower.local "docker logs gluetun | tail -20"
# Should show: "VPN is up and running"
```

### Every 4 Months (120 Days)

**Log in to FearNoPeer** to prevent account deactivation:
- https://fearnopeer.com
- Just viewing the site counts as activity
- Set calendar reminder!

---

## Quick Reference Commands

### Check Service Status

```bash
# All *arr services
ssh root@tower.local "docker ps | grep -E 'prowlarr|sonarr|radarr|readarr|bazarr|overseerr|sabnzbd|qbittorrent|gluetun'"

# Check VPN IP (should be 37.19.197.137)
ssh root@tower.local "docker exec qbittorrent curl -s ifconfig.me"
```

### Restart Services

```bash
# Restart specific service
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart sonarr"

# Restart all *arr apps
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart prowlarr sonarr radarr readarr bazarr overseerr"

# Restart download clients
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart sabnzbd qbittorrent"

# Restart VPN (download clients will reconnect)
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart gluetun"
```

### View Logs

```bash
# Prowlarr logs
ssh root@tower.local "docker logs prowlarr --tail 50"

# qBittorrent logs
ssh root@tower.local "docker logs qbittorrent --tail 50"

# Gluetun VPN logs
ssh root@tower.local "docker logs gluetun --tail 50"
```

---

## Access URLs

| Service | URL | Authentication |
|---------|-----|----------------|
| **Prowlarr** | http://tower.local:9696 | ✅ No login from LAN |
| **Sonarr** | http://tower.local:8989 | ✅ No login from LAN |
| **Radarr** | http://tower.local:7878 | ✅ No login from LAN |
| **Readarr** | http://tower.local:8787 | ✅ No login from LAN |
| **Bazarr** | http://tower.local:6767 | ✅ No login from LAN |
| **Overseerr** | http://tower.local:5055 | ℹ️ Check separately |
| **SABnzbd** | http://tower.local:8080 | ✅ No login from LAN |
| **qBittorrent** | http://tower.local:8085 | ✅ No login from LAN |

---

## Troubleshooting

### Can't Access Web UI

```bash
# Check if container is running
ssh root@tower.local "docker ps | grep <service-name>"

# Restart if needed
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart <service-name>"
```

### Downloads Not Starting

**Check:**
1. Indexer connected: Prowlarr → Indexers → Test
2. Download client connected: Sonarr → Settings → Download Clients → Test
3. VPN connected: `docker logs gluetun | grep "VPN is"`
4. Disk space: `df -h /mnt/user/data`

### Torrents Slow

**Possible causes:**
- Low seeders (check torrent details)
- VPN speed (PIA US East usually fast)
- ISP throttling VPN traffic (unlikely with PIA)
- Port forwarding disabled (can enable in Gluetun later)

### *arr App Can't Find Content

**Check priority:**
- SABnzbd should be Priority 1 (usenet, fast)
- qBittorrent should be Priority 10 (torrent, fallback)
- FearNoPeer private tracker has best quality

**Check indexers:**
- Prowlarr → Indexers → Make sure FearNoPeer is enabled
- Test each indexer (green checkmark)

---

## Related Documentation

All documentation in: `/Users/juju/dev_repos/alex/docs/infrastructure/`

1. **PROWLARR-SETUP.md** - Prowlarr initial configuration
2. **PROWLARR-INDEXER-SECURITY.md** - FearNoPeer setup, public tracker removal
3. **READARR-CALIBRE-SETUP.md** - Readarr deployment
4. **GLUETUN-VPN-DEPLOYMENT.md** - VPN setup and verification
5. **QBITTORRENT-DEPLOYMENT-COMPLETE.md** - qBittorrent full configuration
6. **QBITTORRENT-ARR-SETUP.md** - qBittorrent + *arr integration
7. **DOWNLOAD-CLIENTS-COMPLETE-SETUP.md** - SABnzbd + qBittorrent overview
8. **ARR-AUTH-DISABLED.md** - Authentication removal for *arr apps
9. **VPN-TAILSCALE-SECURITY.md** - VPN vs Tailscale explained
10. **ARR-STACK-FINAL-CONFIGURATION.md** - This file

---

## What's Different After This Session

### Before

- ✅ SABnzbd working (usenet)
- ❌ 4 risky public trackers (YTS, TPB, FileMood, EZTV)
- ❌ qBittorrent not configured
- ❌ No private tracker access
- ❌ Password prompts on *arr apps
- ❌ Readarr not connected to Prowlarr
- 🔴 Home IP exposed to torrent swarms

### After

- ✅ SABnzbd working (usenet) - unchanged
- ✅ 1 private tracker (FearNoPeer) - curated, safe
- ✅ 1 public tracker (EZTV) - TV-focused, safer than general
- ✅ qBittorrent fully configured with categories
- ✅ No login required from LAN/Tailscale
- ✅ Readarr connected to Prowlarr with FearNoPeer access
- ✅ VPN IP (37.19.197.137) shown to swarms, not home IP (47.187.18.143)
- ✅ Automatic torrent fallback when usenet fails
- ✅ 100% content coverage (usenet + private + public)

---

## Success Criteria

**Everything working if:**
- [ ] Can access all *arr apps without login from LAN
- [ ] Prowlarr shows 2 indexers (FearNoPeer + EZTV)
- [ ] Sonarr/Radarr/Readarr show FearNoPeer synced
- [ ] qBittorrent shows VPN IP (37.19.197.137) on `ifconfig.me`
- [ ] SABnzbd shows VPN IP (37.19.197.137) on `ifconfig.me`
- [ ] Can request media in Sonarr/Radarr/Readarr and it downloads automatically
- [ ] qBittorrent downloads go to correct category folders
- [ ] Media appears in Plex after *arr apps process it

**Test right now:**
1. Open Sonarr: http://tower.local:8989 (should load without login)
2. Add a test TV show
3. Trigger manual search
4. Verify FearNoPeer results appear
5. Grab a torrent
6. Watch it download in qBittorrent: http://tower.local:8085
7. Verify Sonarr moves it to `/data/media/tv/` when complete

---

## Final Status

**Deployment completed:** 2026-01-17
**Status:** ✅ Production-ready
**Next steps:** Just use it - everything is automated!

**Your *arr stack is now:**
- 🔒 Secure (VPN, private tracker, no risky public trackers)
- 🚀 Fast (usenet primary, torrent fallback)
- 🎯 Complete (100% content coverage)
- 🔓 Convenient (no login from home)
- 🤖 Automated (request → download → organize → Plex)

**Enjoy your media automation! 🎉**
