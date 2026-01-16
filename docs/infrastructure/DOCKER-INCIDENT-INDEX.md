# Docker Container Auto-Restart Incident - Complete Analysis

**Date:** January 15-16, 2026
**Duration:** Investigation + Resolution = ~6 hours
**Status:** ✅ RESOLVED

---

## 📋 Executive Summary

On January 15, 2026, PostgreSQL and all Docker containers on Tower (Unraid) stopped starting after server reboots. Investigation revealed the root cause: **Unraid Community Apps Docker Auto Update plugin** was stopping all containers daily at 4:00 AM and attempting to restart them via Unraid Docker Manager, which couldn't manage Docker Compose containers.

**Solution:** Disabled Unraid's auto-update plugin, relying solely on Watchtower (which runs within Docker Compose) for container updates.

---

## 📚 Complete Documentation Set

This incident generated 6 comprehensive analysis documents that tell the full story:

### 1. [DOCKER-INCIDENT-2026-01-16.md](./DOCKER-INCIDENT-2026-01-16.md)
**Incident Report & Root Cause Analysis**
- Timeline of events (discovery → diagnosis → resolution)
- Root cause: Unraid plugin vs Docker Compose conflict
- Immediate fix: Disabled plugin, updated boot script
- Prevention steps

### 2. [TOWER_MIGRATION_COMPLETE.md](./TOWER_MIGRATION_COMPLETE.md)
**Migration Documentation: Unraid → Docker Compose**
- Why we migrated (reliability, portability, industry standards)
- Complete docker-compose.yml structure (13 containers)
- Watchtower integration for auto-updates
- Boot script configuration at `/boot/config/go`
- Verification commands and health checks

### 3. [DOCKER_ENGINE_COUPLING_ANALYSIS.md](./DOCKER_ENGINE_COUPLING_ANALYSIS.md)
**"Why Does Docker Engine Stay Coupled to Unraid?"**
- Clarifies what changed vs what didn't in migration
- Technical integration layers (storage, networking, init system)
- Explains why we removed *management* layer, not *engine*
- Decoupling options (if we wanted to move to bare metal)

### 4. [DOCKER_TERMINOLOGY_AND_UPDATES.md](./DOCKER_TERMINOLOGY_AND_UPDATES.md)
**Terminology Clarification & Update Strategy**
- Docker Manager vs Docker Engine vs Docker Compose
- Comparison: Unraid GUI updates vs Watchtower auto-updates
- Why Watchtower is superior (awareness, control, logging)
- Update frequency and security considerations

### 5. [UNRAID_DOCKER_INDEPENDENCE_ANALYSIS.md](./UNRAID_DOCKER_INDEPENDENCE_ANALYSIS.md)
**Remaining Unraid Dependencies After Migration**
- What still depends on Unraid (XFS storage, boot scripts, networking)
- What's now independent (container management, restart policies)
- Portability assessment (how hard to move to different host)
- Cost-benefit analysis of full independence

### 6. [UNRAID_SHARE_OPTIMIZATION.md](./UNRAID_SHARE_OPTIMIZATION.md)
**Unraid Share Configuration & Performance**
- Cache vs array storage for Docker volumes
- Read/write performance benchmarks
- PostgreSQL data location (/mnt/cache vs /mnt/user)
- Recommendations for different workload types

---

## 🎯 Quick Navigation

### If you need to...

**Understand what happened:**
→ Read [DOCKER-INCIDENT-2026-01-16.md](./DOCKER-INCIDENT-2026-01-16.md)

**Learn about the Docker Compose migration:**
→ Read [TOWER_MIGRATION_COMPLETE.md](./TOWER_MIGRATION_COMPLETE.md)

**Understand why Docker stays on Unraid:**
→ Read [DOCKER_ENGINE_COUPLING_ANALYSIS.md](./DOCKER_ENGINE_COUPLING_ANALYSIS.md)

**Clarify Docker terminology:**
→ Read [DOCKER_TERMINOLOGY_AND_UPDATES.md](./DOCKER_TERMINOLOGY_AND_UPDATES.md)

**Assess portability to other hosts:**
→ Read [UNRAID_DOCKER_INDEPENDENCE_ANALYSIS.md](./UNRAID_DOCKER_INDEPENDENCE_ANALYSIS.md)

**Optimize Unraid share performance:**
→ Read [UNRAID_SHARE_OPTIMIZATION.md](./UNRAID_SHARE_OPTIMIZATION.md)

---

## 🔑 Key Takeaways

### What We Learned

1. **Two Auto-Update Systems = Conflict**
   - Unraid Community Apps plugin (stops via Docker Manager)
   - Watchtower (restarts via Docker Compose)
   - These can't coexist safely

2. **Docker Compose > Unraid Docker Manager**
   - Industry standard, portable, version-controlled
   - Better restart policies and dependency management
   - Works with Watchtower for intelligent updates

3. **XFS Storage Still Matters**
   - PostgreSQL benefits from /mnt/cache (SSD) performance
   - Unraid's user share system adds minimal overhead
   - No need to migrate off Unraid for storage

4. **Boot Script is Critical**
   - `/boot/config/go` starts Docker Compose on boot
   - Must wait 45s for XFS image mount
   - Logging to /var/log/docker-compose-startup.log essential

### What Changed

✅ **Container Management:** Unraid GUI → Docker Compose YAML
✅ **Auto-Updates:** Unraid plugin → Watchtower
✅ **Restart Reliability:** Unraid init → Docker Compose policies
✅ **Portability:** Vendor-locked → Industry standard

❌ **Docker Engine:** Still Unraid-provided (no change needed)
❌ **Storage Backend:** Still Unraid XFS (excellent performance)
❌ **Networking:** Still Unraid bridge networks (works great)

---

## 📈 Lessons for Future Incidents

1. **Check for competing automation** - Multiple systems managing the same resources
2. **Review plugin changelogs** - Unraid plugin behavior can change silently
3. **Test after Unraid updates** - New plugins may interfere with custom setups
4. **Document boot dependencies** - What must start before Docker Compose
5. **Keep migration docs updated** - This hub serves as institutional knowledge

---

## 🔗 Related Documentation

- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) - Complete system architecture
- [CLOUDFLARE-API-VS-WRANGLER.md](./CLOUDFLARE-API-VS-WRANGLER.md) - Cloudflare management
- [../operations/QUEUE_TROUBLESHOOTING.md](../operations/QUEUE_TROUBLESHOOTING.md) - Queue consumer failures

---

## 📝 Credits

**Investigation & Resolution:** Claude Code (Sonnet 4.5) + Justin Gardner
**Date:** January 15-16, 2026
**Total Documentation:** 2,111 lines across 6 files
**Time to Resolution:** 6 hours (investigation + docs)

---

**Last Updated:** January 16, 2026
