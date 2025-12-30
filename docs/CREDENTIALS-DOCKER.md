# Docker Service Credentials

**Last Updated:** December 27, 2025  
**Location:** Tower (192.168.1.240 / 100.120.125.46)

⚠️ **IMPORTANT**: Keep this file secure and do not commit to public repos!

---

## 🔐 Web UI Logins

| Service | Port | URL | Username | Password | Status |
|---------|------|-----|----------|----------|--------|
| **Portainer** | 9000 | `http://192.168.1.240:9000` | `admin` | `tommyboy` | ✅ |
| **Grafana** | 3000 | `http://192.168.1.240:3000` | `admin` | `admin` | ⚠️ Default |
| **qBittorrent** | 8085 | `http://192.168.1.240:8085` | `admin` | `tommyboy` | ✅ |
| **SABnzbd** | 8080 | `http://192.168.1.240:8080` | `jukasdrj` | `tommyboy` | ✅ |
| **Immich** | 2283 | `http://192.168.1.240:2283` | (email login) | - | ✅ |
| **Overseerr** | 5055 | `http://192.168.1.240:5055` | (Plex OAuth) | - | ✅ |

**Via Tailscale:** Replace `192.168.1.240` with `100.120.125.46`

---

## 🔑 API Keys

### *arr Suite

| Service | Port | API Key |
|---------|------|---------|
| **Sonarr** | 8989 | `9fa7e5e0c8b9421ca460a1e38cbb3e63` |
| **Radarr** | 7878 | `e48db3ddbeeb41f0bd9074dfbf82f42b` |
| **Readarr** | 8787 | `eb4dffaa3188474b9d7cd46123fabd34` |
| **Prowlarr** | 9696 | `ca797b36d94a458787dd111f8eafe703` |
| **Bazarr** | 6767 | `71c81661b04ea931bbfff8dff620c561` |

### Download Clients

| Service | Port | API Key |
|---------|------|---------|
| **SABnzbd** | 8080 | `f8778f7df83a490286189dbd43bffc95` |
| **SABnzbd NZB Key** | 8080 | `09019ae0fc9b45f7855f328872016da2` |

### Media

| Service | Token/Key |
|---------|-----------|
| **Plex** | `Vdyg-oamo7LXXiKbn3jM` |

---

## 🗄️ Database Credentials

### OpenLibrary (Alexandria)

| Property | Value |
|----------|-------|
| Container | `postgres` |
| Host | `localhost:5432` (from Tower) |
| Database | `openlibrary` |
| Username | `openlibrary` |
| Password | `tommyboy` |

### Immich

| Property | Value |
|----------|-------|
| Container | `immich_postgres` |
| Database | `immich` |
| Username | `postgres` |
| Password | `postgres` |

---

## 🌐 No-Auth Services

These services have no authentication (internal network only):

| Service | Port | URL |
|---------|------|-----|
| **Prometheus** | 9090 | `http://192.168.1.240:9090` |
| **Elasticsearch** | 9200 | `http://192.168.1.240:9200` |
| **cAdvisor** | 8081 | `http://192.168.1.240:8081` |

---

## 📍 Config File Locations (on Tower)

```
/mnt/user/appdata/
├── sonarr/config.xml          # Sonarr API key
├── radarr/config.xml          # Radarr API key
├── readarr/config.xml         # Readarr API key
├── prowlarr/config.xml        # Prowlarr API key
├── bazarr/config/config.yaml  # Bazarr API key
├── sabnzbd/sabnzbd.ini        # SABnzbd credentials
├── qbittorrent/               # qBittorrent config
├── plex/                      # Plex preferences
├── monitoring/                # Prometheus/Grafana
└── immich/                    # Immich config (if exists)
```

---

## 🔄 API Usage Examples

### Sonarr
```bash
curl -s "http://192.168.1.240:8989/api/v3/system/status" \
  -H "X-Api-Key: 9fa7e5e0c8b9421ca460a1e38cbb3e63"
```

### Radarr
```bash
curl -s "http://192.168.1.240:7878/api/v3/system/status" \
  -H "X-Api-Key: e48db3ddbeeb41f0bd9074dfbf82f42b"
```

### SABnzbd
```bash
curl -s "http://192.168.1.240:8080/api?mode=queue&apikey=f8778f7df83a490286189dbd43bffc95&output=json"
```

### Plex
```bash
curl -s "http://192.168.1.240:32400/status/sessions" \
  -H "X-Plex-Token: Vdyg-oamo7LXXiKbn3jM"
```

---

## ⚠️ Security Notes

1. **Grafana** is using default `admin/admin` - consider changing
2. **Prometheus/Elasticsearch** have no auth - keep internal only
3. **Usenet provider credentials** are stored in SABnzbd config
4. **API keys** should be rotated if exposed

---

## 📝 Version History

| Date | Change |
|------|--------|
| 2025-12-27 | Initial discovery and documentation |
