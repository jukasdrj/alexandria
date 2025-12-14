# Cloudflare Logpush to R2 Setup Guide

## Overview

This guide configures Cloudflare Logpush to store Workers Trace Events logs in R2 for long-term retention. Workers Logpush captures detailed execution logs including console output, exceptions, performance metrics, and request metadata.

## Architecture

```
Alexandria Worker
  |
  v
Workers Trace Events (real-time)
  |
  v
Logpush Job (batching)
  |
  v
R2 Bucket: alexandria-logs
  |
  v
Long-term storage & analysis
```

## Prerequisites

- Workers Paid plan (required for Logpush)
- Cloudflare API token with "Logs Edit" permissions (account-level)
- R2 bucket created: `alexandria-logs` (DONE)
- R2 API token with Edit permissions for the bucket

## Setup Steps

### 1. Create R2 API Token (MANUAL - Dashboard Required)

Wrangler CLI does not support creating R2 API tokens. You must use the Cloudflare Dashboard:

1. Navigate to: https://dash.cloudflare.com/d03bed0be6d976acd8a1707b55052f79/r2/api-tokens
2. Click "Create API Token"
3. Configure token:
   - **Name**: `logpush-r2-access`
   - **Permissions**: Object Read & Write
   - **Specific Buckets**: `alexandria-logs` (recommended) OR All buckets
   - **TTL**: Forever (or set expiration as needed)
4. Click "Create API Token"
5. **CRITICAL**: Copy both values immediately (cannot retrieve Secret later):
   - **Access Key ID**: (looks like alphanumeric string)
   - **Secret Access Key**: (looks like long hash)
6. Save these to `docs/CREDENTIALS.md` (gitignored):
   ```
   ## R2 API Token for Logpush
   Access Key ID: <paste here>
   Secret Access Key: <paste here>
   ```

### 2. Create Logpush Job via API

Use the script: `scripts/setup-logpush.sh`

Or manually via cURL:

```bash
# Get ownership challenge
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/d03bed0be6d976acd8a1707b55052f79/logpush/ownership" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_conf": "r2://alexandria-logs/{DATE}?account-id=d03bed0be6d976acd8a1707b55052f79&access-key-id=<R2_ACCESS_KEY_ID>&secret-access-key=<R2_SECRET_ACCESS_KEY>"
  }'
```

Response will include: `"ownership_challenge": "00000000000000000000"`

```bash
# Create Logpush job
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/d03bed0be6d976acd8a1707b55052f79/logpush/jobs" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "alexandria-workers-logpush",
    "dataset": "workers_trace_events",
    "destination_conf": "r2://alexandria-logs/{DATE}?account-id=d03bed0be6d976acd8a1707b55052f79&access-key-id=<R2_ACCESS_KEY_ID>&secret-access-key=<R2_SECRET_ACCESS_KEY>",
    "logpull_options": "fields=EventTimestampMs,EventType,Outcome,ScriptName,Exceptions,Logs,CPUTimeMs,WallTimeMs&timestamps=rfc3339",
    "ownership_challenge": "<from previous response>",
    "enabled": true,
    "frequency": "high",
    "max_upload_bytes": 5000000,
    "max_upload_interval_seconds": 30
  }'
```

**Fields Captured** (as requested in issue #73):
- `EventTimestampMs` - When the event occurred
- `EventType` - Trigger type (always "fetch" for HTTP requests)
- `Outcome` - Result: "ok" or "exception"
- `ScriptName` - Worker name (alexandria)
- `Exceptions` - Uncaught exceptions array
- `Logs` - Console output array
- `CPUTimeMs` - CPU time used (bonus)
- `WallTimeMs` - Total execution time (bonus)

### 3. Enable Logpush on Worker

Add to `worker/wrangler.jsonc`:

```jsonc
{
  "logpush": true
}
```

This property tells Cloudflare to send logs from this Worker to any configured Logpush jobs.

**IMPORTANT**: Without this property, no logs will be pushed even if the job is configured.

### 4. Deploy Worker

```bash
cd worker/
npm run deploy
```

The `logpush` property will be included in the deployment, and logs will start flowing to R2.

## Verification

### Check Logpush Job Status

```bash
# List all Logpush jobs
curl "https://api.cloudflare.com/client/v4/accounts/d03bed0be6d976acd8a1707b55052f79/logpush/jobs" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq

# Get specific job details
curl "https://api.cloudflare.com/client/v4/accounts/d03bed0be6d976acd8a1707b55052f79/logpush/jobs/<JOB_ID>" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq
```

### Check R2 Bucket for Logs

```bash
# List objects in bucket (after a few minutes)
npx wrangler r2 object list alexandria-logs --limit 20

# Download a log file
npx wrangler r2 object get alexandria-logs/<log-file-path> --file=/tmp/logs.jsonl

# View logs
cat /tmp/logs.jsonl | jq
```

### Trigger Some Logs

```bash
# Generate worker activity
curl "https://alexandria.ooheynerds.com/health"
curl "https://alexandria.ooheynerds.com/api/stats"
curl "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873"

# Wait 1-2 minutes for batching
# Check R2 bucket again
```

## Log File Structure

Logpush creates files with this structure:
```
alexandria-logs/
  └── 2025-12-12/
      ├── 20251212T120000Z_20251212T120030Z_xxxxxxxx.log.gz
      ├── 20251212T120030Z_20251212T120100Z_xxxxxxxx.log.gz
      └── ...
```

Files are:
- **Batched**: Every 30 seconds or 5MB (whichever comes first)
- **Compressed**: GZIP format (`.gz` extension)
- **JSONL**: Newline-delimited JSON (one event per line)
- **Timestamped**: RFC3339 format

## Log Retention

- **Workers Logs UI**: 7 days (Workers Paid plan)
- **R2 Storage**: Forever (or until manually deleted)
- **Cost**: ~$0.015/GB/month storage + minimal API costs

## Monitoring

### Logpush Job Health

Check job health in dashboard:
https://dash.cloudflare.com/d03bed0be6d976acd8a1707b55052f79/analytics-and-logs/logpush

Look for:
- Job status: "enabled"
- Last push: Recent timestamp
- Errors: Should be 0

### R2 Storage Usage

```bash
# Check bucket size
npx wrangler r2 bucket list | grep alexandria-logs
```

View in dashboard:
https://dash.cloudflare.com/d03bed0be6d976acd8a1707b55052f79/r2/buckets/alexandria-logs

## Troubleshooting

### No logs appearing in R2

1. **Check Logpush job is enabled**:
   ```bash
   curl "https://api.cloudflare.com/client/v4/accounts/d03bed0be6d976acd8a1707b55052f79/logpush/jobs" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[] | select(.dataset=="workers_trace_events")'
   ```

2. **Verify Worker has logpush enabled**:
   ```bash
   grep -A1 '"logpush"' worker/wrangler.jsonc
   ```

3. **Check R2 API token has correct permissions**:
   - Go to: https://dash.cloudflare.com/d03bed0be6d976acd8a1707b55052f79/r2/api-tokens
   - Verify token has "Object Read & Write" on `alexandria-logs`

4. **Generate test traffic**:
   ```bash
   for i in {1..10}; do
     curl "https://alexandria.ooheynerds.com/health"
     sleep 1
   done
   ```
   Wait 2-3 minutes and check R2.

5. **Check Logpush job errors**:
   ```bash
   curl "https://api.cloudflare.com/client/v4/accounts/d03bed0be6d976acd8a1707b55052f79/logpush/jobs/<JOB_ID>" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result.error_message'
   ```

### Invalid destination_conf

If ownership challenge fails:
- Verify R2 Access Key ID and Secret are correct
- Check account ID matches: `d03bed0be6d976acd8a1707b55052f79`
- Ensure bucket exists: `npx wrangler r2 bucket list | grep alexandria-logs`

### Logs truncated

Workers Logpush has limits:
- Single log message: 16,384 characters (truncated if exceeded)
- Exception/log arrays: Truncated with `"<<<Logpush: field truncated>>>"`

To avoid:
- Keep console.log() messages concise
- Use structured logging with separate fields
- Avoid logging large objects

## Cost Estimate

Based on Alexandria usage:

**Assumptions**:
- 10,000 requests/day
- Average log size: 2KB per request
- Daily log volume: ~20MB

**Monthly Costs**:
- Storage: 600MB × $0.015/GB = $0.009 (~1 cent)
- Class A operations (writes): 10K/day × 30 = 300K × $4.50/million = $1.35
- Class B operations (reads): Minimal for Logpush
- **Total**: ~$1.50/month for comprehensive log retention

**Compare to**:
- Third-party logging: $20-50/month
- Cloudflare Workers Logs (7 days): Free with Workers Paid

## Future Enhancements

1. **Log Analysis Worker**: Query R2 logs for debugging/analytics
2. **Logs Engine**: Stream query R2 logs via Cloudflare API
3. **Automated Alerts**: Trigger on exception patterns
4. **Log Rotation**: Auto-delete logs older than X days
5. **Grafana Dashboard**: Visualize metrics from R2 logs

## References

- [Workers Logpush Documentation](https://developers.cloudflare.com/workers/observability/logs/logpush/)
- [Enable R2 Destination](https://developers.cloudflare.com/logs/logpush/logpush-job/enable-destinations/r2/)
- [Workers Trace Events Dataset](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/)
- [Logpush API Documentation](https://developers.cloudflare.com/api-next/resources/logpush/subresources/jobs/methods/create/)
- [One-Click Logpush Setup](https://developers.cloudflare.com/changelog/2025-03-06-oneclick-logpush/)
