# Prowlarr Setup Guide

Complete guide for configuring Prowlarr indexers and connecting to Sonarr and Radarr.

## Setup Summary

**Status:** ✅ Configured and Working

**Configured Applications:**
- Sonarr (TV Shows)
- Radarr (Movies)

**Active Indexers (4 total):**
- EZTV (TV-focused)
- YTS (Movies, high quality)
- The Pirate Bay (General)
- FileMood (DHT crawler)

**Sync Status:**
- All indexers automatically synced to both Sonarr and Radarr
- Full sync enabled for automatic updates
- Search functionality verified and working

**Next Steps:**
- Configure download client (qBittorrent, Transmission, etc.)
- Enable automatic searches in Sonarr/Radarr
- Monitor indexer performance and add/remove as needed

---

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [1. Connect Applications](#1-connect-applications)
  - [Add Sonarr](#add-sonarr)
  - [Add Radarr](#add-radarr)
  - [Verify Connections](#verify-connections)
- [2. Configure Indexers](#2-configure-indexers)
  - [Recommended Public Indexers](#recommended-public-indexers)
  - [Add Indexers via Web UI](#add-indexers-via-web-ui)
  - [Add Indexers via API](#add-indexers-via-api)
- [3. Test and Verify](#3-test-and-verify)
- [Troubleshooting](#troubleshooting)

---

## Overview

**Server:** Tower (192.168.1.240)
**Services:**
- Prowlarr: http://192.168.1.240:9696
- Sonarr: http://192.168.1.240:8989 (container: sonarr)
- Radarr: http://192.168.1.240:7878 (container: radarr)

**Docker Network:** media (all containers on same network)

**API Keys:**
- Prowlarr: `ca797b36d94a458787dd111f8eafe703`
- Sonarr: `9fa7e5e0c8b9421ca460a1e38cbb3e63`
- Radarr: `e48db3ddbeeb41f0bd9074dfbf82f42b`

---

## Prerequisites

1. All three services running on Tower
2. All containers on `media` Docker network
3. API keys accessible (found in Settings > General in each app)
4. Network connectivity verified

```bash
# Verify services are running
curl -s http://192.168.1.240:9696/api/v1/health -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703"
curl -s http://192.168.1.240:8989/api/v3/system/status -H "X-Api-Key: 9fa7e5e0c8b9421ca460a1e38cbb3e63"
curl -s http://192.168.1.240:7878/api/v3/system/status -H "X-Api-Key: e48db3ddbeeb41f0bd9074dfbf82f42b"
```

---

## 1. Connect Applications

### Add Sonarr

**Via Web UI:**
1. Open Prowlarr: http://192.168.1.240:9696
2. Go to Settings > Apps > Add Application
3. Select **Sonarr**
4. Configure:
   - **Name:** Sonarr
   - **Sync Level:** Full Sync (recommended)
   - **Prowlarr Server:** `http://prowlarr:9696`
   - **Sonarr Server:** `http://sonarr:8989`
   - **API Key:** `9fa7e5e0c8b9421ca460a1e38cbb3e63`
   - **Sync Categories:** Select TV categories (5000-5090)
5. Test and Save

**Via API (curl):**

```bash
curl -X POST http://192.168.1.240:9696/api/v1/applications \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sonarr",
    "implementation": "Sonarr",
    "configContract": "SonarrSettings",
    "syncLevel": "fullSync",
    "tags": [],
    "fields": [
      {
        "name": "prowlarrUrl",
        "value": "http://prowlarr:9696"
      },
      {
        "name": "baseUrl",
        "value": "http://sonarr:8989"
      },
      {
        "name": "apiKey",
        "value": "9fa7e5e0c8b9421ca460a1e38cbb3e63"
      },
      {
        "name": "syncCategories",
        "value": [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070, 5080, 5090]
      }
    ]
  }'
```

**TV Categories (Sync Categories):**
- 5000: TV
- 5010: TV/WEB-DL
- 5020: TV/Foreign
- 5030: TV/SD
- 5040: TV/HD
- 5045: TV/UHD
- 5050: TV/Other
- 5070: TV/Anime
- 5080: TV/Documentary
- 5090: TV/Sport

---

### Add Radarr

**Via Web UI:**
1. Open Prowlarr: http://192.168.1.240:9696
2. Go to Settings > Apps > Add Application
3. Select **Radarr**
4. Configure:
   - **Name:** Radarr
   - **Sync Level:** Full Sync (recommended)
   - **Prowlarr Server:** `http://prowlarr:9696`
   - **Radarr Server:** `http://radarr:7878`
   - **API Key:** `e48db3ddbeeb41f0bd9074dfbf82f42b`
   - **Sync Categories:** Select Movie categories (2000-2090)
5. Test and Save

**Via API (curl):**

```bash
curl -X POST http://192.168.1.240:9696/api/v1/applications \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Radarr",
    "implementation": "Radarr",
    "configContract": "RadarrSettings",
    "syncLevel": "fullSync",
    "tags": [],
    "fields": [
      {
        "name": "prowlarrUrl",
        "value": "http://prowlarr:9696"
      },
      {
        "name": "baseUrl",
        "value": "http://radarr:7878"
      },
      {
        "name": "apiKey",
        "value": "e48db3ddbeeb41f0bd9074dfbf82f42b"
      },
      {
        "name": "syncCategories",
        "value": [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090]
      }
    ]
  }'
```

**Movie Categories (Sync Categories):**
- 2000: Movies
- 2010: Movies/Foreign
- 2020: Movies/Other
- 2030: Movies/SD
- 2040: Movies/HD
- 2045: Movies/UHD
- 2050: Movies/BluRay
- 2060: Movies/3D
- 2070: Movies/DVD
- 2080: Movies/WEB-DL

---

### Verify Connections

**Check applications are added:**

```bash
curl -s http://192.168.1.240:9696/api/v1/applications \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" | jq '.[] | {name: .name, implementation: .implementation}'
```

**Expected output:**
```json
{
  "name": "Sonarr",
  "implementation": "Sonarr"
}
{
  "name": "Radarr",
  "implementation": "Radarr"
}
```

**Test application connections:**

```bash
# Test Sonarr connection
curl -s http://192.168.1.240:9696/api/v1/applications/test \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" \
  -H "Content-Type: application/json" \
  -d '{
    "implementation": "Sonarr",
    "fields": [
      {"name": "baseUrl", "value": "http://sonarr:8989"},
      {"name": "apiKey", "value": "9fa7e5e0c8b9421ca460a1e38cbb3e63"}
    ]
  }'

# Test Radarr connection
curl -s http://192.168.1.240:9696/api/v1/applications/test \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" \
  -H "Content-Type: application/json" \
  -d '{
    "implementation": "Radarr",
    "fields": [
      {"name": "baseUrl", "value": "http://radarr:7878"},
      {"name": "apiKey", "value": "e48db3ddbeeb41f0bd9074dfbf82f42b"}
    ]
  }'
```

---

## 2. Configure Indexers

### Recommended Public Indexers

Family-friendly, popular public torrent indexers:

| Indexer | Description | Categories | Status | Recommended For |
|---------|-------------|------------|--------|-----------------|
| **EZTV** | TV-focused tracker, reliable for series | TV Shows | ✅ Working | Sonarr (TV) |
| **YTS** | High-quality movie encodes, small file sizes | Movies | ✅ Working | Radarr (Movies) |
| **The Pirate Bay** | Classic tracker, wide coverage | All categories | ✅ Working | General use |
| **FileMood** | DHT crawler, no specific site required | All categories | ✅ Working | Fallback |
| **1337x** | Large public tracker with verified torrents | Movies, TV, Anime | ❌ Cloudflare | Would be good |
| **TorrentGalaxy** | Well-maintained, active community | Movies, TV | ❌ Blocked | Would be good |
| **LimeTorrents** | Large variety, good availability | Movies, TV | ❌ Cloudflare | Would be good |

**Note:** Many popular indexers are behind Cloudflare protection and may require FlareSolverr to access. The indexers marked with ✅ are currently working without additional configuration.

**Successfully Configured Indexers (as of setup):**
- `eztv` - TV shows (synced to Sonarr)
- `yts` - Movies (synced to Radarr)
- `thepiratebay` - General (synced to both)
- `filemood` - DHT crawler (synced to both)

---

### Add Indexers via Web UI

**Steps for each indexer:**

1. Open Prowlarr: http://192.168.1.240:9696
2. Go to Indexers > Add Indexer
3. Search for indexer name (e.g., "1337x")
4. Click on the indexer
5. Configure:
   - **Name:** Leave default or customize
   - **Enable:** Check
   - **Enable RSS:** Check (for automated searches)
   - **Enable Automatic Search:** Check
   - **Enable Interactive Search:** Check
   - **Categories:** Select relevant categories (Movies/TV)
   - Leave other settings as default
6. Test and Save
7. Repeat for other indexers

**Working indexers to add:**
1. EZTV (TV shows)
2. YTS (movies)
3. The Pirate Bay (general)
4. FileMood (DHT crawler - fallback)

**Note:** When adding via Web UI, search for the indexer by name. The actual definition file names are lowercase (e.g., "eztv", "yts", "thepiratebay", "filemood").

---

### Add Indexers via API

**Important:** Each indexer has unique configuration. Use web UI for easiest setup, or get schema first:

```bash
# Get schema for specific indexer (example: 1337x)
curl -s http://192.168.1.240:9696/api/v1/indexer/schema \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" | \
  jq '.[] | select(.name == "1337x")'
```

**Example: Add EZTV via API**

```bash
curl -X POST http://192.168.1.240:9696/api/v1/indexer \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "name": "EZTV",
    "implementation": "Cardigann",
    "configContract": "CardigannSettings",
    "protocol": "torrent",
    "priority": 25,
    "enable": true,
    "enableRss": true,
    "enableAutomaticSearch": true,
    "enableInteractiveSearch": true,
    "appProfileId": 1,
    "fields": [
      {"name": "definitionFile", "value": "eztv"}
    ]
  }'
```

**Example: Add YTS via API**

```bash
curl -X POST http://192.168.1.240:9696/api/v1/indexer \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "name": "YTS",
    "implementation": "Cardigann",
    "configContract": "CardigannSettings",
    "protocol": "torrent",
    "priority": 25,
    "enable": true,
    "enableRss": true,
    "enableAutomaticSearch": true,
    "enableInteractiveSearch": true,
    "appProfileId": 1,
    "fields": [
      {"name": "definitionFile", "value": "yts"}
    ]
  }'
```

**Add all working indexers (batch script):**

```bash
#!/bin/bash
# add-indexers.sh

PROWLARR_URL="http://192.168.1.240:9696"
API_KEY="ca797b36d94a458787dd111f8eafe703"

# Working indexers (definition file names must be lowercase)
INDEXERS=("eztv" "yts" "thepiratebay" "filemood")

for indexer in "${INDEXERS[@]}"; do
  display_name=$(echo "$indexer" | sed 's/\b\(.\)/\u\1/g')
  echo "Adding $display_name..."

  curl -X POST "$PROWLARR_URL/api/v1/indexer" \
    -H "X-Api-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    --data-raw "{
      \"name\": \"$display_name\",
      \"implementation\": \"Cardigann\",
      \"configContract\": \"CardigannSettings\",
      \"protocol\": \"torrent\",
      \"priority\": 25,
      \"enable\": true,
      \"enableRss\": true,
      \"enableAutomaticSearch\": true,
      \"enableInteractiveSearch\": true,
      \"appProfileId\": 1,
      \"fields\": [
        {\"name\": \"definitionFile\", \"value\": \"$indexer\"}
      ]
    }" | jq '{id: .id, name: .name}'
  echo ""
  sleep 1
done
```

**Important Notes:**
- Most public indexers use the `Cardigann` implementation
- The `definitionFile` value must match exactly (usually lowercase)
- Use `appProfileId: 1` (Standard profile)
- Many popular indexers are blocked by Cloudflare (requires FlareSolverr)

---

## 3. Test and Verify

### Verify Indexers Added

```bash
curl -s http://192.168.1.240:9696/api/v1/indexer \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" | \
  jq '.[] | {id: .id, name: .name, enable: .enable, protocol: .protocol}'
```

### Test Indexer Search

```bash
# Test search across all indexers
curl -s "http://192.168.1.240:9696/api/v1/search?query=breaking%20bad&type=search" \
  -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" | \
  jq '.[] | {indexer: .indexer, title: .title, size: .size}' | head -20
```

### Verify Sync to Sonarr

```bash
# Check indexers in Sonarr
curl -s http://192.168.1.240:8989/api/v3/indexer \
  -H "X-Api-Key: 9fa7e5e0c8b9421ca460a1e38cbb3e63" | \
  jq '.[] | {name: .name, implementation: .implementation, enableRss: .enableRss}'
```

### Verify Sync to Radarr

```bash
# Check indexers in Radarr
curl -s http://192.168.1.240:7878/api/v3/indexer \
  -H "X-Api-Key: e48db3ddbeeb41f0bd9074dfbf82f42b" | \
  jq '.[] | {name: .name, implementation: .implementation, enableRss: .enableRss}'
```

### Check Sync Status

After adding applications and indexers, Prowlarr automatically syncs indexers to Sonarr and Radarr. Verify:

1. Open Sonarr: http://192.168.1.240:8989
2. Go to Settings > Indexers
3. You should see Prowlarr-synced indexers with "(Prowlarr)" suffix
4. Repeat for Radarr: http://192.168.1.240:7878

**Expected behavior:**
- Each indexer in Prowlarr appears in both Sonarr and Radarr
- Indexers have appropriate categories (TV for Sonarr, Movies for Radarr)
- All indexers show "Enabled" and "RSS Enabled"

---

## Troubleshooting

### Applications Not Connecting

**Symptom:** Prowlarr cannot connect to Sonarr or Radarr

**Solutions:**
1. Verify all containers are on same Docker network:
   ```bash
   docker inspect sonarr | jq '.[0].NetworkSettings.Networks'
   docker inspect radarr | jq '.[0].NetworkSettings.Networks'
   docker inspect prowlarr | jq '.[0].NetworkSettings.Networks'
   ```
2. Use container hostnames (`http://sonarr:8989`) not IPs
3. Verify API keys are correct
4. Check firewall rules (unlikely if on same network)

### Indexers Not Syncing

**Symptom:** Indexers added in Prowlarr don't appear in Sonarr/Radarr

**Solutions:**
1. Check sync categories match (TV categories for Sonarr, Movie categories for Radarr)
2. Force sync: Settings > Apps > Select application > Test and Save
3. Check Prowlarr logs: System > Logs
4. Verify "Full Sync" is enabled in application settings

### Indexers Failing Tests

**Symptom:** Indexer test fails when adding

**Common Errors:**

1. **"Blocked by CloudFlare Protection"**
   - Many popular indexers (1337x, LimeTorrents, KickassTorrents, etc.) are behind Cloudflare
   - **Solution:** Install and configure FlareSolverr
   - **FlareSolverr Setup:**
     ```bash
     # Add FlareSolverr to docker-compose on Tower
     docker run -d \
       --name=flaresolverr \
       --network=media \
       -p 8191:8191 \
       -e LOG_LEVEL=info \
       --restart unless-stopped \
       ghcr.io/flaresolverr/flaresolverr:latest
     ```
   - Then in Prowlarr: Settings > Indexers > Add FlareSolverr
   - URL: `http://flaresolverr:8191`
   - Tags: Apply to Cloudflare-blocked indexers

2. **"Unable to connect"** or **Redirected to unexpected URL**
   - Indexer domain may have changed or be temporarily down
   - Try alternative indexers from the working list

3. **General connectivity issues**
   - Check internet connectivity from Tower
   - Verify no VPN/proxy interfering
   - Check Prowlarr logs: System > Logs

### No Search Results

**Symptom:** Searches return empty results

**Solutions:**
1. Verify indexers are enabled: `enableRss: true`, `enableAutomaticSearch: true`
2. Check indexer categories match search type (Movies vs TV)
3. Test search manually in Prowlarr web UI
4. Check indexer health: Indexers > Health Check

### API Calls Fail

**Symptom:** Curl commands return 401 Unauthorized

**Solutions:**
1. Verify API key is correct
2. Check header format: `-H "X-Api-Key: YOUR_KEY"`
3. Ensure Prowlarr authentication is not enabled (Settings > General > Security)

---

## Quick Reference

**Web UIs:**
- Prowlarr: http://192.168.1.240:9696
- Sonarr: http://192.168.1.240:8989
- Radarr: http://192.168.1.240:7878

**Container Hostnames (internal):**
- Prowlarr: `http://prowlarr:9696`
- Sonarr: `http://sonarr:8989`
- Radarr: `http://radarr:7878`

**Recommended Indexers:**
1. 1337x (general)
2. EZTV (TV shows)
3. YTS (movies)
4. TorrentGalaxy (general)
5. LimeTorrents (general)

**Key Commands:**

```bash
# List applications
curl -s http://192.168.1.240:9696/api/v1/applications -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" | jq

# List indexers
curl -s http://192.168.1.240:9696/api/v1/indexer -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" | jq

# Test search
curl -s "http://192.168.1.240:9696/api/v1/search?query=test&type=search" -H "X-Api-Key: ca797b36d94a458787dd111f8eafe703" | jq

# Check Sonarr indexers
curl -s http://192.168.1.240:8989/api/v3/indexer -H "X-Api-Key: 9fa7e5e0c8b9421ca460a1e38cbb3e63" | jq

# Check Radarr indexers
curl -s http://192.168.1.240:7878/api/v3/indexer -H "X-Api-Key: e48db3ddbeeb41f0bd9074dfbf82f42b" | jq
```

---

## Next Steps

After completing this setup:

1. **Test Downloads:**
   - Search for a TV show in Sonarr
   - Search for a movie in Radarr
   - Verify Prowlarr indexers are being queried

2. **Monitor Performance:**
   - Check System > Tasks in Prowlarr
   - Review indexer response times
   - Remove slow or unreliable indexers

3. **Optimize:**
   - Adjust indexer priorities (Settings > Indexers > Priority)
   - Enable/disable specific indexers based on success rate
   - Add more indexers if needed

4. **Automation:**
   - Configure RSS sync intervals (Settings > Apps)
   - Enable automatic search in Sonarr/Radarr
   - Set up download client (qBittorrent, Transmission, etc.)

---

## Appendix: Cloudflare-Blocked Indexers

Many popular indexers require FlareSolverr to bypass Cloudflare protection:

**Blocked Indexers (require FlareSolverr):**
- 1337x
- LimeTorrents
- TorrentGalaxy
- KickassTorrents
- IsoHunt2
- BTState
- Many others

**To enable these indexers:**
1. Install FlareSolverr (see Troubleshooting section)
2. Configure FlareSolverr in Prowlarr (Settings > Indexers > FlareSolverr)
3. Tag indexers to use FlareSolverr
4. Re-test blocked indexers

**Alternative:** Stick with working indexers (EZTV, YTS, ThePirateBay, FileMood) which provide good coverage without additional setup.

---

**Document Version:** 1.1
**Last Updated:** 2026-01-16
**Status:** Configuration Complete and Verified
**Author:** Setup automation for Alexandria infrastructure
