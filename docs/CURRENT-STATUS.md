# Alexandria Current Status & Open Issues

**Last Updated:** January 3, 2026

## 🎯 Active Issues

### P2 - MEDIUM Priority
1. **#111** - Run top-1000 author tier harvest (ready to execute)
2. **#110** - Set up Wikidata enrichment cron job

### P3 - LOW Priority (Future Enhancements)
3. **#114** - Author deduplication and normalization
4. **#113** - Wikipedia + LLM fallback for authors without Wikidata
5. **#112** - VIAF/ISNI → Wikidata crosswalk for author expansion

### Infrastructure & Documentation
6. **#100** - GitHub Actions for automated harvesting
7. **#99** - Harvesting runbook documentation
8. **#90** - Cross-repo contract testing (Alexandria ↔ bendv3)

---

## ✅ Recently Completed (January 2026)

### #109: ISBNdb Quota Tracking (COMPLETED - Jan 3)
**Fixed critical quota tracking bugs:**
- POST /api/harvest/covers wasn't tracking ISBNdb calls
- Enrichment queue handler not recording API usage
- GET /api/quota/status using wrong KV namespace

**Resolution:**
- ✅ All 475 tests passing
- ✅ Quota now correctly tracking all ISBNdb operations
- ✅ Documentation: `docs/operations/ISBNDB-QUOTA-INVESTIGATION-JAN3.md`

### #108: Bulk Author Harvest Failures (COMPLETED - Jan 3)
**Fixed script bugs causing 17.5% failure rate:**
- Undefined variable reference (`totalAuthors`)
- Rate limiting (40 req/min vs Worker limit 10 req/min)
- ISBNdb 403 errors (now resolved)

**Resolution:**
- ✅ Fixed in commit a87b6c5
- ✅ Increased DELAY_MS to 6000ms (10 req/min)
- ✅ Script ready for production harvests

---

## 📋 TODO.md Status

### Phase 3: Performance & Search Optimization
- [x] Fix ILIKE performance, ANALYZE tables, GIN indexes
- [x] Switch search to enriched tables
- [x] Query result caching (KV), CDN headers
- [ ] Add KV caching for combined search endpoint
- [ ] Verify bendv3 integration

### Phase 4: Author Enrichment Expansion
- [x] `/api/authors/enrich-bibliography` endpoint
- [x] Scripts: `expand-author-bibliographies.js`, `e2e-author-enrichment-test.js`
- [ ] Run large-scale author expansion (ready, pending #111)
- [ ] Author deduplication (#114)

### Phase 5: Advanced Features
- [ ] Combined search (`/api/search?q={query}`)
- [ ] Pagination, export (CSV/JSON), analytics
- [ ] Semantic search with embeddings

### Phase 6: Operations
- [ ] CI/CD pipeline (GitHub Actions) - #100
- [ ] Error monitoring/alerting
- [ ] Disaster recovery plan

---

## 🎯 Recommended Next Actions

### Immediate (This Week)
1. **Run Top-1000 Harvest (#111)** - Script fixed and ready
2. **Set Up Wikidata Cron (#110)** - Add cron trigger to wrangler.jsonc

### Short-term (Next Week)
3. **Author Deduplication (#114)**
4. **Contract Testing (#90)**

### Long-term (Next Month)
5. **GitHub Actions Automation (#100)**
6. **Combined Search Endpoint**

---

## 📊 Quick Status Commands

```bash
# ISBNdb quota
curl https://alexandria.ooheynerds.com/api/quota/status | jq

# Worker logs
npm run tail | grep -i "cover|enrich|quota"

# Database stats
curl https://alexandria.ooheynerds.com/api/stats | jq

# Checkpoint status
cat data/bulk-author-checkpoint.json | jq '.stats'
```

---

**Next Review:** After #111 completion
