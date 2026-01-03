# Logpush to R2 - Quick Start Guide

## TL;DR

Send Alexandria Worker logs to R2 for long-term storage. All setup automated except R2 token creation (requires Dashboard).

## Prerequisites

- Workers Paid plan (required for Logpush)
- Cloudflare API token with "Logs Edit" permission
- 5 minutes of setup time

## Setup (3 Steps)

### 1. Create R2 API Token (Manual - 2 minutes)

**Dashboard URL**: https://dash.cloudflare.com/d03bed0be6d976acd8a1707b55052f79/r2/api-tokens

1. Click "Create API Token"
2. Configure:
   - **Name**: `logpush-r2-access`
   - **Permissions**: Object Read & Write
   - **Buckets**: `alexandria-logs` (or All buckets)
3. Copy both credentials (Secret shown only once!)
4. Save to `docs/CREDENTIALS.md`:
   ```
   ## R2 API Token for Logpush
   Access Key ID: <your-key-id>
   Secret Access Key: <your-secret-key>
   ```

### 2. Run Setup Script (Automated - 1 minute)

```bash
export CLOUDFLARE_API_TOKEN='your-cloudflare-api-token'
./scripts/setup-logpush.sh
```

The script will:
- Prompt for R2 credentials
- Verify bucket ownership
- Create Logpush job via API
- Configure all settings

### 3. Deploy Worker (Automated - 30 seconds)

```bash
cd worker/
npm run deploy
```

Worker now has `logpush: true` and will send logs to R2.

## Verification

### Generate Test Traffic
```bash
./scripts/logpush-management.sh test
```

### Wait 1-2 Minutes
Logpush batches logs every 30 seconds.

### Check R2 for Logs
```bash
./scripts/logpush-management.sh list-logs
```

You should see files like:
```
2025-12-12/20251212T120000Z_20251212T120030Z_abc123.log.gz
```

### Download and View Logs
```bash
# List logs
npx wrangler r2 object list alexandria-logs --limit 5

# Download a log file
./scripts/logpush-management.sh download 2025-12-12/20251212T120000Z_20251212T120030Z_abc123.log.gz

# View decompressed logs
cat /tmp/alexandria-log-*.log | jq
```

## What You Get

**Fields captured**:
- EventTimestampMs - When event occurred
- EventType - Trigger type (fetch)
- Outcome - ok or exception
- ScriptName - alexandria
- Exceptions - Array of errors
- Logs - Array of console.log() messages
- CPUTimeMs - CPU time used
- WallTimeMs - Total execution time

**Log format**:
- JSONL (newline-delimited JSON)
- GZIP compressed
- RFC3339 timestamps
- Batched every 30 seconds or 5MB

**Retention**:
- Workers Logs UI: 7 days (free)
- R2 Storage: Forever (or until deleted)

**Cost**:
- ~$1.50/month for 10K requests/day
- Compare to $20-50 for third-party logging

## Daily Usage

### Real-time logs (7-day retention)
```bash
npm run tail
```

### Long-term logs (R2 storage)
```bash
./scripts/logpush-management.sh list-logs
./scripts/logpush-management.sh download <path>
```

### Manage Logpush jobs
```bash
./scripts/logpush-management.sh list              # List all jobs
./scripts/logpush-management.sh get <job_id>      # Get details
./scripts/logpush-management.sh enable <job_id>   # Enable job
./scripts/logpush-management.sh disable <job_id>  # Disable job
```

## Troubleshooting

### No logs appearing?

1. **Check job is enabled**:
   ```bash
   ./scripts/logpush-management.sh list
   ```
   Look for `Enabled: true`

2. **Verify Worker has logpush enabled**:
   ```bash
   grep logpush worker/wrangler.jsonc
   ```
   Should show: `"logpush": true`

3. **Generate test traffic**:
   ```bash
   ./scripts/logpush-management.sh test
   ```

4. **Check R2 token permissions**:
   Go to: https://dash.cloudflare.com/d03bed0be6d976acd8a1707b55052f79/r2/api-tokens
   Verify token has "Object Read & Write"

5. **Wait longer**:
   Logs batch every 30 seconds. First batch may take 1-2 minutes.

### API errors?

Check `CLOUDFLARE_API_TOKEN` has:
- Account-level scope
- "Logs Edit" permission

Create new token: https://dash.cloudflare.com/profile/api-tokens

## Files Reference

- **Setup**: `scripts/setup-logpush.sh`
- **Management**: `scripts/logpush-management.sh`
- **Full docs**: `docs/LOGPUSH-SETUP.md`
- **Config**: `worker/wrangler.jsonc` (has `"logpush": true`)
- **R2 bucket**: `alexandria-logs`

## One Command Setup

If you already have credentials in environment variables:

```bash
# Set env vars
export CLOUDFLARE_API_TOKEN='your-api-token'
export R2_ACCESS_KEY_ID='your-r2-access-key-id'
export R2_SECRET_ACCESS_KEY='your-r2-secret-key'

# Run setup (will use env vars if set)
echo -e "${R2_ACCESS_KEY_ID}\n${R2_SECRET_ACCESS_KEY}" | ./scripts/setup-logpush.sh

# Deploy
cd worker && npm run deploy
```

## Benefits

1. **Debug historical issues**: Logs kept forever in R2
2. **Performance analysis**: Track CPU/wall time trends
3. **Error tracking**: All exceptions logged
4. **Cost effective**: $1.50/month vs $20-50 third-party
5. **Full control**: Your data, your bucket, your queries

## Next Steps

After setup:
- Monitor logs in R2 for first few days
- Set up automated log analysis (future enhancement)
- Consider log rotation policy (future enhancement)
- Build Grafana dashboard from R2 logs (future enhancement)

For detailed information, see: `docs/LOGPUSH-SETUP.md`
