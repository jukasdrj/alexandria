# *arr Apps - Authentication Disabled for Local Network

**Date:** 2026-01-17
**Status:** ✅ Completed

---

## Summary

Disabled authentication for all *arr applications when accessed from local network (192.168.1.0/24 and 100.x.x.x/8 Tailscale).

### Before

- Prowlarr: Required login (unknown password)
- Sonarr: Required login (annoying)
- Radarr: Required login (annoying)
- Readarr: Required login (annoying)
- Bazarr: API key only

### After

- **All *arr apps:** No authentication required from local/home IPs ✅
- **From internet:** Still requires authentication (security maintained)

---

## Changes Made

### Configuration Setting

Changed authentication mode from `Enabled` to `DisabledForLocalAddresses` in config.xml:

```xml
<!-- Before -->
<AuthenticationRequired>Enabled</AuthenticationRequired>

<!-- After -->
<AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
```

### Apps Modified

| App | Config File | Status |
|-----|-------------|--------|
| **Prowlarr** | `/mnt/cache/appdata/prowlarr/config.xml` | ✅ Updated |
| **Sonarr** | `/mnt/cache/appdata/sonarr/config.xml` | ✅ Updated |
| **Radarr** | `/mnt/cache/appdata/radarr/config.xml` | ✅ Updated |
| **Readarr** | `/mnt/cache/appdata/readarr/config.xml` | ✅ Updated |
| **Bazarr** | `/mnt/cache/appdata/bazarr/config/config.yaml` | ℹ️ Already uses API key (no password) |

---

## How It Works

**DisabledForLocalAddresses** allows:
- ✅ Local network: 192.168.1.0/24 (your home LAN)
- ✅ Tailscale network: 100.0.0.0/8 (your Tailscale mesh)
- ✅ Localhost: 127.0.0.1

**Still requires authentication from:**
- ⚠️ Internet: Any external IP (if you expose these apps publicly)

**Since your *arr apps are only accessible via:**
- Local LAN (192.168.1.x)
- Tailscale (100.x.x.x)

**You will NEVER see a login prompt anymore!** 🎉

---

## Access URLs (No Login Required)

| App | URL | Authentication |
|-----|-----|----------------|
| **Prowlarr** | http://tower.local:9696 | ✅ No login from LAN |
| **Sonarr** | http://tower.local:8989 | ✅ No login from LAN |
| **Radarr** | http://tower.local:7878 | ✅ No login from LAN |
| **Readarr** | http://tower.local:8787 | ✅ No login from LAN |
| **Bazarr** | http://tower.local:6767 | ✅ No login from LAN |
| **Overseerr** | http://tower.local:5055 | ℹ️ (check separately if needed) |

---

## Deployment Commands

```bash
# 1. Stop all *arr apps
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose stop prowlarr sonarr radarr readarr bazarr"

# 2. Update Prowlarr config
ssh root@tower.local "sed -i 's/<AuthenticationRequired>Enabled</<AuthenticationRequired>DisabledForLocalAddresses</g' /mnt/cache/appdata/prowlarr/config.xml"

# 3. Update Sonarr config
ssh root@tower.local "sed -i 's/<AuthenticationRequired>Enabled</<AuthenticationRequired>DisabledForLocalAddresses</g' /mnt/cache/appdata/sonarr/config.xml"

# 4. Update Radarr config
ssh root@tower.local "sed -i 's/<AuthenticationRequired>Enabled</<AuthenticationRequired>DisabledForLocalAddresses</g' /mnt/cache/appdata/radarr/config.xml"

# 5. Update Readarr config
ssh root@tower.local "sed -i 's/<AuthenticationRequired>Enabled</<AuthenticationRequired>DisabledForLocalAddresses</g' /mnt/cache/appdata/readarr/config.xml"

# 6. Restart all *arr apps
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose up -d prowlarr sonarr radarr readarr bazarr"
```

---

## Verification

### Check Config Files

```bash
# Verify Prowlarr
ssh root@tower.local "docker exec prowlarr grep 'AuthenticationRequired' /config/config.xml"
# Expected: <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>

# Verify Sonarr
ssh root@tower.local "docker exec sonarr grep 'AuthenticationRequired' /config/config.xml"
# Expected: <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>

# Verify Radarr
ssh root@tower.local "docker exec radarr grep 'AuthenticationRequired' /config/config.xml"
# Expected: <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
```

### Test Access

1. Open http://tower.local:9696 (Prowlarr)
2. Should load directly WITHOUT login prompt ✅
3. Repeat for Sonarr (8989), Radarr (7878), Readarr (8787)

---

## Security Considerations

### Is This Safe?

**YES** - For a home network, this is perfectly safe because:

1. ✅ **Network isolation** - Apps only accessible from LAN/Tailscale
2. ✅ **No public exposure** - Not accessible from internet
3. ✅ **Tailscale security** - Encrypted mesh network with device auth
4. ✅ **Still requires auth from outside** - If you DID expose publicly, auth still applies

### Defense in Depth

Your security layers (all still working):
1. ✅ **Network firewall** - No port forwarding for *arr apps
2. ✅ **Tailscale** - Device authentication and encryption
3. ✅ **VPN (Gluetun)** - Download traffic hidden from ISP
4. ✅ **No auth needed** - Because you're already protected by layers 1-3

**For a family fun project, removing password prompts on trusted devices is the right call.**

---

## If You Need to Re-Enable Authentication

```bash
# Change back to Enabled (not recommended for local-only access)
ssh root@tower.local "sed -i 's/<AuthenticationRequired>DisabledForLocalAddresses</<AuthenticationRequired>Enabled</g' /mnt/cache/appdata/prowlarr/config.xml"

# Restart container
ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart prowlarr"
```

---

## Troubleshooting

### Still Asking for Login?

**Possible causes:**

1. **Browser cache** - Clear cookies and refresh
   ```bash
   # Chrome/Edge: Ctrl+Shift+Delete
   # Clear "Cookies and other site data"
   ```

2. **Accessing from wrong IP** - Make sure you're on LAN/Tailscale
   ```bash
   # Check your IP
   ifconfig | grep "inet "
   # Should show: 192.168.1.x or 100.x.x.x
   ```

3. **Config didn't update** - Verify config file:
   ```bash
   ssh root@tower.local "docker exec prowlarr cat /config/config.xml | grep AuthenticationRequired"
   # Should show: DisabledForLocalAddresses
   ```

4. **Container didn't restart** - Force restart:
   ```bash
   ssh root@tower.local "cd /mnt/user/domains/docker-compose && docker compose restart prowlarr"
   ```

### Forgot Previous Password?

**Don't worry!** Since authentication is now disabled for local access, you don't need the old password anymore.

If you ever need to set a NEW password (for external access), you can do so in:
- Settings → General → Security → Authentication

---

## API Keys (Still Work)

API keys are UNAFFECTED by this change. Apps like Sonarr/Radarr still use API keys to talk to each other.

**API Keys:**
- Prowlarr: `ca797b36d94a458787dd111f8eafe703`
- Sonarr: `9fa7e5e0c8b9421ca460a1e38cbb3e63`
- Radarr: `e48db3ddbeeb41f0bd9074dfbf82f42b`

These are still required for app-to-app communication (e.g., Prowlarr → Sonarr sync).

---

## Related Changes

**This session also deployed:**
- ✅ Gluetun VPN for download clients
- ✅ Prowlarr with 4 indexers
- ✅ Readarr for ebook management
- ✅ Full *arr stack verification

**Documentation:**
- `/Users/juju/dev_repos/alex/docs/infrastructure/GLUETUN-VPN-DEPLOYMENT.md`
- `/Users/juju/dev_repos/alex/docs/infrastructure/PROWLARR-SETUP.md`
- `/Users/juju/dev_repos/alex/docs/infrastructure/READARR-CALIBRE-SETUP.md`

---

## Summary

**Before:** Had to login to Prowlarr (password unknown), annoying for other *arr apps
**After:** No authentication required from local/Tailscale networks ✅
**Security:** Still protected by network isolation and Tailscale
**User Experience:** Just works™ - No more password prompts! 🎉

---

**Completed:** 2026-01-17
**Deployed by:** Claude via Tower SSH
