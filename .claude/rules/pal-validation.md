# PAL MCP Validation Requirements

## When to Use PAL MCP Tools

### Post-Implementation Validation (REQUIRED)

**After ANY complex change (>3 files touched):**
- `mcp__pal__codereview` - Code quality, bugs, patterns, optimization
- `mcp__pal__precommit` - Git diff analysis, risk assessment, completeness

**After security-sensitive changes:**
- `mcp__pal__secaudit` - OWASP Top 10, SQL injection, API key exposure
- Focus on **real risks**: Leaked credentials, SQL injection, XSS
- Skip security theater: Lone dev fun project doesn't need SOC2 compliance

**For architectural decisions:**
- `mcp__pal__consensus` - Multi-model validation with Gemini, Grok, etc.
- Use for complex trade-offs, not simple feature additions

### Investigation Tools (During Work)

**Deep debugging:**
- `mcp__pal__debug` - Root cause analysis for mysterious bugs

**Performance mysteries:**
- `mcp__pal__thinkdeep` - Systematic investigation with expert validation

## Validation Workflow

```
Subagent completes work
    ↓
[1] Review output personally
    ↓
[2] If simple → Accept
[3] If complex → mcp__pal__codereview
[4] If critical → mcp__pal__consensus
    ↓
[5] Document PAL findings in findings.md
    ↓
[6] Fix issues raised by PAL (prioritize real risks)
    ↓
[7] Re-validate if major changes made
    ↓
[8] Accept to repo only after validation passes
```

## Pragmatic Validation for Solo Dev

**Family fun project means:**
- ✅ Focus on bugs, data loss, credential leaks
- ✅ Performance matters (user experience)
- ✅ Maintainability matters (solo dev must understand it later)
- ❌ Skip theoretical security issues with no attack vector
- ❌ Skip over-engineered abstractions
- ❌ Skip enterprise patterns unless clearly beneficial

**PAL review should flag:**
- 🔴 **Critical:** Data loss, credential leaks, breaking changes, SQL injection
- 🟡 **Important:** Performance regressions, hard-to-maintain code, real bugs
- 🟢 **Nice-to-have:** Style improvements, theoretical optimizations, enterprise patterns
- ⚪ **Ignore:** Security theater, premature abstractions, over-engineering

**When PAL suggests enterprise patterns:**
- Evaluate: "Is this worth the complexity for a solo dev fun project?"
- Often the answer is: "Not yet - ship it simple, refactor if needed"

## Forbidden Shortcuts

**I MUST NOT:**
- ❌ Accept complex subagent work without PAL validation
- ❌ Skip `mcp__pal__precommit` before git commits
- ❌ Ignore PAL findings without documented justification
- ❌ Use `mcp__pal__planner` for implementation planning
- ❌ Implement every PAL suggestion without critical thinking

## Model Selection for PAL

**Default (auto-select mode):**
- PAL will choose best model automatically

**Manual override (when needed):**
- Use `model` parameter to specify Gemini, Grok, etc.
- For consensus, always use 2+ different model families
