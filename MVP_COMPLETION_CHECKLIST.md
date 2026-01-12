# Recommendation System MVP - Completion Checklist

**Status**: Backend complete, frontend in progress
**Last Updated**: 2026-01-09

---

## ✅ Completed (Backend)

### Phase 1: Database Schema
- [x] `user_reading_preferences` table created
- [x] Migration file: `0010_add_reading_preferences.sql`
- [x] Tested locally
- [x] Schema documented in findings

**Note**: Ratings already exist in `user_library.rating` column (1-5 stars)

### Phase 2: Alexandria API
- [x] `GET /api/recommendations/subjects` endpoint
- [x] `GET /api/recommendations/similar` endpoint
- [x] PostgreSQL array handling fixed
- [x] Deployed to production
- [x] 24-hour cache TTL configured
- [x] Published npm package v2.4.0 with types

### Phase 3: bendv3 Integration
- [x] `RecommendationService` with scoring algorithm
- [x] `GET /api/recommendations` endpoint
- [x] `GET /api/recommendations/debug` endpoint
- [x] Alexandria RPC client integration
- [x] Routes registered in main router
- [x] Subject normalization logic
- [x] Diversity filter (max 3 books/author)

### Documentation
- [x] Frontend integration guide created
- [x] API documentation with TypeScript types
- [x] React component examples
- [x] Testing checklist
- [x] Troubleshooting guide

---

## 🚧 In Progress (Frontend)

### Prerequisites (Required before recommendations work)
- [ ] **User Preferences UI** - CRITICAL
  - [ ] Genre/subject picker component
  - [ ] Mood selector
  - [ ] Constraints form (page count, year)
  - [ ] `PATCH /api/users/me/preferences` endpoint
  - [ ] Preferences management page

- [ ] **Book Rating UI** - CRITICAL
  - [ ] Star rating widget component
  - [ ] Add rating on book detail page
  - [ ] `POST /api/users/me/ratings` endpoint (or update existing)
  - [ ] Display user's existing ratings

### Main Features
- [ ] Recommendations page (`/recommendations`)
  - [ ] API client implementation
  - [ ] `useRecommendations` hook
  - [ ] `RecommendationCard` component
  - [ ] Loading states
  - [ ] Error handling
  - [ ] Empty state with CTA

- [ ] Onboarding flow for new users
  - [ ] Welcome screen
  - [ ] Genre selection step
  - [ ] Mood selection step
  - [ ] Constraints step (optional)
  - [ ] Initial recommendations preview

### Integration
- [ ] Replace `x-user-id` header with real auth
- [ ] Add recommendations link to navigation
- [ ] Add "Get Recommendations" CTA on dashboard
- [ ] Exclude user's library books from recommendations

---

## ⏳ Pending (Backend - Nice to Have)

### API Endpoints (Not Blocking MVP)
- [ ] `PATCH /api/users/me/preferences` - Update preferences
  - Currently not implemented in bendv3
  - Frontend needs this to save preferences
  - Schema exists in D1, just need route

- [ ] `GET /api/users/me/preferences` - Fetch preferences
  - For pre-filling preferences form
  - Not critical (can default to empty)

- [ ] `POST /api/users/me/ratings` - Create/update rating
  - Check if this exists in current bendv3
  - May already be handled by user_library updates

### Testing (Can be done after MVP launch)
- [ ] End-to-end test with real user data
- [ ] Performance testing (target: <3s response)
- [ ] Cold start scenario test
- [ ] Preference-based scenario test
- [ ] Load testing with concurrent users

### Deployment
- [ ] Deploy bendv3 with recommendation routes
- [ ] Verify Alexandria service binding in production
- [ ] Test recommendations in production
- [ ] Monitor error rates and response times

---

## 🎯 MVP Launch Criteria

**Minimum to launch**:
1. ✅ Backend API working (`/api/recommendations`)
2. ⏳ Users can set preferences (genre picker)
3. ⏳ Users can rate books (star widget)
4. ⏳ Recommendations page displays results
5. ⏳ Error handling for users without data
6. ⏳ Basic onboarding flow

**What we can skip for v1**:
- Advanced filtering (page count, year constraints)
- Mood selector (nice to have)
- Excluded authors/subjects (can add later)
- Weekly recommendation emails
- Social features
- Analytics dashboard

---

## Critical Path (Priority Order)

### 1. Backend Preferences Endpoints (1-2 hours)
**Blocker**: Frontend needs these to save/load preferences

```typescript
// src/routes/users.ts (or create new file)
PATCH /api/users/me/preferences
GET /api/users/me/preferences
```

**Required**:
- Zod schema validation
- D1 queries (INSERT/UPDATE user_reading_preferences)
- Error handling
- Register routes in router

### 2. Frontend Preferences UI (2-3 hours)
**Blocker**: Users need to set preferences before getting recommendations

**Components**:
- Genre picker (multi-select, ~15 genres)
- Save button
- API integration

**Pages**:
- `/preferences` or `/settings/preferences`

### 3. Frontend Star Rating Widget (1-2 hours)
**Nice to have**: Improves recommendations over time

**Components**:
- 5-star input component
- Display on book detail page
- API integration (may already exist?)

### 4. Frontend Recommendations Page (2-3 hours)
**Core feature**: Display recommendations

**Components**:
- API client (`lib/api/recommendations.ts`)
- Hook (`useRecommendations`)
- Page (`app/recommendations/page.tsx`)
- Card component

### 5. Onboarding Flow (2-3 hours)
**User experience**: Guide new users

**Steps**:
1. Welcome screen
2. Genre selection (required)
3. Initial recommendations

---

## Quick Wins (Can Ship Without)

These improve the experience but aren't blocking:

- [ ] Mood selector (can default to null)
- [ ] Page count constraints (can default to null)
- [ ] Year constraints (can default to null)
- [ ] Excluded subjects/authors (can be empty array)
- [ ] Weekly recommendations cron (can enable later)
- [ ] Recommendation history tracking
- [ ] "More like this" feature
- [ ] Recommendation explanations (we have reasons, just need UI)

---

## Estimated Time to MVP

**Backend (1-2 hours)**:
- Preferences PATCH/GET endpoints: 1-2h

**Frontend (6-10 hours)**:
- Preferences UI: 2-3h
- Star rating widget: 1-2h
- Recommendations page: 2-3h
- Onboarding flow: 2-3h

**Total**: 7-12 hours to MVP

---

## Testing Plan (Post-MVP)

### 1. Manual Testing
- [ ] Create test user
- [ ] Set preferences (3 genres)
- [ ] Verify recommendations appear
- [ ] Rate 5 books (4-5 stars)
- [ ] Verify recommendations improve
- [ ] Test cold start (new user, only preferences)

### 2. Production Validation
- [ ] Monitor error logs (first 24 hours)
- [ ] Check response times (should be <3s)
- [ ] Verify Alexandria service binding working
- [ ] Check cache hit rates

### 3. User Feedback
- [ ] Collect feedback from your wife (primary user!)
- [ ] Ask: "Do these recommendations match your interests?"
- [ ] Iterate based on feedback

---

## Questions to Answer

Before shipping:

1. **Do user ratings already exist in bendv3?**
   - Check if `POST /api/books/:isbn/rate` exists
   - Or does user_library updates handle this?

2. **Where should preferences form live?**
   - Dedicated `/preferences` page?
   - Settings page?
   - Part of user profile?

3. **When to show onboarding?**
   - First login only?
   - When user has no preferences?
   - Optional "Get Started" button?

4. **Should preferences be required?**
   - Can users skip and rate books instead?
   - Or require at least 3 genres to proceed?

---

## Next Steps

**Immediate (Backend - You)**:
1. Implement `PATCH /api/users/me/preferences` endpoint
2. Implement `GET /api/users/me/preferences` endpoint
3. Test with curl/Postman
4. Deploy to production

**Frontend (Your team)**:
1. Review integration guide
2. Start with preferences UI
3. Then recommendations page
4. Save onboarding flow for last

**Post-Launch**:
1. Monitor production
2. Collect user feedback
3. Iterate on algorithm weights
4. Add Phase 2 features (semantic search)

---

## Success Metrics

After 1 week:
- [ ] X% of users set preferences
- [ ] Y% of users view recommendations
- [ ] Z% of users add recommended book to library
- [ ] Average response time: <3s
- [ ] Error rate: <1%

**MVP = Working end-to-end, even if basic!**
