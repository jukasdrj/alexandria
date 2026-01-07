# NFS Removal - 2026-01-06

## Why We Removed NFS

After implementing NFS automount, we encountered persistent permission issues:
- macOS couldn't properly unlock files
- File operations frequently failed with "some items had to be skipped"
- Required constant server-side permission fixes
- UMASK settings didn't fully resolve the issues

**Decision:** Switch to SMB for better macOS compatibility

## What Was Removed

### macOS Side
- `/etc/auto_master` - Removed Tower NFS entry
- `/etc/auto_tower` - Deleted NFS mount map
- `/Tower` mount point - Removed
- Automounter restarted to clear cache

### Tower/Unraid Side
- `/etc/exports` - Cleared all NFS exports (backed up to `/etc/exports.nfs_backup`)
- NFS services stopped (rc.nfsd, rc.rpc)
- Share configs updated to disable NFS export
- Removed NFS from startup scripts

### Backups Created
- `/etc/auto_master.nfs_backup` (Mac)
- `/etc/exports.nfs_backup` (Tower)
- `/boot/config/share.cfg.nfs_backup` (Tower)
- `/boot/config/go.nfs_backup` (Tower)

## NFS Configuration That Was Used

For reference, here's what we tried:

**Mount Options:**
```
domains		-fstype=nfs,resvport,rw,bg,hard,intr,rsize=65536,wsize=65536,timeo=14,nolocks	192.168.1.240:/mnt/user/domains
data		-fstype=nfs,resvport,rw,bg,hard,intr,rsize=65536,wsize=65536,timeo=14,nolocks	192.168.1.240:/mnt/user/data
```

**Docker Container Settings:**
- PUID=99 (nobody)
- PGID=100 (users)
- UMASK=000 (attempted to create world-writable files)

**Issues Encountered:**
- Directories created with 755 instead of 777
- macOS unable to unlock files via Finder
- Permission denied errors despite correct ownership
- Required manual `chmod 777` on Tower for each problematic folder

## Next Steps

Setup SMB shares instead (see SMB-SETUP-2026-01-06.md)

## Lessons Learned

1. **NFS is not ideal for macOS clients** - Permission model is too rigid
2. **SMB is the better choice** for macOS despite slightly slower performance
3. **"Just works" > "10% faster"** - User experience matters more than benchmarks
4. **Docker UMASK doesn't fully solve NFS permission issues** on macOS

## If You Need to Re-enable NFS

To restore NFS (not recommended for macOS):

**On Tower:**
```bash
# Restore exports
cp /etc/exports.nfs_backup /etc/exports
/etc/rc.d/rc.nfsd start
```

**On Mac:**
```bash
# Restore automount config
sudo cp /etc/auto_master.nfs_backup /etc/auto_master
# Create auto_tower file (see NFS-SETUP-2026-01-06.md)
sudo automount -vc
```
