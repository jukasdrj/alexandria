# Alexandria Documentation Index

**Last Updated:** January 5, 2026

> **Quick Start:** New to Alexandria? Start with [README.md](../README.md) → [CURRENT-STATUS.md](./CURRENT-STATUS.md) → [CLAUDE.md](../CLAUDE.md)

---

## 📋 Core Documentation

### Essential Reading
- **[../README.md](../README.md)** - Project overview and quick start
- **[../CLAUDE.md](../CLAUDE.md)** - Complete development guide (42KB, authoritative)
- **[../MASTER-TODO.md](../MASTER-TODO.md)** - Comprehensive todo list (task-centric view)
- **[CURRENT-STATUS.md](./CURRENT-STATUS.md)** - Active issues and priorities (P1/P2/P3)
- **[../TODO.md](../TODO.md)** - Development roadmap and phase tracking
- **[../CHANGELOG.md](../CHANGELOG.md)** - Version history

---

## 🔌 API Documentation

### Endpoints & Integration
- **[api/API-SEARCH-ENDPOINTS.md](./api/API-SEARCH-ENDPOINTS.md)** - Search API documentation (combined search with auto-detection)
- **[api/API-IDENTIFIER-RESOLUTION.md](./api/API-IDENTIFIER-RESOLUTION.md)** - VIAF/ISNI → Wikidata crosswalk endpoint
- **[api/ISBNDB-ENDPOINTS.md](./api/ISBNDB-ENDPOINTS.md)** - ISBNdb Premium API integration
- **[api/ISBNDB-ENRICHMENT.md](./api/ISBNDB-ENRICHMENT.md)** - Smart resolution pipeline

### OpenAPI Spec
- **Live:** https://alexandria.ooheynerds.com/openapi.json
- **Interactive Dashboard:** https://alexandria.ooheynerds.com/

---

## 🔐 Security

### Authentication & Access Control
- **[security/SECURITY-FINAL-SUMMARY.md](./security/SECURITY-FINAL-SUMMARY.md)** - 3-layer security architecture
- **[security/SECURITY-SETUP-COMPLETE.md](./security/SECURITY-SETUP-COMPLETE.md)** - Setup guide

**Security Model:**
1. **Cloudflare Edge** - WAF, Bot Fight Mode, DDoS protection
2. **Worker Application** - Rate limiting, input validation, security headers
3. **Database Layer** - Service Token auth, parameterized queries, read-only access

### Credentials
- **CREDENTIALS.md** (gitignored) - Passwords, API keys, tokens
- **CREDENTIALS-DOCKER.md** (gitignored) - Docker container credentials

---

## ⚙️ Operations

### Infrastructure
- **[infrastructure/INFRASTRUCTURE.md](./infrastructure/INFRASTRUCTURE.md)** - System architecture overview
- **[infrastructure/CLOUDFLARE-API-VS-WRANGLER.md](./infrastructure/CLOUDFLARE-API-VS-WRANGLER.md)** - API vs CLI management guide

### Monitoring & Logging
- **[operations/LOGPUSH-SETUP.md](./operations/LOGPUSH-SETUP.md)** - R2 log storage configuration
- **[operations/LOGPUSH-QUICKSTART.md](./operations/LOGPUSH-QUICKSTART.md)** - Quick reference
- **[operations/ISSUE-73-LOGPUSH-SUMMARY.md](./operations/ISSUE-73-LOGPUSH-SUMMARY.md)** - Logpush implementation details

### Incident Response
- **[operations/ISBNDB-403-BLOCKER-JAN2.md](./operations/ISBNDB-403-BLOCKER-JAN2.md)** - ISBNdb quota exhaustion (Jan 2, 2026)
- **[operations/SSH_MIGRATION_2025-12-27.md](./operations/SSH_MIGRATION_2025-12-27.md)** - SSH key migration

---

## 📚 Harvesting & Enrichment

### System Documentation
- **[QUEUE-ENRICHMENT-SYSTEM.md](./QUEUE-ENRICHMENT-SYSTEM.md)** - **⭐ Complete guide to queues, enrichment workflows, triggers, and monitoring** (NEW!)

### Active Systems
- **[harvesting/AUTHOR-DIVERSITY-ENRICHMENT-PLAN.md](./harvesting/AUTHOR-DIVERSITY-ENRICHMENT-PLAN.md)** - Wikidata enrichment strategy
- **[harvesting/BULK-HARVEST-FIX.md](./harvesting/BULK-HARVEST-FIX.md)** - Bulk author harvest fixes
- **[harvesting/QUEUE-OPTIMIZATION-DEC30.md](./harvesting/QUEUE-OPTIMIZATION-DEC30.md)** - Queue performance improvements
- **[harvesting/QUEUE-VALIDATION-JAN2.md](./harvesting/QUEUE-VALIDATION-JAN2.md)** - Validation results
- **[harvesting/ISSUE-84-WEBP-THRESHOLD.md](./harvesting/ISSUE-84-WEBP-THRESHOLD.md)** - WebP conversion optimization

### Scripts
- **../scripts/bulk-author-harvest.js** - Bulk ISBNdb author harvesting
- **../scripts/expand-author-bibliographies.js** - CSV-based enrichment
- **../scripts/e2e-workflow-test.js** - End-to-end pipeline validation

---

## 📖 Guides & References

### Development Guides
- **[guides/](./guides/)** - Step-by-step development guides
- **[reference/](./reference/)** - Technical reference materials

### Example Data
- **[csv_examples/](./csv_examples/)** - Sample CSV files for testing
  - `combined_library_expanded.csv` - 519 authors
  - `bestselling_authors_2015_2024.csv` - 197 fiction authors
  - `bestselling_nonfiction_authors.csv` - 199 nonfiction authors

---

## 📝 Planning & Strategy

### Active Planning Documents
- **[planning/DOCUMENTATION_HEALTH_REPORT.md](./planning/DOCUMENTATION_HEALTH_REPORT.md)** - Documentation audit (Jan 4, 2026)
- **[planning/AUTHOR-NORMALIZATION.md](./planning/AUTHOR-NORMALIZATION.md)** - Author deduplication strategy (Issue #114 - ⚠️ Pending DB Migration)
- **[planning/PLAN-CONTRACT-TESTING.md](./planning/PLAN-CONTRACT-TESTING.md)** - Cross-repo type safety plan

---

## 📦 Archive

### 2025 Documentation
- **[archive/2025/](./archive/2025/)** - Outdated/completed documentation
  - `ISSUE-114-SUMMARY.md` - Author normalization implementation summary
  - `HARVEST-TOP1000-DEC30.md` - Dec 2025 harvest run
  - `HARVESTING_TODOS.md` - Old harvesting checklist
  - `ALEXANDRIA_SCHEMA.md` - Legacy schema docs
  - `MASTER-PLAN.md` - Original project plan
  - `IMPLEMENTATION-PLANS.md` - Early implementation planning
  - `BENDV3-CLEANUP-NOTE.md` - bendv3 integration notes
  - `CROSS_REPO.md` - Cross-repo architecture (superseded by CLAUDE.md)
  - `MANUAL-STAGING-CHECKLIST.md` - Old deployment checklist
  - `TESTING-WEEK3-COMPLETION.md` - Testing milestone

---

## 🚀 Quick Reference Commands

### Development
```bash
cd worker/
npm run dev      # Local dev server (localhost:8787)
npm run deploy   # Deploy to Cloudflare
npm run tail     # Live Worker logs
npm run test     # Run vitest tests
```

### Infrastructure Checks
```bash
./scripts/tunnel-status.sh  # Check tunnel (expect 4 connections)
./scripts/db-check.sh        # Verify database + sample query
./scripts/deploy-worker.sh   # Deploy with validation
```

### Database Access
```bash
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"
```

### Monitoring
```bash
# Real-time logs
npm run tail

# ISBNdb quota
curl https://alexandria.ooheynerds.com/api/quota/status | jq

# Database stats
curl https://alexandria.ooheynerds.com/api/stats | jq

# Queue status
npx wrangler queues list | grep alexandria
```

---

## 🔍 Finding Documentation

### By Topic
- **API Integration** → `api/`
- **Security** → `security/`
- **Operations** → `operations/`
- **Harvesting** → `harvesting/`
- **Infrastructure** → `infrastructure/`
- **Planning & Strategy** → `planning/`
- **Archived** → `archive/2025/`

### By Task
- **Setting up locally** → README.md, CLAUDE.md
- **Adding API endpoints** → CLAUDE.md (Code Patterns section)
- **Debugging issues** → CURRENT-STATUS.md, operations/
- **Understanding architecture** → CLAUDE.md, infrastructure/INFRASTRUCTURE.md
- **Harvesting data** → harvesting/, scripts/

### By Priority
- **P1 Issues** → CURRENT-STATUS.md
- **All Tasks** → MASTER-TODO.md (comprehensive task list)
- **Current Work** → TODO.md (phase-based roadmap)
- **Recent Changes** → CHANGELOG.md

---

## 📝 Documentation Standards

### File Naming
- Use kebab-case: `my-document-name.md`
- Include dates for time-sensitive docs: `ISSUE-73-LOGPUSH-JAN2.md`
- Prefix with type: `API-`, `ISSUE-`, `GUIDE-`

### Location
- **Root** - Only README, CLAUDE, TODO, CHANGELOG, MASTER-TODO
- **docs/** - All other documentation
- **docs/planning/** - Strategy and planning documents
- **docs/archive/** - Superseded or completed documentation

### Maintenance
- Update INDEX.md when adding new docs
- Archive outdated docs to `archive/YYYY/`
- Keep CURRENT-STATUS.md updated weekly
- Update CHANGELOG.md on deploys

---

**Need help?** Check [CURRENT-STATUS.md](./CURRENT-STATUS.md) for active issues or search this index.
