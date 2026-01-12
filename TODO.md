# Alexandria Development Roadmap

Active tasks and future work. Production system (Phase 1-5) is complete.

---

## ✅ Recently Completed (Jan 2026)

### v2.6.0 - External Service Provider Framework (Jan 11-12, 2026) ✅ COMPLETE
**Priority:** CRITICAL - Unified architecture for all external API integrations

**Status:** PRODUCTION DEPLOYED ✅

**Problem Solved:**
- 60% code duplication across 7 external service providers
- Hard-coded provider chains with no dynamic discovery
- Manual rate limiting, caching, retry logic in each service
- No quota-aware provider selection
- Difficult to add new services (required changes across multiple files)

**Solution Delivered:**
- ✅ **Capability-based provider registry** - Dynamic service discovery
- ✅ **Unified HTTP client** - Centralized rate limiting, caching, retry logic
- ✅ **3 orchestrators** - ISBN resolution, cover fetch, metadata enrichment
- ✅ **7 providers migrated** - ISBNdb, GoogleBooks, OpenLibrary, ArchiveOrg, Wikidata, Wikipedia, Gemini
- ✅ **5-tier ISBN cascading fallback** - ISBNdb → GoogleBooks → OpenLibrary → ArchiveOrg → Wikidata
- ✅ **Quota-aware provider filtering** - Registry automatically excludes exhausted providers
- ✅ **Worker-optimized** - Timeout protection, parallel execution, graceful degradation
- ✅ **Comprehensive testing** - 116 tests (unit, integration, performance, quota enforcement)

**Impact:**
- 60% code reduction (~400 lines eliminated)
- Zero breaking changes (100% backward compatible)
- 3x faster ISBN batch processing (parallel chunks with concurrency limit)
- Stop-word filtering reduces false positives in title matching
- <10ms initialization, <5ms registry lookups
- All 860 tests passing

**Architecture:**
- `worker/lib/external-services/` - Core framework
  - `capabilities.ts` - 6 capability interfaces (ISBN, metadata, covers, subjects, biography, generation)
  - `provider-registry.ts` - Dynamic provider discovery and registration
  - `http-client.ts` - Unified HTTP client with rate limiting, caching, retry
  - `service-context.ts` - Unified context for all providers
- `worker/lib/external-services/providers/` - 7 providers implementing capability interfaces
- `worker/lib/external-services/orchestrators/` - 3 orchestrators for workflow management
- `worker/src/services/isbn-resolution.ts` - Migrated to NEW orchestrator
- `worker/src/services/synthetic-enhancement.ts` - Migrated to NEW orchestrator

**Code Cleanup (Post-Grok Review):**
- ✅ Removed ~330 lines of dead code (OLD resolveISBNViaTitle, string utilities)
- ✅ Added stop-word filtering to GoogleBooksProvider and ArchiveOrgProvider
- ✅ Implemented parallel batch processing with concurrency limit of 5
- ✅ Net reduction: ~275 lines (~15% reduction in isbn-resolution.ts)

**Documentation:**
- `docs/development/SERVICE_PROVIDER_GUIDE.md` - Comprehensive developer guide
- `docs/planning/EXTERNAL_API_ARCHITECTURE_PLAN.md` - Architecture plan
- Planning files: `task_plan.md`, `findings.md`, `progress.md`

**Deployment History:**
- Phase 1-2: 946dc0c, 3eb8574, dd413da (Jan 11)
- Phase 3: 6fe21813-1b6d-42c4-a2e5-5e90977e51fb (Jan 11)
- Cleanup: 25fd4ec, 228090dd-18fd-4a15-84fd-92d27c2117c6 (Jan 12)

**Related Issues:**
- Closes #173 (Multi-Source ISBN Resolution EPIC)
- Foundation for #163 (Subject/Genre Coverage), #166 (Advanced Features)

---

## 🎯 Active Work

### Archive.org Metadata Enrichment - Phase 2 (#159) ✅ COMPLETE
**Priority:** PRODUCTION DEPLOYED (Jan 10, 2026)

**Status:** Successfully extended Archive.org beyond covers to full metadata enrichment!

**Completed:**
- [x] Phase 2.1: Research & Design (PAL thinkdeep analysis)
- [x] Phase 2.2: Implementation (fetchArchiveOrgMetadata function)
- [x] Phase 2.3: Integration (3-way merge in enrichment pipeline)
- [x] Phase 2.4: Testing (100% pass rate - 37/37 tests)
- [x] Phase 2.5: Documentation & Deployment

**Key Features Delivered:**
- Rich, multi-paragraph descriptions (superior to ISBNdb)
- Library of Congress subject classifications
- Authoritative OpenLibrary crosswalk IDs (edition + work)
- Alternate ISBNs (deduplicated merge)
- 3-way merge: ISBNdb + Wikidata + Archive.org
- Description priority: Archive.org > ISBNdb
- Subject normalization: merged, lowercase, deduplicated

**Performance Impact:**
- Expected 30-40% additional ISBNdb quota reduction (beyond Phase 1's 40%)
- Archive.org API latency: 140-240ms (acceptable for inline integration)
- Test coverage: 100% (17/17 archive-org, 20/20 enrichment-service)
- Zero test failures, zero rework

**Infrastructure:**
- Rate limiting: 1 req/sec (KV-backed, distributed-safe)
- Caching: 7-day TTL with null result caching
- Graceful degradation: Archive.org failures don't break pipeline
- Backward compatible: optional parameters, no breaking changes

**Next Steps:**
- Monitor ISBNdb quota reduction in production
- Track description quality improvements
- Measure Archive.org cache hit rate

---

### Phase 5: Backfill System Validation (#150) ✅ COMPLETE
**Priority:** PRODUCTION READY

**Status:** Successfully validated with outstanding results!

**Completed:**
- [x] Gemini API integration: Complete
- [x] Gemini API key: Configured ✅
- [x] Worker OOM issues: Fixed (#149) ✅
- [x] Dry-run validation infrastructure: Built and tested
- [x] Phase 1: Baseline validation complete (90% success rate!)
- [x] Analysis complete: Baseline is production-ready

**Results:**
- **90% ISBN resolution** (target was 15% - 6x better!)
- 20 books per month = 240 books/year (sustainable volume)
- <$0.20 estimated cost for full 2005-2024 backfill
- All infrastructure validated (dry-run, tracking, queues)

**Production Ready:**
- Baseline prompt validated and ready to deploy
- Recommended configuration: gemini-2.5-flash, June 2024-style months
- Can proceed immediately with historical backfill (2005-2024)

**Deferred (Optional Future Work):**
- [ ] Phase 2: Model comparison (3 models) - baseline already excellent
- [ ] Phase 3: Historical range testing - can test in production
- [ ] Implement prompt variant registry for easier A/B testing

### Phase 4: Author Metadata Expansion
**Priority:** MEDIUM

**Current Status:**
- Top-1000 tier harvest: 81.8% complete (818/1000 authors processed)
- Wikidata enrichment: Automated via daily cron (2 AM UTC)
- Author deduplication: Complete (normalized_name system)
- **JIT Enrichment Phase 1: COMPLETE ✅** (Jan 7, 2026)

**Author JIT Enrichment Roadmap:**
- [x] Phase 1: View-triggered enrichment (COMPLETE - Jan 7)
  - [x] Database migration (5 tracking columns)
  - [x] needsEnrichment() logic with quota circuit breakers
  - [x] Author queue handler (10 batch, 1 concurrency)
  - [x] Heat score + priority system
  - [x] Full documentation in docs/features/AUTHOR-JIT-ENRICHMENT.md
- [ ] Phase 2: Selective background enrichment for high-value authors
  - [ ] Identify top authors by heat score
  - [ ] Scheduled enrichment for high-priority authors
  - [ ] Quota-aware batch processing
- [ ] Phase 3: Auto-bibliography trigger
  - [ ] Trigger bibliography expansion when Wikidata ID obtained
  - [ ] Priority queueing for newly identified authors
- [ ] Phase 4: Search-triggered enrichment
  - [ ] Trigger enrichment on author search queries
  - [ ] Track search frequency for priority scoring
- [ ] Phase 5: Coverage dashboard
  - [ ] Analytics for enrichment coverage
  - [ ] Heat score distribution visualization
  - [ ] Queue health monitoring

**Next Steps:**
- [ ] Monitor bulk harvesting automation
- [ ] Verify cron job reliability
- [ ] Review harvest error patterns
- [ ] Monitor JIT enrichment in production
- [ ] Plan Phase 2 implementation

---

## 🌟 Future Enhancements

### Phase 5: Advanced Features
- [ ] Export results (CSV, JSON)
- [ ] Search analytics tracking (Analytics Engine)
- [ ] Semantic search with embeddings (Vectorize)
- [ ] Wikipedia + LLM fallback for author enrichment

### Phase 6: Operations
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Error monitoring and alerting
- [ ] Performance benchmarks in CI
- [ ] Disaster recovery documentation

---

## 📚 Reference

**API Documentation:** [docs/api/API-SEARCH-ENDPOINTS.md](./docs/api/API-SEARCH-ENDPOINTS.md)
**Developer Guide:** [CLAUDE.md](./CLAUDE.md)
**Current Issues:** [docs/CURRENT-STATUS.md](./docs/CURRENT-STATUS.md)

**Quick Commands:**
```bash
cd worker/ && npm run dev        # Local development
npm run deploy                    # Deploy to production
npm run tail                      # Monitor logs
./scripts/tunnel-status.sh        # Check infrastructure
```

---

**Last Updated:** January 12, 2026
