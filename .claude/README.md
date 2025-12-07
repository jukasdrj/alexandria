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
├── hooks/                             # Git hooks
│   └── pre-commit.sh
├── prompts/                           # Reusable prompts
│   ├── add-endpoint.md
│   └── optimize-query.md
└── tdd-guide.md                       # Testing guidelines

```

## Settings

### Permissions
The following files are denied from Claude Code access for security:
- `docs/CREDENTIALS.md` - Contains passwords and API keys
- `.env` files - Environment variables
- `**/*.key`, `**/*.pem`, `**/*.crt` - Certificate files

### MCP Servers
- **zen** - Advanced AI capabilities (chat, thinkdeep, planner, consensus, debug, codereview, precommit)
- **ios-simulator** - iOS simulator control (useful for bendv3 mobile testing)

### Hooks
- **pre-commit** - Validates no secrets are being committed, runs TypeScript checks

## Agents

### cloudflare-workers-optimizer
Specialized agent for Cloudflare Workers optimization on paid plans.

**When to use:**
- Reviewing wrangler.jsonc configuration
- Optimizing Worker performance
- Debugging Workers issues
- Understanding billing and limits
- Working with Durable Objects, KV, R2, D1, Queues

**Usage:** This agent is automatically invoked when working with Workers-specific code.

### postgres-optimizer
PostgreSQL database optimization expert with enthusiasm for database performance.

**When to use:**
- Optimizing slow queries
- Reviewing indexes
- Analyzing execution plans
- Schema design improvements
- Database maintenance tasks

**Usage:** Automatically invoked when working with database queries or schema.

## Slash Commands

### Infrastructure Commands

#### `/verify-infra`
Comprehensive infrastructure health check:
- Tunnel status (4 connections expected)
- Database connectivity
- Worker deployment status

#### `/db-query`
Test PostgreSQL queries via SSH before implementing in Worker.
Always use this to validate queries before adding to production code.

#### `/deploy-check`
Full deployment workflow with pre/post validation:
- Infrastructure verification
- Local testing prompts
- Deployment execution
- Live endpoint testing

#### `/enrich-status` (NEW)
Check enriched tables status:
- Row counts for enriched_works, enriched_editions, enriched_authors
- Index sizes and health
- Statistics analysis timestamps

#### `/queue-status` (NEW)
Monitor Cloudflare Queue activity:
- Queue list and consumer configurations
- Recent processing activity
- Dead letter queue status

#### `/perf-check` (NEW)
Performance benchmarks for API endpoints:
- Health endpoint
- ISBN search (indexed)
- Title search (trigram fuzzy)
- Author search (joins)
- Cover image serving

## Prompts

### Optimize Query
Structured workflow for PostgreSQL query optimization:
1. EXPLAIN ANALYZE execution
2. Index analysis
3. Rewrite suggestions
4. Performance estimates

**Usage:** Reference when optimizing database queries.

### Add Endpoint
Step-by-step guide for adding new API endpoints:
1. Database query testing
2. Implementation pattern (Hono + TypeScript)
3. Caching strategy
4. Security checklist

**Usage:** Reference when adding new API routes to the Worker.

## TDD Guide

Comprehensive testing philosophy for Alexandria:
- Test queries in psql BEFORE Worker implementation
- Local testing with `npm run dev`
- Integration testing checklist
- Performance targets

## Version Information

- **Claude Code Version:** 2.0.60
- **Key Features Used:**
  - Custom agents with model specification
  - MCP server integrations
  - Slash commands for workflows
  - Pre-commit hooks for safety
  - Background agent support (NEW in 2.0.60)

## New in Claude Code 2.0.59-60

### Agent System
The `agent` setting in settings.json can override the main thread agent. We currently use default agent but can switch to specialized agents per session.

### Background Agents
Agents can now run in the background while you work. Useful for long-running tasks like database migrations or comprehensive code reviews.

### MCP Server Management
Use `/mcp enable [server]` or `/mcp disable [server]` to toggle MCP servers on the fly.

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
3. Consider postgres-optimizer agent for complex cases
4. Test with realistic data volumes (50M+ rows)

### When Adding New Features
1. Reference `add-endpoint.md` for API changes
2. Use cloudflare-workers-optimizer for Workers-specific features
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
Agents activate automatically based on context. You can also explicitly call them using the Task tool with the appropriate subagent_type.

## Contributing

When adding new Claude Code configurations:

1. **Commands** - Add to `.claude/commands/` with clear description
2. **Agents** - Add to `.claude/agents/` with usage examples
3. **Prompts** - Add to `.claude/prompts/` for reusable workflows
4. **Hooks** - Add to `.claude/hooks/` and make executable
5. **Update this README** - Keep documentation current

## Resources

- [Claude Code Documentation](https://claude.com/claude-code)
- [Alexandria CLAUDE.md](../CLAUDE.md) - Main project documentation
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
