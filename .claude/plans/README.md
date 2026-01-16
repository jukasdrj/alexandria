# Alexandria Planning Files

This directory stores planning files for complex tasks using Claude Code's native plan mode.

## Directory Structure

```
.claude/plans/
├── README.md              # This file
├── SETUP.md              # Configuration documentation
└── [plan files]          # Created during sessions (ignored by git)
```

## Configuration

This directory is configured in `.claude/settings.json`:
```json
{
  "plansDirectory": ".claude/plans"
}
```

## When to Use Planning

Use planning for:
- Multi-step tasks (3+ steps)
- Research tasks
- Database schema changes
- API integration work
- Tasks spanning many tool calls
- Anything requiring organization

Skip for:
- Simple questions
- Single-file edits
- Quick lookups
- Status checks

## Planning Workflow

### Native Claude Code Plan Mode
When you use plan mode, Claude will create plan files here automatically:
- Files are stored in `.claude/plans/`
- Ignored by git (except documentation)
- Organized and searchable

### Specialized Skills (Recommended)
Alexandria provides domain-specific skills that include planning:
- **`/schema-migration`** - Database changes (auto-loads planning-with-files)
- **`/api-integration`** - External API providers (auto-loads planning-with-files)
- **`/queue-optimization`** - Queue tuning (auto-loads planning-with-files)
- **`/planning-with-files`** - Manual planning for any complex task

**Skills automatically:**
1. Create planning files (task_plan.md, findings.md, progress.md)
2. Load appropriate expert agents (postgres-optimizer, cloudflare-workers-optimizer)
3. Execute validation hooks (db-check.sh, queue-status)
4. Run in isolated forked contexts (when configured)

## Planning File Types

### Native Plan Mode Files
Created automatically by Claude Code when using plan mode:
- Plan structure defined by Claude
- Stored in this directory
- Session-specific, not committed

### Skill-Based Planning Files
Created by `/planning-with-files` skill and domain skills:
- **task_plan.md** - Phase tracking and decisions
- **findings.md** - Research and discoveries
- **progress.md** - Session logging and test results

These files are created in the **project root** by design (better visibility in file tree).

## Best Practices

1. **Use skills for domain work** - They include planning automatically
2. **Update findings immediately** - After any discovery or decision
3. **Log errors** - Build knowledge, prevent repetition
4. **Test first** - Always validate queries in psql before Worker implementation
5. **Read before decide** - Refresh goals in attention window

## Project Context

**Alexandria is a book metadata service** with 54M+ editions:
- Database: PostgreSQL (54.8M editions, 40.1M works, 14.7M authors)
- Infrastructure: Cloudflare Workers + Hyperdrive + R2
- Data sources: OpenLibrary (primary), ISBNdb, Google Books, Archive.org, Wikidata
- Features: Search, enrichment, covers, ISBN resolution, backfill

When planning:
- Database is read-only (OpenLibrary is source of truth)
- Test queries in psql first
- Use specialized skills for domain tasks
- Consider quota limits (ISBNdb, API rate limits)
- Check queue architecture for async operations

## Related Documentation

- **Skills:** `.claude/skills/` - Domain-specific skills with auto-planning
- **Agents:** `.claude/agents/` - postgres-optimizer, cloudflare-workers-optimizer
- **Project Guide:** `CLAUDE.md` - Complete Alexandria documentation
- **Docs Index:** `docs/INDEX.md` - All documentation navigation

## Related

- **Skills:** `.claude/skills/` - Auto-load planning for domain tasks
- **Claude Code Feature:** Native plans directory (v2.1.9+)
- **Project Guide:** `CLAUDE.md` - Alexandria documentation

---

**Last Updated:** January 16, 2026
**Maintained By:** AI Team
