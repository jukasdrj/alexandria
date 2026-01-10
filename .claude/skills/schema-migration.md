---
name: schema-migration
description: Safe PostgreSQL schema changes with zero-downtime deployment and testing
user-invocable: true
context: fork
agent: postgres-optimizer
model: sonnet
skills:
  - planning-with-files
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
hooks:
  Start:
    - type: command
      command: ./scripts/db-check.sh
      timeout: 30000
  Stop:
    - type: command
      command: echo "🐘 Schema migration complete - validate with db-check.sh"
---

# Schema Migration Skill

**Purpose:** Orchestrate safe database schema changes with proper planning, testing, and zero-downtime deployment
**Agent:** postgres-optimizer (auto-loaded)
**Context:** Runs in forked sub-agent for isolation
**Updated:** January 10, 2026

## When to Use

**Required for any database schema change:**
- Adding/removing columns to existing tables
- Creating new tables or indexes
- Modifying column types or constraints
- Adding foreign keys or triggers
- Partitioning existing tables
- Data migrations or backfills

**Trigger phrases:**
- "Add a new column to enriched_editions"
- "Create an index on the title column"
- "Migrate external_ids from array to new table"
- "Add a foreign key constraint"
- "Partition the enrichment_log table"

## Workflow

This skill automatically:
1. **Validates database connection** (via pre-hook)
2. **Activates postgres-optimizer agent** for expert guidance
3. **Loads planning-with-files** for structured execution
4. **Creates migration plan files** (task_plan.md, findings.md, progress.md)
5. **Tests in psql FIRST** before Worker code changes
6. **Validates post-migration** (via post-hook)

## Migration Checklist

### Phase 1: Planning (Required)
- [ ] Document current schema state
- [ ] Design migration SQL (CREATE, ALTER, DROP statements)
- [ ] Identify affected queries and endpoints
- [ ] Plan zero-downtime approach (if needed)
- [ ] Estimate migration duration for large tables
- [ ] Update TypeScript types/schemas

### Phase 2: Testing (Required)
- [ ] Test migration SQL in psql against dev database
- [ ] Verify EXPLAIN ANALYZE for affected queries
- [ ] Check index usage with pg_stat_user_indexes
- [ ] Run sample queries to validate behavior
- [ ] Test rollback procedure (if applicable)

### Phase 3: Implementation
- [ ] Execute migration SQL on production
- [ ] Update Worker code (routes, services, schemas)
- [ ] Update Zod validation schemas
- [ ] Deploy Worker with new code
- [ ] Monitor query performance

### Phase 4: Validation
- [ ] Run db-check.sh to verify health
- [ ] Check query performance metrics
- [ ] Validate data integrity
- [ ] Update documentation

## Alexandria-Specific Patterns

### Pattern 1: Adding Column to enriched_* tables

**Files to check:**
- `worker/src/schemas/` - Zod schemas
- `worker/src/services/enrichment.ts` - Enrichment logic
- `worker/src/routes/api/` - Endpoint handlers

**SQL Template:**
```sql
-- Add column with default (safe for existing rows)
ALTER TABLE enriched_editions
ADD COLUMN new_column_name data_type DEFAULT default_value;

-- Create index if needed for queries
CREATE INDEX CONCURRENTLY idx_enriched_editions_new_column
ON enriched_editions(new_column_name);

-- Analyze for query planner
ANALYZE enriched_editions;
```

**TypeScript Update:**
```typescript
// Update Zod schema in worker/src/schemas/
export const EnrichedEditionSchema = z.object({
  // ... existing fields
  new_column_name: z.string().optional(),
});
```

### Pattern 2: Creating New Table

**Files to check:**
- `docs/database/SCHEMA.md` - Documentation
- `worker/src/services/` - Business logic

**SQL Template:**
```sql
-- Create table with proper constraints
CREATE TABLE new_table_name (
  id BIGSERIAL PRIMARY KEY,
  -- columns here
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_new_table_lookup ON new_table_name(lookup_column);

-- Add foreign keys (if applicable)
ALTER TABLE new_table_name
ADD CONSTRAINT fk_new_table_ref
FOREIGN KEY (ref_id) REFERENCES other_table(id);

-- Grant permissions (if needed)
GRANT SELECT ON new_table_name TO readonly_user;
```

### Pattern 3: Data Migration (Large Tables)

**For tables with millions of rows:**

```sql
-- Option 1: Batched updates (for populated columns)
DO $$
DECLARE
  batch_size INT := 10000;
  offset_val INT := 0;
BEGIN
  LOOP
    UPDATE target_table
    SET new_column = derived_value
    WHERE id IN (
      SELECT id FROM target_table
      WHERE new_column IS NULL
      ORDER BY id
      LIMIT batch_size
      OFFSET offset_val
    );

    IF NOT FOUND THEN EXIT; END IF;
    offset_val := offset_val + batch_size;
    COMMIT; -- Release locks between batches
  END LOOP;
END $$;

-- Option 2: Background queue-based migration
-- Use alexandria-backfill-queue for async processing
```

### Pattern 4: Index Management

**Check existing indexes:**
```sql
-- Find unused indexes
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find duplicate indexes
SELECT pg_size_pretty(SUM(pg_relation_size(idx))::BIGINT) AS size,
       (array_agg(idx))[1] AS idx1, (array_agg(idx))[2] AS idx2,
       (array_agg(idx))[3] AS idx3, (array_agg(idx))[4] AS idx4
FROM (
    SELECT indexrelid::regclass AS idx, indrelid,
           (indrelid::text ||E'\n'|| indclass::text ||E'\n'||
            indkey::text ||E'\n'||
            COALESCE(indexprs::text,'')||E'\n' ||
            COALESCE(indpred::text,'')) AS key
    FROM pg_index
) sub
GROUP BY indrelid, key
HAVING COUNT(*)>1
ORDER BY SUM(pg_relation_size(idx)) DESC;
```

**Add index with CONCURRENTLY:**
```sql
-- Safe for production (doesn't lock table)
CREATE INDEX CONCURRENTLY idx_name ON table_name(column_name);

-- Drop unused indexes
DROP INDEX CONCURRENTLY idx_name;
```

## Safety Guidelines

### DO:
- **Always test in psql first** - Never write Worker code before validating SQL
- **Use CREATE INDEX CONCURRENTLY** - Prevents table locks in production
- **Add columns with DEFAULT** - Safe for existing rows
- **Run ANALYZE after schema changes** - Updates query planner statistics
- **Check EXPLAIN ANALYZE** - Validate performance impact
- **Document in docs/database/** - Keep schema docs current

### DON'T:
- **Never ALTER TYPE on large tables** - Requires table rewrite (downtime)
- **Avoid NOT NULL on existing columns** - Requires full table scan
- **Don't DROP columns immediately** - Deprecate first, drop later
- **Never skip ANALYZE** - Query planner needs fresh stats
- **Don't guess at index strategy** - Profile first with EXPLAIN
- **Avoid foreign keys on large tables** - High lock contention

## Zero-Downtime Strategies

### Strategy 1: Add Column with Default
Safe for most cases - no downtime required.

### Strategy 2: Deprecate Then Remove
1. Deploy Worker code that ignores old column
2. Wait 24 hours
3. Drop column (no active references)

### Strategy 3: Shadow Table Pattern
1. Create new table with desired schema
2. Dual-write to both tables
3. Backfill historical data
4. Switch reads to new table
5. Drop old table

### Strategy 4: Read-Only Deployment Window
For risky migrations:
1. Set Worker to read-only mode
2. Execute migration
3. Deploy new code
4. Re-enable writes

## Example: External ID Resolution Migration

**Task:** Migrate external_ids from JSONB arrays to external_id_mappings table

**Planning (from Issue #155):**
```markdown
# task_plan.md

## Context
External IDs currently stored as arrays in enriched_* tables.
Need bidirectional crosswalk for API integrations.

## Steps
1. [x] Create external_id_mappings table (partitioned by entity_type)
2. [x] Add indexes for forward and reverse lookups
3. [x] Implement lazy backfill from arrays on first access
4. [x] Add forward lookup endpoint
5. [x] Add reverse lookup endpoint
6. [x] Use ON CONFLICT DO NOTHING for concurrent safety
7. [x] Deploy and monitor

## Zero-Downtime Approach
- Lazy backfill: populate on-demand, no blocking migration
- Arrays remain source of truth
- Crosswalk is derived cache with fallback to arrays
```

**SQL (tested in psql first):**
```sql
-- Create partitioned table
CREATE TABLE external_id_mappings (
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_key, provider)
) PARTITION BY LIST (entity_type);

-- Create partitions
CREATE TABLE external_id_mappings_edition
PARTITION OF external_id_mappings FOR VALUES IN ('edition');

CREATE TABLE external_id_mappings_work
PARTITION OF external_id_mappings FOR VALUES IN ('work');

CREATE TABLE external_id_mappings_author
PARTITION OF external_id_mappings FOR VALUES IN ('author');

-- Indexes for reverse lookup
CREATE INDEX idx_external_id_mappings_reverse
ON external_id_mappings(provider, external_id, entity_type);
```

**Result:** Deployed in 4 hours, zero downtime, 95%+ hit rate after 30 days

## Integration with Queue System

For large-scale data migrations, use Alexandria's queue system:

```typescript
// Enqueue migration batches
await env.BACKFILL_QUEUE.send({
  type: 'schema_migration',
  operation: 'backfill_external_ids',
  batch_size: 1000,
  entity_type: 'edition'
});
```

## Monitoring & Validation

**Check migration progress:**
```sql
-- Row counts
SELECT COUNT(*) FROM new_table;

-- Index usage
SELECT * FROM pg_stat_user_indexes WHERE tablename = 'new_table';

-- Table size
SELECT pg_size_pretty(pg_total_relation_size('new_table'));

-- Active queries
SELECT pid, query, state, wait_event_type
FROM pg_stat_activity
WHERE datname = 'openlibrary' AND state != 'idle';
```

**Performance validation:**
```bash
# Run performance checks
./scripts/perf-check.sh

# Check query times
./scripts/db-query.sh "EXPLAIN ANALYZE SELECT ..."
```

## Best Practices Summary

1. **Plan systematically** - Use planning-with-files for all schema changes
2. **Test in isolation** - psql first, Worker code second
3. **Deploy incrementally** - Small changes, frequent deploys
4. **Monitor actively** - Watch query performance post-migration
5. **Document thoroughly** - Update docs/database/ and CLAUDE.md
6. **Validate continuously** - Use db-check.sh after changes

---

**Last Updated:** January 10, 2026
**Maintained By:** Alexandria AI Team
**Related Skills:** planning-with-files, postgres-optimizer agent
**Pre-requisite:** Working SSH access to Tower.local PostgreSQL
