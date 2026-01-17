# Readarr-Calibre Setup Guide

## Overview

This guide documents the setup of Readarr on Tower (Unraid) and its integration with Calibre Content Server running on green.local (192.168.1.186).

**Deployment Date:** 2026-01-16
**Readarr URL:** http://tower.local:8787
**Calibre Server:** http://192.168.1.186:8080

## Docker Configuration

### Readarr Service (Tower)

```yaml
readarr:
  image: ich777/readarr
  container_name: readarr
  networks:
    - media
  ports:
    - "8787:8787"
  volumes:
    - /mnt/cache/appdata/readarr:/config
    - /mnt/user/data:/data
  environment:
    - PUID=99
    - PGID=100
    - TZ=America/Chicago
  restart: unless-stopped
```

**Key Details:**
- **Image:** `ich777/readarr` (LinuxServer.io image deprecated as of Jan 2026)
- **Web UI:** Port 8787
- **Config:** `/mnt/cache/appdata/readarr`
- **Data Mount:** `/mnt/user/data` (shared with other *arr apps)
- **Network:** `media` (same as Sonarr, Radarr, etc.)

### Image Selection Notes

**Attempted Images:**
1. `lscr.io/linuxserver/readarr:develop` - Failed (no linux/amd64 manifest)
2. `lscr.io/linuxserver/readarr:nightly` - Failed (no linux/amd64 manifest)
3. `lscr.io/linuxserver/readarr:latest` - Failed (manifest unknown)
4. `hotio/readarr:nightly` - Failed (repository does not exist)
5. `ghcr.io/hotio/readarr:nightly` - Failed (access denied)
6. `ich777/readarr` - **SUCCESS**

**Why ich777?**
- LinuxServer.io Readarr image is deprecated (project retired due to metadata issues)
- hotio images are archived/no longer available
- ich777 is an active community maintainer with working amd64 builds

**Sources:**
- [LinuxServer.io Readarr Deprecated](https://docs.linuxserver.io/deprecated_images/docker-readarr/)
- [ich777/readarr Docker Hub](https://hub.docker.com/r/ich777/readarr)

## Deployment Commands

```bash
# Backup existing docker-compose.yml
ssh root@tower.local "cd /mnt/user/domains/docker-compose && cp docker-compose.yml docker-compose.yml.backup-$(date +%Y%m%d-%H%M%S)"

# Deploy Readarr
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose up -d readarr"

# Verify status
ssh root@tower.local "docker ps | grep readarr"

# View logs
ssh root@tower.local "docker logs readarr"
```

## Initial Setup

1. **Access Readarr Web UI:**
   - Navigate to: http://tower.local:8787
   - Complete initial setup wizard

2. **Configure Media Management:**
   - Settings → Media Management
   - Root Folders: Add `/data/media/books` or your preferred location
   - File Management: Configure naming conventions

3. **Add Download Client:**
   - Settings → Download Clients
   - Add SABnzbd (http://sabnzbd:8080) or qBittorrent (http://qbittorrent:8085)
   - Category: `books` (ensure download clients have this category configured)

4. **Add Indexers:**
   - Settings → Indexers
   - Add via Prowlarr (http://prowlarr:9696)
   - Or manually add book-focused indexers

## Calibre Integration

### Calibre Content Server (green.local)

**Host:** 192.168.1.186
**Port:** 8080 (default Calibre Content Server port)
**Library Path:** Check on green.local (typically `/path/to/Calibre Library`)

### Connection Methods

#### Option 1: Import to Readarr (Recommended)

Readarr can import books and send to Calibre via Content Server API:

1. **Configure Import Lists:**
   - Settings → Import Lists → Add → Calibre
   - Host: `192.168.1.186`
   - Port: `8080`
   - Username/Password: (if Calibre Content Server has authentication enabled)
   - Library ID: Usually `0` for default library

2. **Configure Connect:**
   - Settings → Connect → Add → Calibre
   - Host: `192.168.1.186`
   - Port: `8080`
   - Use SSL: No (unless you've configured HTTPS)
   - Library: Check library name on Calibre Content Server

#### Option 2: Network Mount (Alternative)

If Calibre library is on a network share accessible from Tower:

```bash
# On Tower, mount green.local share
# Example (adjust path as needed):
ssh root@tower.local "mount -t nfs 192.168.1.186:/path/to/calibre /mnt/user/calibre"
```

Then add to Readarr docker-compose.yml:
```yaml
volumes:
  - /mnt/user/calibre:/calibre:ro  # Read-only recommended
```

### Calibre Content Server Setup

**On green.local**, ensure Calibre Content Server is running:

```bash
# Check if Calibre Content Server is running
# Default command:
calibre-server --port=8080 /path/to/Calibre\ Library

# With authentication (recommended):
calibre-server --port=8080 --enable-auth --userdb=/path/to/users.sqlite /path/to/Calibre\ Library
```

**Firewall:** Ensure port 8080 is accessible from Tower's IP (192.168.1.x network)

### Metadata Provider Configuration

Readarr uses the following metadata providers for books:

1. **GoodReads API** (primary) - Requires API key (may be deprecated)
2. **Google Books API** - Free, no key required
3. **OpenLibrary** - Free, no key required
4. **LazyLibrarian** - Community metadata source

**Important:** As of 2024, GoodReads API is deprecated. Use Google Books or OpenLibrary.

**Configure in Readarr:**
- Settings → Metadata → Add Providers
- Google Books: No configuration needed
- OpenLibrary: No configuration needed

## Workflow

### Typical Book Acquisition Flow

1. **Search:** Readarr searches indexers for book releases
2. **Download:** Sends to SABnzbd/qBittorrent
3. **Import:** Downloads to `/data/media/books`
4. **Process:** Renames, organizes per naming scheme
5. **Send to Calibre:** Via Calibre Content Server API
6. **Library Sync:** Calibre library updated with new books

### Manual Import

1. Place books in `/mnt/user/data/media/books` on Tower
2. Readarr → Library → Import
3. Select folder, match metadata
4. Import to Readarr database
5. Optional: Send to Calibre via Connect

## Troubleshooting

### Readarr Can't Connect to Calibre

**Check:**
- Calibre Content Server is running on green.local
- Port 8080 is accessible: `ssh root@tower.local "telnet 192.168.1.186 8080"`
- No firewall blocking between Tower and green.local
- Correct credentials if authentication enabled

### Books Not Sending to Calibre

**Verify:**
- Connect → Calibre settings are correct
- Test connection in Readarr UI
- Check Readarr logs: `docker logs readarr | grep -i calibre`
- Ensure Calibre library is writable

### Import Lists Not Working

**Check:**
- Calibre Content Server OPDS feed enabled (usually automatic)
- Import List URL format: `http://192.168.1.186:8080`
- Sync interval settings
- Check Readarr System → Tasks → Import List Sync

## Network Architecture

```
Internet
    ↓
Tower (Unraid)
    ├─ Readarr (8787) ───┐
    ├─ SABnzbd (8080)    │
    ├─ Prowlarr (9696)   │
    └─ Plex              │
                         │
                    (192.168.1.x LAN)
                         │
                    green.local (192.168.1.186)
                         └─ Calibre Content Server (8080)
```

## Monitoring

### Health Checks

```bash
# Readarr container status
ssh root@tower.local "docker ps | grep readarr"

# Readarr logs
ssh root@tower.local "docker logs -f readarr"

# Check Calibre connectivity from Tower
ssh root@tower.local "curl -I http://192.168.1.186:8080"
```

### Readarr Health

- Readarr → System → Status
- Check for warnings/errors
- View queue: Activity → Queue

## Data Locations

- **Readarr Config:** `/mnt/cache/appdata/readarr` on Tower
- **Book Downloads:** `/mnt/user/data/usenet/books` (SABnzbd category)
- **Book Library:** `/mnt/user/data/media/books` (Readarr root folder)
- **Calibre Library:** `/path/to/Calibre Library` on green.local (verify exact path)

## Backup Strategy

```bash
# Backup Readarr config
ssh root@tower.local "tar -czf /mnt/user/backups/readarr-$(date +%Y%m%d).tar.gz /mnt/cache/appdata/readarr"

# Restore
ssh root@tower.local "cd / && tar -xzf /mnt/user/backups/readarr-YYYYMMDD.tar.gz"
```

## Related Documentation

- **Tower Docker Compose:** `/mnt/user/domains/docker-compose/docker-compose.yml`
- **Alexandria Project:** Uses OpenLibrary database (separate from Readarr/Calibre)
- **Media Stack:** Sonarr, Radarr, Bazarr (same network/pattern as Readarr)

## Known Issues & Limitations

### Readarr Project Status

**As of January 2026:**
- Readarr project is in maintenance mode
- Upstream metadata sources (GoodReads) deprecated
- Active development limited
- Community relies on alternative metadata (Google Books, OpenLibrary)

**Alternatives Considered:**
- **LazyLibrarian** - Python-based, still actively developed
- **Calibre-Web** - Web UI for Calibre library (no automated downloads)
- **Manual Calibre Management** - Direct use of Calibre desktop app

**Decision:** Proceeding with Readarr for automated acquisition, with manual Calibre fallback if metadata quality degrades.

## Future Enhancements

- **Calibre-Web Integration:** Add read-only web interface for Calibre library
- **Network Mount:** Direct Calibre library mount for faster imports
- **Automation:** Cron job to sync Readarr → Calibre nightly
- **Monitoring:** Grafana dashboard for book acquisition metrics

## References

- [Readarr Official Wiki](https://wiki.servarr.com/readarr)
- [Calibre Content Server Manual](https://manual.calibre-ebook.com/server.html)
- [ich777 Readarr Docker Hub](https://hub.docker.com/r/ich777/readarr)
- [LinuxServer.io Readarr Deprecation Notice](https://docs.linuxserver.io/deprecated_images/docker-readarr/)
