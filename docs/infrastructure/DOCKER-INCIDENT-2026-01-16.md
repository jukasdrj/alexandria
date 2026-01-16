# Docker Incident Report - 2026-01-16

## Summary
5th major Docker failure on Tower Unraid server. Only 9 of 16 containers were running.

## Root Cause
**Unraid Community Apps Docker Auto Update plugin** was conflicting with our Docker Compose setup.

### Timeline
- **4:00:08 AM** - Unraid Docker Auto Update started, stopped all containers
- **4:01:03 AM** - Plugin tried to restart containers via Unraid Docker Manager
- **4:01:05 AM** - Plugin finished, but containers weren't properly restarted
- Since we use Docker Compose (not Unraid Docker Manager), the plugin couldn't restart our containers

### Evidence from syslog
```
Jan 16 04:00:08 Tower Docker Auto Update: Stopping netdata
Jan 16 04:00:09 Tower Docker Auto Update: Stopping overseerr
...
Jan 16 04:01:03 Tower Docker Auto Update: Restarting bazarr
Jan 16 04:01:03 Tower Docker Auto Update: Restarting elasticsearch
...
Jan 16 04:01:05 Tower Docker Auto Update: Community Applications Docker Autoupdate finished
```

## Resolution

### 1. Disabled Unraid Docker Auto Update
```bash
# Changed DockerUpdateSettings.json:
{
    "cron": {
        "dockerCronFrequency": "disabled",  # Was "Daily"
        ...
    },
    "global": {
        "dockerNotify": "no",
        "dockerUpdateAll": "no"            # Was "yes"
    }
}

# Removed cron job
rm -f /boot/config/plugins/ca.update.applications/docker_update.cron
```

### 2. Restarted All Containers
```bash
cd /mnt/user/domains/docker-compose
docker compose up -d
```

### 3. Updated Boot Script
Added better logging to `/boot/config/go`:
```bash
#!/bin/bash
ln -sf /mnt/cache/system/docker-bin/docker /usr/local/bin/docker
sleep 45
echo "$(date): Starting Docker Compose containers" >> /var/log/docker-compose-startup.log
cd /mnt/user/domains/docker-compose && docker compose up -d >> /var/log/docker-compose-startup.log 2>&1
echo "$(date): Docker Compose startup completed with exit code $?" >> /var/log/docker-compose-startup.log
echo "$(date): Running containers: $(docker ps -q | wc -l)" >> /var/log/docker-compose-startup.log
```

## Final Status
All 16 containers running:
- alexandria-tunnel ✅
- bazarr ✅
- elasticsearch ✅
- grafana ✅
- netdata ✅
- overseerr ✅
- plex ✅
- portainer ✅
- postgres ✅
- prometheus ✅
- prowlarr ✅
- qbittorrent ✅
- radarr ✅
- sabnzbd ✅
- sonarr ✅
- watchtower ✅

## Prevention
1. **NEVER re-enable Unraid Community Apps Docker Auto Update**
2. **Watchtower is the ONLY auto-update system** (already configured in Docker Compose)
3. **NEVER use Unraid Docker Manager GUI** for these containers
4. Check `/var/log/docker-compose-startup.log` for boot issues

## Two Update Systems Were Conflicting

| System | Purpose | Status |
|--------|---------|--------|
| Unraid Community Apps Docker Auto Update | Unraid's built-in updater | **DISABLED** |
| Watchtower (Docker Compose) | Industry-standard container updater | **ACTIVE** (only updater) |
