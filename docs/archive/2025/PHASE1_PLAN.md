# Phase 1 Implementation Plan: Quota Coordination System

## Overview
Complete implementation of centralized quota management system for Alexandria's ISBNdb Premium API (15K daily calls, using 13K with 2K safety buffer).

---

## Step 1: Configure KV Namespace

**Actions:**
1. Create KV namespace via Wrangler CLI:
   ```bash
   npx wrangler kv:namespace create QUOTA_KV
   npx wrangler kv:namespace create QUOTA_KV --preview
   ```

2. Add binding to `worker/wrangler.jsonc`:
   ```jsonc
   "kv_namespaces": [
     { "binding": "CACHE", "id": "..." },
     { "binding": "QUOTA_KV", "id": "<production-id>", "preview_id": "<preview-id>" }
   ]
   ```

3. Update `worker/src/env.ts` type definitions to include QUOTA_KV binding

---

## Step 2: Review and Enhance quota-manager.ts

**Review existing implementation for:**
- Atomic increment operations using KV
- Daily reset logic (UTC midnight check)
- Safety buffer enforcement (13K of 15K limit)
- Methods needed: `checkQuota()`, `incrementUsage()`, `getStatus()`, `resetIfNeeded()`
- Error handling for KV failures
- TypeScript types for quota responses

---

## Step 3: Integrate Quota Manager into Endpoints

```
Endpoint Integration Flow:
┌─────────────────────────────────────────────────┐
│ 1. Import QuotaManager                          │
│ 2. Check quota availability                     │
│ 3. Calculate calls needed                       │
│ 4. Return 429 if insufficient                   │
│ 5. Execute ISBNdb operation                     │
│ 6. Increment usage counter                      │
│ 7. Add quota info to response                   │
└─────────────────────────────────────────────────┘
```

### A. /api/enrich/batch-direct (worker/src/routes/enrich.ts)
- Calculate calls needed: 1 call per batch (up to 1000 ISBNs)
- Pre-check quota before batch operation
- Increment after successful ISBNdb call

### B. /api/authors/enrich-bibliography (worker/src/routes/authors.ts)
- Calculate pagination calls: `pages = Math.ceil(results/1000)`
- Pre-check quota for entire operation
- Increment after each ISBNdb call

### C. /api/books/enrich-new-releases (worker/src/routes/books.ts)
- Calculate total pages: `months × pages_per_month`
- Pre-check quota availability
- Add quota exhaustion handling mid-operation

### D. Scheduled cron handler (worker/src/routes/harvest.ts)
- Check quota at cron trigger start
- Skip execution if quota < safety threshold
- Log quota status for monitoring

### E. Bulk author script (scripts/bulk-author-harvest.js)
- HTTP check to `/api/quota/status` before processing
- Fetch quota status every 100 authors
- Graceful pause if quota exhausted
- Resume capability from checkpoint

---

## Step 4: Create Quota Monitoring Endpoint

Add `GET /api/quota/status` endpoint:

```json
{
  "daily_limit": 15000,
  "safety_limit": 13000,
  "used": 8456,
  "remaining": 4544,
  "reset_at": "2025-12-31T00:00:00Z",
  "percentage_used": 65
}
```

---

## Step 5: Write Tests

### Unit Tests (worker/src/services/quota-manager.test.ts)
- Test increment operation
- Test quota check with available quota
- Test quota check with exhausted quota
- Test daily reset logic
- Test safety buffer enforcement

### Integration Tests
- Test endpoint quota rejection (429 response)
- Test quota increment after successful call
- Test concurrent quota operations
- Mock KV for deterministic testing

---

## Step 6: Deploy and Validate

### Deployment Steps:
1. Deploy KV namespace to production
2. Deploy worker with quota integration
3. Smoke test each endpoint

### Validation Checklist:
```
[ ] Call /api/quota/status (should show 0 usage)
[ ] Call /api/enrich/batch-direct with 1 ISBN
[ ] Verify quota incremented
[ ] Test 429 response by manually setting quota to limit
[ ] Monitor first 24 hours for quota tracking accuracy
[ ] Verify reset at midnight UTC
[ ] Confirm no quota leaks or over-counting
```

---

## Step 7: Update Documentation

- Update HARVESTING_TODOS.md with completed checkboxes
- Add quota management section to CLAUDE.md
- Document quota monitoring endpoint
- Add troubleshooting guide for quota issues

---

## Success Criteria

```
[ ] KV namespace created and bound
[ ] All 5 endpoints enforce quota limits
[ ] 429 responses when quota exhausted
[ ] Quota resets at UTC midnight
[ ] Tests passing with >80% coverage
[ ] Monitoring endpoint functional
```

---

## Risk Mitigation

| Risk | Mitigation Strategy |
|------|-------------------|
| **KV eventual consistency** | Use atomic operations, accept slight over-counting |
| **Quota drift** | Reset logic runs on every request, self-healing |
| **Testing KV** | Use miniflare or mock KV for deterministic tests |
| **Rollback plan** | Feature flag to disable quota checks if issues arise |

---

## Implementation Tasks

1. [ ] Create KV namespace and add binding
2. [ ] Review and enhance quota-manager.ts
3. [ ] Integrate quota manager into /api/enrich/batch-direct
4. [ ] Integrate quota manager into /api/authors/enrich-bibliography
5. [ ] Integrate quota manager into /api/books/enrich-new-releases
6. [ ] Integrate quota manager into cron handler
7. [ ] Integrate quota manager into bulk author script
8. [ ] Create /api/quota/status endpoint
9. [ ] Write unit tests for quota-manager
10. [ ] Write integration tests for quota endpoints
11. [ ] Deploy and validate quota system
12. [ ] Update documentation
