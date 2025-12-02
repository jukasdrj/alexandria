# Alexandria Worker Deployment Checklist

## Pre-Deployment Verification

### 1. Configuration Migration ✅
- [x] Migrated to `wrangler.jsonc` format
- [x] Backup created: `wrangler.toml.backup`
- [x] Schema validation passes
- [x] All bindings verified with dry-run

### 2. Infrastructure Health
Run these commands before deploying:

```bash
# Check Cloudflare Tunnel status (expect 4 connections)
./scripts/tunnel-status.sh

# Verify database connectivity and sample query
./scripts/db-check.sh

# Test local development
cd worker/
npm run dev
# Visit http://localhost:8787/health
```

### 3. Cloudflare Account Verification
Ensure your account has:
- [ ] **Workers Paid Plan** activated
- [ ] Sufficient credits/payment method
- [ ] Queue quota available (check dashboard)
- [ ] Analytics Engine enabled

## Deployment Steps

### Step 1: Deploy Worker
```bash
cd worker/
npm run deploy
```

Expected output:
```
✅ Worker deployed to alexandria.ooheynerds.com
✅ Bindings: HYPERDRIVE, CACHE, COVER_IMAGES, etc.
```

### Step 2: Verify Deployment
```bash
# Check live Worker
curl https://alexandria.ooheynerds.com/health

# Monitor logs
npm run tail
```

### Step 3: Create Queue (First Deployment Only)
The queue will be automatically created on first deployment. Verify:

```bash
npx wrangler queues list
```

You should see:
- `alexandria-enrichment-queue` (active)
- `alexandria-enrichment-dlq` (created on first failed message)

### Step 4: Test Queue Functionality
```bash
# Send a test message to the queue
npx wrangler queues producer send alexandria-enrichment-queue "test message"

# Watch for processing in logs
npm run tail
```

### Step 5: Verify Cron Trigger
The cron trigger (`*/5 * * * *`) should appear in Cloudflare dashboard:
1. Go to Workers & Pages
2. Select `alexandria` worker
3. Click "Triggers" tab
4. Verify cron schedule is active

## Post-Deployment Validation

### Test Core Functionality

#### 1. Health Check
```bash
curl https://alexandria.ooheynerds.com/health
```
Expected: `{"status":"ok"}`

#### 2. ISBN Lookup (if implemented)
```bash
curl "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873"
```

#### 3. Cover Processing (if implemented)
```bash
curl -X POST https://alexandria.ooheynerds.com/api/covers/process \
  -H "Content-Type: application/json" \
  -d '{"work_key":"/works/OL45804W","provider_url":"..."}'
```

### Monitor Observability

#### 1. Check Logs (Cloudflare Dashboard)
1. Navigate to Workers & Pages → alexandria
2. Click "Logs" tab
3. Verify 100% sampling rate
4. Look for any errors

#### 2. Analytics Engine Datasets
Verify datasets were created:
```bash
npx wrangler analytics list
```

Expected:
- `alexandria_performance`
- `alexandria_queries`
- `alexandria_covers`

#### 3. Smart Placement
In Cloudflare dashboard, verify Worker is placed optimally:
- Workers & Pages → alexandria → Settings
- Look for "Smart Placement: Enabled"

## Monitoring Setup

### Key Metrics to Watch (First 24 Hours)

1. **Request Volume**
   - Dashboard: Workers & Pages → alexandria → Analytics
   - Expected: Depends on your usage

2. **CPU Time Usage**
   - Dashboard: Workers & Pages → alexandria → Analytics
   - Target: <10s average
   - Alert if: >30s consistently

3. **Error Rate**
   - Dashboard: Workers & Pages → alexandria → Analytics
   - Target: <1%
   - Alert if: >5%

4. **Queue Processing**
   - Dashboard: Queues → alexandria-enrichment-queue
   - Watch for messages in DLQ

### Set Up Alerts

Create alerts in Cloudflare dashboard for:
- [ ] Error rate >5%
- [ ] CPU time >30s (average)
- [ ] Queue DLQ has >10 messages
- [ ] Cache hit rate <60% (if implemented)

## Rollback Plan

If issues occur, rollback to previous configuration:

```bash
cd worker/

# Restore old config
mv wrangler.jsonc wrangler.jsonc.new
mv wrangler.toml.backup wrangler.toml

# Deploy old version
npm run deploy

# Verify
curl https://alexandria.ooheynerds.com/health
```

Then investigate issues before re-attempting migration.

## Cost Monitoring

### First Week Checklist
- [ ] Review Cloudflare billing dashboard daily
- [ ] Check CPU time usage (target: <10s avg)
- [ ] Monitor queue message volume
- [ ] Review Analytics Engine writes

### Expected Costs (First Month)
- Worker requests: ~$0.15 per 1M requests
- CPU time: Included in paid plan up to limits
- Queue messages: $0.40 per 1M operations
- Analytics writes: $0.25 per 1M writes

**Total estimate**: $10-15/month for moderate usage

## Success Criteria

Deployment is successful when:
- [x] Worker deploys without errors
- [ ] Health endpoint returns 200 OK
- [ ] Database queries work correctly
- [ ] Queue processing functions
- [ ] Cron trigger executes every 5 minutes
- [ ] Logs show 100% sampling
- [ ] Analytics datasets receiving data
- [ ] No increase in error rate
- [ ] CPU time within expected range

## Support Resources

- Cloudflare Workers Docs: https://developers.cloudflare.com/workers/
- Hyperdrive Docs: https://developers.cloudflare.com/hyperdrive/
- Queues Docs: https://developers.cloudflare.com/queues/
- Community Discord: https://discord.cloudflare.com

## Notes

- Queue and Analytics Engine datasets auto-create on first use
- Smart Placement may take a few hours to optimize
- Observability logs may take up to 5 minutes to appear
- Cron triggers execute based on UTC time

---

**Last Updated**: 2025-12-01
**Migration Status**: Ready for deployment
**Backup Location**: `worker/wrangler.toml.backup`
