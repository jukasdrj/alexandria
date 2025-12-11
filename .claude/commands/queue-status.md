---
description: Check Cloudflare queue status and recent activity
model: haiku
---

Check the status of Alexandria's Cloudflare Queues.

## Steps

1. List all queues:
   ```bash
   cd worker && npx wrangler queues list
   ```

2. Get queue metrics (if available):
   ```bash
   cd worker && npx wrangler queues consumer get alexandria-enrichment-queue
   cd worker && npx wrangler queues consumer get alexandria-cover-queue
   ```

3. Check recent worker logs for queue activity:
   ```bash
   cd worker && npm run tail | grep -E "(Queue|Enrich|Cover)" | head -20
   ```

4. Report status:
   - Queue names and consumer configurations
   - Recent queue processing activity
   - Any errors or dead letter queue messages
   - Recommendations for optimization if needed
