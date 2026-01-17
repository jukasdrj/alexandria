# qBittorrent Setup for *arr Apps Integration

**Date:** 2026-01-17
**Your Current Setup:** SABnzbd (usenet) working, qBittorrent (torrents) needs configuration

---

## 🎯 Goal

Configure qBittorrent to work with Sonarr/Radarr/Readarr just like SABnzbd does - **automatic category-based downloads with proper file organization**.

---

## 📁 Your Current Directory Structure

### Tower Paths (Inside Containers)

All *arr apps and download clients see:
```
/data/
├── torrents/              ← qBittorrent downloads here
│   ├── tv/               ← Sonarr's torrent downloads
│   ├── movies/           ← Radarr's torrent downloads
│   ├── books/            ← Readarr's torrent downloads
│   ├── music/            ← Lidarr (if you add it)
│   └── adult/            ← (your existing folder)
├── usenet/               ← SABnzbd downloads here (already working)
│   ├── complete/
│   ├── incomplete/
│   └── movies/
└── media/                ← Final organized media location
    ├── tv/              ← Sonarr moves completed TV here
    ├── movies/          ← Radarr moves completed movies here
    ├── books/           ← Readarr moves completed books here
    └── music/           ← Lidarr moves music here
```

### Real Tower Paths (Outside Containers)

On Tower filesystem:
```
/mnt/user/data/
├── torrents/
├── usenet/
└── media/
```

**Why this matters:** Using `/data` inside containers means **atomic moves** (instant) instead of slow copy+delete.

---

## 🔄 How *arr Apps Work with Download Clients

### The Workflow

1. **User requests media** (or automatic search)
   - Via Overseerr, or automatic monitoring in Sonarr/Radarr

2. ***arr app searches Prowlarr** for the media
   - Prowlarr returns torrent/nzb results

3. ***arr app sends download** to client with category
   - Sonarr → qBittorrent: category=`tv`
   - Radarr → qBittorrent: category=`movies`
   - Readarr → qBittorrent: category=`books`

4. **qBittorrent downloads** to category folder
   - `tv` → downloads to `/data/torrents/tv/`
   - `movies` → downloads to `/data/torrents/movies/`
   - `books` → downloads to `/data/torrents/books/`

5. ***arr app monitors** the download folder
   - Waits for download to complete
   - Verifies file quality/naming

6. ***arr app moves file** to final location
   - **Atomic move** (instant, no copying) from `/data/torrents/tv/` to `/data/media/tv/`
   - Renames file according to naming scheme
   - Updates library

### Why Atomic Moves Are Critical

**Same filesystem (`/data`):**
- Sonarr moves: `/data/torrents/tv/Show.mkv` → `/data/media/tv/Show Name/S01/Show Name - S01E01.mkv`
- **Time:** Instant (0.1 seconds)
- **Disk usage:** No extra space used

**Different filesystems (BAD):**
- Would require: Copy `/torrents/tv/` to `/media/tv/` then delete original
- **Time:** Minutes for large files
- **Disk usage:** Double space during copy

---

## ⚙️ qBittorrent Configuration Steps

### Step 1: Access qBittorrent Web UI

**URL:** http://tower.local:8085

**Default Credentials:**
- Username: `admin`
- Password: `adminadmin` (or check logs if different)

**Get password if needed:**
```bash
ssh root@tower.local "docker logs qbittorrent 2>&1 | grep -i password"
```

### Step 2: Change Default Password (Recommended)

1. Tools → Options → Web UI
2. Change password to something memorable (e.g., `tommyboy` to match other services)
3. Save

### Step 3: Configure Download Paths

**Tools → Options → Downloads:**

**Default Save Path:**
- Set to: `/data/torrents/`
- This is the base folder for all torrents

**Keep incomplete torrents in:**
- ✅ Enable this
- Set to: `/data/torrents/incomplete/`
- Keeps downloading files separate from completed ones

**Run external program on torrent completion:**
- ⬜ Leave disabled (*arr apps monitor automatically)

**Save settings.**

### Step 4: Configure Categories

**Right-click in categories pane (left sidebar) → Add category:**

Create these categories:

| Category | Save Path |
|----------|-----------|
| `tv` | `/data/torrents/tv` |
| `movies` | `/data/torrents/movies` |
| `books` | `/data/torrents/books` |
| `music` | `/data/torrents/music` |
| `sonarr` | `/data/torrents/tv` (alternative) |
| `radarr` | `/data/torrents/movies` (alternative) |
| `readarr` | `/data/torrents/books` (alternative) |

**Why both `tv` and `sonarr`?**
- Some *arr apps use generic categories (`tv`, `movies`)
- Others use app-specific categories (`sonarr`, `radarr`)
- Having both ensures compatibility

### Step 5: Configure Connections

**Tools → Options → Connection:**

**Port used for incoming connections:**
- This is handled by Gluetun's port forwarding
- Leave as default or set to `6881`

**UPnP / NAT-PMP:**
- ⬜ Disable both (VPN handles port forwarding)

**Save settings.**

### Step 6: Configure Speed Limits (Optional)

**Tools → Options → Speed:**

Set limits appropriate for your connection:
- **Global download limit:** Leave unlimited or set to 90% of your max
- **Global upload limit:** Set to reasonable ratio (e.g., 5-10 MB/s for good seeding)

**Alternative Rate Limits (for scheduled slow hours):**
- Can set different limits for daytime vs nighttime

### Step 7: Configure Seeding Limits (Recommended)

**Tools → Options → BitTorrent:**

**When ratio reaches:**
- ✅ Enable
- Set to: `2.0` (seed until 2:1 ratio)

**Then:**
- Select: "Pause torrent"

**Or time-based:**
- ✅ When seeding time reaches: `7200` minutes (5 days)
- Then: "Pause torrent"

**Why pause instead of remove?**
- Allows manual review before deletion
- *arr apps will import the file before it's paused

---

## 🔗 Configure Sonarr to Use qBittorrent

### Step 1: Add Download Client in Sonarr

1. Access Sonarr: http://tower.local:8989
2. Settings → Download Clients → Add (+) → qBittorrent

**Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | qBittorrent |
| **Enable** | ✅ Yes |
| **Host** | `gluetun` (container name - qBittorrent is behind Gluetun VPN) |
| **Port** | `8085` |
| **Username** | `admin` |
| **Password** | (your qBittorrent password) |
| **Category** | `tv` (Sonarr will tag downloads with this) |
| **Post-Import Category** | (leave empty) |
| **Recent Priority** | Last |
| **Older Priority** | Last |
| **Initial State** | Start |

**Important:** Use `gluetun` as hostname, NOT `qbittorrent`, because qBittorrent routes through Gluetun's network!

### Step 2: Configure Remote Path Mappings

**Still in Download Client settings:**

**Remote Path Mappings:**
- Usually NOT needed if using `/data` everywhere
- Only needed if download client shows different path than Sonarr

**Test Connection:**
- Click "Test" button
- Should show: ✅ Success

**Save.**

### Step 3: Verify Download Location

**Settings → Media Management:**

**Root Folders:**
- Should have: `/data/media/tv`
- This is where Sonarr moves completed downloads

**Completed Download Handling:**
- ✅ Enable
- **Remove:** ✅ Yes (removes torrent after import, file stays)

---

## 🔗 Configure Radarr to Use qBittorrent

### Same Process as Sonarr

1. Access Radarr: http://tower.local:7878
2. Settings → Download Clients → Add (+) → qBittorrent

**Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | qBittorrent |
| **Enable** | ✅ Yes |
| **Host** | `gluetun` |
| **Port** | `8085` |
| **Username** | `admin` |
| **Password** | (your qBittorrent password) |
| **Category** | `movies` |

**Test → Save.**

**Root Folder:**
- Settings → Media Management → `/data/media/movies`

---

## 🔗 Configure Readarr to Use qBittorrent

### Same Process

1. Access Readarr: http://tower.local:8787
2. Settings → Download Clients → Add (+) → qBittorrent

**Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | qBittorrent |
| **Host** | `gluetun` |
| **Port** | `8085` |
| **Username** | `admin` |
| **Password** | (your password) |
| **Category** | `books` |

**Root Folder:**
- Settings → Media Management → `/data/media/books`

---

## ✅ Verification

### Test 1: Manual Download in qBittorrent

1. Open qBittorrent: http://tower.local:8085
2. Add a test torrent (small public domain file)
3. Right-click → Set category → `tv`
4. Verify downloads to: `/data/torrents/tv/`

### Test 2: Sonarr Automatic Download

1. Open Sonarr: http://tower.local:8989
2. Add a TV show to monitor
3. Trigger a search (Manual Search)
4. Select a torrent result
5. Sonarr sends to qBittorrent with category `tv`
6. Watch Activity → Queue

**Expected behavior:**
1. qBittorrent downloads to `/data/torrents/tv/`
2. Sonarr monitors progress
3. When complete, Sonarr moves to `/data/media/tv/Show Name/Season/`
4. File is renamed according to Sonarr naming scheme
5. Torrent is removed from qBittorrent (optional based on settings)

### Test 3: Check VPN IP

While torrent is downloading:

```bash
# Check qBittorrent is using VPN
ssh root@tower.local "docker exec qbittorrent curl -s ifconfig.me"
# Should show: 37.19.197.137 (PIA VPN IP, NOT your home IP 47.187.18.143)
```

---

## 🚨 Common Issues & Solutions

### Issue 1: Sonarr Can't Connect to qBittorrent

**Symptom:** Test fails with "Unable to connect"

**Solution:**
- ✅ Use hostname: `gluetun` (NOT `qbittorrent`)
- ✅ Port: `8085`
- ✅ Verify qBittorrent Web UI is enabled
- ✅ Check qBittorrent username/password

**Verify connectivity:**
```bash
# From Sonarr container, test qBittorrent via Gluetun
ssh root@tower.local "docker exec sonarr curl -s http://gluetun:8085/api/v2/app/version"
# Should return qBittorrent version number
```

### Issue 2: Downloads Not Moving to Media Folder

**Symptom:** Torrent completes but stays in `/data/torrents/tv/`

**Possible causes:**

1. **Completed Download Handling disabled**
   - Sonarr → Settings → Download Clients → ✅ Enable "Completed Download Handling"

2. **Different filesystems (can't atomic move)**
   - Verify both use `/data` paths
   - Check: Sonarr logs for "copy" instead of "move"

3. **Permissions issue**
   - All containers use PUID=99, PGID=100 ✅ (you're good)

4. **File quality doesn't match**
   - Check Sonarr → Activity → Queue → "Why not importing?"

### Issue 3: Category Not Being Set

**Symptom:** Downloads go to `/data/torrents/` instead of `/data/torrents/tv/`

**Solution:**
1. Verify category exists in qBittorrent
2. Check Sonarr → Download Client → Category field is set to `tv`
3. Test download and watch qBittorrent category assignment

### Issue 4: Slow Torrent Speeds

**Symptom:** Torrents download slowly compared to SABnzbd

**Solutions:**

1. **Enable port forwarding in Gluetun**
   - See GLUETUN-VPN-DEPLOYMENT.md for instructions
   - Allows incoming connections (better speeds)

2. **Check connection settings**
   - qBittorrent → Tools → Options → Connection
   - Ensure listening port is open (Gluetun handles this)

3. **Check seeding ratio settings**
   - Too aggressive upload limits can hurt download speeds
   - BitTorrent protocol favors seeders

---

## 📊 Comparison: SABnzbd vs qBittorrent

| Feature | SABnzbd (Usenet) | qBittorrent (Torrents) |
|---------|------------------|------------------------|
| **Speed** | Very fast (maxes out connection) | Variable (depends on seeders) |
| **Privacy** | Encrypted to provider | Peers see your IP (but VPN hides it) |
| **Availability** | Depends on retention (3000+ days typical) | Depends on seeders (can be old content) |
| **Cost** | Requires usenet provider ($5-15/mo) | Free (but VPN recommended $5/mo) |
| **Setup** | You already have this working ✅ | Need to configure (this guide) |
| **Automation** | Perfect for recent content | Great for older/obscure content |

**Best practice:** Use BOTH!
- **SABnzbd (usenet):** Primary for new releases (fast, reliable)
- **qBittorrent (torrents):** Fallback for older content or failed usenet downloads

---

## 🎯 Recommended Workflow

### Priority Order in *arr Apps

Configure each *arr app to try download clients in order:

**Settings → Download Clients → Manage → Drag to reorder:**

1. **SABnzbd** (Priority: 1) - Try usenet first
2. **qBittorrent** (Priority: 10) - Fall back to torrents

This way:
- New releases download via usenet (fast, reliable)
- Older content falls back to torrents automatically
- You get best of both worlds

### SABnzbd Categories (Your Existing Setup)

You probably already have:
- Category: `tv` → `/data/usenet/complete/tv/` (or similar)
- Category: `movies` → `/data/usenet/complete/movies/`

**Verify in SABnzbd:**
- Access: http://tower.local:8080
- Config → Categories
- Make sure categories point to `/data/usenet/complete/` subfolders

---

## 🔧 Quick Setup Commands

### Create Missing Torrent Directories (If Needed)

```bash
ssh root@tower.local "
mkdir -p /mnt/user/data/torrents/tv
mkdir -p /mnt/user/data/torrents/movies
mkdir -p /mnt/user/data/torrents/books
mkdir -p /mnt/user/data/torrents/music
mkdir -p /mnt/user/data/torrents/incomplete
chown -R nobody:users /mnt/user/data/torrents
chmod -R 775 /mnt/user/data/torrents
echo 'Torrent directories created'
"
```

### Get qBittorrent Default Password

```bash
ssh root@tower.local "docker logs qbittorrent 2>&1 | grep -i 'password\|WebUI' | tail -10"
```

---

## 📝 Configuration Checklist

### qBittorrent Setup

- [ ] Access Web UI (http://tower.local:8085)
- [ ] Change default password
- [ ] Set default save path: `/data/torrents/`
- [ ] Enable incomplete downloads: `/data/torrents/incomplete/`
- [ ] Create categories: `tv`, `movies`, `books`, `music`
- [ ] Set category paths (e.g., `tv` → `/data/torrents/tv/`)
- [ ] Disable UPnP/NAT-PMP (VPN handles ports)
- [ ] Configure seeding limits (2:1 ratio or 5 days)

### Sonarr Setup

- [ ] Add qBittorrent download client
- [ ] Host: `gluetun`, Port: `8085`
- [ ] Category: `tv`
- [ ] Test connection (should succeed)
- [ ] Verify root folder: `/data/media/tv`
- [ ] Enable completed download handling
- [ ] Set SABnzbd as Priority 1, qBittorrent as Priority 10

### Radarr Setup

- [ ] Add qBittorrent download client
- [ ] Host: `gluetun`, Port: `8085`
- [ ] Category: `movies`
- [ ] Test connection
- [ ] Verify root folder: `/data/media/movies`
- [ ] Configure download client priority

### Readarr Setup

- [ ] Add qBittorrent download client
- [ ] Host: `gluetun`, Port: `8085`
- [ ] Category: `books`
- [ ] Test connection
- [ ] Verify root folder: `/data/media/books`

### Verification

- [ ] Test manual download in qBittorrent
- [ ] Verify downloads to correct category folder
- [ ] Test Sonarr automatic search
- [ ] Verify file moves to `/data/media/tv/` after completion
- [ ] Check qBittorrent is using VPN IP (not home IP)

---

## 🎓 Key Concepts Recap

### 1. Container Networking

**Why use `gluetun` as hostname?**
- qBittorrent uses `network_mode: "service:gluetun"`
- It doesn't have its own network interface
- All traffic routes through Gluetun
- Other containers reach it via Gluetun's network

### 2. Atomic Moves

**Why everything uses `/data`?**
- Same filesystem = instant moves
- No copying = no extra disk space
- Fast imports = happy users

### 3. Categories

**Why categories matter:**
- *arr apps tag downloads
- qBittorrent saves to category folder
- *arr apps monitor that specific folder
- Clean organization

### 4. VPN Protection

**Why qBittorrent routes through Gluetun:**
- Hides your IP from torrent swarms
- ISP can't see what you download
- Kill switch prevents leaks
- Your home IP: 47.187.18.143 (NEVER exposed to torrents)
- VPN IP: 37.19.197.137 (torrent swarms see this)

---

## 📚 Related Documentation

- **Prowlarr Setup:** PROWLARR-SETUP.md (indexers for both usenet + torrents)
- **Gluetun VPN:** GLUETUN-VPN-DEPLOYMENT.md (VPN protection for downloads)
- **Readarr:** READARR-CALIBRE-SETUP.md (ebook downloads)
- **Authentication:** ARR-AUTH-DISABLED.md (no passwords on LAN)

---

## 🚀 Next Steps

1. **Follow Step 2-4 above** to configure qBittorrent categories and paths
2. **Add qBittorrent to Sonarr/Radarr/Readarr** (Step 5-6)
3. **Test with a manual search** in Sonarr
4. **Monitor Activity → Queue** to watch the magic happen
5. **Enjoy having both usenet AND torrents** working automatically! 🎉

---

**Remember:** qBittorrent + SABnzbd together = Complete coverage for all media!

**Questions?** The key is:
- Use hostname `gluetun` (not `qbittorrent`)
- Set proper categories
- Use `/data` paths everywhere
- Let *arr apps do the moving (not qBittorrent)

You already have SABnzbd working perfectly - qBittorrent follows the exact same pattern! 🚀
