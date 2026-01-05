# Alexandria Master TODO

**Last Updated:** January 5, 2026
**Purpose:** Comprehensive tracking of all open tasks, issues, and plans across the repository

---

## 🚨 P1 - CRITICAL / BLOCKING

### Documentation Mismatches (From: DOCUMENTATION_HEALTH_REPORT.md)
**Priority:** CRITICAL - Documentation contradicts codebase
**Source:** `docs/DOCUMENTATION_HEALTH_REPORT.md`

1. **Missing Endpoints** - Documented but don't exist in codebase
   - [ ] `POST /api/isbns/check` - Bulk ISBN existence check (marked as "complete" in TODO.md but code missing)
   - [ ] `POST /api/queue/drain/enrichment` - Manual enrichment queue drain
   - [ ] `POST /api/queue/drain/covers` - Manual cover queue drain
   - [ ] `GET /api/covers/inspect` - Cover object inspection
   - **Action Required:** Either implement these endpoints or remove from API-SEARCH-ENDPOINTS.md

2. **Phantom Configuration** - Smart Resolution env vars don't exist
   - [ ] Remove references to `SMART_RESOLUTION_ENABLED` from docs
   - [ ] Remove references to `SMART_RESOLUTION_PROVIDERS` from docs
   - **Location:** `docs/api/API-SEARCH-ENDPOINTS.md`
   - **Note:** Smart Resolution logic exists in tests but not in production env configuration

### Combined Search Enhancement
- [ ] **Issue #120** - Restore full author metadata in combined search endpoint results
  - **Type:** bug + enhancement
  - **Status:** Open
  - **Details:** Combined search needs complete author metadata in response

---

## 🔥 P2 - HIGH PRIORITY

### Bulk Harvesting (Phase 4)
**Source:** `docs/CURRENT-STATUS.md`, `TODO.md`

1. **Issue #111** - Top-1000 Author Tier Harvest (IN PROGRESS - 70% complete)
   - **Status:** 701/1000 authors complete (~299 remaining, ~10 minutes)
   - **Statistics:**
     - Successfully enriched: ~520 authors
     - Network errors/timeouts: ~180 authors
     - Books found: ~50,000+
     - Covers queued: Hundreds
   - [ ] Complete remaining 299 authors
   - [ ] Verify cover queue processing after harvest completes
   - [ ] Monitor enriched table growth
   - **Script:** `scripts/bulk-author-harvest.js`
   - **Checkpoint:** `data/bulk-author-checkpoint.json`

2. **Author Metadata Enhancement**
   - [ ] Verify author normalization migration completion
   - [ ] Check backfill of 14.7M authors (`normalized_name` column)
   - [ ] Monitor for duplicate reduction in search results
   - **Command:** `ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c 'SELECT name, normalized_name FROM enriched_authors LIMIT 10;'"`

3. **Code TODOs** (From: Grep search)
   - [ ] `worker/src/services/author-service.ts:476` - Add occupations to UPDATE query when enriched_authors has column
   - [ ] `worker/src/__tests__/routes.test.ts:86` - PHASE 2 TODO: Comprehensive API route integration tests

---

## 🎯 P3 - MEDIUM PRIORITY

### Phase 5: Advanced Features
**Source:** `TODO.md`, GitHub issues

1. **KV Caching for Combined Search**
   - [ ] Add KV caching to `/api/search/combined` endpoint
   - **Note:** Individual search endpoints already have KV caching (ISBN: 24h, Title/Author: 1h)
   - **Location:** `worker/src/routes/search.ts`

2. **Issue #118** - Auto-healing/recovery system for bulk author harvesting
   - **Type:** enhancement
   - **Status:** Open
   - **Details:** Automatic retry and recovery for failed harvest operations

3. **Issue #100** - GitHub Actions for Automated Harvesting
   - **Type:** enhancement + documentation
   - **Status:** Open
   - **Goal:** CI/CD pipeline for scheduled harvesting operations
   - **Scope:**
     - Automated cover harvesting
     - Automated author enrichment
     - Scheduled cron jobs via GitHub Actions

4. **Issue #99** - Harvesting Runbook Documentation
   - **Type:** documentation + enhancement
   - **Status:** Open
   - **Goal:** Document procedures for:
     - New releases harvesting
     - Author bibliographies expansion (Option B)
     - Manual intervention scenarios

---

## 🌟 P4 - LOW PRIORITY / FUTURE

### Phase 5 & 6: Advanced Features & Operations
**Source:** `TODO.md`, GitHub issues

1. **Issue #116** - Search analytics tracking with Analytics Engine
   - **Type:** enhancement
   - **Status:** Open
   - **Scope:**
     - Track query patterns
     - Monitor popular searches
     - Analyze cache hit rates
     - Performance metrics

2. **Issue #117** - Semantic search with Cloudflare Vectorize
   - **Type:** enhancement
   - **Status:** Open
   - **Goal:** Implement vector-based semantic search
   - **Tech:** Cloudflare Vectorize + embeddings

3. **Issue #113** - Wikipedia + LLM fallback for authors without Wikidata
   - **Type:** enhancement
   - **Status:** Open
   - **Goal:** Enhance author metadata for authors missing Wikidata IDs
   - **Approach:**
     - Wikipedia API as secondary source
     - LLM-powered extraction from text
     - Fallback chain: Wikidata → Wikipedia → LLM

4. **Export Results**
   - [ ] CSV export for search results
   - [ ] JSON export for search results
   - **Note:** Currently only JSON responses via API

5. **CI/CD Pipeline** (Beyond Issue #100)
   - [ ] Automated testing on pull requests
   - [ ] Automated deployment pipeline
   - [ ] Error monitoring/alerting integration
   - [ ] Performance benchmarks in CI

6. **Disaster Recovery**
   - [ ] Document backup procedures
   - [ ] Database backup strategy
   - [ ] Recovery time objectives (RTO)
   - [ ] Recovery point objectives (RPO)

7. **Contract Testing Improvements** (From: PLAN-CONTRACT-TESTING.md)
   - [ ] Investigate Hyperdrive query optimization (line 140)
   - [ ] Add term frequency filtering for search (line 144)
   - [ ] Re-enable stats endpoint tests when fixed (line 147)

---

## 📚 DOCUMENTATION TASKS

### Immediate Documentation Work
**Source:** Documentation Health Report, INDEX.md

1. **Fix API Documentation**
   - [ ] Update `docs/api/API-SEARCH-ENDPOINTS.md` to remove phantom endpoints
   - [ ] Remove Smart Resolution env var references
   - [ ] Verify all documented endpoints exist in codebase
   - [ ] Add note about `/api/isbns/check` removal (if confirmed removed)

2. **Stale Documentation**
   - [ ] Review and update last modified dates in stale docs
   - [ ] Verify `TODO.md` Phase 2.10 references match actual implementation
   - [ ] Update any references to removed endpoints

3. **Root Directory Organization** ✅ **COMPLETED - Jan 5, 2026**
   - [x] Move non-essential markdown files out of root directory
   - [x] Keep only: README.md, CLAUDE.md, TODO.md, CHANGELOG.md, MASTER-TODO.md
   - [x] Organize remaining docs into appropriate subdirectories:
     - Planning/strategy docs → `docs/planning/`
     - API contracts → `docs/api/`
     - Implementation plans → `docs/archive/2025/`
   - **Files organized:**
     - PLAN-CONTRACT-TESTING.md → docs/planning/
     - ISSUE-114-SUMMARY.md → docs/archive/2025/
     - AUTHOR-NORMALIZATION.md → docs/planning/
     - API-IDENTIFIER-RESOLUTION.md → docs/api/
     - DOCUMENTATION_HEALTH_REPORT.md → docs/planning/

4. **Update Documentation Index** ✅ **COMPLETED - Jan 5, 2026**
   - [x] Update `docs/INDEX.md` after reorganization
   - [x] Ensure all moved files have correct paths
   - [x] Add MASTER-TODO.md to essential reading section
   - [x] Added new "Planning & Strategy" section
   - [x] Updated "By Topic" and "By Priority" sections

---

## ✅ RECENTLY COMPLETED (Reference)

### January 5, 2026
- ✅ Combined search endpoint fully operational (`/api/search/combined`)
- ✅ Schema fixes for enriched tables queries
- ✅ Published v2.2.1 and v2.2.2 to npm

### January 4, 2026
- ✅ Issue #90 - Cross-repo contract testing
- ✅ Issue #110 - Wikidata enrichment cron job (daily 2 AM UTC)
- ✅ Issue #112 - VIAF/ISNI → Wikidata crosswalk endpoint
- ✅ Issue #114 - Author deduplication with normalized names
- ✅ Harvest script bug fix (quota check logic)

### January 3, 2026
- ✅ Issue #109 - ISBNdb quota tracking fixes
- ✅ Issue #108 - Bulk author harvest script fixes

### January 2, 2026
- ✅ Issue #84 - Skip WebP conversion for small images (<5KB)

---

## 📊 CURRENT SYSTEM STATUS

### Database
- **Editions:** 54.8M
- **Authors:** 14.7M (normalization deployed)
- **Enriched Editions:** 28.6M
- **Enriched Works:** 21.2M
- **Enriched Authors:** 8.2M

### ISBNdb Quota
- **Daily Limit:** 15,000 calls
- **Current Usage:** ~2,000/15,000 (13%)
- **Reset:** Daily at midnight UTC

### Infrastructure
- **Worker:** Deployed (Version: a5963008-d879-4101-bf70-1d3f50a781c0)
- **Cron Jobs:** Active (daily 2 AM UTC - Wikidata enrichment + cover harvesting)
- **Tunnel:** Operational (4 connections)
- **Queues:** Processing normally

---

## 🎯 RECOMMENDED NEXT ACTIONS

### This Week (January 5-12, 2026)
1. **Complete Top-1000 Harvest** (Issue #111) - ~10 minutes remaining
2. **Organize Root Directory** - Move documentation files as requested
3. **Fix Documentation Mismatches** - Address DOCUMENTATION_HEALTH_REPORT findings
4. **Restore Author Metadata** (Issue #120) - Fix combined search response

### This Month (January 2026)
5. **GitHub Actions Setup** (Issue #100) - Automated harvesting pipeline
6. **Harvesting Runbook** (Issue #99) - Document operational procedures
7. **Auto-healing System** (Issue #118) - Improve harvest reliability

### Q1 2026 (Future)
8. **Search Analytics** (Issue #116) - Track usage patterns
9. **Wikipedia/LLM Fallback** (Issue #113) - Enhanced author enrichment
10. **Semantic Search** (Issue #117) - Vectorize implementation

---

## 📝 MAINTENANCE NOTES

### This file should be updated when:
- New GitHub issues are created
- Existing issues are closed or priorities change
- New TODO comments are added to code
- Documentation gaps are identified
- Phase completions occur

### Related Files:
- **TODO.md** - Phase-based roadmap (more detailed, phase-centric view)
- **CURRENT-STATUS.md** - Active issues snapshot (weekly updates)
- **CHANGELOG.md** - Version history (release-based)
- **MASTER-TODO.md** - This file (comprehensive, task-centric view)

---

**Next Review:** After Issue #111 completion and documentation reorganization
