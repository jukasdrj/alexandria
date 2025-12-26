---
description: Analyze and optimize a PostgreSQL query for Alexandria
allowed-tools:
  - Read
  - Grep
  - Bash
  - Skill
---

You are optimizing a PostgreSQL query for the Alexandria database (54M+ editions).

## Context
- PostgreSQL 18 with pg_trgm extension
- Tables: editions (54.8M), works (40.1M), authors (14.7M), enriched_* tables
- Indexes: GIN trigram indexes on titles/names, standard B-tree on keys
- Hyperdrive connection pooling enabled

## Process

1. **Ask for the query** - Get the SQL query to optimize

2. **Run EXPLAIN ANALYZE** via /db-query:
   ```sql
   EXPLAIN ANALYZE [user's query]
   ```

3. **Analyze execution plan**:
   - Sequential scans on large tables? → Needs index
   - High cost estimates? → Poor selectivity
   - Nested loops on large sets? → Consider hash joins
   - Sort operations? → Consider index ordering

4. **Check indexes**:
   ```sql
   SELECT * FROM pg_indexes WHERE tablename = '[table]';
   ```

5. **Provide optimizations**:
   - Suggest index additions
   - Rewrite query if needed
   - Consider enriched_* tables for better performance
   - Use LIMIT strategically
   - Leverage pg_trgm for fuzzy searches

6. **Estimate improvement** - Expected speedup

## Remember
- Always test in psql before implementing in Worker
- Consider read vs write trade-offs
- Account for 50M+ row scale
