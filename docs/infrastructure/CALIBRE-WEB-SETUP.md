# Calibre-Web Setup - Tower Unraid

**Date:** 2026-01-17
**Status:** ✅ Deployed and Running

---

## Summary

Calibre-Web is a web-based Calibre library manager that integrates with Readarr for automatic ebook management.

**Architecture:**
```
Readarr → Downloads ebook → /data/media/books/Author/Book.epub
                              ↓
                       (Manual or auto-import)
                              ↓
Calibre-Web → Manages → /data/media/Calibre_Library/
                              ↓
              Access via browser: http://tower.local:8083
                              ↓
        Calibre Desktop (green.local) → Mount via SMB for editing
```

---

## Configuration

### Container Details

**Image:** lscr.io/linuxserver/calibre-web:latest
**Container Name:** calibre-web
**Port:** 8083
**Network:** media

**Volumes:**
- Config: `/mnt/cache/appdata/calibre-web` → `/config`
- Library: `/mnt/user/data/media/Calibre_Library` → `/books`
- Downloads: `/mnt/user/data/media/books` → `/downloads`

**Environment:**
- PUID: 99 (nobody)
- PGID: 100 (users)
- TZ: America/Chicago
- DOCKER_MODS: linuxserver/mods:universal-calibre (Calibre tools)

---

## Initial Setup

### 1. Access Calibre-Web

**URL:** http://tower.local:8083

**Default credentials:**
- Username: `admin`
- Password: `admin123`

**IMPORTANT:** Change password immediately after first login!

### 2. Configure Database Location

On first access, you'll be asked for the Calibre database location:

**Database Location:** `/books`

This points to your existing Calibre library at `/mnt/user/data/media/Calibre_Library/` on Tower.

Click **Submit** → Calibre-Web will connect to your existing library!

### 3. Change Admin Password

1. After login: User icon (top right) → Admin
2. Edit User → `admin`
3. Change password from `admin123` to `tommyboy` (to match other services)
4. Save

### 4. Configure Basic Settings

**Admin → Configuration → Basic Configuration:**

**External Binaries:**
- Path to Calibre E-Book Converter: `/usr/bin/ebook-convert`
- Path to Kepubify E-Book Converter: (leave empty)
- Path to Unrar: `/usr/bin/unrar`

**Feature Configuration:**
- ✅ Enable Uploads (to add books via web)
- ✅ Enable eBook Conversion (EPUB → MOBI, etc.)
- ✅ Enable Kobo Sync (if you use Kobo e-reader)
- ✅ Enable Remote Login (optional - for external access)

**Save** changes.

### 5. Import Books from Readarr (Manual Process)

**Note:** Calibre-Web doesn't have automatic folder watching. You import books manually when Readarr downloads them.

**How to import:**
1. Readarr downloads book → `/data/media/books/Author/Book.epub`
2. In Calibre-Web: Click **"Add books"** (+ icon in top menu)
3. Click **"Upload files"** → **"From directory"**
4. Browse to `/downloads/` (this is your `/data/media/books/` folder)
5. Select the book or entire author folder
6. Click **Import** → Calibre-Web copies to library

**Alternative:** Use Calibre Desktop on green.local to bulk import periodically

---

## Recommended Workflow: Two Independent Systems

**Important:** Readarr and Calibre-Web work as **separate, complementary systems**, not a fully automated pipeline.

### System 1: Readarr (Automated Acquisition)

**Purpose:** Automatically find and download ebooks
**Location:** `/data/media/books/Author/Title.epub`
**Access:** Via Plex, file browser, or any ebook reader app

**Use for:**
- Automated book discovery via FearNoPeer indexer
- Quick downloads (usenet/torrents)
- Books you want to read once and maybe delete later

### System 2: Calibre-Web (Curated Library)

**Purpose:** Manage your permanent ebook collection
**Location:** `/data/media/Calibre_Library/` (organized by Calibre)
**Access:** Via web browser or Calibre Desktop on green.local

**Use for:**
- Books you want to keep long-term
- Books you'll re-read or reference
- Books you want to tag, organize, and manage metadata
- Your existing collection (Brandon Sanderson, etc.)

### The Workflow

```
Readarr downloads → /data/media/books/
         ↓
    [You decide]
         ↓
  Want to keep? → Manually import to Calibre-Web
  Just reading?  → Leave in /data/media/books/ (still accessible!)
```

**Why not automatic?**
- Not every downloaded book needs to be in your permanent library
- Manual curation = intentional library building (like a real librarian!)
- Prevents clutter from books you read once and don't need again
- You control what gets organized vs. what stays in "downloads"

**When to import:**
- Weekly/monthly "library maintenance" sessions
- When you finish a book and want to keep it
- When you want to organize/tag a book properly
- Whenever you feel like it!

---

## Features

### Read Books Online

- Click any book → **Read Book**
- In-browser EPUB reader (no download needed)
- Progress syncing across devices

### Download Books

- Click book → **Download** → Choose format (EPUB, MOBI, PDF, etc.)
- Send to Kindle: **Send to Kindle** button (configure email first)

### Convert Books

- Click book → **Edit metadata** → **Convert Book**
- EPUB → MOBI, AZW3, PDF, etc.
- Uses Calibre's ebook-convert tool

### Search & Filter

- Search bar: Title, author, series, tags
- Filter sidebar: Authors, series, publishers, languages
- Advanced search: Multiple criteria

### Manage Metadata

- Click book → **Edit metadata**
- Change title, author, cover, description, tags, etc.
- Download metadata from online sources (Google Books, Amazon, etc.)

---

## Integration with Readarr

### Workflow

1. **User adds book to Readarr** (manually or via request)
2. **Readarr searches Prowlarr** (FearNoPeer indexer)
3. **Readarr picks best result**:
   - SABnzbd (Priority 1) - Usenet
   - qBittorrent (Priority 10) - Torrents
4. **Download client downloads** → `/data/media/books/Author/Book.epub`
5. **Calibre-Web auto-imports** (if enabled) → `Calibre_Library`
6. **Book available in Calibre-Web** for reading/managing

**Manual Import (if auto-import disabled):**
1. Readarr → Activity → Completed
2. Note author/title
3. Calibre-Web → Add books → Browse to `/downloads/Author/`
4. Import book

---

## Integration with Calibre Desktop (green.local)

### Mount Tower's Calibre Library on green.local

**Option 1: SMB Mount (Recommended)**

On green.local:
```bash
# Create mount point
mkdir -p ~/tower-calibre

# Mount Tower's Calibre_Library
mount -t cifs //tower.local/data/media/Calibre_Library ~/tower-calibre \
  -o username=justin,uid=$(id -u),gid=$(id -g)

# Open in Calibre Desktop
calibre --with-library ~/tower-calibre
```

**Option 2: Network Library (Direct)**

In Calibre Desktop on green.local:
1. File → Switch/Create Library
2. Browse → Network location
3. Server: `tower.local`
4. Path: `/mnt/user/data/media/Calibre_Library`
5. Protocol: SMB/CIFS

**Use Cases:**
- Heavy metadata editing (Calibre Desktop's rich features)
- Bulk operations (edit hundreds of books)
- Cover management (advanced cover search)
- Plugin management (Calibre has many plugins)

**For Quick Access:**
- Use Calibre-Web browser interface (faster, lighter)

---

## User Management

### Create Additional Users

**Admin → Admin → Add New User:**

**User settings:**
- Username: (e.g., family member name)
- Password: (their password)
- Email: (optional, for Kindle sending)

**Permissions:**
- ✅ Download
- ✅ Upload (if they can add books)
- ✅ Edit Metadata (if they can organize)
- ✅ Delete Books (careful!)

**Restrictions:**
- Random Books: Limit shown on home page
- Tags: Restrict to specific tags only
- Languages: Restrict to specific languages

---

## Send to Kindle

### Setup

**Admin → Configuration → E-Mail Server:**

**SMTP Settings:**
- SMTP Hostname: `smtp.gmail.com` (if using Gmail)
- SMTP Port: `587`
- SMTP Login: Your Gmail address
- SMTP Password: App-specific password (NOT your Gmail password!)
- From E-Mail: Same as SMTP Login

**Gmail App Password:**
1. Google Account → Security
2. 2-Step Verification → Enable
3. App Passwords → Generate
4. Use generated password in Calibre-Web

**Per-User Kindle Email:**
1. User icon → Your Account
2. Kindle E-Mail: `your-kindle@kindle.com` (from Amazon)
3. Save

### Usage

1. Click book → **Send to Kindle**
2. Choose format (AZW3 or MOBI for Kindle)
3. Send
4. Book appears on Kindle in ~2 minutes

**Amazon Whitelist:**
- Go to Amazon → Manage Your Content and Devices
- Settings → Personal Document Settings
- Approved Personal Document E-mail List
- Add: Your SMTP From E-Mail

---

## Access URLs

| Service | URL | Purpose |
|---------|-----|---------|
| **Calibre-Web** | http://tower.local:8083 | Web interface |
| **Readarr** | http://tower.local:8787 | Ebook automation |

---

## Troubleshooting

### Can't Access Web UI

```bash
# Check container status
ssh root@tower.local "docker ps | grep calibre-web"

# Check logs
ssh root@tower.local "docker logs calibre-web --tail 50"

# Restart container
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart calibre-web"
```

### Database Error

**Error:** "Cannot connect to database"

**Fix:**
1. Check `/mnt/user/data/media/Calibre_Library/metadata.db` exists
2. Check permissions: `chown nobody:users /mnt/user/data/media/Calibre_Library/metadata.db`
3. Restart Calibre-Web

### How to Import Books from Readarr Downloads

**Note:** Calibre-Web does NOT have automatic folder watching. This is intentional - you manually curate your library.

**Manual import process:**
1. Readarr downloads book → `/data/media/books/Author/Book.epub`
2. Open Calibre-Web: http://tower.local:8083
3. Click **"Add books"** (+ icon at top)
4. Click **"Upload files"** button
5. Look for **"Import from directory"** or **"Browse"** option
6. Navigate to `/downloads/` (your `/data/media/books/` folder)
7. Select book file or author folder
8. Click **Import** → Calibre-Web copies to library

**Bulk import alternative (Calibre Desktop on green.local):**
1. Mount Tower's folders:
   ```bash
   mkdir -p ~/tower-downloads ~/tower-calibre
   mount -t cifs //tower.local/data/media/books ~/tower-downloads -o username=justin
   mount -t cifs //tower.local/data/media/Calibre_Library ~/tower-calibre -o username=justin
   ```
2. Open Calibre Desktop: `calibre --with-library ~/tower-calibre`
3. Add books → Browse to `~/tower-downloads/` → Select multiple → Import

### Cover Not Showing

**Fix:**
1. Edit book metadata
2. Download Metadata → Select source (Google Books, Amazon)
3. Choose correct book
4. Apply → Cover updates

### Conversion Failing

**Error:** "ebook-convert not found"

**Fix:**
1. Check DOCKER_MODS is set: `linuxserver/mods:universal-calibre`
2. Check binary path: `/usr/bin/ebook-convert`
3. Restart container to apply mods

---

## Management Commands

### Restart Calibre-Web

```bash
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart calibre-web"
```

### View Logs

```bash
ssh root@tower.local "docker logs calibre-web --tail 100 -f"
```

### Backup Calibre Library

```bash
# Backup entire library
ssh root@tower.local "tar -czf /mnt/user/backups/calibre-library-$(date +%Y%m%d).tar.gz /mnt/user/data/media/Calibre_Library/"

# Backup just database
ssh root@tower.local "cp /mnt/user/data/media/Calibre_Library/metadata.db /mnt/user/backups/calibre-metadata-$(date +%Y%m%d).db"
```

### Rebuild Database (if corrupted)

```bash
# From green.local with Calibre Desktop
calibre-debug --with-library ~/tower-calibre --rebuild-db
```

---

## Performance Tips

### Large Libraries (>1000 books)

**Admin → Configuration → Feature Configuration:**
- Disable: "Show Random Books in Detail View" (slower on large libraries)
- Enable: "Restrict Columns and Ratings in Edit Metadata"

### Improve Search Speed

Calibre-Web uses full-text search on `metadata.db` - no additional indexing needed.

**For very large libraries:**
- Use filters (author, series) before searching
- Calibre Desktop → Tools → Rebuild Database (optimizes SQLite)

---

## Security Considerations

### Local Network Only

Calibre-Web is exposed on port 8083 but only accessible from:
- LAN (192.168.1.0/24)
- Tailscale (100.0.0.0/8)

**NOT exposed to internet** (no port forwarding).

### Change Default Password

Default `admin123` is insecure. Change to `tommyboy` (or stronger) immediately.

### User Permissions

Create read-only users for family:
- ✅ Download
- ❌ Upload
- ❌ Edit Metadata
- ❌ Delete Books

---

## Related Documentation

- **READARR-CALIBRE-SETUP.md** - Readarr deployment
- **ARR-STACK-FINAL-CONFIGURATION.md** - Complete *arr stack overview
- **PROWLARR-INDEXER-SECURITY.md** - FearNoPeer indexer configuration

---

## Summary

### What You Can Do Now

**Via Calibre-Web (http://tower.local:8083):**
- Browse your existing Calibre library (Brandon Sanderson books, etc.)
- Read books online in browser
- Download books in any format
- Convert EPUB → MOBI for Kindle
- Send books to Kindle via email
- Edit metadata, covers, tags
- Auto-import books from Readarr downloads

**Via Calibre Desktop (green.local):**
- Mount Tower's library via SMB
- Heavy metadata editing
- Bulk operations (hundreds of books)
- Advanced cover search
- Plugin management

**Via Readarr:**
- Search for ebooks (FearNoPeer indexer)
- Automatic downloads (SABnzbd/qBittorrent)
- Books go to `/data/media/books/`
- Calibre-Web auto-imports to library

---

## First Steps

1. **Access Calibre-Web:** http://tower.local:8083
2. **Login:** admin / admin123
3. **Configure database:** `/books`
4. **Change password:** admin123 → tommyboy
5. **Import books manually:** Add books → From directory → `/downloads/` (when Readarr downloads)
6. **Browse your books:** Your Brandon Sanderson collection is already there!

---

**Deployment completed:** 2026-01-17
**Status:** ✅ Production-ready
**Next:** Access http://tower.local:8083 and change default password!
