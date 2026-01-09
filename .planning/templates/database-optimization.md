# Database Optimization Planning Template

## Current State
### Problem Description


### Performance Metrics
- Current query time:
- Row count:
- Index usage:

## Analysis
### EXPLAIN ANALYZE Results
```sql
-- Paste EXPLAIN ANALYZE output
```

### Bottlenecks Identified
-
-

## Optimization Strategy
### Proposed Changes
1.
2.
3.

### Index Considerations
- New indexes needed?
- Existing indexes to modify?
- Index size impact?

### Query Rewrite
```sql
-- Original query

-- Optimized query
```

## Testing Plan
1. Test in psql first
2. Benchmark before/after
3. Check EXPLAIN ANALYZE improvements
4. Verify result correctness

## Rollback Plan
- How to revert changes?
- Backup strategy?

## Impact Assessment
- Worker deployment needed?
- Cache invalidation?
- API contract changes?
