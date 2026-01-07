# Alexandria Development Roadmap

Active tasks and future work. Production system (Phase 1-5) is complete.

---

## 🎯 Active Work

### Phase 5: Backfill System Validation (#150)
**Priority:** HIGH

**Current Status:**
- Gemini API integration: Complete
- Gemini API key: Configured ✅
- Worker OOM issues: Fixed (#149) ✅
- Dry-run validation: Ready to start

**Next Steps:**
- [ ] Execute Phase 1: Baseline validation (6 prompt variants)
- [ ] Execute Phase 2: Model comparison (3 models)
- [ ] Execute Phase 3: Historical range testing
- [ ] Analyze results and select production configuration
- [ ] Document winner and enable production backfill

### Phase 4: Author Metadata Expansion
**Priority:** MEDIUM

**Current Status:**
- Top-1000 tier harvest: 81.8% complete (818/1000 authors processed)
- Wikidata enrichment: Automated via daily cron (2 AM UTC)
- Author deduplication: Complete (normalized_name system)

**Next Steps:**
- [ ] Monitor bulk harvesting automation
- [ ] Verify cron job reliability
- [ ] Review harvest error patterns

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

**Last Updated:** January 7, 2026
