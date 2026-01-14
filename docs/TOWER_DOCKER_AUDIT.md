# Tower Docker Infrastructure Audit
**Date**: January 13, 2026  
**Auditor**: Claude (via justin request)

## Executive Summary

The Tower Unraid server is in a **mixed management state** with containers split between legacy Unraid Docker Manager and modern docker-compose. Critical issues identified:

1. ❌ **Prometheus is dead** (Created state, never started)
2. ⚠️ **Mixed management** (7 Unraid-managed, 7 compose-managed, 1 manual)
3. ⚠️ **Postgres on wrong image** (using generic `postgres` instead of `postgres:18`)
4. ⚠️ **No auto-updates** configured for any containers
5. ⚠️ **Restart policies inconsistent** (7 containers have `restart: no`)
6. ✅ **Postgres well-optimized** (15GB shared buffers, 45GB cache)

## Container Inventory

### Managed by Docker Compose (7 containers)
| Container | Image | Status | Restart Policy |
|-----------|-------|--------|----------------|
| elasticsearch | elasticsearch:7.17.10 | ✅ Running | unless-stopped |
| grafana | grafana/grafana:latest | ✅ Running | unless-stopped |
| portainer | portainer/portainer-ee:latest | ✅ Running | unless-stopped |
| prowlarr | lscr.io/linuxserver/prowlarr:latest | ✅ Running | unless-stopped |
| radarr | lscr.io/linuxserver/radarr:latest | ✅ Running | unless-stopped |
| sonarr | lscr.io/linuxserver/sonarr:latest | ✅ Running | unless-stopped |
| **prometheus** | prom/prometheus:latest | ❌ **DEAD (Created)** | unless-stopped |

### Managed by Unraid Docker Manager (7 containers)
| Container | Image | Status | Restart Policy |
|-----------|-------|--------|----------------|
| postgres | postgres (no tag!) | ✅ Running | ❌ **no** |
| netdata | netdata/netdata | ✅ Running | ❌ **no** |
| plex | lscr.io/linuxserver/plex | ✅ Running | ❌ **no** |
| qbittorrent | lscr.io/linuxserver/qbittorrent | ✅ Running | ❌ **no** |
| bazarr | ghcr.io/hotio/bazarr:latest | ✅ Running | ❌ **no** |
| sabnzbd | lscr.io/linuxserver/sabnzbd | ✅ Running | ❌ **no** |
| overseerr | lscr.io/linuxserver/overseerr | ✅ Running | ❌ **no** |

### Manually Managed (1 container)
| Container | Image | Status | Restart Policy |
|-----------|-------|--------|----------------|
| alexandria-tunnel | cloudflare/cloudflared:latest | ✅ Running | unless-stopped |

## Critical Issues

### 1. Prometheus Dead (HIGH PRIORITY)
**Status**: Container exists but never started (Created state for 3 days)
**Problem**: Prometheus config expects data directory that doesn't exist
**Root Cause**: Commented out in docker-compose.yml but container was created before commenting
**Evidence**:
```bash
# docker-compose.yml has prometheus commented out (lines 195-207)
# But container still exists in "Created" state from previous run
```

**Impact**: No metrics collection, Grafana has no data source

**Fix Required**:
```bash
# Option A: Enable prometheus in compose
cd /mnt/user/domains/docker-compose
# Uncomment prometheus section in docker-compose.yml
docker-compose up -d prometheus

# Option B: Remove dead container
docker rm prometheus
```

### 2. Mixed Container Management (HIGH PRIORITY)
**Problem**: Containers split across 3 management systems
- Docker Compose: 7 containers (elasticsearch, grafana, portainer, *arr stack)
- Unraid Docker Manager: 7 containers (postgres, netdata, plex, downloads)
- Manual: 1 container (alexandria-tunnel)

**Impact**: 
- Inconsistent restart policies
- Difficult to maintain/backup
- No unified update strategy
- Configuration drift

**Recommendation**: Migrate ALL to docker-compose

### 3. Postgres Image Version (MEDIUM PRIORITY)
**Current**: `postgres` (no tag = using old cached version)
**Compose Definition**: `postgres:18`
**Impact**: Not using latest postgres:18 features/security fixes

**Evidence**:
```bash
$ docker inspect postgres --format='{{.Config.Image}}'
postgres  # No version tag!

# compose.yml specifies postgres:18
```

**Fix**: Recreate postgres container from compose (requires data migration planning)

### 4. No Auto-Updates (MEDIUM PRIORITY)
**Current State**: ❌ No Watchtower or auto-update mechanism
**Impact**: Manual update burden, security patch delays

**Images Using `:latest` tag** (7 containers):
- grafana/grafana:latest
- prom/prometheus:latest  
- netdata/netdata (implied latest)
- lscr.io/linuxserver/* (6 containers using :latest)

**Recommendation**: Enable Watchtower or Unraid auto-update

### 5. Restart Policy Inconsistency (LOW PRIORITY)
**Unraid Containers**: All have `restart: no` 
**Compose Containers**: All have `restart: unless-stopped`
**Impact**: Unraid containers won't survive reboot/crash

## Postgres Configuration Analysis

✅ **Excellent tuning** for 54M+ row dataset:

| Setting | Value | Assessment |
|---------|-------|------------|
| shared_buffers | 15GB | ✅ Optimal for dataset |
| effective_cache_size | 45GB | ✅ Excellent (assumes 64GB RAM) |
| maintenance_work_mem | 2GB | ✅ Good for vacuuming |
| work_mem | 64MB | ✅ Reasonable |
| max_connections | 100 | ✅ Standard |

**Storage**:
- Data: `/mnt/user/domains/OL_DB/db/` (user share = parity protected ✅)
- Size: ~50GB estimated for 54M editions

**No optimization needed** - already well-configured!

## Grafana Configuration Analysis

**Current State**: ✅ Running, but **NO DATA SOURCE** (Prometheus dead)

**Directory**: `/mnt/cache/appdata/grafana` (cache = no parity ⚠️)
**User**: root (uid 0) - required for volume permissions

**Issues**:
1. No Prometheus data source configured
2. No dashboards for monitoring postgres/system
3. Running as root (security concern but necessary for LinuxServer images)

## Prometheus Configuration Analysis

❌ **DEAD CONTAINER**

**Expected Config**: `/mnt/cache/appdata/monitoring/prometheus.yml`
**Config Content**:
```yaml
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
```

**Problems**:
1. Only monitoring itself (no postgres, no system metrics)
2. No postgres_exporter configured
3. No node_exporter for system metrics
4. Container never started

## Recommended Action Plan

### Phase 1: Emergency Fixes (Do Now)
1. **Fix Prometheus**
   ```bash
   ssh tower
   cd /mnt/user/domains/docker-compose
   
   # Uncomment prometheus in docker-compose.yml
   # Then start it
   docker-compose up -d prometheus
   ```

2. **Verify Prometheus starts**
   ```bash
   docker logs prometheus
   curl http://tower.local:9090
   ```

### Phase 2: Consolidate to Docker Compose (This Week)
1. **Add missing containers to compose**:
   - postgres (already defined, just needs migration)
   - netdata (already defined, just needs migration)
   - plex (already defined, just needs migration)
   - sabnzbd (already defined, just needs migration)
   - overseerr (already defined, just needs migration)
   - bazarr (already defined - but wrong image source!)
   - qbittorrent (already defined, just needs migration)
   - alexandria-tunnel (needs to be added)

2. **Migration strategy**:
   ```bash
   # For each Unraid container:
   # 1. Document current settings (docker inspect)
   # 2. Stop Unraid container
   # 3. Remove from Unraid Docker Manager
   # 4. Start from compose
   # 5. Verify data persistence
   ```

3. **Update restart policies**:
   - All containers should use `restart: unless-stopped`
   - Already correct in compose.yml ✅

### Phase 3: Enable Monitoring (Next Week)
1. **Add postgres_exporter** to docker-compose.yml
2. **Configure Prometheus** to scrape:
   - postgres_exporter (postgres metrics)
   - netdata (system metrics)
   - node_exporter (optional, more detailed system metrics)
3. **Import Grafana dashboards**:
   - PostgreSQL Dashboard (ID: 9628)
   - Docker Dashboard (ID: 893)
   - System Dashboard (ID: 1860)

### Phase 4: Auto-Updates (Future)
1. **Option A**: Add Watchtower to docker-compose.yml
   ```yaml
   watchtower:
     image: containrrr/watchtower:latest
     container_name: watchtower
     volumes:
       - /var/run/docker.sock:/var/run/docker.sock
     environment:
       - WATCHTOWER_CLEANUP=true
       - WATCHTOWER_SCHEDULE=0 0 4 * * *  # 4am daily
     restart: unless-stopped
   ```

2. **Option B**: Use Unraid Community Applications Auto-Update plugin

## Specific Container Issues

### Bazarr Image Mismatch
**Running**: `ghcr.io/hotio/bazarr:latest` (Unraid)
**Compose**: `lscr.io/linuxserver/bazarr:latest`

**Issue**: Wrong image source!
**Fix**: Migrate to compose, will pull correct LinuxServer image

### Alexandria Tunnel Not in Compose
**Current**: Manually managed, restart: unless-stopped ✅
**Issue**: Not version controlled, not in backup

**Fix**: Add to docker-compose.yml:
```yaml
alexandria-tunnel:
  image: cloudflare/cloudflared:latest
  container_name: alexandria-tunnel
  network_mode: host
  command: tunnel run --token ${CLOUDFLARE_TUNNEL_TOKEN}
  restart: unless-stopped
```

### Postgres Volume Path Issue
**Current** (Unraid): `/mnt/user/domains/OL_DB/db:/var/lib/postgresql`
**Compose**: Same ✅
**But**: Postgres container is using old `postgres` image without tag!

**Migration Risk**: HIGH - 54M rows, ~50GB data
**Recommendation**: 
1. Take postgres backup FIRST
2. Test postgres:18 on copy of data
3. Schedule maintenance window
4. Migrate with rollback plan

## File/Directory Issues

### Portainer Not Finding Images
**Symptom**: "some images don't show as being findable in portainer"
**Likely Cause**: Mixed container management

**Explanation**:
- Portainer can only manage what Docker Compose tells it about
- Unraid containers are invisible to Portainer (managed via Docker API directly)
- Solution: Migrate all to compose so Portainer sees everything

## Storage Analysis

### Cache vs User Share
| Location | Type | Parity | Used For |
|----------|------|--------|----------|
| `/mnt/cache/appdata/` | Cache (SSD) | ❌ No | Config files (fast access) |
| `/mnt/user/domains/` | User share | ✅ Yes | VM disks, persistent data |
| `/mnt/user/data/` | User share | ✅ Yes | Media files |

**Postgres Data**: ✅ On user share (parity protected)
**Appdata**: ⚠️ On cache (no parity - faster but risky)

**Recommendation**: 
- Keep postgres data on user share ✅
- Keep config files on cache for speed ✅
- Ensure appdata backup strategy exists

## Security Considerations

1. **Root containers**: grafana, netdata run as root
   - Required for volume access
   - Standard for LinuxServer images
   - Not a major concern on private network

2. **Exposed ports**: All services listen on 0.0.0.0
   - Not internet-facing (behind Unraid)
   - Cloudflare tunnel for external access ✅

3. **Secrets**: Postgres password in plaintext in compose.yml
   - Acceptable for home server
   - File permissions: root:root (600) ✅

## Next Steps

**Immediate** (Today):
- [ ] Fix Prometheus (uncomment in compose, start container)
- [ ] Verify Grafana can connect to Prometheus
- [ ] Document current Unraid container settings

**Short-term** (This Week):
- [ ] Create postgres backup
- [ ] Add alexandria-tunnel to compose
- [ ] Migrate first non-critical container (netdata) to compose
- [ ] Test migration process

**Medium-term** (Next 2 Weeks):
- [ ] Migrate remaining Unraid containers to compose
- [ ] Fix postgres image version (careful migration!)
- [ ] Configure Prometheus to scrape postgres + system
- [ ] Import Grafana dashboards

**Long-term** (Next Month):
- [ ] Implement Watchtower for auto-updates
- [ ] Set up postgres_exporter
- [ ] Create backup automation for compose configs
- [ ] Document complete stack in Infrastructure docs

## Questions for Justin

1. **Prometheus**: Want to enable it? Or remove dead container?
2. **Auto-updates**: Prefer Watchtower in compose, or Unraid CA plugin?
3. **Postgres migration**: Schedule maintenance window for postgres:18 upgrade?
4. **Bazarr image**: Okay to switch from hotio to linuxserver image?
5. **Monitoring scope**: Want full prometheus/grafana setup, or just basic netdata?

---

**Audit completed**: `ssh tower` access verified ✅  
**Docker version**: 24.0+ (compose v2 integrated)  
**Unraid version**: 6.12+ (modern Docker API)
