---
description: Check ISBNdb API quota status and usage
user-invocable: true
model: haiku
context: main
allowed-tools:
  - Bash(curl https://alexandria.ooheynerds.com/api/quota/*)
---

Monitor ISBNdb API quota consumption and availability.

## What This Checks

- Daily quota usage (resets midnight UTC)
- Remaining calls
- Can make calls (yes/no)
- Usage percentage

## Steps

1. **Get quota status**:
   ```bash
   curl -s https://alexandria.ooheynerds.com/api/quota/status | jq '
     {
       used: .used,
       remaining: .remaining,
       limit: .limit,
       percentage: .percentage_used,
       can_call: .can_make_calls,
       resets: .resets_at
     }
   '
   ```

2. **Analyze usage**:
   - 🟢 < 70% = Healthy
   - 🟡 70-90% = Caution
   - 🔴 > 90% = Critical
   - ⛔ 100% = Quota exhausted

## Key Metrics

**Limit**: 13,000 calls/day (15K - 2K buffer)
**Rate**: 3 req/sec
**Batch**: 1000 ISBNs per call

## Recommendations

### Healthy (< 70%)
- Continue normal operations
- Backfill can proceed

### Caution (70-90%)
- Monitor closely
- Pause non-essential backfills
- Prioritize user-facing requests

### Critical (> 90%)
- **Stop all backfills immediately**
- Queue enrichment requests for tomorrow
- User requests only

### Exhausted (100%)
- Wait for midnight UTC reset
- No ISBNdb calls possible
- Fallback to free providers (OpenLibrary, Archive.org, Wikidata)

## Integration

Check before running:
- `/backfill-monitor`
- Large batch enrichments
- Author bibliography expansion
