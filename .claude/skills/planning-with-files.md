# Planning With Files Skill

**Purpose:** Structured file-based planning for complex Alexandria tasks
**Status:** Production-ready (proven in BooksTrack)
**Updated:** January 9, 2026

## When to Use

**REQUIRED for tasks involving:**
- Multi-file changes (>3 files)
- Database schema modifications
- Queue architecture changes
- External API integrations (ISBNdb, Google Books, Gemini)
- Performance optimization work
- Data migration or backfill operations

**Example trigger phrases:**
- "Optimize the batch enrichment pipeline"
- "Add support for [new provider]"
- "Refactor the cover processing queue"
- "Implement external ID resolution"
- "Migrate metadata to new schema"

## How to Invoke

The skill activates when you recognize a complex, multi-step task. Create three files:

1. **`task_plan.md`** - Step-by-step implementation plan
2. **`findings.md`** - Research findings and context
3. **`progress.md`** - Real-time progress tracking

## File Templates

### task_plan.md
```markdown
# Task: [Task Name]

## Context
[What problem are we solving? Why?]

## Steps
1. [ ] Research current implementation
2. [ ] Design solution approach
3. [ ] Implement core changes
4. [ ] Add tests
5. [ ] Update documentation
6. [ ] Deploy and validate

## Risks
- [Risk 1]: [Mitigation strategy]
- [Risk 2]: [Mitigation strategy]

## Testing Strategy
- Unit: [What to test]
- Integration: [What to test]
- E2E: [What to test]

## Rollout Plan
- Phase 1: [Initial rollout]
- Phase 2: [Full deployment]
```

### findings.md
```markdown
# Findings: [Task Name]

## Current Implementation
- Files: [List of relevant files]
- Architecture: [Current approach]
- Dependencies: [What this depends on]

## Research Notes
[Date/Time] - [Finding]
- Key insight 1
- Key insight 2

## Decisions Made
[Date/Time] - [Decision]
- Rationale: [Why this approach]
- Alternatives considered: [Other options]

## Blockers/Questions
- [ ] [Question/blocker 1]
- [x] [Resolved question]
```

### progress.md
```markdown
# Progress: [Task Name]

## Summary
- Status: [Not Started / In Progress / Completed]
- Started: [Date/Time]
- Last Updated: [Date/Time]
- Completion: [0-100%]

## Completed Steps
- [x] Step 1 - [Details]

## Current Work
- [~] Step 2 - [In progress details]

## Pending Steps
- [ ] Step 3
- [ ] Step 4

## Next Action
[What to do next]
```

## Workflow

### Phase 1: Planning (15-30 min)
1. Create all three planning files
2. Use Glob/Grep/Read to explore codebase
3. Document findings in `findings.md`
4. Design approach in `task_plan.md`
5. Initialize `progress.md` with step list

### Phase 2: Execution (1-4 hours)
1. Follow `task_plan.md` step-by-step
2. Update `progress.md` after each step
3. Log new findings/decisions in `findings.md`
4. Mark steps complete as you go

### Phase 3: Completion
1. Verify all steps complete
2. Run validation (tests, lint, deploy)
3. Archive planning files or delete

## Alexandria-Specific Patterns

### Pattern 1: Database Schema Changes
**Trigger:** "Add new column to enriched_editions"

**Planning checklist:**
- [ ] Research current schema (psql first!)
- [ ] Design migration SQL
- [ ] Plan zero-downtime deployment
- [ ] Identify affected queries
- [ ] Update TypeScript types
- [ ] Add tests for new column

**Files to check:**
- `worker/src/schemas/` - Zod schemas
- `worker/src/services/` - Business logic
- `docs/database/` - Schema docs

### Pattern 2: Queue Architecture Changes
**Trigger:** "Optimize cover queue processing"

**Planning checklist:**
- [ ] Profile current queue performance
- [ ] Identify bottlenecks (R2? ISBNdb? Processing?)
- [ ] Design optimization approach
- [ ] Update queue handler
- [ ] Adjust batch size/concurrency
- [ ] Add performance tests

**Files to check:**
- `worker/src/services/queue-handlers.ts`
- `worker/wrangler.jsonc` (queue config)
- `worker/src/services/cover-processor.ts`

### Pattern 3: External API Integration
**Trigger:** "Add LibraryThing API support"

**Planning checklist:**
- [ ] Research API (rate limits, auth, schema)
- [ ] Design client service
- [ ] Add to provider chain
- [ ] Implement circuit breaker
- [ ] Add normalization logic
- [ ] Update enrichment pipeline
- [ ] Add API cost tracking

**Files to check:**
- `worker/src/services/external-apis/`
- `worker/src/services/normalizers/`
- `worker/src/services/enrichment.ts`
- `worker/src/middleware/circuit-breaker.ts`

### Pattern 4: Performance Optimization
**Trigger:** "Speed up ISBN batch lookup"

**Planning checklist:**
- [ ] Profile current performance (Hyperdrive, query time)
- [ ] Analyze query plan (EXPLAIN ANALYZE)
- [ ] Check index usage
- [ ] Design optimization (query rewrite, caching, batching)
- [ ] Benchmark before/after
- [ ] Validate no regressions

**Files to check:**
- Database indexes
- `worker/src/routes/` - Endpoint handlers
- `worker/src/middleware/` - Caching layer

## Best Practices

### DO:
- **Always create planning files for multi-step tasks**
- **Update progress.md frequently** (after each major step)
- **Document decisions and rationale** in findings.md
- **Test in psql before Worker code** (database changes)
- **Profile before optimizing** (measure, don't guess)

### DON'T:
- **Skip planning for "quick fixes"** - They rarely stay quick
- **Commit planning files to git** - They're session-specific (gitignored)
- **Rush through steps** - Follow the plan systematically
- **Change database schema without migration plan**
- **Modify queue config without load testing**

## Success Metrics (BooksTrack Results)

After adopting this pattern, BooksTrack achieved:
- **0% regression rate** on complex changes
- **40% faster completion** (upfront planning saves debugging)
- **100% resumability** (can pause/resume multi-day tasks)
- **Zero surprise breaking changes**

## Integration with PAL MCP

**Planning-with-files complements PAL, doesn't replace it:**

- **Use planning-with-files for:** Structured multi-step work, implementation planning
- **Use PAL for:** Deep debugging, security audits, code review, consensus building

**When to combine:**
1. Create task_plan.md with planning-with-files
2. Use `mcp__pal__debug` to investigate complex bugs during execution
3. Use `mcp__pal__codereview` to validate completed changes
4. Document PAL findings in findings.md

## Examples from Alexandria

### Example 1: External ID Resolution (Issue #155)
```markdown
# task_plan.md

## Steps
1. [x] Research current external ID storage (arrays in enriched_* tables)
2. [x] Design external_id_mappings schema with partitioning
3. [x] Implement lazy backfill strategy
4. [x] Add forward lookup endpoint (GET /api/external-ids/:type/:key)
5. [x] Add reverse lookup endpoint (GET /api/resolve/:provider/:id)
6. [x] Add confidence scoring logic
7. [x] Implement concurrent-safe backfill (ON CONFLICT DO NOTHING)
8. [x] Add analytics tracking
9. [x] Deploy and validate

## Risks
- Race conditions: ON CONFLICT DO NOTHING handles concurrent backfills
- Performance: Lazy backfill adds 10-15ms one-time cost (acceptable)
- Consistency: Array columns remain source of truth, crosswalk is derived

## Testing
- Unit: Confidence scoring, provider parsing
- Integration: Lazy backfill logic, concurrent safety
- E2E: Full lookup → backfill → lookup cycle
```

**Result:** Completed in 4 hours, zero production issues, 95%+ hit rate after 30 days

### Example 2: Backfill Visibility Improvements
```markdown
# task_plan.md

## Context
Users confused when backfill returns "0 enrichments" (dedup working correctly)

## Steps
1. [x] Add already_enriched count to response
2. [x] Separate API call tracking (gemini_calls, isbndb_calls)
3. [x] Update logs to clarify dedup success
4. [x] Add model selection logic (monthly vs annual)
5. [x] Update documentation

## Risks
- Breaking changes: Response schema change (minor version bump)

## Testing
- Integration: Verify counts match expected behavior
- E2E: Test monthly vs annual backfill
```

**Result:** Completed in 1 hour, immediately clarified user confusion

## Next Steps

1. **Start using immediately** - Don't wait for perfect setup
2. **Iterate on templates** - Adjust to Alexandria's needs
3. **Share learnings with BooksTrack** - Cross-pollinate patterns
4. **Document Alexandria-specific patterns** - Add to this file

---

**Last Updated:** January 9, 2026
**Maintained By:** Alexandria AI Team
**Pattern Source:** BooksTrack (2+ months production use)
