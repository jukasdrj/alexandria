# Unraid Share Optimization Analysis
**Date**: January 15, 2026  
**System**: Tower Unraid Server
**Status**: Array is currently running (but you're planning to shut down)

## 📊 Current Share Configuration

### Share Inventory

| Share | Size | Cache Policy | Pool | Usage | Purpose |
|-------|------|--------------|------|-------|---------|
| **data** | 65TB | `no` (array only) | none | 55% | Media files (Plex) |
| **domains** | 1.3TB | `only` | vm_pool | 36% | VMs, docker-compose, OL_DB |
| **timeMachine** | 786GB | `no` | none | N/A | Time Machine backups |
| **appdata** | 200GB | `only` | cache | 23% | Docker configs |
| **isos** | 691MB | `no` | none | N/A | Installation ISOs |
| **downloads** | 9.4MB | `prefer` | download_pool | 1% | Temporary downloads |
| **temp** | 11MB | `only` | cache | 1% | Temporary files |
| **system** | 2MB | `only` | cache | 1% | System files |

### Cache/Pool Configuration

| Pool | Size | Used | Available | Usage % | Type |
|------|------|------|-----------|---------|------|
| **cache** | 700GB | 200GB | 700GB | 23% | SSD (appdata, system, temp) |
| **vm_pool** | 2.3TB | 1.3TB | 2.3TB | 36% | SSD (domains, VMs) |
| **download_pool** | Unknown | Unknown | Unknown | 1% | Downloads staging |

### Array Disks

| Disk | Size | Used | Available | Usage % |
|------|------|------|-----------|---------|
| disk1 | 19TB | 12TB | 7.0TB | 62% |
| disk2 | 15TB | 8.0TB | 6.7TB | 55% |
| disk3 | 15TB | 6.2TB | 8.5TB | 43% |
| disk4 | 15TB | 6.0TB | 8.6TB | 42% |
| disk5 | 19TB | 9.7TB | 8.6TB | 53% |
| disk6 | 26TB | 17TB | 8.6TB | 67% |
| disk7 | 19TB | 9.7TB | 8.6TB | 53% |
| **TOTAL** | **124TB** | **68TB** | **57TB** | **55%** |

## 🔍 Detailed Analysis

### 1. OL_DB (PostgreSQL Database) - 147GB

**Current Location**: `/mnt/user/domains/OL_DB`
- Database files: **79GB** (active postgres data)
- Setup/staging data: **68GB** (CSV import files)
  - Unprocessed: 42GB
  - Processed: 27GB

**Current Config**:
- Share: `domains`
- Cache policy: `only` (vm_pool)
- Pool: SSD (vm_pool)

**Analysis**: ✅ **OPTIMAL**
- Postgres on SSD = fast I/O ✅
- 79GB database size for 54M records is reasonable
- Setup data (68GB) could be archived/deleted if import is complete

**Recommendation**: 
- ✅ **Keep current configuration** (SSD is correct for databases)
- 🧹 **Consider cleanup**: Do you still need the 68GB of CSV import files in `/setup/`?

### 2. Appdata (Docker Configs) - 200GB

**Current Location**: `/mnt/cache/appdata`
- Cache policy: `only` (cache pool)
- On SSD: ✅ Correct

**Largest Consumers**:
```
Expected breakdown:
- Plex metadata/thumbnails: ~100-150GB
- Elasticsearch: ~20GB
- Sonarr/Radarr databases: ~5-10GB each
- Other containers: ~1-5GB each
```

**Analysis**: ✅ **OPTIMAL**
- Docker configs should be on SSD for performance
- 200GB is reasonable for your setup

**Potential Optimization**:
- Plex thumbnails can get bloated over time
- Consider: Plex database optimization/vacuum

**Recommendation**: ✅ **Keep as-is**, optionally clean Plex thumbnails

### 3. Data Share (Media) - 65TB

**Current Location**: `/mnt/user/data` (array disks, no cache)
- Cache policy: `no` (direct to array)
- Allocator: `mostfree`

**Analysis**: ✅ **OPTIMAL for long-term storage**
- Media doesn't need SSD speed
- Using parity-protected array disks
- 65TB of media content

**Current Allocator**:
- `mostfree` = spreads files across all disks evenly
- Good for balanced disk usage

**Alternative Allocator Options**:
- `highwater` = fills one disk before moving to next (better for spindown)
- `fillup` = completely fills each disk sequentially

**Recommendation**: 
- ✅ **Keep `mostfree`** for balanced wear
- OR switch to `highwater` if you want disk spindown optimization

### 4. Domains Share - 1.3TB

**Current Location**: `/mnt/vm_pool/domains`
- Cache policy: `only` (vm_pool SSD)
- Contains: VMs, docker-compose configs, OL_DB

**Breakdown**:
- OL_DB: 147GB (postgres + CSV staging)
- docker-compose: ~1KB (just YAML files)
- VMs: ~1.15TB (Win11, Ubuntu, etc.)
- Time Machine sparse bundles: ~786GB (symlinked/mounted)

**Analysis**: ✅ **OPTIMAL**
- VMs on SSD = correct for performance
- Docker-compose configs = negligible size
- OL_DB on SSD = correct for database performance

**Recommendation**: ✅ **Keep as-is**

### 5. Downloads Share - 9.4MB

**Current Location**: Varies (uses download_pool)
- Cache policy: `prefer` (uses cache, moves to array)
- Nearly empty (9.4MB)

**Analysis**: ⚠️ **Underutilized but configured correctly**
- `prefer` is correct for downloads:
  - New files land on fast cache
  - Mover transfers to array overnight
- Currently minimal usage

**Recommendation**: ✅ **Keep as-is** (config is correct)

### 6. Time Machine - 786GB

**Current Location**: `/mnt/user/timeMachine` (array, no cache)
- Cache policy: `no` (direct to array)
- Volume size limit: 4096GB (4TB)
- Security: `secure` (requires authentication)

**Analysis**: ✅ **CORRECT for Time Machine**
- Time Machine doesn't need SSD
- Volume size limit prevents runaway growth
- Secure authentication is appropriate

**Recommendation**: ✅ **Keep as-is**

## 🎯 Optimization Recommendations

### Priority 1: Cleanup Opportunities (Do While Down) 🧹

#### A. OL_DB Setup Data - Potential 68GB Savings
```bash
ssh root@192.168.1.240
cd /mnt/user/domains/OL_DB/setup/data

# Check if import is complete
ls -lh processed/
ls -lh unprocessed/

# If postgres import is complete and verified:
# BACKUP FIRST (just in case)
tar -czf ~/OL_DB_setup_backup_$(date +%Y%m%d).tar.gz setup/

# Then remove staging data
rm -rf processed/
rm -rf unprocessed/

# This would free up 68GB on vm_pool SSD
```

**Question**: Is your postgres database import complete? Can we archive/delete the CSV staging files?

#### B. Plex Metadata Cleanup - Potential 10-50GB Savings
```bash
# Plex thumbnail/metadata bloat cleanup
# (Do this while Plex container is stopped)

ssh root@192.168.1.240
cd /mnt/cache/appdata/plex

# Check Plex database size
du -sh "Library/Application Support/Plex Media Server/"

# Optional: Optimize Plex database (while Plex is stopped)
# This requires Plex to be down - perfect timing!
docker-compose -f /mnt/user/domains/docker-compose/docker-compose.yml stop plex

# Backup Plex database
cd "/mnt/cache/appdata/plex/Library/Application Support/Plex Media Server/Plug-in Support/Databases"
cp com.plexapp.plugins.library.db com.plexapp.plugins.library.db.backup

# Vacuum/optimize
sqlite3 com.plexapp.plugins.library.db "VACUUM;"
sqlite3 com.plexapp.plugins.library.db "REINDEX;"

# Restart Plex
docker-compose -f /mnt/user/domains/docker-compose/docker-compose.yml start plex
```

**Potential savings**: 10-50GB depending on library size and age

### Priority 2: Share Configuration Changes (Optional) ⚙️

#### No Changes Needed ✅

Your share configuration is already optimal:

| Share | Current Policy | Recommendation | Reason |
|-------|----------------|----------------|--------|
| appdata | `only` (cache SSD) | ✅ Keep | Docker needs fast I/O |
| domains | `only` (vm_pool SSD) | ✅ Keep | VMs + DB need fast I/O |
| data | `no` (array only) | ✅ Keep | Media doesn't need cache |
| downloads | `prefer` (cache→array) | ✅ Keep | Good staging strategy |
| timeMachine | `no` (array only) | ✅ Keep | Backups don't need cache |

### Priority 3: Future Optimizations (Not Urgent) 🔮

#### A. Data Share Allocator Change (Optional)
**Current**: `mostfree` (balanced distribution)
**Alternative**: `highwater` (sequential fill for disk spindown)

**When to change**:
- If power consumption matters (disk spindown)
- If you want drives to stay idle longer
- If you prefer sequential disk filling

**How to change**:
Edit `/boot/config/shares/data.cfg`:
```bash
shareAllocator="highwater"  # Instead of "mostfree"
```

**Impact**: New files fill drives sequentially instead of balanced

#### B. Cache Pool Expansion (If Needed)
**Current cache**: 700GB (200GB used = 23%)
**Current vm_pool**: 2.3TB (1.3TB used = 36%)

**Status**: ✅ Both pools have plenty of space
**Future threshold**: Consider expansion if cache exceeds 80%

## 📋 Action Checklist for Tower Shutdown

### Safe to do while down:

- [x] **Verify docker-compose** - Already done ✅
- [ ] **OL_DB cleanup** - Delete 68GB staging CSV files (if import complete)
- [ ] **Plex optimization** - VACUUM database while stopped
- [ ] **Check disk health** - SMART status review
- [ ] **Trim SSDs** - If not done automatically
- [ ] **Review appdata** - Identify any unused container configs

### Do NOT do while down:

- ❌ Change share cache policies (requires array running)
- ❌ Move files between shares (requires array running)
- ❌ Mover operations (automatic, happens when running)

### Can do while running (after reboot):

- [ ] Run Unraid's built-in disk checks
- [ ] Monitor docker-compose auto-start
- [ ] Verify all services come up correctly
- [ ] Check Watchtower first run (tomorrow 4am)

## 🔒 Data Safety Notes

### What's Protected:
✅ **data** (65TB) - Parity protected on array
✅ **timeMachine** (786GB) - Parity protected on array  
⚠️ **appdata** (200GB) - On cache SSD, **NO PARITY**
⚠️ **domains** (1.3TB) - On vm_pool SSD, **NO PARITY**

### Backup Recommendations:

**Critical for backup** (no parity):
1. **Docker configs**: `/mnt/cache/appdata` (200GB)
   - Most important: Plex database, *arr configs
   - Already have docker-compose.yml in version control ✅

2. **VMs**: `/mnt/vm_pool/domains` (1.3TB)
   - Consider: Off-site backup of VM images
   - Or: Ensure data inside VMs is backed up separately

3. **Postgres**: `/mnt/user/domains/OL_DB/db` (79GB)
   - Consider: Automated postgres dumps to array
   - Setup: `pg_dump` cron job to `/mnt/user/backups`

## 💾 Recommended Postgres Backup (While Down is Perfect Timing)

```bash
ssh root@192.168.1.240

# Create backup directory on parity-protected array
mkdir -p /mnt/user/backups/postgres

# Once postgres is back up after reboot:
docker exec postgres pg_dump -U openlibrary openlibrary | gzip > \
  /mnt/user/backups/postgres/openlibrary_$(date +%Y%m%d).sql.gz

# Setup automated daily backup (add to cron)
echo "0 2 * * * docker exec postgres pg_dump -U openlibrary openlibrary | gzip > /mnt/user/backups/postgres/openlibrary_\$(date +\%Y\%m\%d).sql.gz" | crontab -
```

**Why**: Your 79GB postgres database is on SSD with no parity. Regular backups to the array protect against SSD failure.

## 📊 Summary

### Current Status: ✅ **WELL OPTIMIZED**

Your Unraid share configuration is already excellent:
- Fast storage (SSD) for things that need it (Docker, VMs, Postgres)
- Slow storage (array) for things that don't (media, backups)
- Proper cache policies configured
- Good disk space distribution

### Recommended Actions (While Down):

**High Priority**:
1. ✅ Clean up OL_DB CSV staging (68GB) - if import complete
2. ✅ Optimize Plex database (10-50GB potential savings)
3. ✅ Setup postgres automated backups (after reboot)

**Medium Priority**:
4. Review appdata for unused container configs
5. Check SMART status on all disks
6. Trim SSDs manually if not done recently

**Low Priority**:
7. Consider changing data share allocator (mostfree → highwater)
8. Review Time Machine backup retention

### No Urgent Changes Needed ✅

Your configuration is production-ready and optimal for your workload!

---

**Question for you**: Should I help you with the OL_DB CSV cleanup? That would free up 68GB on your fast SSD if the postgres import is complete.
