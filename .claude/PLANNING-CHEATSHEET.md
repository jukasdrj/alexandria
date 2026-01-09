# Planning-with-Files Cheat Sheet

**Quick reference for Alexandria Claude Code**

---

## When to Use

✅ **USE planning-with-files when task involves:**
- >5 tool calls
- >3 files changed
- Database schema mods
- Queue config changes
- New API integrations
- Performance optimization
- Complex debugging

❌ **DON'T use for:**
- Simple bugs (1-2 files)
- Docs updates
- Config tweaks
- Quick fixes

---

## Instant Start

**Step 1:** Create three files in repo root:
```bash
task_plan.md
findings.md
progress.md
```

**Step 2:** Fill templates (see below)

**Step 3:** Follow the workflow:
1. Research (15-30 min) → findings.md
2. Plan (15-30 min) → task_plan.md
3. Execute (1-4 hours) → update progress.md
4. Complete → validate, deploy, archive

---

## Minimal Templates

### task_plan.md
```markdown
# Task: [Name]

## Steps
1. [ ] Step 1
2. [ ] Step 2
3. [ ] Step 3

## Risks
- [Risk]: [Mitigation]

## Testing
- Unit: [What]
- Integration: [What]
```

### findings.md
```markdown
# Findings: [Name]

## Research Notes
[Timestamp] - [Finding]

## Decisions
[Timestamp] - [Decision + why]

## Blockers
- [ ] [Question/blocker]
```

### progress.md
```markdown
# Progress: [Name]

## Status: In Progress (40%)

## Completed
- [x] Step 1

## Current
- [~] Step 2

## Pending
- [ ] Step 3
```

---

## Alexandria Triggers

**Database:**
- "Add column to enriched_editions"
- "Optimize ISBN query"
- "Migrate schema"

**Queues:**
- "Optimize cover queue"
- "Change batch size"
- "Add new handler"

**APIs:**
- "Add [Provider] support"
- "Update ISBNdb integration"
- "Optimize Gemini backfill"

**Performance:**
- "Speed up batch enrichment"
- "Reduce Hyperdrive latency"
- "Optimize R2 delivery"

---

## Workflow Checklist

- [ ] Create all three planning files
- [ ] Research codebase (Glob/Grep/Read)
- [ ] Document findings
- [ ] Design approach in task_plan.md
- [ ] Follow plan step-by-step
- [ ] Update progress.md after each step
- [ ] Log all decisions in findings.md
- [ ] Validate and test
- [ ] Deploy
- [ ] Archive or delete planning files

---

## Integration with PAL

**Use together:**
1. Create task_plan.md
2. Use `mcp__pal__debug` for deep investigation
3. Document findings
4. Implement following plan
5. Use `mcp__pal__codereview` to validate
6. Update progress.md

---

## Common Mistakes

❌ **Don't:**
- Skip planning for "quick fixes"
- Forget to update progress.md
- Commit planning files to git
- Rush through steps

✅ **Do:**
- Create planning files immediately
- Update progress frequently
- Document all decisions
- Test in psql first (DB work)
- Follow the plan systematically

---

**Full docs:** `.claude/skills/planning-with-files.md`
**Example:** `docs/PLANNING-EXAMPLE.md`
**Setup guide:** `PLANNING-SETUP-COMPLETE.md`
