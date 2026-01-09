# Master Project Tracker: Book Recommendation System

**Epic**: Personalized book recommendations based on user ratings and preferences

**Repos involved**:
- `alexandria` - Recommendation engine and API
- `bendv3` - User ratings infrastructure and API gateway
- `frontend` (if applicable) - UI for ratings and recommendations

**Timeline**: 4 weeks to MVP launch

---

## Project Goals

1. Users can rate books (1-5 stars) in bendv3
2. Users can set reading preferences (genres, mood, constraints)
3. Alexandria provides personalized recommendations via API
4. Recommendations display in frontend with explanations

**Success metrics**:
- Recommendation latency: <2s P95
- User acceptance rate: >20% click/save recommendations
- System works with 3+ rated books per user

---

## Architecture Decision

**Chosen approach**: Hybrid architecture
- bendv3: Owns all user data (ratings, preferences)
- Alexandria: Provides stateless recommendation API
- Phase 1: Content-based filtering (genres, authors, subjects)
- Phase 2 (future): Semantic embeddings via Cloudflare Workers AI

**Data flow**:
```
User rates books → bendv3 DB → User requests recs → bendv3 calls Alexandria API →
Alexandria computes recommendations → Returns to bendv3 → Display in frontend
```

---

## Tollgates & Checkpoints

### Tollgate 0: Planning & Alignment (Week 0 - CURRENT)
**Deadline**: End of week
**Owner**: All teams

**Deliverables**:
- [x] Architecture decision documented
- [x] Master tracker created (this issue)
- [x] bendv3 issue created: #257
- [ ] Alexandria planning doc saved to `.planning/`
- [ ] API contract finalized between bendv3 ↔ Alexandria
- [ ] Frontend requirements documented (if applicable)

**Blockers/Questions**:
- Does bendv3 use D1 or Postgres for user data?
- What authentication mechanism between bendv3 → Alexandria?
- Does frontend repo exist yet or is UI in bendv3?

**Exit criteria**: All teams agree on data model, API contract, and timeline

---

### Tollgate 1: Foundation (Week 1)
**Deadline**: End Week 1
**Owner**: Both teams in parallel

#### Alexandria Tasks
- [ ] Run metadata coverage validation queries
  - Success: >70% of popular books have genres
  - Blocker: If <50%, pause for enrichment backfill
- [ ] Create API spec doc: `docs/api/RECOMMENDATION-API.md`
- [ ] Prototype SQL algorithm: `scripts/test-recommendation-algorithm.sql`
- [ ] Validate algorithm with personal reading history
- [ ] Create Zod schemas: `worker/src/schemas/recommendation.ts`
- [ ] Add route skeleton: `worker/src/routes/recommend.ts`

#### bendv3 Tasks (from #257)
- [ ] Decide on data model (Postgres/D1/KV)
- [ ] Design user ratings schema
- [ ] Design preferences schema
- [ ] Create migration scripts
- [ ] Stub out API endpoints (no implementation yet)
- [ ] Document bendv3 → Alexandria authentication approach

#### Frontend Tasks (if separate repo)
- [ ] Design rating UI component (star ratings)
- [ ] Design preferences form UI
- [ ] Design recommendations display UI
- [ ] Create mockups/wireframes

**Checkpoint meeting**: End of Week 1
- Review metadata validation results
- Confirm API contract
- Align on authentication mechanism
- Adjust timeline if needed

**Exit criteria**: API contract locked, data models designed, prototypes validated

---

### Tollgate 2: Core Implementation (Week 2)
**Deadline**: End Week 2
**Owner**: Both teams in parallel

#### Alexandria Tasks
- [ ] Implement preference vector builder
- [ ] Implement candidate query (SQL)
- [ ] Implement scoring function (multi-factor)
- [ ] Implement diversity filter
- [ ] Implement explanation generator
- [ ] Add Analytics Engine instrumentation
- [ ] Unit tests for scoring logic (80% coverage)

#### bendv3 Tasks
- [ ] Implement ratings CRUD endpoints
- [ ] Implement preferences CRUD endpoints
- [ ] Implement bendv3 → Alexandria proxy endpoint
- [ ] Add authentication headers to Alexandria calls
- [ ] Database migrations deployed to dev environment
- [ ] Unit tests for API endpoints

#### Frontend Tasks
- [ ] Implement star rating component
- [ ] Implement preferences form
- [ ] Wire up to bendv3 API endpoints
- [ ] Basic error handling

**Checkpoint meeting**: End of Week 2
- Demo: Rate books in bendv3 dev environment
- Demo: Call Alexandria API with mock data
- Review test coverage
- Identify integration issues

**Exit criteria**: Core features implemented, unit tests passing, ready for integration

---

### Tollgate 3: Integration & Testing (Week 3)
**Deadline**: End Week 3
**Owner**: All teams, coordinated testing

#### Integration Tasks
- [ ] Deploy Alexandria to staging
- [ ] Deploy bendv3 to staging (with ratings DB)
- [ ] Deploy frontend to staging (if applicable)
- [ ] End-to-end test: Rate books → Get recommendations → Display results
- [ ] Performance testing: 100 concurrent users
- [ ] Load test Alexandria endpoint (target P95 <2s)

#### Alexandria Tasks
- [ ] Integration tests with mock bendv3 payloads
- [ ] Performance tuning (add indexes if needed)
- [ ] Error handling for edge cases (no matches, cold start)
- [ ] OpenAPI spec validation

#### bendv3 Tasks
- [ ] Integration tests calling Alexandria staging
- [ ] Test error handling (Alexandria down, timeout, invalid response)
- [ ] Rate limiting on recommendation endpoint
- [ ] Caching strategy (if needed)

#### Frontend Tasks
- [ ] Integration testing with bendv3 staging
- [ ] UX testing: Onboarding flow for new users
- [ ] Accessibility testing (keyboard navigation, screen readers)
- [ ] Mobile responsive testing

**Checkpoint meeting**: Mid-Week 3
- Review integration test results
- Performance metrics review
- User acceptance testing with internal team
- Go/No-Go decision for production deployment

**Exit criteria**: All integration tests passing, performance metrics met, UX approved

---

### Tollgate 4: Production Launch (Week 4)
**Deadline**: End Week 4
**Owner**: All teams, phased rollout

#### Pre-Launch Checklist
- [ ] All tests passing (unit, integration, load)
- [ ] Documentation complete (API docs, user guide)
- [ ] Analytics dashboards configured
- [ ] Error monitoring set up (Sentry, logs)
- [ ] Feature flag configured (gradual rollout)
- [ ] Rollback plan documented

#### Launch Sequence
1. [ ] Deploy Alexandria to production (feature-flagged)
2. [ ] Deploy bendv3 to production (ratings infrastructure)
3. [ ] Deploy frontend to production (UI hidden behind flag)
4. [ ] Enable for internal beta testers (5-10 users)
5. [ ] Monitor for 48 hours (errors, latency, feedback)
6. [ ] Expand to 10% of users
7. [ ] Monitor for 1 week
8. [ ] Full rollout (100% of users)

#### Monitoring (First Week)
- [ ] Daily review of Analytics Engine metrics
- [ ] Track recommendation acceptance rate
- [ ] Monitor error rates and latency
- [ ] Collect qualitative user feedback
- [ ] Bug triage and hotfixes as needed

**Checkpoint meeting**: Week 4 + 1 week
- Review launch metrics
- User feedback analysis
- Decide on Phase 2 timing (semantic embeddings)
- Identify improvements for iteration

**Exit criteria**: Stable in production, success metrics trending positive, no critical bugs

---

## Risk Register

### High Priority Risks

**Risk 1: Poor metadata coverage in Alexandria**
- Impact: Recommendations feel random/irrelevant
- Probability: Medium
- Mitigation: Run validation queries Week 1, backfill if needed
- Owner: Alexandria team
- Status: Not yet assessed

**Risk 2: Performance issues (slow queries)**
- Impact: User experience degraded (>5s response time)
- Probability: Medium
- Mitigation: Load testing Week 3, add indexes/caching
- Owner: Alexandria team
- Status: Not yet assessed

**Risk 3: bendv3 timeline delays**
- Impact: Alexandria ready but no way to test integration
- Probability: Low
- Mitigation: Alexandria builds standalone test UI for demos
- Owner: Both teams
- Status: Timeline TBD

**Risk 4: Cold start problem (users with <3 ratings)**
- Impact: New users get poor recommendations
- Probability: High
- Mitigation: Onboarding flow asks for favorite genres/authors
- Owner: Frontend + bendv3 teams
- Status: Design needed

### Medium Priority Risks

**Risk 5: Authentication complexity**
- Impact: Security issues or integration delays
- Probability: Low
- Mitigation: Use simple service token initially, upgrade later
- Owner: bendv3 team
- Status: Design needed

**Risk 6: Schema changes during development**
- Impact: Coordination overhead, rework
- Probability: Medium
- Mitigation: Lock API contract in Week 1, use versioning
- Owner: Both teams
- Status: Not yet locked

---

## Dependencies

### Alexandria → bendv3
- Needs: API contract with sample payloads
- Needed by: Week 1 (for schema design)
- Status: In progress

### bendv3 → Alexandria
- Needs: Database schema for ratings/preferences
- Needed by: Week 1 (for API design)
- Status: Pending (issue #257)

### Frontend → bendv3
- Needs: API endpoints for ratings CRUD
- Needed by: Week 2 (for UI implementation)
- Status: Pending

### bendv3 → Frontend
- Needs: UI requirements (wireframes, UX flow)
- Needed by: Week 1 (for API design)
- Status: Pending

---

## Communication Plan

### Sync Meetings
- **Week 0**: Kickoff + alignment (1 hour)
- **Week 1**: Checkpoint (30 min)
- **Week 2**: Checkpoint (30 min)
- **Week 3**: Integration review (1 hour)
- **Week 4**: Go/No-Go (30 min)
- **Week 5**: Post-launch retrospective (1 hour)

### Async Updates
- Daily: Progress updates in this issue (comment with blockers)
- Blocking issues: Tag relevant team in comment, escalate if >24h
- Questions: Ask in this issue, expect <24h response

### Escalation Path
1. Comment in this issue with `@jukasdrj` tag
2. If urgent: Direct message
3. If blocker affecting timeline: Emergency sync call

---

## Related Issues & PRs

### bendv3
- #257 - User Ratings Infrastructure (main implementation issue)

### Alexandria
- TBD - Will create issues per component as work begins

### Frontend
- TBD - Pending frontend repo confirmation

---

## Phase 2 Considerations (Future Work)

**Not in MVP scope, but document for future**:

- Semantic embeddings via Cloudflare Workers AI
- Collaborative filtering (if user base >100 active users)
- Reading goals tracking ("Read 50 books in 2026")
- Trending books via web scraping
- Import ratings from Goodreads/StoryGraph
- "Similar users" recommendations
- Book lists/collections

**Decision point**: After 1 month in production, evaluate based on:
- User engagement metrics
- Feedback quality
- Performance of Phase 1 system

---

## Status: PLANNING

**Next action**: Teams review this tracker and confirm approach in comments below

**Blocker questions**:
1. Does frontend exist as separate repo or is UI in bendv3?
2. What's bendv3's preferred database (D1, Postgres, other)?
3. Who owns the sync meetings (project lead)?
4. When can we do the Week 0 kickoff meeting?
