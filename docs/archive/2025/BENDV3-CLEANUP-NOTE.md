# Cloudflare Cleanup Needed in bendv3

**Date:** Dec 14, 2025
**From:** Alexandria project cleanup
**Status:** ⚠️ STILL PENDING - Resources still bound to bendv3 as of Jan 5, 2026

## Summary

During Alexandria infrastructure cleanup, we found legacy resources still bound to the `api-worker` (bendv3) that can't be deleted externally.

## Resources to Clean Up

### Queues (5)
These are no longer needed if bendv3 isn't using them:

| Queue | Created | Status |
|-------|---------|--------|
| `author-warming-queue` | Oct 29, 2025 | 1 producer, 1 consumer |
| `author-warming-dlq` | Oct 29, 2025 | Dead letter queue |
| `author-warming-queue-staging` | Nov 15, 2025 | Staging |
| `author-warming-dlq-staging` | Nov 15, 2025 | Staging DLQ |
| `enrichment-queue` | Nov 25, 2025 | 1 consumer (orphan?) |

### KV Namespaces (2)
| Namespace | ID |
|-----------|-----|
| `BOOKS_CACHE` | `b9cade63b6db48fd80c109a013f38fdb` |
| `RECOMMENDATIONS_CACHE` | `be0ca7077bab4942b57c02d547f1c968` |

### Workflow (1)
| Workflow | Script |
|----------|--------|
| `book-import-workflow` | `api-worker` |

## How to Clean Up

1. **Remove bindings from wrangler.toml/jsonc** in bendv3:
   ```jsonc
   // Remove these queue bindings
   "queues": {
     "producers": [
       // Remove author-warming-queue entries
     ]
   }

   // Remove these KV bindings
   "kv_namespaces": [
     // Remove BOOKS_CACHE, RECOMMENDATIONS_CACHE
   ]

   // Remove workflow if not used
   "workflows": [
     // Remove book-import-workflow
   ]
   ```

2. **Deploy bendv3** to unbind the resources

3. **Delete the resources** via wrangler:
   ```bash
   # Queues
   npx wrangler queues delete author-warming-queue
   npx wrangler queues delete author-warming-dlq
   npx wrangler queues delete author-warming-queue-staging
   npx wrangler queues delete author-warming-dlq-staging
   npx wrangler queues delete enrichment-queue

   # KV
   npx wrangler kv namespace delete --namespace-id b9cade63b6db48fd80c109a013f38fdb
   npx wrangler kv namespace delete --namespace-id be0ca7077bab4942b57c02d547f1c968

   # Workflow
   npx wrangler workflows delete book-import-workflow
   ```

## What Alexandria Cleaned Up

For reference, we deleted these unbound resources:
- 9 KV namespaces (staging, analytics, caches)
- 2 Cloudflare Workflows (author-harvest, new-releases-harvest)
- Removed workflow code and cron triggers from alexandria worker

## Questions?

Check the Alexandria repo or ping in the shared channel.
