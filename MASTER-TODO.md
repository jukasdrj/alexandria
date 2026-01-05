# Alexandria Master TODO

**Last Updated:** January 5, 2026
**Purpose:** Tracking open tasks and future work. Production system (Phase 1-5) is complete.

---

## 🚨 P1 - CRITICAL / BLOCKING

**No critical issues currently.**

---

## 🔥 P2 - HIGH PRIORITY

### Author Metadata Expansion
1. [ ] Monitor automated bulk harvesting (cron job at 2 AM UTC)
2. [ ] Verify author normalization completion (14.7M author backfill)
3. [ ] Review harvest error patterns and reliability

### Code Maintenance
- [ ] `worker/src/services/author-service.ts:476` - Add occupations to UPDATE query when column exists
- [ ] `worker/src/__tests__/routes.test.ts:86` - Comprehensive API route integration tests

---

## 🎯 P3 - MEDIUM PRIORITY

### Enhancements
1. [ ] Add KV caching to `/api/search/combined` endpoint
2. [ ] **Issue #118** - Auto-healing/recovery system for bulk harvesting
3. [ ] **Issue #100** - GitHub Actions CI/CD for automated harvesting

---

## 🌟 P4 - LOW PRIORITY / FUTURE

### Advanced Features
- [ ] **Issue #116** - Search analytics tracking
- [ ] **Issue #117** - Semantic search with Vectorize
- [ ] **Issue #113** - Wikipedia + LLM fallback for author enrichment
- [ ] Export results (CSV/JSON)

### Operations
- [ ] Automated testing pipeline
- [ ] Error monitoring and alerting
- [ ] Performance benchmarks in CI
- [ ] Disaster recovery documentation

---

## 📚 DOCUMENTATION

### Maintenance Tasks
- [ ] Review and update stale documentation dates
- [ ] Verify all documented endpoints match codebase

---

---

## 📊 System Status

**Database:** 54.8M editions | 28.6M enriched | 8.2M enriched authors
**ISBNdb Quota:** 15K daily calls (resets midnight UTC)
**Infrastructure:** Worker deployed | Cron active (2 AM UTC) | Tunnel operational

---

## 📝 Reference

**Related Files:**
- [TODO.md](./TODO.md) - Development roadmap
- [CURRENT-STATUS.md](./docs/CURRENT-STATUS.md) - Active issues
- [CHANGELOG.md](./CHANGELOG.md) - Version history
- [CLAUDE.md](./CLAUDE.md) - Developer guide

**Update this file when:**
- New GitHub issues are created
- Priorities change
- Major tasks are completed

---

**Last Review:** January 5, 2026
