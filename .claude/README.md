# Claude Code Configuration for Alexandria

This directory contains Claude Code configuration files that enhance the development experience for the Alexandria project.

## Directory Structure

```
.claude/
├── README.md                          # This file
├── settings.json                      # Project-wide settings
├── agents/                            # Specialized AI agents
│   ├── cloudflare-workers-optimizer.md
│   └── postgres-optimizer.md
├── commands/                          # Slash commands
│   ├── db-query.md
│   ├── deploy-check.md
│   ├── enrich-status.md
│   ├── perf-check.md
│   ├── queue-status.md
│   └── verify-infra.md
├── hooks/                             # Claude Code hooks
│   └── pre-commit.sh
├── prompts/                           # Reusable prompts (legacy, prefer skills)
│   ├── add-endpoint.md
│   └── optimize-query.md
├── rules/                             # Auto-loaded context rules (NEW in 2.0.64)
│   ├── database.md                    # Database-specific rules
│   ├── workers.md                     # Cloudflare Workers rules
│   └── security.md                    # Security enforcement rules
└── tdd-guide.md                       # Testing guidelines
```

## Settings

### Permissions
The following files are denied from Claude Code access for security:
- `docs/CREDENTIALS.md` - Contains passwords and API keys
- `.env` files - Environment variables
- `**/*.key`, `**/*.pem`, `**/*.crt` - Certificate files

### MCP Servers
- **pal** - Advanced AI capabilities (chat, thinkdeep, planner, consensus, debug, codereview, precommit)
- **ios-simulator** - iOS simulator control (useful for bendv3 mobile testing)

### Attribution (NEW in 2.0.62)
Customized commit and PR bylines with project-specific format.

### Hooks
See **Hooks** section below for complete hook configuration.

## Agents

Agents can be invoked automatically based on context, or manually via `@agent-name`.

### cloudflare-workers-optimizer
Specialized agent for Cloudflare Workers optimization on paid plans.

**Frontmatter features:**
- `model: sonnet` - Uses Sonnet for complex reasoning
- `permissionMode: default` - Standard permission handling
- `disallowedTools: [WebSearch]` - Prevents external web searches
- `skills: [optimize-query]` - Auto-loads query optimization skill

**When to use:**
- Reviewing wrangler.jsonc configuration
- Optimizing Worker performance
- Debugging Workers issues
- Understanding billing and limits
- Working with Durable Objects, KV, R2, D1, Queues

### postgres-optimizer
PostgreSQL database optimization expert.

**Frontmatter features:**
- `model: sonnet` - Uses Sonnet for analysis
- `permissionMode: default` - Standard permission handling
- `disallowedTools: [WebSearch]` - Prevents external web searches
- `skills: [optimize-query, db-query]` - Auto-loads DB skills

**When to use:**
- Optimizing slow queries
- Reviewing indexes
- Analyzing execution plans
- Schema design improvements
- Database maintenance tasks

## Slash Commands

All commands support model specification in frontmatter (NEW in 1.0.57).

### Infrastructure Commands

#### `/verify-infra`
Comprehensive infrastructure health check.
- `model: haiku` - Fast, efficient execution
- Checks: Tunnel status, database connectivity, Worker deployment

#### `/db-query`
Test PostgreSQL queries via SSH before implementing in Worker.
- `argument-hint: SQL query to execute` - Shows usage hint
- Always use parameterized queries in Worker code

#### `/deploy-check`
Full deployment workflow with pre/post validation.
- `model: sonnet` - Uses deeper reasoning for deployment
- Triggers thinking mode for risk analysis
- Pre-checks, deployment, live verification

#### `/enrich-status`
Check enriched tables status and recent activity.
- `model: haiku` - Quick status checks
- Row counts, recent enrichments, index health

#### `/queue-status`
Monitor Cloudflare Queue activity.
- `model: haiku` - Fast queue inspection
- Queue list, consumer configs, DLQ status

#### `/perf-check`
Performance benchmarks for API endpoints.
- `model: haiku` - Efficient benchmark execution
- Triggers thinking for performance analysis
- Health, ISBN, title, author, and cover endpoints

## Hooks (Updated for 2.0.65)

Claude Code hooks enable automatic actions on specific events.

### Configured Hooks

| Event | Matcher | Action |
|-------|---------|--------|
| `PreToolUse` | `git commit` | Runs pre-commit.sh validation |
| `SessionStart` | (all) | Displays welcome message |
| `SessionEnd` | (all) | Displays goodbye message |
| `SubagentStart` | (all) | Notifies subagent launch |
| `SubagentStop` | (all) | Notifies subagent completion |
| `PermissionRequest` | `Bash(./scripts/*)` | Auto-allows project scripts |

### Available Hook Events (2.0.65)

- **PreToolUse** - Before tool execution (can modify inputs)
- **PostToolUse** - After tool execution
- **Stop** - When main agent stops
- **SubagentStart** - When subagent starts (includes agent_id)
- **SubagentStop** - When subagent finishes (includes agent_id, transcript_path)
- **SessionStart** - When new session begins
- **SessionEnd** - When session ends (supports systemMessage)
- **PreCompact** - Before conversation compaction
- **Notification** - For notification events
- **PermissionRequest** - Auto-approve/deny permission requests
- **UserPromptSubmit** - On user prompt submission (supports additionalContext)

### Hook Environment Variables

Available in hook commands (since 2.0.54):
- `CLAUDE_PROJECT_DIR` - The project directory
- `hook_event_name` - The event that triggered this hook

## Rules (NEW in 2.0.64)

The `.claude/rules/` directory contains context rules that are automatically loaded:

### database.md
- Query guidelines and performance targets
- Table reference with row counts
- pg_trgm fuzzy search patterns

### workers.md
- Worker code guidelines and patterns
- Bindings reference
- ISBNdb Premium configuration
- Security checklist

### security.md
- Files to never commit
- API key handling
- Cover URL whitelist
- Access control configuration

## Prompts (Legacy)

Prompts in `.claude/prompts/` provide reusable workflows. Consider migrating to skills for better integration.

### optimize-query.md
Structured workflow for PostgreSQL query optimization.

### add-endpoint.md
Step-by-step guide for adding new API endpoints.

## Named Sessions (NEW in 2.0.64)

Use named sessions to organize your work:
- `/rename` - Name the current session
- `/resume <name>` - Resume a named session
- `claude --resume <name>` - Resume from terminal

## Best Practices

### Before Every Code Change
1. Run `/verify-infra` to ensure infrastructure is healthy
2. Use `/db-query` to test SQL queries
3. Test locally with `npm run dev`
4. Deploy with `/deploy-check`
5. Verify with `/perf-check`

### When Optimizing Database Queries
1. Use `/db-query` with EXPLAIN ANALYZE
2. Reference `optimize-query.md` prompt
3. Use `@postgres-optimizer` agent for complex cases
4. Test with realistic data volumes (50M+ rows)

### When Adding New Features
1. Reference `add-endpoint.md` for API changes
2. Use `@cloudflare-workers-optimizer` for Workers-specific features
3. Update CLAUDE.md with new endpoints/features
4. Add tests to tdd-guide.md if establishing new patterns

## Troubleshooting

### Hooks Not Running
Ensure hooks are executable:
```bash
chmod +x .claude/hooks/*.sh
```

### Slash Commands Not Appearing
Commands must have the `description:` frontmatter field to appear in the command list.

### Agent Not Activating
Agents activate automatically based on context. You can also explicitly invoke them using `@agent-name`.

### Rules Not Loading
Rules in `.claude/rules/` are automatically loaded. Ensure files are valid markdown.

## Version Information

- **Claude Code Version:** 2.0.65
- **Key Features Used:**
  - Custom agents with model specification and skills
  - Slash commands with model and thinking triggers
  - Rules directory for automatic context loading
  - Named session support
  - MCP server integrations
  - Pre-commit hooks for safety
  - PermissionRequest hooks for auto-approval
  - Session lifecycle hooks
  - Subagent tracking hooks
  - Attribution settings for commits

## New in Claude Code 2.0.62-2.0.65

### v2.0.65
- Switch models while writing prompt (alt+p / option+p)
- Context window information in status line
- `fileSuggestion` setting for custom file search
- `CLAUDE_CODE_SHELL` environment variable

### v2.0.64
- **Rules directory** (`.claude/rules/`) for automatic context
- **Named sessions** - `/rename` and `/resume <name>`
- Async agents and bash commands with wake-up messages
- `/stats` command for usage statistics
- Instant auto-compacting
- Unified TaskOutputTool

### v2.0.62
- **Attribution setting** - Customize commit/PR bylines
- "(Recommended)" indicator in multiple-choice questions
- Fixed duplicate slash commands
- Fixed symlinked skill directories

## Contributing

When adding new Claude Code configurations:

1. **Commands** - Add to `.claude/commands/` with clear description and model
2. **Agents** - Add to `.claude/agents/` with usage examples, skills, and permissions
3. **Rules** - Add to `.claude/rules/` for automatic context loading
4. **Hooks** - Add to `.claude/hooks/` and make executable
5. **Update this README** - Keep documentation current

## Resources

- [Claude Code Documentation](https://code.claude.com/docs)
- [Hooks Documentation](https://code.claude.com/docs/en/hooks)
- [Memory & Rules](https://code.claude.com/docs/en/memory)
- [Alexandria CLAUDE.md](../CLAUDE.md) - Main project documentation
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
