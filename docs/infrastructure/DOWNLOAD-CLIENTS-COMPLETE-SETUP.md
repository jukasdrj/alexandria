# Complete Download Clients Setup - SABnzbd + qBittorrent

**Date:** 2026-01-17
**Status:** SABnzbd ✅ Working | qBittorrent ⏳ Needs Configuration

---

## 📋 Overview

Your download setup uses BOTH usenet (SABnzbd) and torrents (qBittorrent) for maximum content availability.

### Current Status

| Client | Protocol | Status | VPN Protected | Categories |
|--------|----------|--------|---------------|------------|
| **SABnzbd** | Usenet | ✅ Working | ✅ Yes (via Gluetun) | tv, movies, books |
| **qBittorrent** | Torrents | ⏳ Needs setup | ✅ Yes (via Gluetun) | Not configured yet |

---

## 🗂️ Your Directory Structure

### Visual Map

```
Tower: /mnt/user/data/
    │
    ├── torrents/              ← qBittorrent downloads here
    │   ├── tv/               ← Sonarr's torrent downloads
    │   ├── movies/           ← Radarr's torrent downloads
    │   ├── books/            ← Readarr's torrent downloads
    │   ├── music/            ← (future: Lidarr)
    │   └── incomplete/       ← In-progress torrents
    │
    ├── usenet/               ← SABnzbd downloads here ✅ WORKING
    │   ├── complete/
    │   │   ├── tv/          ← Sonarr monitors this
    │   │   ├── movies/      ← Radarr monitors this
    │   │   └── books/       ← Readarr monitors this
    │   ├── incomplete/       ← In-progress downloads
    │   └── movies/           ← (legacy, can remove)
    │
    └── media/                ← Final organized media ✅ WORKING
        ├── tv/              ← Sonarr moves completed TV here
        ├── movies/          ← Radarr moves completed movies here
        ├── books/           ← Readarr moves completed books here
        ├── music/           ← (future: Lidarr)
        └── Calibre_Library/ ← Your ebook library
```

### Inside Containers

All apps see these paths as `/data/`:
- `/data/torrents/` = `/mnt/user/data/torrents/` (on Tower)
- `/data/usenet/` = `/mnt/user/data/usenet/` (on Tower)
- `/data/media/` = `/mnt/user/data/media/` (on Tower)

**Why this matters:** Using the same `/data` prefix enables **atomic moves** (instant file moves, no copying).

---

## ✅ SABnzbd Configuration (Already Working)

### Current Settings

**Access:** http://tower.local:8080 (no login from LAN)

**Download Paths:**
- Incomplete: `/data/usenet/incomplete/` (temp storage during download)
- Complete: `/data/usenet/complete/` (finished downloads)

**Categories Configured:**

| Category | Folder | Used By | Status |
|----------|--------|---------|--------|
| `movies` | `/data/usenet/complete/movies` | Radarr | ✅ Working |
| `tv` | `/data/usenet/complete/tv` | Sonarr | ✅ Working |
| `books` | `/data/usenet/complete/books` | Readarr | ✅ Working |

**VPN Protection:**
- ✅ Routes through Gluetun
- ✅ ISP only sees encrypted traffic to usenet provider
- ✅ VPN IP: 37.19.197.137 (not your home IP)

### SABnzbd Improvements (Optional)

#### 1. Verify Complete Download Handling

**Settings → Categories → Each category:**
- **Post-processing:** Check that it's NOT set to "Delete" (let *arr apps handle this)
- Should be: "+Repair" and "+Unpack" only

#### 2. Check Connection Security

**Settings → Servers:**
- SSL: ✅ Should be enabled (443 or 563)
- Ensures encrypted connection to usenet provider

#### 3. Optimize Performance

**Settings → General:**
- **Article Cache Limit:** Set to `512M` or `1024M` (if you have RAM)
  - Speeds up downloads by caching articles in memory

**Settings → Switches:**
- **Direct Unpack:** ✅ Enable (extracts while downloading - faster)
- **Ignore Samples:** ✅ Enable (don't extract sample files)

#### 4. Failed Download Handling

**Settings → Switches:**
- **Abort jobs that cannot be completed:** ✅ Enable
  - Auto-aborts if file is incomplete on usenet

---

## ⏳ qBittorrent Configuration (Needs Setup)

### Access

**URL:** http://tower.local:8085

**Get Default Password:**
```bash
ssh root@tower.local "docker logs qbittorrent 2>&1 | grep -i password | tail -5"
```

**Expected:** Username: `admin` | Password: `adminadmin` (or shown in logs)

### Configuration Steps

**See:** `/Users/juju/dev_repos/alex/docs/infrastructure/QBITTORRENT-ARR-SETUP.md` for detailed guide.

**Quick checklist:**
1. Change default password → `tommyboy` (to match other services)
2. Set default save path → `/data/torrents/`
3. Enable incomplete downloads → `/data/torrents/incomplete/`
4. Create categories:
   - `tv` → `/data/torrents/tv/`
   - `movies` → `/data/torrents/movies/`
   - `books` → `/data/torrents/books/`
5. Disable UPnP (VPN handles port forwarding)
6. Set seeding limits (2:1 ratio or 5 days)

### Add to *arr Apps

**In each *arr app (Sonarr, Radarr, Readarr):**
1. Settings → Download Clients → Add (+) → qBittorrent
2. **Host:** `gluetun` (NOT `qbittorrent` - routes through VPN!)
3. **Port:** `8085`
4. **Category:** `tv` (for Sonarr), `movies` (for Radarr), `books` (for Readarr)
5. Test → Save

---

## 🔄 The Complete Workflow

### Example: Sonarr Downloads a TV Show

#### Via SABnzbd (Usenet) - Your Current Working Setup

1. **User requests show** (Overseerr or manual add in Sonarr)
2. **Sonarr searches** Prowlarr indexers
3. **Prowlarr returns** usenet (NZB) + torrent results
4. **Sonarr picks best** (SABnzbd = priority 1)
5. **SABnzbd downloads** to `/data/usenet/incomplete/`
6. **SABnzbd completes** → moves to `/data/usenet/complete/tv/`
7. **Sonarr monitors** `/data/usenet/complete/tv/` folder
8. **Sonarr detects** completed file
9. **Sonarr moves** (atomic) to `/data/media/tv/Show Name/Season 01/`
10. **Sonarr renames** to proper format: `Show Name - S01E01 - Episode Title.mkv`
11. **Sonarr removes** NZB from SABnzbd queue
12. **Plex detects** new file and updates library

#### Via qBittorrent (Torrents) - After Configuration

Same process, but:
- Downloads to `/data/torrents/tv/` instead
- Falls back if usenet fails or is unavailable
- Uses VPN to hide your IP from torrent swarms

---

## 🎯 Download Client Priority

### Recommended Setup in *arr Apps

**Settings → Download Clients → Manage Clients:**

Drag to reorder priority:

| Priority | Client | Protocol | Use Case |
|----------|--------|----------|----------|
| **1** | SABnzbd | Usenet | Primary - Fast, reliable for new content |
| **10** | qBittorrent | Torrents | Fallback - Old/obscure content |

**Why this order:**
- ✅ Usenet is faster (maxes out your connection)
- ✅ Usenet has better retention (years of availability)
- ✅ Torrents as fallback for content not on usenet
- ✅ Best of both worlds

---

## 🛡️ VPN Protection for Both Clients

### How It Works

```
Your Request → *arr App → Prowlarr → Indexer
                 ↓
         Download Client (SABnzbd/qBittorrent)
                 ↓
            Gluetun VPN
                 ↓
         PIA VPN Server (37.19.197.137)
                 ↓
         Usenet Provider / Torrent Swarm
```

**ISP sees:** Encrypted traffic to PIA server
**ISP does NOT see:** What you download, which sites, which torrents

### Verify VPN Protection

```bash
# Check SABnzbd IP
ssh root@tower.local "docker exec sabnzbd curl -s ifconfig.me"
# Expected: 37.19.197.137 (VPN IP)

# Check qBittorrent IP
ssh root@tower.local "docker exec qbittorrent curl -s ifconfig.me"
# Expected: 37.19.197.137 (VPN IP)

# Your home IP (NOT shown to downloads)
echo "47.187.18.143"
```

✅ Both should show **37.19.197.137** (PIA VPN), NOT your home IP!

---

## 📊 Performance Comparison

### SABnzbd (Usenet)

**Pros:**
- ✅ Very fast (maxes out connection, typically 50-100 MB/s)
- ✅ No seeding required (download and done)
- ✅ Excellent retention (3000+ days on good providers)
- ✅ Encrypted to provider (ISP can't see file names)
- ✅ Reliable availability for new releases

**Cons:**
- ❌ Requires paid usenet provider ($5-15/month)
- ❌ DMCA takedowns can remove files
- ❌ Older content may be incomplete

**Best for:**
- New TV episodes (available within minutes)
- Recent movies
- Bulk downloads (seasons, series)

### qBittorrent (Torrents)

**Pros:**
- ✅ Free (no provider costs, just VPN $5/month)
- ✅ Great for old/obscure content (if seeders exist)
- ✅ No file expiration (torrents live forever if seeded)
- ✅ Community-driven (someone always has rare content)

**Cons:**
- ❌ Speed depends on seeders (can be slow for unpopular content)
- ❌ Requires seeding (good torrent citizenship)
- ❌ Your IP visible to swarms (but VPN hides it)
- ❌ Can be unreliable for very new releases

**Best for:**
- Old movies/shows not on usenet
- Obscure content
- When usenet fails
- Public domain / legal torrents

### Together = Perfect

| Scenario | Winner | Why |
|----------|--------|-----|
| New TV episode | SABnzbd | Available immediately, fast |
| 10-year-old movie | qBittorrent | May not be on usenet anymore |
| Entire TV series | SABnzbd | Fast bulk download |
| Rare documentary | qBittorrent | Community has it |
| 4K remux (50GB) | SABnzbd | Max speed, no seeding wait |

---

## 🔧 Maintenance Tasks

### Weekly

**Check disk space:**
```bash
ssh root@tower.local "df -h /mnt/user/data"
```

**Clean up old incomplete downloads:**
```bash
# SABnzbd
ssh root@tower.local "ls -lah /mnt/user/data/usenet/incomplete/"

# qBittorrent
ssh root@tower.local "ls -lah /mnt/user/data/torrents/incomplete/"
```

**Review failed downloads:**
- SABnzbd: http://tower.local:8080 → History → Failed
- Sonarr: http://tower.local:8989 → Activity → Queue → Manual Search

### Monthly

**Check usenet provider health:**
- Review completion rates in SABnzbd
- If many failures, provider retention may be low

**Review qBittorrent seeding:**
- Tools → Transfer List → Filter by "Seeding"
- Pause/remove old torrents that have hit ratio goals

**Verify VPN connection:**
```bash
ssh root@tower.local "docker logs gluetun | tail -20"
# Should show: "VPN is up and running"
```

### As Needed

**Update download clients:**
- Watchtower auto-updates daily at 4am
- Check: `docker ps | grep -E 'sabnzbd|qbittorrent'` for "healthy" status

**Re-add categories if needed:**
- After updates, occasionally categories reset
- Check qBittorrent categories still exist

---

## 🚨 Troubleshooting

### SABnzbd Issues

**Downloads failing with "Incomplete":**
- Usenet provider retention too low
- Try different indexer in Prowlarr
- Fall back to qBittorrent

**SABnzbd Web UI not accessible:**
```bash
# Check container
ssh root@tower.local "docker ps | grep sabnzbd"

# Restart if needed
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart sabnzbd"
```

**Downloads stuck in queue:**
- Check SABnzbd → Status → Warnings
- Verify usenet provider credentials
- Check disk space: `df -h /mnt/user/data`

### qBittorrent Issues

**Can't access Web UI:**
```bash
# Check container (should show Up X minutes)
ssh root@tower.local "docker ps | grep qbittorrent"

# Get default password
ssh root@tower.local "docker logs qbittorrent 2>&1 | grep password"
```

**Torrents not starting:**
- Verify category exists
- Check disk space
- Ensure VPN is connected (check Gluetun logs)

**Slow torrent speeds:**
- Check seeders/leechers ratio (need more seeders)
- Enable port forwarding in Gluetun (see GLUETUN-VPN-DEPLOYMENT.md)
- Verify VPN connection stable

### *arr Apps Not Importing

**Files stay in download folder:**
1. Check *arr app → Settings → Download Clients → "Completed Download Handling" ✅ Enabled
2. Verify paths match (both use `/data/`)
3. Check *arr logs → System → Logs → filter by "Import"

**"Unable to move" errors:**
- Different filesystems (should both be `/data`)
- Permissions issue (all should be nobody:users PUID=99 PGID=100)
- Disk full

---

## 📈 Optimization Tips

### SABnzbd Performance

1. **Increase article cache** (if you have RAM):
   - Settings → General → Article Cache: `1024M`

2. **Enable direct unpack**:
   - Settings → Switches → Direct Unpack ✅

3. **Multiple servers** (if you have backup provider):
   - Settings → Servers → Add secondary server
   - Improves completion rate

### qBittorrent Performance

1. **Connection limits**:
   - Tools → Options → Connection
   - Global max connections: `500`
   - Max connections per torrent: `100`

2. **Disk cache**:
   - Tools → Options → Advanced → Disk cache: `1024` MB

3. **Seeding optimization**:
   - Set ratio to 2:1 (good citizenship)
   - Or time-based: 7 days
   - Then pause (saves bandwidth)

---

## 🎯 Quick Reference Commands

### Check Download Client IPs (Verify VPN)
```bash
# SABnzbd IP
ssh root@tower.local "docker exec sabnzbd curl -s ifconfig.me"

# qBittorrent IP
ssh root@tower.local "docker exec qbittorrent curl -s ifconfig.me"

# Expected: 37.19.197.137 (VPN IP, NOT 47.187.18.143)
```

### Check Disk Space
```bash
ssh root@tower.local "df -h /mnt/user/data"
```

### View Download Folders
```bash
# SABnzbd complete
ssh root@tower.local "ls -lah /mnt/user/data/usenet/complete/"

# qBittorrent torrents
ssh root@tower.local "ls -lah /mnt/user/data/torrents/"

# Final media
ssh root@tower.local "ls -lah /mnt/user/data/media/"
```

### Restart Download Clients
```bash
# Restart SABnzbd
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart sabnzbd"

# Restart qBittorrent
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart qbittorrent"

# Restart VPN (both clients will reconnect)
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart gluetun"
```

---

## 📚 Complete Documentation Suite

1. **This file:** Overall download setup (SABnzbd + qBittorrent)
2. **QBITTORRENT-ARR-SETUP.md:** Detailed qBittorrent configuration guide
3. **GLUETUN-VPN-DEPLOYMENT.md:** VPN setup and verification
4. **PROWLARR-SETUP.md:** Indexer management for both usenet + torrents
5. **ARR-AUTH-DISABLED.md:** No-login access from LAN

All in: `/Users/juju/dev_repos/alex/docs/infrastructure/`

---

## ✅ Final Checklist

### SABnzbd (Already Done ✅)
- [x] Container running
- [x] VPN protected (via Gluetun)
- [x] Categories configured (tv, movies, books)
- [x] Connected to *arr apps
- [x] Downloads working

### qBittorrent (To Do)
- [ ] Access Web UI (http://tower.local:8085)
- [ ] Change default password
- [ ] Configure categories and paths
- [ ] Add to Sonarr/Radarr/Readarr
- [ ] Test download
- [ ] Verify VPN IP

### Both
- [x] VPN protection via Gluetun
- [x] Proper directory structure (/data/)
- [x] Atomic moves enabled (same filesystem)
- [ ] Both configured as download clients
- [ ] Priority set (SABnzbd first, qBittorrent fallback)

---

**Your SABnzbd setup is already excellent!** Just need to configure qBittorrent to match, and you'll have the ultimate download setup. 🚀

**Need help?** Follow the detailed guide in `QBITTORRENT-ARR-SETUP.md` or ask me!
