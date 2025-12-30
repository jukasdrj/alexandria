# Alexandria Harvesting Activation - Action Plan

## 🎯 **Goal: Get All Harvesting Systems Online and Functional**

Based on expert consensus, implementing centralized quota coordination with incremental rollout.

---

## 📋 **Phase 1: Quota Coordinator (THIS WEEKEND)**

### ✅ **Todo 1: Build centralized quota manager using Cloudflare KV**
- [ ] Create `worker/src/services/quota-manager.ts`
- [ ] Implement atomic KV operations for quota tracking
- [ ] Add daily reset logic (UTC midnight)
- [ ] Include safety buffer (use 13K of 15K daily limit)
- [ ] Add quota status methods (check remaining, get usage stats)

### ✅ **Todo 2: Add KV binding for quota tracking**
- [ ] Update `worker/wrangler.jsonc` with QUOTA_KV binding
- [ ] Deploy KV namespace via Wrangler CLI
- [ ] Test KV connectivity in Worker

### ✅ **Todo 3: Implement quota checks in all harvesting endpoints**
- [ ] Update `/api/enrich/batch-direct` with quota validation
- [ ] Update `/api/authors/enrich-bibliography` with quota checks
- [ ] Update `/api/books/enrich-new-releases` with quota guards
- [ ] Update scheduled cron handler with quota coordination
- [ ] Update bulk author harvest script with quota awareness

### ✅ **Todo 4: Test quota coordination system**
- [ ] Unit tests for quota manager
- [ ] Integration test with current author processing
- [ ] Validate quota exhaustion handling
- [ ] Test daily reset functionality

---

## 📋 **Phase 2: Incremental Activation (NEXT WEEK)**

### ✅ **Todo 5: Enable bulk author tier processing with quota coordination**
- [ ] Run top-1000 tier processing (1,000 authors)
- [ ] Monitor quota usage and system performance
- [ ] Validate author-work linking and deduplication
- [ ] Process cover queue backlog (4,918+ covers)

### ✅ **Todo 6: Activate scheduled cron harvesting with monitoring**
- [ ] Uncomment cron trigger in `wrangler.jsonc`
- [ ] Enable scheduled cover harvesting (every 5 minutes)
- [ ] Implement monitoring dashboard for queue health
- [ ] Add alerting for quota exhaustion

### ✅ **Todo 7: Monitor system performance and tune parameters**
- [ ] Track API quota usage patterns
- [ ] Monitor queue depth and processing rates
- [ ] Tune batch sizes and timeout values
- [ ] Optimize ISBNdb call efficiency

---

## 📊 **Success Metrics (Week 1)**

- **✅ 0 API quota violations** (no 429 errors from ISBNdb)
- **✅ 1,000+ authors processed** (top-1000 tier completion)
- **✅ 5,000+ covers downloaded** (queue processing current backlog)
- **✅ 100+ new releases enriched** (cron job functional)
- **✅ 13K+ daily API calls utilized** (maximizing quota efficiency)

---

## 🚨 **Critical Files to Modify**

### New Files
- `worker/src/services/quota-manager.ts` - Centralized quota coordination
- `worker/src/routes/monitoring.ts` - Quota and queue monitoring dashboard

### Modified Files
- `worker/wrangler.jsonc` - Add KV binding, uncomment cron
- `worker/src/routes/enrich.ts` - Add quota checks to batch endpoints
- `worker/src/routes/authors.ts` - Add quota checks to author endpoints
- `worker/src/routes/books.ts` - Add quota checks to new releases
- `worker/src/routes/harvest.ts` - Add quota coordination to cron handler
- `scripts/bulk-author-harvest.js` - Integrate quota awareness

---

## ⚠️ **Risk Mitigation**

| Risk | Mitigation Strategy |
|------|-------------------|
| **API Quota Exhaustion** | KV-based counter with 13K limit (2K buffer) |
| **API Key Suspension** | Conservative quota limits + backoff strategies |
| **Queue Saturation** | Monitor queue depth, implement backpressure |
| **Resource Strain** | Gradual rollout with performance monitoring |
| **Data Quality Issues** | Validate work deduplication and author linking |

---

## 📈 **Timeline**

- **Day 1-2**: Build and test quota manager
- **Day 3-4**: Enable bulk author processing
- **Day 5-6**: Activate scheduled harvesting
- **Day 7**: Monitor, tune, optimize

**Target: Full system operational by end of Week 1**