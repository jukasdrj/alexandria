# Alexandria Master Plan 2026
**Solo Dev Edition - Family Userbase**

**Last Updated:** January 8, 2026
**Reality Check:** You're the only developer. Your users are family members who want to find books.

---

## 🎯 Core Philosophy

**NEEDS vs WANTS:**
- ✅ **NEED:** System works reliably for family book searches
- ✅ **NEED:** Database stays enriched with good metadata
- ✅ **NEED:** Costs stay low (<$50/month)
- ❌ **WANT:** Semantic search, analytics dashboards, ML features
- ❌ **WANT:** Perfect code coverage, zero technical debt
- ❌ **WANT:** Enterprise-grade monitoring systems

**Current Status:** ✅ System is PRODUCTION READY. Phase 1-5 COMPLETE.

---

## 🚨 Issue Audit & Triage

### CLOSE IMMEDIATELY (Stale/Nice-to-Have)
These are optimizations for problems you don't have:

- **#133** - Parallelize author enrichment (2 days old, no users complaining) → CLOSE
- **#134** - Batch database operations (2 days old, premature optimization) → CLOSE
- **#135** - Expand cover scope pre-2000 (2 days old, not a user request) → CLOSE
- **#136** - Better error handling author enrichment (2 days old, works fine) → CLOSE
- **#137** - Work deduplication cache (2 days old, no performance issues) → CLOSE
- **#138** - Checkpoint system (2 days old, already have recovery) → CLOSE
- **#139** - Dynamic batch sizing (2 days old, quota is fine) → CLOSE
- **#99** - Harvesting runbook (25 days old, docs exist, MARKED COMPLETE) → CLOSE
- **#100** - GitHub Actions (25 days old, cron works, not urgent) → CLOSE
- **#113** - Wikipedia/LLM fallback (8 days old, Wikidata works) → CLOSE
- **#116** - Search analytics (4 days old, family doesn't need this) → CLOSE
- **#117** - Semantic search (4 days old, current search works) → CLOSE
- **#118** - Auto-healing for bulk harvest (3 days old, works fine) → CLOSE
- **#121** - Extend BookResult types (3 days old, types work) → CLOSE
- **#146** - LIMIT+1 pagination (1 day old, no pagination complaints) → CLOSE
- **#147** - Author similarity fuzzy matching (1 day old, normalized_name works) → CLOSE
- **#148** - Optimize Gemini integration (1 day old, 90% success is great) → CLOSE

**Total to Close:** 17 issues (81% of open issues)

### KEEP OPEN (Real Issues)

**P1 - Fix Now (Bugs/Correctness):**
- **#123** - Race condition in quota reservation (actual bug, needs fix)
- **#155** - Integrate external_id_mappings into enrichment (incomplete feature from #155)

**P2 - Fix This Month (Code Quality):**
- **#128** - Inconsistent error handling (code smell, low impact)
- **#129** - Magic numbers need documentation (code smell, low impact)

**P3 - Maybe Someday (Enhancements):**
- **#153** - Author JIT Enrichment Phase 2-5 (Phase 1 works, defer rest)

**Total to Keep:** 5 issues (24% of open issues)

---

## 📅 Sprint Plan (Solo Dev, 2-Hour Sessions)

### Sprint 1: "Cleanup & Close" (1 session, 2 hours)
**Goal:** Reduce noise, close stale issues

**Tasks:**
1. Close 17 stale/nice-to-have issues with explanation comment
2. Label remaining 5 issues (P1/P2/P3)
3. Update CURRENT-STATUS.md to reflect reality
4. Archive old planning docs

**Success Criteria:** Issue count drops from 21 → 5

---

### Sprint 2: "Fix Critical Bugs" (2 sessions, 4 hours)
**Goal:** Fix actual bugs that could cause production issues

**Issue #123 - Race Condition in Quota Reservation:**
- Review quota-manager.ts reserveQuota() logic
- Add atomic KV operations or mutex pattern
- Write unit test reproducing race condition
- Deploy fix

**Issue #155 - External ID Mappings Integration:**
- Review enrichment pipeline (queue-handlers.ts)
- Add external_id_mappings inserts during enrichment
- Test with batch enrichment
- Deploy fix

**Success Criteria:** No more quota double-counts, external IDs populate automatically

---

### Sprint 3: "Deploy Backfill" (1 session, 2 hours)
**Goal:** Use your 90% successful backfill system

**Tasks:**
1. Read docs/experiments/PHASE1-SUMMARY.md one more time
2. Run backfill for 2024 (12 months × 46 sec = 9 minutes)
3. Monitor in npm run tail
4. Verify enriched_editions growth
5. Document results in CHANGELOG.md

**Success Criteria:** ~240 books from 2024 enriched, cost <$0.02

---

### Sprint 4: "Code Quality Pass" (2 sessions, 4 hours)
**Goal:** Fix annoying code smells

**Issue #128 - Inconsistent Error Handling:**
- Standardize error responses across routes
- Use Logger consistently (no more console.*)
- Document error handling pattern in CLAUDE.md

**Issue #129 - Magic Numbers:**
- Extract constants: QUOTA_LIMIT, BATCH_SIZES, RATE_LIMITS
- Add comments explaining threshold choices
- Create worker/src/config/constants.ts

**Success Criteria:** Code is cleaner, easier to maintain

---

### Sprint 5: "Monthly Maintenance" (1 session/month, 2 hours)
**Recurring monthly task:**

**Tasks:**
1. Run backfill for previous month (1 month = 46 seconds)
2. Check ISBNdb quota status (should have 13K remaining)
3. Review Worker logs for errors (npm run tail | grep ERROR)
4. Update CURRENT-STATUS.md
5. Git commit + push

**Success Criteria:** Database stays fresh, system runs smoothly

---

## 📊 Realistic Timeline

**January 2026:**
- Week 2: Sprint 1 (Cleanup) + Sprint 2 (Bug fixes)
- Week 3: Sprint 3 (Deploy backfill) + Sprint 4 (Code quality)
- Week 4: Monitor, relax

**February 2026 onwards:**
- Monthly backfill (2 hours/month)
- React to actual user feedback
- No speculative work

---

## 🎯 Definition of "Done"

**System is DONE when:**
- ✅ Family can search books and find what they want
- ✅ Book metadata is accurate and enriched
- ✅ Covers load properly
- ✅ System doesn't break or cost too much
- ✅ You can maintain it in 2 hours/month

**You are 95% done already. Don't over-engineer this.**

---

## 🚫 What NOT to Do

**AVOID:**
- Building features nobody asked for
- Optimizing for problems that don't exist
- Creating "enterprise-grade" anything
- Rewriting working code because it's not perfect
- Planning sprints beyond 1 month
- Keeping issues open "just in case"

**REMEMBER:**
- Your users are family, not enterprise customers
- Simple + working > complex + perfect
- Close issues aggressively
- Code that works is better than code that's beautiful

---

## 📝 Issue Lifecycle

**When to OPEN an issue:**
- Family member reports a bug
- System breaks in production
- You discover a security vulnerability

**When to CLOSE an issue:**
- Feature works (even if not perfect)
- Issue is stale (>7 days, no activity)
- Issue is optimization for non-existent problem
- You realize you won't do it (be honest)

**Healthy issue count: 0-5 issues open at any time**

---

## 🎉 Success Metrics (Reality-Based)

**Good Success:**
- Family uses Alexandria weekly
- Search results are relevant
- Costs stay under $30/month
- You maintain it in <2 hours/month

**Great Success:**
- Family prefers Alexandria over Google/Amazon
- Database has 30M+ enriched books
- System runs for months without intervention

**Unrealistic Success (don't chase):**
- 99.99% uptime SLA
- Sub-100ms response times
- ML-powered recommendations
- Zero technical debt

---

## 📞 When to Ask for Help

**You DON'T need help for:**
- Performance optimization (system is fast enough)
- Advanced monitoring (logs work fine)
- Enterprise features (you're not an enterprise)

**You MIGHT need help for:**
- Cloudflare outages
- Database corruption
- Security vulnerabilities

---

## 🏁 Next Actions (Priority Order)

1. **Sprint 1 this week:** Close 17 stale issues (30 minutes)
2. **Sprint 2 next week:** Fix quota race condition + external ID mappings (4 hours)
3. **Sprint 3 week after:** Deploy 2024 backfill (2 hours)
4. **Sprint 4 optional:** Code cleanup if you feel like it (4 hours)
5. **Monthly:** Run backfill for last month (2 hours/month)

**Total time investment:** ~12 hours over 3 weeks, then 2 hours/month maintenance.

---

**Remember:** You've already built something great. Don't let perfect be the enemy of good.
