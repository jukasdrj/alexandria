# Task: Debug Queue Consumer Not Triggering - ENRICHMENT_QUEUE

## Goal
Fix the queue consumer so that messages sent to ENRICHMENT_QUEUE are automatically processed by the Worker, eliminating the need for manual batch-direct API calls.

## Context
- **Current state**: ENRICHMENT_QUEUE has 7 messages (created 7-9 hours ago) that have never been processed
- **Problem**: The queue consumer function is not being triggered when messages arrive
- **Success criteria**:
  1. Messages in ENRICHMENT_QUEUE are automatically consumed within 60 seconds
  2. `processEnrichmentQueue()` handler is called when messages arrive
  3. Queue metrics show non-zero "received" count
  4. New test message is processed automatically

## Implementation Steps
- [ ] Phase 1: Evidence Gathering & Root Cause Analysis
  - [ ] Review queue consumer registration in `worker/src/index.ts`
  - [ ] Verify queue handler implementation in `worker/src/services/queue-handlers.ts`
  - [ ] Check wrangler.jsonc queue configuration
  - [ ] Examine deployment logs for consumer registration
  - [ ] Ask Grok to review code for common Worker queue issues
- [ ] Phase 2: Hypothesis Testing
  - [ ] Test Hypothesis 1: Consumer not properly registered (MOST LIKELY)
  - [ ] Test Hypothesis 2: Queue binding mismatch
  - [ ] Test Hypothesis 3: Dead letter queue misconfiguration
  - [ ] Test Hypothesis 4: Cloudflare platform bug
  - [ ] Test Hypothesis 5: Message format incompatibility
- [ ] Phase 3: Fix Implementation
  - [ ] Apply identified fix
  - [ ] Update code if needed
  - [ ] Add defensive logging
  - [ ] Deploy updated Worker
- [ ] Phase 4: Validation
  - [ ] Send test message to queue
  - [ ] Verify automatic consumption within 60s
  - [ ] Check queue metrics for "received" count
  - [ ] Process backlogged 7 messages
  - [ ] Monitor for 24 hours

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Consumer still doesn't trigger | Production enrichment broken | Keep batch-direct endpoint as fallback |
| Fix causes Worker crashes | Service outage | Deploy incrementally, monitor errors |
| Messages lost during debugging | Data loss | Don't delete queue messages manually |
| Cloudflare platform bug | Can't fix ourselves | Open support ticket with evidence |

## Files to Investigate
- `worker/src/index.ts` - Main Worker entry point, queue consumer registration
- `worker/src/services/queue-handlers.ts` - Queue handler implementations
- `worker/wrangler.jsonc` - Queue bindings and configuration
- `.github/ISSUE_QUEUE_CONSUMER_NOT_TRIGGERING.md` - Comprehensive evidence document

## Testing Strategy
- **Unit**: Verify handler function exists and is exported
- **Integration**: Test queue consumer registration in Worker
- **E2E**: Send test message → Verify automatic processing → Check database for enrichment
- **Monitoring**: Track queue metrics for 24 hours post-fix

## Grok Consultation Strategy
1. Share code snippets and configuration
2. Ask about common Worker queue consumer issues
3. Request code review for consumer registration
4. Get recommendations for debugging strategies
5. Validate proposed fixes before deployment
