# Tower Docker - Quick Reference

**Last Updated:** 2026-01-10  
**System:** Native Docker Compose v5.0.1 (official)

---

## 🚀 Quick Start

```bash
# SSH to Tower
ssh tower

# Navigate to compose directory
cd /mnt/user/domains/docker-compose

# View status
docker compose ps

# Start all containers
docker compose up -d

# Stop all containers
docker compose down
```

---

## 📊 Running Services (13 containers)

| Service | Port | URL |
|---------|------|-----|
| Portainer | 9000 | http://192.168.1.240:9000 |
| Plex | host | http://192.168.1.240:32400/web |
| Sonarr | 8989 | http://192.168.1.240:8989 |
| Radarr | 7878 | http://192.168.1.240:7878 |
| Bazarr | 6767 | http://192.168.1.240:6767 |
| Prowlarr | 9696 | http://192.168.1.240:9696 |
| Overseerr | 5055 | http://192.168.1.240:5055 |
| SABnzbd | 8080 | http://192.168.1.240:8080 |
| qBittorrent | 8085 | http://192.168.1.240:8085 |
| Grafana | 3000 | http://192.168.1.240:3000 |
| Netdata | 19999 | http://192.168.1.240:19999 |
| PostgreSQL | 5432 | Direct connection only |
| Elasticsearch | 9200 | http://192.168.1.240:9200 |

---

## 🛠️ Common Commands

```bash
# View logs (follow)
docker compose logs -f [service_name]

# Restart a service
docker compose restart [service_name]

# Pull latest images
docker compose pull

# Rebuild and restart
docker compose up -d --build

# View resource usage
docker compose top

# Execute command in container
docker compose exec [service_name] [command]

# Access postgres
docker compose exec postgres psql -U openlibrary -d openlibrary
```

---

## 🔧 Troubleshooting

### Container won't start
```bash
# Check logs
docker compose logs [service_name]

# Check container status
docker compose ps -a

# Restart the service
docker compose restart [service_name]
```

### All containers stopped
```bash
# Check Docker daemon
/etc/rc.d/rc.docker status

# Restart Docker
/etc/rc.d/rc.docker restart

# Start containers
cd /mnt/user/domains/docker-compose
docker compose up -d
```

### After reboot - containers not running
```bash
# Auto-start should handle this, but if not:
cd /mnt/user/domains/docker-compose
docker compose up -d
```

---

## 📝 Important Notes

- **NEVER** use Unraid Docker Manager GUI for these containers
- All configs are in `/mnt/user/domains/docker-compose/docker-compose.yml`
- Data is preserved in `/mnt/cache/appdata/[service_name]`
- Auto-start is configured in `/boot/config/go`
- PUID=99, PGID=100 for all LinuxServer.io containers

---

## 🔐 Credentials

See `/Users/juju/dev_repos/alex/docs/CREDENTIALS.md` for:
- Portainer: admin / tommyboy
- PostgreSQL: openlibrary / tommyboy
- Grafana: admin / admin (default)

---

## 📁 File Locations

| Path | Purpose |
|------|---------|
| `/mnt/user/domains/docker-compose/` | Docker Compose config |
| `/mnt/cache/appdata/` | Container data |
| `/mnt/user/data/` | Media files |
| `/boot/config/go` | Auto-start script |

---

## ⚡ Pro Tips

1. **Always** run compose commands from `/mnt/user/domains/docker-compose/`
2. Use `docker compose ps` to check status before making changes
3. View logs with `-f` to follow in real-time
4. Update all containers: `docker compose pull && docker compose up -d`
5. Backup before major changes: `cp docker-compose.yml docker-compose.yml.bak`

---

**Need help?** See full docs at:
- `/Users/juju/dev_repos/alex/docs/infrastructure/INFRASTRUCTURE.md`
- `/Users/juju/dev_repos/alex/docs/infrastructure/DOCKER-MIGRATION-2026-01-10.md`
