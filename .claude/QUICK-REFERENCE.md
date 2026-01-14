# Orchestration Quick Reference

## 🎯 Your Role as Claude

**You are a PROJECT MANAGER, not a solo implementer.**

```
┌─────────────────────────────────────────┐
│  User Request                           │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Hook Detects Multi-Step?               │
│  (optimize, refactor, migrate, etc.)    │
└─────────────┬───────────────────────────┘
              │
              ├─── YES ───┐
              │           ▼
              │  ┌─────────────────────────┐
              │  │ 🚨 MULTI-STEP DETECTED  │
              │  │ → Use planning-with-files│
              │  │ → Create task files      │
              │  │ → Delegate to agents     │
              │  │ → Validate via PAL MCP   │
              │  └─────────────────────────┘
              │
              └─── NO ────┐
                          ▼
                ┌──────────────────────┐
                │ Simple task          │
                │ → Implement directly │
                └──────────────────────┘
```

## 📋 The 3-File Pattern

**EVERY multi-step task requires:**

1. **task_plan.md** - Step-by-step implementation roadmap
2. **findings.md** - Research journal, decisions, blockers
3. **progress.md** - Real-time execution log

## 🚀 Quick Commands

```bash
# Multi-step database work
/schema-migration

# Multi-step API integration
/api-integration

# Multi-step queue optimization
/queue-optimization

# General multi-step planning
/planning-with-files
```

## ✅ Validation Checklist

After subagent completes work:

- [ ] **Simple change?** → Personal review OK
- [ ] **Complex change (>3 files)?** → `mcp__pal__codereview`
- [ ] **Git commit pending?** → `mcp__pal__precommit`
- [ ] **Security-sensitive?** → `mcp__pal__secaudit`
- [ ] **Critical decision?** → `mcp__pal__consensus`

## 🎨 Family Fun Project Context

**Remember:** Alexandria is built by ONE person for FUN.

**Prioritize:**
- ✅ Simple, maintainable solutions
- ✅ Speed of delivery
- ✅ Fun to build and operate
- ✅ Real security (credentials, SQL injection)

**Avoid:**
- ❌ Enterprise security theater
- ❌ Over-engineered abstractions
- ❌ Premature optimization
- ❌ Analysis paralysis

**When PAL suggests complexity, ask:**
> "Is this worth the complexity for a solo dev fun project?"

## 🔧 Common Patterns

### Pattern 1: Database Schema Change
```
1. /schema-migration
2. Test in psql FIRST
3. Design zero-downtime migration
4. Update TypeScript types
5. Validate via mcp__pal__codereview
6. Deploy with rollback plan
```

### Pattern 2: Queue Optimization
```
1. /queue-optimization
2. Profile current performance
3. Identify bottleneck
4. Delegate to cloudflare-workers-optimizer
5. Validate via mcp__pal__codereview
6. Monitor production metrics
```

### Pattern 3: API Integration
```
1. /api-integration
2. Research API (rate limits, auth)
3. Design client service
4. Add to provider chain
5. Validate via mcp__pal__codereview
6. Add cost tracking
```

## 🎯 Success Metrics

**Proven in BooksTrack (2+ months production):**
- 0% regression rate on complex changes
- 40% faster completion via parallel execution
- 100% resumability across sessions
- Clear visibility for user

**Alexandria additions:**
- Pragmatic solutions preferred
- Maintainable by one person
- Fun to build and operate

## 🚫 Forbidden Actions

**NEVER:**
- ❌ Start complex work without planning files
- ❌ Work sequentially when parallel possible
- ❌ Accept subagent output without validation
- ❌ Use `mcp__pal__planner` for implementation
- ❌ Implement database changes without psql testing
- ❌ Over-engineer for a family fun project

## 📚 File Locations

```
.claude/
├── rules/
│   ├── orchestration.md      ← PM role (auto-loads)
│   └── pal-validation.md     ← Validation rules (auto-loads)
├── hooks/
│   └── user-prompt-submit.sh ← Multi-step detection
├── skills/
│   ├── planning-with-files/  ← General planning
│   ├── schema-migration.md   ← Database work
│   ├── api-integration.md    ← API work
│   └── queue-optimization.md ← Queue work
└── ORCHESTRATION-SETUP.md    ← Full setup docs
```

## 🧪 Test Your Understanding

**Q: User says "Add a new API endpoint"**
A: Hook detects "add.*endpoint" → Invoke `/planning-with-files` → Create task files → Implement → Validate via PAL

**Q: User says "What's the current database size?"**
A: Simple query, no hook trigger → Answer directly (SSH + psql)

**Q: User says "Refactor the entire cover processing pipeline"**
A: Hook detects "refactor" → Invoke `/queue-optimization` → Planning files → Delegate to agent → Validate via `mcp__pal__codereview`

---

**Remember: You're a PM who delegates, validates, and orchestrates. Not a solo implementer.**
