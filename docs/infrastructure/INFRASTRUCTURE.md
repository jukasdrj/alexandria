# 🏠 BooksTrack Infrastructure Reference

**Last Updated:** December 27, 2025  
**Owner:** Justin Gardner (@jukasdrj)

---

## 📍 Quick Access Table

| System | Internal IP | Tailscale IP | SSH Command | Purpose |
|--------|-------------|--------------|-------------|---------|
| **Mac (Local)** | N/A | N/A | N/A | iOS/Swift development |
| **Green** | N/A | `100.76.189.58` | `ssh green` | WSL2 dev server (Flutter/Backend) |
| **Tower** | `192.168.1.240` | `100.120.125.46` | `ssh tower` | Unraid - PostgreSQL/OpenLibrary DB |

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
| RAM | 64GB |
| Storage | NVMe |
| SSH User | justin |
| SSH Port | 22 (standard) |
| Tailscale IP | `100.76.189.58` |
| Dev Path | `~/dev_repos/` |
| Claude Code | `ccg` |

**SSH Config:**
```bash
Host green
    HostName 100.76.189.58
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
| SSH | Requires Tailscale browser auth |

**SSH Config:**
```bash
Host tower
    HostName 100.120.125.46
    User root
    IdentityFile ~/.ssh/id_ed25519
    # Local IP fallback: 192.168.1.240
```

**Primary Use:** Media server, PostgreSQL databases, monitoring, photo management

**Hardware:** AMD Ryzen 5 9600X 6-Core

---

## 🐳 Docker Infrastructure

### Tower Containers

#### 📚 Alexandria Stack (Book Data)
| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `postgres` | `postgres` | `5432` | OpenLibrary DB (54M+ books) |
| `alexandria-tunnel` | `cloudflare/cloudflared` | - | Cloudflare Tunnel to DB |
| `openlibrary-elasticsearch` | `elasticsearch:6.6.2` | `9200`, `9300` | Search indexing |

#### 📷 Immich Stack (Photo Management)
| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `immich_server` | `ghcr.io/immich-app/immich-server` | `2283` | Photo server UI |
| `immich_machine_learning` | `ghcr.io/immich-app/immich-machine-learning` | - | ML processing |
| `immich_postgres` | `tensorchord/pgvecto-rs:pg14-v0.2.0` | - | Immich database |
| `immich_redis` | `redis:6.2-alpine` | - | Caching |

**Immich DB Credentials:**
- Database: `immich`
- User: `postgres`
- Password: `postgres`

#### 🎬 Media Stack (*arr Suite)
| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `Plex-Media-Server` | `plexinc/pms-docker` | - | Media streaming |
| `sonarrHot` | `ghcr.io/hotio/sonarr` | `8989` | TV show management |
| `radarrHot` | `ghcr.io/hotio/radarr` | `7878` | Movie management |
| `readarr` | `ghcr.io/hotio/readarr` | `8787` | Book/audiobook management |
| `bazarr` | `ghcr.io/hotio/bazarr` | `6767` | Subtitle management |
| `overseerr` | `lscr.io/linuxserver/overseerr` | `5055` | Request management |

#### ⬇️ Download Stack
| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `sabnzbd` | `lscr.io/linuxserver/sabnzbd` | `8080` | Usenet downloader |
| `qbittorrent` | `lscr.io/linuxserver/qbittorrent` | `8085`, `6881` | Torrent client |

#### 📊 Monitoring Stack
| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `grafana` | `grafana/grafana` | `3000` | Dashboards |
| `prometheus` | `prom/prometheus` | `9090` | Metrics collection |
| `cadvisor` | `gcr.io/cadvisor/cadvisor` | `8081` | Container metrics |
| `node_exporter` | `prom/node-exporter` | - | Host metrics |

#### 🔧 Management
| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `portainer` | `portainer/portainer-ee` | `9000`, `9443` | Container management UI |

### Green Containers

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `portainer_agent` | `portainer/agent` | `9001` | Remote management agent |

### Docker Networks

| Network | Driver | Purpose |
|---------|--------|---------|
| `immich_immich-net` | bridge | Immich stack |
| `media` | bridge | Media apps |
| `monitoring_monitoring` | bridge | Prometheus/Grafana |
| `openlibrary-net` | bridge | Alexandria stack |
| `br0` | ipvlan | Direct LAN access |

---

## 🌐 Web UIs (Tower)

| Service | URL | Default Port |
|---------|-----|--------------|
| **Portainer** | `http://192.168.1.240:9000` | 9000 |
| **Immich** | `http://192.168.1.240:2283` | 2283 |
| **Grafana** | `http://192.168.1.240:3000` | 3000 |
| **Prometheus** | `http://192.168.1.240:9090` | 9090 |
| **Sonarr** | `http://192.168.1.240:8989` | 8989 |
| **Radarr** | `http://192.168.1.240:7878` | 7878 |
| **Readarr** | `http://192.168.1.240:8787` | 8787 |
| **Bazarr** | `http://192.168.1.240:6767` | 6767 |
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
- **Green:** `100.76.189.58`
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
| SSL | Enabled (self-signed) |

**Direct Access (via SSH):**
```bash
ssh tower "docker exec postgres psql -U openlibrary -d openlibrary"
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
ssh tower           # Connect to Unraid (needs Tailscale auth)
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
ssh tower "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT 1;'"

# Interactive psql
ssh tower "docker exec -it postgres psql -U openlibrary -d openlibrary"
```

### Tunnel Management
```bash
# Check status
ssh tower "docker ps | grep tunnel"

# Restart tunnel
ssh tower "docker restart alexandria-tunnel"

# View tunnel logs
ssh tower "docker logs alexandria-tunnel --tail 50"
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

## 📝 Version History

| Date | Change |
|------|--------|
| 2025-12-27 | Added Docker infrastructure (20 containers) |
| 2025-12-27 | Initial creation |
