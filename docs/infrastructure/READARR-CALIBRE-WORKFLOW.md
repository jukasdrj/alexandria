# Readarr + Calibre-Web Workflow

**Date:** 2026-01-17
**Status:** ✅ Production Ready

---

## Quick Reference

**Readarr:** http://tower.local:8787 (admin / tommyboy)
**Calibre-Web:** http://tower.local:8083 (admin / tommyboy)

---

## The Two-System Approach

### System 1: Readarr (Automated Downloads)

**Purpose:** Find and download ebooks automatically

**Location:** `/data/media/books/Author/Book Title.epub`

**How it works:**
1. Add book to Readarr (search by title/author)
2. Readarr searches FearNoPeer indexer
3. Downloads via SABnzbd (usenet) or qBittorrent (torrents)
4. Organizes to `/data/media/books/Author/Title.epub`

**Access books here:**
- File browser: `smb://tower.local/data/media/books/`
- Plex (if configured for ebooks)
- Any ebook reader app (via network share)
- Direct download from Tower

**Use for:**
- Books you want to read once
- Trying out new authors/series
- Books you may or may not keep
- Quick access without library management

---

### System 2: Calibre-Web (Curated Library)

**Purpose:** Manage your permanent ebook collection

**Location:** `/data/media/Calibre_Library/` (Calibre's organized structure)

**How it works:**
1. Your existing library is already loaded (Brandon Sanderson, etc.)
2. Manually import books from Readarr when you want to keep them
3. Calibre-Web organizes with metadata, covers, tags
4. Access via web browser or Calibre Desktop

**Use for:**
- Books you want to keep long-term
- Books you'll re-read or reference
- Your favorite authors/series
- Books you want to organize with tags, series info, etc.

---

## The Workflow

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: Readarr Downloads Book                          │
│ → /data/media/books/Author/Book.epub                    │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Step 2: You Decide                                       │
│ - Read directly from /data/media/books/ (Plex, files)   │
│ - Or import to Calibre-Web for permanent keeping        │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Step 3: Manual Import to Calibre-Web (Optional)         │
│ 1. Open http://tower.local:8083                         │
│ 2. Click "Add books" (+ icon)                           │
│ 3. Browse to /downloads/ (Readarr folder)               │
│ 4. Select book(s)                                        │
│ 5. Import → Copied to Calibre_Library                   │
└─────────────────────────────────────────────────────────┘
```

---

## Why Two Systems?

**Not every book needs to be in your permanent library!**

### Books That Stay in Readarr Folder

- One-time reads you don't need to keep
- Books you're "trying out" from new authors
- Series books you're reading through quickly
- Books you might delete after reading

**These are still accessible via:**
- File browser: `smb://tower.local/data/media/books/`
- Plex (if configured)
- Any ebook reader that can access network shares

### Books That Go Into Calibre Library

- Favorite books you'll re-read
- Reference books (technical, cookbooks, etc.)
- Complete series you want to keep organized
- Books you want to tag, rate, and manage metadata
- Your "core collection"

**Benefits of manual curation:**
- Intentional library building (like a real librarian!)
- No clutter from temporary reads
- Control over what gets organized
- Weekly/monthly "library maintenance" sessions vs. continuous automation

---

## How to Import Books to Calibre-Web

### Option 1: Via Web Interface (Simple)

**When Readarr downloads a book you want to keep:**

1. **Open Calibre-Web:** http://tower.local:8083
2. **Click "Add books"** (+ icon at top of page)
3. **Click "Upload files"** button
4. **Look for "Import from directory"** or **"Browse"** option
5. **Navigate to `/downloads/`** (this is your `/data/media/books/` folder)
6. **Select book file** or entire author folder
7. **Click "Import"**
8. **Done!** Book copied to Calibre_Library with metadata

**Time investment:** 30 seconds per book

---

### Option 2: Via Calibre Desktop (Bulk Import)

**For adding many books at once (weekly/monthly sessions):**

**On green.local:**

```bash
# Mount Tower's Readarr downloads folder
mkdir -p ~/tower-downloads
mount -t cifs //tower.local/data/media/books ~/tower-downloads \
  -o username=justin,uid=$(id -u),gid=$(id -g)

# Mount Tower's Calibre library
mkdir -p ~/tower-calibre
mount -t cifs //tower.local/data/media/Calibre_Library ~/tower-calibre \
  -o username=justin,uid=$(id -u),gid=$(id -g)

# Open Calibre Desktop with Tower's library
calibre --with-library ~/tower-calibre
```

**In Calibre Desktop:**

1. Click **"Add books"** button
2. Browse to `~/tower-downloads/`
3. **Select multiple books** (Shift+Click or Cmd+Click)
4. Click **Open**
5. Calibre imports all selected books, fetches metadata, organizes

**Time investment:** 5-10 minutes for 50+ books

**Use when:**
- You downloaded many books over the week/month
- You want better metadata editing (Calibre Desktop > Web)
- You want to use Calibre plugins
- You prefer batch operations

---

## Example Workflows

### Scenario 1: Reading a New Series

**Goal:** Try out "The Expanse" series (9 books)

**Workflow:**
1. Add series to Readarr
2. Readarr downloads all 9 books → `/data/media/books/James S. A. Corey/`
3. Read books directly from `/data/media/books/` (Plex or file browser)
4. After reading book 3, you love it!
5. Import all 9 books to Calibre-Web for permanent keeping
6. Tag as "Space Opera", rate 5 stars, organize

**Result:** Books stayed accessible during reading, then moved to curated library after you decided to keep them.

---

### Scenario 2: Reference Book

**Goal:** Download a Calibre user guide

**Workflow:**
1. Add to Readarr
2. Readarr downloads → `/data/media/books/`
3. **Immediately import to Calibre-Web** (you know you'll reference it often)
4. Tag as "Reference", "Software", "Tutorial"

**Result:** Book goes straight to organized library since you know you'll keep it.

---

### Scenario 3: One-Time Read

**Goal:** Read a biography someone recommended

**Workflow:**
1. Add to Readarr
2. Readarr downloads → `/data/media/books/`
3. Read directly from `/data/media/books/`
4. Finish book, don't need to keep it
5. **Never import to Calibre-Web** - leave it or delete later

**Result:** No clutter in your permanent library, book was accessible when needed.

---

## Maintenance Routine

### Weekly (5-10 minutes)

**Review Readarr downloads:**
1. Open `/data/media/books/` in file browser
2. Browse recent downloads
3. Import keepers to Calibre-Web
4. Delete books you're done with and don't want

**Import workflow:**
- Calibre-Web → Add books → Browse `/downloads/`
- Select this week's keepers
- Import

---

### Monthly (30 minutes)

**Bulk organize on green.local:**
1. Mount Tower folders (see commands above)
2. Open Calibre Desktop with Tower's library
3. Bulk import month's downloads from `~/tower-downloads/`
4. Edit metadata, covers, tags in batch
5. Delete books from Readarr folder you don't want

---

### As Needed

**Clean up Readarr folder:**
```bash
# Delete old books you've read and don't want
ssh root@tower.local "rm -rf /mnt/user/data/media/books/Author\ Name/"

# Or keep them - storage is cheap!
```

**Backup Calibre library:**
```bash
# From Tower
ssh root@tower.local "tar -czf /mnt/user/backups/calibre-library-$(date +%Y%m%d).tar.gz \
  /mnt/user/data/media/Calibre_Library/"
```

---

## Access Methods

### From Your Mac

**File browser:**
```
smb://tower.local/data/media/books/          (Readarr downloads)
smb://tower.local/data/media/Calibre_Library/ (Calibre library)
```

**Web browsers:**
- Readarr: http://tower.local:8787
- Calibre-Web: http://tower.local:8083

---

### From green.local

**Mount for Calibre Desktop:**
```bash
# One-time mount
mount -t cifs //tower.local/data/media/Calibre_Library ~/tower-calibre -o username=justin

# Persistent mount (add to /etc/fstab)
//tower.local/data/media/Calibre_Library /home/justin/tower-calibre cifs username=justin,password=PASSWORD,uid=1000,gid=1000 0 0
```

---

### From Mobile Devices

**Via Calibre-Web:**
- Open http://tower.local:8083 (if on LAN/Tailscale)
- Browse, read online, or download EPUB/MOBI

**Via file browser apps:**
- FE File Explorer (iOS)
- Solid Explorer (Android)
- Connect to `smb://tower.local/data/media/books/`

---

## Quick Commands

### Check What's Downloaded

```bash
# List recent Readarr downloads
ssh root@tower.local "ls -lt /mnt/user/data/media/books/ | head -20"

# Count books in Readarr folder
ssh root@tower.local "find /mnt/user/data/media/books -name '*.epub' -o -name '*.mobi' | wc -l"

# Count books in Calibre library
ssh root@tower.local "sqlite3 /mnt/user/data/media/Calibre_Library/metadata.db 'SELECT COUNT(*) FROM books;'"
```

### Import a Specific Book via Command Line (Advanced)

```bash
# SSH to Tower
ssh root@tower.local

# Use Calibre CLI to import
docker exec calibre-web calibredb add \
  "/downloads/Author Name/Book Title.epub" \
  --with-library /books
```

---

## Troubleshooting

### Book Downloaded but Not Showing in Readarr

**Check:**
```bash
ssh root@tower.local "ls -la /mnt/user/data/media/books/"
```

If book is there, Readarr completed successfully. Access via file browser or import to Calibre-Web.

### Can't See Readarr Downloads in Calibre-Web

**Correct:** Readarr downloads (`/data/media/books/`) are NOT automatically in Calibre-Web. You must manually import them.

**To import:** Add books → Browse `/downloads/` → Select → Import

### Book Shows in Calibre-Web But Can't Read

**Check format:** Calibre-Web reader works best with EPUB.

**Convert if needed:**
1. Click book → Edit metadata
2. Convert book
3. Output format: EPUB
4. Convert

---

## Summary

**Readarr (Tower):**
- Automated downloads → `/data/media/books/`
- Access anytime via files or Plex
- No library management needed

**Calibre-Web (Tower):**
- Curated permanent library → `Calibre_Library`
- Manual import from Readarr when you want to keep
- Web access for reading, downloading, organizing

**Calibre Desktop (green.local):**
- Mount Tower's library via SMB
- Bulk imports and heavy editing
- Use when you need desktop features

**The key:** Not every download needs to be in your permanent library. Manual curation = intentional collecting!

---

**Last Updated:** 2026-01-17
**Status:** ✅ Production Ready
