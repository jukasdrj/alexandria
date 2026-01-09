# Planning Workflow - Alexandria

**Quick reference for using the planning-with-files skill**
**Full guide:** `.claude/skills/planning-with-files.md`

## When to Use

**✅ USE planning-with-files for:**
- Database schema changes (>1 table)
- Queue architecture modifications
- External API integrations (new provider, auth changes)
- Performance optimization projects
- Data migration/backfill operations
- Multi-file refactoring (>3 files)
- Complex bug investigations
- Any task requiring >5 tool calls

**❌ DON'T use for:**
- Simple bug fixes (1-2 files)
- Documentation updates
- Configuration tweaks
- Quick endpoint additions

## How to Invoke

When you recognize a complex task, **immediately create** three planning files in the repo root:

```bash
# Alexandria repo root
task_plan.md     # The plan
findings.md      # Research notes
progress.md      # Progress tracker
```

These files are **gitignored automatically** - they're session-specific working documents.

## Quick Templates

### task_plan.md
```markdown
# Task: [Name]

## Context
[Problem, why solving]

## Steps
1. [ ] Research current implementation
2. [ ] Design approach
3. [ ] Implement changes
4. [ ] Test
5. [ ] Deploy

## Risks
- [Risk]: [Mitigation]

## Testing
- Unit: [What]
- Integration: [What]
```

### findings.md
```markdown
# Findings: [Name]

## Current Implementation
- Files: [List]
- Architecture: [Notes]

## Research Notes
[Timestamp] - [Finding]

## Decisions
[Timestamp] - [Decision + rationale]
```

### progress.md
```markdown
# Progress: [Name]

## Summary
- Status: In Progress
- Completion: 40%

## Completed
- [x] Step 1

## Current
- [~] Step 2

## Pending
- [ ] Step 3
```

## Workflow

1. **Create planning files** (all three at once)
2. **Research phase** (15-30 min)
   - Glob/Grep/Read codebase
   - Document in findings.md
   - Design in task_plan.md
3. **Execution phase** (1-4 hours)
   - Follow task_plan.md steps
   - Update progress.md frequently
   - Log decisions in findings.md
4. **Completion**
   - Validate all steps done
   - Deploy and test
   - Archive or delete planning files

## Alexandria-Specific Triggers

**Database:**
- "Add column to enriched_editions"
- "Optimize ISBN lookup query"
- "Migrate metadata schema"

**Queues:**
- "Optimize cover queue processing"
- "Add new queue handler"
- "Change batch size/concurrency"

**External APIs:**
- "Add [Provider] API support"
- "Update ISBNdb integration"
- "Optimize Gemini backfill"

**Performance:**
- "Speed up batch enrichment"
- "Reduce Hyperdrive latency"
- "Optimize R2 cover delivery"

## Integration with PAL MCP

**planning-with-files and PAL work together:**

- **Planning-with-files:** Structured implementation planning
- **PAL debug:** Deep debugging during execution
- **PAL codereview:** Validate completed changes
- **PAL secaudit:** Security review

**Example combined workflow:**
1. Create task_plan.md for "Optimize enrichment pipeline"
2. Use `mcp__pal__debug` to profile bottlenecks
3. Document findings in findings.md
4. Implement changes following task_plan.md
5. Use `mcp__pal__codereview` to validate
6. Document final approach in findings.md

## Examples from Production

### Example 1: External ID Resolution (#155)
- **Duration:** 4 hours
- **Files changed:** 6
- **Result:** Zero production issues, 95%+ hit rate

**Planning artifacts:**
- task_plan.md: 9 steps, risk analysis, testing strategy
- findings.md: Schema research, concurrent-safety decisions
- progress.md: Real-time tracking through all 9 steps

### Example 2: Backfill Visibility
- **Duration:** 1 hour
- **Files changed:** 3
- **Result:** Immediate user clarity improvement

**Planning artifacts:**
- task_plan.md: 5 steps, response schema changes
- findings.md: User confusion analysis, API design decisions
- progress.md: Quick iteration tracking

## Best Practices

**DO:**
- Create planning files immediately for multi-step work
- Update progress.md after each major step
- Document all decisions and rationale
- Test database changes in psql first
- Profile before optimizing

**DON'T:**
- Skip planning for "quick fixes" (they rarely stay quick)
- Commit planning files to git (auto-gitignored)
- Rush through steps without following the plan
- Change database schema without migration plan
- Modify queue config without load testing

## Success Metrics

**BooksTrack results (2+ months):**
- 0% regression rate on complex changes
- 40% faster task completion
- 100% resumability across sessions
- Zero surprise breaking changes

**Expected Alexandria benefits:**
- Safer database migrations
- Predictable API integration work
- Better cross-session resumability
- Clear progress visibility

---

**Last Updated:** January 9, 2026
**See also:** `.claude/skills/planning-with-files.md` (full guide)
**Pattern origin:** BooksTrack (proven at scale)
