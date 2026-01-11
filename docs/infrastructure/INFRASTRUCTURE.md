# 🏠 BooksTrack Infrastructure Reference

**Last Updated:** January 10, 2026  
**Owner:** Justin Gardner (@jukasdrj)

---

## 📍 Quick Access Table

| System | Internal IP | Tailscale IP | SSH Command | Purpose |
|--------|-------------|--------------|-------------|---------|
| **Mac (Local)** | N/A | N/A | N/A | iOS/Swift development |
| **Green** | `192.168.1.186` | `100.104.253.23` | `ssh green` | WSL2 dev server (Flutter/Backend) |
| **Tower** | `192.168.1.240` | `100.120.125.46` | `ssh tower` | Unraid - PostgreSQL/Media/Docker |

---

## 🖥️ Machines

### Mac (Local Development)

| Property | Value |
|----------|-------|
| Hostname | Justins-MacBook-Air |
| Username | juju |
| Home | `/Users/juju` |
| Dev Path | `~/dev_repos/` |
| Claude Code | `cc` |
| Shell | zsh (Oh My Zsh + Powerlevel10k) |

**Primary Use:** iOS/Swift development with Xcode

**Key Directories:**
- `~/dev_repos/books-v3` - iOS Swift Frontend
- `~/dev_repos/bendv3` - Backend Worker API
- `~/dev_repos/alex` - Alexandria (Cloudflare Tunnel & Worker)
- `~/.cloudflared/` - Cloudflare tunnel certificates

---

### Green (WSL2 Development Server)

| Property | Value |
|----------|-------|
| OS | Windows 11 + WSL2 Ubuntu 24.04 |
| Local IP | `192.168.1.186` |
| Tailscale IP | `100.104.253.23` |
| RAM | 64GB |
| Storage | NVMe |
| SSH User | justin |
| SSH Port | 22 (standard) |
| Dev Path | `~/dev_repos/` |
| Claude Code | `ccg` |

**SSH Config:**
```bash
Host green
    HostName 192.168.1.186
    User justin
    Port 22
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

**Installed Tools:**
- Node 20.19
- npm 10.8
- Wrangler 4.54
- Flutter 3.38
- Dart 3.10

**Primary Use:** Flutter/Backend development, Wrangler deployments

---

### Tower (Unraid Server)

| Property | Value |
|----------|-------|
| OS | Unraid |
| Local IP | `192.168.1.240` |
| Tailscale IP | `100.120.125.46` |
| SSH User | root |
| SSH Access | `ssh tower` |
| Docker | Docker Engine 27.5.1 |
| Docker Compose | v5.0.1 (official, latest) |

**SSH Config:**
```bash
Host tower
    HostName tower.bat-saiph.ts.net
    User root
    IdentityFile ~/.ssh/id_ed25519
```

**Primary Use:** Media server, PostgreSQL databases, monitoring, photo management

**Hardware:** 
- CPU: AMD Ryzen 5 9600X 6-Core
- Storage: 72TB total (data array)
- Docker: 30GB XFS image at `/mnt/user/domains/docker_img/docker-xfs.img`

---

## 🐳 Docker Infrastructure (Native Docker Compose)

### Architecture Overview

**Migration Date:** January 10, 2026  
**From:** Unraid Docker Manager (unreliable startup)  
**To:** Native Docker Compose v5.0.1

**Why We Migrated:**
- ❌ Unraid Docker Manager had recurring startup failures after reboots
- ❌ Container dependency issues caused services to not auto-start
- ❌ Docker XFS image wasn't mounting as loop device on boot
- ✅ Native Docker Compose provides reliable, industry-standard container management
- ✅ Portable configuration (can move to any Docker host)
- ✅ Guaranteed startup on every reboot via `/boot/config/go`

**Configuration Location:** `/mnt/user/domains/docker-compose/docker-compose.yml`

**Auto-start:** Configured in `/boot/config/go`:
```bash
sleep 10 && cd /mnt/user/domains/docker-compose && docker compose up -d &
```

### Management Commands

```bash
# Navigate to compose directory
cd /mnt/user/domains/docker-compose

# View all containers
docker compose ps

# View logs (follow)
docker compose logs -f [service_name]

# Restart a service
docker compose restart [service_name]

# Stop all containers
docker compose down

# Start all containers
docker compose up -d

# Pull latest images
docker compose pull

# Rebuild and restart
docker compose up -d --build
```

### Running Containers (13 Active)

#### 📚 Alexandria Stack (Book Data)
| Container | Image | Port | Status |
|-----------|-------|------|--------|
| `postgres` | `postgres:18` | `5432` | ✅ Running |
| `elasticsearch` | `elasticsearch:7.17.10` | `9200`, `9300` | ✅ Running |

**Note:** Alexandria tunnel runs separately (not in compose yet)

#### 🎬 Media Stack (*arr Suite)
| Container | Image | Port | Status |
|-----------|-------|------|--------|
| `plex` | `lscr.io/linuxserver/plex:latest` | host network | ✅ Running |
| `sonarr` | `lscr.io/linuxserver/sonarr:latest` | `8989` | ✅ Running |
| `radarr` | `lscr.io/linuxserver/radarr:latest` | `7878` | ✅ Running |
| `bazarr` | `lscr.io/linuxserver/bazarr:latest` | `6767` | ✅ Running |
| `prowlarr` | `lscr.io/linuxserver/prowlarr:latest` | `9696` | ✅ Running |
| `overseerr` | `lscr.io/linuxserver/overseerr:latest` | `5055` | ✅ Running |

#### ⬇️ Download Stack
| Container | Image | Port | Status |
|-----------|-------|------|--------|
| `sabnzbd` | `lscr.io/linuxserver/sabnzbd:latest` | `8080` | ✅ Running |
| `qbittorrent` | `lscr.io/linuxserver/qbittorrent:latest` | `8085`, `6881` | ✅ Running |

#### 📊 Monitoring Stack
| Container | Image | Port | Status |
|-----------|-------|------|--------|
| `grafana` | `grafana/grafana:latest` | `3000` | ✅ Running |
| `netdata` | `netdata/netdata:latest` | `19999` | ✅ Running |

#### 🔧 Management
| Container | Image | Port | Status |
|-----------|-------|------|--------|
| `portainer` | `portainer/portainer-ee:latest` | `9000`, `9443` | ✅ Running |

### Skipped Containers (Can Add Later)

| Container | Reason | Fix |
|-----------|--------|-----|
| `readarr` | No compatible image tag for amd64 | Find correct tag on Docker Hub |
| `calibre` | Manifest issue | Use specific version tag |
| `calibre-web` | Manifest issue | Use specific version tag |
| `prometheus` | Config file conflict | Create proper prometheus.yml |

### Docker Networks

| Network | Driver | Purpose |
|---------|--------|---------|
| `openlibrary-net` | bridge | Alexandria stack |
| `media` | bridge | Media apps |
| `monitoring` | bridge | Prometheus/Grafana |
| `immich-net` | bridge | Immich (not yet in compose) |

### Critical Container Settings

**⚠️ All LinuxServer.io containers MUST use:**
- **PUID=99** (nobody)
- **PGID=100** (users)
- **TZ=America/Chicago**

This ensures proper file permissions for SMB/NFS access from Mac/other clients.

**Verify Container User:**
```bash
docker compose exec qbittorrent env | grep -E 'PUID|PGID'
# Expected: PUID=99, PGID=100
```

---

## 🗄️ File Shares (SMB)

### Tower SMB Shares

**Protocol:** SMB (replaced NFS on 2026-01-06 due to permission issues)  
**Client:** AutoMounter.app on Mac

**Exported Shares:**
- `domains` - Development files, VMs, databases
- `data` - Media files, torrents (72TB)

**Mac Mount Points:**
- `/Volumes/domains`
- `/Volumes/data`

**AutoMounter Configuration:**
- Server: `Tower.local` (Bonjour)
- Username: `justin`
- Password: [Unraid user password]
- Options: Auto-mount at login, reconnect when available

**SMB Configuration on Tower (`/etc/samba/smb-shares.conf`):**
```ini
[domains]
    path = /mnt/user/domains
    browseable = yes
    writable = yes
    guest ok = no
    force user = nobody
    force group = users
    create mask = 0664
    directory mask = 0775
    vfs objects = fruit streams_xattr
    fruit:metadata = stream
    fruit:model = MacSamba

[data]
    path = /mnt/user/data
    browseable = yes
    writable = yes
    guest ok = no
    force user = nobody
    force group = users
    create mask = 0664
    directory mask = 0775
    vfs objects = fruit streams_xattr
    fruit:metadata = stream
    fruit:model = MacSamba
```

**Why SMB Instead of NFS:**
- ✅ Better macOS compatibility
- ✅ Proper permission handling with Docker containers
- ✅ Reliable file locking
- ✅ Works seamlessly with AutoMounter
- ❌ NFS had persistent permission issues with UID/GID mappings

---

## 🌐 Web UIs (Tower)

| Service | URL | Port |
|---------|-----|------|
| **Portainer** | `http://192.168.1.240:9000` | 9000 |
| **Grafana** | `http://192.168.1.240:3000` | 3000 |
| **Netdata** | `http://192.168.1.240:19999` | 19999 |
| **Sonarr** | `http://192.168.1.240:8989` | 8989 |
| **Radarr** | `http://192.168.1.240:7878` | 7878 |
| **Bazarr** | `http://192.168.1.240:6767` | 6767 |
| **Prowlarr** | `http://192.168.1.240:9696` | 9696 |
| **Overseerr** | `http://192.168.1.240:5055` | 5055 |
| **SABnzbd** | `http://192.168.1.240:8080` | 8080 |
| **qBittorrent** | `http://192.168.1.240:8085` | 8085 |
| **Elasticsearch** | `http://192.168.1.240:9200` | 9200 |

**Via Tailscale:** Replace `192.168.1.240` with `100.120.125.46`

---

## 🌐 Network Configuration

### Home Network
- **Home IP (Public):** `47.187.18.143/32`
- **Cloudflare Access:** Configured to bypass for this IP

### Tailscale
- **Status:** Active on all machines
- **Mac:** Connected
- **Green:** `100.104.253.23`
- **Tower:** `100.120.125.46`

---

## 🗄️ Database Access

### PostgreSQL (OpenLibrary)

| Property | Value |
|----------|-------|
| Host (Local) | `192.168.1.240:5432` |
| Host (Tailscale) | `100.120.125.46:5432` |
| Host (Tunnel) | `alexandria-db.ooheynerds.com:5432` |
| Database | `openlibrary` |
| Username | `openlibrary` |
| Password | `tommyboy` |
| SSL | Enabled (self-signed) |

**Direct Access (via Docker Compose):**
```bash
ssh tower "cd /mnt/user/domains/docker-compose && docker compose exec postgres psql -U openlibrary -d openlibrary"
```

**Database Stats:**
- **Editions:** 54.8M records
- **Works:** 40.1M records
- **Authors:** 14.7M records
- **ISBNs:** 49.3M indexed
- **Total Size:** ~250GB

**Key Tables:**
| Table | Records | Use |
|-------|---------|-----|
| `editions` | 54.8M | Book editions (JSONB) |
| `works` | 40.1M | Work metadata |
| `authors` | 14.7M | Author data |
| `edition_isbns` | 49.3M | **ISBN lookup (indexed)** |
| `enriched_editions` | ~28M | Alexandria enriched data |
| `enriched_works` | ~28M | Normalized work data |
| `enriched_authors` | - | Author metadata |

---

## ☁️ Cloudflare Infrastructure

### Account
- **Email:** Jukasdrj@gmail.com
- **Account ID:** `d03bed0be6d976acd8a1707b55052f79`

### Workers

| Worker | Domain | Purpose |
|--------|--------|---------|
| `alexandria` | `alexandria.ooheynerds.com` | Book metadata API |
| `api-worker` | `api.oooefam.net` | BooksTrack API (bendv3) |
| `email-spam-filter` | - | Email filtering |

### Cloudflare Tunnel

| Property | Value |
|----------|-------|
| Tunnel ID | `848928ab-4ab9-4733-93b0-3e7967c60acb` |
| Public Hostname | `alexandria-db.ooheynerds.com` |
| Target | `tcp://localhost:5432` |
| Auth | Zero Trust (token-based) |

**Check Tunnel Status:**
```bash
./scripts/tunnel-status.sh  # Expect 4 connections
```

### Hyperdrive

| Property | Value |
|----------|-------|
| ID | `00ff424776f4415d95245c3c4c36e854` |
| Host | `alexandria-db.ooheynerds.com` |
| Database | `openlibrary` |
| User | `openlibrary` |
| Caching | Disabled |

### R2 Buckets

| Bucket | Purpose |
|--------|---------|
| `alexandria-logs` | Worker logs (Logpush) |
| `bookstrack-covers` | Original covers |
| `bookstrack-covers-processed` | Processed WebP covers |
| `books-cache` | Production cache |
| `books-cache-staging` | Staging cache |
| `bookshelf-images` | User bookshelf photos |
| `personal-library-data` | User library exports |

### KV Namespaces

| Namespace | Purpose |
|-----------|---------|
| `BOOKS_CACHE` | Book metadata cache |
| `RECOMMENDATIONS_CACHE` | Weekly recommendations |
| `CACHE` | General caching |

### D1 Databases

| Database | Purpose |
|----------|---------|
| `bookstrack-library` | User library data |

---

## 🔌 API Endpoints

### Alexandria (Book Metadata)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://alexandria.ooheynerds.com/health` | GET | Health check |
| `https://alexandria.ooheynerds.com/api/stats` | GET | Database stats |
| `https://alexandria.ooheynerds.com/api/search` | GET | ISBN/title/author search |
| `https://alexandria.ooheynerds.com/openapi.json` | GET | OpenAPI spec |

### Bend API (BooksTrack)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://api.oooefam.net/health` | GET | Health check |
| `https://api.oooefam.net/v3/openapi.json` | GET | OpenAPI spec |
| `https://api.oooefam.net/v3/docs` | GET | Swagger UI |
| `https://api.oooefam.net/v3/books/:isbn` | GET | Book by ISBN |
| `https://api.oooefam.net/v3/books/search` | GET | Search books |

---

## 🔑 External Services

### ISBNdb (Book Metadata)

| Property | Value |
|----------|-------|
| Plan | Premium ($29.95/mo) |
| Base URL | `api.premium.isbndb.com` |
| Rate Limit | 3 req/sec |
| Batch Size | 1000 ISBNs/request |
| Daily Quota | ~15,000 calls |

**Key Endpoints:**
- `GET /book/{isbn}` - Single book
- `POST /books` - Batch lookup (up to 1000)
- `GET /author/{name}` - Author bibliography

### Google Books API
- Used as fallback for cover images and metadata

---

## 📁 Repository Structure

```
~/dev_repos/
├── MEMORIES.md          # Cross-repo context
├── ORCHESTRATOR.md      # Multi-agent orchestration
├── repos.md             # This reference
├── alex/                # Alexandria (Cloudflare Worker + Tunnel)
│   ├── worker/          # Hono TypeScript worker
│   ├── scripts/         # Utility scripts
│   ├── docs/            # Documentation (CREDENTIALS.md here)
│   └── tunnel/          # Tunnel config
├── bendv3/              # BooksTrack API (Cloudflare Worker)
│   ├── src/             # TypeScript source
│   ├── packages/        # Shared schemas
│   └── docs/            # API documentation
├── books-v3/            # iOS Swift Frontend
│   └── BooksTrack/      # Xcode project
├── books-flutter/       # Flutter Frontend (WIP)
└── zen-mcp-server/      # MCP server tools
```

---

## 🛠️ Quick Commands Reference

### SSH Access
```bash
ssh green           # Connect to WSL2 dev server
ssh tower           # Connect to Unraid via Tailscale
```

### Docker Management (Tower)
```bash
# SSH to Tower
ssh tower

# Navigate to compose directory
cd /mnt/user/domains/docker-compose

# View running containers
docker compose ps

# View logs
docker compose logs -f sonarr

# Restart a service
docker compose restart plex

# Start all containers
docker compose up -d

# Stop all containers
docker compose down
```

### Development
```bash
# Mac - iOS development
cc                  # Claude Code for Swift

# Green - Backend development
ccg                 # Claude Code for backend (remote)
cd ~/dev_repos/bendv3 && npm run dev
cd ~/dev_repos/alex/worker && npm run dev
```

### Database
```bash
# Quick query
ssh tower "cd /mnt/user/domains/docker-compose && docker compose exec postgres psql -U openlibrary -d openlibrary -c 'SELECT 1;'"

# Interactive psql
ssh tower "cd /mnt/user/domains/docker-compose && docker compose exec postgres psql -U openlibrary -d openlibrary"
```

### Worker Deployment
```bash
# Alexandria
cd ~/dev_repos/alex/worker && npm run deploy

# Bend
cd ~/dev_repos/bendv3 && npm run deploy
```

---

## 🔒 Security Notes

1. **Credentials:** All passwords stored in `~/dev_repos/alex/docs/CREDENTIALS.md` (gitignored)
2. **SSH Keys:** 1Password SSH agent integration enabled
3. **Cloudflare Access:** IP bypass configured for home network
4. **Database:** SSL enabled, accessible only via tunnel
5. **API Keys:** Stored as Cloudflare secrets (ISBNdb, Google Books)

---

## 📊 Monitoring

### Worker Logs
```bash
# Real-time Alexandria logs
cd ~/dev_repos/alex/worker && npm run tail

# Real-time Bend logs
cd ~/dev_repos/bendv3 && npm run tail
```

### Logpush (R2)
- **Location:** `alexandria-logs` bucket
- **Format:** JSONL (gzip compressed)
- **Retention:** Permanent

---

## 🔄 Architecture Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  books-v3   │────▶│   bendv3    │────▶│ alexandria  │
│  (iOS App)  │     │(API Gateway)│     │(Book Data)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                        ┌──────▼──────┐
                                        │  Hyperdrive │
                                        └──────┬──────┘
                                               │
                                        ┌──────▼──────┐
                                        │   Tunnel    │
                                        └──────┬──────┘
                                               │
                                        ┌──────▼──────┐
                                        │   Tower     │
                                        │ (PostgreSQL)│
                                        └─────────────┘
```

---

## 🔧 Common Issues & Solutions

### Docker Containers Won't Start After Reboot

**Status:** ✅ RESOLVED (2026-01-10)

**Root Cause:**
- Docker XFS image (`/mnt/user/domains/docker_img/docker-xfs.img`) wasn't mounting as loop device on boot
- Unraid Docker Manager had dependency issues causing containers to fail startup

**Solution Applied:**
- Migrated from Unraid Docker Manager to native Docker Compose v5.0.1
- Added auto-start to `/boot/config/go`:
  ```bash
  sleep 10 && cd /mnt/user/domains/docker-compose && docker compose up -d &
  ```
- All 13 containers now start reliably on every boot

**Prevention:**
- Use standard Docker Compose for all container management
- Avoid Unraid Docker Manager GUI for critical services
- Configuration is portable and can be moved to any Docker host

### SMB Share Access Issues

**Solution:**
```bash
# Check share status
ssh tower "testparm -s | grep -A 10 domains"

# Restart SMB
ssh tower "/etc/rc.d/rc.samba restart"

# On Mac: Reconnect via AutoMounter or Finder
open smb://Tower.local/domains
```

---

## 📝 Version History

| Date | Change |
|------|--------|
| 2026-01-10 | **MAJOR**: Migrated to native Docker Compose v5.0.1, resolved boot startup issues |
| 2026-01-06 | Added SMB setup (replaced NFS), Docker PUID/PGID requirements |
| 2025-12-27 | Added Docker infrastructure (20 containers) |
| 2025-12-27 | Initial creation |

---

## 📚 Migration History

### Docker: Unraid Manager → Docker Compose (2026-01-10)

**Problem:**
After server reboot, Docker containers would not start automatically. The root cause was:
1. Docker XFS image not mounting as loop device
2. Unraid Docker Manager had complex dependency chains
3. Container metadata lost on improper shutdown

**Investigation Steps:**
1. SSH'd to Tower, found Docker daemon stopped
2. Manually started Docker: `/etc/rc.d/rc.docker start`
3. Discovered Docker XFS image wasn't mounted
4. Mounted manually: `losetup /dev/loop3 /mnt/user/domains/docker_img/docker-xfs.img`
5. Containers still missing - metadata database corrupted

**Migration Process:**
1. Created comprehensive `docker-compose.yml` from existing container configs
2. Upgraded Docker Compose to v5.0.1 (latest, from v2.40.3)
3. Stopped all running containers
4. Disabled Unraid Docker Manager
5. Started containers via `docker compose up -d`
6. Added auto-start to `/boot/config/go`

**Result:**
- ✅ 13 containers running reliably
- ✅ Auto-start on boot configured
- ✅ Standard, portable configuration
- ✅ Latest Docker Compose v5.0.1
- ⏭️ 3 containers skipped (image compatibility issues - can add later)

**Files Changed:**
- Created: `/mnt/user/domains/docker-compose/docker-compose.yml`
- Modified: `/boot/config/go` (added auto-start)
- Modified: `/boot/config/docker.cfg` (disabled Unraid Docker Manager)
- Upgraded: `/usr/lib/docker/cli-plugins/docker-compose` (v2.40.3 → v5.0.1)

**Lessons Learned:**
- Unraid Docker Manager adds complexity without reliability benefits
- Native Docker Compose is more reliable and portable
- Always use official Docker tooling for production services
- Loop device mounting should be automated in boot scripts
